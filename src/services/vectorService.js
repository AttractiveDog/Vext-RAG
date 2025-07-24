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
      
      // Create or get collection
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
        metadata: {
          description: 'Vext RAG System Document Collection',
          created_at: new Date().toISOString()
        }
      });

      console.log(`✅ Vector database initialized with collection: ${this.collectionName}`);
      return true;
    } catch (error) {
      console.error('Error initializing vector database:', error);
      throw new Error(`Failed to initialize vector database: ${error.message}`);
    }
  }

  /**
   * Add documents to the vector database
   * @param {Array<{text: string, metadata: Object}>} documents - Documents to add
   * @returns {Promise<Array<string>>} - Array of document IDs
   */
  async addDocuments(documents) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      console.log(`Adding ${documents.length} documents to vector database...`);

      // Extract texts for embedding
      const texts = documents.map(doc => doc.text);
      
      // Generate embeddings using Vext
      const embeddings = await vextService.generateEmbeddings(texts);

      // Prepare data for ChromaDB
      const ids = documents.map(() => uuidv4());
      const metadatas = documents.map(doc => doc.metadata || {});

      // Add to collection
      await this.collection.add({
        ids: ids,
        embeddings: embeddings,
        documents: texts,
        metadatas: metadatas
      });

      console.log(`✅ Successfully added ${documents.length} documents to vector database`);
      return ids;
    } catch (error) {
      console.error('Error adding documents to vector database:', error);
      throw new Error(`Failed to add documents: ${error.message}`);
    }
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