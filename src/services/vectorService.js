import { ChromaClient } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';
import vextService from './vextService.js';

class VectorService {
  constructor() {
    this.client = new ChromaClient({
      path: process.env.CHROMA_URL || 'http://3.6.147.238:8000'
    });
    this.collection = null;
    this.collectionName = 'vext_rag_documents';
  }

  /**
   * Initialize the vector database and collection
   */
  /**
 * Initialize the vector database and collection
 */
async initialize() {
  try {
    console.log('Initializing vector database...');
    
    // First, check if collection already exists
    try {
      const collections = await this.client.listCollections();
      const existingCollection = collections.find(col => col.name === this.collectionName);
      
      if (existingCollection) {
        // Collection exists, get it
        this.collection = await this.client.getCollection({
          name: this.collectionName
        });
        console.log(`✅ Connected to existing collection: ${this.collectionName}`);
        return true;
      }
    } catch (listError) {
      console.log('Could not list collections, will attempt to get/create collection directly');
    }
    
    // Try to get existing collection first
    try {
      this.collection = await this.client.getCollection({
        name: this.collectionName
      });
      console.log(`✅ Connected to existing collection: ${this.collectionName}`);
      return true;
    } catch (getError) {
      // Collection doesn't exist, try to create it
      console.log(`Collection doesn't exist, creating new collection: ${this.collectionName}`);
      
      try {
        this.collection = await this.client.createCollection({
          name: this.collectionName,
          metadata: {
            description: 'Vext RAG System Document Collection',
            created_at: new Date().toISOString()
          }
        });
        console.log(`✅ Vector database initialized with new collection: ${this.collectionName}`);
        return true;
      } catch (createError) {
        // If creation fails due to existing collection (race condition)
        if (createError.message.includes('already exists') || createError.message.includes('UniqueError')) {
          console.log(`Collection was created by another process, connecting to it...`);
          try {
            this.collection = await this.client.getCollection({
              name: this.collectionName
            });
            console.log(`✅ Connected to collection after race condition: ${this.collectionName}`);
            return true;
          } catch (finalError) {
            throw new Error(`Failed to connect to collection after race condition: ${finalError.message}`);
          }
        }
        throw createError;
      }
    }
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
   * Add documents with enhanced error handling for 422 errors
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to add
   * @returns {Promise<Array<string>>} - Array of document IDs
   */
  async addDocuments(documents) {
    try {
      return await this._addDocumentsInternal(documents);
    } catch (error) {
      // Handle 422 errors specifically
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
      }
      
      throw error;
    }
  }

  /**
   * Validate and clean documents before processing
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to validate
   * @returns {Array<{text: string, metadata: Object}>} - Cleaned documents
   */
  validateAndCleanDocuments(documents) {
    if (!Array.isArray(documents)) {
      throw new Error('Documents must be an array');
    }

    if (documents.length === 0) {
      throw new Error('Documents array cannot be empty');
    }

    const cleanedDocuments = documents.map((doc, index) => {
      // Validate document structure
      if (!doc || typeof doc !== 'object') {
        throw new Error(`Invalid document at index ${index}: must be an object`);
      }

      if (!doc.text || typeof doc.text !== 'string') {
        throw new Error(`Invalid text at index ${index}: must be a non-empty string`);
      }

      // Clean and validate text
      let cleanedText = doc.text.trim();
      if (cleanedText.length === 0) {
        cleanedText = '[Empty document content]';
      }

      // Limit text length to prevent ChromaDB issues
      if (cleanedText.length > 100000) {
        console.warn(`⚠️ Truncating long text at index ${index} (${cleanedText.length} chars)`);
        cleanedText = cleanedText.substring(0, 100000);
      }

      // Clean metadata
      const cleanedMetadata = doc.metadata ? this.cleanMetadata(doc.metadata) : {};

      return {
        text: cleanedText,
        metadata: cleanedMetadata
      };
    });

    console.log(`✅ Validated and cleaned ${cleanedDocuments.length} documents`);
    return cleanedDocuments;
  }

  /**
   * Add documents with enhanced error handling for 422 errors
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to add
   * @returns {Promise<Array<string>>} - Array of document IDs
   */
  async addDocumentsWithRetry(documents) {
    // Validate and clean documents first
    const cleanedDocuments = this.validateAndCleanDocuments(documents);
    
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${maxRetries} to add documents...`);
        return await this._addDocumentsInternal(cleanedDocuments);
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);

        if (error.message.includes('422') || error.message.includes('Unprocessable Entity')) {
          if (attempt < maxRetries) {
            console.log('🔄 422 error detected, resetting collection and retrying...');
            try {
              await this.resetCollection();
              // Wait a bit before retrying
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (resetError) {
              console.error('Failed to reset collection:', resetError);
            }
          }
        } else {
          // For non-422 errors, don't retry
          break;
        }
      }
    }

    throw new Error(`Failed to add documents after ${maxRetries} attempts: ${lastError.message}`);
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

      // Extract text content and metadata
      const texts = documents.map(doc => doc.text);
      const metadatas = documents.map(doc => doc.metadata || {});

      // Generate embeddings
      console.log(`Generating embeddings for ${texts.length} text chunks...`);
      const embeddings = await this.generateEmbeddingsInBatches(texts);

      // Prepare data for ChromaDB
      const ids = documents.map(() => uuidv4());

      // Add to collection in batches if large dataset
      if (documents.length > 100) {
        console.log(`📦 Adding documents in batches due to large size (${documents.length} documents)`);
        await this.addDocumentsInBatches(ids, embeddings, texts, metadatas);
      } else {
        // Validate data before sending to ChromaDB
        const validationResult = this.validateBatchData(ids, embeddings, texts, metadatas);
        if (!validationResult.valid) {
          throw new Error(`Data validation failed: ${validationResult.error}`);
        }

        // Add to collection all at once for smaller datasets
        console.log(`📤 Sending ${documents.length} documents to ChromaDB...`);
        console.log(`📊 Data summary: IDs=${ids.length}, Embeddings=${embeddings.length}, Texts=${texts.length}, Metadata=${metadatas.length}`);
        
        // Log sample data for debugging
        if (documents.length > 0) {
          console.log(`🔍 Sample data - ID: ${ids[0].substring(0, 20)}..., Text length: ${texts[0].length}, Embedding dims: ${embeddings[0].length}`);
        }

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
      
      // Provide more specific error information for 422 errors
      if (error.message.includes('422') || error.message.includes('Unprocessable Entity')) {
        console.error('🔍 422 Error Details:');
        console.error('  - This usually indicates invalid data format or schema mismatch');
        console.error('  - Check that all arrays have the same length');
        console.error('  - Verify that embeddings are valid numeric arrays');
        console.error('  - Ensure metadata values are compatible with ChromaDB');
        
        // Try to provide more debugging info
        if (documents && documents.length > 0) {
          console.error('  - Sample document structure:', {
            hasText: !!documents[0].text,
            textLength: documents[0].text?.length,
            hasMetadata: !!documents[0].metadata,
            metadataKeys: documents[0].metadata ? Object.keys(documents[0].metadata) : []
          });
        }
      }
      
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
        error: `Array length mismatch: ids(${ids.length}), embeddings(${embeddings.length}), texts(${ids.length}), metadatas(${metadatas.length})`
      };
    }

    // Check for empty or invalid data
    for (let i = 0; i < ids.length; i++) {
      // Validate ID
      if (!ids[i] || typeof ids[i] !== 'string' || ids[i].trim() === '') {
        return { valid: false, error: `Invalid ID at index ${i}: ${ids[i]}` };
      }

      // Ensure ID is not too long (ChromaDB has limits)
      if (ids[i].length > 1000) {
        ids[i] = ids[i].substring(0, 1000);
        console.warn(`⚠️ Truncated long ID at index ${i}`);
      }

      // Validate embedding
      if (!embeddings[i] || !Array.isArray(embeddings[i]) || embeddings[i].length === 0) {
        return { valid: false, error: `Invalid embedding at index ${i}` };
      }

      // Check for NaN values in embeddings
      if (embeddings[i].some(val => isNaN(val) || !isFinite(val))) {
        return { valid: false, error: `Invalid embedding values (NaN or Infinity) at index ${i}` };
      }

      // Ensure embedding dimensions are reasonable (OpenAI ada-002 has 1536 dimensions)
      if (embeddings[i].length > 2000) {
        console.warn(`⚠️ Large embedding dimension at index ${i}: ${embeddings[i].length}`);
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

      // Ensure text is not too long (ChromaDB has limits)
      if (texts[i].length > 100000) {
        console.warn(`⚠️ Truncating long text at index ${i} (${texts[i].length} chars)`);
        texts[i] = texts[i].substring(0, 100000);
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

      // Ensure key is a string and not too long
      const cleanKey = String(key).substring(0, 100);
      
      // Convert non-primitive values to strings
      if (typeof value === 'object' && !Array.isArray(value)) {
        try {
          cleaned[cleanKey] = JSON.stringify(value).substring(0, 1000);
        } catch (e) {
          cleaned[cleanKey] = '[Complex Object]';
        }
      } else if (Array.isArray(value)) {
        // Convert arrays to strings, limit length
        cleaned[cleanKey] = value.join(', ').substring(0, 1000);
      } else if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        // Keep primitive values as-is, but limit string length
        if (typeof value === 'string') {
          cleaned[cleanKey] = value.substring(0, 1000);
        } else {
          cleaned[cleanKey] = value;
        }
      } else {
        // Convert anything else to string
        cleaned[cleanKey] = String(value).substring(0, 1000);
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
   * @param {string} userId - User ID to filter by (optional)
   * @returns {Promise<Array<{id: string, text: string, metadata: Object}>>} - All documents
   */
  async getAllDocuments(userId = null) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      let results;
      if (userId) {
        // Filter by user ID
        results = await this.collection.get({
          where: { userId: userId }
        });
      } else {
        // Get all documents
        results = await this.collection.get();
      }
      
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
   * Get all documents grouped by parent document
   * @param {string} userId - User ID to filter by (optional)
   * @returns {Promise<Array<{documentId: string, originalFilename: string, fileType: string, totalChunks: number, totalWords: number, totalCharacters: number, processedAt: string, chunks: Array}>>} - Grouped documents
   */
  async getGroupedDocuments(userId = null) {
    try {
      const allChunks = await this.getAllDocuments(userId);
      
      // Group chunks by parent document
      const documentGroups = {};
      
      allChunks.forEach(chunk => {
        const parentDocId = chunk.metadata.documentId || chunk.metadata.parentDocumentId;
        const originalFilename = chunk.metadata.originalFilename || chunk.metadata.filename || 'Unknown Document';
        
        if (!documentGroups[parentDocId]) {
          documentGroups[parentDocId] = {
            documentId: parentDocId,
            originalFilename: originalFilename,
            fileType: chunk.metadata.fileType || 'Unknown',
            totalChunks: 0,
            totalWords: 0,
            totalCharacters: 0,
            processedAt: chunk.metadata.processedAt,
            chunks: []
          };
        }
        
        documentGroups[parentDocId].chunks.push({
          id: chunk.id,
          text: chunk.text,
          chunkIndex: chunk.metadata.chunkIndex || 0,
          chunkNumber: chunk.metadata.chunkNumber || 1,
          wordCount: chunk.metadata.wordCount || chunk.text.split(/\s+/).length,
          characterCount: chunk.text.length
        });
        
        documentGroups[parentDocId].totalChunks++;
        documentGroups[parentDocId].totalWords += chunk.metadata.wordCount || chunk.text.split(/\s+/).length;
        documentGroups[parentDocId].totalCharacters += chunk.text.length;
      });

      // Convert to array and sort by processing time
      return Object.values(documentGroups)
        .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));
    } catch (error) {
      console.error('Error getting grouped documents:', error);
      throw new Error(`Failed to get grouped documents: ${error.message}`);
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
   * @param {string} userId - User ID to filter by (optional)
   * @returns {Promise<Object>} - Collection statistics
   */
  async getCollectionStats(userId = null) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      let count;
      if (userId) {
        // Get count for specific user
        const userDocuments = await this.getAllDocuments(userId);
        count = userDocuments.length;
      } else {
        // Get total count
        count = await this.collection.count();
      }
      
      return {
        totalDocuments: count,
        collectionName: this.collectionName,
        lastUpdated: new Date().toISOString(),
        userId: userId || 'all'
      };
    } catch (error) {
      console.error('Error getting collection stats:', error);
      throw new Error(`Failed to get collection stats: ${error.message}`);
    }
  }

  /**
   * Clear all documents from the collection
   * @param {string} userId - User ID to clear documents for (optional, clears all if not provided)
   * @returns {Promise<boolean>} - Success status
   */
  async clearCollection(userId = null) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      if (userId) {
        console.log(`🔄 Starting collection clear for user: ${userId}...`);
        
        // Get documents for specific user
        const userDocuments = await this.getAllDocuments(userId);
        console.log(`📊 Found ${userDocuments.length} documents to clear for user: ${userId}`);

        if (userDocuments.length > 0) {
          // Delete user-specific documents
          const documentIds = userDocuments.map(doc => doc.id);
          await this.collection.delete({
            ids: documentIds
          });
          console.log(`✅ Successfully cleared ${userDocuments.length} documents for user: ${userId}`);
        }
        
        return true;
      } else {
        console.log('🔄 Starting collection clear for all users...');

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
      }
    } catch (error) {
      console.error('❌ Error clearing collection:', error);
      throw new Error(`Failed to clear collection: ${error.message}`);
    }
  }

  /**
   * Check ChromaDB connection health
   * @returns {Promise<Object>} - Health status
   */
  async checkHealth() {
    try {
      console.log('🔍 Checking ChromaDB connection health...');
      
      // Test basic connection
      const collections = await this.client.listCollections();
      console.log(`✅ ChromaDB connection healthy. Found ${collections.length} collections`);
      
      // Check if our collection exists
      let collectionExists = false;
      try {
        await this.client.getCollection({ name: this.collectionName });
        collectionExists = true;
        console.log(`✅ Collection '${this.collectionName}' exists`);
      } catch (error) {
        console.log(`⚠️ Collection '${this.collectionName}' does not exist`);
      }
      
      return {
        healthy: true,
        collections: collections.length,
        targetCollectionExists: collectionExists,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ ChromaDB health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get detailed collection information
   * @returns {Promise<Object>} - Collection details
   */
  async getCollectionDetails() {
    try {
      if (!this.collection) {
        await this.initialize();
      }
      
      const count = await this.collection.count();
      console.log(`📊 Collection '${this.collectionName}' has ${count} documents`);
      
      return {
        name: this.collectionName,
        documentCount: count,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting collection details:', error);
      throw new Error(`Failed to get collection details: ${error.message}`);
    }
  }

  /**
   * Add document chunks with proper parent document relationships
   * @param {Array<{text: string, metadata: Object}>} chunks - Document chunks to add
   * @param {string} parentDocumentId - ID of the parent document
   * @returns {Promise<Array<string>>} - Array of chunk IDs
   */
  async addDocumentChunks(chunks, parentDocumentId) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      console.log(`📄 Adding ${chunks.length} chunks for parent document: ${parentDocumentId}`);

      // Validate and clean chunks
      const cleanedChunks = this.validateAndCleanDocuments(chunks);
      
      // Generate embeddings for all chunks
      const texts = cleanedChunks.map(chunk => chunk.text);
      console.log(`Generating embeddings for ${texts.length} chunks...`);
      const embeddings = await this.generateEmbeddingsInBatches(texts);

      // Generate unique IDs for each chunk
      const chunkIds = cleanedChunks.map((_, index) => `${parentDocumentId}_chunk_${index}`);
      
      // Prepare metadata with proper relationships
      const metadatas = cleanedChunks.map((chunk, index) => ({
        ...chunk.metadata,
        parentDocumentId: parentDocumentId,
        chunkId: chunkIds[index],
        chunkNumber: index + 1,
        isChunk: true
      }));

      // Validate the batch data
      const validationResult = this.validateBatchData(chunkIds, embeddings, texts, metadatas);
      if (!validationResult.valid) {
        throw new Error(`Chunk validation failed: ${validationResult.error}`);
      }

      // Add chunks to collection
      console.log(`📤 Adding ${chunks.length} chunks to ChromaDB...`);
      await this.collection.add({
        ids: chunkIds,
        embeddings: embeddings,
        documents: texts,
        metadatas: metadatas
      });

      console.log(`✅ Successfully added ${chunks.length} chunks for document: ${parentDocumentId}`);
      return chunkIds;
    } catch (error) {
      console.error('Error adding document chunks:', error);
      throw new Error(`Failed to add document chunks: ${error.message}`);
    }
  }

  /**
   * Search for documents and group results by parent document
   * @param {string} query - Search query
   * @param {number} topK - Number of results to return
   * @param {Object} filter - Optional metadata filter
   * @param {number} minSimilarity - Minimum similarity threshold (0-1)
   * @returns {Promise<Array<{documentId: string, chunks: Array, totalScore: number}>>} - Grouped search results
   */
  async searchDocuments(query, topK = 5, filter = null, minSimilarity = 0) {
    try {
      // Combine user filter with existing filter
      let combinedFilter = filter;
      if (filter && filter.userId) {
        combinedFilter = { ...filter };
      } else if (filter) {
        combinedFilter = { ...filter };
      } else {
        combinedFilter = {};
      }
      
      // First, search for individual chunks
      const chunkResults = await this.search(query, topK * 3, combinedFilter, minSimilarity);
      
      // Group results by parent document
      const documentGroups = {};
      
      chunkResults.forEach(result => {
        const parentDocId = result.metadata.parentDocumentId || result.metadata.documentId;
        if (!documentGroups[parentDocId]) {
          documentGroups[parentDocId] = {
            documentId: parentDocId,
            originalFilename: result.metadata.originalFilename || 'Unknown',
            chunks: [],
            totalScore: 0,
            chunkCount: 0
          };
        }
        
        documentGroups[parentDocId].chunks.push({
          id: result.id,
          text: result.text,
          similarity: result.similarity,
          chunkIndex: result.metadata.chunkIndex,
          chunkNumber: result.metadata.chunkNumber
        });
        
        documentGroups[parentDocId].totalScore += result.similarity;
        documentGroups[parentDocId].chunkCount++;
      });
      
      // Convert to array and sort by total score
      const groupedResults = Object.values(documentGroups)
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, topK);
      
      console.log(`📄 Found ${groupedResults.length} relevant documents from ${chunkResults.length} chunks`);
      return groupedResults;
    } catch (error) {
      console.error('Error searching documents:', error);
      throw new Error(`Failed to search documents: ${error.message}`);
    }
  }
}

export default new VectorService(); 