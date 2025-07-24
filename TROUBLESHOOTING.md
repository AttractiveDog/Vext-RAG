# Troubleshooting Guide

## ChromaDB 422 Unprocessable Entity Errors

### What is a 422 Error?
A 422 error from ChromaDB indicates that the server understood the request but cannot process it due to invalid data format or schema issues.

### Recent Fix: Document Chunk Handling

**Issue:** Every chunk was being treated as a different document, causing 422 errors and poor search results.

**Solution:** Implemented proper document-chunk relationships:
- Each document gets a unique `documentId`
- All chunks from the same document share the same `parentDocumentId`
- Chunks are properly linked with metadata relationships
- Search results are grouped by parent document
- Better context preparation for AI responses

### Common Causes and Solutions

#### 1. **Data Format Issues**
**Symptoms:** 422 error when adding documents
**Solutions:**
- The application now includes enhanced data validation
- Documents are automatically cleaned and validated before processing
- Text length is limited to 100,000 characters
- Metadata values are sanitized and limited to 1,000 characters

#### 2. **Collection Schema Mismatch**
**Symptoms:** 422 error after updating the application
**Solutions:**
- The application automatically resets collections when 422 errors occur
- You can manually reset the collection using the health check endpoint
- Check the `/api/health` endpoint to verify collection status

#### 3. **ChromaDB Server Issues**
**Symptoms:** Connection errors or 422 errors
**Solutions:**
- Ensure ChromaDB server is running on the correct port (default: 8000)
- Check ChromaDB server logs for errors
- Verify the `CHROMA_URL` environment variable is correct

### Diagnostic Steps

#### Step 1: Check System Health
```bash
curl http://3.6.147.238:3000/api/health
```

#### Step 2: Run the Test Script
```bash
node test_chromadb.js
```

#### Step 3: Check ChromaDB Server
```bash
# If using Docker
docker ps | grep chroma

# Check ChromaDB logs
docker logs <chroma-container-id>
```

#### Step 4: Manual Collection Reset
If automatic reset fails, you can manually reset the collection:

1. Stop the application
2. Delete the ChromaDB data directory (if using persistent storage)
3. Restart ChromaDB server
4. Restart the application

### Environment Variables

Ensure these environment variables are set correctly:

```bash
# ChromaDB connection
CHROMA_URL=http://3.6.147.238:8000

# OpenAI API (for embeddings)
OPENAI_API_KEY=your_openai_api_key

# Optional: Chunking settings
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
```

### Enhanced Error Handling

The application now includes:

1. **Automatic Retry Logic**: Up to 3 attempts with collection reset
2. **Data Validation**: Comprehensive validation before sending to ChromaDB
3. **Better Error Messages**: Detailed error information for debugging
4. **Health Monitoring**: Real-time health checks via `/api/health`

### Common Error Messages and Solutions

#### "Failed to fetch http://3.6.147.238:8000/api/v2/..."
**Solution:** Check if ChromaDB server is running and accessible

#### "Array length mismatch"
**Solution:** Data validation error - check document structure

#### "Invalid embedding values"
**Solution:** Embedding generation failed - check OpenAI API key and quota

#### "Collection schema conflict"
**Solution:** Collection reset is automatically attempted

### Performance Optimization

If you're still experiencing issues:

1. **Reduce Batch Size**: Set smaller chunk sizes
2. **Check Memory Usage**: Ensure sufficient RAM for large documents
3. **Network Timeouts**: Increase timeout values for large uploads
4. **Rate Limiting**: Add delays between API calls

### Getting Help

If the issue persists:

1. Check the application logs for detailed error information
2. Run the test script and share the output
3. Verify ChromaDB server version compatibility
4. Check if the issue occurs with simple test documents

### Prevention

To prevent 422 errors:

1. Always validate documents before processing
2. Use the health check endpoint regularly
3. Monitor application logs for warnings
4. Keep ChromaDB server updated
5. Use the retry mechanism for failed operations 