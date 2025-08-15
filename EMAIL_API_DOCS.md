# Email RAG System API Documentation

This document provides complete API documentation for the Email RAG (Retrieval-Augmented Generation) system that allows you to ingest, store, and query email data using AI-powered semantic search with **data isolation per user**.

## Overview

The Email RAG API provides endpoints for:
- **Email Ingestion**: Store multiple emails in JSON format with user isolation
- **AI-Powered Queries**: Ask natural language questions about your emails
- **Email Management**: List, search, filter, and delete emails per user
- **Statistics & Health**: Monitor system status and collection statistics
- **Data Isolation**: Complete separation of email data between different users

**Important Notes**:
- **Data Isolation**: All endpoints require a `userID` parameter to ensure complete data separation between users
- **User Collections**: Each user gets their own isolated ChromaDB collection (e.g., `email_rag_user123`)
- **Security**: Users can only access their own emails - no cross-user data leakage possible
- For ChromaDB compatibility, email metadata fields that are arrays (like `receiver_emails`, `cc_emails`, `bcc_emails`) are converted to comma-separated strings internally

## Base URL

```
http://3.6.147.238:3000/api/emails
```

## Quick Start

1. **Test the service**: `GET /api/emails/health`
2. **Ingest emails**: `POST /api/emails/ingest` with your email data
3. **Query emails**: `POST /api/emails/query` with natural language questions
4. **View web interface**: Visit `/email-test.html` for interactive testing

## Getting Started

### Step 1: Verify Service Health
```bash
curl http://3.6.147.238:3000/api/emails/health
```

Expected response:
```json
{
  "success": true,
  "data": {
    "overall": "healthy"
  }
}
```

### Step 2: Ingest Your First Emails
```bash
curl -X POST http://3.6.147.238:3000/api/emails/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "userID": "user_123",
    "emails": [
      {
        "userID": "user_123",
        "email_id": "test_001",
        "sender_email": "john@company.com",
        "receiver_emails": ["team@company.com"],
        "time_received": "2024-01-15T10:30:00Z",
        "subject": "Weekly Project Update",
        "body": "Project is on track. We completed 80% of features."
      }
    ]
  }'
```

### Step 3: Query Your Emails
```bash
curl -X POST http://3.6.147.238:3000/api/emails/query \
  -H "Content-Type: application/json" \
  -d '{
    "userID": "user_123",
    "query": "What is the project status?",
    "topK": 5
  }'
```

### Step 4: List Your Emails
```bash
curl "http://3.6.147.238:3000/api/emails/list?userID=user_123&limit=10"
```

## Email Data Format

Emails should be submitted in the following JSON format:

```json
{
  "userID": "user_123",
  "email_id": "unique_email_identifier",
  "sender_email": "sender@domain.com",
  "receiver_emails": ["recipient1@domain.com", "recipient2@domain.com"],
  "cc_emails": ["cc1@domain.com"],
  "bcc_emails": ["bcc1@domain.com"],
  "time_received": "2024-01-15T10:30:00Z",
  "subject": "Email Subject",
  "body": "Email body content...",
  "attachments": [
    {
      "name": "document.pdf",
      "type": "application/pdf",
      "size": "1.2MB"
    }
  ]
}
```

### Required Fields
- `userID`: User identifier for data isolation (must be a non-empty string)
- `email_id`: Unique identifier for the email
- `sender_email`: Valid email address of the sender
- `receiver_emails`: Array of recipient email addresses (or single string)
- `time_received`: ISO 8601 timestamp when email was received
- `subject`: Email subject line

### Optional Fields
- `cc_emails`: Carbon copy recipients (array or string)
- `bcc_emails`: Blind carbon copy recipients (array or string)
- `body`: Email body content
- `attachments`: Array of attachment objects

### Metadata Storage Format
When emails are stored in the vector database, array fields are converted to comma-separated strings for ChromaDB compatibility:
- `receiver_emails`: `["a@test.com", "b@test.com"]` becomes `"a@test.com, b@test.com"`
- `cc_emails`: `["cc@test.com"]` becomes `"cc@test.com"`
- `bcc_emails`: Similar conversion to comma-separated string
- `attachments`: Converted to `attachment_names` field as comma-separated attachment names

