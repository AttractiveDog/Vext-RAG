# Vext RAG System

A powerful Retrieval-Augmented Generation (RAG) system built with Vext for intelligent document retrieval and question answering.

## Features

- **Document Ingestion**: Support for PDF, DOCX, TXT, and HTML files
- **Keep-Alive Processing**: Real-time progress tracking with Server-Sent Events (SSE) to prevent timeouts
- **Vector Embeddings**: Using Hugging Face's all-MiniLM-L6-v2 for local, high-quality text embeddings (384D)
- **Semantic Search**: Advanced retrieval using vector similarity
- **Question Answering**: AI-powered responses with context from retrieved documents
- **RESTful API**: Easy integration with web applications
- **Real-time Processing**: Stream documents and get instant responses
- **Web Interface**: User-friendly web UI for document management and queries
- **Docker Support**: Easy deployment with Docker and Docker Compose
- **Health Monitoring**: Built-in health checks and system statistics

## Prerequisites

- **Node.js 18+** - Required for running the application
- **Docker** (optional) - For running ChromaDB vector database
- **OpenAI API Key** - Optional, only required if using OpenAI embeddings or for AI generation
- **ChromaDB** - Vector database (can be run locally or via Docker)

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Document      │    │   HuggingFace   │    │   Vector        │
│   Ingestion     │───▶│   Embeddings    │───▶│   Database      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Text          │    │   Semantic      │    │   Context       │
│   Processing    │    │   Search        │    │   Retrieval     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       ▼                       ▼
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Chunking      │    │   Similarity    │    │   Answer        │
│   & Indexing    │    │   Matching      │    │   Generation    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd Vext-RAG

# Install dependencies
npm install
```

### 2. Environment Setup

Create a `.env` file:

```env
# API Keys
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
PORT=3000

# Vector Database Configuration
CHROMA_URL=http://3.6.147.238:8000

# Document Processing Configuration
CHUNK_SIZE=1000
CHUNK_OVERLAP=200

# Optional: AI Model Configuration
AI_MODEL=gpt-4o-mini
AI_TEMPERATURE=0.7
AI_MAX_TOKENS=1000
```

### 3. Start ChromaDB (Choose One Option)

#### Option A: Using Docker (Recommended)
```bash
docker run -d \
  --name chromadb \
  -p 8000:8000 \
  -v chroma_data:/chroma/chroma \
  chromadb/chroma:latest
```

#### Option B: Using Docker Compose
```bash
docker-compose up -d chromadb
```

#### Option C: Install ChromaDB Locally
```bash
pip install chromadb
chroma run --host 0.0.0.0 --port 8000
```

### 4. Initialize the System

```bash
npm run setup
```

### 5. Start the Server

```bash
# Production mode
npm start

# Development mode with auto-reload
npm run dev
```

## API Endpoints

### Core Endpoints

#### POST /api/ingest
Upload and process documents

**Request:**
```bash
curl -X POST http://3.6.147.238:3000/api/ingest \
  -F "file=@document.pdf" \
  -F 'metadata={"title":"Sample Document","author":"John Doe"}'
```

**Response:**
```json
{
  "success": true,
  "documentId": "uuid",
  "message": "Document processed successfully",
  "chunks": 15
}
```

#### POST /api/query
Ask questions and get AI-powered answers

**Request:**
```json
{
  "question": "What are the main topics discussed in the documents?",
  "maxResults": 5
}
```

**Response:**
```json
{
  "answer": "Based on the documents...",
  "sources": [
    {
      "documentId": "uuid",
      "title": "Document Title",
      "content": "Relevant text chunk...",
      "similarity": 0.95
    }
  ],
  "confidence": 0.92
}
```

#### GET /api/documents
List all ingested documents

**Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "Document Title",
      "author": "Author Name",
      "uploadDate": "2024-01-01T00:00:00Z",
      "chunks": 15,
      "fileSize": 1024000
    }
  ]
}
```

#### DELETE /api/documents/:id
Delete a specific document

### Additional Endpoints

#### GET /health
Health check endpoint

#### GET /api/stats
System statistics and performance metrics

#### POST /api/summarize
Generate document summaries

#### POST /api/topics
Extract topics from documents

## Usage Examples

### Ingesting Documents

```bash
# Upload a PDF document
curl -X POST http://3.6.147.238:3000/api/ingest \
  -F "file=@document.pdf" \
  -F 'metadata={"title":"Technical Manual","author":"Engineering Team"}'

# Upload multiple documents
for file in *.pdf; do
  curl -X POST http://3.6.147.238:3000/api/ingest \
    -F "file=@$file" \
    -F "metadata={\"title\":\"$(basename $file .pdf)\"}"
done
```

### Querying the System

