import { ChromaClient } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';
import vextService from './vextService.js';

class VectorService {
  constructor() {
    this.client = new ChromaClient({
      path: process.env.CHROMA_URL || 'http://localhost:8000'
    });
    this.collection = null;
    this.collectionName = 'vext_rag_documents';
  }

  /**
   * Initialize the vector database and collection
   */
  async initialize() {
    try {
      console.log('Initializing vector database...');
      
      // Try to get existing collection first
      try {
        this.collection = await this.client.getCollection({
          name: this.collectionName
        });
        console.log(`✅ Connected to existing collection: ${this.collectionName}`);
      } catch (getError) {
        // Collection doesn't exist, create it
        console.log(`Creating new collection: ${this.collectionName}`);
        this.collection = await this.client.createCollection({
          name: this.collectionName,
          metadata: {
            description: 'Vext RAG System Document Collection',
            created_at: new Date().toISOString()
          }
        });
        console.log(`✅ Vector database initialized with new collection: ${this.collectionName}`);
      }

      return true;
    } catch (error) {
      console.error('Error initializing vector database:', error);
      
      // If there's a schema conflict, try to reset the collection
      if (error.message.includes('schema') || error.message.includes('422') || error.message.includes('Unprocessable')) {
        console.log('🔄 Attempting to reset collection due to schema conflict...');
        try {
          await this.resetCollection();
          return true;
        } catch (resetError) {
          console.error('Failed to reset collection:', resetError);
        }
      }
      
      throw new Error(`Failed to initialize vector database: ${error.message}`);
    }
  }

  /**
   * Reset the collection (delete and recreate)
   * @returns {Promise<boolean>} - Success status
   */
  async resetCollection() {
    try {
      console.log('🔄 Resetting vector database collection...');
      
      // Try to delete existing collection
      try {
        await this.client.deleteCollection({ name: this.collectionName });
        console.log(`🗑️ Deleted existing collection: ${this.collectionName}`);
      } catch (deleteError) {
        console.log('Collection does not exist or already deleted');
      }
      
      // Create new collection
      this.collection = await this.client.createCollection({
        name: this.collectionName,
        metadata: {
          description: 'Vext RAG System Document Collection',
          created_at: new Date().toISOString(),
          reset_at: new Date().toISOString()
        }
      });
      
      console.log(`✅ Collection reset successfully: ${this.collectionName}`);
      return true;
    } catch (error) {
      console.error('Error resetting collection:', error);
      throw new Error(`Failed to reset collection: ${error.message}`);
    }
  }

  /**
   * Add documents to the vector database
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to add
   * @returns {Promise<Array<string>>} - Array of document IDs
   */
  async addDocuments(documents) {
    try {
      return await this._addDocumentsInternal(documents);
    } catch (error) {
      // If we get a 422 error, try resetting the collection and retrying once
      if (error.message.includes('422') || error.message.includes('Unprocessable Entity')) {
        console.log('🔄 Received 422 error, attempting to reset collection and retry...');
        try {
          await this.resetCollection();
          console.log('✅ Collection reset successful, retrying document addition...');
          return await this._addDocumentsInternal(documents);
        } catch (retryError) {
          console.error('❌ Retry after collection reset failed:', retryError);
          throw new Error(`Failed to add documents after collection reset: ${retryError.message}`);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Internal method to add documents to the vector database
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to add
   * @returns {Promise<Array<string>>} - Array of document IDs
   */
  async _addDocumentsInternal(documents) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      console.log(`Adding ${documents.length} documents to vector database...`);

      // Extract texts for embedding
      const texts = documents.map(doc => doc.text);
      
      // Generate embeddings using Vext with batching for large datasets
      console.log(`Generating embeddings for ${texts.length} text chunks...`);
      const embeddings = await this.generateEmbeddingsInBatches(texts);
      console.log(`✅ Successfully generated ${embeddings.length} embeddings`);

      // Prepare data for ChromaDB
      const ids = documents.map(() => uuidv4());
      const metadatas = documents.map(doc => doc.metadata || {});

      // Add to collection in batches if large dataset
      if (documents.length > 100) {
        console.log(`📦 Adding documents in batches due to large size (${documents.length} documents)`);
        await this.addDocumentsInBatches(ids, embeddings, texts, metadatas);
      } else {
        // Add to collection all at once for smaller datasets
        await this.collection.add({
          ids: ids,
          embeddings: embeddings,
          documents: texts,
          metadatas: metadatas
        });
      }

      console.log(`✅ Successfully added ${documents.length} documents to vector database`);
      return ids;
    } catch (error) {
      console.error('Error adding documents to vector database:', error);
      throw new Error(`Failed to add documents: ${error.message}`);
    }
  }

  /**
   * Generate embeddings in batches to avoid timeouts
   * @param {Array<string>} texts - Texts to embed
   * @param {number} batchSize - Size of each batch
   * @returns {Promise<Array<Array<number>>>} - Array of embedding vectors
   */
  async generateEmbeddingsInBatches(texts, batchSize = 50) {
    const allEmbeddings = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(texts.length / batchSize);
      
      console.log(`🔄 Processing embedding batch ${batchNumber}/${totalBatches} (${batch.length} items)...`);
      
      try {
        const batchEmbeddings = await vextService.generateEmbeddings(batch);
        allEmbeddings.push(...batchEmbeddings);
        
        // Small delay between batches to be nice to the API
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`❌ Failed to generate embeddings for batch ${batchNumber}:`, error);
        throw new Error(`Embedding generation failed at batch ${batchNumber}: ${error.message}`);
      }
    }
    
    return allEmbeddings;
  }

