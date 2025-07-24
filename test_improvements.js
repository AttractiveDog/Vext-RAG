import aiService from './src/services/aiService.js';

// Mock context data similar to what was shown in the image
const mockContext = [
  {
    text: "Monthly Cost Report (Per User) Core Components Component Unit Cost (INR) Notes Meeting Bot (20 h) ₹900 ₹45/hour × 20 hours MCP Server (Pipedream) ₹130 Based on ₹13,000/month for 100 users LLM Model AP...",
    metadata: { filename: "pricing_document.pdf" },
    distance: 0.1
  },
  {
    text: "Core Platform Features 1. AI-Powered Meeting Assistant 2. Voice-enabled meeting bots that join meetings in real-time 3. Real-time transcription and analysis using Deepgram and Attendee APIs 4. Inte...",
    metadata: { filename: "features_document.pdf" },
    distance: 0.2
  },
  {
    text: "Progress tracking and completion analytics Integration with calendar and meeting data Comprehensive Analytics Dashboard Productivity scoring and trend analysis",
    metadata: { filename: "analytics_document.pdf" },
    distance: 0.3
  }
];

async function testPricingQuestion() {
  console.log("Testing AI service with pricing question...");
  
  try {
    const result = await aiService.generateAnswer(
      "what is the pricing of executive ai?",
      mockContext,
      { temperature: 0.3 }
    );
    
    console.log("\n=== AI Response ===");
    console.log("Answer:", result.answer);
    console.log("Confidence:", result.confidence);
    console.log("Model:", result.model);
    console.log("Tokens:", result.tokens);
    
    console.log("\n=== Sources ===");
    result.sources.forEach((source, index) => {
      console.log(`Source ${index + 1}:`, source.text.substring(0, 100) + "...");
    });
    
  } catch (error) {
    console.error("Error testing AI service:", error);
  }
}

// Run the test
testPricingQuestion(); 