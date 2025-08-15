import { v4 as uuidv4 } from 'uuid';

class EmailService {
  constructor() {
    this.supportedFields = [
      'userID',
      'email_id',
      'sender_email', 
      'cc_emails',
      'bcc_emails',
      'receiver_emails',
      'time_received',
      'subject',
      'body',
      'attachments'
    ];
  }

  /**
   * Validate email data structure
   * @param {Object} emailData - Email data to validate
   * @returns {Object} - Validation result
   */
  validateEmailData(emailData) {
    const errors = [];

    // Check if emailData is an object
    if (!emailData || typeof emailData !== 'object') {
      return {
        valid: false,
        errors: ['Email data must be an object']
      };
    }

    // Required fields validation - userID is now required for data isolation
    const requiredFields = ['userID', 'email_id', 'sender_email', 'receiver_emails', 'time_received', 'subject'];
    
    for (const field of requiredFields) {
      if (!emailData[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate userID format (should be a non-empty string)
    if (emailData.userID && (typeof emailData.userID !== 'string' || emailData.userID.trim().length === 0)) {
      errors.push('userID must be a non-empty string');
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (emailData.sender_email && !emailRegex.test(emailData.sender_email)) {
      errors.push('Invalid sender email format');
    }

    // Validate receiver emails (can be array or string)
    if (emailData.receiver_emails) {
      const receivers = Array.isArray(emailData.receiver_emails) 
        ? emailData.receiver_emails 
        : [emailData.receiver_emails];
      
      for (const email of receivers) {
        if (email && !emailRegex.test(email)) {
          errors.push(`Invalid receiver email format: ${email}`);
        }
      }
    }

    // Validate CC emails if provided
    if (emailData.cc_emails) {
      const ccEmails = Array.isArray(emailData.cc_emails) 
        ? emailData.cc_emails 
        : [emailData.cc_emails];
      
      for (const email of ccEmails) {
        if (email && !emailRegex.test(email)) {
          errors.push(`Invalid CC email format: ${email}`);
        }
      }
    }

    // Validate BCC emails if provided
    if (emailData.bcc_emails) {
      const bccEmails = Array.isArray(emailData.bcc_emails) 
        ? emailData.bcc_emails 
        : [emailData.bcc_emails];
      
      for (const email of bccEmails) {
        if (email && !emailRegex.test(email)) {
          errors.push(`Invalid BCC email format: ${email}`);
        }
      }
    }

    // Validate time_received format
    if (emailData.time_received) {
      const timeReceived = new Date(emailData.time_received);
      if (isNaN(timeReceived.getTime())) {
        errors.push('Invalid time_received format. Use ISO 8601 format (e.g., 2023-12-01T10:30:00Z)');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Process and normalize email data
   * @param {Object} emailData - Raw email data
   * @returns {Object} - Processed email data
   */
  processEmailData(emailData) {
    // Validate first
    const validation = this.validateEmailData(emailData);
    if (!validation.valid) {
      throw new Error(`Invalid email data: ${validation.errors.join(', ')}`);
    }

    // Normalize email arrays
    const normalizeEmails = (emails) => {
      if (!emails) return [];
      return Array.isArray(emails) ? emails : [emails];
    };

    // Create processed email object
    const processedEmail = {
      userID: emailData.userID.trim(), // Add userID for data isolation
      email_id: emailData.email_id,
      sender_email: emailData.sender_email,
      receiver_emails: normalizeEmails(emailData.receiver_emails),
      cc_emails: normalizeEmails(emailData.cc_emails),
      bcc_emails: normalizeEmails(emailData.bcc_emails),
      time_received: new Date(emailData.time_received).toISOString(),
      subject: emailData.subject || '',
      body: emailData.body || '',
      attachments: emailData.attachments || [],
      processed_at: new Date().toISOString(),
      document_id: uuidv4() // Generate unique document ID
    };

    return processedEmail;
  }

  /**
   * Extract searchable text from email
   * @param {Object} processedEmail - Processed email data
   * @returns {string} - Searchable text content
   */
  extractSearchableText(processedEmail) {
    const textParts = [];

    // Add subject
    if (processedEmail.subject) {
      textParts.push(`Subject: ${processedEmail.subject}`);
    }

    // Add sender information
    textParts.push(`From: ${processedEmail.sender_email}`);

    // Add recipient information
    if (processedEmail.receiver_emails.length > 0) {
      textParts.push(`To: ${processedEmail.receiver_emails.join(', ')}`);
    }

    if (processedEmail.cc_emails.length > 0) {
      textParts.push(`CC: ${processedEmail.cc_emails.join(', ')}`);
    }

    if (processedEmail.bcc_emails.length > 0) {
      textParts.push(`BCC: ${processedEmail.bcc_emails.join(', ')}`);
    }

    // Add timestamp
    textParts.push(`Received: ${processedEmail.time_received}`);

    // Add body content
    if (processedEmail.body) {
      textParts.push(`Body: ${processedEmail.body}`);
    }

    // Add attachment information
    if (processedEmail.attachments.length > 0) {
      const attachmentNames = processedEmail.attachments.map(att => 
        typeof att === 'string' ? att : att.name || att.filename || 'Unknown attachment'
      );
      textParts.push(`Attachments: ${attachmentNames.join(', ')}`);
    }

    return textParts.join('\n\n');
  }

  /**
   * Create metadata for email document
   * @param {Object} processedEmail - Processed email data
   * @returns {Object} - Metadata object
   */
  createEmailMetadata(processedEmail) {
    return {
      // User isolation - primary field for data isolation
      userID: processedEmail.userID,
      
      // Email identification
      email_id: processedEmail.email_id,
      document_id: processedEmail.document_id,
      document_type: 'email',
      
      // Email participants - convert arrays to strings for ChromaDB compatibility
      sender_email: processedEmail.sender_email,
      receiver_emails: processedEmail.receiver_emails.join(', '),
      cc_emails: processedEmail.cc_emails.join(', '),
      bcc_emails: processedEmail.bcc_emails.join(', '),
      
      // Email content info
      subject: processedEmail.subject,
      has_body: !!processedEmail.body,
      body_length: processedEmail.body ? processedEmail.body.length : 0,
      
      // Timing information
      time_received: processedEmail.time_received,
      processed_at: processedEmail.processed_at,
      
      // Attachment information
      has_attachments: processedEmail.attachments.length > 0,
      attachment_count: processedEmail.attachments.length,
      attachment_names: processedEmail.attachments.map(att => 
        typeof att === 'string' ? att : att.name || att.filename || 'Unknown'
      ).join(', '),
      
      // Email analysis
      sender_domain: this.extractDomain(processedEmail.sender_email),
      receiver_domains: processedEmail.receiver_emails.map(email => this.extractDomain(email)).join(', '),
      
      // Indexing information
      source: 'email_ingestion',
      indexed_at: new Date().toISOString()
    };
  }

  /**
   * Extract domain from email address
   * @param {string} email - Email address
   * @returns {string} - Domain part
   */
  extractDomain(email) {
    try {
      return email.split('@')[1] || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Process multiple emails in batch
   * @param {Array} emailsArray - Array of email objects
   * @returns {Array} - Array of processed emails with searchable text and metadata
   */
  processBatchEmails(emailsArray) {
    if (!Array.isArray(emailsArray)) {
      throw new Error('Emails data must be an array');
    }

    const processedEmails = [];
    const errors = [];

    emailsArray.forEach((emailData, index) => {
      try {
        const processedEmail = this.processEmailData(emailData);
        const searchableText = this.extractSearchableText(processedEmail);
        const metadata = this.createEmailMetadata(processedEmail);

        processedEmails.push({
          text: searchableText,
          metadata: metadata,
          originalEmail: processedEmail
        });
      } catch (error) {
        errors.push({
          index,
          email_id: emailData.email_id || `email_${index}`,
          error: error.message
        });
      }
    });

    return {
      processed: processedEmails,
      errors: errors,
      totalProcessed: processedEmails.length,
      totalErrors: errors.length
    };
  }

  /**
   * Create search filters for email queries
   * @param {Object} filters - Filter options
   * @param {string} userID - User ID for data isolation (required)
   * @returns {Object} - ChromaDB compatible filter
   */
  createSearchFilters(filters = {}, userID = null) {
    const chromaFilters = {
      document_type: 'email'
    };

    // Add user isolation filter - required for all email queries
    if (userID) {
      chromaFilters.userID = userID;
    }

    // Add sender filter
    if (filters.sender_email) {
      chromaFilters.sender_email = filters.sender_email;
    }

    // Add sender domain filter
    if (filters.sender_domain) {
      chromaFilters.sender_domain = filters.sender_domain;
    }

    // Add date range filters
    if (filters.date_from || filters.date_to) {
      // Note: ChromaDB date filtering might require additional logic
      // depending on the exact implementation
      if (filters.date_from) {
        chromaFilters.time_received_from = filters.date_from;
      }
      if (filters.date_to) {
        chromaFilters.time_received_to = filters.date_to;
      }
    }

    // Add attachment filter
    if (filters.has_attachments !== undefined) {
      chromaFilters.has_attachments = filters.has_attachments;
    }

    return chromaFilters;
  }

  /**
   * Generate email summary for AI context
   * @param {Object} emailMetadata - Email metadata
   * @returns {string} - Summary text
   */
  generateEmailSummary(emailMetadata) {
    const parts = [];
    
    parts.push(`Email from ${emailMetadata.sender_email}`);
    
    if (emailMetadata.receiver_emails && emailMetadata.receiver_emails.trim().length > 0) {
      parts.push(`to ${emailMetadata.receiver_emails}`);
    }
    
    if (emailMetadata.subject) {
      parts.push(`with subject "${emailMetadata.subject}"`);
    }
    
    parts.push(`received on ${new Date(emailMetadata.time_received).toLocaleDateString()}`);
    
    if (emailMetadata.has_attachments) {
      parts.push(`with ${emailMetadata.attachment_count} attachment(s)`);
    }

    return parts.join(' ');
  }

  /**
   * Get supported email fields
   * @returns {Array} - Array of supported field names
   */
  getSupportedFields() {
    return [...this.supportedFields];
  }

  /**
   * Get service status
   * @returns {Object} - Service status
   */
  getServiceStatus() {
    return {
      name: 'EmailService',
      version: '1.0.0',
      supportedFields: this.supportedFields,
      features: [
        'Email data validation',
        'Batch email processing',
        'Text extraction for search',
        'Metadata generation',
        'Search filtering',
        'Domain extraction'
      ],
      status: 'active'
    };
  }
}

export default new EmailService();
