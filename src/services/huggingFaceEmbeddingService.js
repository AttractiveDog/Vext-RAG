import { pipeline } from '@xenova/transformers';

class HuggingFaceEmbeddingService {
  constructor() {
    this.pipeline = null;
    this.modelName = 'Xenova/all-MiniLM-L6-v2';
    this.dimensions = 384; // all-MiniLM-L6-v2 produces 384-dimensional embeddings
    this.maxRetries = 3;
    this.batchSize = 10; // Optimized batch size for performance and memory balance
    this.isEC2 = process.env.EC2_INSTANCE || process.env.AWS_REGION || false;
    this.memoryThresholdMB = 1200; // Memory threshold for cleanup (1.2GB)
    this.consecutiveMemoryChecks = 0;
  }

  /**
   * Initialize the embedding pipeline lazily with EC2 optimizations
   */
  async _initPipeline() {
    if (!this.pipeline) {
      console.log(`🤗 Loading Hugging Face model: ${this.modelName}...`);
      console.log(`🖥️ Running on EC2: ${this.isEC2 ? 'Yes' : 'No'}`);
      
      try {
        const pipelineOptions = {
          // Cache the model locally to avoid re-downloading
          cache_dir: './models',
          // Add memory optimization options
          quantized: true,
          progress_callback: (progress) => {
            if (progress.status === 'progress') {
              console.log(`📊 Model loading progress: ${Math.round(progress.progress * 100)}%`);
            }
          }
        };

        // Add EC2-specific optimizations
        if (this.isEC2) {
          pipelineOptions.backend = 'cpu'; // Force CPU backend for stability
          console.log('🖥️ Using CPU backend for EC2 stability');
        }

        this.pipeline = await pipeline('feature-extraction', this.modelName, pipelineOptions);
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
      let totalProcessed = 0;

      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize);
        const batchNumber = Math.floor(i / this.batchSize) + 1;
        const totalBatches = Math.ceil(texts.length / this.batchSize);

        console.log(`   Processing batch ${batchNumber}/${totalBatches} (${batch.length} texts)...`);

        // Add retry logic for each batch
        const batchEmbeddings = await this._processBatchWithRetry(pipeline, batch, batchNumber);
        embeddings.push(...batchEmbeddings);
        totalProcessed += batchEmbeddings.length;

        // Enhanced memory monitoring and cleanup
        const shouldMonitorMemory = batchNumber % 3 === 0 || totalProcessed >= 25;
        if (shouldMonitorMemory) {
          const memory = this.getMemoryUsage();
          console.log(`📊 Memory after batch ${batchNumber}: RSS=${memory.rss}MB, ArrayBuffers=${memory.arrayBuffers}MB`);

          // Check for memory pressure
          if (memory.rss > this.memoryThresholdMB) {
            this.consecutiveMemoryChecks++;
            console.warn(`⚠️ High memory usage detected (${memory.rss}MB > ${this.memoryThresholdMB}MB), count: ${this.consecutiveMemoryChecks}`);

            if (this.consecutiveMemoryChecks >= 2) {
              console.log('🔄 Triggering aggressive memory cleanup...');
              await this._forceMemoryCleanup();
              await this._cleanupPipeline();
              await this._initPipeline();
              this.consecutiveMemoryChecks = 0;
            }
          } else {
            this.consecutiveMemoryChecks = 0;
          }
        }

        // Adaptive delay based on memory usage - optimized for 8-item batches
        const memory = this.getMemoryUsage();
        let delay = 200; // Base delay optimized for performance

        if (memory.rss > 1000) {
          delay = 500; // Longer delay for high memory
        } else if (memory.arrayBuffers > 10) {
          delay = 300; // Medium delay for buffer accumulation
        }

        if (i + this.batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Periodic aggressive cleanup for large processing
        if (totalProcessed >= 50 && batchNumber % 5 === 0) {
          await this._forceMemoryCleanup();
        }

        // Reset counter for periodic cleanup
        if (totalProcessed >= 100) {
          totalProcessed = 0;
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
   * Process a batch with retry logic and enhanced memory management
   * @param {Object} pipeline - The model pipeline
   * @param {Array<string>} batch - Batch of texts to process
   * @param {number} batchNumber - Current batch number for logging
   * @returns {Promise<Array<Array<number>>>} - Batch embeddings
   */
  async _processBatchWithRetry(pipeline, batch, batchNumber) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      let batchEmbeddings = null;
      let processedEmbeddings = null;

      try {
        // Generate embeddings for the batch
        batchEmbeddings = await pipeline(batch, {
          pooling: 'mean',
          normalize: true
        });

        // Convert tensor to regular arrays - Xenova returns tensors with .data and .dims properties
        if (batchEmbeddings && batchEmbeddings.data && batchEmbeddings.dims) {
          // This is a tensor from Xenova
          const [batchSize, embeddingDim] = batchEmbeddings.dims;

          processedEmbeddings = [];

          // Process each embedding individually to minimize memory footprint
          for (let i = 0; i < batchSize; i++) {
            const start = i * embeddingDim;
            const end = start + embeddingDim;

            // Create individual Float32Array for each embedding and convert to regular array
            const embeddingData = new Float32Array(batchEmbeddings.data.slice(start, end));
            processedEmbeddings.push(Array.from(embeddingData));

            // Clear the temporary array reference
            embeddingData.fill(0);
          }

          // CRITICAL: Tensor cleanup after processing all embeddings
          this._cleanupTensor(batchEmbeddings);

        } else if (Array.isArray(batchEmbeddings)) {
          // Already an array of embeddings
          processedEmbeddings = batchEmbeddings.map(emb => {
            // Ensure we create new arrays, not references
            return Array.isArray(emb) ? [...emb] : Array.from(emb);
          });
        } else {
          // Fallback for other formats
          processedEmbeddings = [Array.from(batchEmbeddings)];
        }

        // Validate the processed embeddings
        this._validateEmbeddings(processedEmbeddings, batchNumber);

        // Force aggressive garbage collection after processing
        await this._forceMemoryCleanup();

        // Clear local references
        batchEmbeddings = null;

        return processedEmbeddings;

      } catch (batchError) {
        lastError = batchError;
        console.error(`❌ Error processing batch ${batchNumber} (attempt ${attempt}/${this.maxRetries}):`, batchError.message);

        // Clean up any partial results
        if (batchEmbeddings) {
          this._cleanupTensor(batchEmbeddings);
          batchEmbeddings = null;
        }
        processedEmbeddings = null;

        if (attempt < this.maxRetries) {
          // Aggressive cleanup before retry
          await this._forceMemoryCleanup();

          // Longer retry delay for EC2
          const retryDelay = this.isEC2 ? 5000 : 2000;
          console.log(`🔄 Retrying batch ${batchNumber} in ${retryDelay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));

          // Try to reinitialize the pipeline if it seems corrupted
          if (batchError.message.includes('model') || batchError.message.includes('pipeline')) {
            console.log(`🔄 Reinitializing pipeline for batch ${batchNumber}...`);
            await this._cleanupPipeline();
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
   * Comprehensive tensor cleanup to prevent memory leaks
   * @private
   * @param {Object} tensor - The tensor object to clean up
   */
  _cleanupTensor(tensor) {
    if (!tensor) return;

    try {
      // Dispose of tensor if it has a dispose method (Xenova specific)
      if (typeof tensor.dispose === 'function') {
        tensor.dispose();
        return; // If dispose() works, that's the best cleanup
      }

      // For Xenova tensors that don't have dispose, try safe cleanup
      // Avoid direct property manipulation on proxy objects
      if (tensor && typeof tensor === 'object') {
        // Try to access properties safely
        try {
          if (tensor.data && tensor.data.buffer) {
            // If it's a typed array, we can try to clear the buffer
            if (tensor.data.constructor && tensor.data.constructor.name.includes('Array')) {
              tensor.data.fill(0); // Clear the array data
            }
          }
        } catch (e) {
          // Ignore buffer access errors
        }
      }

    } catch (error) {
      // Only log if it's not a proxy-related error
      if (!error.message.includes('proxy') && !error.message.includes('trap')) {
        console.warn('⚠️ Error during tensor cleanup:', error.message);
      }
    }
  }

  /**
   * Force aggressive memory cleanup
   * @private
   */
  async _forceMemoryCleanup() {
    // Force garbage collection multiple times
    if (global.gc) {
      global.gc();
      // Small delay to let GC complete
      await new Promise(resolve => setTimeout(resolve, 10));
      global.gc();
      await new Promise(resolve => setTimeout(resolve, 10));
      global.gc();
    }

    // Clear any cached references in the pipeline if it exists
    if (this.pipeline && this.pipeline.model && this.pipeline.model.cache) {
      try {
        this.pipeline.model.cache.clear();
      } catch (e) {
        // Ignore cache clearing errors
      }
    }
  }

  /**
   * Clean up pipeline resources to prevent memory leaks
   * @private
   */
  async _cleanupPipeline() {
    if (this.pipeline) {
      try {
        // Dispose of pipeline resources if the method exists
        if (typeof this.pipeline.dispose === 'function') {
          await this.pipeline.dispose();
        }

        // Clear all pipeline-related properties
        if (this.pipeline.model) {
          this.pipeline.model = null;
        }
        if (this.pipeline.tokenizer) {
          this.pipeline.tokenizer = null;
        }
        if (this.pipeline.processor) {
          this.pipeline.processor = null;
        }

        // Clear the pipeline reference
        this.pipeline = null;

        console.log('🧹 Cleaned up Hugging Face pipeline resources');
      } catch (error) {
        console.warn('⚠️ Error during pipeline cleanup:', error.message);
        // Force clear the pipeline even if cleanup fails
        this.pipeline = null;
      }
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    await this._cleanupPipeline();

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
