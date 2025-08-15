import { pipeline } from '@xenova/transformers';

class HuggingFaceEmbeddingService {
  constructor() {
    this.pipeline = null;
    this.modelName = 'Xenova/all-MiniLM-L6-v2';
    this.dimensions = 384; // all-MiniLM-L6-v2 produces 384-dimensional embeddings
  }

  /**
   * Initialize the embedding pipeline lazily
   */
  async _initPipeline() {
    if (!this.pipeline) {
      console.log(`🤗 Loading Hugging Face model: ${this.modelName}...`);
      try {
        this.pipeline = await pipeline('feature-extraction', this.modelName, {
          // Cache the model locally to avoid re-downloading
          cache_dir: './models'
        });
        console.log(`✅ Successfully loaded ${this.modelName}`);
      } catch (error) {
        console.error(`❌ Failed to load ${this.modelName}:`, error);
        throw new Error(`Failed to initialize Hugging Face model: ${error.message}`);
      }
    }
    return this.pipeline;
  }

  /**
   * Generate embeddings for text using Hugging Face model
   * @param {string|string[]} text - Text or array of texts to embed
   * @returns {Promise<number[][]>} - Array of embedding vectors
   */
  async generateEmbeddings(text) {
    try {
      const texts = Array.isArray(text) ? text : [text];
      
      console.log(`🔄 Generating embeddings for ${texts.length} text chunks using ${this.modelName}...`);
      
      const pipeline = await this._initPipeline();
      
      // Process texts in batches to manage memory
      const batchSize = 32; // Reasonable batch size for local processing
      const embeddings = [];
      
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(texts.length / batchSize);
        
        console.log(`   Processing batch ${batchNumber}/${totalBatches} (${batch.length} texts)...`);
        
        try {
          // Generate embeddings for the batch
          const batchEmbeddings = await pipeline(batch, {
            pooling: 'mean',
            normalize: true
          });
          
          // Convert tensor to regular arrays - Xenova returns tensors with .data and .dims properties
          let processedEmbeddings;
          
          if (batchEmbeddings && batchEmbeddings.data && batchEmbeddings.dims) {
            // This is a tensor from Xenova
            const [batchSize, embeddingDim] = batchEmbeddings.dims;
            const data = Array.from(batchEmbeddings.data);
            
            processedEmbeddings = [];
            for (let i = 0; i < batchSize; i++) {
              const start = i * embeddingDim;
              const end = start + embeddingDim;
              processedEmbeddings.push(data.slice(start, end));
            }
          } else if (Array.isArray(batchEmbeddings)) {
            // Already an array of embeddings
            processedEmbeddings = batchEmbeddings.map(emb => Array.from(emb));
          } else {
            // Fallback for other formats
            processedEmbeddings = [Array.from(batchEmbeddings)];
          }
          
          embeddings.push(...processedEmbeddings);
          
        } catch (batchError) {
          console.error(`❌ Error processing batch ${batchNumber}:`, batchError);
          throw new Error(`Failed to generate embeddings for batch ${batchNumber}: ${batchError.message}`);
        }
      }

      console.log(`✅ Successfully generated ${embeddings.length} embeddings (${this.dimensions}D)`);
      
      // Validate embedding dimensions
      if (embeddings.length > 0 && embeddings[0].length !== this.dimensions) {
        console.warn(`⚠️ Unexpected embedding dimension: got ${embeddings[0].length}, expected ${this.dimensions}`);
      }
      
      return embeddings;
    } catch (error) {
      console.error('❌ Error generating embeddings:', error);
      
      // Provide more specific error messages
      if (error.message.includes('model')) {
        throw new Error(`Model loading failed: ${error.message}`);
      } else if (error.message.includes('memory') || error.message.includes('OOM')) {
        throw new Error(`Out of memory. Try reducing batch size or text length: ${error.message}`);
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
   * Validate if the embedding service is properly configured
   * @returns {Promise<boolean>} - True if service is ready
   */
  async validateService() {
    try {
      // Test with a simple embedding
      const testEmbedding = await this.embedText('test');
      return testEmbedding && testEmbedding.length === this.dimensions;
    } catch (error) {
      console.error('Hugging Face embedding service validation failed:', error);
      return false;
    }
  }

  /**
   * Get embedding dimensions for the current model
   * @returns {number} - Embedding dimension
   */
  getEmbeddingDimensions() {
    return this.dimensions;
  }

  /**
   * Get model information
   * @returns {Object} - Model information
   */
  getModelInfo() {
    return {
      name: this.modelName,
      dimensions: this.dimensions,
      type: 'sentence-transformer',
      provider: 'huggingface'
    };
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.pipeline) {
      // Clean up pipeline resources if needed
      this.pipeline = null;
      console.log('🧹 Cleaned up Hugging Face embedding service');
    }
  }
}

export default new HuggingFaceEmbeddingService();
