# Keep-Alive Document Processing System

## Overview

The Vext-RAG system now includes a robust keep-alive mechanism for document processing that prevents connection timeouts and provides real-time progress updates during long-running operations.

## How It Works

### Server-Sent Events (SSE)
The system uses **Server-Sent Events (SSE)** to maintain an active connection between the client and server during document processing. This allows for:

- **Real-time progress updates** every 2 seconds
- **Keep-alive packets** to prevent connection timeouts
- **Automatic cleanup** of resources after completion
- **Error handling** for connection drops

### Processing Stages

The document processing follows these stages with progress tracking:

1. **Starting** (0%) - Initializing document processing
2. **Validating** (10%) - Checking file format and size
3. **Processing** (25%) - Extracting text content
4. **Chunking** (50%) - Breaking document into searchable chunks
5. **Preparing** (70%) - Preparing chunks for vector database
6. **Vectorizing** (85%) - Adding chunks to vector database
7. **Cleanup** (95%) - Cleaning up temporary files
8. **Complete** (100%) - Processing finished successfully

## API Endpoints

### 1. POST `/api/ingest`
**Enhanced upload endpoint with progress tracking**

**Request:**
```javascript
const formData = new FormData();
formData.append('file', file);
formData.append('userId', 'user123');
formData.append('metadata', JSON.stringify({title: 'Document Title'}));

const response = await fetch('/api/ingest', {
    method: 'POST',
    body: formData
});

const result = await response.json();
// Returns: { success: true, jobId: 'uuid-here', message: '...' }
```

**Response:**
```json
{
    "success": true,
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "message": "Document processing started. Use the job ID to track progress.",
    "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 2. GET `/api/ingest/progress/:jobId`
**SSE endpoint for real-time progress updates**

**Usage:**
```javascript
const eventSource = new EventSource(`/api/ingest/progress/${jobId}`);

eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
        case 'connected':
            console.log('SSE connection established');
            break;
            
        case 'progress':
            console.log(`Progress: ${data.progress}% - ${data.message}`);
            break;
            
        case 'complete':
            console.log('Processing completed!', data.data);
            eventSource.close();
            break;
            
        case 'error':
            console.error('Processing failed:', data.message);
            eventSource.close();
            break;
            
        case 'keepalive':
            // Connection is alive, no action needed
            break;
    }
};
```

**Event Types:**
- `connected` - Initial connection established
- `progress` - Progress update with stage and percentage
- `complete` - Processing completed successfully
- `error` - Processing failed
- `timeout` - Connection timeout (10 minutes)
- `keepalive` - Keep-alive packet (every 2 seconds)

### 3. GET `/api/ingest/status/:jobId`
**Check processing status**

**Usage:**
```javascript
const response = await fetch(`/api/ingest/status/${jobId}`);
const result = await response.json();

if (result.status === 'complete') {
    console.log('Processing completed:', result.data);
} else if (result.status === 'processing') {
    console.log('Still processing:', result.data);
} else {
    console.log('Job not found');
}
```

## Frontend Implementation

### Basic Usage

```javascript
async function uploadDocument() {
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('userId', userIdInput.value);
    
    // Start upload
    const response = await fetch('/api/ingest', {
        method: 'POST',
        body: formData
    });
    
    const result = await response.json();
    
    if (result.success && result.jobId) {
        // Track progress
        trackUploadProgress(result.jobId);
    }
}

function trackUploadProgress(jobId) {
    const eventSource = new EventSource(`/api/ingest/progress/${jobId}`);
    
    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'progress':
                updateProgressBar(data.progress, data.message, data.stage);
                break;
                
            case 'complete':
                showSuccessMessage(data.data);
                eventSource.close();
                break;
                
            case 'error':
                showErrorMessage(data.message);
                eventSource.close();
                break;
        }
    };
    
    eventSource.onerror = function(event) {
        console.error('SSE connection error:', event);
        showErrorMessage('Connection lost. Processing may continue in background.');
        eventSource.close();
    };
}
```

### Progress Bar Component

```javascript
function updateProgressBar(progress, message, stage) {
    const stageEmojis = {
        'starting': '🚀',
        'validating': '✅',
        'processing': '⚡',
        'chunking': '📄',
        'preparing': '🔧',
        'vectorizing': '🧠',
        'cleanup': '🧹',
        'complete': '🎉',
        'error': '❌'
    };
    
    const emoji = stageEmojis[stage] || '⏳';
    
    progressElement.innerHTML = `
        <div class="progress-container">
            <div class="progress-header">
                <span class="progress-emoji">${emoji}</span>
                <span class="progress-message">${message}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%;"></div>
            </div>
            <div class="progress-text">${progress}% Complete</div>
            <div class="progress-stage">Stage: ${stage}</div>
        </div>
    `;
}
```

## Configuration

### Server-Side Configuration

The system uses these default settings:

```javascript
// Progress tracking storage
const processingProgress = new Map();
const processingResults = new Map();

