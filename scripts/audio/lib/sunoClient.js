/**
 * Suno API Client
 * Wrapper for the Suno music generation API via sunoapi.org
 *
 * API Documentation: https://api.sunoapi.org
 * Rate limits: 20 requests per 10 seconds
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { delay, ensureDirectoryExists, log } = require('./audioUtils');

// Default configuration
const DEFAULT_CONFIG = {
  baseUrl: 'https://api.sunoapi.org',
  webhookUrl: null,
  pollInterval: 5000,    // 5 seconds between status checks
  maxPollAttempts: 120,  // 10 minutes max wait time
  rateLimitDelay: 500    // 500ms between requests to stay under rate limit
};

// Generation status values (from API docs)
const STATUS = {
  PENDING: 'PENDING',
  TEXT_SUCCESS: 'TEXT_SUCCESS',       // Lyrics generation completed
  FIRST_SUCCESS: 'FIRST_SUCCESS',     // Initial track generation complete
  SUCCESS: 'SUCCESS',                 // All tracks generated successfully
  CREATE_TASK_FAILED: 'CREATE_TASK_FAILED',
  GENERATE_AUDIO_FAILED: 'GENERATE_AUDIO_FAILED',
  CALLBACK_EXCEPTION: 'CALLBACK_EXCEPTION',
  SENSITIVE_WORD_ERROR: 'SENSITIVE_WORD_ERROR',
  // Legacy/internal status
  PROCESSING: 'PROCESSING',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT'
};

/**
 * Suno API Client for music generation
 */
