import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const BASE_URL = process.env.BASE_URL || 'http://3.6.147.238:3000';

// Sample email data for testing
const sampleEmails = [
  {
    email_id: "email_001",
    sender_email: "john.doe@company.com",
    receiver_emails: ["jane.smith@company.com", "team@company.com"],
    cc_emails: ["manager@company.com"],
    bcc_emails: [],
    time_received: "2024-01-15T10:30:00Z",
    subject: "Project Update - Q1 Goals",
    body: "Hi team, I wanted to share an update on our Q1 project goals. We've made significant progress on the new feature development and are on track to meet our deadlines. The user feedback has been overwhelmingly positive, with a 95% satisfaction rate. Next steps include finalizing the documentation and preparing for the beta release.",
    attachments: [
      {
        name: "project_timeline.pdf",
        type: "application/pdf",
        size: "2.5MB"
      }
    ]
  },
  {
    email_id: "email_002",
    sender_email: "sarah.wilson@vendor.com",
    receiver_emails: ["procurement@company.com"],
    cc_emails: [],
    bcc_emails: [],
    time_received: "2024-01-16T14:45:00Z",
    subject: "Invoice #INV-2024-001 - Software Licenses",
    body: "Please find attached the invoice for the annual software licenses renewal. The total amount is $12,500 and payment is due within 30 days. This covers licenses for our project management tools, development environments, and security software for 50 users.",
    attachments: [
      {
        name: "invoice_INV-2024-001.pdf",
        type: "application/pdf",
        size: "1.2MB"
      }
    ]
  },
  {
    email_id: "email_003",
    sender_email: "hr@company.com",
    receiver_emails: ["all@company.com"],
    cc_emails: [],
    bcc_emails: [],
    time_received: "2024-01-17T09:00:00Z",
    subject: "New Employee Handbook and Policy Updates",
    body: "Dear team, we've updated our employee handbook with new policies regarding remote work, vacation time, and professional development opportunities. Key changes include increased remote work flexibility, additional mental health days, and a new professional development budget of $2,000 per employee annually.",
    attachments: [
      {
        name: "employee_handbook_2024.pdf",
        type: "application/pdf",
        size: "4.1MB"
      },
      {
        name: "policy_changes_summary.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: "850KB"
      }
    ]
  }
];

async function makeRequest(url, options = {}) {
  try {
    // Use dynamic import for fetch in Node.js environment
    const { default: fetch } = await import('node-fetch');
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const data = await response.json();
    
    return {
      status: response.status,
      success: response.ok,
      data: data
    };
  } catch (error) {
    console.error(`Request failed: ${error.message}`);
    return {
      status: 0,
      success: false,
      error: error.message
    };
  }
}

async function testEmailIngest() {
  console.log('\n🧪 Testing Email Ingest Endpoint...');
  
  const result = await makeRequest(`${BASE_URL}/api/emails/ingest`, {
    method: 'POST',
    body: JSON.stringify({ emails: sampleEmails })
  });
  
  if (result.success) {
    console.log('✅ Email ingest successful!');
    console.log(`📧 Processed: ${result.data.data.totalProcessed} emails`);
    console.log(`❌ Errors: ${result.data.data.totalErrors} emails`);
    if (result.data.data.errors.length > 0) {
      console.log('Errors:', result.data.data.errors);
    }
    return true;
  } else {
    console.log('❌ Email ingest failed!');
    console.log('Error:', result.data.error || result.error);
    return false;
  }
}

async function testEmailQuery() {
  console.log('\n🧪 Testing Email Query Endpoint...');
  
  const queries = [
    "What project updates were shared?",
    "Are there any invoices or payments due?",
    "What are the new HR policies?",
    "Show me emails about software licenses"
  ];
  
  let successCount = 0;
  
  for (const query of queries) {
    console.log(`\n🔍 Query: "${query}"`);
    
    const result = await makeRequest(`${BASE_URL}/api/emails/query`, {
      method: 'POST',
      body: JSON.stringify({ 
        query: query,
        topK: 5
      })
    });
    
    if (result.success) {
      console.log('✅ Query successful!');
      console.log(`📧 Found: ${result.data.data.totalEmails} relevant emails`);
      console.log(`🤖 Answer: ${result.data.data.answer.substring(0, 150)}...`);
      successCount++;
    } else {
      console.log('❌ Query failed!');
      console.log('Error:', result.data.error || result.error);
    }
  }
  
  return successCount === queries.length;
}

