import express from 'express';
import emailService from '../services/emailService.js';
import emailVectorService from '../services/emailVectorService.js';
import aiService from '../services/aiService.js';

const router = express.Router();

/**
 * POST /api/emails/ingest
 * Ingest multiple emails into the vector database
 */
router.post('/ingest', async (req, res) => {
  try {
    console.log('📧 Starting email ingest endpoint...');
    
    const { emails, userID } = req.body;

    // Validate userID for data isolation
    if (!userID || typeof userID !== 'string' || userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }

    // Validate request body
    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({
        error: 'Request body must contain an "emails" array',
        timestamp: new Date().toISOString()
      });
    }

    if (emails.length === 0) {
      return res.status(400).json({
        error: 'Emails array cannot be empty',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`📧 Processing ${emails.length} emails for ingestion for user: ${userID}...`);

    // Process emails in batch
    const batchResult = emailService.processBatchEmails(emails);
    
    if (batchResult.errors.length > 0) {
      console.warn(`⚠️ ${batchResult.errors.length} emails failed validation:`, batchResult.errors);
    }

    if (batchResult.processed.length === 0) {
      return res.status(400).json({
        error: 'No valid emails to process',
        validationErrors: batchResult.errors,
        timestamp: new Date().toISOString()
      });
    }

    // Add processed emails to vector database
    console.log(`🔄 Adding ${batchResult.processed.length} emails to vector database for user: ${userID}...`);
    const emailIds = await emailVectorService.addEmails(batchResult.processed, userID);

    console.log(`✅ Successfully ingested ${emailIds.length} emails`);

    const response = {
      success: true,
      message: 'Emails processed and ingested successfully',
      data: {
        userID: userID,
        totalSubmitted: emails.length,
        totalProcessed: batchResult.processed.length,
        totalErrors: batchResult.errors.length,
        emailIds: emailIds,
        errors: batchResult.errors
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Error in email ingest endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/emails/query
 * Query emails using AI-powered search
 */
router.post('/query', async (req, res) => {
  try {
    console.log('🔍 Starting email query endpoint...');
    
    const { 
      query, 
      userID,
      topK = 10, 
      filters = {},
      temperature = 0.3,
      useAdvancedSearch = false
    } = req.body;

    // Validate userID for data isolation
    if (!userID || typeof userID !== 'string' || userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }

    // Validate query
    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Query is required and must be a string',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🔍 Processing email query for user ${userID}: "${query}"`);

    // Search for relevant emails
    let searchResults;
    
    if (useAdvancedSearch) {
      // Use advanced search with filters
      searchResults = await emailVectorService.advancedEmailSearch({
        query,
        topK,
        ...filters
      }, userID);
    } else {
      // Use enhanced filtering when sender filter is applied
      if (filters.sender_email) {
        console.log(`🔍 Using enhanced filtering for sender-specific query`);
        searchResults = await emailVectorService.searchEmailsWithEnhancedFiltering(query, userID, topK, filters);
      } else {
        // Use basic semantic search
        searchResults = await emailVectorService.searchEmails(query, userID, topK, filters);
      }
    }

    console.log(`📧 Found ${searchResults.length} relevant emails`);

    if (searchResults.length === 0) {
      return res.json({
        success: true,
        data: {
          query,
          answer: "I couldn't find any emails matching your query. Please try rephrasing your question or check if emails have been ingested.",
          emails: [],
          confidence: 0,
          totalEmails: 0
        },
        timestamp: new Date().toISOString()
      });
    }

    // Prepare context for AI with enhanced filtering information
    const emailContext = searchResults.map(email => ({
      text: email.text,
      metadata: email.metadata,
      similarity: email.similarity
    }));

    // Generate AI response based on email context
    console.log('🤖 Generating AI response...');
    
    // Add context about filtering to help AI provide better responses
    const enhancedQuery = filters.sender_email ? 
      `${query} (Note: Only include emails that actually contain the requested content, not just emails from the specified sender)` :
      query;
    
    const aiResponse = await aiService.generateAnswer(enhancedQuery, emailContext, {
      temperature,
      maxTokens: 5000
    });

    // Format email summaries for response
    const emailSummaries = searchResults.map(email => ({
      email_id: email.metadata.email_id,
      subject: email.metadata.subject,
      sender: email.metadata.sender_email,
      received_time: email.metadata.time_received,
      similarity: email.similarity,
      summary: emailService.generateEmailSummary(email.metadata),
      has_attachments: email.metadata.has_attachments,
      attachment_count: email.metadata.attachment_count || 0
    }));

    const response = {
      success: true,
              data: {
          userID,
          query,
          answer: aiResponse.answer,
          confidence: aiResponse.confidence,
          emails: emailSummaries,
          totalEmails: searchResults.length,
          model: aiResponse.model,
          tokens: aiResponse.tokens,
          searchType: useAdvancedSearch ? 'advanced' : 'semantic'
        },
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Error in email query endpoint:', error);
    
    let statusCode = 500;
    let errorMessage = error.message;

    // Handle specific error types
    if (error.message.includes('Rate limit exceeded')) {
      statusCode = 429;
      errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
    } else if (error.message.includes('Failed to search emails')) {
      statusCode = 503;
      errorMessage = 'Email search service is temporarily unavailable. Please try again in a moment.';
    }

    res.status(statusCode).json({
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/emails/list
 * List all emails with optional filtering
 */
router.get('/list', async (req, res) => {
  try {
    console.log('📧 Listing emails...');
    
    const { 
      userID,
      sender_email, 
      sender_domain, 
      has_attachments,
      limit = 50,
      offset = 0
    } = req.query;

    // Validate userID for data isolation
    if (!userID || typeof userID !== 'string' || userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }

    // Build filters
    const filters = {};
    if (sender_email) filters.sender_email = sender_email;
    if (sender_domain) filters.sender_domain = sender_domain;
    if (has_attachments !== undefined) filters.has_attachments = has_attachments === 'true';

    // Get emails
    const allEmails = await emailVectorService.getAllEmails(userID, filters);
    
    // Apply pagination
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedEmails = allEmails.slice(startIndex, endIndex);

    // Format response
    const formattedEmails = paginatedEmails.map(email => ({
      email_id: email.metadata.email_id,
      document_id: email.metadata.document_id,
      subject: email.metadata.subject,
      sender_email: email.metadata.sender_email,
      receiver_emails: email.metadata.receiver_emails, // Now a string, not an array
      time_received: email.metadata.time_received,
      has_attachments: email.metadata.has_attachments,
      attachment_count: email.metadata.attachment_count || 0,
      body_length: email.metadata.body_length,
      indexed_at: email.metadata.indexed_at
    }));

    const response = {
      success: true,
              data: {
          userID,
          emails: formattedEmails,
          pagination: {
            total: allEmails.length,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: endIndex < allEmails.length
          },
          filters: filters
        },
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Error in email list endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/emails/stats
 * Get email collection statistics
 */
router.get('/stats', async (req, res) => {
  try {
    console.log('📊 Getting email statistics...');
    
    const { userID, sender_email, sender_domain } = req.query;
    
    if (!userID || typeof userID !== 'string' || userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }
    
    // Build filters for stats
    const filters = {};
    if (sender_email) filters.sender_email = sender_email;
    if (sender_domain) filters.sender_domain = sender_domain;

    // Get statistics
    const stats = await emailVectorService.getEmailStats(userID, filters);
    
    // Get health status
    const health = await emailVectorService.checkHealth();

    const response = {
      success: true,
      data: {
        ...stats,
        health: health,
        supportedFields: emailService.getSupportedFields(),
        serviceStatus: emailService.getServiceStatus()
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Error in email stats endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/emails/:emailId
 * Delete a specific email by ID
 */
router.delete('/:emailId', async (req, res) => {
  try {
    const { emailId } = req.params;
    const { userID } = req.query;

    if (!emailId) {
      return res.status(400).json({
        error: 'Email ID is required',
        timestamp: new Date().toISOString()
      });
    }

    if (!userID || typeof userID !== 'string' || userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🗑️ Deleting email: ${emailId} for user: ${userID}`);

    const deleted = await emailVectorService.deleteEmail(emailId, userID);

    if (!deleted) {
      return res.status(404).json({
        error: 'Email not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Email deleted successfully',
      data: { emailId, userID },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in delete email endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/emails/delete-batch
 * Delete multiple emails by filters
 */
router.post('/delete-batch', async (req, res) => {
  try {
    console.log('🗑️ Starting batch email deletion...');
    
    const { filters = {}, userID } = req.body;

    if (!userID || typeof userID !== 'string' || userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }

    if (Object.keys(filters).length === 0) {
      return res.status(400).json({
        error: 'At least one filter must be provided for batch deletion',
        availableFilters: ['sender_email', 'sender_domain', 'has_attachments'],
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🗑️ Deleting emails with filters for user ${userID}:`, filters);

    const deletedCount = await emailVectorService.deleteEmailsByFilters(userID, filters);

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} emails`,
      data: { 
        deletedCount,
        userID,
        filters 
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in batch delete emails endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/emails/clear
 * Clear all emails from the database
 */
router.post('/clear', async (req, res) => {
  try {
    console.log('🧹 Clearing all emails...');
    
    const { confirm, userID } = req.body;

    if (!userID || typeof userID !== 'string' || userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }

    if (confirm !== 'DELETE_ALL_EMAILS') {
      return res.status(400).json({
        error: 'To confirm deletion of all emails, send {"confirm": "DELETE_ALL_EMAILS"}',
        timestamp: new Date().toISOString()
      });
    }

    await emailVectorService.clearAllEmails(userID);

    res.json({
      success: true,
      message: `All emails cleared successfully for user: ${userID}`,
      data: { userID },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in clear emails endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/emails/health
 * Check email service health
 */
router.get('/health', async (req, res) => {
  try {
    const health = await emailVectorService.checkHealth();
    const serviceStatus = emailService.getServiceStatus();

    const response = {
      success: true,
      data: {
        vectorDatabase: health,
        emailService: serviceStatus,
        overall: health.healthy ? 'healthy' : 'degraded'
      },
      timestamp: new Date().toISOString()
    };

    const statusCode = health.healthy ? 200 : 503;
    res.status(statusCode).json(response);

  } catch (error) {
    console.error('❌ Error in email health endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/emails/search
 * Advanced email search with multiple criteria
 */
router.post('/search', async (req, res) => {
  try {
    console.log('🔍 Starting advanced email search...');
    
    const searchParams = req.body;

    // Validate required userID parameter
    if (!searchParams.userID || typeof searchParams.userID !== 'string' || searchParams.userID.trim().length === 0) {
      return res.status(400).json({
        error: 'userID is required for email data isolation and must be a non-empty string',
        timestamp: new Date().toISOString()
      });
    }

    // Validate required query parameter
    if (!searchParams.query) {
      return res.status(400).json({
        error: 'Query parameter is required',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🔍 Advanced search parameters for user ${searchParams.userID}:`, searchParams);

    // Perform advanced search
    const results = await emailVectorService.advancedEmailSearch(searchParams, searchParams.userID);

    // Format results
    const formattedResults = results.map(email => ({
      email_id: email.metadata.email_id,
      subject: email.metadata.subject,
      sender_email: email.metadata.sender_email,
      time_received: email.metadata.time_received,
      similarity: email.similarity,
      summary: emailService.generateEmailSummary(email.metadata),
      has_attachments: email.metadata.has_attachments,
      attachment_count: email.metadata.attachment_count || 0,
      text_preview: email.text.substring(0, 200) + '...'
    }));

    const response = {
      success: true,
      data: {
        query: searchParams.query,
        results: formattedResults,
        totalResults: results.length,
        searchParameters: searchParams
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Error in advanced email search endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