```bash
# Basic question
curl -X POST http://3.6.147.238:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the main topics discussed in the documents?"}'

# Question with specific parameters
curl -X POST http://3.6.147.238:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Explain the technical specifications",
    "maxResults": 10,
    "minSimilarity": 0.8
  }'
```

### Web Interface

Access the web interface at `http://3.6.147.238:3000` for:
- Document upload and management
- Interactive question asking
- System statistics and monitoring
- Document search and filtering

## Configuration

The system can be configured through environment variables:

### Required Configuration
- `OPENAI_API_KEY`: Your OpenAI API key for embeddings and text generation
- `PORT`: Server port (default: 3000)
- `CHROMA_URL`: ChromaDB connection URL (default: http://3.6.147.238:8000)

### Document Processing
- `CHUNK_SIZE`: Document chunk size in characters (default: 1000)
- `CHUNK_OVERLAP`: Overlap between chunks in characters (default: 200)

### AI Model Configuration
- `AI_MODEL`: OpenAI model to use (default: gpt-4o-mini)
- `AI_TEMPERATURE`: Response creativity (0.0-1.0, default: 0.7)
- `AI_MAX_TOKENS`: Maximum response length (default: 1000)

### Optional Configuration
- `LOG_LEVEL`: Logging level (debug, info, warn, error)
- `LOG_FILE`: Log file path

## Deployment

### Docker Deployment

#### Using Docker Compose (Recommended)
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

#### Manual Docker Deployment
```bash
# Build the image
docker build -t vext-rag .

# Run the container
docker run -d \
  --name vext-rag \
  -p 3000:3000 \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  vext-rag
```

### Production Deployment

1. **Environment Setup**
   ```bash
   # Set production environment
   export NODE_ENV=production
   
   # Use environment-specific configuration
   cp .env.production .env
   ```

2. **Process Management**
   ```bash
   # Using PM2
   npm install -g pm2
   pm2 start src/index.js --name "vext-rag"
   pm2 startup
   pm2 save
   ```

3. **Reverse Proxy (Nginx)**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://3.6.147.238:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

## Troubleshooting

### Common Issues

#### ❌ "OPENAI_API_KEY is not configured"
- Verify your `.env` file exists and contains the correct API key
- Get an API key from https://platform.openai.com/api-keys
- Ensure no extra spaces or quotes around the key

#### ❌ "Failed to connect to ChromaDB"
- Check if ChromaDB is running: `docker ps | grep chromadb`
- Verify the connection URL in your `.env` file
- Try restarting ChromaDB: `docker restart chromadb`

#### ❌ "Port 3000 is already in use"
- Change the port in your `.env` file: `PORT=3001`
- Or kill the process: `lsof -ti:3000 | xargs kill -9`

#### ❌ "Document processing failed"
- Check file format support (PDF, DOCX, TXT, HTML)
- Verify file size limits
- Check logs for specific error messages

### Performance Optimization

1. **Chunk Size Tuning**
   - Increase `CHUNK_SIZE` for longer context
   - Decrease for more precise retrieval

2. **Vector Database Optimization**
   - Use SSD storage for ChromaDB
   - Monitor memory usage
   - Consider clustering for large datasets

3. **API Rate Limiting**
   - Implement rate limiting for production use
   - Monitor OpenAI API usage and costs

## Testing

### Run Tests
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Test Coverage
The test suite covers:
- Document ingestion and processing
- Vector search functionality
- API endpoint responses
- Error handling scenarios

## Project Structure

```
src/
├── index.js              # Main server file
├── setup.js              # System initialization
├── ingest.js             # Document ingestion CLI
├── services/
│   ├── vextService.js    # OpenAI embeddings integration
│   ├── vectorService.js  # Vector database operations
│   ├── aiService.js      # AI/LLM operations
│   └── questionHistoryService.js  # Query history management
├── utils/
│   ├── documentProcessor.js  # Document parsing
│   └── textChunker.js       # Text chunking
└── routes/
    └── api.js            # API routes

test/
├── test.js               # Test suite
└── data/                 # Test data files

uploads/                  # Document upload directory
data/                     # Application data
logs/                     # Log files (if enabled)
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Add tests if applicable
5. Ensure all tests pass: `npm test`
6. Commit your changes: `git commit -m 'Add amazing feature'`
7. Push to the branch: `git push origin feature/amazing-feature`
8. Submit a pull request

### Development Setup
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## License

MIT License - see LICENSE file for details

## Support

- 📖 **Documentation**: Check the [QUICKSTART.md](QUICKSTART.md) for detailed setup instructions
- 🐛 **Issues**: Report bugs and feature requests on GitHub
- 💬 **Discussions**: Join community discussions
- 📧 **Contact**: Reach out for enterprise support

## Changelog

### v1.0.0
- Initial release
- Document ingestion and processing
- Vector search and retrieval
- AI-powered question answering
- RESTful API
- Web interface
- Docker support 