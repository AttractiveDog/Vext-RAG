import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('=== Environment Variables Test ===');
console.log('MISTRAL_API_KEY exists:', !!process.env.MISTRAL_API_KEY);
console.log('MISTRAL_API_KEY length:', process.env.MISTRAL_API_KEY ? process.env.MISTRAL_API_KEY.length : 0);
console.log('MISTRAL_API_KEY first 10 chars:', process.env.MISTRAL_API_KEY ? process.env.MISTRAL_API_KEY.substring(0, 10) + '...' : 'undefined');
console.log('OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
console.log('OCR_MODEL:', process.env.OCR_MODEL || 'not set');
console.log('Current working directory:', process.cwd());
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('================================');
