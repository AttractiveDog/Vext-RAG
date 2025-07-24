import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import documentProcessor from '../utils/documentProcessor.js';
import textChunker from '../utils/textChunker.js';
import vectorService from '../services/vectorService.js';
import aiService from '../services/aiService.js';
import vextService from '../services/vextService.js';
import questionHistoryService from '../services/questionHistoryService.js';
import ocrService from '../services/ocrService.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Initialize text chunker
const chunker = new textChunker({
  chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP) || 200
});

/**
 * GET /api/health
 * Check system health and ChromaDB connection
 */
router.get('/health', async (req, res) => {
  try {
    console.log('🔍 Health check requested...');
    
    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {}
    };

    // Check ChromaDB health
    try {
      const chromaHealth = await vectorService.checkHealth();
      healthStatus.services.chromadb = chromaHealth;
    } catch (error) {
      healthStatus.services.chromadb = {
        healthy: false,
        error: error.message
      };
    }

    // Check OpenAI service (if API key is available)
    try {
      if (process.env.OPENAI_API_KEY) {
        await vextService.validateService();
        healthStatus.services.openai = { healthy: true };
      } else {
        healthStatus.services.openai = { healthy: false, error: 'No API key configured' };
      }
    } catch (error) {
      healthStatus.services.openai = {
        healthy: false,
        error: error.message
      };
    }

    // Determine overall health
    const allHealthy = Object.values(healthStatus.services).every(service => service.healthy);
    healthStatus.status = allHealthy ? 'ok' : 'degraded';

    const statusCode = allHealthy ? 200 : 503;
    res.status(statusCode).json(healthStatus);
    
    console.log(`✅ Health check completed: ${healthStatus.status}`);
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/ingest
 * Upload and process documents
 */
router.post('/ingest', async (req, res) => {
  const upload = req.app.locals.upload;
  
  upload.single('file')(req, res, async (err) => {
    try {
      console.log('🚀 Starting ingest endpoint...');
      
      if (err) {
        console.error('❌ Multer error:', err);
        return res.status(400).json({
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }

      if (!req.file) {
        console.error('❌ No file uploaded');
        return res.status(400).json({
          error: 'No file uploaded',
          timestamp: new Date().toISOString()
        });
      }

      const filePath = req.file.path;
      const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};
      
      console.log('📝 Processing file:', req.file.filename);

      // Validate file
      console.log('⚡ Validating file...');
      await documentProcessor.validateFile(filePath);
      console.log('✅ File validation complete');

      // Process document
      console.log('⚡ Processing document...');
      const processedDoc = await documentProcessor.processDocument(filePath, metadata);
      console.log('✅ Document processing complete');

      // Chunk the text
      console.log('⚡ Chunking text...');
      const chunks = chunker.chunkText(processedDoc.text);
      const chunkStats = chunker.getChunkStats(chunks);
      console.log(`✅ Text chunking complete: ${chunks.length} chunks`);

      // Prepare documents for vector database
      console.log('⚡ Preparing documents for vector database...');
      
      // Generate a unique document ID for the original file
      const originalDocumentId = uuidv4();
      
      const documents = chunks.map((chunk, index) => ({
        text: chunk.text,
        metadata: {
          ...processedDoc.metadata,
          // Document-level identifiers
          documentId: originalDocumentId,
          originalFilename: processedDoc.metadata.filename,
          // Chunk-level identifiers
          chunkIndex: index,
          totalChunks: chunks.length,
          chunkStart: chunk.start,
          chunkEnd: chunk.end,
          // Processing metadata
          processedAt: new Date().toISOString(),
          chunkSize: chunk.text.length,
          // Ensure consistent metadata structure
          source: 'file_upload',
          type: 'chunk'
        }
      }));
      
      console.log(`✅ Document preparation complete: ${documents.length} chunks from 1 document`);
      console.log(`📄 Original document ID: ${originalDocumentId}`);
      console.log(`📊 Chunk statistics: ${chunkStats.totalChunks} chunks, avg size: ${Math.round(chunkStats.averageChunkSize)} chars`);

      // Add to vector database with timeout
      console.log(`⚡ Adding ${documents.length} documents to vector database...`);
      console.log('🚨 This may take a while for large documents...');
      
      // Set a timeout for the vector operation (10 minutes)
      const vectorTimeout = setTimeout(() => {
        console.log('⚠️ Vector database operation is taking longer than expected...');
      }, 60000); // 1 minute warning
      
      const chunkIds = await vectorService.addDocumentChunks(documents, originalDocumentId);
      clearTimeout(vectorTimeout);
      
      console.log(`✅ Successfully added ${chunkIds.length} chunks to vector database`);

      // Clean up uploaded file
      console.log('⚡ Cleaning up uploaded file...');
      await fs.unlink(filePath);
      console.log(`🗑️ Cleaned up uploaded file: ${filePath}`);

      const response = {
        success: true,
        message: 'Document processed and ingested successfully',
        data: {
          filename: processedDoc.metadata.filename,
          documentId: originalDocumentId,
          totalChunks: chunks.length,
          chunkStats,
          chunkIds,
          metadata: processedDoc.metadata
        },
        timestamp: new Date().toISOString()
      };

      console.log(`📤 Sending response to frontend:`, JSON.stringify(response, null, 2));
      
      // Check if response has already been sent
      if (res.headersSent) {
        console.log(`⚠️ Response already sent, skipping...`);
        return;
      }
      
      res.json(response);
      console.log(`✅ Response sent successfully`);

    } catch (error) {
      console.error('❌ Error in ingest endpoint:', error);
      console.error('❌ Error stack:', error.stack);
      
      // Clean up uploaded file on error
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
          console.log(`🗑️ Cleaned up uploaded file after error: ${req.file.path}`);
        } catch (unlinkError) {
          console.error('Error deleting uploaded file:', unlinkError);
        }
      }
      
      const errorResponse = {
        error: error.message,
        timestamp: new Date().toISOString()
      };
      
      console.log(`📤 Sending error response to frontend:`, JSON.stringify(errorResponse, null, 2));
      
      // Check if response has already been sent
      if (res.headersSent) {
        console.log(`⚠️ Error response already sent, skipping...`);
        return;
      }
      
      res.status(500).json(errorResponse);
      console.log(`✅ Error response sent successfully`);
    }
  });
});

/**
 * POST /api/query
 * Ask questions and get AI-powered answers
 */
router.post('/query', async (req, res) => {
  try {
    const { question, topK = 10, temperature } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'Question is required and must be a string',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`Processing query: "${question}"`);

    // Search for relevant documents with query expansion
    let searchResults = await vectorService.searchDocuments(question, topK);
    
    // If we don't get enough results or the question is about pricing, try expanded search
    if (searchResults.length < 3 || question.toLowerCase().includes('pricing') || question.toLowerCase().includes('cost')) {
      const expandedQuery = question + ' pricing cost price fee rate';
      const expandedResults = await vectorService.searchDocuments(expandedQuery, topK);
      
      // Merge results, removing duplicates
      const allResults = [...searchResults];
      expandedResults.forEach(expandedDoc => {
        if (!allResults.find(doc => doc.documentId === expandedDoc.documentId)) {
          allResults.push(expandedDoc);
        }
      });
      
      // Sort by relevance and take top K
      allResults.sort((a, b) => b.totalScore - a.totalScore);
      searchResults = allResults.slice(0, topK);
    }
    
    // Debug: Log the search results
    console.log(`Found ${searchResults.length} relevant documents:`);
    searchResults.forEach((doc, index) => {
      console.log(`Document ${index + 1}: ${doc.originalFilename} (${doc.chunkCount} chunks, score: ${doc.totalScore.toFixed(3)})`);
    });

    // Flatten search results for AI service (extract chunks from grouped documents)
    const flattenedContext = [];
    searchResults.forEach(docGroup => {
      docGroup.chunks.forEach(chunk => {
        flattenedContext.push({
          text: chunk.text,
          metadata: {
            ...chunk,
            originalFilename: docGroup.originalFilename,
            documentId: docGroup.documentId,
            totalScore: docGroup.totalScore
          }
        });
      });
    });

    console.log(`Flattened ${flattenedContext.length} chunks from ${searchResults.length} documents for AI context`);

    // Generate AI answer with retry logic for context length issues
    let answer;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        answer = await aiService.generateAnswer(question, flattenedContext, {
          temperature,
          maxTokens: retryCount > 0 ? Math.max(500, 1000 - (retryCount * 200)) : 1000 // Reduce max tokens on retry
        });
        break; // Success, exit retry loop
      } catch (error) {
        retryCount++;
        
        // If it's a context length error and we haven't exceeded retries, try with fewer documents
        if (error.message.includes('Context too long') && retryCount <= maxRetries) {
          console.log(`🔄 Context too long, retrying with fewer documents (attempt ${retryCount}/${maxRetries})`);
          // Reduce the number of search results for the next attempt
          searchResults = searchResults.slice(0, Math.max(1, searchResults.length - (retryCount * 2)));
          continue;
        }
        
        // If we've exceeded retries and it's still a context length error, try minimal context fallback
        if (error.message.includes('Context too long') && retryCount > maxRetries) {
          console.log(`🔄 All retries failed, using minimal context fallback`);
          try {
            answer = await aiService.generateAnswerWithMinimalContext(question, flattenedContext, {
              temperature
            });
            break; // Success with fallback
          } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
            throw fallbackError; // Throw the original error if fallback also fails
          }
        }
        
        // For other errors or if we've exceeded retries, throw the error
        throw error;
      }
    }

    // Save question to history
    const historyEntry = await questionHistoryService.addQuestion({
      question,
      answer: answer.answer,
      sources: answer.sources,
      confidence: answer.confidence,
      model: answer.model,
      tokens: answer.tokens
    });

    // Return both nested and flat structure for compatibility
    const response = {
      success: true,
      data: {
        question,
        answer: answer.answer,
        sources: answer.sources,
        confidence: answer.confidence,
        model: answer.model,
        tokens: answer.tokens,
        searchResults: searchResults.length,
        historyId: historyEntry.id,
        contextTruncated: answer.contextTruncated,
        documentsUsed: answer.documentsUsed,
        totalDocumentsAvailable: answer.totalDocumentsAvailable
      },
      // Flat structure for React frontend compatibility
      question,
      answer: answer.answer,
      sources: answer.sources,
      confidence: answer.confidence,
      model: answer.model,
      tokens: answer.tokens,
      searchResults: searchResults.length,
      historyId: historyEntry.id,
      contextTruncated: answer.contextTruncated,
      documentsUsed: answer.documentsUsed,
      totalDocumentsAvailable: answer.totalDocumentsAvailable,
      timestamp: new Date().toISOString()
    };

    // Add informational message if context was truncated
    if (answer.contextTruncated) {
      response.info = `Context was truncated to fit token limits. Using ${answer.documentsUsed} of ${answer.totalDocumentsAvailable} available documents.`;
    }
    
    res.json(response);

  } catch (error) {
    console.error('Error in query endpoint:', error);
    
    let errorMessage = error.message;
    let statusCode = 500;
    
    // Handle specific error types
    if (error.message.includes('Rate limit exceeded')) {
      statusCode = 429;
      errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
    } else if (error.message.includes('Request too large')) {
      statusCode = 413;
      errorMessage = 'Query is too complex. Try asking a more specific question or wait for automatic optimization.';
    } else if (error.message.includes('Context too long')) {
      statusCode = 413;
      errorMessage = 'Query context is too large. Try asking a more specific question.';
    } else if (error.message.includes('Failed to search documents')) {
      statusCode = 503;
      errorMessage = 'Vector database is temporarily unavailable. Please try again in a moment.';
    } else if (error.message.includes('Failed to generate embeddings')) {
      statusCode = 503;
      errorMessage = 'Embedding service is temporarily unavailable. Please try again in a moment.';
    }
    
    res.status(statusCode).json({
      error: errorMessage,
      originalError: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/documents
 * List all ingested documents
 */
router.get('/documents', async (req, res) => {
  try {
    const documents = await vectorService.getAllDocuments();
    const stats = await vectorService.getCollectionStats();

    res.json({
      success: true,
      data: {
        documents,
        stats
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in documents endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete a specific document
 */
router.delete('/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: 'Document ID is required',
        timestamp: new Date().toISOString()
      });
    }

    await vectorService.deleteDocument(id);

    res.json({
      success: true,
      message: 'Document deleted successfully',
      data: { documentId: id },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in delete document endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/summarize
 * Generate a summary of all documents
 */
router.post('/summarize', async (req, res) => {
  try {
    const { maxTokens } = req.body;

    const documents = await vectorService.getAllDocuments();
    
    if (documents.length === 0) {
      return res.status(404).json({
        error: 'No documents found to summarize',
        timestamp: new Date().toISOString()
      });
    }

    const summary = await aiService.generateSummary(documents, {
      maxTokens
    });

    res.json({
      success: true,
      data: {
        summary,
        documentCount: documents.length,
        model: 'gpt-4o-mini'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in summarize endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/topics
 * Extract key topics from documents
 */
router.post('/topics', async (req, res) => {
  try {
    const { maxTokens } = req.body;

    const documents = await vectorService.getAllDocuments();
    
    if (documents.length === 0) {
      return res.status(404).json({
        error: 'No documents found to analyze',
        timestamp: new Date().toISOString()
      });
    }

    const topics = await aiService.extractTopics(documents, {
      maxTokens
    });

    res.json({
      success: true,
      data: {
        topics,
        documentCount: documents.length,
        model: 'gpt-4o-mini'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in topics endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/stats
 * Get system statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [vectorStats, vextValid, aiValid] = await Promise.all([
      vectorService.getCollectionStats(),
      vextService.validateService(),
      aiService.validateService()
    ]);

    res.json({
      success: true,
      data: {
        vectorDatabase: vectorStats,
        services: {
          vext: vextValid,
          ai: aiValid
        },
        supportedFormats: documentProcessor.getSupportedFormats(),
        model: 'gpt-4o-mini'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in stats endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/clear
 * Clear all documents from the system
 */
router.post('/clear', async (req, res) => {
  try {
    await vectorService.clearCollection();

    res.json({
      success: true,
      message: 'All documents cleared successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in clear endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/questions
 * Get recent questions from history
 */
router.get('/questions', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const questions = await questionHistoryService.getRecentQuestions(parseInt(limit));

    res.json({
      success: true,
      data: {
        questions,
        count: questions.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in questions endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/questions/:id
 * Get a specific question by ID
 */
router.get('/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const question = await questionHistoryService.getQuestionById(id);

    if (!question) {
      return res.status(404).json({
        error: 'Question not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: question,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in get question endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/questions/:id
 * Delete a specific question
 */
router.delete('/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await questionHistoryService.deleteQuestion(id);

    if (!deleted) {
      return res.status(404).json({
        error: 'Question not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Question deleted successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in delete question endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/questions
 * Clear all question history
 */
router.delete('/questions', async (req, res) => {
  try {
    await questionHistoryService.clearHistory();

    res.json({
      success: true,
      message: 'All questions cleared successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in clear questions endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/questions/stats
 * Get question history statistics
 */
router.get('/questions/stats', async (req, res) => {
  try {
    const stats = await questionHistoryService.getStats();

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in questions stats endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== OCR ENDPOINTS ====================

/**
 * POST /api/ocr/process
 * Process image or document with Mistral OCR
 */
router.post('/ocr/process', async (req, res) => {
  try {
    const upload = req.app.locals.upload;
    
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const filePath = req.file.path;
        const options = req.body.options ? JSON.parse(req.body.options) : {};

        // Process with OCR
        const ocrResult = await ocrService.processFile(filePath, options);

        // Clean up uploaded file
        await fs.unlink(filePath);

        res.json({
          success: true,
          message: 'OCR processing completed successfully',
          data: ocrResult,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        // Clean up uploaded file on error
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch (unlinkError) {
            console.error('Error deleting uploaded file:', unlinkError);
          }
        }

        throw error;
      }
    });
  } catch (error) {
    console.error('Error in OCR process endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/ocr/analyze
 * Analyze image or document with OCR and AI insights
 */
router.post('/ocr/analyze', async (req, res) => {
  try {
    const upload = req.app.locals.upload;
    
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const filePath = req.file.path;
        const analysisPrompt = req.body.prompt || 'Analyze this document and provide insights about its content, structure, and key information.';
        const options = req.body.options ? JSON.parse(req.body.options) : {};

        // Process with OCR
        const ocrResult = await ocrService.processFile(filePath, options);

        // Analyze with AI
        const analysisPrompt_full = `${analysisPrompt}\n\nDocument Content:\n${ocrResult.fullText}\n\nStructured Data:\n${JSON.stringify(ocrResult.structuredData, null, 2)}`;
        
        const aiAnalysis = await aiService.generateResponse(analysisPrompt_full, {
          temperature: 0.3,
          maxTokens: 2000
        });

        // Clean up uploaded file
        await fs.unlink(filePath);

        res.json({
          success: true,
          message: 'OCR analysis completed successfully',
          data: {
            ocr: ocrResult,
            analysis: aiAnalysis,
            summary: {
              totalPages: ocrResult.statistics.totalPages,
              totalWords: ocrResult.statistics.totalWords,
              detectedLanguages: ocrResult.statistics.detectedLanguages,
              confidence: ocrResult.statistics.averageConfidence,
              structuredElements: {
                tables: ocrResult.structuredData.tables.length,
                lists: ocrResult.structuredData.lists.length,
                headers: ocrResult.structuredData.headers.length,
                dates: ocrResult.structuredData.dates.length,
                emails: ocrResult.structuredData.emails.length,
                phoneNumbers: ocrResult.structuredData.phoneNumbers.length
              }
            }
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        // Clean up uploaded file on error
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch (unlinkError) {
            console.error('Error deleting uploaded file:', unlinkError);
          }
        }

        throw error;
      }
    });
  } catch (error) {
    console.error('Error in OCR analyze endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/ocr/ingest
 * Process image or document with OCR and ingest into vector database
 */
router.post('/ocr/ingest', async (req, res) => {
  try {
    const upload = req.app.locals.upload;
    
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const filePath = req.file.path;
        const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};
        const options = req.body.options ? JSON.parse(req.body.options) : {};

        // Process with OCR
        const ocrResult = await ocrService.processFile(filePath, {
          ...options,
          source: 'ocr_ingest',
          ingestedAt: new Date().toISOString()
        });

        // Chunk the text
        const chunks = chunker.chunkText(ocrResult.fullText);
        const chunkStats = chunker.getChunkStats(chunks);

        // Prepare documents for vector database
        const documents = chunks.map((chunk, index) => ({
          text: chunk.text,
          metadata: {
            ...ocrResult.statistics,
            ...ocrResult.structuredData,
            filename: ocrResult.filename,
            fileType: ocrResult.fileType,
            ocrProcessed: true,
            ocrModel: ocrResult.metadata.model,
            chunkIndex: index,
            totalChunks: chunks.length,
            chunkStart: chunk.start,
            chunkEnd: chunk.end,
            ...metadata
          }
        }));

        // Add to vector database
        const documentIds = await vectorService.addDocuments(documents);

        // Clean up uploaded file
        await fs.unlink(filePath);

        res.json({
          success: true,
          message: 'OCR document processed and ingested successfully',
          data: {
            filename: ocrResult.filename,
            totalChunks: chunks.length,
            chunkStats,
            documentIds,
            ocrStats: ocrResult.statistics,
            structuredData: ocrResult.structuredData
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        // Clean up uploaded file on error
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch (unlinkError) {
            console.error('Error deleting uploaded file:', unlinkError);
          }
        }

        throw error;
      }
    });
  } catch (error) {
    console.error('Error in OCR ingest endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/ocr/formats
 * Get supported OCR formats
 */
router.get('/ocr/formats', async (req, res) => {
  try {
    const formats = ocrService.getSupportedFormats();
    const isEnabled = process.env.MISTRAL_API_KEY ? true : false;

    res.json({
      success: true,
      data: {
        enabled: isEnabled,
        formats,
        limits: {
          maxFileSize: ocrService.maxFileSize,
          maxPages: ocrService.maxPages,
          includeImages: ocrService.includeImages
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in OCR formats endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 