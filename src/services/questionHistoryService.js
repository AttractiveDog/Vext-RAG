import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class QuestionHistoryService {
  constructor() {
    this.historyFile = path.join(__dirname, '../../data/question_history.json');
    this.maxHistorySize = 50; // Keep last 50 questions
    this.history = [];
    this.initialized = false;
  }

  /**
   * Initialize the service and load existing history
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.historyFile);
      try {
        await fs.access(dataDir);
      } catch {
        await fs.mkdir(dataDir, { recursive: true });
      }

      // Load existing history
      try {
        const data = await fs.readFile(this.historyFile, 'utf8');
        this.history = JSON.parse(data);
      } catch (error) {
        // File doesn't exist or is invalid, start with empty history
        this.history = [];
      }

      this.initialized = true;
      console.log(`✅ Question history service initialized with ${this.history.length} entries`);
    } catch (error) {
      console.error('Error initializing question history service:', error);
      throw new Error(`Failed to initialize question history service: ${error.message}`);
    }
  }

  /**
   * Add a new question and answer to history
   * @param {Object} questionData - Question data
   * @param {string} questionData.question - The question asked
   * @param {string} questionData.answer - The answer provided
   * @param {Array} questionData.sources - Source documents
   * @param {number} questionData.confidence - Confidence score
   * @param {string} questionData.model - AI model used
   * @param {number} questionData.tokens - Tokens used
   * @returns {Promise<Object>} - The saved question entry
   */
  async addQuestion(questionData) {
    await this.initialize();

    const entry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      question: questionData.question,
      answer: questionData.answer,
      sources: questionData.sources || [],
      confidence: questionData.confidence || 0,
      model: questionData.model || 'unknown',
      tokens: questionData.tokens || 0
    };

    // Add to beginning of array (most recent first)
    this.history.unshift(entry);

    // Keep only the most recent entries
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }

    // Save to file
    await this.saveHistory();

    return entry;
  }

  /**
   * Get recent questions
   * @param {number} limit - Maximum number of questions to return
   * @returns {Promise<Array>} - Array of recent questions
   */
  async getRecentQuestions(limit = 10) {
    await this.initialize();
    return this.history.slice(0, limit);
  }

  /**
   * Get all questions
   * @returns {Promise<Array>} - Array of all questions
   */
  async getAllQuestions() {
    await this.initialize();
    return this.history;
  }

  /**
   * Get a specific question by ID
   * @param {string} id - Question ID
   * @returns {Promise<Object|null>} - Question entry or null if not found
   */
  async getQuestionById(id) {
    await this.initialize();
    return this.history.find(q => q.id === id) || null;
  }

  /**
   * Clear all question history
   * @returns {Promise<boolean>} - Success status
   */
  async clearHistory() {
    await this.initialize();
    this.history = [];
    await this.saveHistory();
    return true;
  }

  /**
   * Delete a specific question
   * @param {string} id - Question ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteQuestion(id) {
    await this.initialize();
    const initialLength = this.history.length;
    this.history = this.history.filter(q => q.id !== id);
    
    if (this.history.length < initialLength) {
      await this.saveHistory();
      return true;
    }
    return false;
  }

  /**
   * Save history to file
   * @private
   */
  async saveHistory() {
    try {
      await fs.writeFile(this.historyFile, JSON.stringify(this.history, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving question history:', error);
      throw new Error(`Failed to save question history: ${error.message}`);
    }
  }

  /**
   * Generate a unique ID for questions
   * @private
   */
  generateId() {
    return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get statistics about question history
   * @returns {Promise<Object>} - Statistics object
   */
  async getStats() {
    await this.initialize();
    
    const totalQuestions = this.history.length;
    const totalTokens = this.history.reduce((sum, q) => sum + (q.tokens || 0), 0);
    const avgConfidence = totalQuestions > 0 
      ? this.history.reduce((sum, q) => sum + (q.confidence || 0), 0) / totalQuestions 
      : 0;

    const modelsUsed = [...new Set(this.history.map(q => q.model))];
    
    return {
      totalQuestions,
      totalTokens,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      modelsUsed,
      maxHistorySize: this.maxHistorySize
    };
  }
}

export default new QuestionHistoryService(); 