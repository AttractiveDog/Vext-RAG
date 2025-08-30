import huggingFaceEmbeddingService from './src/services/huggingFaceEmbeddingService.js';
import { performance } from 'perf_hooks';

async function testMemoryUsage() {
  console.log('🧪 Testing memory usage with improved embedding service...\n');

  // Test texts
  const testTexts = [
    'This is a test document about artificial intelligence and machine learning.',
    'The field of natural language processing has advanced significantly in recent years.',
    'Vector databases are essential for efficient similarity search in high-dimensional spaces.',
    'Memory management is crucial for long-running applications that process large datasets.',
    'Garbage collection helps prevent memory leaks in JavaScript applications.',
    'Tensor operations can be memory intensive when processing large batches of data.',
    'The Xenova transformers library provides efficient model inference in the browser.',
    'Batch processing can help optimize computational resources and memory usage.',
    'Error handling and retry logic improve the reliability of data processing pipelines.',
    'Monitoring memory usage is important for maintaining application performance.'
  ];

  console.log(`📝 Testing with ${testTexts.length} text samples\n`);

  const startTime = performance.now();
  const initialMemory = huggingFaceEmbeddingService.getMemoryUsage();
  console.log('📊 Initial Memory Usage:', initialMemory);

  try {
    console.log('🔄 Generating embeddings...\n');
    const embeddings = await huggingFaceEmbeddingService.generateEmbeddings(testTexts);

    const endTime = performance.now();
    const finalMemory = huggingFaceEmbeddingService.getMemoryUsage();

    console.log('\n✅ Test completed successfully!');
    console.log(`📊 Final Memory Usage:`, finalMemory);
    console.log(`⏱️  Total Time: ${(endTime - startTime).toFixed(2)}ms`);
    console.log(`📏 Embeddings Generated: ${embeddings.length}`);
    console.log(`📐 Embedding Dimensions: ${embeddings[0]?.length || 'N/A'}`);

    // Memory usage analysis
    const memoryIncrease = {
      rss: finalMemory.rss - initialMemory.rss,
      heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
      heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
      external: finalMemory.external - initialMemory.external,
      arrayBuffers: finalMemory.arrayBuffers - initialMemory.arrayBuffers
    };

    console.log('\n📈 Memory Usage Change:');
    console.log(`   RSS: ${memoryIncrease.rss > 0 ? '+' : ''}${memoryIncrease.rss} MB`);
    console.log(`   Heap Used: ${memoryIncrease.heapUsed > 0 ? '+' : ''}${memoryIncrease.heapUsed} MB`);
    console.log(`   External: ${memoryIncrease.external > 0 ? '+' : ''}${memoryIncrease.external} MB`);
    console.log(`   ArrayBuffers: ${memoryIncrease.arrayBuffers > 0 ? '+' : ''}${memoryIncrease.arrayBuffers} MB`);

    // Check for potential memory issues
    if (memoryIncrease.arrayBuffers > 10) {
      console.warn('⚠️  High ArrayBuffer growth detected - memory leak possible');
    }

    if (finalMemory.rss > 1500) {
      console.warn('⚠️  High RSS memory usage detected - consider reducing batch size');
    }

    // Cleanup test
    console.log('\n🧹 Testing cleanup...');
    await huggingFaceEmbeddingService.cleanup();

    const afterCleanupMemory = huggingFaceEmbeddingService.getMemoryUsage();
    console.log('📊 Memory after cleanup:', afterCleanupMemory);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testMemoryUsage().catch(console.error);
