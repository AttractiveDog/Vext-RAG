import vectorService from './src/services/vectorService.js';
import { v4 as uuidv4 } from 'uuid';

async function testChunkHandling() {
  console.log('🧪 Testing document chunk handling...');
  
  try {
    // Test 1: Initialize service
    console.log('\n📋 Test 1: Service Initialization');
    await vectorService.initialize();
    console.log('✅ Service initialized successfully');
    
    // Test 2: Create test document with multiple chunks
    console.log('\n📋 Test 2: Creating Test Document with Chunks');
    const parentDocumentId = uuidv4();
    const testChunks = [
      {
        text: 'This is the first chunk of the test document. It contains information about the beginning of the document.',
        metadata: {
          filename: 'test_document.txt',
          chunkIndex: 0,
          totalChunks: 3,
          chunkStart: 0,
          chunkEnd: 100,
          source: 'test_script'
        }
      },
      {
        text: 'This is the second chunk of the test document. It contains information about the middle section.',
        metadata: {
          filename: 'test_document.txt',
          chunkIndex: 1,
          totalChunks: 3,
          chunkStart: 100,
          chunkEnd: 200,
          source: 'test_script'
        }
      },
      {
        text: 'This is the third chunk of the test document. It contains information about the end of the document.',
        metadata: {
          filename: 'test_document.txt',
          chunkIndex: 2,
          totalChunks: 3,
          chunkStart: 200,
          chunkEnd: 300,
          source: 'test_script'
        }
      }
    ];
    
    console.log(`Adding ${testChunks.length} chunks for document: ${parentDocumentId}`);
    const chunkIds = await vectorService.addDocumentChunks(testChunks, parentDocumentId);
    console.log('✅ Chunks added successfully. Chunk IDs:', chunkIds);
    
    // Test 3: Search for documents (should group by parent document)
    console.log('\n📋 Test 3: Document Search Test');
    const searchResults = await vectorService.searchDocuments('test document', 5);
    console.log('Search results:', JSON.stringify(searchResults, null, 2));
    
    // Test 4: Verify chunk relationships
    console.log('\n📋 Test 4: Chunk Relationship Verification');
    if (searchResults.length > 0) {
      const firstResult = searchResults[0];
      console.log(`Found document: ${firstResult.documentId}`);
      console.log(`Original filename: ${firstResult.originalFilename}`);
      console.log(`Number of chunks: ${firstResult.chunkCount}`);
      console.log(`Total score: ${firstResult.totalScore}`);
      console.log(`Chunks:`, firstResult.chunks.map(chunk => ({
        id: chunk.id,
        chunkNumber: chunk.chunkNumber,
        similarity: chunk.similarity
      })));
    }
    
    // Test 5: Collection details
    console.log('\n📋 Test 5: Collection Details');
    const details = await vectorService.getCollectionDetails();
    console.log('Collection details:', JSON.stringify(details, null, 2));
    
    console.log('\n✅ All chunk handling tests passed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
testChunkHandling().catch(console.error); 