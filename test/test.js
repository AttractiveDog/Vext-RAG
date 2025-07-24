import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import vextService from '../src/services/vextService.js';
import vectorService from '../src/services/vectorService.js';
import aiService from '../src/services/aiService.js';
import documentProcessor from '../src/utils/documentProcessor.js';
import textChunker from '../src/utils/textChunker.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TestSuite {
  constructor() {
    this.results = [];
    this.chunker = new textChunker();
  }

  async runAllTests() {
    console.log('🧪 Running Vext RAG System Tests...\n');

    try {
      await this.testEnvironment();
      await this.testVextService();
      await this.testAIService();
      await this.testVectorService();
      await this.testDocumentProcessor();
      await this.testTextChunker();
      await this.testIntegration();

      this.printResults();
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    }
  }

  async testEnvironment() {
    console.log('🔧 Testing Environment Configuration...');
    
    const requiredVars = ['OPENAI_API_KEY'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      this.addResult('Environment', false, `Missing environment variables: ${missing.join(', ')}`);
    } else {
      this.addResult('Environment', true, 'All required environment variables are configured');
    }
  }

  async testVextService() {
    console.log('🔤 Testing Vext Service...');
    
    try {
      const isValid = await vextService.validateService();
      if (isValid) {
        const dimensions = await vextService.getEmbeddingDimensions();
        this.addResult('Vext Service', true, `Service is working. Embedding dimensions: ${dimensions}`);
      } else {
        this.addResult('Vext Service', false, 'Service validation failed');
      }
    } catch (error) {
      this.addResult('Vext Service', false, error.message);
    }
  }

  async testAIService() {
    console.log('🤖 Testing AI Service...');
    
    try {
      const isValid = await aiService.validateService();
      if (isValid) {
        const models = await aiService.getAvailableModels();
        this.addResult('AI Service', true, `Service is working. Available models: ${models.slice(0, 3).join(', ')}...`);
      } else {
        this.addResult('AI Service', false, 'Service validation failed');
      }
    } catch (error) {
      this.addResult('AI Service', false, error.message);
    }
  }

  async testVectorService() {
    console.log('🗄️ Testing Vector Service...');
    
    try {
      await vectorService.initialize();
      const stats = await vectorService.getCollectionStats();
      this.addResult('Vector Service', true, `Service is working. Collection stats: ${stats.totalDocuments} documents`);
    } catch (error) {
      this.addResult('Vector Service', false, error.message);
    }
  }

  async testDocumentProcessor() {
    console.log('📄 Testing Document Processor...');
    
    try {
      // Test supported formats
      const supportedFormats = documentProcessor.getSupportedFormats();
      const expectedFormats = ['pdf', 'docx', 'txt', 'html', 'htm'];
      
      const allSupported = expectedFormats.every(format => 
        supportedFormats.includes(format)
      );
      
      if (allSupported) {
        this.addResult('Document Processor', true, `All expected formats supported: ${supportedFormats.join(', ')}`);
      } else {
        this.addResult('Document Processor', false, `Missing formats. Expected: ${expectedFormats.join(', ')}, Got: ${supportedFormats.join(', ')}`);
      }
    } catch (error) {
      this.addResult('Document Processor', false, error.message);
    }
  }

  async testTextChunker() {
    console.log('✂️ Testing Text Chunker...');
    
    try {
      const testText = 'This is a test document. It contains multiple sentences. Each sentence should be properly chunked. The chunker should handle various text lengths appropriately.';
      
      const chunks = this.chunker.chunkText(testText, { chunkSize: 50, chunkOverlap: 10 });
      const stats = this.chunker.getChunkStats(chunks);
      
      if (chunks.length > 0 && stats.totalChunks > 0) {
        this.addResult('Text Chunker', true, `Successfully chunked text into ${chunks.length} chunks`);
      } else {
        this.addResult('Text Chunker', false, 'Failed to create chunks');
      }
    } catch (error) {
      this.addResult('Text Chunker', false, error.message);
    }
  }

  async testIntegration() {
    console.log('🔗 Testing Integration...');
    
    try {
      // Test end-to-end workflow
      const testText = 'This is a test document for integration testing. It contains information about artificial intelligence and machine learning.';
      
      // Generate embeddings
      const embeddings = await vextService.generateEmbeddings([testText]);
      
      if (embeddings && embeddings.length > 0) {
        // Test vector similarity
        const similarity = vextService.calculateSimilarity(embeddings[0], embeddings[0]);
        
        if (similarity > 0.99) { // Should be very similar to itself
          this.addResult('Integration', true, 'End-to-end workflow working correctly');
        } else {
          this.addResult('Integration', false, 'Vector similarity calculation failed');
        }
      } else {
        this.addResult('Integration', false, 'Failed to generate embeddings');
      }
    } catch (error) {
      this.addResult('Integration', false, error.message);
    }
  }

  addResult(testName, passed, message) {
    this.results.push({
      test: testName,
      passed,
      message,
      timestamp: new Date().toISOString()
    });
    
    const status = passed ? '✅' : '❌';
    console.log(`  ${status} ${testName}: ${message}`);
  }

  printResults() {
    console.log('\n📊 Test Results Summary');
    console.log('======================');
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const failed = total - passed;
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ❌`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  - ${r.test}: ${r.message}`);
        });
    }
    
    if (passed === total) {
      console.log('\n🎉 All tests passed! The RAG system is ready to use.');
    } else {
      console.log('\n⚠️ Some tests failed. Please check the configuration and try again.');
      process.exit(1);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new TestSuite();
  testSuite.runAllTests();
}

export default TestSuite; 