import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import documentProcessor from './utils/documentProcessor.js';
import textChunker from './utils/textChunker.js';
import vectorService from './services/vectorService.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize text chunker
const chunker = new textChunker({
  chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP) || 200
});

async function ingestDocuments(directoryPath, options = {}) {
  console.log('📚 Starting document ingestion...\n');

  try {
    // Initialize vector database
    await vectorService.initialize();

    // Get all files in the directory
    const files = await getSupportedFiles(directoryPath);
    
    if (files.length === 0) {
      console.log('No supported files found in the directory.');
      return;
    }

    console.log(`Found ${files.length} supported files to process:\n`);

    let processedCount = 0;
    let errorCount = 0;
    const results = [];

    for (const file of files) {
      try {
        console.log(`Processing: ${file.name}`);
        
        // Process document
        const processedDoc = await documentProcessor.processDocument(file.path, {
          source: 'batch_ingest',
          ingestedAt: new Date().toISOString()
        });

        // Chunk the text
        const chunks = chunker.chunkText(processedDoc.text);
        const chunkStats = chunker.getChunkStats(chunks);

        // Prepare documents for vector database
        const documents = chunks.map((chunk, index) => ({
          text: chunk.text,
          metadata: {
            ...processedDoc.metadata,
            chunkIndex: index,
            totalChunks: chunks.length,
            chunkStart: chunk.start,
            chunkEnd: chunk.end
          }
        }));

        // Add to vector database
        const documentIds = await vectorService.addDocuments(documents);

        results.push({
          filename: file.name,
          success: true,
          chunks: chunks.length,
          documentIds,
          stats: chunkStats
        });

        processedCount++;
        console.log(`  ✓ Processed successfully (${chunks.length} chunks)\n`);

      } catch (error) {
        console.error(`  ❌ Error processing ${file.name}:`, error.message);
        
        results.push({
          filename: file.name,
          success: false,
          error: error.message
        });

        errorCount++;
      }
    }

    // Print summary
    printSummary(processedCount, errorCount, results);

  } catch (error) {
    console.error('❌ Ingestion failed:', error.message);
    process.exit(1);
  }
}

async function getSupportedFiles(directoryPath) {
  const files = [];
  
  try {
    const items = await fs.readdir(directoryPath, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isFile()) {
        const filePath = path.join(directoryPath, item.name);
        
        if (documentProcessor.isSupportedFormat(item.name)) {
          files.push({
            name: item.name,
            path: filePath
          });
        }
      }
    }
  } catch (error) {
    throw new Error(`Failed to read directory: ${error.message}`);
  }

  return files;
}

function printSummary(processedCount, errorCount, results) {
  console.log('\n📊 Ingestion Summary');
  console.log('==================');
  console.log(`✅ Successfully processed: ${processedCount} files`);
  console.log(`❌ Failed to process: ${errorCount} files`);
  console.log(`📄 Total files: ${processedCount + errorCount}`);
  
  if (processedCount > 0) {
    const totalChunks = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.chunks, 0);
    console.log(`🔢 Total chunks created: ${totalChunks}`);
  }

  console.log('\n📋 Detailed Results:');
  console.log('==================');
  
  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.filename} (${result.chunks} chunks)`);
    } else {
      console.log(`❌ ${result.filename}: ${result.error}`);
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node src/ingest.js <directory_path> [options]');
    console.log('\nOptions:');
    console.log('  --help     Show this help message');
    console.log('\nExample:');
    console.log('  node src/ingest.js ./documents');
    process.exit(1);
  }

  if (args.includes('--help')) {
    console.log('Vext RAG System - Document Ingestion Tool');
    console.log('==========================================');
    console.log('\nUsage: node src/ingest.js <directory_path> [options]');
    console.log('\nArguments:');
    console.log('  directory_path    Path to directory containing documents');
    console.log('\nOptions:');
    console.log('  --help            Show this help message');
    console.log('\nSupported file formats:');
    console.log('  - PDF (.pdf)');
    console.log('  - Word (.docx)');
    console.log('  - Text (.txt)');
    console.log('  - HTML (.html, .htm)');
    console.log('\nEnvironment variables:');
    console.log('  CHUNK_SIZE        Size of text chunks (default: 1000)');
    console.log('  CHUNK_OVERLAP     Overlap between chunks (default: 200)');
    console.log('  OPENAI_API_KEY    OpenAI API key for embeddings');
    console.log('  CHROMA_URL        ChromaDB URL (default: http://localhost:8000)');
    process.exit(0);
  }

  const directoryPath = args[0];
  
  // Validate directory exists
  try {
    await fs.access(directoryPath);
  } catch {
    console.error(`❌ Directory not found: ${directoryPath}`);
    process.exit(1);
  }

  await ingestDocuments(directoryPath);
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default ingestDocuments; 