import OpenAI from 'openai';

class VextService {
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
   * Generate embeddings for text using OpenAI
   * @param {string|string[]} text - Text or array of texts to embed
   * @returns {Promise<number[][]>} - Array of embedding vectors
   */
  async generateEmbeddings(text) {
    try {
      const texts = Array.isArray(text) ? text : [text];
      
      console.log(`Generating embeddings for ${texts.length} text chunks...`);
      
      const openai = this._initOpenAI();
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Embedding generation timed out after 60 seconds for batch of ${texts.length} texts`));
        }, 60000); // 60 second timeout
      });
      
      const embeddingPromise = openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: texts
      });
      
      const response = await Promise.race([embeddingPromise, timeoutPromise]);
      const embeddings = response.data.map(item => item.embedding);

      console.log(`Successfully generated ${embeddings.length} embeddings`);
      return embeddings;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      
      // Provide more specific error messages
      if (error.message.includes('timeout')) {
        throw new Error(`Embedding generation timed out. Try reducing batch size or check network connection.`);
      } else if (error.message.includes('rate limit')) {
        throw new Error(`OpenAI API rate limit exceeded. Please wait and try again.`);
      } else if (error.message.includes('quota')) {
        throw new Error(`OpenAI API quota exceeded. Please check your usage limits.`);
      } else {
        throw new Error(`Failed to generate embeddings: ${error.message}`);
      }
    }
  }

  /**
   * Generate embeddings for a single text chunk
   * @param {string} text - Text to embed
   * @returns {Promise<number[]>} - Embedding vector
   */
  async embedText(text) {
    const embeddings = await this.generateEmbeddings([text]);
    return embeddings[0];
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {number[]} vectorA - First vector
   * @param {number[]} vectorB - Second vector
   * @returns {number} - Cosine similarity score
   */
  calculateSimilarity(vectorA, vectorB) {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Find most similar vectors using cosine similarity
   * @param {number[]} queryVector - Query vector
   * @param {Array<{id: string, vector: number[], text: string}>} vectors - Array of vectors to search
   * @param {number} topK - Number of top results to return
   * @returns {Array<{id: string, similarity: number, text: string}>} - Top similar vectors
   */
  findSimilarVectors(queryVector, vectors, topK = 5) {
    const similarities = vectors.map(({ id, vector, text }) => ({
      id,
      similarity: this.calculateSimilarity(queryVector, vector),
      text
    }));

    // Sort by similarity (descending) and return top K
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Validate if the Vext service is properly configured
   * @returns {Promise<boolean>} - True if service is ready
   */
  async validateService() {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not configured');
      }

      // Test with a simple embedding
      const testEmbedding = await this.embedText('test');
      return testEmbedding && testEmbedding.length > 0;
    } catch (error) {
      console.error('Vext service validation failed:', error);
      return false;
    }
  }

  /**
   * Get embedding dimensions for the current model
   * @returns {Promise<number>} - Embedding dimension
   */
  async getEmbeddingDimensions() {
    try {
      const testEmbedding = await this.embedText('test');
      return testEmbedding.length;
    } catch (error) {
      console.error('Error getting embedding dimensions:', error);
      return 1536; // Default dimension for text-embedding-ada-002
    }
  }
}

export default new VextService(); 