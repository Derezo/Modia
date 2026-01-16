/**
 * ElevenLabs Sound Effects Generator
 * Wrapper for the ElevenLabs API for generating sound effects and ambient audio
 *
 * Uses the official @elevenlabs/elevenlabs-js SDK
 */

const fs = require('fs');
const path = require('path');
const { ensureDirectoryExists, log, delay } = require('./audioUtils');

// Default configuration
const DEFAULT_CONFIG = {
  sfxDuration: 2,           // Default 2 seconds for short SFX
  ambientDuration: 15,      // Default 15 seconds for ambient loops
  promptInfluence: 0.5,     // Balance between prompt and natural variation (0-1)
  rateLimitDelay: 200       // Delay between requests in ms
};

/**
 * ElevenLabs Sound Effects Generator
 */
class ElevenLabsSFXGenerator {
  /**
   * Create a new ElevenLabsSFXGenerator instance
   * @param {string} apiKey - ElevenLabs API key
   */
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('ElevenLabsSFXGenerator requires an API key');
    }

    this.apiKey = apiKey;
    this.client = null;
    this.lastRequestTime = 0;
    this.rateLimitDelay = DEFAULT_CONFIG.rateLimitDelay;
  }

  /**
   * Initialize the ElevenLabs client (lazy loading)
   * @private
   */
  async _initClient() {
    if (this.client) {
      return;
    }

    try {
      // Dynamic import of the ElevenLabs SDK
      const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
      this.client = new ElevenLabsClient({ apiKey: this.apiKey });
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'ElevenLabs SDK not installed. Please run: npm install @elevenlabs/elevenlabs-js'
        );
      }
      throw error;
    }
  }

  /**
   * Enforce rate limiting between requests
   * @private
   */
  async _rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await delay(this.rateLimitDelay - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Save audio stream to file
   * @private
   * @param {ReadableStream|Buffer|AsyncIterable} audio - Audio data
   * @param {string} outputPath - Output file path
   * @returns {Promise<Object>} File info
   */
  async _saveAudioToFile(audio, outputPath) {
    ensureDirectoryExists(path.dirname(outputPath));

    return new Promise(async (resolve, reject) => {
      try {
        const writeStream = fs.createWriteStream(outputPath);
        let totalBytes = 0;

        // Handle different audio response types
        if (Buffer.isBuffer(audio)) {
          // Direct buffer
          writeStream.write(audio);
          totalBytes = audio.length;
          writeStream.end();
        } else if (audio instanceof ReadableStream || (audio && typeof audio[Symbol.asyncIterator] === 'function')) {
          // Async iterable (streaming response)
          for await (const chunk of audio) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            writeStream.write(buffer);
            totalBytes += buffer.length;
          }
          writeStream.end();
        } else if (audio && audio.pipe) {
          // Node.js stream
          audio.pipe(writeStream);
          audio.on('data', (chunk) => {
            totalBytes += chunk.length;
          });
        } else {
          reject(new Error('Unsupported audio response type'));
          return;
        }

        writeStream.on('finish', () => {
          log(`Saved audio: ${outputPath} (${totalBytes} bytes)`, 'success');
          resolve({
            path: outputPath,
            size: totalBytes
          });
        });

        writeStream.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate a sound effect
   * @param {string} prompt - Text description of the sound effect
   * @param {string} outputPath - Path where the file should be saved
   * @param {Object} [options] - Generation options
   * @param {number} [options.duration] - Duration in seconds (default: 2)
   * @param {number} [options.promptInfluence] - Prompt influence 0-1 (default: 0.5)
   * @returns {Promise<Object>} Generated file info
   */
  async generateSFX(prompt, outputPath, options = {}) {
    const {
      duration = DEFAULT_CONFIG.sfxDuration,
      promptInfluence = DEFAULT_CONFIG.promptInfluence
    } = options;

    await this._initClient();
    await this._rateLimit();

    log(`Generating SFX: "${prompt.substring(0, 50)}..." (${duration}s)`, 'info');

    try {
      const audio = await this.client.textToSoundEffects.convert({
        text: prompt,
        duration_seconds: duration,
        prompt_influence: promptInfluence
      });

      const result = await this._saveAudioToFile(audio, outputPath);

      return {
        ...result,
        prompt: prompt,
        duration: duration,
        type: 'sfx'
      };
    } catch (error) {
      log(`SFX generation failed: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Generate ambient/environmental audio
   * @param {string} prompt - Text description of the ambient sound
   * @param {string} outputPath - Path where the file should be saved
   * @param {Object} [options] - Generation options
   * @param {number} [options.duration] - Duration in seconds (default: 15)
   * @param {number} [options.promptInfluence] - Prompt influence 0-1 (default: 0.5)
   * @returns {Promise<Object>} Generated file info
   */
  async generateAmbient(prompt, outputPath, options = {}) {
    const {
      duration = DEFAULT_CONFIG.ambientDuration,
      promptInfluence = DEFAULT_CONFIG.promptInfluence
    } = options;

    await this._initClient();
    await this._rateLimit();

    log(`Generating ambient: "${prompt.substring(0, 50)}..." (${duration}s)`, 'info');

    try {
      const audio = await this.client.textToSoundEffects.convert({
        text: prompt,
        duration_seconds: duration,
        prompt_influence: promptInfluence
      });

      const result = await this._saveAudioToFile(audio, outputPath);

      return {
        ...result,
        prompt: prompt,
        duration: duration,
        type: 'ambient'
      };
    } catch (error) {
      log(`Ambient generation failed: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Generate multiple sound effects in batch
   * @param {Array<Object>} batch - Array of {prompt, outputPath, options} objects
   * @param {Object} [batchOptions] - Batch options
   * @param {boolean} [batchOptions.stopOnError] - Stop on first error (default: false)
   * @param {number} [batchOptions.delayBetween] - Delay between generations in ms (default: 500)
   * @returns {Promise<Object>} Batch results with successful and failed generations
   */
  async generateBatch(batch, batchOptions = {}) {
    const {
      stopOnError = false,
      delayBetween = 500
    } = batchOptions;

    const results = {
      successful: [],
      failed: [],
      total: batch.length
    };

    log(`Starting batch generation of ${batch.length} items`, 'info');

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];

      try {
        log(`Processing ${i + 1}/${batch.length}: ${item.prompt.substring(0, 30)}...`, 'info');

        const isAmbient = item.options?.type === 'ambient';
        const result = isAmbient
          ? await this.generateAmbient(item.prompt, item.outputPath, item.options)
          : await this.generateSFX(item.prompt, item.outputPath, item.options);

        results.successful.push({
          ...result,
          index: i
        });

        // Delay between generations
        if (i < batch.length - 1) {
          await delay(delayBetween);
        }
      } catch (error) {
        const failure = {
          prompt: item.prompt,
          outputPath: item.outputPath,
          error: error.message,
          index: i
        };

        results.failed.push(failure);
        log(`Failed item ${i + 1}: ${error.message}`, 'error');

        if (stopOnError) {
          log('Stopping batch due to error', 'warn');
          break;
        }
      }
    }

    log(`Batch complete: ${results.successful.length} successful, ${results.failed.length} failed`, 'info');
    return results;
  }
}

module.exports = {
  ElevenLabsSFXGenerator,
  DEFAULT_CONFIG
};
