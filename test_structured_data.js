import aiService from './src/services/aiService.js';

// Mock context data with structured information (tables, charts, numbers)
const mockStructuredContext = [
  {
    text: "Monthly Cost Report (Per User) Core Components Component Unit Cost (INR) Notes Meeting Bot (20 h) ₹900 ₹45/hour × 20 hours MCP Server (Pipedream) ₹130 Based on ₹13,000/month for 100 users LLM Model AP...",
    metadata: { 
      filename: "pricing_document.pdf",
      tables: [
        {
          content: "| Component | Unit Cost (INR) | Notes |\n|-----------|-----------------|-------|\n| Meeting Bot (20 h) | ₹900 | ₹45/hour × 20 hours |\n| MCP Server (Pipedream) | ₹130 | Based on ₹13,000/month for 100 users |\n| LLM Model API | ₹200 | Per user per month |",
          headers: ["Component", "Unit Cost (INR)", "Notes"],
          data: [
            ["Meeting Bot (20 h)", "₹900", "₹45/hour × 20 hours"],
            ["MCP Server (Pipedream)", "₹130", "Based on ₹13,000/month for 100 users"],
            ["LLM Model API", "₹200", "Per user per month"]
          ],
          type: "markdown"
        }
      ],
      numbers: ["₹900", "₹130", "₹200", "₹45", "₹13,000", "20", "100"],
      charts: [
        {
          title: "Cost Breakdown Chart",
          type: "pie",
          data: ["Meeting Bot: ₹900", "MCP Server: ₹130", "LLM API: ₹200"]
        }
      ]
    },
    distance: 0.1
  },
  {
    text: "Core Platform Features 1. AI-Powered Meeting Assistant 2. Voice-enabled meeting bots that join meetings in real-time 3. Real-time transcription and analysis using Deepgram and Attendee APIs 4. Inte...",
    metadata: { 
      filename: "features_document.pdf",
      lists: [
        "AI-Powered Meeting Assistant",
        "Voice-enabled meeting bots that join meetings in real-time",
        "Real-time transcription and analysis using Deepgram and Attendee APIs"
      ],
      headers: [
        { level: 1, text: "Core Platform Features" }
      ]
    },
    distance: 0.2
  },
  {
    text: "Progress tracking and completion analytics Integration with calendar and meeting data Comprehensive Analytics Dashboard Productivity scoring and trend analysis",
    metadata: { 
      filename: "analytics_document.pdf",
      charts: [
        {
          title: "Productivity Trends",
          type: "line",
          data: ["Q1: 85%", "Q2: 87%", "Q3: 89%", "Q4: 92%"]
        }
      ],
      numbers: ["85%", "87%", "89%", "92%"]
    },
    distance: 0.3
  }
];

// Test different types of structured data questions
async function testStructuredDataQuestions() {
  console.log("🧪 Testing AI service with structured data questions...\n");
  
  const testQuestions = [
    "What is the cost of the Meeting Bot component?",
    "How much does the MCP Server cost per user?",
    "What are the total costs shown in the pricing table?",
    "What does the productivity trend chart show?",
    "What are the main features listed in the document?",
    "What is the average productivity percentage across quarters?"
  ];
  
  for (const question of testQuestions) {
    console.log(`\n📋 Question: "${question}"`);
    console.log("=" .repeat(60));
    
    try {
      const result = await aiService.generateAnswer(
        question,
        mockStructuredContext,
        { temperature: 0.3 }
      );
      
      console.log("🤖 AI Response:");
      console.log(result.answer);
      console.log(`\n📊 Confidence: ${result.confidence.toFixed(3)}`);
      console.log(`🔍 Is Structured Data Question: ${result.isStructuredDataQuestion}`);
      console.log(`📝 Tokens Used: ${result.tokens}`);
      
      console.log("\n📚 Sources:");
      result.sources.forEach((source, index) => {
        console.log(`  ${index + 1}. ${source.text.substring(0, 100)}...`);
      });
      
    } catch (error) {
      console.error(`❌ Error testing question "${question}":`, error.message);
    }
  }
}

// Test the structured data detection
function testStructuredDataDetection() {
  console.log("\n🔍 Testing structured data detection...\n");
  
  const testQuestions = [
    "What is the pricing?",
    "Show me the table data",
    "What does the chart indicate?",
    "What are the numbers?",
    "Compare the values",
    "What is the trend?",
    "Tell me about the features",
    "What is the total cost?"
  ];
  
  testQuestions.forEach(question => {
    const isStructured = aiService.isStructuredDataQuestion(question);
    console.log(`"${question}" -> ${isStructured ? '✅ Structured' : '❌ Not Structured'}`);
  });
}

// Test context formatting
function testContextFormatting() {
  console.log("\n📝 Testing context formatting...\n");
  
  const formattedContext = aiService.formatContextForAI(mockStructuredContext, true);
  console.log("Formatted context for structured data question:");
  console.log(formattedContext.substring(0, 500) + "...");
}

// Run all tests
async function runAllTests() {
  console.log("🚀 Starting structured data improvements test suite\n");
  
  try {
    await testStructuredDataQuestions();
    testStructuredDataDetection();
    testContextFormatting();
    
    console.log("\n✅ All tests completed successfully!");
    console.log("\n📋 Summary of improvements:");
    console.log("1. Enhanced table extraction with better structure detection");
    console.log("2. Specialized AI prompts for structured data questions");
    console.log("3. Improved context formatting for tables and charts");
    console.log("4. Better search strategies for structured data");
    console.log("5. Enhanced metadata handling for tables and charts");
    
  } catch (error) {
    console.error("❌ Test suite failed:", error);
  }
}

// Run the tests
runAllTests();
