import { ChromaClient } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';
import vextService from './vextService.js';

class EmailVectorService {
  constructor() {
    this.client = new ChromaClient({
      path: process.env.CHROMA_URL || 'http://3.6.147.238:8000'
    });
    this.collection = null;
    this.collectionName = 'email_rag_collection';
  }

  /**
   * Initialize the email vector database collection
   */
  async initialize() {
    try {
      console.log('🔄 Initializing email vector database...');
      
      // Check if collection exists
      try {
        const collections = await this.client.listCollections();
        const existingCollection = collections.find(col => col.name === this.collectionName);
        
        if (existingCollection) {
          this.collection = await this.client.getCollection({
            name: this.collectionName
          });
          console.log(`✅ Connected to existing email collection: ${this.collectionName}`);
          return true;
        }
      } catch (listError) {
        console.log('Could not list collections, will attempt to get/create collection directly');
      }
      
      // Try to get existing collection
      try {
        this.collection = await this.client.getCollection({
          name: this.collectionName
        });
        console.log(`✅ Connected to existing email collection: ${this.collectionName}`);
        return true;
      } catch (getError) {
        // Collection doesn't exist, create it
        console.log(`Creating new email collection: ${this.collectionName}`);
        
        try {
          this.collection = await this.client.createCollection({
            name: this.collectionName,
            metadata: {
              description: 'Email RAG System Collection',
              document_type: 'email',
              created_at: new Date().toISOString()
            }
          });
          console.log(`✅ Email vector database initialized: ${this.collectionName}`);
          return true;
        } catch (createError) {
          if (createError.message.includes('already exists') || createError.message.includes('UniqueError')) {
            console.log(`Email collection was created by another process, connecting...`);
            this.collection = await this.client.getCollection({
              name: this.collectionName
            });
            console.log(`✅ Connected to email collection after race condition: ${this.collectionName}`);
            return true;
          }
          throw createError;
        }
      }
    } catch (error) {
      console.error('❌ Error initializing email vector database:', error);
      throw new Error(`Failed to initialize email vector database: ${error.message}`);
    }
  }

  /**
   * Add emails to the vector database
   * @param {Array<{text: string, metadata: Object}>} emailDocuments - Email documents to add
   * @returns {Promise<Array<string>>} - Array of document IDs
   */
  async addEmails(emailDocuments) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      if (!Array.isArray(emailDocuments) || emailDocuments.length === 0) {
        throw new Error('Email documents must be a non-empty array');
      }

      console.log(`📧 Adding ${emailDocuments.length} emails to vector database...`);

      // Validate and clean email documents
      const cleanedDocuments = this.validateAndCleanEmailDocuments(emailDocuments);
      
      // Extract text content for embedding generation
      const texts = cleanedDocuments.map(doc => doc.text);
      
      // Generate embeddings for all email texts
      console.log(`🔄 Generating embeddings for ${texts.length} emails...`);
      const embeddings = await this.generateEmbeddingsInBatches(texts);

      // Generate unique IDs for each email
      const emailIds = cleanedDocuments.map(doc => 
        doc.metadata.document_id || `email_${uuidv4()}`
      );
      
      // Prepare metadata for ChromaDB
      const metadatas = cleanedDocuments.map(doc => ({
        ...doc.metadata,
        document_type: 'email',
        indexed_at: new Date().toISOString()
      }));

      // Add to ChromaDB collection
      await this.collection.add({
        ids: emailIds,
        embeddings: embeddings,
        documents: texts,
        metadatas: metadatas
      });

