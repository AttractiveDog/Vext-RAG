# Vext RAG System API Documentation

**Base URL:** `http://3.6.147.238:3000`

**Version:** 1.0.2

**Description:** A powerful Retrieval-Augmented Generation (RAG) system for intelligent document retrieval and question answering with OCR capabilities.

## Table of Contents

- [Authentication](#authentication)
- [Core Endpoints](#core-endpoints)
- [Document Management](#document-management)
- [Question & Answer](#question--answer)
- [OCR Processing](#ocr-processing)
- [System Management](#system-management)
- [Error Handling](#error-handling)
- [Rate Limits](#rate-limits)
- [Examples](#examples)

## Authentication

Currently, the API does not require authentication. However, ensure you have valid API keys configured in your environment:

- `OPENAI_API_KEY` - Required for embeddings and AI generation
- `MISTRAL_API_KEY` - Required for OCR functionality (optional)

## User Management

All endpoints now require a `userId` parameter to ensure data isolation between users. Documents uploaded by a user are stored in user-specific folders (`/uploads/[user ID]`) and all operations (query, list, delete) are filtered to only access that user's data.

**User ID Requirements:**
- All endpoints require a `userId` parameter
- User IDs can be any string identifier (email, username, UUID, etc.)
- Documents are automatically organized by user ID
- Each user's data is completely isolated from other users

## Core Endpoints

### Health Check

#### GET /health

Check the health status of the server.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "Vext RAG System"
}
```

### Root Endpoint

#### GET /

Get basic API information and available endpoints.

**Response:**
```json
{
  "message": "Vext RAG System API",
  "version": "1.0.0",
  "endpoints": {
    "health": "/health",
    "ingest": "/api/ingest",
    "query": "/api/query",
    "documents": "/api/documents"
  }
}
```

## Document Management

### Document Chunking System

The Vext RAG system uses an intelligent document chunking system to optimize search performance while maintaining document integrity:

**How it works:**
1. **Document Upload**: When a document is uploaded, it's processed and split into smaller text chunks
2. **Chunk Creation**: Each chunk contains a portion of the original document with overlapping content for context
3. **Parent-Child Relationship**: All chunks maintain a reference to their parent document ID
4. **Consolidated Display**: The API groups chunks by parent document for user-friendly display
5. **Optimized Search**: Chunks are used internally for better search results while maintaining document structure

**Benefits:**
- **Better Search**: Smaller chunks provide more precise search results
- **Context Preservation**: Overlapping content maintains context between chunks
- **User-Friendly**: Users see original documents, not individual chunks
- **Performance**: Faster vector similarity searches with smaller text segments

### Upload and Process Documents

#### POST /api/ingest

Upload and process documents for vector storage.

**Content-Type:** `multipart/form-data`

**Parameters:**
- `file` (required): Document file (PDF, DOCX, TXT, HTML)
- `userId` (required): User identifier for data isolation
- `metadata` (optional): JSON string with document metadata

**Supported File Types:**
- PDF (`application/pdf`)
- DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
- TXT (`text/plain`)
- HTML (`text/html`)

**File Size Limit:** 10MB

**Request Example:**
```bash
curl -X POST http://3.6.147.238:3000/api/ingest \
  -F "file=@document.pdf" \
  -F "userId=user123" \
  -F 'metadata={"title":"Sample Document","author":"John Doe","category":"technical"}'
```

**Response:**
```json
{
  "success": true,
  "message": "Document processed and ingested successfully",
  "data": {
    "filename": "document.pdf",
    "parentDocumentId": "parent_uuid",
    "totalChunks": 15,
    "chunkStats": {
      "totalChunks": 15,
      "averageChunkSize": 850,
      "minChunkSize": 200,
      "maxChunkSize": 1200,
      "totalWords": 12500,
      "totalCharacters": 75000
    },
    "chunkIds": ["parent_uuid_chunk_0", "parent_uuid_chunk_1", "parent_uuid_chunk_2"],
    "metadata": {
      "title": "Sample Document",
      "author": "John Doe",
      "category": "technical",
      "uploadDate": "2024-01-01T00:00:00.000Z"
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Note:** The document is split into multiple chunks for optimal search performance. Each chunk maintains a reference to the parent document ID and can be retrieved individually or as part of the complete document.

### List Documents

#### GET /api/documents

Retrieve all ingested documents with statistics for a specific user. Documents are grouped by their parent document ID, with chunks consolidated into single document entries.

**Query Parameters:**
- `userId` (required): User identifier to retrieve documents for

**Response:**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "parent_document_uuid",
        "filename": "document.pdf",
        "fileType": "application/pdf",
        "uploadDate": "2024-01-01T00:00:00.000Z",
        "totalChunks": 15,
        "totalWords": 12500,
        "totalCharacters": 75000,
        "fileSize": 1024000,
        "metadata": {
          "title": "Document Title",
          "author": "Author Name",
          "category": "technical",
          "version": "1.0"
        },
        "chunkIds": ["uuid_chunk_0", "uuid_chunk_1", "uuid_chunk_2"]
      }
    ],
    "stats": {
      "totalDocuments": 25,
      "totalChunks": 1500,
      "averageChunksPerDocument": 60,
      "totalFileSize": 25600000,
      "totalWords": 1250000,
      "totalCharacters": 7500000
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Note:** Each document entry represents the original uploaded file, with all its chunks consolidated. The `totalChunks` field shows how many chunks the document was split into for optimal search performance.

### Delete Document

#### DELETE /api/documents/:id

Delete a specific document by ID for a specific user. This will remove all chunks associated with the parent document.

**Parameters:**
- `id` (path): Parent document ID
- `userId` (query): User identifier to delete document for

**Response:**
```json
{
  "success": true,
  "message": "Document and all associated chunks deleted successfully",
  "data": {
    "documentId": "parent_document_uuid",
    "chunksDeleted": 15
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Note:** When deleting a document, all chunks created from that document are also removed from the vector database to maintain data consistency.

### Clear All Documents

#### POST /api/clear

Remove all documents from the system for a specific user.

**Request Body:**
```json
{
  "userId": "user123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "All documents cleared successfully",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Question & Answer

### Ask Questions

#### POST /api/query

Ask questions and get AI-powered answers based on ingested documents.

**Content-Type:** `application/json`

**Request Body:**
```json
{
  "question": "What are the main topics discussed in the documents?",
  "userId": "user123",
  "topK": 10,
  "temperature": 0.7
}
```

**Parameters:**
- `question` (required): The question to ask
- `userId` (required): User identifier to search documents for
- `topK` (optional): Number of relevant documents to retrieve (default: 10)
- `temperature` (optional): AI response creativity (0.0-1.0, default: 0.7)

**Response:**
```json
{
  "success": true,
  "data": {
    "question": "What are the main topics discussed in the documents?",
    "answer": "Based on the documents, the main topics include...",
    "sources": [
      {
        "documentId": "uuid",
        "title": "Document Title",
        "content": "Relevant text chunk...",
        "similarity": 0.95,
        "chunkIndex": 5
      }
    ],
    "confidence": 0.92,
    "model": "gpt-4o-mini",
    "tokens": 1250,
    "searchResults": 8,
    "historyId": "history_uuid",
    "contextTruncated": false,
    "documentsUsed": 8,
    "totalDocumentsAvailable": 15
  },
  "question": "What are the main topics discussed in the documents?",
  "answer": "Based on the documents, the main topics include...",
  "sources": [...],
  "confidence": 0.92,
  "model": "gpt-4o-mini",
  "tokens": 1250,
  "searchResults": 8,
  "historyId": "history_uuid",
  "contextTruncated": false,
  "documentsUsed": 8,
  "totalDocumentsAvailable": 15,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Generate Summary

#### POST /api/summarize

Generate a comprehensive summary of all ingested documents.

**Request Body:**
```json
{
  "userId": "user123",
  "maxTokens": 2000
}
```

**Parameters:**
- `userId` (required): User identifier to summarize documents for
- `maxTokens` (optional): Maximum tokens for summary (default: 2000)

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": "This is a comprehensive summary of all documents...",
    "documentCount": 25,
    "model": "gpt-4o-mini"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Extract Topics

#### POST /api/topics

Extract key topics from all ingested documents.

**Request Body:**
```json
{
  "userId": "user123",
  "maxTokens": 1500
}
```

**Parameters:**
- `userId` (required): User identifier to extract topics for
- `maxTokens` (optional): Maximum tokens for topic extraction (default: 1500)

**Response:**
```json
{
  "success": true,
  "data": {
    "topics": [
      {
        "topic": "Machine Learning",
        "frequency": 15,
        "relevance": 0.95,
        "relatedTerms": ["AI", "neural networks", "algorithms"]
      },
      {
        "topic": "Data Processing",
        "frequency": 12,
        "relevance": 0.88,
        "relatedTerms": ["ETL", "analytics", "databases"]
      }
    ],
    "documentCount": 25,
    "model": "gpt-4o-mini"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Question History Management

### Get Recent Questions

#### GET /api/questions

Retrieve recent questions from history.

**Query Parameters:**
- `limit` (optional): Number of questions to retrieve (default: 10)

**Response:**
```json
{
  "success": true,
  "data": {
    "questions": [
      {
        "id": "uuid",
        "question": "What are the main topics?",
        "answer": "The main topics include...",
        "sources": [...],
        "confidence": 0.92,
        "model": "gpt-4o-mini",
        "tokens": 1250,
        "timestamp": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 10
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Get Specific Question

#### GET /api/questions/:id

Retrieve a specific question by ID.

**Parameters:**
- `id` (path): Question ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "question": "What are the main topics?",
    "answer": "The main topics include...",
    "sources": [...],
    "confidence": 0.92,
    "model": "gpt-4o-mini",
    "tokens": 1250,
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Delete Question

#### DELETE /api/questions/:id

Delete a specific question from history.

**Parameters:**
- `id` (path): Question ID

**Response:**
```json
{
  "success": true,
  "message": "Question deleted successfully",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Clear Question History

#### DELETE /api/questions

Clear all question history.

**Response:**
```json
{
  "success": true,
  "message": "All questions cleared successfully",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Get Question Statistics

#### GET /api/questions/stats

Get statistics about question history.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalQuestions": 150,
    "averageConfidence": 0.87,
    "mostUsedModel": "gpt-4o-mini",
    "averageTokens": 1150,
    "questionsToday": 25,
    "questionsThisWeek": 120
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## OCR Processing

### Process Document with OCR

#### POST /api/ocr/process

Process image or document with Mistral OCR.

**Content-Type:** `multipart/form-data`

**Parameters:**
- `file` (required): Image or document file
- `userId` (required): User identifier for data isolation
- `options` (optional): JSON string with OCR options

**Request Example:**
```bash
curl -X POST http://3.6.147.238:3000/api/ocr/process \
  -F "file=@document.jpg" \
  -F "userId=user123" \
  -F 'options={"includeImages": true, "languages": ["en", "es"]}'
```

**Response:**
```json
{
  "success": true,
  "message": "OCR processing completed successfully",
  "data": {
    "filename": "document.jpg",
    "fileType": "image/jpeg",
    "fullText": "Extracted text content...",
    "statistics": {
      "totalPages": 1,
      "totalWords": 250,
      "detectedLanguages": ["en"],
      "averageConfidence": 0.95
    },
    "structuredData": {
      "tables": [...],
      "lists": [...],
      "headers": [...],
      "dates": [...],
      "emails": [...],
      "phoneNumbers": [...]
    },
    "metadata": {
      "model": "mistral-large-latest",
      "processingTime": 2.5
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Analyze Document with OCR and AI

#### POST /api/ocr/analyze

Process document with OCR and get AI-powered insights.

**Content-Type:** `multipart/form-data`

**Parameters:**
- `file` (required): Image or document file
- `userId` (required): User identifier for data isolation
- `prompt` (optional): Custom analysis prompt
- `options` (optional): JSON string with OCR options

**Request Example:**
```bash
curl -X POST http://3.6.147.238:3000/api/ocr/analyze \
  -F "file=@document.jpg" \
  -F "userId=user123" \
  -F 'prompt="Analyze this invoice and extract key information"' \
  -F 'options={"includeImages": true}'
```

**Response:**
```json
{
  "success": true,
  "message": "OCR analysis completed successfully",
  "data": {
    "ocr": {
      "filename": "document.jpg",
      "fullText": "Extracted text content...",
      "statistics": {...},
      "structuredData": {...}
    },
    "analysis": {
      "answer": "This appears to be an invoice for...",
      "model": "gpt-4o-mini",
      "tokens": 850
    },
    "summary": {
      "totalPages": 1,
      "totalWords": 250,
      "detectedLanguages": ["en"],
      "confidence": 0.95,
      "structuredElements": {
        "tables": 2,
        "lists": 1,
        "headers": 5,
        "dates": 3,
        "emails": 1,
        "phoneNumbers": 2
      }
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Ingest OCR Document

#### POST /api/ocr/ingest

Process document with OCR and ingest into vector database.

**Content-Type:** `multipart/form-data`

**Parameters:**
- `file` (required): Image or document file
- `userId` (required): User identifier for data isolation
- `metadata` (optional): JSON string with document metadata
- `options` (optional): JSON string with OCR options

**Request Example:**
```bash
curl -X POST http://3.6.147.238:3000/api/ocr/ingest \
  -F "file=@document.jpg" \
  -F "userId=user123" \
  -F 'metadata={"title":"Invoice","category":"financial"}' \
  -F 'options={"includeImages": true}'
```

**Response:**
```json
{
  "success": true,
  "message": "OCR document processed and ingested successfully",
  "data": {
    "filename": "document.jpg",
    "totalChunks": 8,
    "chunkStats": {
      "totalChunks": 8,
      "averageChunkSize": 300,
      "minChunkSize": 150,
      "maxChunkSize": 450
    },
    "documentIds": ["uuid1", "uuid2"],
    "ocrStats": {
      "totalPages": 1,
      "totalWords": 250,
      "detectedLanguages": ["en"],
      "averageConfidence": 0.95
    },
    "structuredData": {
      "tables": [...],
      "lists": [...],
      "headers": [...],
      "dates": [...],
      "emails": [...],
      "phoneNumbers": [...]
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Get OCR Formats

#### GET /api/ocr/formats

Get supported OCR formats and limits.

**Response:**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "formats": [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "image/tiff"
    ],
    "limits": {
      "maxFileSize": 10485760,
      "maxPages": 50,
      "includeImages": true
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## System Management

### Get System Statistics

#### GET /api/stats

Get comprehensive system statistics and health information for a specific user.

**Query Parameters:**
- `userId` (required): User identifier to get statistics for

**Response:**
```json
{
  "success": true,
  "data": {
    "vectorDatabase": {
      "totalDocuments": 25,
      "totalChunks": 1500,
      "averageChunksPerDocument": 60,
      "totalFileSize": 25600000,
      "totalWords": 1250000,
      "totalCharacters": 7500000,
      "collectionName": "vext_rag_collection"
    },
    "services": {
      "vext": {
        "status": "healthy",
        "version": "1.0.0"
      },
      "ai": {
        "status": "healthy",
        "model": "gpt-4o-mini"
      }
    },
    "supportedFormats": [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/html"
    ],
    "model": "gpt-4o-mini"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Note:** `totalDocuments` represents the number of original uploaded files, while `totalChunks` represents the total number of text chunks created for optimal search performance.

## Error Handling

The API uses standard HTTP status codes and returns error responses in the following format:

```json
{
  "error": "Error message description",
  "originalError": "Detailed error message (development only)",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Common Error Codes

- `400 Bad Request` - Invalid request parameters or missing required fields
- `404 Not Found` - Resource not found
- `413 Payload Too Large` - File size exceeds limits or context too long
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service temporarily unavailable

### Specific Error Messages

- `"No file uploaded"` - Missing file in upload request
- `"Invalid file type"` - Unsupported file format
- `"Question is required"` - Missing question parameter
- `"Document ID is required"` - Missing document ID
- `"Rate limit exceeded"` - API rate limit reached
- `"Context too long"` - Query context exceeds token limits
- `"Vector database is temporarily unavailable"` - Database connection issues

## Rate Limits

Currently, the API does not implement strict rate limiting. However, consider:

- **File Uploads**: 10MB per file, reasonable upload frequency
- **AI Queries**: Respect OpenAI API rate limits
- **OCR Processing**: Respect Mistral API rate limits

## Examples

### Complete Workflow Example

```bash
# 1. Upload a document
curl -X POST http://3.6.147.238:3000/api/ingest \
  -F "file=@technical_manual.pdf" \
  -F "userId=user123" \
  -F 'metadata={"title":"Technical Manual","author":"Engineering Team","category":"technical"}'

# 2. Ask a question
curl -X POST http://3.6.147.238:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the main features described in the technical manual?", "userId": "user123", "topK": 5}'

# 3. Get document list
curl -X GET "http://3.6.147.238:3000/api/documents?userId=user123"

# 4. Generate summary
curl -X POST http://3.6.147.238:3000/api/summarize \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "maxTokens": 1500}'

# 5. Extract topics
curl -X POST http://3.6.147.238:3000/api/topics \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "maxTokens": 1000}'
```

### OCR Workflow Example

```bash
# 1. Process image with OCR
curl -X POST http://3.6.147.238:3000/api/ocr/process \
  -F "file=@invoice.jpg" \
  -F "userId=user123" \
  -F 'options={"includeImages": true, "languages": ["en"]}'

# 2. Analyze OCR results with AI
curl -X POST http://3.6.147.238:3000/api/ocr/analyze \
  -F "file=@invoice.jpg" \
  -F "userId=user123" \
  -F 'prompt="Extract invoice details including amount, date, and vendor information"'

# 3. Ingest OCR document into vector database
curl -X POST http://3.6.147.238:3000/api/ocr/ingest \
  -F "file=@invoice.jpg" \
  -F "userId=user123" \
  -F 'metadata={"title":"Invoice","category":"financial","vendor":"ABC Corp"}'

# 4. Query the ingested OCR content
curl -X POST http://3.6.147.238:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the total amount on the invoice?", "userId": "user123", "topK": 3}'
```

### Question History Management

```bash
# 1. Get recent questions
curl -X GET "http://3.6.147.238:3000/api/questions?limit=5"

# 2. Get specific question
curl -X GET http://3.6.147.238:3000/api/questions/question_uuid

# 3. Get question statistics
curl -X GET http://3.6.147.238:3000/api/questions/stats

# 4. Delete specific question
curl -X DELETE http://3.6.147.238:3000/api/questions/question_uuid

# 5. Clear all questions
curl -X DELETE http://3.6.147.238:3000/api/questions
```

## Recent Improvements

### User ID Support (v1.0.2)

**New Feature:** Added comprehensive user ID support for multi-tenant data isolation.

**Features Implemented:**
- **User-Specific Storage**: Documents are stored in `/uploads/[user ID]` folders
- **Data Isolation**: All operations (query, list, delete) are filtered by user ID
- **Required Parameter**: All endpoints now require a `userId` parameter
- **Secure Access**: Users can only access their own documents and data

**Benefits:**
- **Multi-Tenant Support**: Multiple users can use the system independently
- **Data Security**: Complete isolation between user data
- **Organized Storage**: User-specific file organization
- **Scalable Architecture**: Ready for enterprise multi-user deployments

### Document Chunking Fix (v1.0.1)

**Issue Resolved:** Previously, the system displayed individual document chunks as separate documents, creating confusion for users who saw multiple entries for the same uploaded file.

**Solution Implemented:**
- **Grouped Document Display**: Documents are now grouped by parent document ID, showing each uploaded file as a single entry
- **Consolidated Statistics**: Each document entry shows total chunks, words, and characters across all chunks
- **Improved Deletion**: Deleting a document now removes all associated chunks from the vector database
- **Enhanced Statistics**: System statistics now distinguish between total documents and total chunks

**Benefits:**
- **Cleaner Interface**: Users see logical document structure instead of individual chunks
- **Better UX**: Intuitive document management with clear file representation
- **Maintained Performance**: Internal chunking still provides optimal search performance
- **Data Consistency**: Proper cleanup prevents orphaned chunks

## Web Interface

Access the web interface at `http://3.6.147.238:3000` for:

- **Document Upload**: Drag-and-drop file upload with metadata
- **Question Interface**: Interactive question asking with AI model selection
- **Document Management**: View, search, and delete documents (now with grouped display)
- **System Statistics**: Real-time system health and performance metrics
- **Question History**: View and manage previous questions and answers
- **OCR Processing**: Upload and process images/documents with OCR

## Support

For additional support and information:

- **Documentation**: Check the [README.md](README.md) for detailed setup instructions
- **Quick Start**: See [QUICKSTART.md](QUICKSTART.md) for rapid deployment
- **Issues**: Report bugs and feature requests on GitHub
- **Health Check**: Use `/health` endpoint to verify system status

---

**Last Updated:** January 2024  
**API Version:** 1.0.2  
**Server:** http://3.6.147.238:3000 