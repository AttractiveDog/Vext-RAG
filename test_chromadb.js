import vectorService from './src/services/vectorService.js';
import vextService from './src/services/vextService.js';

async function testChromaDB() {
  console.log('🧪 Testing ChromaDB connection and document addition...');
  
  try {
    // Test 1: Check health
    console.log('\n📋 Test 1: Health Check');
    const health = await vectorService.checkHealth();
    console.log('Health status:', JSON.stringify(health, null, 2));
    
    if (!health.healthy) {
      console.error('❌ ChromaDB is not healthy. Please check your ChromaDB server.');
      return;
    }
    
    // Test 2: Initialize service
    console.log('\n📋 Test 2: Service Initialization');
    await vectorService.initialize();
    console.log('✅ Service initialized successfully');
    
    // Test 3: Test with simple document
    console.log('\n📋 Test 3: Simple Document Test');
    const testDocuments = [
      {
        text: 'This is a simple test document to verify ChromaDB functionality.',
        metadata: {
          test: true,
          timestamp: new Date().toISOString(),
          source: 'test_script'
        }
      }
    ];
    
    console.log('Adding test document...');
    const ids = await vectorService.addDocumentsWithRetry(testDocuments);
    console.log('✅ Test document added successfully. IDs:', ids);
    
    // Test 4: Search test
    console.log('\n📋 Test 4: Search Test');
    const searchResults = await vectorService.search('test document', 5);
    console.log('Search results:', JSON.stringify(searchResults, null, 2));
    
    // Test 5: Collection details
    console.log('\n📋 Test 5: Collection Details');
    const details = await vectorService.getCollectionDetails();
    console.log('Collection details:', JSON.stringify(details, null, 2));
    
    console.log('\n✅ All tests passed! ChromaDB is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Error details:', error.message);
    
    if (error.message.includes('422')) {
      console.log('\n🔍 422 Error Analysis:');
      console.log('- This usually indicates a data format issue');
      console.log('- Check that ChromaDB server is running on the correct port');
      console.log('- Verify that the collection schema is compatible');
      console.log('- Try resetting the collection manually');
    }
  }
}

// Run the test
testChromaDB().catch(console.error); 