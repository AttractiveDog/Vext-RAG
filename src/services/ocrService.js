import { Mistral } from '@mistralai/mistralai';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import Jimp from 'jimp';
import dotenv from 'dotenv';

dotenv.config();

class OCRService {
  constructor() {
    this.client = null;
    // Use the correct OCR model
    this.model = process.env.OCR_MODEL || 'mistral-ocr-latest';
    this.includeImages = process.env.OCR_INCLUDE_IMAGES === 'true';
    this.maxFileSize = parseInt(process.env.OCR_MAX_FILE_SIZE) || 52428800; // 50MB
    this.maxPages = parseInt(process.env.OCR_MAX_PAGES) || 1000;
    
    this.supportedImageFormats = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp', '.avif'];
    this.supportedDocumentFormats = ['.pdf', '.pptx', '.docx'];
    
    this.initialize();
  }

  /**
   * Initialize Mistral client
   */
  initialize() {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ MISTRAL_API_KEY not found. OCR functionality will be disabled.');
      this.client = null;
      return;
    }
    
    try {
      this.client = new Mistral({ apiKey });
      
      // Validate that the client was properly initialized
      if (!this.client) {
        throw new Error('Failed to initialize Mistral client');
      }
      
      console.log(`✅ Mistral OCR service initialized with model: ${this.model}`);
    } catch (error) {
      console.error('❌ Failed to initialize Mistral client:', error.message);
      this.client = null;
    }
  }

  /**
   * Check if file format is supported for OCR
   * @param {string} filename - File name
   * @returns {boolean} - True if format is supported
   */
  isSupportedFormat(filename) {
    const ext = path.extname(filename).toLowerCase();
    return [...this.supportedImageFormats, ...this.supportedDocumentFormats].includes(ext);
  }

  /**
   * Check if file is an image
   * @param {string} filename - File name
   * @returns {boolean} - True if file is an image
   */
  isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return this.supportedImageFormats.includes(ext);
  }

  /**
   * Check if file is a document
   * @param {string} filename - File name
   * @returns {boolean} - True if file is a document
   */
  isDocumentFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return this.supportedDocumentFormats.includes(ext);
  }

  /**
   * Validate file size and format
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} - Validation result
   */
  async validateFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const filename = path.basename(filePath);
      
      if (stats.size > this.maxFileSize) {
        throw new Error(`File size (${this.formatFileSize(stats.size)}) exceeds maximum allowed size (${this.formatFileSize(this.maxFileSize)})`);
      }

      if (!this.isSupportedFormat(filename)) {
        throw new Error(`Unsupported file format: ${path.extname(filename)}`);
      }

      return {
        valid: true,
        size: stats.size,
        filename,
        fileType: path.extname(filename).toLowerCase()
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Preprocess image for better OCR results
   * @param {string} filePath - Path to image file
   * @returns {Promise<Buffer>} - Preprocessed image buffer
   */
  async preprocessImage(filePath) {
    try {
      // Use Sharp for better image preprocessing
      const processedBuffer = await sharp(filePath)
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();
      
      return processedBuffer;
    } catch (sharpError) {
      console.warn('Sharp preprocessing failed, trying Jimp:', sharpError.message);
      
      try {
        const image = await Jimp.read(filePath);
        
        // Convert to grayscale for better text recognition
        image.grayscale();
        
        // Enhance contrast
        image.contrast(0.2);
        
        // Increase brightness slightly
        image.brightness(0.1);
        
        // Get buffer
        return await image.getBufferAsync(Jimp.MIME_PNG);
      } catch (jimpError) {
        console.warn('Image preprocessing failed, using original:', jimpError.message);
        return await fs.readFile(filePath);
      }
    }
  }

  /**
   * Process image with Mistral OCR
   * @param {string} filePath - Path to image file
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - OCR results
   */
  async processImage(filePath, options = {}) {
    try {
      console.log(`🔍 Processing image with Mistral OCR: ${path.basename(filePath)}`);
      
      // Check if client is available and properly initialized
      if (!this.client || !this.client.ocr) {
        throw new Error('Mistral client not initialized or OCR not available. Please check MISTRAL_API_KEY configuration.');
      }

      // Validate file
      const validation = await this.validateFile(filePath);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Preprocess image if needed (optional for better results)
      const shouldPreprocess = options.preprocess !== false;
      const imageBuffer = shouldPreprocess ? 
        await this.preprocessImage(filePath) : 
        await fs.readFile(filePath);
      
      // Convert to base64
      const base64Image = imageBuffer.toString('base64');
      const mimeType = this.getMimeType(validation.fileType);

      // Prepare OCR parameters
      const ocrParams = {
        model: this.model,
        document: {
          type: "image_url",
          imageUrl: `data:${mimeType};base64,${base64Image}`
        }
      };

      // Handle image processing parameters
      if (this.includeImages) {
        ocrParams.includeImageBase64 = true;
      } else {
        ocrParams.imageLimit = 0; // Don't include images when not needed
      }

      // Use the dedicated OCR API with correct parameter names
      const ocrResponse = await this.client.ocr.process(ocrParams);

      // Process the OCR response
      const results = this.processOCRResponse(ocrResponse, filePath, options);
      
      console.log(`✅ Image OCR completed: ${results.statistics.totalPages} pages, ${results.statistics.totalWords} words`);
      
      return results;
    } catch (error) {
      console.error(`❌ Image OCR failed: ${error.message}`);
      
      // Provide more helpful error messages for common issues
      if (error.message.includes('Invalid model')) {
        throw new Error(`OCR processing failed: The model '${this.model}' is not valid. Please use 'mistral-ocr-latest'.`);
      } else if (error.message.includes('quota')) {
        throw new Error(`OCR processing failed: API quota exceeded. Please check your Mistral API usage limits.`);
      } else {
        throw new Error(`OCR processing failed: ${error.message}`);
      }
    }
  }

  /**
   * Process document (PDF, DOCX, PPTX) with Mistral OCR
   * @param {string} filePath - Path to document file
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - OCR results
   */
  async processDocument(filePath, options = {}) {
    try {
      console.log(`📄 Processing document with Mistral OCR: ${path.basename(filePath)}`);
      
      // Check if client is available and properly initialized
      if (!this.client || !this.client.ocr || !this.client.files) {
        throw new Error('Mistral client not initialized or OCR/Files API not available. Please check MISTRAL_API_KEY configuration.');
      }

      // Validate file
      const validation = await this.validateFile(filePath);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Method 1: Try using file upload first (recommended for documents)
      try {
        return await this.processDocumentViaUpload(filePath, validation, options);
      } catch (uploadError) {
        console.warn(`⚠️ File upload method failed: ${uploadError.message}`);
        console.log('🔄 Trying base64 method...');
        
        // Method 2: Fallback to base64 method for images or if upload fails
        if (this.isImageFile(validation.filename)) {
          return await this.processDocumentViaBase64(filePath, validation, options);
        } else {
          throw uploadError; // Re-throw the upload error for non-image files
        }
      }
    } catch (error) {
      console.error(`❌ Document OCR failed: ${error.message}`);
      
      // Provide more helpful error messages for common issues
      if (error.message.includes('Invalid model')) {
        throw new Error(`OCR processing failed: The model '${this.model}' is not valid. Please use 'mistral-ocr-latest'.`);
      } else if (error.message.includes('quota')) {
        throw new Error(`OCR processing failed: API quota exceeded. Please check your Mistral API usage limits.`);
      } else if (error.message.includes('Input validation failed')) {
        throw new Error(`OCR processing failed: Invalid input parameters. Please check the file format and API usage.`);
      } else {
        throw new Error(`OCR processing failed: ${error.message}`);
      }
    }
  }

  /**
   * Process document via file upload
   * @param {string} filePath - Path to document file
   * @param {Object} validation - File validation result
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - OCR results
   */
  async processDocumentViaUpload(filePath, validation, options = {}) {
    console.log('📤 Uploading file to Mistral...');
    const fileBuffer = await fs.readFile(filePath);
    
    const uploadedFile = await this.client.files.upload({
      file: {
        fileName: validation.filename,
        content: fileBuffer,
      },
      purpose: "ocr"
    });

    console.log(`✅ File uploaded with ID: ${uploadedFile.id}`);

    try {
      // Prepare OCR parameters based on file type
      const ocrParams = {
        model: this.model,
        document: {
          type: "file",
          fileId: uploadedFile.id
        }
      };

      // Handle .docx files specifically - they require image_limit=0 if not including images
      if (validation.fileType === '.docx') {
        if (this.includeImages) {
          ocrParams.includeImageBase64 = true;
          // For .docx with images, images are returned in base64 format
        } else {
          ocrParams.imageLimit = 0; // Don't include images for .docx files
        }
      } else {
        // For other file types, use the standard includeImageBase64 parameter
        ocrParams.includeImageBase64 = this.includeImages;
        if (!this.includeImages) {
          ocrParams.imageLimit = 0;
        }
      }

      // Now process with OCR using the uploaded file ID
      const ocrResponse = await this.client.ocr.process(ocrParams);

      // Process the OCR response
      const results = this.processOCRResponse(ocrResponse, filePath, options);
      
      console.log(`✅ Document OCR completed: ${results.statistics.totalPages} pages, ${results.statistics.totalWords} words`);
      
      return results;
    } finally {
      // Clean up: delete the uploaded file
      try {
        await this.client.files.delete({ fileId: uploadedFile.id });
        console.log(`🗑️ Temporary file deleted: ${uploadedFile.id}`);
      } catch (deleteError) {
        console.warn(`⚠️ Failed to delete temporary file: ${deleteError.message}`);
      }
    }
  }

  /**
   * Process document via base64 (fallback method)
   * @param {string} filePath - Path to document file
   * @param {Object} validation - File validation result
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - OCR results
   */
  async processDocumentViaBase64(filePath, validation, options = {}) {
    console.log('📝 Processing document via base64...');
    
    // Read file as base64
    const fileBuffer = await fs.readFile(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = this.getMimeType(validation.fileType);

    // Prepare OCR parameters based on file type
    const ocrParams = {
      model: this.model,
      document: {
        type: "image_url", // Use image_url type for base64 data
        imageUrl: `data:${mimeType};base64,${base64Data}`
      }
    };

    // Handle .docx files specifically - they require image_limit=0 if not including images
    if (validation.fileType === '.docx') {
      if (this.includeImages) {
        ocrParams.includeImageBase64 = true;
        // For .docx with images, images are returned in base64 format
      } else {
        ocrParams.imageLimit = 0; // Don't include images for .docx files
      }
    } else {
      // For other file types, use the standard includeImageBase64 parameter
      ocrParams.includeImageBase64 = this.includeImages;
      if (!this.includeImages) {
        ocrParams.imageLimit = 0;
      }
    }

    // Use the OCR API with base64 data URL
    const ocrResponse = await this.client.ocr.process(ocrParams);

    // Process the OCR response
    const results = this.processOCRResponse(ocrResponse, filePath, options);
    
    console.log(`✅ Document OCR completed: ${results.statistics.totalPages} pages, ${results.statistics.totalWords} words`);
    
    return results;
  }

  /**
   * Process any supported file with OCR
   * @param {string} filePath - Path to file
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - OCR results
   */
  async processFile(filePath, options = {}) {
    const filename = path.basename(filePath);
    
    if (this.isImageFile(filename)) {
      return await this.processImage(filePath, options);
    } else if (this.isDocumentFile(filename)) {
      return await this.processDocument(filePath, options);
    } else {
      throw new Error(`Unsupported file format: ${path.extname(filename)}`);
    }
  }

  /**
   * Process OCR response from Mistral API
   * @param {Object} ocrResponse - Raw OCR response from Mistral
   * @param {string} filePath - Original file path
   * @param {Object} options - Processing options
   * @returns {Object} - Structured OCR results
   */
  processOCRResponse(ocrResponse, filePath, options = {}) {
    const filename = path.basename(filePath);
    const fileType = path.extname(filename).toLowerCase();
    
    // Process pages from the OCR response
    const pages = ocrResponse.pages?.map((page, index) => ({
      pageNumber: page.index || (index + 1),
      text: page.markdown || '',
      images: page.images || [],
      confidence: null, // Mistral OCR doesn't provide confidence scores
      language: null,   // Mistral OCR doesn't provide language detection
      dimensions: page.dimensions || null
    })) || [];

    // Combine all text
    const fullText = pages.map(page => page.text).join('\n\n');
    
    // Extract structured data
    const structuredData = this.extractStructuredData(fullText);
    
    // Calculate statistics
    const totalWords = fullText.split(/\s+/).filter(word => word.length > 0).length;
    const totalCharacters = fullText.length;

    return {
      filename,
      fileType,
      filePath,
      pages,
      fullText,
      structuredData,
      statistics: {
        totalPages: pages.length,
        totalWords,
        totalCharacters,
        detectedLanguages: [],
        averageConfidence: null
      },
      metadata: {
        processedAt: new Date().toISOString(),
        model: this.model,
        includeImages: this.includeImages,
        ...options
      }
    };
  }

  /**
   * Extract structured data from OCR text
   * @param {string} text - OCR extracted text
   * @returns {Object} - Structured data
   */
  extractStructuredData(text) {
    const structuredData = {
      tables: [],
      lists: [],
      headers: [],
      paragraphs: [],
      images: [],
      links: [],
      dates: [],
      numbers: [],
      emails: [],
      phoneNumbers: []
    };

    // Split text into lines for processing
    const lines = text.split('\n');

    // Extract headers (lines starting with # in markdown)
    lines.forEach(line => {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        structuredData.headers.push({
          level: headerMatch[1].length,
          text: headerMatch[2]
        });
      }
    });

    // Extract tables (lines with |)
    const tableLines = lines.filter(line => line.includes('|') && line.trim().length > 0);
    if (tableLines.length > 0) {
      structuredData.tables = tableLines;
    }

    // Extract lists (lines starting with - or * or numbers)
    lines.forEach(line => {
      const listMatch = line.match(/^[\s]*[-*•]\s+(.+)$/) || line.match(/^[\s]*\d+\.\s+(.+)$/);
      if (listMatch) {
        structuredData.lists.push(listMatch[1]);
      }
    });

    // Extract paragraphs (non-empty lines that aren't headers, tables, or lists)
    const paragraphs = [];
    let currentParagraph = '';
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        if (currentParagraph) {
          paragraphs.push(currentParagraph.trim());
          currentParagraph = '';
        }
      } else if (!trimmedLine.match(/^#{1,6}\s/) && 
                 !trimmedLine.includes('|') && 
                 !trimmedLine.match(/^[\s]*[-*•]\s/) &&
                 !trimmedLine.match(/^[\s]*\d+\.\s/)) {
        currentParagraph += (currentParagraph ? ' ' : '') + trimmedLine;
      }
    });
    
    if (currentParagraph) {
      paragraphs.push(currentParagraph.trim());
    }
    
    structuredData.paragraphs = paragraphs;

    // Extract dates
    const dateMatches = text.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/g);
    if (dateMatches) {
      structuredData.dates = [...new Set(dateMatches)];
    }

    // Extract emails
    const emailMatches = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g);
    if (emailMatches) {
      structuredData.emails = [...new Set(emailMatches)];
    }

    // Extract phone numbers
    const phoneMatches = text.match(/\b(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g);
    if (phoneMatches) {
      structuredData.phoneNumbers = [...new Set(phoneMatches)];
    }

    // Extract numbers (currency, percentages, general numbers)
    const numberMatches = text.match(/\b\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b|\b\d+(?:\.\d+)?%?\b/g);
    if (numberMatches) {
      structuredData.numbers = [...new Set(numberMatches)];
    }

    // Extract URLs
    const urlMatches = text.match(/https?:\/\/[^\s]+/g);
    if (urlMatches) {
      structuredData.links = [...new Set(urlMatches)];
    }

    return structuredData;
  }

  /**
   * Get MIME type for file extension
   * @param {string} extension - File extension
   * @returns {string} - MIME type
   */
  getMimeType(extension) {
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
  }

  /**
   * Format file size in human readable format
   * @param {number} bytes - File size in bytes
   * @returns {string} - Formatted file size
   */
  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get supported formats
   * @returns {Object} - Supported formats
   */
  getSupportedFormats() {
    return {
      images: this.supportedImageFormats,
      documents: this.supportedDocumentFormats,
      all: [...this.supportedImageFormats, ...this.supportedDocumentFormats]
    };
  }
}

export default new OCRService();