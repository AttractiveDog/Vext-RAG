import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import apiRoutes from './routes/api.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files (web interface)
app.use(express.static(join(__dirname, '../public')));

// Configure multer for file uploads with user-specific directories
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Extract user ID from request body or query params
    const userId = req.body.userId || req.query.userId || 'default';
    
    // Create user-specific upload directory
    const userUploadDir = join(__dirname, '../uploads/', userId);
    
    // Ensure the directory exists
    import('fs').then(fs => {
      fs.mkdirSync(userUploadDir, { recursive: true });
      cb(null, userUploadDir);
    }).catch(err => {
      cb(err);
    });
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/html'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, TXT, and HTML files are allowed.'), false);
    }
  }
});

// Make upload available to routes
app.locals.upload = upload;

// API Routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'Vext RAG System'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Vext RAG System API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      ingest: '/api/ingest',
      query: '/api/query',
      documents: '/api/documents'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    error: error.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Vext RAG System server running on port ${PORT}`);
  console.log(`📚 API Documentation: http://3.6.147.238:${PORT}`);
  console.log(`🏥 Health Check: http://3.6.147.238:${PORT}/health`);
});

export default app; 