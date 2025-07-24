# Quick Start Guide - Vext RAG System

Get your RAG system up and running in minutes! 🚀

## Prerequisites

- Node.js 18+ installed
- Docker (optional, for ChromaDB)
- API key for OpenAI

## Step 1: Clone and Install

```bash
# Clone the repository (if not already done)
git clone <your-repo-url>
cd Vext-RAG

# Install dependencies
npm install
```

## Step 2: Configure Environment

```bash
# Copy the example environment file
cp env.example .env

# Edit .env with your API keys
nano .env
```

Fill in your API keys:
```env
OPENAI_API_KEY=your_openai_api_key_here
MISTRAL_API_KEY=your_mistral_api_key_here
PORT=3000
```

### OCR Configuration (Optional)
For document OCR functionality, make sure to use a vision-enabled model:
```env
OCR_MODEL=mistral-ocr-latest
OCR_INCLUDE_IMAGES=false
OCR_MAX_FILE_SIZE=52428800
```

## Step 3: Start ChromaDB (Choose One Option)

### Option A: Using Docker (Recommended)
```bash
# Start ChromaDB with Docker
docker run -d \
  --name chromadb \
  -p 8000:8000 \
  -v chroma_data:/chroma/chroma \
  chromadb/chroma:latest
```

### Option B: Using Docker Compose
```bash
# Start both ChromaDB and the RAG system
docker-compose up -d chromadb
```

### Option C: Install ChromaDB Locally
```bash
pip install chromadb
chroma run --host 0.0.0.0 --port 8000
```

## Step 4: Initialize the System

```bash
# Run the setup script
npm run setup
```

This will:
- ✅ Validate your environment configuration
- ✅ Test all services (OpenAI, ChromaDB)
- ✅ Initialize the vector database
- ✅ Create necessary directories

## Step 5: Start the Server

```bash
# Start the RAG system
npm start
```

You should see:
```
🚀 Vext RAG System server running on port 3000
📚 API Documentation: http://localhost:3000
🏥 Health Check: http://localhost:3000/health
```

## Step 6: Test the System

### Option A: Use the Web Interface
Open your browser and go to: http://localhost:3000

### Option B: Use the API Directly

```bash
# Test the health endpoint
curl http://localhost:3000/health

# Upload a document
curl -X POST http://localhost:3000/api/ingest \
  -F "file=@your-document.pdf" \
  -F 'metadata={"title":"Test Document"}'

# Ask a question
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is this document about?"}'
```

## Step 7: Run Tests (Optional)

```bash
# Run the test suite
npm test
```

## Common Issues & Solutions

### ❌ "OPENAI_API_KEY is not configured"
- Make sure you have a valid OpenAI API key
- Check that your `.env` file is in the project root
- Verify the key is correctly copied (no extra spaces)

### ❌ "OPENAI_API_KEY is not configured"
- Get an API key from https://platform.openai.com/api-keys
- Add it to your `.env` file

### ❌ "Failed to connect to ChromaDB"
- Make sure ChromaDB is running on port 8000
- Check if Docker containers are running: `docker ps`
- Try restarting ChromaDB: `docker restart chromadb`

### ❌ "Port 3000 is already in use"
- Change the port in your `.env` file: `PORT=3001`
- Or kill the process using port 3000

### ❌ "Image input is not enabled for this model"
- Make sure you're using a vision-enabled model: `OCR_MODEL=mistral-ocr-latest`
- Check that your `MISTRAL_API_KEY` is valid
- Ensure you have sufficient API credits for OCR processing

## Next Steps

1. **Upload Documents**: Use the web interface or API to upload your first documents
2. **Ask Questions**: Start querying your knowledge base
3. **Customize**: Modify chunk sizes, models, and other settings in `.env`
4. **Scale**: Add more documents and explore advanced features

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web interface |
| `/health` | GET | Health check |
| `/api/ingest` | POST | Upload documents |
| `/api/query` | POST | Ask questions |
| `/api/documents` | GET | List documents |
| `/api/stats` | GET | System statistics |
| `/api/summarize` | POST | Generate summaries |
| `/api/topics` | POST | Extract topics |

## Support

- 📖 Read the full [README.md](README.md) for detailed documentation
- 🐛 Report issues on GitHub
- 💬 Join our community discussions

Happy RAG-ing! 🎉 