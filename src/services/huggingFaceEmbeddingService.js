import { pipeline } from '@xenova/transformers';

class HuggingFaceEmbeddingService {
  constructor() {
    this.pipeline = null;
    this.modelName = 'Xenova/all-MiniLM-L6-v2';
    this.dimensions = 384; // all-MiniLM-L6-v2 produces 384-dimensional embeddings
    this.maxRetries = 3;
    this.batchSize = 16; // Reduced batch size to prevent memory issues
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
          cache_dir: './models',
          // Add memory optimization options
          quantized: true,
          progress_callback: (progress) => {
            if (progress.status === 'progress') {
              console.log(`📊 Model loading progress: ${Math.round(progress.progress * 100)}%`);
            }
          }
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
   * Generate embeddings for text using Hugging Face model with enhanced error handling
   * @param {string|string[]} text - Text or array of texts to embed
   * @returns {Promise<number[][]>} - Array of embedding vectors
   */
  async generateEmbeddings(text) {
    try {
      const texts = Array.isArray(text) ? text : [text];
      
      console.log(`🔄 Generating embeddings for ${texts.length} text chunks using ${this.modelName}...`);
      this.logMemoryUsage('Before embedding generation');
      
      const pipeline = await this._initPipeline();
      
      // Process texts in smaller batches to manage memory
      const embeddings = [];
      
      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize);
        const batchNumber = Math.floor(i / this.batchSize) + 1;
        const totalBatches = Math.ceil(texts.length / this.batchSize);
        
        console.log(`   Processing batch ${batchNumber}/${totalBatches} (${batch.length} texts)...`);
        
        // Add retry logic for each batch
        const batchEmbeddings = await this._processBatchWithRetry(pipeline, batch, batchNumber);
        embeddings.push(...batchEmbeddings);
        
        // Log memory usage every 5 batches
        if (batchNumber % 5 === 0) {
          this.logMemoryUsage(`After batch ${batchNumber}`);
        }
        
        // Add a small delay between batches to allow memory cleanup
        if (i + this.batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      console.log(`✅ Successfully generated ${embeddings.length} embeddings (${this.dimensions}D)`);
      this.logMemoryUsage('After embedding generation');
      
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
   * Process a batch with retry logic
   * @param {Object} pipeline - The model pipeline
   * @param {Array<string>} batch - Batch of texts to process
   * @param {number} batchNumber - Current batch number for logging
   * @returns {Promise<Array<Array<number>>>} - Batch embeddings
   */
  async _processBatchWithRetry(pipeline, batch, batchNumber) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
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
        
        // Validate the processed embeddings
        this._validateEmbeddings(processedEmbeddings, batchNumber);
        
        return processedEmbeddings;
        
      } catch (batchError) {
        lastError = batchError;
        console.error(`❌ Error processing batch ${batchNumber} (attempt ${attempt}/${this.maxRetries}):`, batchError.message);
        
        if (attempt < this.maxRetries) {
          console.log(`🔄 Retrying batch ${batchNumber} in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Try to reinitialize the pipeline if it seems corrupted
          if (batchError.message.includes('model') || batchError.message.includes('pipeline')) {
            console.log(`🔄 Reinitializing pipeline for batch ${batchNumber}...`);
            this.pipeline = null;
            await this._initPipeline();
          }
        }
      }
    }
    
    throw new Error(`Failed to generate embeddings for batch ${batchNumber} after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Validate embeddings to ensure they are properly formatted
   * @param {Array<Array<number>>} embeddings - Embeddings to validate
   * @param {number} batchNumber - Batch number for logging
   */
  _validateEmbeddings(embeddings, batchNumber) {
    if (!Array.isArray(embeddings)) {
      throw new Error(`Invalid embeddings format for batch ${batchNumber}: expected array, got ${typeof embeddings}`);
    }
    
    for (let i = 0; i < embeddings.length; i++) {
      const embedding = embeddings[i];
      
      if (!Array.isArray(embedding)) {
        throw new Error(`Invalid embedding at index ${i} in batch ${batchNumber}: expected array, got ${typeof embedding}`);
      }
      
      if (embedding.length !== this.dimensions) {
        throw new Error(`Invalid embedding dimension at index ${i} in batch ${batchNumber}: expected ${this.dimensions}, got ${embedding.length}`);
      }
      
      // Check for NaN or Infinity values
      for (let j = 0; j < embedding.length; j++) {
        if (isNaN(embedding[j]) || !isFinite(embedding[j])) {
          throw new Error(`Invalid embedding value at index ${i}, position ${j} in batch ${batchNumber}: ${embedding[j]}`);
        }
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
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log('🧹 Forced garbage collection');
    }
  }

  /**
   * Get current memory usage information
   * @returns {Object} - Memory usage stats
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024), // Resident Set Size in MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // Total heap size in MB
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // Used heap size in MB
      external: Math.round(usage.external / 1024 / 1024), // External memory in MB
      arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024) // Array buffers in MB
    };
  }

  /**
   * Log memory usage with a label
   * @param {string} label - Label for the memory log
   */
  logMemoryUsage(label = 'Current') {
    const memory = this.getMemoryUsage();
    console.log(`📊 ${label} Memory Usage:`, {
      RSS: `${memory.rss} MB`,
      HeapTotal: `${memory.heapTotal} MB`,
      HeapUsed: `${memory.heapUsed} MB`,
      External: `${memory.external} MB`,
      ArrayBuffers: `${memory.arrayBuffers} MB`
    });
  }
}

export default new HuggingFaceEmbeddingService();
