# Vext-RAG Deployment Guide for Render

This guide will help you deploy your Vext-RAG application on Render.

## Prerequisites

1. A Render account (free tier available)
2. OpenAI API key
3. Mistral API key
4. Git repository with your Vext-RAG code

## Deployment Steps

### 1. Prepare Your Repository

Make sure your repository contains:
- `package.json` with all dependencies
- `src/index.js` (main application file)
- `render.yaml` (deployment configuration)
- All source files in the `src/` directory

### 2. Connect to Render

1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" and select "Blueprint"
3. Connect your GitHub/GitLab repository
4. Render will automatically detect the `render.yaml` file

### 3. Configure Environment Variables

In your Render dashboard, you'll need to set these environment variables:

#### Required Secrets (set as secrets in Render):
- `OPENAI_API_KEY` - Your OpenAI API key
- `MISTRAL_API_KEY` - Your Mistral API key

#### Optional Environment Variables:
- `NODE_ENV` - Set to "production"
- `PORT` - Set to 3000 (Render will override this)
- `CHUNK_SIZE` - Document chunk size (default: 1000)
- `CHUNK_OVERLAP` - Chunk overlap (default: 200)
- `AI_MODEL` - AI model to use (default: gpt-4o-mini)
- `AI_TEMPERATURE` - AI temperature (default: 0.7)
- `AI_MAX_TOKENS` - Max tokens for AI responses (default: 1000)

### 4. Deploy

1. Render will automatically build and deploy your application
2. The build process will:
   - Install Node.js dependencies
   - Build the application
   - Start the web service
3. Your application will be available at: `https://your-app-name.onrender.com`

### 5. Verify Deployment

1. Check the health endpoint: `https://your-app-name.onrender.com/health`
2. Test the API endpoints:
   - `GET /` - API information
   - `POST /api/ingest` - Document ingestion
   - `POST /api/query` - Query documents
   - `GET /api/documents` - List documents

## Important Notes

### Database Configuration
- The deployment uses PostgreSQL for metadata storage
- Vector embeddings are stored in-memory (not persistent across restarts)
- For production use, consider using a dedicated vector database service

### File Storage
- Uploaded files are stored in the application's file system
- Files are not persistent across deployments
- Consider using cloud storage (AWS S3, Google Cloud Storage) for production

### Limitations of Free Tier
- 750 hours per month
- 512MB RAM
- Shared CPU
- No persistent disk storage

## Troubleshooting

### Common Issues

1. **Build Failures**
   - Check the build logs in Render dashboard
   - Ensure all dependencies are in `package.json`
   - Verify Node.js version compatibility

2. **Environment Variables**
   - Make sure all required API keys are set
   - Check that variable names match exactly

3. **Database Connection**
   - Verify the PostgreSQL service is running
   - Check connection string format

4. **Memory Issues**
   - Free tier has 512MB RAM limit
   - Consider upgrading for larger document processing

### Logs and Monitoring

- View logs in the Render dashboard
- Monitor resource usage
- Set up alerts for downtime

## Production Considerations

For production deployment, consider:

1. **Upgrading to Paid Plan**
   - More RAM and CPU
   - Persistent disk storage
   - Custom domains

2. **Vector Database**
   - Use Pinecone, Weaviate, or Qdrant
   - Persistent vector storage
   - Better scalability

3. **File Storage**
   - AWS S3 or similar
   - CDN for static files
   - Backup strategy

4. **Monitoring**
   - Application performance monitoring
   - Error tracking
   - Usage analytics

## Support

If you encounter issues:
1. Check Render's documentation
2. Review application logs
3. Verify environment configuration
4. Test locally before deploying 