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

      // Search in user-specific collection
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
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

      console.log(`✅ Found ${formattedResults.length} relevant emails for user: ${userID}`);
      return formattedResults;
    } catch (error) {
      console.error(`❌ Error searching emails for user ${userID}:`, error);
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
        console.log(`📭 No emails to clear for user: ${userID}`);
        return true;
      }

      // Delete all emails for this user
      const emailIds = emails.map(email => email.id);
      await collection.delete({
        ids: emailIds
      });

      console.log(`✅ Successfully cleared ${emailIds.length} emails for user: ${userID}`);
      return true;
    } catch (error) {
      console.error(`❌ Error clearing emails for user ${userID}:`, error);
      throw new Error(`Failed to clear emails for user ${userID}: ${error.message}`);
    }
  }

  /**
   * Validate and clean email documents
   * @param {Array} emailDocuments - Email documents to validate
   * @param {string} userID - User ID for data isolation
   * @returns {Array} - Cleaned email documents
   */
  validateAndCleanEmailDocuments(emailDocuments, userID) {
    return emailDocuments.map((doc, index) => {
      // Validate document structure
      if (!doc || typeof doc !== 'object') {
        throw new Error(`Invalid email document at index ${index}: must be an object`);
      }

      if (!doc.text || typeof doc.text !== 'string') {
        throw new Error(`Invalid text at index ${index}: must be a non-empty string`);
      }

      if (!doc.metadata || typeof doc.metadata !== 'object') {
        throw new Error(`Invalid metadata at index ${index}: must be an object`);
      }

      // Clean and validate text
      let cleanedText = doc.text.trim();
      if (cleanedText.length === 0) {
        cleanedText = '[Empty email content]';
      }

      // Limit text length
      if (cleanedText.length > 100000) {
        console.warn(`⚠️ Truncating long email text at index ${index} (${cleanedText.length} chars)`);
        cleanedText = cleanedText.substring(0, 100000);
      }

      // Ensure required metadata fields
      const metadata = {
        ...doc.metadata,
        document_type: 'email'
      };

      // Ensure userID is present for data isolation
      if (!metadata.userID && userID) {
        metadata.userID = userID;
      }

      // Ensure email_id exists
      if (!metadata.email_id) {
        metadata.email_id = `email_${index}_${Date.now()}`;
      }

      // Ensure document_id exists
      if (!metadata.document_id) {
        metadata.document_id = uuidv4();
      }

      return {
        text: cleanedText,
        metadata: metadata
      };
    });
  }

  /**
   * Generate embeddings in batches
   * @param {Array<string>} texts - Texts to embed
   * @param {number} batchSize - Batch size
   * @returns {Promise<Array>} - Embeddings
   */
  async generateEmbeddingsInBatches(texts, batchSize = 50) {
    const allEmbeddings = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(texts.length / batchSize);
      
      console.log(`🔄 Processing email embedding batch ${batchNumber}/${totalBatches} (${batch.length} items)...`);
      
      try {
        const batchEmbeddings = await vextService.generateEmbeddings(batch);
        allEmbeddings.push(...batchEmbeddings);
        
        // Small delay between batches
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`❌ Failed to generate embeddings for email batch ${batchNumber}:`, error);
        throw new Error(`Email embedding generation failed at batch ${batchNumber}: ${error.message}`);
      }
    }
    
    return allEmbeddings;
  }

  /**
   * Check email vector database health
   * @returns {Promise<Object>} - Health status
   */
  async checkHealth() {
    try {
      console.log('🔍 Checking email vector database health...');
      
      // Test basic connection
      const collections = await this.client.listCollections();
      console.log(`✅ Email vector database connection healthy`);
      
      // Count email collections (user-specific collections)
      const emailCollections = collections.filter(col => 
        col && col.name && col.name.startsWith(this.baseCollectionName)
      );
      
      return {
        healthy: true,
        totalCollections: collections.length,
        emailCollections: emailCollections.length,
        baseCollectionName: this.baseCollectionName,
        userCollectionPattern: `${this.baseCollectionName}_[userID]`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Email vector database health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Advanced email search with multiple criteria
   * @param {Object} searchParams - Search parameters
   * @param {string} userID - User ID for data isolation (required)
   * @returns {Promise<Array>} - Search results
   */
  async advancedEmailSearch(searchParams, userID) {
    try {
      if (!userID) {
        throw new Error('userID is required for email data isolation');
      }

      const {
        query,
        sender_email,
        sender_domain,
        date_from,
        date_to,
        has_attachments,
        subject_contains,
        topK = 10
      } = searchParams;

      let filters = {};

      // Add filters based on parameters
      if (sender_email) {
        filters.sender_email = sender_email;
      }

      if (sender_domain) {
        filters.sender_domain = sender_domain;
      }

      if (has_attachments !== undefined) {
        filters.has_attachments = has_attachments;
      }

      // For date filtering, we might need to implement custom logic
      // as ChromaDB's filtering capabilities vary

      // Perform the search
      const results = await this.searchEmails(query, userID, topK, filters);

      // Additional client-side filtering if needed
      let filteredResults = results;

      // Filter by subject if specified
      if (subject_contains) {
        filteredResults = filteredResults.filter(email => 
          email.metadata.subject && 
          email.metadata.subject.toLowerCase().includes(subject_contains.toLowerCase())
        );
      }

      // Filter by date range if specified
      if (date_from || date_to) {
        filteredResults = filteredResults.filter(email => {
          const emailDate = new Date(email.metadata.time_received);
          let matchesRange = true;

          if (date_from) {
            matchesRange = matchesRange && emailDate >= new Date(date_from);
          }

          if (date_to) {
            matchesRange = matchesRange && emailDate <= new Date(date_to);
          }

          return matchesRange;
        });
      }

      console.log(`🔍 Advanced search found ${filteredResults.length} emails for user: ${userID}`);
      return filteredResults;
    } catch (error) {
      console.error(`❌ Error in advanced email search for user ${userID}:`, error);
      throw new Error(`Advanced email search failed for user ${userID}: ${error.message}`);
    }
  }
}

export default new EmailVectorService();