class SunoClient {
  /**
   * Create a new SunoClient instance
   * @param {Object} config - Configuration options
   * @param {string} config.apiKey - API key for authentication
   * @param {string} [config.baseUrl] - Base URL for the API
   * @param {string} [config.webhookUrl] - Webhook URL for completion notifications
   */
  constructor(config) {
    if (!config.apiKey) {
      throw new Error('SunoClient requires an API key');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
    this.webhookUrl = config.webhookUrl || DEFAULT_CONFIG.webhookUrl;
    this.pollInterval = DEFAULT_CONFIG.pollInterval;
    this.maxPollAttempts = DEFAULT_CONFIG.maxPollAttempts;
    this.rateLimitDelay = DEFAULT_CONFIG.rateLimitDelay;
    this.lastRequestTime = 0;
  }

  /**
   * Make an HTTP request with rate limiting
   * @private
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} [data] - Request body data
   * @returns {Promise<Object>} Response data
   */
  async _request(method, endpoint, data = null) {
    // Enforce rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await delay(this.rateLimitDelay - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();

    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          log(`HTTP ${res.statusCode} ${res.statusMessage}`, 'debug');
          log(`Response headers: ${JSON.stringify(res.headers)}`, 'debug');
          log(`Response body: ${body.substring(0, 1000)}${body.length > 1000 ? '...' : ''}`, 'debug');

          try {
            const response = JSON.parse(body);

            if (res.statusCode === 429) {
              reject(new Error('Rate limit exceeded. Please wait before making more requests.'));
              return;
            }

            if (res.statusCode >= 400) {
              reject(new Error(response.message || `HTTP ${res.statusCode}: ${body}`));
              return;
            }

            resolve(response);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Generate a music track
   * @param {string} prompt - Text prompt describing the desired music (lyrics for non-custom, description for custom)
   * @param {Object} [options] - Generation options
   * @param {string} [options.title] - Track title (required for custom mode)
   * @param {string} [options.style] - Style tags (e.g., "orchestral, epic, fantasy") - required for custom instrumental
   * @param {boolean} [options.instrumental] - Generate instrumental only (no vocals)
   * @param {string} [options.model] - Model version: V3_5, V4, V4_5, V4_5ALL, V4_5PLUS, or V5
   * @param {boolean} [options.customMode] - Use custom mode (true) or simple prompt mode (false)
   * @param {boolean} [options.waitForCompletion] - Wait for generation to complete
   * @returns {Promise<Object>} Generation task info or completed track
   */
  async generateTrack(prompt, options = {}) {
    const {
      title = '',
      style = '',
      instrumental = true,
      model = 'V4_5ALL',
      customMode = true,
      waitForCompletion = false
    } = options;

    log(`Starting track generation: "${prompt.substring(0, 50)}..."`, 'info');

    // callBackUrl is required by the API, but we use polling instead of callbacks
    // If no webhook URL provided, use a placeholder (we'll poll for status anyway)
    const callbackUrl = this.webhookUrl || 'https://localhost/suno-callback-unused';

    // Build request body based on mode
    const requestBody = {
      model: model,
      instrumental: instrumental,
      callBackUrl: callbackUrl
    };

    if (customMode) {
      // Custom mode: style and title required for instrumental
      requestBody.customMode = true;
      requestBody.prompt = prompt;  // In custom mode, this is the lyrics/description

      if (style) {
        requestBody.style = style;
      }

      if (title) {
        requestBody.title = title;
      }
    } else {
      // Simple mode: only prompt needed (max 500 chars)
      requestBody.customMode = false;
      requestBody.prompt = prompt.substring(0, 500);
    }

    try {
      log(`Sending generation request to ${this.baseUrl}/api/v1/generate`, 'debug');
      log(`Request body: ${JSON.stringify(requestBody, null, 2)}`, 'debug');

      const response = await this._request('POST', '/api/v1/generate', requestBody);

      log(`API Response: ${JSON.stringify(response, null, 2)}`, 'debug');

      // Response format: { code: 200, msg: "success", data: { taskId: "..." } }
      const taskId = response.data?.taskId;

      if (!taskId) {
        log(`Response missing taskId. Full response: ${JSON.stringify(response)}`, 'error');
        throw new Error(`No taskId returned from generation request. Response: ${JSON.stringify(response)}`);
      }

      log(`Generation started: taskId=${taskId}`, 'info');

      if (waitForCompletion) {
        return await this.waitForCompletion(taskId);
      }

      return {
        taskId: taskId,
        status: STATUS.PENDING,
        prompt: prompt,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      log(`Generation failed: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Check the status of a generation task
   * @param {string} taskId - The task ID to check
   * @returns {Promise<Object>} Task status and details
   */
  async checkStatus(taskId) {
    if (!taskId) {
      throw new Error('taskId is required');
    }

    try {
      const response = await this._request(
        'GET',
        `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`
      );

      log(`Status check response: ${JSON.stringify(response, null, 2)}`, 'debug');

      // Response format: { code, msg, data: { taskId, status, response: { sunoData: [...] }, errorCode, errorMessage } }
      const data = response.data || {};
      const status = data.status || STATUS.PENDING;
      const sunoData = data.response?.sunoData || [];

      // Check for failure statuses
      const isError = [
        STATUS.CREATE_TASK_FAILED,
        STATUS.GENERATE_AUDIO_FAILED,
        STATUS.CALLBACK_EXCEPTION,
        STATUS.SENSITIVE_WORD_ERROR
      ].includes(status);

      // Extract audio info from first track (Suno generates 2 tracks per request)
      const firstTrack = sunoData[0] || {};

      return {
        taskId: taskId,
        status: status,
        isComplete: status === STATUS.SUCCESS,
        isError: isError,
        errorCode: data.errorCode || null,
        errorMessage: data.errorMessage || null,
        // Audio data from first generated track
        audioUrl: firstTrack.audioUrl || null,
        streamAudioUrl: firstTrack.streamAudioUrl || null,
        imageUrl: firstTrack.imageUrl || null,
        title: firstTrack.title || null,
        duration: firstTrack.duration || null,
        tags: firstTrack.tags || null,
        // All generated tracks (usually 2)
        tracks: sunoData.map(track => ({
          id: track.id,
          audioUrl: track.audioUrl,
          streamAudioUrl: track.streamAudioUrl,
          imageUrl: track.imageUrl,
          title: track.title,
          duration: track.duration,
          tags: track.tags,
          prompt: track.prompt,
          modelName: track.modelName,
          createTime: track.createTime
        })),
        raw: response
      };
    } catch (error) {
      log(`Status check failed for ${taskId}: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Wait for a generation task to complete
   * @param {string} taskId - The task ID to wait for
   * @returns {Promise<Object>} Completed task details
   */
  async waitForCompletion(taskId) {
    log(`Waiting for completion: taskId=${taskId}`, 'info');

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const result = await this.checkStatus(taskId);

      if (result.isComplete) {
        log(`Generation completed: ${taskId}`, 'success');
        return result;
      }

      if (result.isError) {
        throw new Error(`Generation failed: ${result.errorMessage || result.status}`);
      }

      // Log progress periodically (every 30 seconds)
      if (attempt % 6 === 0) {
        log(`Still processing... status=${result.status}`, 'info');
      }

      await delay(this.pollInterval);
    }

    throw new Error(`Generation timed out after ${this.maxPollAttempts * this.pollInterval / 1000} seconds`);
  }

  /**
   * Download a single audio file from URL
   * @private
   * @param {string} audioUrl - URL to download from
   * @param {string} outputPath - Path where the file should be saved
   * @returns {Promise<Object>} Download result with file path and size
   */
  async _downloadFile(audioUrl, outputPath) {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    ensureDirectoryExists(outputDir);

    return new Promise((resolve, reject) => {
      const url = new URL(audioUrl);
      const protocol = url.protocol === 'https:' ? https : require('http');

      const file = fs.createWriteStream(outputPath);

      protocol.get(audioUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          protocol.get(response.headers.location, (redirectRes) => {
            redirectRes.pipe(file);
          }).on('error', reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          const stats = fs.statSync(outputPath);
          resolve({
            path: outputPath,
            size: stats.size
          });
        });
      }).on('error', (error) => {
        fs.unlink(outputPath, () => {}); // Delete partial file
        reject(new Error(`Download failed: ${error.message}`));
      });
    });
  }

  /**
   * Download a completed track to a file (downloads primary track only)
   * @param {string} taskId - The task ID of the completed track
   * @param {string} outputPath - Path where the file should be saved
   * @returns {Promise<Object>} Download result with file path and size
   */
  async downloadTrack(taskId, outputPath) {
    // First get the track status to get the audio URL
    const result = await this.checkStatus(taskId);

    if (!result.isComplete) {
      throw new Error(`Track is not ready for download. Status: ${result.status}`);
    }

    if (!result.audioUrl) {
      throw new Error('No audio URL available for download');
    }

    log(`Downloading track to ${outputPath}`, 'info');

    const downloadResult = await this._downloadFile(result.audioUrl, outputPath);
    log(`Download complete: ${outputPath} (${downloadResult.size} bytes)`, 'success');

    return {
      ...downloadResult,
      taskId: taskId,
      title: result.title,
      duration: result.duration
    };
  }

  /**
   * Download ALL completed tracks from a task (Suno generates 2 tracks per request)
   * Saves both tracks to preserve credits - primary track uses outputPath,
   * additional tracks get _v2, _v3 suffix
   * @param {string} taskId - The task ID of the completed tracks
   * @param {string} outputPath - Base path where files should be saved
   * @returns {Promise<Object>} Download results with all file paths and sizes
   */
  async downloadAllTracks(taskId, outputPath) {
    // First get the track status to get all audio URLs
    const result = await this.checkStatus(taskId);

    if (!result.isComplete) {
      throw new Error(`Tracks not ready for download. Status: ${result.status}`);
    }

    if (!result.tracks || result.tracks.length === 0) {
      throw new Error('No tracks available for download');
    }

    log(`Downloading ${result.tracks.length} tracks from task ${taskId}`, 'info');

    const downloads = [];
    const ext = path.extname(outputPath);
    const base = outputPath.slice(0, -ext.length);

    for (let i = 0; i < result.tracks.length; i++) {
      const track = result.tracks[i];
      if (!track.audioUrl) {
        log(`Track ${i + 1} has no audio URL, skipping`, 'warn');
        continue;
      }

      // First track uses original path, others get _v2, _v3 suffix
      const trackPath = i === 0 ? outputPath : `${base}_v${i + 1}${ext}`;

      log(`Downloading track ${i + 1}/${result.tracks.length} to ${trackPath}`, 'info');
      const downloadResult = await this._downloadFile(track.audioUrl, trackPath);
      log(`Download complete: ${trackPath} (${downloadResult.size} bytes)`, 'success');

      downloads.push({
        ...downloadResult,
        trackIndex: i,
        title: track.title,
        duration: track.duration
      });
    }

    return {
      taskId: taskId,
      totalTracks: result.tracks.length,
      downloads: downloads,
      primaryPath: outputPath
    };
  }

  /**
   * Generate and download a track in one call
   * @param {string} prompt - Text prompt describing the desired music
   * @param {string} outputPath - Path where the file should be saved
   * @param {Object} [options] - Generation options (same as generateTrack)
   * @returns {Promise<Object>} Download result
   */
  async generateAndDownload(prompt, outputPath, options = {}) {
    const result = await this.generateTrack(prompt, { ...options, waitForCompletion: true });
    return await this.downloadTrack(result.taskId, outputPath);
  }
}

module.exports = {
  SunoClient,
  STATUS,
  DEFAULT_CONFIG
};
