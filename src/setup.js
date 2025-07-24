import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import vextService from './services/vextService.js';
import vectorService from './services/vectorService.js';
import aiService from './services/aiService.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function setup() {
  console.log('🚀 Setting up Vext RAG System...\n');

  try {
    // Create necessary directories
    await createDirectories();

    // Validate environment variables
    validateEnvironment();

    // Test services
    await testServices();

    // Initialize vector database
    await initializeVectorDatabase();

    console.log('\n✅ Setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Start the server: npm start');
    console.log('2. Upload documents: POST /api/ingest');
    console.log('3. Ask questions: POST /api/query');
    console.log('\n📚 API Documentation: http://3.6.147.238:3000');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

async function createDirectories() {
  console.log('📁 Creating directories...');

  const directories = [
    'uploads',
    'logs',
    'data'
  ];

  for (const dir of directories) {
    const dirPath = path.join(__dirname, '..', dir);
    try {
      await fs.access(dirPath);
      console.log(`   ✓ ${dir} directory already exists`);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      console.log(`   ✓ Created ${dir} directory`);
    }
  }
}

function validateEnvironment() {
  console.log('\n🔧 Validating environment variables...');

  const requiredVars = [
    'OPENAI_API_KEY'
  ];

  const missingVars = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    } else {
      console.log(`   ✓ ${varName} is configured`);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Optional variables
  const optionalVars = [
    'PORT',
    'CHROMA_URL',
    'CHUNK_SIZE',
    'CHUNK_OVERLAP'
  ];

  for (const varName of optionalVars) {
    if (process.env[varName]) {
      console.log(`   ✓ ${varName} is configured: ${process.env[varName]}`);
    } else {
      console.log(`   ⚠ ${varName} not configured (using default)`);
    }
  }
}

async function testServices() {
  console.log('\n🧪 Testing services...');

  // Test Vext service
  console.log('   Testing Vext service...');
  const vextValid = await vextService.validateService();
  if (vextValid) {
    console.log('   ✓ Vext service is working');
    const dimensions = await vextService.getEmbeddingDimensions();
    console.log(`   ✓ Embedding dimensions: ${dimensions}`);
  } else {
    throw new Error('Vext service validation failed');
  }

  // Test AI service
  console.log('   Testing AI service...');
  const aiValid = await aiService.validateService();
  if (aiValid) {
    console.log('   ✓ AI service is working');
    const models = await aiService.getAvailableModels();
    console.log(`   ✓ Available models: ${models.slice(0, 3).join(', ')}...`);
  } else {
    throw new Error('AI service validation failed');
  }
}

async function initializeVectorDatabase() {
  console.log('\n🗄️ Initializing vector database...');

  try {
    await vectorService.initialize();
    console.log('   ✓ Vector database initialized');
    
    const stats = await vectorService.getCollectionStats();
    console.log(`   ✓ Collection stats: ${stats.totalDocuments} documents`);
  } catch (error) {
    console.error('   ⚠ Vector database initialization failed:', error.message);
    console.log('   ℹ Make sure ChromaDB is running or update CHROMA_URL in .env');
  }
}

// Run setup if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setup();
}

export default setup; 