import Groq from 'groq-sdk';

class AIService {
  constructor() {
    this.groq = null;
  }

  /**
   * Initialize Groq client lazily
   */
  _initGroq() {
    if (!this.groq) {
      if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY environment variable is missing or empty');
      }
      this.groq = new Groq({
        apiKey: process.env.GROQ_API_KEY
      });
    }
    return this.groq;
  }

  /**
   * Generate an answer based on retrieved context and user question
   * @param {string} question - User's question
   * @param {Array<{text: string, metadata: Object}>} context - Retrieved relevant documents
   * @param {Object} options - Additional options
   * @returns {Promise<{answer: string, sources: Array, confidence: number}>} - Generated answer
   */
  async generateAnswer(question, context, options = {}) {
    try {
      if (!context || context.length === 0) {
        return {
          answer: "I don't have enough information to answer this question. Please try uploading some relevant documents first.",
          sources: [],
          confidence: 0
        };
      }

      // Truncate context to fit within token limits
      const maxTokens = 5000;
      const truncatedContext = this.truncateContext(context, question, maxTokens);
      
      console.log(`📊 Context stats: ${context.length} documents -> ${truncatedContext.documents.length} documents (${truncatedContext.estimatedTokens} estimated tokens)`);

      // Check if this is an email query by looking at context metadata
      const isEmailQuery = this.isEmailQuery(context);
      
      // Check if question is about tables, charts, or structured data
      const isStructuredDataQuestion = this.isStructuredDataQuestion(question);
      
      // Prepare context text with appropriate formatting
      const contextText = this.formatContextForAI(truncatedContext.documents, isStructuredDataQuestion, isEmailQuery);

      // Create specialized prompts based on query type
      let systemPrompt, userPrompt;
      
      if (isEmailQuery) {
        systemPrompt = this.getEmailSystemPrompt(contextText);
        userPrompt = this.getEmailUserPrompt(question);
      } else if (isStructuredDataQuestion) {
        systemPrompt = this.getStructuredDataSystemPrompt(contextText);
        userPrompt = this.getStructuredDataUserPrompt(question);
      } else {
        systemPrompt = this.getStandardSystemPrompt(contextText);
        userPrompt = this.getStandardUserPrompt(question);
      }

      // Generate response using Groq with retry logic for rate limits
      const groq = this._initGroq();
      const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
      
      const response = await this.makeGroqRequestWithRetry(() => 
        groq.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: options.temperature || parseFloat(process.env.AI_TEMPERATURE) || 0.3,
          top_p: options.topP || 1,
          frequency_penalty: options.frequencyPenalty || 0,
          presence_penalty: options.presencePenalty || 0
        })
      );

      const answer = response.choices[0].message.content;

      // Extract sources from context (use original context for sources)
      const sources = context.slice(0, 5).map(doc => ({
        text: doc.text.substring(0, 200) + '...',
        metadata: doc.metadata,
        relevance: doc.distance || 0
      }));

      // Calculate confidence based on context relevance
      const avgRelevance = context.reduce((sum, doc) => sum + (doc.distance || 0), 0) / context.length;
      const confidence = Math.max(0, Math.min(1, 1 - avgRelevance)); // Higher distance = lower confidence

      return {
        answer,
        sources,
        confidence,
        model: model,
        tokens: response.usage?.total_tokens || 0,
        contextTruncated: truncatedContext.wasTruncated,
        documentsUsed: truncatedContext.documents.length,
        totalDocumentsAvailable: context.length,
        isStructuredDataQuestion,
        isEmailQuery
      };
    } catch (error) {
      console.error('Error generating answer:', error);
      
      // Handle rate limit errors specifically
      if (error.status === 429) {
        if (error.message.includes('rate limit') || error.message.includes('tokens per min')) {
          throw new Error('Rate limit exceeded. Please wait a moment and try again. Consider using a shorter question or upgrading your OpenAI plan.');
        } else if (error.message.includes('Request too large')) {
          throw new Error('Request too large for the model. The system will automatically reduce context size on retry.');
        }
      }
      
      // Handle context length exceeded errors
      if (error.status === 400 && error.message.includes('context_length_exceeded')) {
        throw new Error('Context too long for the model. The system will automatically reduce context size on retry.');
      }
      
      throw new Error(`Failed to generate answer: ${error.message}`);
    }
  }

  /**
   * Generate an answer with minimal context as fallback
   * @param {string} question - User's question
   * @param {Array<{text: string, metadata: Object}>} context - Retrieved relevant documents
   * @param {Object} options - Additional options
   * @returns {Promise<{answer: string, sources: Array, confidence: number}>} - Generated answer
   */
  async generateAnswerWithMinimalContext(question, context, options = {}) {
    try {
      if (!context || context.length === 0) {
        return {
          answer: "I don't have enough information to answer this question. Please try uploading some relevant documents first.",
          sources: [],
          confidence: 0
        };
      }

      // Use only the most relevant document with heavy truncation
      const mostRelevantDoc = context.sort((a, b) => (a.distance || 0) - (b.distance || 0))[0];
      const truncatedText = mostRelevantDoc.text.substring(0, 2000) + '... [heavily truncated]';
      
      console.log(`🔄 Using minimal context fallback: 1 document, ~${Math.ceil(truncatedText.length / 4)} tokens`);

      const systemPrompt = `You are a helpful AI assistant. Answer the question based on the provided context. If the context doesn't contain enough information, say so clearly.

Context: ${truncatedText}

Question: ${question}

Answer:`;

      const openai = this._initOpenAI();
      const response = await openai.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', content: systemPrompt }
        ],
        max_tokens: 500,
        temperature: options.temperature || 0.3
      });

      const answer = response.choices[0].message.content;

      return {
        answer,
        sources: [{
          text: mostRelevantDoc.text.substring(0, 200) + '...',
          metadata: mostRelevantDoc.metadata,
          relevance: mostRelevantDoc.distance || 0
        }],
        confidence: 0.3, // Lower confidence due to minimal context
        model: 'llama-3.3-70b-versatile',
        tokens: response.usage?.total_tokens || 0,
        contextTruncated: true,
        documentsUsed: 1,
        totalDocumentsAvailable: context.length,
        fallbackUsed: true
      };
    } catch (error) {
      console.error('Error in minimal context fallback:', error);
      throw new Error(`Failed to generate answer even with minimal context: ${error.message}`);
    }
  }

  /**
   * Truncate context to fit within token limits
   * @param {Array<Object>} context - Original context documents
   * @param {string} question - User question
   * @param {number} maxTokens - Maximum tokens for the response
   * @returns {Object} - Truncated context with metadata
   */
  truncateContext(context, question, maxTokens) {
    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const estimateTokens = (text) => Math.ceil(text.length / 4);
    
    // Get model context limits - use configured model
    const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
    const modelContextLimit = this.getModelContextLimit(model);
    
    // Reserve tokens for the prompt structure, question, and response
    const systemPromptTokens = estimateTokens(`You are a helpful AI assistant...`) + 500; // Base prompt + buffer
    const questionTokens = estimateTokens(question);
    const responseTokens = maxTokens;
    const bufferTokens = 1000; // Safety buffer
    
    // Calculate available tokens for context (use model limit, not TPM limit)
    const availableTokensForContext = Math.max(1000, 
      modelContextLimit - systemPromptTokens - questionTokens - responseTokens - bufferTokens);
    
    console.log(`🔍 Token calculation: Model=${model}, ContextLimit=${modelContextLimit}, Available=${availableTokensForContext}`);
    
    let currentTokens = 0;
    const truncatedDocuments = [];
    let wasTruncated = false;
    
    // Sort documents by relevance (lower distance = more relevant)
    const sortedContext = [...context].sort((a, b) => (a.distance || 0) - (b.distance || 0));
    
    for (const doc of sortedContext) {
      const docText = doc.text || '';
      const docTokens = estimateTokens(docText) + estimateTokens(JSON.stringify(doc.metadata || {})) + 50; // Metadata + formatting
      
      if (currentTokens + docTokens <= availableTokensForContext) {
        truncatedDocuments.push(doc);
        currentTokens += docTokens;
      } else {
        // Try to fit a truncated version of this document
        const remainingTokens = availableTokensForContext - currentTokens - 100; // Reserve for metadata and formatting
        if (remainingTokens > 500) { // Only if we have meaningful space (at least 2000 chars)
          const maxChars = Math.min(remainingTokens * 4, 8000); // Cap at 8000 chars max
          const truncatedText = docText.substring(0, maxChars) + '... [truncated]';
          
          truncatedDocuments.push({
            ...doc,
            text: truncatedText
          });
          wasTruncated = true;
        } else {
          wasTruncated = true;
        }
        break; // Stop adding more documents
      }
    }
    
    // Ensure we have at least one document
    if (truncatedDocuments.length === 0 && context.length > 0) {
      const firstDoc = sortedContext[0];
      const maxChars = Math.min(4000, availableTokensForContext * 4 - 200); // At most 4000 chars
      truncatedDocuments.push({
        ...firstDoc,
        text: firstDoc.text.substring(0, maxChars) + '... [truncated due to length]'
      });
      wasTruncated = true;
    }
    
    return {
      documents: truncatedDocuments,
      wasTruncated,
      estimatedTokens: currentTokens,
      availableTokens: availableTokensForContext
    };
  }

  /**
   * Check if the question is about structured data (tables, charts, etc.)
   * @param {string} question - User's question
   * @returns {boolean} - True if question is about structured data
   */
  isStructuredDataQuestion(question) {
    const structuredKeywords = [
      'table', 'tables', 'chart', 'charts', 'graph', 'graphs', 'figure', 'figures',
      'data', 'dataset', 'spreadsheet', 'matrix', 'grid', 'column', 'columns',
      'row', 'rows', 'cell', 'cells', 'value', 'values', 'statistics', 'stats',
      'percentage', 'percentages', 'total', 'totals', 'sum', 'average', 'mean',
      'compare', 'comparison', 'trend', 'trends', 'pattern', 'patterns'
    ];
    
    const lowerQuestion = question.toLowerCase();
    return structuredKeywords.some(keyword => lowerQuestion.includes(keyword));
  }

  /**
   * Check if the context contains email data
   * @param {Array<{text: string, metadata: Object}>} context - Retrieved context
   * @returns {boolean} - True if context contains email data
   */
  isEmailQuery(context) {
    if (!context || context.length === 0) return false;
    
    // Check if any document in the context has email-specific metadata
    return context.some(doc => {
      const metadata = doc.metadata || {};
      return metadata.document_type === 'email' || 
             metadata.sender_email || 
             metadata.receiver_emails || 
             metadata.subject ||
             metadata.email_id;
    });
  }

  /**
   * Format context specifically for structured data questions
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to format
   * @param {boolean} isStructuredDataQuestion - Whether this is a structured data question
   * @returns {string} - Formatted context text
   */
  formatContextForAI(documents, isStructuredDataQuestion, isEmailQuery = false) {
    if (isStructuredDataQuestion) {
      return documents.map((doc, index) => {
        let formattedText = `=== Document ${index + 1} ===\n`;
        
        // Include structured data if available
        if (doc.metadata && doc.metadata.tables && doc.metadata.tables.length > 0) {
          formattedText += `📊 TABLES FOUND (${doc.metadata.tables.length}):\n`;
          doc.metadata.tables.forEach((table, tableIndex) => {
            formattedText += `Table ${tableIndex + 1}:\n${table.content || table.rows?.join('\n') || JSON.stringify(table)}\n\n`;
          });
        }
        
        if (doc.metadata && doc.metadata.charts && doc.metadata.charts.length > 0) {
          formattedText += `📈 CHARTS FOUND (${doc.metadata.charts.length}):\n`;
          doc.metadata.charts.forEach((chart, chartIndex) => {
            formattedText += `Chart ${chartIndex + 1} (${chart.type}): ${chart.title}\n`;
            if (chart.data && chart.data.length > 0) {
              formattedText += `Data: ${chart.data.join(', ')}\n`;
            }
            formattedText += '\n';
          });
        }
        
        // Include the main text content
        formattedText += `Content: ${doc.text}\n`;
        
        // Include other structured data
        if (doc.metadata) {
          const structuredData = [];
          if (doc.metadata.numbers && doc.metadata.numbers.length > 0) {
            structuredData.push(`Numbers: ${doc.metadata.numbers.join(', ')}`);
          }
          if (doc.metadata.dates && doc.metadata.dates.length > 0) {
            structuredData.push(`Dates: ${doc.metadata.dates.join(', ')}`);
          }
          if (doc.metadata.lists && doc.metadata.lists.length > 0) {
            structuredData.push(`Lists: ${doc.metadata.lists.slice(0, 3).join('; ')}`);
          }
          
          if (structuredData.length > 0) {
            formattedText += `Additional Data: ${structuredData.join(' | ')}\n`;
          }
        }
        
        formattedText += `Metadata: ${JSON.stringify(doc.metadata || {}, null, 2)}\n---\n\n`;
        return formattedText;
      }).join('\n');
    } else if (isEmailQuery) {
      // Email-specific formatting without document numbers
      return documents.map((doc, index) => 
        `=== Email ${index + 1} ===
From: ${doc.metadata?.sender_email || 'Unknown'}
To: ${doc.metadata?.receiver_emails || 'Unknown'}
Subject: ${doc.metadata?.subject || 'No Subject'}
Date: ${doc.metadata?.time_received || 'Unknown'}
Content: ${doc.text}
---`
      ).join('\n\n');
    } else {
      // Standard formatting for non-structured data questions
      return documents.map((doc, index) => 
        `=== Document ${index + 1} ===
Content: ${doc.text}
Metadata: ${JSON.stringify(doc.metadata || {}, null, 2)}
---`
      ).join('\n\n');
    }
  }

  /**
   * Get system prompt for structured data questions
   * @param {string} contextText - Formatted context text
   * @returns {string} - System prompt
   */
  getStructuredDataSystemPrompt(contextText) {
    return `You are a specialized AI assistant that excels at analyzing structured data like tables, charts, and numerical information.

IMPORTANT INSTRUCTIONS FOR STRUCTURED DATA:
- Pay special attention to tables, charts, and numerical data in the context
- When analyzing tables, identify headers, rows, columns, and data relationships
- For charts and graphs, extract trends, patterns, and key data points
- Look for numerical patterns, percentages, totals, and comparisons
- Identify relationships between different data points
- When asked about specific values, search through all structured data carefully
- If you find relevant data in tables or charts, cite the specific table/chart number
- For numerical questions, provide exact values when available
- Compare data across different tables or charts when relevant
- Look for trends, patterns, and anomalies in the data

STRUCTURED DATA ANALYSIS GUIDELINES:
- Tables: Identify headers, data types, and relationships between columns
- Charts: Determine chart type, extract data points, identify trends
- Numbers: Look for totals, percentages, averages, and comparisons
- Patterns: Identify trends, correlations, and anomalies
- Context: Consider the broader context when interpreting data

Context:
${contextText}

Please analyze the structured data and answer the following question. If you find relevant information in tables, charts, or other structured formats, cite the specific source and explain your reasoning.`;
  }

  /**
   * Get email-specific system prompt
   * @param {string} contextText - Formatted context text
   * @returns {string} - System prompt
   */
  getEmailSystemPrompt(contextText) {
    return `You are a helpful AI assistant that answers questions about emails based on the provided context. 

IMPORTANT INSTRUCTIONS:
- You MUST use information from the provided emails to answer questions
- If the emails contain relevant information, even if it's not a perfect match, use it to provide a helpful answer
- Look for related terms, synonyms, or broader categories that might answer the question
- Only say "I couldn't find any emails matching your query" if you've thoroughly searched and found absolutely nothing relevant
- Provide natural, conversational responses without mentioning document numbers or technical references
- Focus on the content and meaning of the emails rather than technical details

EMAIL-SPECIFIC INSTRUCTIONS:
- When filtering by sender, ONLY mention emails that actually contain the requested content
- If an email is from the specified sender but doesn't contain the requested content, DO NOT include it in your response
- Be explicit about which emails are relevant vs. which are not when filtering by sender
- If you find emails that don't contain the requested content, clearly state this
- Focus on emails that have both the correct sender AND the requested content
- When asked about specific topics (like "RFP"), only include emails that actually mention or discuss that topic
- Provide natural summaries of email content without technical formatting

Guidelines:
- Provide accurate and relevant answers based on the email context
- Be concise but comprehensive
- If you're unsure about something, acknowledge the uncertainty but still provide what you can from the emails
- Look for indirect answers - if someone asks about one topic but emails discuss related topics, use that information
- Write in a natural, conversational tone as if you're summarizing emails for a colleague

Context:
${contextText}

Please answer the following question based on the email context provided. Provide a natural, conversational response:`;
  }

  /**
   * Get standard system prompt for regular questions
   * @param {string} contextText - Formatted context text
   * @returns {string} - System prompt
   */
  getStandardSystemPrompt(contextText) {
    return `You are a helpful AI assistant that answers questions based on the provided context. 

IMPORTANT INSTRUCTIONS:
- You MUST use information from the provided context to answer questions
- If the context contains relevant information, even if it's not a perfect match, use it to provide a helpful answer
- Look for related terms, synonyms, or broader categories that might answer the question
- If the context has pricing information, costs, or financial data, use it even if the exact product name doesn't match
- If the context has feature descriptions, capabilities, or product information, use it to answer related questions
- Only say "the context doesn't contain information" if you've thoroughly searched and found absolutely nothing relevant
- Always cite which document(s) you're using for your answer
- If someone asks about "executive AI" but you find "AI-powered meeting assistant" or "meeting bot" pricing, use that information and explain the connection
- If someone asks about pricing but you find cost information for similar services, use that as a reference point
- When you find pricing information, always mention the specific product/service name from the context and explain how it relates to the question

EMAIL-SPECIFIC INSTRUCTIONS:
- When filtering by sender, ONLY mention emails that actually contain the requested content
- If an email is from the specified sender but doesn't contain the requested content, DO NOT include it in your response
- Be explicit about which emails are relevant vs. which are not when filtering by sender
- If you find emails that don't contain the requested content, clearly state this
- Focus on emails that have both the correct sender AND the requested content
- When asked about specific topics (like "RFP"), only include emails that actually mention or discuss that topic

Guidelines:
- Provide accurate and relevant answers based on the context
- Be concise but comprehensive
- If you're unsure about something, acknowledge the uncertainty but still provide what you can from the context
- Look for indirect answers - if someone asks about "executive AI" but the context has "AI-powered meeting assistant" or similar, use that information

Context:
${contextText}

Please answer the following question based on the context provided. If you find relevant information, use it and cite the document number:`;
  }

  /**
   * Get user prompt for structured data questions
   * @param {string} question - User's question
   * @returns {string} - User prompt
   */
  getStructuredDataUserPrompt(question) {
    return `Question: ${question}

Please analyze the structured data (tables, charts, numbers) in the provided context and answer this question. 

IMPORTANT:
- Look specifically at tables, charts, and numerical data
- Provide exact values when available in the data
- Cite specific table or chart numbers when referencing data
- Identify patterns, trends, and relationships in the data
- If the question asks for specific numbers, search through all tables and charts carefully
- Compare data across different sources when relevant
- Explain your reasoning and how you arrived at your answer

Please provide a detailed analysis using the structured data from the provided context.`;
  }

  /**
   * Get email-specific user prompt
   * @param {string} question - User's question
   * @returns {string} - User prompt
   */
  getEmailUserPrompt(question) {
    return `Question: ${question}

Please provide a natural, conversational answer about the emails based on the provided context. Focus on the content and meaning of the emails rather than technical details.

For email filtering: If the question asks for emails from a specific sender about a specific topic, only include emails that contain both the sender AND the topic content. Do not include emails that are from the sender but don't contain the requested content.

Provide a helpful summary of the relevant email information in a conversational tone.`;
  }

  /**
   * Get standard user prompt for regular questions
   * @param {string} question - User's question
   * @returns {string} - User prompt
   */
  getStandardUserPrompt(question) {
    return `Question: ${question}

Please provide a detailed answer using the information from the provided context. If you find relevant information, even if it's not an exact match, use it and cite the specific document number(s).

For pricing questions: If the exact product name isn't found but you see pricing for similar services (like "meeting bot" when asked about "executive AI"), use that information and explain the connection.

For email filtering: If the question asks for emails from a specific sender about a specific topic, only include emails that contain both the sender AND the topic content. Do not include emails that are from the sender but don't contain the requested content.`;
  }

  /**
   * Get the context length limit for different models
   * @param {string} model - Model name
   * @returns {number} - Context length limit in tokens
   */
  getModelContextLimit(model) {
    const limits = {
      // Groq models
      'llama-3.3-70b-versatile': 131072,
      'llama-3.1-8b-instant': 131072,
      'mixtral-8x7b-32768': 32768,
      'gemma2-9b-it': 8192,
      // Legacy OpenAI models (if needed)
      'gpt-3.5-turbo': 16385,
      'gpt-3.5-turbo-16k': 16385,
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-4o': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4-turbo-preview': 128000
    };
    
    return limits[model] || 131072; // Default to Llama 3.1 limit
  }

  /**
   * Make Groq request with retry logic for rate limits
   * @param {Function} requestFn - Function that makes the Groq request
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise} - Groq response
   */
  async makeGroqRequestWithRetry(requestFn, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        if (error.status === 429 && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`⏳ Rate limit hit, waiting ${waitTime}ms before retry ${attempt}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Generate a summary of the provided documents
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to summarize
   * @param {Object} options - Additional options
   * @returns {Promise<string>} - Generated summary
   */
  async generateSummary(documents, options = {}) {
    try {
      if (!documents || documents.length === 0) {
        return "No documents available to summarize.";
      }

      const documentsText = documents.map((doc, index) => 
        `[Document ${index + 1}]\n${doc.text}\n`
      ).join('\n');

      const prompt = `Please provide a comprehensive summary of the following documents. 
      Focus on the main topics, key points, and important insights.
      
      Documents:
      ${documentsText}
      
      Summary:`;

      const openai = this._initOpenAI();
      const response = await openai.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 5000,
        temperature: options.temperature || parseFloat(process.env.AI_TEMPERATURE) || 0.5
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Error generating summary:', error);
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Extract key topics from documents
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to analyze
   * @param {Object} options - Additional options
   * @returns {Promise<Array<string>>} - Extracted topics
   */
  async extractTopics(documents, options = {}) {
    try {
      if (!documents || documents.length === 0) {
        return [];
      }

      const documentsText = documents.map((doc, index) => 
        `[Document ${index + 1}]\n${doc.text}\n`
      ).join('\n');

      const prompt = `Please extract the main topics and themes from the following documents. 
      Return only a list of topics, one per line, without numbering or additional text.
      
      Documents:
      ${documentsText}
      
      Topics:`;

      const openai = this._initOpenAI();
      const response = await openai.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 5000,
        temperature: options.temperature || parseFloat(process.env.AI_TEMPERATURE) || 0.3
      });

      const topicsText = response.choices[0].message.content;
      return topicsText.split('\n').filter(topic => topic.trim().length > 0);
    } catch (error) {
      console.error('Error extracting topics:', error);
      throw new Error(`Failed to extract topics: ${error.message}`);
    }
  }

  /**
   * Validate if the AI service is properly configured
   * @returns {Promise<boolean>} - True if service is ready
   */
  async validateService() {
    try {
      if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is not configured');
      }

      // Test with a simple completion
      const groq = this._initGroq();
      const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
      const response = await groq.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5
      });

      return response.choices[0].message.content.length > 0;
    } catch (error) {
      console.error('AI service validation failed:', error);
      return false;
    }
  }

  /**
   * Get available models
   * @returns {Promise<Array<string>>} - List of available models
   */
  async getAvailableModels() {
    try {
      const groq = this._initGroq();
      const models = await groq.models.list();
      return models.data.map(model => model.id);
    } catch (error) {
      console.error('Error getting available models:', error);
      return [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant', 
        'mixtral-8x7b-32768',
        'gemma2-9b-it'
      ];
    }
  }
}

export default new AIService(); 