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

      // Prepare context text with better formatting
      const contextText = context.map((doc, index) => 
        `=== Document ${index + 1} ===
Content: ${doc.text}
Metadata: ${JSON.stringify(doc.metadata || {}, null, 2)}
---`
      ).join('\n\n');

      // Create the prompt
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

      // Generate response using OpenAI
      const openai = this._initOpenAI();
      const response = await openai.chat.completions.create({
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: options.maxTokens || parseInt(process.env.AI_MAX_TOKENS) || 1000,
        temperature: options.temperature || parseFloat(process.env.AI_TEMPERATURE) || 0.3,
        top_p: options.topP || 1,
        frequency_penalty: options.frequencyPenalty || 0,
        presence_penalty: options.presencePenalty || 0
      });

      const answer = response.choices[0].message.content;

      // Extract sources from context
      const sources = context.map(doc => ({
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
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
        tokens: response.usage?.total_tokens || 0
      };
    } catch (error) {
      console.error('Error generating answer:', error);
      // Return a structured error response instead of throwing
      return {
        answer: `Error: ${error.message}`,
        sources: [],
        confidence: 0,
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
        tokens: 0
      };
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
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
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
        model: options.model || process.env.AI_MODEL || 'gpt-4o-mini',
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
        model: process.env.AI_MODEL || 'gpt-4o-mini',
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