  /**
   * Add documents to ChromaDB in batches
   * @param {Array<string>} ids - Document IDs
   * @param {Array<Array<number>>} embeddings - Embeddings
   * @param {Array<string>} texts - Document texts
   * @param {Array<Object>} metadatas - Document metadata
   * @param {number} batchSize - Size of each batch
   */
  async addDocumentsInBatches(ids, embeddings, texts, metadatas, batchSize = 100) {
    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);
      const batchEmbeddings = embeddings.slice(i, i + batchSize);
      const batchTexts = texts.slice(i, i + batchSize);
      const batchMetadatas = metadatas.slice(i, i + batchSize);
      
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(ids.length / batchSize);
      
      console.log(`📦 Adding batch ${batchNumber}/${totalBatches} to vector database (${batchIds.length} documents)...`);
      
      // Validate data before sending to ChromaDB
      const validationResult = this.validateBatchData(batchIds, batchEmbeddings, batchTexts, batchMetadatas);
      if (!validationResult.valid) {
        throw new Error(`Batch validation failed: ${validationResult.error}`);
      }
      
      try {
        await this.collection.add({
          ids: batchIds,
          embeddings: batchEmbeddings,
          documents: batchTexts,
          metadatas: batchMetadatas
        });
        
        console.log(`✅ Batch ${batchNumber}/${totalBatches} added successfully`);
        
        // Small delay between batches
        if (i + batchSize < ids.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        console.error(`❌ Failed to add batch ${batchNumber} to vector database:`, error);
        console.error(`🔍 Batch data debug info:`, {
          batchSize: batchIds.length,
          embeddingDimensions: batchEmbeddings[0]?.length,
          sampleId: batchIds[0],
          sampleTextLength: batchTexts[0]?.length,
          sampleMetadata: batchMetadatas[0]
        });
        
        // Log first few items for detailed debugging
        console.error(`🔍 Detailed debug - First 3 items:`, {
          ids: batchIds.slice(0, 3),
          textSamples: batchTexts.slice(0, 3).map(t => ({
            length: t?.length,
            isEmpty: !t || t.trim() === '',
            type: typeof t,
            sample: t?.substring(0, 100)
          })),
          metadataSamples: batchMetadatas.slice(0, 3),
          embeddingSamples: batchEmbeddings.slice(0, 3).map(e => ({
            length: e?.length,
            hasNaN: e?.some(val => isNaN(val)),
            hasInfinity: e?.some(val => !isFinite(val)),
            first5: e?.slice(0, 5)
          }))
        });
        
        throw new Error(`Vector database insertion failed at batch ${batchNumber}: ${error.message}`);
      }
    }
  }

  /**
   * Validate batch data before sending to ChromaDB
   * @param {Array<string>} ids - Document IDs
   * @param {Array<Array<number>>} embeddings - Embeddings
   * @param {Array<string>} texts - Document texts
   * @param {Array<Object>} metadatas - Document metadata
   * @returns {Object} - Validation result
   */
  validateBatchData(ids, embeddings, texts, metadatas) {
    // Check array lengths match
    if (ids.length !== embeddings.length || ids.length !== texts.length || ids.length !== metadatas.length) {
      return {
        valid: false,
        error: `Array length mismatch: ids(${ids.length}), embeddings(${embeddings.length}), texts(${texts.length}), metadatas(${metadatas.length})`
      };
    }

    // Check for empty or invalid data
    for (let i = 0; i < ids.length; i++) {
      // Validate ID
      if (!ids[i] || typeof ids[i] !== 'string' || ids[i].trim() === '') {
        return { valid: false, error: `Invalid ID at index ${i}: ${ids[i]}` };
      }

      // Validate embedding
      if (!embeddings[i] || !Array.isArray(embeddings[i]) || embeddings[i].length === 0) {
        return { valid: false, error: `Invalid embedding at index ${i}` };
      }

      // Check for NaN values in embeddings
      if (embeddings[i].some(val => isNaN(val) || !isFinite(val))) {
        return { valid: false, error: `Invalid embedding values (NaN or Infinity) at index ${i}` };
      }

      // Validate text
      if (typeof texts[i] !== 'string') {
        return { valid: false, error: `Invalid text type at index ${i}: ${typeof texts[i]}` };
      }

      // Check for empty text (ChromaDB might reject empty documents)
      if (texts[i].trim() === '') {
        console.warn(`⚠️ Empty text found at index ${i}, replacing with placeholder`);
        texts[i] = '[Empty document content]';
      }

      // Validate metadata
      if (metadatas[i] && typeof metadatas[i] !== 'object') {
        return { valid: false, error: `Invalid metadata type at index ${i}: ${typeof metadatas[i]}` };
      }

      // Clean metadata to remove any problematic values
      if (metadatas[i]) {
        metadatas[i] = this.cleanMetadata(metadatas[i]);
      }
    }

    console.log(`✅ Batch validation passed for ${ids.length} documents`);
    return { valid: true };
  }

  /**
   * Clean metadata to ensure ChromaDB compatibility
   * @param {Object} metadata - Original metadata
   * @returns {Object} - Cleaned metadata
   */
  cleanMetadata(metadata) {
    const cleaned = {};
    
    for (const [key, value] of Object.entries(metadata)) {
      // Skip null, undefined, or function values
      if (value === null || value === undefined || typeof value === 'function') {
        continue;
      }

      // Convert non-primitive values to strings
      if (typeof value === 'object' && !Array.isArray(value)) {
        cleaned[key] = JSON.stringify(value);
      } else if (Array.isArray(value)) {
        // Convert arrays to strings
        cleaned[key] = value.join(', ');
      } else if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        // Keep primitive values as-is
        cleaned[key] = value;
      } else {
        // Convert anything else to string
        cleaned[key] = String(value);
      }
    }
    
    return cleaned;
  }

  /**
   * Search for similar documents
   * @param {string} query - Search query
   * @param {number} topK - Number of results to return
   * @param {Object} filter - Optional metadata filter
   * @param {number} minSimilarity - Minimum similarity threshold (0-1)
   * @returns {Promise<Array<{id: string, text: string, metadata: Object, distance: number, similarity: number}>>} - Search results
   */
  async search(query, topK = 5, filter = null, minSimilarity = 0) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      console.log(`Searching for: "${query}"`);

      // Generate query embedding
      const queryEmbedding = await vextService.embedText(query);

      // Search in collection
      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where: filter
      });

      // Format results and calculate similarity scores
      const formattedResults = results.ids[0].map((id, index) => {
        const distance = results.distances[0][index];
        // Convert distance to similarity score (1 - distance)
        const similarity = 1 - distance;
        
        return {
          id: id,
          text: results.documents[0][index],
          metadata: results.metadatas[0][index],
          distance: distance,
          similarity: similarity
        };
      });

      // Filter by minimum similarity if specified
      const filteredResults = minSimilarity > 0 
        ? formattedResults.filter(result => result.similarity >= minSimilarity)
        : formattedResults;

      console.log(`✅ Found ${filteredResults.length} relevant documents (filtered from ${formattedResults.length})`);
      return filteredResults;
    } catch (error) {
      console.error('Error searching vector database:', error);
      throw new Error(`Failed to search documents: ${error.message}`);
    }
  }

  /**
   * Get all documents in the collection
   * @returns {Promise<Array<{id: string, text: string, metadata: Object}>>} - All documents
   */
  async getAllDocuments() {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      const results = await this.collection.get();
      
      return results.ids.map((id, index) => ({
        id: id,
        text: results.documents[index],
        metadata: results.metadatas[index]
      }));
    } catch (error) {
      console.error('Error getting all documents:', error);
      throw new Error(`Failed to get documents: ${error.message}`);
    }
  }

  /**
   * Delete a document by ID
   * @param {string} documentId - Document ID to delete
   * @returns {Promise<boolean>} - Success status
   */
  async deleteDocument(documentId) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      await this.collection.delete({
        ids: [documentId]
      });

      console.log(`✅ Successfully deleted document: ${documentId}`);
      return true;
    } catch (error) {
      console.error('Error deleting document:', error);
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  }

  /**
   * Update document metadata
   * @param {string} documentId - Document ID to update
   * @param {Object} metadata - New metadata
   * @returns {Promise<boolean>} - Success status
   */
  async updateDocumentMetadata(documentId, metadata) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      await this.collection.update({
        ids: [documentId],
        metadatas: [metadata]
      });

      console.log(`✅ Successfully updated metadata for document: ${documentId}`);
      return true;
    } catch (error) {
      console.error('Error updating document metadata:', error);
      throw new Error(`Failed to update document metadata: ${error.message}`);
    }
  }

  /**
   * Get collection statistics
   * @returns {Promise<Object>} - Collection statistics
   */
  async getCollectionStats() {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      const count = await this.collection.count();
      
      return {
        totalDocuments: count,
        collectionName: this.collectionName,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting collection stats:', error);
      throw new Error(`Failed to get collection stats: ${error.message}`);
    }
  }

  /**
   * Clear all documents from the collection
   * @returns {Promise<boolean>} - Success status
   */
  async clearCollection() {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      console.log('🔄 Starting collection clear...');

      // Try a simpler approach first - delete the entire collection and recreate it
      try {
        console.log('🗑️ Attempting to delete entire collection...');
        await this.client.deleteCollection({
          name: this.collectionName
        });
        console.log('✅ Collection deleted successfully');
        
        // Recreate the collection
        console.log('🔄 Recreating collection...');
        this.collection = await this.client.createCollection({
          name: this.collectionName,
          metadata: {
            description: 'Vext RAG System Document Collection',
            created_at: new Date().toISOString()
          }
        });
        
        console.log('✅ Collection recreated successfully');
        return true;
        
      } catch (deleteError) {
        console.log('⚠️ Could not delete entire collection, trying batch deletion...');
        
        // Fallback to batch deletion if collection deletion fails
        const count = await this.collection.count();
        console.log(`📊 Found ${count} documents to clear`);

        if (count > 0) {
          // Use smaller batches and add delays to prevent overwhelming the database
          const batchSize = 100;
          let offset = 0;
          let totalDeleted = 0;

          while (offset < count) {
            try {
              const batch = await this.collection.get({
                limit: batchSize,
                offset: offset
              });

              if (batch.ids && batch.ids.length > 0) {
                await this.collection.delete({
                  ids: batch.ids
                });
                totalDeleted += batch.ids.length;
                console.log(`🗑️ Deleted batch of ${batch.ids.length} documents (${totalDeleted}/${count})`);
                
                // Add a small delay between batches to prevent overwhelming the database
                await new Promise(resolve => setTimeout(resolve, 100));
              }

              offset += batchSize;
            } catch (batchError) {
              console.error(`❌ Error deleting batch at offset ${offset}:`, batchError);
              throw batchError;
            }
          }
        }

        console.log('✅ Successfully cleared all documents from collection');
        return true;
      }
    } catch (error) {
      console.error('❌ Error clearing collection:', error);
      throw new Error(`Failed to clear collection: ${error.message}`);
    }
  }
}

export default new VectorService(); 