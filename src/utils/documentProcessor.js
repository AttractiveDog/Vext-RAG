import fs from 'fs/promises';
import path from 'path';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import ocrService from '../services/ocrService.js';

class DocumentProcessor {
  constructor() {
    this.supportedFormats = ['.pdf', '.docx', '.txt', '.html', '.htm'];
    this.ocrEnabled = process.env.MISTRAL_API_KEY ? true : false;
    
    // Add OCR-supported formats if OCR is available
    if (this.ocrEnabled) {
      const ocrFormats = ocrService.getSupportedFormats();
      this.supportedFormats = [...new Set([...this.supportedFormats, ...ocrFormats.all])];
    }
  }

  /**
   * Check if file format is supported
   * @param {string} filename - File name
   * @returns {boolean} - True if format is supported
   */
  isSupportedFormat(filename) {
    const ext = path.extname(filename).toLowerCase();
    return this.supportedFormats.includes(ext);
  }

  /**
   * Check if file should be processed with OCR
   * @param {string} filename - File name
   * @returns {boolean} - True if OCR processing is needed
   */
  shouldUseOCR(filename) {
    if (!this.ocrEnabled) return false;
    return ocrService.isSupportedFormat(filename);
  }

  /**
   * Get file extension
   * @param {string} filename - File name
   * @returns {string} - File extension
   */
  getFileExtension(filename) {
    return path.extname(filename).toLowerCase();
  }

  /**
   * Process a document file and extract text content
   * @param {string} filePath - Path to the file
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<{text: string, metadata: Object}>} - Processed document
   */
  async processDocument(filePath, metadata = {}) {
    try {
      const filename = path.basename(filePath);
      const ext = this.getFileExtension(filename);

      if (!this.isSupportedFormat(filename)) {
        throw new Error(`Unsupported file format: ${ext}`);
      }

      console.log(`Processing document: ${filename}`);

      let text = '';
      let extractedMetadata = {
        filename,
        fileType: ext,
        processedAt: new Date().toISOString(),
        ...metadata
      };

      // Check if OCR processing is needed
      if (this.shouldUseOCR(filename)) {
        console.log(`🔍 Using OCR processing for: ${filename}`);
        const ocrResult = await ocrService.processFile(filePath, metadata);
        
        text = ocrResult.fullText;
        extractedMetadata = {
          ...extractedMetadata,
          ...ocrResult.statistics,
          structuredData: ocrResult.structuredData,
          ocrProcessed: true,
          ocrModel: ocrResult.metadata.model,
          detectedLanguages: ocrResult.statistics.detectedLanguages,
          averageConfidence: ocrResult.statistics.averageConfidence
        };
      } else {
        // Use traditional processing methods
        switch (ext) {
          case '.pdf':
            text = await this.processPDF(filePath);
            break;
          case '.docx':
            text = await this.processDOCX(filePath);
            break;
          case '.txt':
            text = await this.processTXT(filePath);
            break;
          case '.html':
          case '.htm':
            text = await this.processHTML(filePath);
            break;
          default:
            throw new Error(`Unsupported file format: ${ext}`);
        }

        // Clean and normalize text
        text = this.cleanText(text);
      }

      // Add text statistics to metadata
      extractedMetadata.textLength = text.length;
      extractedMetadata.wordCount = text.split(/\s+/).length;
      extractedMetadata.lineCount = text.split('\n').length;

      console.log(`✅ Successfully processed ${filename} (${extractedMetadata.wordCount} words)`);

      return {
        text,
        metadata: extractedMetadata
      };
    } catch (error) {
      console.error(`Error processing document ${filePath}:`, error);
      throw new Error(`Failed to process document: ${error.message}`);
    }
  }

  /**
   * Process PDF file
   * @param {string} filePath - Path to PDF file
   * @returns {Promise<string>} - Extracted text
   */
  async processPDF(filePath) {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdf(dataBuffer);
      return data.text;
    } catch (error) {
      throw new Error(`PDF processing failed: ${error.message}`);
    }
  }

  /**
   * Process DOCX file
   * @param {string} filePath - Path to DOCX file
   * @returns {Promise<string>} - Extracted text
   */
  async processDOCX(filePath) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (error) {
      throw new Error(`DOCX processing failed: ${error.message}`);
    }
  }

  /**
   * Process TXT file
   * @param {string} filePath - Path to TXT file
   * @returns {Promise<string>} - Extracted text
   */
  async processTXT(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      throw new Error(`TXT processing failed: ${error.message}`);
    }
  }

  /**
   * Process HTML file
   * @param {string} filePath - Path to HTML file
   * @returns {Promise<string>} - Extracted text
   */
  async processHTML(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const $ = cheerio.load(content);
      
      // Remove script and style elements
      $('script').remove();
      $('style').remove();
      
      // Extract text from body or html element
      const text = $('body').text() || $('html').text() || $.text();
      return text;
    } catch (error) {
      throw new Error(`HTML processing failed: ${error.message}`);
    }
  }

  /**
   * Clean and normalize extracted text
   * @param {string} text - Raw text
   * @returns {string} - Cleaned text
   */
  cleanText(text) {
    if (!text) return '';

    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove excessive newlines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      // Remove leading/trailing whitespace
      .trim()
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  /**
   * Get file information
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} - File information
   */
  async getFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const filename = path.basename(filePath);
      const ext = this.getFileExtension(filename);

      return {
        filename,
        extension: ext,
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size),
        created: stats.birthtime,
        modified: stats.mtime,
        isSupported: this.isSupportedFormat(filename)
      };
    } catch (error) {
      throw new Error(`Failed to get file info: ${error.message}`);
    }
  }

  /**
   * Format file size in human readable format
   * @param {number} bytes - File size in bytes
   * @returns {string} - Formatted file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Validate file before processing
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>} - True if file is valid
   */
  async validateFile(filePath) {
    try {
      const fileInfo = await this.getFileInfo(filePath);
      
      if (!fileInfo.isSupported) {
        throw new Error(`Unsupported file format: ${fileInfo.extension}`);
      }

      if (fileInfo.size === 0) {
        throw new Error('File is empty');
      }

      // Check file size limit (50MB)
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (fileInfo.size > maxSize) {
        throw new Error(`File too large: ${fileInfo.sizeFormatted}. Maximum size is 50MB`);
      }

      return true;
    } catch (error) {
      throw new Error(`File validation failed: ${error.message}`);
    }
  }

  /**
   * Get supported file formats
   * @returns {Array<string>} - List of supported formats
   */
  getSupportedFormats() {
    return this.supportedFormats.map(format => format.substring(1)); // Remove dot
  }
}

export default new DocumentProcessor(); 