// Keep-alive interval (2 seconds)
const keepAliveInterval = 2000;

// Completion check interval (5 seconds)
const completionCheckInterval = 5000;

// Connection timeout (10 minutes)
const connectionTimeout = 600000;

// Progress cleanup delay (30 seconds)
const cleanupDelay = 30000;
```

### Environment Variables

No additional environment variables are required. The system works with existing configuration.

## Benefits

### 1. No More Timeouts
- Connection stays alive during long processing operations
- Keep-alive packets prevent browser/proxy timeouts
- Automatic reconnection handling

### 2. Real-Time Feedback
- Users see exactly what's happening during processing
- Progress percentage and stage information
- Visual progress bar with animations

### 3. Better Error Handling
- Graceful handling of connection drops
- Clear error messages for different failure types
- Background processing continues even if frontend disconnects

### 4. Resource Management
- Automatic cleanup of progress tracking data
- Memory-efficient storage using Maps
- Timeout protection for long-running operations

### 5. Scalability
- Can handle multiple concurrent document uploads
- Each job has its own progress tracking
- No interference between different uploads

## Troubleshooting

### Common Issues

1. **Connection Lost**
   - The system will show a warning but continue processing
   - Check the status endpoint to see if processing completed
   - Refresh the page and check document list

2. **Progress Not Updating**
   - Check browser console for SSE connection errors
   - Verify the server is running and accessible
   - Check network connectivity

3. **Long Processing Times**
   - Large documents may take several minutes
   - The system shows warnings for operations taking longer than expected
   - Check server logs for detailed progress information

4. **Memory Issues**
   - Progress data is automatically cleaned up after 30 seconds
   - Each job uses minimal memory
   - Server restarts will clear all progress data

### Debug Information

Enable debug logging by setting the environment variable:
```bash
DEBUG=vext-rag:progress
```

This will show detailed progress tracking information in the server logs.

## Testing

### Manual Testing
1. Start the server: `npm start`
2. Open the web interface
3. Upload a large document (PDF, DOCX, etc.)
4. Watch the real-time progress updates
5. Verify the connection stays alive

### Automated Testing
Run the test script:
```bash
node test_keep_alive.js
```

This will test:
- SSE endpoint accessibility
- Status endpoint functionality
- Health endpoint availability

## Migration from Old System

The keep-alive system is backward compatible. Existing code will continue to work, but you can enhance it by:

1. **Adding progress tracking** to upload functions
2. **Implementing SSE listeners** for real-time updates
3. **Using the status endpoint** to check completion
4. **Adding visual progress indicators** to your UI

## Performance Considerations

- **Memory Usage**: Minimal - only stores progress data for active jobs
- **Network Overhead**: Low - keep-alive packets are small (JSON)
- **Server Load**: Minimal - SSE connections are lightweight
- **Browser Compatibility**: Excellent - SSE is supported in all modern browsers

## Security

- **CORS**: SSE endpoints include proper CORS headers
- **User Isolation**: Progress tracking respects user ID isolation
- **Input Validation**: All inputs are validated before processing
- **Resource Limits**: Timeouts prevent resource exhaustion

## Future Enhancements

Potential improvements for future versions:

1. **WebSocket Support**: For even more real-time communication
2. **Progress Persistence**: Save progress across server restarts
3. **Batch Processing**: Handle multiple documents simultaneously
4. **Advanced Analytics**: Track processing performance metrics
5. **Custom Progress Stages**: Allow custom progress indicators

---

This keep-alive system ensures that users can upload large documents without worrying about connection timeouts, while providing clear feedback about the processing status.
