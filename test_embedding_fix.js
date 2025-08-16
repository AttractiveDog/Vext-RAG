import huggingFaceEmbeddingService from './src/services/huggingFaceEmbeddingService.js';

async function testEmbeddingService() {
  try {
    console.log('🧪 Testing Hugging Face Embedding Service...');
    
    // Test 1: Single text embedding
    console.log('\n📝 Test 1: Single text embedding');
    const singleText = 'This is a test sentence for embedding generation.';
    const singleEmbedding = await huggingFaceEmbeddingService.embedText(singleText);
    console.log(`✅ Single embedding generated: ${singleEmbedding.length} dimensions`);
    
    // Test 2: Multiple texts (small batch)
    console.log('\n📝 Test 2: Small batch of texts');
    const smallBatch = [
      'First test sentence.',
      'Second test sentence.',
      'Third test sentence.',
      'Fourth test sentence.',
      'Fifth test sentence.'
    ];
    const smallBatchEmbeddings = await huggingFaceEmbeddingService.generateEmbeddings(smallBatch);
    console.log(`✅ Small batch embeddings generated: ${smallBatchEmbeddings.length} embeddings`);
    
    // Test 3: Larger batch to test memory management
    console.log('\n📝 Test 3: Larger batch (20 texts)');
    const largeBatch = Array.from({ length: 20 }, (_, i) => 
      `Test sentence number ${i + 1} for memory management testing.`
    );
    const largeBatchEmbeddings = await huggingFaceEmbeddingService.generateEmbeddings(largeBatch);
    console.log(`✅ Large batch embeddings generated: ${largeBatchEmbeddings.length} embeddings`);
    
    // Test 4: Memory usage check
    console.log('\n📊 Test 4: Memory usage check');
    huggingFaceEmbeddingService.logMemoryUsage('Final');
    
    // Test 5: Service validation
    console.log('\n🔍 Test 5: Service validation');
    const isValid = await huggingFaceEmbeddingService.validateService();
    console.log(`✅ Service validation: ${isValid ? 'PASSED' : 'FAILED'}`);
    
    // Test 6: Model info
    console.log('\n📋 Test 6: Model information');
    const modelInfo = huggingFaceEmbeddingService.getModelInfo();
    console.log('✅ Model info:', modelInfo);
    
    console.log('\n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error stack:', error.stack);
  } finally {
    // Cleanup
    await huggingFaceEmbeddingService.cleanup();
    console.log('🧹 Cleanup completed');
  }
}

// Run the test
testEmbeddingService();
