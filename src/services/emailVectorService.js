import { ChromaClient } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';
import vextService from './vextService.js';

class EmailVectorService {
  constructor() {
    this.client = new ChromaClient({
      path: process.env.CHROMA_URL || 'http://3.6.147.238:8000'
    });
    this.collections = new Map(); // Store user-specific collections
    this.baseCollectionName = 'email_rag';
  }

  /**
   * Get user-specific collection name
   * @param {string} userID - User ID for data isolation
   * @returns {string} - User-specific collection name
   */
  getUserCollectionName(userID) {
    // Sanitize userID for collection name (ChromaDB collection names have restrictions)
    const sanitizedUserID = userID.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${this.baseCollectionName}_${sanitizedUserID}`;
  }

  /**
   * Initialize user-specific email vector database collection
   * @param {string} userID - User ID for data isolation
   */
  async initializeUserCollection(userID) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      const collectionName = this.getUserCollectionName(userID);
      
      // Check if we already have this collection cached
      if (this.collections.has(userID)) {
        console.log(`✅ Using cached email collection for user: ${userID}`);
        return this.collections.get(userID);
      }

      console.log(`🔄 Initializing email vector database for user: ${userID}...`);
      
      // Check if collection exists
      try {
        const collections = await this.client.listCollections();
        const existingCollection = collections.find(col => col.name === collectionName);
        
        if (existingCollection) {
          const collection = await this.client.getCollection({
            name: collectionName
          });
          this.collections.set(userID, collection);
          console.log(`✅ Connected to existing email collection for user ${userID}: ${collectionName}`);
          return collection;
        }
      } catch (listError) {
        console.log('Could not list collections, will attempt to get/create collection directly');
      }
      
      // Try to get existing collection
      try {
        const collection = await this.client.getCollection({
          name: collectionName
        });
        this.collections.set(userID, collection);
        console.log(`✅ Connected to existing email collection for user ${userID}: ${collectionName}`);
        return collection;
      } catch (getError) {
        // Collection doesn't exist, create it
        console.log(`Creating new email collection for user ${userID}: ${collectionName}`);
        
        try {
          const collection = await this.client.createCollection({
            name: collectionName,
            metadata: {
              description: `Email RAG System Collection for User ${userID}`,
              document_type: 'email',
              userID: userID,
              created_at: new Date().toISOString()
            }
          });
          this.collections.set(userID, collection);
          console.log(`✅ Email vector database initialized for user ${userID}: ${collectionName}`);
          return collection;
        } catch (createError) {
          if (createError.message.includes('already exists') || createError.message.includes('UniqueError')) {
            console.log(`Email collection was created by another process, connecting...`);
            const collection = await this.client.getCollection({
              name: collectionName
            });
            this.collections.set(userID, collection);
            console.log(`✅ Connected to email collection after race condition for user ${userID}: ${collectionName}`);
            return collection;
          }
          throw createError;
        }
      }
    } catch (error) {
      console.error(`❌ Error initializing email vector database for user ${userID}:`, error);
      throw new Error(`Failed to initialize email vector database for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Add emails to the vector database
   * @param {Array<{text: string, metadata: Object}>} emailDocuments - Email documents to add
   * @param {string} userID - User ID for data isolation (required)
   * @returns {Promise<Array<string>>} - Array of document IDs
   */
  async addEmails(emailDocuments, userID) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      if (!Array.isArray(emailDocuments) || emailDocuments.length === 0) {
        throw new Error('Email documents must be a non-empty array');
      }

      // Get user-specific collection
      const collection = await this.initializeUserCollection(userID);

      console.log(`📧 Adding ${emailDocuments.length} emails to vector database for user: ${userID}...`);

      // Validate and clean email documents
      const cleanedDocuments = this.validateAndCleanEmailDocuments(emailDocuments, userID);
      
      // Extract text content for embedding generation
      const texts = cleanedDocuments.map(doc => doc.text);
      
      // Generate embeddings for all email texts
      console.log(`🔄 Generating embeddings for ${texts.length} emails...`);
      const embeddings = await this.generateEmbeddingsInBatches(texts);

      // Generate unique IDs for each email
      const emailIds = cleanedDocuments.map(doc => 
        doc.metadata.document_id || `email_${uuidv4()}`
      );
      
      // Prepare metadata for ChromaDB (userID already included in cleaned documents)
      const metadatas = cleanedDocuments.map(doc => ({
        ...doc.metadata,
        document_type: 'email',
        indexed_at: new Date().toISOString()
      }));

      // Add to user-specific ChromaDB collection
      await collection.add({
        ids: emailIds,
        embeddings: embeddings,
        documents: texts,
        metadatas: metadatas
      });

      console.log(`✅ Successfully added ${emailDocuments.length} emails to vector database for user: ${userID}`);
      return emailIds;
    } catch (error) {
      console.error(`❌ Error adding emails to vector database for user ${userID}:`, error);
      throw new Error(`Failed to add emails for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Search emails using semantic search
   * @param {string} query - Search query
   * @param {string} userID - User ID for data isolation (required)
   * @param {number} topK - Number of results to return
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} - Search results
   */
  async searchEmails(query, userID, topK = 5, filters = {}) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      // Get user-specific collection
      const collection = await this.initializeUserCollection(userID);

      console.log(`🔍 Searching emails for user ${userID}: "${query}"`);

      // Generate query embedding
      const queryEmbedding = await vextService.embedText(query);

      // Prepare ChromaDB filters (userID is enforced by collection isolation)
      const chromaFilters = {
        document_type: 'email',
        ...filters
      };

      // Increase search results when sender filter is applied to get better content matches
      const searchLimit = filters.sender_email ? topK * 3 : topK;

      // Search in user-specific collection
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: searchLimit,
        where: chromaFilters
      });

      // Format results
      const formattedResults = results.ids[0].map((id, index) => {
        const distance = results.distances[0][index];
        const similarity = 1 - distance;
        
        return {
          id: id,
          text: results.documents[0][index],
          metadata: results.metadatas[0][index],
          distance: distance,
          similarity: similarity,
          score: similarity
        };
      });

      // Apply content-based filtering when sender filter is used
      let filteredResults = formattedResults;
      if (filters.sender_email) {
        filteredResults = this.filterByContentRelevance(formattedResults, query, topK);
      }

      console.log(`✅ Found ${filteredResults.length} relevant emails for user: ${userID}`);
      return filteredResults;
    } catch (error) {
      console.error(`❌ Error searching emails for user ${userID}:`, error);
      throw new Error(`Failed to search emails for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Filter search results by content relevance when sender filter is applied
   * @param {Array} results - Search results
   * @param {string} query - Original search query
   * @param {number} topK - Maximum number of results to return
   * @returns {Array} - Filtered results
   */
  filterByContentRelevance(results, query, topK) {
    // Extract key terms from the query (simple approach)
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => 
      term.length > 2 && !['the', 'and', 'or', 'but', 'for', 'from', 'with', 'about', 'related', 'emails'].includes(term)
    );

    // Score each result based on content relevance
    const scoredResults = results.map(result => {
      const emailText = (result.text || '').toLowerCase();
      const emailSubject = (result.metadata.subject || '').toLowerCase();
      const emailBody = (result.metadata.body || '').toLowerCase();
      
      let contentScore = 0;
      let termMatches = 0;

      // Check for exact term matches in subject and body
      queryTerms.forEach(term => {
        const subjectMatches = (emailSubject.match(new RegExp(term, 'g')) || []).length;
        const bodyMatches = (emailBody.match(new RegExp(term, 'g')) || []).length;
        const textMatches = (emailText.match(new RegExp(term, 'g')) || []).length;
        
        if (subjectMatches > 0 || bodyMatches > 0 || textMatches > 0) {
          termMatches++;
          // Weight subject matches higher than body matches
          contentScore += (subjectMatches * 3) + (bodyMatches * 1) + (textMatches * 1);
        }
      });

      // Calculate final score combining semantic similarity and content relevance
      const finalScore = (result.similarity * 0.6) + (contentScore * 0.4);
      
      return {
        ...result,
        contentScore,
        termMatches,
        finalScore
      };
    });

    // Filter out results with no content relevance and sort by final score
    const relevantResults = scoredResults
      .filter(result => result.termMatches > 0 || result.similarity > 0.7) // Keep high similarity results even without exact term matches
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, topK);

    console.log(`🔍 Content filtering: ${results.length} -> ${relevantResults.length} relevant emails`);
    
    return relevantResults.map(result => ({
      id: result.id,
      text: result.text,
      metadata: result.metadata,
      distance: result.distance,
      similarity: result.similarity,
      score: result.finalScore
    }));
  }