## Common Workflows

### Workflow 1: Email Analysis Dashboard
```bash
# 1. Get overall statistics
curl "http://3.6.147.238:3000/api/emails/stats?userID=user_123"

# 2. List recent emails
curl "http://3.6.147.238:3000/api/emails/list?userID=user_123&limit=50"

# 3. Search for important emails
curl -X POST http://3.6.147.238:3000/api/emails/search \
  -H "Content-Type: application/json" \
  -d '{"userID": "user_123", "query": "urgent", "has_attachments": true}'
```

### Workflow 2: Customer Support Inbox
```bash
# 1. Ingest support emails
curl -X POST http://3.6.147.238:3000/api/emails/ingest \
  -H "Content-Type: application/json" \
  -d '{"userID": "support_agent_1", "emails": [...]}'

# 2. Find emails about specific issues
curl -X POST http://3.6.147.238:3000/api/emails/query \
  -H "Content-Type: application/json" \
  -d '{"userID": "support_agent_1", "query": "login problems", "topK": 10}'

# 3. Filter by customer domain
curl "http://3.6.147.238:3000/api/emails/list?userID=support_agent_1&sender_domain=customer.com"
```

### Workflow 3: Invoice Processing
```bash
# 1. Search for invoice emails
curl -X POST http://3.6.147.238:3000/api/emails/search \
  -H "Content-Type: application/json" \
  -d '{
    "userID": "finance_team",
    "query": "invoice payment",
    "has_attachments": true,
    "subject_contains": "invoice"
  }'

# 2. Get payment-related information
curl -X POST http://3.6.147.238:3000/api/emails/query \
  -H "Content-Type: application/json" \
  -d '{"userID": "finance_team", "query": "What invoices are due this month?"}'
```

### Workflow 4: Email Cleanup
```bash
# 1. Find spam emails
curl "http://3.6.147.238:3000/api/emails/list?userID=user_123&sender_domain=spam.com"

# 2. Delete spam by domain
curl -X POST http://3.6.147.238:3000/api/emails/delete-batch \
  -H "Content-Type: application/json" \
  -d '{"userID": "user_123", "filters": {"sender_domain": "spam.com"}}'

# 3. Verify deletion
curl "http://3.6.147.238:3000/api/emails/stats?userID=user_123"
```

## API Endpoints

### 1. Ingest Emails

**POST** `/api/emails/ingest`

Ingest multiple emails into the vector database.

#### Request Body
```json
{
  "userID": "user_123",
  "emails": [
    {
      "userID": "user_123",
      "email_id": "email_001",
      "sender_email": "john@company.com",
      "receiver_emails": ["team@company.com"],
      "time_received": "2024-01-15T10:30:00Z",
      "subject": "Project Update",
      "body": "Weekly project status update..."
    }
  ]
}
```