      console.log(`✅ Successfully added ${emailDocuments.length} emails to vector database`);
      return emailIds;
    } catch (error) {
      console.error('❌ Error adding emails to vector database:', error);
      throw new Error(`Failed to add emails: ${error.message}`);
    }
  }

  /**
   * Search emails using semantic search
   * @param {string} query - Search query
   * @param {number} topK - Number of results to return
   * @param {Object} filters - Search filters
   * @returns {Promise<Array>} - Search results
   */
  async searchEmails(query, topK = 5, filters = {}) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      console.log(`🔍 Searching emails for: "${query}"`);

      // Generate query embedding
      const queryEmbedding = await vextService.embedText(query);

      // Prepare ChromaDB filters
      const chromaFilters = {
        document_type: 'email',
        ...filters
      };

      // Search in collection
      const results = await this.collection.query({
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

      console.log(`✅ Found ${formattedResults.length} relevant emails`);
      return formattedResults;
    } catch (error) {
      console.error('❌ Error searching emails:', error);
      throw new Error(`Failed to search emails: ${error.message}`);
    }
  }

  /**
   * Get all emails from the database
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} - All emails
   */
  async getAllEmails(filters = {}) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      const chromaFilters = {
        document_type: 'email',
        ...filters
      };

      const results = await this.collection.get({
        where: chromaFilters
      });
      
      return results.ids.map((id, index) => ({
        id: id,
        text: results.documents[index],
        metadata: results.metadatas[index]
      }));
    } catch (error) {
      console.error('❌ Error getting all emails:', error);
      throw new Error(`Failed to get emails: ${error.message}`);
    }
  }

  /**
   * Delete an email by ID
   * @param {string} emailId - Email ID to delete
   * @returns {Promise<boolean>} - Success status
   */
  async deleteEmail(emailId) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      await this.collection.delete({
        ids: [emailId]
      });

      console.log(`✅ Successfully deleted email: ${emailId}`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting email:', error);
      throw new Error(`Failed to delete email: ${error.message}`);
    }
  }

  /**
   * Delete multiple emails by filters
   * @param {Object} filters - Filters to identify emails to delete
   * @returns {Promise<number>} - Number of emails deleted
   */
  async deleteEmailsByFilters(filters = {}) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      // Get emails matching filters
      const emailsToDelete = await this.getAllEmails(filters);
      
      if (emailsToDelete.length === 0) {
        console.log('📭 No emails found matching filters');
        return 0;
      }

      // Delete all matching emails
      const emailIds = emailsToDelete.map(email => email.id);
      await this.collection.delete({
        ids: emailIds
      });

      console.log(`✅ Successfully deleted ${emailIds.length} emails`);
      return emailIds.length;
    } catch (error) {
      console.error('❌ Error deleting emails by filters:', error);
      throw new Error(`Failed to delete emails: ${error.message}`);
    }
  }

  /**
   * Get email collection statistics
   * @param {Object} filters - Optional filters
   * @returns {Promise<Object>} - Collection statistics
   */
  async getEmailStats(filters = {}) {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      const chromaFilters = {
        document_type: 'email',
        ...filters
      };

      // Get all emails matching filters
      const emails = await this.getAllEmails(chromaFilters);
      
      // Calculate statistics
      const stats = {
        totalEmails: emails.length,
        collectionName: this.collectionName,
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
      console.error('❌ Error getting email stats:', error);
      throw new Error(`Failed to get email stats: ${error.message}`);
    }
  }

  /**
   * Clear all emails from the collection
   * @returns {Promise<boolean>} - Success status
   */
  async clearAllEmails() {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      console.log('🔄 Clearing all emails from collection...');
      
      // Get all email IDs
      const emails = await this.getAllEmails();
      
      if (emails.length === 0) {
        console.log('📭 No emails to clear');
        return true;
      }

      // Delete all emails
      const emailIds = emails.map(email => email.id);
      await this.collection.delete({
        ids: emailIds
      });

      console.log(`✅ Successfully cleared ${emailIds.length} emails`);
      return true;
    } catch (error) {
      console.error('❌ Error clearing emails:', error);
      throw new Error(`Failed to clear emails: ${error.message}`);
    }
  }

  /**
   * Validate and clean email documents
   * @param {Array} emailDocuments - Email documents to validate
   * @returns {Array} - Cleaned email documents
   */
  validateAndCleanEmailDocuments(emailDocuments) {
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
      
      // Check if our collection exists
      let collectionExists = false;
      try {
        await this.client.getCollection({ name: this.collectionName });
        collectionExists = true;
        console.log(`✅ Email collection '${this.collectionName}' exists`);
      } catch (error) {
        console.log(`⚠️ Email collection '${this.collectionName}' does not exist`);
      }
      
      return {
        healthy: true,
        collections: collections.length,
        emailCollectionExists: collectionExists,
        collectionName: this.collectionName,
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
   * @returns {Promise<Array>} - Search results
   */
  async advancedEmailSearch(searchParams) {
    try {
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
      const results = await this.searchEmails(query, topK, filters);

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

      console.log(`🔍 Advanced search found ${filteredResults.length} emails`);
      return filteredResults;
    } catch (error) {
      console.error('❌ Error in advanced email search:', error);
      throw new Error(`Advanced email search failed: ${error.message}`);
    }
  }
}

export default new EmailVectorService();