  /**
   * Enhanced email search with better filtering for sender + content queries
   * @param {string} query - Search query
   * @param {string} userID - User ID for data isolation (required)
   * @param {number} topK - Number of results to return
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} - Search results
   */
  async searchEmailsWithEnhancedFiltering(query, userID, topK = 5, filters = {}) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      // Get user-specific collection
      const collection = await this.initializeUserCollection(userID);

      console.log(`🔍 Enhanced search for user ${userID}: "${query}" with filters:`, filters);

      // Generate query embedding
      const queryEmbedding = await vextService.embedText(query);

      // Prepare ChromaDB filters
      const chromaFilters = {
        document_type: 'email',
        ...filters
      };

      // Use larger search limit for better filtering
      const searchLimit = Math.max(topK * 5, 50);

      // Search in user-specific collection
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: searchLimit,
        where: chromaFilters
      });

      // Format results
      const formattedResults = results.ids[0].map((id, index) => {
        const distance = results.distances[0][index];
        const similarity = 1 - distance;
        
        return {
          id: id,
          text: results.documents[0][index],
          metadata: results.metadatas[0][index],
          distance: distance,
          similarity: similarity,
          score: similarity
        };
      });

      // Apply enhanced content filtering
      const filteredResults = this.filterByContentRelevance(formattedResults, query, topK);

      console.log(`✅ Enhanced search found ${filteredResults.length} relevant emails for user: ${userID}`);
      return filteredResults;
    } catch (error) {
      console.error(`❌ Error in enhanced email search for user ${userID}:`, error);
      throw new Error(`Failed to search emails for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Get all emails from the database
   * @param {string} userID - User ID for data isolation (required)
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} - All emails
   */
  async getAllEmails(userID, filters = {}) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      // Get user-specific collection
      const collection = await this.initializeUserCollection(userID);

      const chromaFilters = {
        document_type: 'email',
        ...filters
      };

      const results = await collection.get({
        where: chromaFilters
      });
      
      return results.ids.map((id, index) => ({
        id: id,
        text: results.documents[index],
        metadata: results.metadatas[index]
      }));
    } catch (error) {
      console.error(`❌ Error getting all emails for user ${userID}:`, error);
      throw new Error(`Failed to get emails for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Delete an email by ID
   * @param {string} emailId - Email ID to delete
   * @param {string} userID - User ID for data isolation (required)
   * @returns {Promise<boolean>} - Success status
   */
  async deleteEmail(emailId, userID) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      // Get user-specific collection
      const collection = await this.initializeUserCollection(userID);

      await collection.delete({
        ids: [emailId]
      });

      console.log(`✅ Successfully deleted email: ${emailId} for user: ${userID}`);
      return true;
    } catch (error) {
      console.error(`❌ Error deleting email for user ${userID}:`, error);
      throw new Error(`Failed to delete email for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Delete multiple emails by filters
   * @param {string} userID - User ID for data isolation (required)
   * @param {Object} filters - Filters to identify emails to delete
   * @returns {Promise<number>} - Number of emails deleted
   */
  async deleteEmailsByFilters(userID, filters = {}) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      // Get user-specific collection
      const collection = await this.initializeUserCollection(userID);

      // Get emails matching filters
      const emailsToDelete = await this.getAllEmails(userID, filters);
      
      if (emailsToDelete.length === 0) {
        console.log('📭 No emails found matching filters');
        return 0;
      }

      // Delete all matching emails
      const emailIds = emailsToDelete.map(email => email.id);
      await collection.delete({
        ids: emailIds
      });

      console.log(`✅ Successfully deleted ${emailIds.length} emails for user: ${userID}`);
      return emailIds.length;
    } catch (error) {
      console.error(`❌ Error deleting emails by filters for user ${userID}:`, error);
      throw new Error(`Failed to delete emails for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Get email collection statistics
   * @param {string} userID - User ID for data isolation (required)
   * @param {Object} filters - Optional filters
   * @returns {Promise<Object>} - Collection statistics
   */
  async getEmailStats(userID, filters = {}) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      // Get user-specific collection
      await this.initializeUserCollection(userID);

      const chromaFilters = {
        document_type: 'email',
        ...filters
      };

      // Get all emails matching filters for this user
      const emails = await this.getAllEmails(userID, chromaFilters);
      
      // Calculate statistics
      const stats = {
        totalEmails: emails.length,
        userID: userID,
        collectionName: this.getUserCollectionName(userID),
        lastUpdated: new Date().toISOString()
      };

      // Calculate additional statistics if we have emails
      if (emails.length > 0) {
        const senderDomains = new Set();
        const senders = new Set();
        let totalAttachments = 0;
        let emailsWithAttachments = 0;

        emails.forEach(email => {
          const metadata = email.metadata;
          
          if (metadata.sender_email) {
            senders.add(metadata.sender_email);
            const domain = metadata.sender_domain || metadata.sender_email.split('@')[1];
            if (domain) {
              senderDomains.add(domain);
            }
          }
          
          if (metadata.attachment_count > 0) {
            emailsWithAttachments++;
            totalAttachments += metadata.attachment_count;
          }
        });

        stats.uniqueSenders = senders.size;
        stats.uniqueDomains = senderDomains.size;
        stats.totalAttachments = totalAttachments;
        stats.emailsWithAttachments = emailsWithAttachments;
        stats.averageAttachmentsPerEmail = totalAttachments / emails.length;
      }
      
      return stats;
    } catch (error) {
      console.error(`❌ Error getting email stats for user ${userID}:`, error);
      throw new Error(`Failed to get email stats for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Clear all emails from the collection
   * @param {string} userID - User ID for data isolation (required)
   * @returns {Promise<boolean>} - Success status
   */
  async clearAllEmails(userID) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      // Get user-specific collection
      const collection = await this.initializeUserCollection(userID);

      console.log(`🔄 Clearing all emails from collection for user: ${userID}...`);
      
      // Get all email IDs for this user
      const emails = await this.getAllEmails(userID);
      
      if (emails.length === 0) {
        console.log(`📭 No emails found to clear for user: ${userID}`);
        return true;
      }

      // Delete all emails
      const emailIds = emails.map(email => email.id);
      await collection.delete({ ids: emailIds });

      console.log(`✅ Successfully cleared ${emails.length} emails for user: ${userID}`);
      return true;
    } catch (error) {
      console.error(`❌ Error clearing emails for user ${userID}:`, error);
      throw new Error(`Failed to clear emails for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Check ChromaDB connection health
   * @returns {Promise<Object>} - Health status
   */
  async checkHealth() {
    try {
      console.log('🔍 Checking email vector service health...');
      
      // Test basic connection
      const collections = await this.client.listCollections();
      console.log(`✅ ChromaDB connection healthy. Found ${collections.length} collections`);
      
      return {
        healthy: true,
        collections: collections.length,
        service: 'EmailVectorService',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Email vector service health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        service: 'EmailVectorService',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Advanced email search with comprehensive filtering
   * @param {Object} searchParams - Search parameters
   * @param {string} userID - User ID for data isolation (required)
   * @returns {Promise<Array>} - Search results
   */
  async advancedEmailSearch(searchParams, userID) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      const { query, topK = 10, filters = {} } = searchParams;

      console.log(`🔍 Advanced email search for user ${userID}: "${query}" with filters:`, filters);

      // Use enhanced filtering for better results
      return await this.searchEmailsWithEnhancedFiltering(query, userID, topK, filters);
    } catch (error) {
      console.error(`❌ Error in advanced email search for user ${userID}:`, error);
      throw new Error(`Failed to perform advanced email search for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Generate embeddings in batches to avoid memory issues
   * @param {Array<string>} texts - Array of text strings
   * @returns {Promise<Array<Array<number>>>} - Array of embeddings
   */
  async generateEmbeddingsInBatches(texts) {
    try {
      const batchSize = 10; // Process in smaller batches
      const embeddings = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        console.log(`🔄 Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (${batch.length} texts)...`);
        
        const batchEmbeddings = await vextService.generateEmbeddings(batch);
        embeddings.push(...batchEmbeddings);
      }

      console.log(`✅ Successfully generated ${embeddings.length} embeddings`);
      return embeddings;
    } catch (error) {
      console.error('❌ Error generating embeddings:', error);
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }

  /**
   * Validate and clean email documents
   * @param {Array<Object>} emailDocuments - Email documents to validate
   * @param {string} userID - User ID for data isolation
   * @returns {Array<Object>} - Cleaned email documents
   */
  validateAndCleanEmailDocuments(emailDocuments, userID) {
    return emailDocuments.map(doc => {
      // Ensure userID is included in metadata
      const cleanedMetadata = {
        ...doc.metadata,
        userID: userID,
        document_type: 'email'
      };

      // Ensure text content exists
      const text = doc.text || doc.metadata.body || doc.metadata.subject || '';

      return {
        text: text,
        metadata: cleanedMetadata
      };
    });
  }
}

export default new EmailVectorService();