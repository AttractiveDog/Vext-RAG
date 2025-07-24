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

const router = express.Router();

// Initialize text chunker
const chunker = new textChunker({
  chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP) || 200
});

/**
 * POST /api/ingest
 * Upload and process documents
 */
router.post('/ingest', async (req, res) => {
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

        // Validate file
        await documentProcessor.validateFile(filePath);

        // Process document
        const processedDoc = await documentProcessor.processDocument(filePath, metadata);

        // Chunk the text
        const chunks = chunker.chunkText(processedDoc.text);
        const chunkStats = chunker.getChunkStats(chunks);

        // Prepare documents for vector database
        const documents = chunks.map((chunk, index) => ({
          text: chunk.text,
          metadata: {
            ...processedDoc.metadata,
            chunkIndex: index,
            totalChunks: chunks.length,
            chunkStart: chunk.start,
            chunkEnd: chunk.end
          }
        }));

        // Add to vector database
        const documentIds = await vectorService.addDocuments(documents);

        // Clean up uploaded file
        await fs.unlink(filePath);

        res.json({
          success: true,
          message: 'Document processed and ingested successfully',
          data: {
            filename: processedDoc.metadata.filename,
            totalChunks: chunks.length,
            chunkStats,
            documentIds,
            metadata: processedDoc.metadata
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
    console.error('Error in ingest endpoint:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/query
 * Ask questions and get AI-powered answers
 */
router.post('/query', async (req, res) => {
  try {
    const { question, topK = 10, model, temperature } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'Question is required and must be a string',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`Processing query: "${question}"`);

    // Search for relevant documents with query expansion
    let searchResults = await vectorService.search(question, topK);
    
    // If we don't get enough results or the question is about pricing, try expanded search
    if (searchResults.length < 3 || question.toLowerCase().includes('pricing') || question.toLowerCase().includes('cost')) {
      const expandedQuery = question + ' pricing cost price fee rate';
      const expandedResults = await vectorService.search(expandedQuery, topK);
      
      // Merge results, removing duplicates
      const allResults = [...searchResults];
      expandedResults.forEach(expandedDoc => {
        if (!allResults.find(doc => doc.id === expandedDoc.id)) {
          allResults.push(expandedDoc);
        }
      });
      
      // Sort by relevance and take top K
      allResults.sort((a, b) => (a.distance || 0) - (b.distance || 0));
      searchResults = allResults.slice(0, topK);
    }
    
    // Debug: Log the search results
    console.log(`Found ${searchResults.length} relevant documents:`);
    searchResults.forEach((doc, index) => {
      console.log(`Document ${index + 1}: ${doc.text.substring(0, 100)}...`);
    });

    // Generate AI answer
    const answer = await aiService.generateAnswer(question, searchResults, {
      model,
      temperature
    });

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
        historyId: historyEntry.id
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
      timestamp: new Date().toISOString()
    };
    
    res.json(response);

  } catch (error) {
    console.error('Error in query endpoint:', error);
    res.status(500).json({
      error: error.message,
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
    const { model, maxTokens } = req.body;

    const documents = await vectorService.getAllDocuments();
    
    if (documents.length === 0) {
      return res.status(404).json({
        error: 'No documents found to summarize',
        timestamp: new Date().toISOString()
      });
    }

    const summary = await aiService.generateSummary(documents, {
      model,
      maxTokens
    });

    res.json({
      success: true,
      data: {
        summary,
        documentCount: documents.length,
        model: model || 'gpt-4o-mini'
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
    const { model, maxTokens } = req.body;

    const documents = await vectorService.getAllDocuments();
    
    if (documents.length === 0) {
      return res.status(404).json({
        error: 'No documents found to analyze',
        timestamp: new Date().toISOString()
      });
    }

    const topics = await aiService.extractTopics(documents, {
      model,
      maxTokens
    });

    res.json({
      success: true,
      data: {
        topics,
        documentCount: documents.length,
        model: model || 'gpt-4o-mini'
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
        supportedFormats: documentProcessor.getSupportedFormats()
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