class TextChunker {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 1000;
    this.chunkOverlap = options.chunkOverlap || 200;
    this.separators = options.separators || ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' '];
  }

  /**
   * Split text into chunks based on size and overlap
   * @param {string} text - Text to chunk
   * @param {Object} options - Chunking options
   * @returns {Array<{text: string, start: number, end: number}>} - Array of text chunks
   */
  chunkText(text, options = {}) {
    const chunkSize = options.chunkSize || this.chunkSize;
    const chunkOverlap = options.chunkOverlap || this.chunkOverlap;
    const separators = options.separators || this.separators;

    if (!text || text.length <= chunkSize) {
      return [{
        text: text,
        start: 0,
        end: text.length
      }];
    }

    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + chunkSize;

      // If this isn't the last chunk, try to break at a natural boundary
      if (end < text.length) {
        end = this.findBestBreakPoint(text, start, end, separators);
      }

      const chunk = text.substring(start, end).trim();
      
      if (chunk.length > 0) {
        chunks.push({
          text: chunk,
          start: start,
          end: end
        });
      }

      // Move start position for next chunk, accounting for overlap
      start = end - chunkOverlap;
      
      // Ensure we don't go backwards
      if (start <= chunks.length > 0 ? chunks[chunks.length - 1].start : 0) {
        start = end;
      }
    }

    return chunks;
  }

  /**
   * Find the best break point for a chunk within the given range
   * @param {string} text - Full text
   * @param {number} start - Start position
   * @param {number} end - End position
   * @param {Array<string>} separators - Separator characters to try
   * @returns {number} - Best break position
   */
  findBestBreakPoint(text, start, end, separators) {
    const chunk = text.substring(start, end);
    
    // Try each separator in order of preference
    for (const separator of separators) {
      const lastIndex = chunk.lastIndexOf(separator);
      if (lastIndex > chunk.length * 0.5) { // Only break if separator is in the latter half
        return start + lastIndex + separator.length;
      }
    }

    // If no good break point found, return the original end
    return end;
  }

  /**
   * Split text by sentences
   * @param {string} text - Text to split
   * @returns {Array<string>} - Array of sentences
   */
  splitBySentences(text) {
    if (!text) return [];

    // Split by sentence endings, preserving the punctuation
    const sentences = text.split(/(?<=[.!?])\s+/);
    return sentences.filter(sentence => sentence.trim().length > 0);
  }

  /**
   * Split text by paragraphs
   * @param {string} text - Text to split
   * @returns {Array<string>} - Array of paragraphs
   */
  splitByParagraphs(text) {
    if (!text) return [];

    const paragraphs = text.split(/\n\s*\n/);
    return paragraphs.filter(paragraph => paragraph.trim().length > 0);
  }

  /**
   * Split text by words
   * @param {string} text - Text to split
   * @returns {Array<string>} - Array of words
   */
  splitByWords(text) {
    if (!text) return [];

    const words = text.split(/\s+/);
    return words.filter(word => word.trim().length > 0);
  }

  /**
   * Create overlapping chunks from sentences
   * @param {string} text - Text to chunk
   * @param {Object} options - Chunking options
   * @returns {Array<{text: string, start: number, end: number}>} - Array of chunks
   */
  chunkBySentences(text, options = {}) {
    const sentences = this.splitBySentences(text);
    const maxSentences = options.maxSentences || 5;
    const overlap = options.overlap || 1;

    const chunks = [];
    let currentChunk = [];
    let start = 0;

    for (let i = 0; i < sentences.length; i++) {
      currentChunk.push(sentences[i]);

      if (currentChunk.length >= maxSentences) {
        const chunkText = currentChunk.join(' ');
        const end = text.indexOf(chunkText) + chunkText.length;
        
        chunks.push({
          text: chunkText,
          start: start,
          end: end
        });

        // Remove overlap sentences from the beginning
        currentChunk = currentChunk.slice(overlap);
        start = text.indexOf(currentChunk[0], start);
      }
    }

    // Add remaining sentences as the last chunk
    if (currentChunk.length > 0) {
      const chunkText = currentChunk.join(' ');
      const end = text.indexOf(chunkText) + chunkText.length;
      
      chunks.push({
        text: chunkText,
        start: start,
        end: end
      });
    }

    return chunks;
  }

  /**
   * Create semantic chunks based on content similarity
   * @param {string} text - Text to chunk
   * @param {Object} options - Chunking options
   * @returns {Array<{text: string, start: number, end: number}>} - Array of chunks
   */
  chunkSemantically(text, options = {}) {
    // This is a simplified semantic chunking approach
    // In a real implementation, you might use embeddings or NLP techniques
    
    const paragraphs = this.splitByParagraphs(text);
    const maxChunkSize = options.maxChunkSize || 1000;
    
    const chunks = [];
    let currentChunk = '';
    let start = 0;

    for (const paragraph of paragraphs) {
      if ((currentChunk + paragraph).length > maxChunkSize && currentChunk.length > 0) {
        // Current chunk is getting too large, save it and start a new one
        chunks.push({
          text: currentChunk.trim(),
          start: start,
          end: text.indexOf(currentChunk) + currentChunk.length
        });

        currentChunk = paragraph;
        start = text.indexOf(paragraph);
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    // Add the last chunk
    if (currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        start: start,
        end: text.indexOf(currentChunk) + currentChunk.length
      });
    }

    return chunks;
  }

  /**
   * Get chunk statistics
   * @param {Array<{text: string, start: number, end: number}>} chunks - Array of chunks
   * @returns {Object} - Statistics about the chunks
   */
  getChunkStats(chunks) {
    if (!chunks || chunks.length === 0) {
      return {
        totalChunks: 0,
        averageChunkSize: 0,
        minChunkSize: 0,
        maxChunkSize: 0,
        totalTextLength: 0
      };
    }

    const sizes = chunks.map(chunk => chunk.text.length);
    const totalLength = sizes.reduce((sum, size) => sum + size, 0);

    return {
      totalChunks: chunks.length,
      averageChunkSize: Math.round(totalLength / chunks.length),
      minChunkSize: Math.min(...sizes),
      maxChunkSize: Math.max(...sizes),
      totalTextLength: totalLength
    };
  }

  /**
   * Validate chunking options
   * @param {Object} options - Options to validate
   * @returns {boolean} - True if options are valid
   */
  validateOptions(options) {
    const { chunkSize, chunkOverlap } = options;

    if (chunkSize && chunkSize <= 0) {
      throw new Error('chunkSize must be greater than 0');
    }

    if (chunkOverlap && chunkOverlap < 0) {
      throw new Error('chunkOverlap must be non-negative');
    }

    if (chunkSize && chunkOverlap && chunkOverlap >= chunkSize) {
      throw new Error('chunkOverlap must be less than chunkSize');
    }

    return true;
  }
}

export default TextChunker; 