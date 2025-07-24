import OpenAI from 'openai';

class AIService {
  constructor() {
    this.openai = null;
  }

  /**
   * Initialize OpenAI client lazily
   */
  _initOpenAI() {
    if (!this.openai) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is missing or empty');
      }
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
    return this.openai;
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
      const maxTokens = options.maxTokens || parseInt(process.env.AI_MAX_TOKENS) || 1000;
      const truncatedContext = this.truncateContext(context, question, maxTokens);
      
      console.log(`📊 Context stats: ${context.length} documents -> ${truncatedContext.documents.length} documents (${truncatedContext.estimatedTokens} estimated tokens)`);

      // Prepare context text with better formatting
      const contextText = truncatedContext.documents.map((doc, index) => 
        `=== Document ${index + 1} ===
Content: ${doc.text}
Metadata: ${JSON.stringify(doc.metadata || {}, null, 2)}
---`
      ).join('\n\n');

      // Create the prompt with token-aware sizing
      const systemPrompt = `You are a helpful AI assistant that answers questions based on the provided context. 

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

Guidelines:
- Provide accurate and relevant answers based on the context
- Be concise but comprehensive
- If you're unsure about something, acknowledge the uncertainty but still provide what you can from the context
- Look for indirect answers - if someone asks about "executive AI" but the context has "AI-powered meeting assistant" or similar, use that information

Context:
${contextText}

Please answer the following question based on the context provided. If you find relevant information, use it and cite the document number:`;

      const userPrompt = `Question: ${question}

Please provide a detailed answer using the information from the provided context. If you find relevant information, even if it's not an exact match, use it and cite the specific document number(s).

For pricing questions: If the exact product name isn't found but you see pricing for similar services (like "meeting bot" when asked about "executive AI"), use that information and explain the connection.`;

      // Generate response using OpenAI with retry logic for rate limits
      const openai = this._initOpenAI();
      
      const response = await this.makeOpenAIRequestWithRetry(() => 
        openai.chat.completions.create({
          model: 'gpt-4o-mini',
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
        model: 'gpt-4o-mini',
        tokens: response.usage?.total_tokens || 0,
        contextTruncated: truncatedContext.wasTruncated,
        documentsUsed: truncatedContext.documents.length,
        totalDocumentsAvailable: context.length
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
        model: 'gpt-4o-mini',
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
        model: 'gpt-4o-mini',
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
    
    // Get model context limits - hardcoded to gpt-4o-mini
    const model = 'gpt-4o-mini';
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
   * Get the context length limit for different models
   * @param {string} model - Model name
   * @returns {number} - Context length limit in tokens
   */
  getModelContextLimit(model) {
    const limits = {
      'gpt-3.5-turbo': 16385,
      'gpt-3.5-turbo-16k': 16385,
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4-turbo-preview': 128000
    };
    
    return limits[model] || 16385; // Default to GPT-3.5-turbo limit
  }

  /**
   * Make OpenAI request with retry logic for rate limits
   * @param {Function} requestFn - Function that makes the OpenAI request
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise} - OpenAI response
   */
  async makeOpenAIRequestWithRetry(requestFn, maxRetries = 2) {
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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: options.maxTokens || parseInt(process.env.AI_MAX_TOKENS) || 500,
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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: options.maxTokens || parseInt(process.env.AI_MAX_TOKENS) || 300,
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
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not configured');
      }

      // Test with a simple completion
      const openai = this._initOpenAI();
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
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
      const openai = this._initOpenAI();
      const models = await openai.models.list();
      return models.data
        .filter(model => model.id.includes('gpt'))
        .map(model => model.id);
    } catch (error) {
      console.error('Error getting available models:', error);
      return ['gpt-4o-mini', 'gpt-4', 'gpt-4-turbo-preview'];
    }
  }
}

export default new AIService(); 