#### Response
```json
{
  "success": true,
  "message": "Emails processed and ingested successfully",
  "data": {
    "userID": "user_123",
    "totalSubmitted": 1,
    "totalProcessed": 1,
    "totalErrors": 0,
    "emailIds": ["email_001"],
    "errors": []
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

#### Error Response
```json
{
  "error": "Request body must contain an 'emails' array",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 2. Query Emails

**POST** `/api/emails/query`

Query emails using AI-powered semantic search.

#### Request Body
```json
{
  "userID": "user_123",
  "query": "What project updates were shared?",
  "topK": 10,
  "filters": {
    "sender_email": "john@company.com"
  },
  "temperature": 0.3,
  "useAdvancedSearch": false
}
```

#### Parameters
- `userID` (required): User identifier for data isolation
- `query` (required): Natural language query
- `topK` (optional): Number of results to return (default: 10)
- `filters` (optional): Search filters
- `temperature` (optional): AI response creativity (0-1, default: 0.3)
- `useAdvancedSearch` (optional): Use advanced search features

#### Response
```json
{
  "success": true,
  "data": {
    "userID": "user_123",
    "query": "What project updates were shared?",
    "answer": "Based on the emails, John shared a project update indicating that...",
    "confidence": 0.85,
    "emails": [
      {
        "email_id": "email_001",
        "subject": "Project Update",
        "sender": "john@company.com",
        "received_time": "2024-01-15T10:30:00Z",
        "similarity": 0.92,
        "summary": "Email from john@company.com with subject 'Project Update'",
        "has_attachments": false,
        "attachment_count": 0
      }
    ],
    "totalEmails": 1,
    "model": "gpt-4o-mini",
    "tokens": 245,
    "searchType": "semantic"
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 3. List Emails

**GET** `/api/emails/list`

List all emails with optional filtering and pagination.

#### Query Parameters
- `userID` (required): User identifier for data isolation
- `sender_email`: Filter by sender email
- `sender_domain`: Filter by sender domain
- `has_attachments`: Filter by attachment presence (true/false)
- `limit`: Number of results per page (default: 50)
- `offset`: Number of results to skip (default: 0)

#### Example Request
```
GET /api/emails/list?userID=user_123&sender_domain=company.com&limit=20&offset=0
```

#### Response
```json
{
  "success": true,
  "data": {
    "userID": "user_123",
    "emails": [
      {
        "email_id": "email_001",
        "document_id": "doc_uuid",
        "subject": "Project Update",
        "sender_email": "john@company.com",
        "receiver_emails": "team@company.com",
        "time_received": "2024-01-15T10:30:00Z",
        "has_attachments": false,
        "attachment_count": 0,
        "body_length": 156,
        "indexed_at": "2024-01-15T12:00:00Z"
      }
    ],
    "pagination": {
      "total": 25,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    },
    "filters": {
      "sender_domain": "company.com"
    }
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 4. Email Statistics

**GET** `/api/emails/stats`

Get statistics about the email collection.

#### Query Parameters
- `userID` (required): User identifier for data isolation
- `sender_email`: Get stats for specific sender
- `sender_domain`: Get stats for specific domain

#### Response
```json
{
  "success": true,
  "data": {
    "totalEmails": 150,
    "userID": "user_123",
    "uniqueSenders": 45,
    "uniqueDomains": 12,
    "totalAttachments": 89,
    "emailsWithAttachments": 67,
    "averageAttachmentsPerEmail": 0.59,
    "collectionName": "email_rag_user_123",
    "lastUpdated": "2024-01-15T12:00:00Z",
    "health": {
      "healthy": true,
      "emailCollectionExists": true
    },
    "supportedFields": ["userID", "email_id", "sender_email", "cc_emails", ...],
    "serviceStatus": {
      "name": "EmailService",
      "version": "1.0.0",
      "status": "active"
    }
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 5. Advanced Email Search

**POST** `/api/emails/search`

Perform advanced search with multiple criteria.

#### Request Body
```json
{
  "userID": "user_123",
  "query": "software licenses",
  "sender_email": "vendor@company.com",
  "sender_domain": "vendor.com",
  "date_from": "2024-01-01T00:00:00Z",
  "date_to": "2024-01-31T23:59:59Z",
  "has_attachments": true,
  "subject_contains": "invoice",
  "topK": 5
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "userID": "user_123",
    "query": "software licenses",
    "results": [
      {
        "email_id": "email_002",
        "subject": "Invoice #INV-2024-001 - Software Licenses",
        "sender_email": "vendor@company.com",
        "time_received": "2024-01-16T14:45:00Z",
        "similarity": 0.94,
        "summary": "Email from vendor@company.com about software licenses",
        "has_attachments": true,
        "attachment_count": 1,
        "text_preview": "Please find attached the invoice for..."
      }
    ],
    "totalResults": 1,
    "searchParameters": {
      "userID": "user_123",
      "query": "software licenses",
      "sender_domain": "vendor.com",
      "has_attachments": true
    }
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 6. Delete Email

**DELETE** `/api/emails/{emailId}?userID={userID}`

Delete a specific email by ID for a specific user.

#### Response
```json
{
  "success": true,
  "message": "Email deleted successfully",
  "data": {
    "emailId": "email_001",
    "userID": "user_123"
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 7. Batch Delete Emails

**POST** `/api/emails/delete-batch`

Delete multiple emails by filters.

#### Request Body
```json
{
  "userID": "user_123",
  "filters": {
    "sender_domain": "spam.com"
  }
}
```

#### Response
```json
{
  "success": true,
  "message": "Successfully deleted 15 emails",
  "data": {
    "deletedCount": 15,
    "userID": "user_123",
    "filters": {
      "sender_domain": "spam.com"
    }
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 8. Clear All Emails

**POST** `/api/emails/clear`

Clear all emails for a specific user from the database (requires confirmation).

#### Request Body
```json
{
  "userID": "user_123",
  "confirm": "DELETE_ALL_EMAILS"
}
```

#### Response
```json
{
  "success": true,
  "message": "All emails cleared successfully for user: user_123",
  "data": {
    "userID": "user_123"
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### 9. Health Check

**GET** `/api/emails/health`

Check the health of the email service.

#### Response
```json
{
  "success": true,
  "data": {
    "vectorDatabase": {
      "healthy": true,
      "totalCollections": 25,
      "emailCollections": 12,
      "baseCollectionName": "email_rag",
      "userCollectionPattern": "email_rag_[userID]"
    },
    "emailService": {
      "name": "EmailService",
      "status": "active"
    },
    "overall": "healthy"
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid input data |
| 404 | Not Found - Email not found |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error - Server error |
| 503 | Service Unavailable - Database temporarily unavailable |

## Example Usage

### 1. Ingest Emails
```bash
curl -X POST http://3.6.147.238:3000/api/emails/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "userID": "user_123",
    "emails": [
      {
        "userID": "user_123",
        "email_id": "email_001",
        "sender_email": "john@company.com",
        "receiver_emails": ["team@company.com"],
        "time_received": "2024-01-15T10:30:00Z",
        "subject": "Project Update",
        "body": "Weekly project status update..."
      }
    ]
  }'
```

### 2. Query Emails
```bash
curl -X POST http://3.6.147.238:3000/api/emails/query \
  -H "Content-Type: application/json" \
  -d '{
    "userID": "user_123",
    "query": "What project updates were shared?",
    "topK": 5
  }'
```

### 3. List Emails
```bash
curl "http://3.6.147.238:3000/api/emails/list?userID=user_123&limit=10&sender_domain=company.com"
```

## Code Examples

### JavaScript (Node.js/Browser)
```javascript
// Ingest emails
async function ingestEmails(emails, userID) {
  const response = await fetch('http://3.6.147.238:3000/api/emails/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userID, emails })
  });
  return await response.json();
}

// Query emails with AI
async function queryEmails(query, userID, topK = 5) {
  const response = await fetch('http://3.6.147.238:3000/api/emails/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userID, query, topK })
  });
  return await response.json();
}

// List emails with filters
async function listEmails(userID, filters = {}) {
  const params = new URLSearchParams({ userID, ...filters });
  const response = await fetch(`http://3.6.147.238:3000/api/emails/list?${params}`);
  return await response.json();
}

// Example usage
const userID = "user_123";
const emails = [{
  userID: "user_123",
  email_id: "email_001",
  sender_email: "john@company.com",
  receiver_emails: ["team@company.com"],
  time_received: "2024-01-15T10:30:00Z",
  subject: "Project Update",
  body: "Project is progressing well..."
}];

ingestEmails(emails, userID).then(result => {
  console.log('Ingestion result:', result);
  return queryEmails("What is the project status?", userID);
}).then(answer => {
  console.log('AI Answer:', answer.data.answer);
});
```

### Python
```python
import requests
import json
from datetime import datetime

BASE_URL = "http://3.6.147.238:3000/api/emails"

def ingest_emails(emails, user_id):
    """Ingest emails into the system"""
    response = requests.post(
        f"{BASE_URL}/ingest",
        headers={"Content-Type": "application/json"},
        json={"userID": user_id, "emails": emails}
    )
    return response.json()

def query_emails(query, user_id, top_k=5, filters=None):
    """Query emails using AI"""
    payload = {"userID": user_id, "query": query, "topK": top_k}
    if filters:
        payload["filters"] = filters
    
    response = requests.post(
        f"{BASE_URL}/query",
        headers={"Content-Type": "application/json"},
        json=payload
    )
    return response.json()

def list_emails(user_id, sender_email=None, sender_domain=None, limit=50):
    """List emails with optional filters"""
    params = {"userID": user_id, "limit": limit}
    if sender_email:
        params["sender_email"] = sender_email
    if sender_domain:
        params["sender_domain"] = sender_domain
    
    response = requests.get(f"{BASE_URL}/list", params=params)
    return response.json()

def get_stats(user_id):
    """Get email collection statistics"""
    response = requests.get(f"{BASE_URL}/stats", params={"userID": user_id})
    return response.json()

# Example usage
if __name__ == "__main__":
    # User ID for data isolation
    user_id = "user_123"
    
    # Sample email data
    emails = [{
        "userID": user_id,
        "email_id": "email_001",
        "sender_email": "john@company.com",
        "receiver_emails": ["team@company.com"],
        "time_received": datetime.now().isoformat() + "Z",
        "subject": "Project Update",
        "body": "The project is progressing well. We are on schedule."
    }]
    
    # Ingest emails
    ingest_result = ingest_emails(emails, user_id)
    print("Ingestion result:", ingest_result)
    
    # Query emails
    query_result = query_emails("What is the project status?", user_id)
    print("AI Answer:", query_result["data"]["answer"])
    
    # Get statistics
    stats = get_stats(user_id)
    print("Total emails:", stats["data"]["totalEmails"])
```

## Authentication

Currently, no authentication is required for API endpoints. In production, implement proper authentication and authorization.

## Rate Limits

- No rate limits are currently enforced
- AI query endpoints may be subject to OpenAI API rate limits
- Consider implementing rate limiting for production use

## Response Format

All API responses follow this standard format:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### Error Response
```json
{
  "error": "Error message description",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

## Testing

### Interactive Web Interface
Visit `/email-test.html` for a comprehensive web interface to test all endpoints interactively.

### Command Line Testing
```bash
# Test health endpoint
curl http://3.6.147.238:3000/api/emails/health

# Test with sample data
curl -X POST http://3.6.147.238:3000/api/emails/ingest \
  -H "Content-Type: application/json" \
  -d '{"emails":[...]}'
```

### Automated Testing
Run the test suite:
```bash
node test_email_feature.js
```

## SDKs and Libraries

Currently, no official SDKs are available. Use standard HTTP clients:
- **JavaScript**: `fetch()` or `axios`
- **Python**: `requests` library
- **cURL**: Command line testing
- **Postman**: Import the endpoints for API testing

## Support and Troubleshooting

### Common Issues

1. **"ChromaDB connection failed"**
   - Ensure ChromaDB is running
   - Check CHROMA_URL environment variable

2. **"OpenAI API key missing"**
   - Set OPENAI_API_KEY environment variable
   - Verify API key has sufficient quota

3. **"Invalid email format"**
   - Ensure email addresses follow standard format
   - Check required fields are present

4. **"ChromaDB 422 Unprocessable Entity"**
   - This was resolved by converting array metadata fields to strings
   - Ensure you're using the latest version of the API
   - If issue persists, check that metadata contains only primitive types

### Debug Information

All responses include timestamps. Enable verbose logging by setting `LOG_LEVEL=debug` in environment variables.

### Health Monitoring

Use `GET /api/emails/health` to monitor:
- Vector database connectivity
- Email collection status
- Service availability

## API Limits

- **Email batch size**: No hard limit (recommended: 100 emails per request)
- **Query length**: No limit (optimal: under 500 characters)
- **Search results**: Maximum 100 results per query
- **File attachments**: Metadata only (file content not stored)

## Security Considerations

- Validate all input data before sending to API
- Sanitize email content for sensitive information
- Implement authentication in production environments
- Use HTTPS in production
- Regular backup of email data recommended

## Changelog

- **v1.1.0**: Added complete data isolation with userID requirements
  - All endpoints now require userID for user-specific data separation
  - Each user gets their own isolated ChromaDB collection
  - Complete security isolation - no cross-user data access possible
  - Updated all API examples and documentation
- **v1.0.1**: Fixed ChromaDB 422 error by converting array metadata fields to strings for compatibility
- **v1.0.0**: Initial release with core email RAG functionality