async function testEmailList() {
  console.log('\n🧪 Testing Email List Endpoint...');
  
  const result = await makeRequest(`${BASE_URL}/api/emails/list?limit=10`);
  
  if (result.success) {
    console.log('✅ Email list successful!');
    console.log(`📧 Total emails: ${result.data.data.pagination.total}`);
    console.log(`📝 Listed: ${result.data.data.emails.length} emails`);
    return true;
  } else {
    console.log('❌ Email list failed!');
    console.log('Error:', result.data.error || result.error);
    return false;
  }
}

async function testEmailStats() {
  console.log('\n🧪 Testing Email Stats Endpoint...');
  
  const result = await makeRequest(`${BASE_URL}/api/emails/stats`);
  
  if (result.success) {
    console.log('✅ Email stats successful!');
    console.log(`📊 Total emails: ${result.data.data.totalEmails}`);
    console.log(`👥 Unique senders: ${result.data.data.uniqueSenders}`);
    console.log(`🏢 Unique domains: ${result.data.data.uniqueDomains}`);
    console.log(`📎 Total attachments: ${result.data.data.totalAttachments}`);
    return true;
  } else {
    console.log('❌ Email stats failed!');
    console.log('Error:', result.data.error || result.error);
    return false;
  }
}

async function testAdvancedSearch() {
  console.log('\n🧪 Testing Advanced Email Search...');
  
  const searchParams = {
    query: "software licenses",
    sender_domain: "vendor.com",
    has_attachments: true,
    topK: 5
  };
  
  const result = await makeRequest(`${BASE_URL}/api/emails/search`, {
    method: 'POST',
    body: JSON.stringify(searchParams)
  });
  
  if (result.success) {
    console.log('✅ Advanced search successful!');
    console.log(`📧 Found: ${result.data.data.totalResults} emails`);
    console.log(`🔍 Search parameters:`, searchParams);
    return true;
  } else {
    console.log('❌ Advanced search failed!');
    console.log('Error:', result.data.error || result.error);
    return false;
  }
}

async function testEmailHealth() {
  console.log('\n🧪 Testing Email Health Endpoint...');
  
  const result = await makeRequest(`${BASE_URL}/api/emails/health`);
  
  if (result.success) {
    console.log('✅ Email health check successful!');
    console.log(`🏥 Overall status: ${result.data.data.overall}`);
    console.log(`💾 Vector DB healthy: ${result.data.data.vectorDatabase.healthy}`);
    return true;
  } else {
    console.log('❌ Email health check failed!');
    console.log('Error:', result.data.error || result.error);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Email Feature Tests...');
  console.log(`🌐 Base URL: ${BASE_URL}`);
  
  const tests = [
    { name: 'Email Health Check', fn: testEmailHealth },
    { name: 'Email Ingest', fn: testEmailIngest },
    { name: 'Email List', fn: testEmailList },
    { name: 'Email Stats', fn: testEmailStats },
    { name: 'Email Query', fn: testEmailQuery },
    { name: 'Advanced Search', fn: testAdvancedSearch }
  ];
  
  let passedTests = 0;
  let totalTests = tests.length;
  
  for (const test of tests) {
    try {
      const passed = await test.fn();
      if (passed) {
        passedTests++;
      }
      
      // Wait between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`❌ Test "${test.name}" threw an error:`, error.message);
    }
  }
  
  console.log('\n📊 Test Results Summary:');
  console.log(`✅ Passed: ${passedTests}/${totalTests}`);
  console.log(`❌ Failed: ${totalTests - passedTests}/${totalTests}`);
  console.log(`📈 Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  if (passedTests === totalTests) {
    console.log('\n🎉 All tests passed! Email feature is working correctly.');
  } else {
    console.log('\n⚠️ Some tests failed. Please check the implementation.');
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { 
  runAllTests, 
  testEmailIngest, 
  testEmailQuery, 
  testEmailList, 
  testEmailStats, 
  testAdvancedSearch, 
  testEmailHealth 
};
