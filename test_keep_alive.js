const API_BASE = 'http://localhost:3000/api';

// Test the keep-alive functionality
async function testKeepAlive() {
    console.log('🧪 Testing Keep-Alive Document Processing...\n');

    // Test 1: Check if SSE endpoint is accessible
    console.log('1. Testing SSE endpoint accessibility...');
    try {
        const testJobId = 'test-job-123';
        const eventSource = new EventSource(`${API_BASE}/ingest/progress/${testJobId}`);
        
        eventSource.onmessage = function(event) {
            const data = JSON.parse(event.data);
            console.log('✅ SSE connection established:', data.type);
            eventSource.close();
        };
        
        eventSource.onerror = function(event) {
            console.log('❌ SSE connection failed');
            eventSource.close();
        };
        
        // Wait a bit for the connection
        await new Promise(resolve => setTimeout(resolve, 2000));
        
    } catch (error) {
        console.log('❌ SSE test failed:', error.message);
    }

    // Test 2: Check status endpoint
    console.log('\n2. Testing status endpoint...');
    try {
        const response = await fetch(`${API_BASE}/ingest/status/test-job-123`);
        const result = await response.json();
        console.log('✅ Status endpoint working:', result.error || 'Job not found (expected)');
    } catch (error) {
        console.log('❌ Status endpoint failed:', error.message);
    }

    // Test 3: Test health endpoint
    console.log('\n3. Testing health endpoint...');
    try {
        const response = await fetch(`${API_BASE}/health`);
        const result = await response.json();
        console.log('✅ Health endpoint working:', result.status);
    } catch (error) {
        console.log('❌ Health endpoint failed:', error.message);
    }

    console.log('\n🎉 Keep-alive test completed!');
    console.log('\n📋 To test the full functionality:');
    console.log('1. Start the server: npm start');
    console.log('2. Open the web interface');
    console.log('3. Upload a document and watch the real-time progress');
    console.log('4. The connection will stay alive with keep-alive packets every 2 seconds');
}

// Run the test if this file is executed directly
if (typeof window === 'undefined') {
    // Node.js environment
    const { EventSource } = require('eventsource');
    global.EventSource = EventSource;
    testKeepAlive();
} else {
    // Browser environment
    testKeepAlive();
}
