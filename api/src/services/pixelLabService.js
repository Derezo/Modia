/**
 * PixelLab API Client Service
 * Handles communication with PixelLab's AI pixel art generation API
 *
 * @see https://api.pixellab.ai/v2/docs
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

class PixelLabClient {
  constructor(options = {}) {
    // Support both PIXELLAB_API_KEY and PIXELLABS_API_KEY (common typo)
    this.apiKey = options.apiKey || process.env.PIXELLAB_API_KEY || process.env.PIXELLABS_API_KEY;
    this.baseUrl = options.baseUrl || process.env.PIXELLAB_BASE_URL || 'https://api.pixellab.ai/v2';
    this.pollIntervalMs = options.pollIntervalMs || 2000;
    this.maxPollAttempts = options.maxPollAttempts || 150; // 5 minutes max
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
    this.maxConcurrent = options.maxConcurrent || 3;
    this.debugLogDir = options.debugLogDir || path.join(process.cwd(), '.pixellab-cache', 'debug');
    this.enableDebugLogging = options.enableDebugLogging ?? (process.env.PIXELLAB_DEBUG === 'true');

    if (!this.apiKey) {
      throw new Error('PIXELLAB_API_KEY is required');
    }
  }

  /**
   * Log API response to file for debugging
   */
  async logResponse(endpoint, response) {
    if (!this.enableDebugLogging) return;

    try {
      await fs.mkdir(this.debugLogDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeName = endpoint.replace(/[^a-zA-Z0-9]/g, '_');
      const logPath = path.join(this.debugLogDir, `${timestamp}_${safeName}.json`);
      await fs.writeFile(logPath, JSON.stringify(response, null, 2));
      console.log(`Debug: Response logged to ${logPath}`);
    } catch (error) {
      console.warn('Failed to write debug log:', error.message);
    }
  }

  /**
   * Sleep utility for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate cache key from parameters
   */
  generateCacheKey(assetType, params) {
    const keyParams = {
      type: assetType,
      prompt: params.prompt || params.description,
      seed: params.seed,
      width: params.width || params.image_size,
      height: params.height || params.image_size,
      style: params.style || 'default'
    };

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(keyParams))
      .digest('hex')
      .substring(0, 16);

    return `${assetType}_${hash}`;
  }

  /**
   * Core request method with rate limit handling and retries
   */
  async request(endpoint, method = 'GET', body = null) {
    const url = `${this.baseUrl}${endpoint}`;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const options = {
          method,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        };

        if (body && method !== 'GET') {
          options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.retryDelayMs * Math.pow(2, attempt);
          console.log(`Rate limited. Waiting ${delay}ms before retry ${attempt + 1}/${this.maxRetries}`);
          await this.sleep(delay);
          continue;
        }

        // Handle server rate limit
        if (response.status === 529) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          console.log(`Server rate limit. Waiting ${delay}ms before retry ${attempt + 1}/${this.maxRetries}`);
          await this.sleep(delay);
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`PixelLab API error ${response.status}: ${errorBody}`);
        }

        const jsonResponse = await response.json();
        await this.logResponse(endpoint, jsonResponse);
        return jsonResponse;
      } catch (error) {
        if (attempt === this.maxRetries - 1) {
          throw error;
        }
        console.log(`Request failed, retrying: ${error.message}`);
        await this.sleep(this.retryDelayMs * Math.pow(2, attempt));
      }
    }
  }

  /**
   * Get account balance and credits
   */
  async getBalance() {
    return this.request('/balance');
  }

  /**
   * Poll a background job until completion
   */
  async waitForJob(jobId, options = {}) {
    const pollInterval = options.pollInterval || this.pollIntervalMs;
    const maxAttempts = options.maxAttempts || this.maxPollAttempts;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.request(`/background-jobs/${jobId}`);

      if (status.status === 'completed') {
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(`Job ${jobId} failed: ${status.error || 'Unknown error'}`);
      }

      // Job still processing
      if (attempt % 10 === 0) {
        console.log(`Job ${jobId} still processing... (attempt ${attempt + 1}/${maxAttempts})`);
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`Job ${jobId} timed out after ${maxAttempts} attempts`);
  }

  // =====================
  // Image Generation APIs
  // =====================

  /**
   * Generate image from text (synchronous)
   * @param {Object} params
   * @param {string} params.description - Text description of image
   * @param {number} params.image_size - Size in pixels (32, 64, 128, 256)
   * @param {number} [params.seed] - Optional seed for deterministic generation
   * @param {boolean} [params.no_background] - Remove background
   */
  async generateImageV2(params) {
    const body = {
      description: params.description || params.prompt,
      image_size: params.image_size || params.width || 32,
      ...(params.seed !== undefined && { seed: params.seed }),
      ...(params.no_background && { no_background: true })
    };

    return this.request('/generate-image-v2', 'POST', body);
  }

  /**
   * Generate image with pixflux (flexible sizing)
   * @param {Object} params
   * @param {string} params.description - Text description
   * @param {number} params.width - Width (16-400)
   * @param {number} params.height - Height (16-400)
   * @param {string} [params.outline] - thin, medium, thick, none
   * @param {string} [params.shading] - soft, hard, flat, none
   * @param {string} [params.detail] - low, medium, high
   * @param {string} [params.view] - side, low_top_down, high_top_down
   * @param {boolean} [params.isometric] - Enable isometric projection
   */
  async createImagePixflux(params) {
    const body = {
      description: params.description || params.prompt,
      width: params.width || 32,
      height: params.height || 32,
      ...(params.outline && { outline: params.outline }),
      ...(params.shading && { shading: params.shading }),
      ...(params.detail && { detail: params.detail }),
      ...(params.view && { view: params.view }),
      ...(params.isometric && { isometric: true }),
      ...(params.seed !== undefined && { seed: params.seed }),
      ...(params.no_background && { no_background: true })
    };

    const result = await this.request('/create-image-pixflux', 'POST', body);

    // This endpoint may return a job_id for async processing
    const jobId = result.job_id || result.background_job_id;
    if (jobId) {
      return this.waitForJob(jobId);
    }

    return result;
  }

  // =====================
  // Tileset Generation
  // =====================

  /**
   * Create isometric tile
   * @param {Object} params
   * @param {string} params.description - Tile description
   * @param {number} params.image_size - Size (16-64, recommend 24+)
   * @param {string} params.tile_shape - thin (~15% height), thick (~25%), block (~50%)
   */
  async createIsometricTile(params) {
    // image_size must be an object with width and height
    const size = params.image_size || params.size || 32;
    const imageSize = typeof size === 'object' ? size : { width: size, height: size };

    // Map tile_shape to isometric_tile_shape with correct values
    const shapeMap = {
      'thin': 'thin tile',
      'thick': 'thick tile',
      'block': 'block'
    };
    const shape = params.tile_shape || params.shape || 'thin';
    const isometricTileShape = shapeMap[shape] || shape;

    const body = {
      description: params.description || params.prompt,
      image_size: imageSize,
      isometric_tile_shape: isometricTileShape,
      ...(params.seed !== undefined && { seed: params.seed }),
      ...(params.outline && { outline: params.outline }),
      ...(params.shading && { shading: params.shading }),
      ...(params.detail && { detail: params.detail }),
      ...(params.isometric_tile_size && { isometric_tile_size: params.isometric_tile_size })
    };

    const result = await this.request('/create-isometric-tile', 'POST', body);

    // Handle async response - API returns background_job_id
    const jobId = result.job_id || result.background_job_id;
    if (jobId && result.status === 'processing') {
      return this.waitForJob(jobId);
    }

    return result;
  }

  /**
   * Create Wang tileset
   * @param {Object} params
   * @param {string} params.description - Terrain description
   * @param {number} params.tile_size - 16 or 32
   * @param {string} params.terrain_level - lower, upper
   * @param {number} [params.transition_size] - 0, 0.25, 0.5, 1.0
   */
  async createTileset(params) {
    const body = {
      description: params.description || params.prompt,
      tile_size: params.tile_size || 32,
      terrain_level: params.terrain_level || 'lower',
      ...(params.transition_size !== undefined && { transition_size: params.transition_size }),
      ...(params.seed !== undefined && { seed: params.seed }),
      ...(params.outline && { outline: params.outline }),
      ...(params.shading && { shading: params.shading })
    };

    const result = await this.request('/create-tileset', 'POST', body);

    const jobId = result.job_id || result.background_job_id;
    if (jobId) {
      return this.waitForJob(jobId);
    }

    return result;
  }

  // =====================
  // Map Objects
  // =====================

  /**
   * Create map object with transparent background
   * @param {Object} params
   * @param {string} params.description - Object description
   * @param {number} params.width - Width (32-400)
   * @param {number} params.height - Height (32-400)
   * @param {string} [params.view] - side, low_top_down, high_top_down
   * @param {boolean} [params.isometric] - Isometric projection
   */
  async createMapObject(params) {
    // image_size must be an object with width and height
    const width = params.width || 48;
    const height = params.height || 48;

    const body = {
      description: params.description || params.prompt,
      image_size: { width, height },
      ...(params.view && { view: params.view }),
      ...(params.isometric && { isometric: true }),
      ...(params.seed !== undefined && { seed: params.seed }),
      ...(params.outline && { outline: params.outline }),
      ...(params.shading && { shading: params.shading }),
      ...(params.detail && { detail: params.detail })
    };

    const result = await this.request('/map-objects', 'POST', body);

    const jobId = result.job_id || result.background_job_id;
    if (jobId) {
      return this.waitForJob(jobId);
    }

    return result;
  }

  // =====================
  // Character Generation
  // =====================

  /**
   * Create character with 8 directional sprites
   * @param {Object} params
   * @param {string} params.description - Character description
   * @param {number} params.image_size - Size (32-400)
   * @param {string} [params.outline] - thin, medium, thick
   * @param {string} [params.shading] - soft, hard, flat
   * @param {string} [params.detail] - low, medium, high
   * @param {boolean} [params.isometric] - Isometric view
   */
  async createCharacterWith8Directions(params) {
    // image_size must be an object with width and height
    const size = params.image_size || params.size || 64;
    const imageSize = typeof size === 'object' ? size : { width: size, height: size };

    const body = {
      description: params.description || params.prompt,
      image_size: imageSize,
      ...(params.outline && { outline: params.outline }),
      ...(params.shading && { shading: params.shading }),
      ...(params.detail && { detail: params.detail }),
      ...(params.isometric && { isometric: true }),
      ...(params.seed !== undefined && { seed: params.seed })
    };

    const result = await this.request('/create-character-with-8-directions', 'POST', body);

    const jobId = result.job_id || result.background_job_id;
    const characterId = result.character_id;

    if (jobId) {
      const jobResult = await this.waitForJob(jobId);
      // After job completes, fetch the character to get rotation_urls
      const finalCharacterId = jobResult.last_response?.character_id || characterId;
      if (finalCharacterId) {
        const characterData = await this.getCharacter(finalCharacterId);
        return {
          ...jobResult,
          character_id: finalCharacterId,
          character_data: characterData,
          rotation_urls: characterData.rotation_urls
        };
      }
      return jobResult;
    }

    return result;
  }

  /**
   * Create character with 4 directional sprites
   */
  async createCharacterWith4Directions(params) {
    // image_size must be an object with width and height
    const size = params.image_size || params.size || 64;
    const imageSize = typeof size === 'object' ? size : { width: size, height: size };

    const body = {
      description: params.description || params.prompt,
      image_size: imageSize,
      ...(params.outline && { outline: params.outline }),
      ...(params.shading && { shading: params.shading }),
      ...(params.detail && { detail: params.detail }),
      ...(params.isometric && { isometric: true }),
      ...(params.seed !== undefined && { seed: params.seed })
    };

    const result = await this.request('/create-character-with-4-directions', 'POST', body);

    const jobId = result.job_id || result.background_job_id;
    if (jobId) {
      return this.waitForJob(jobId);
    }

    return result;
  }

  /**
   * Generate character animations
   * @param {Object} params
   * @param {string} params.character_id - Character ID from creation
   * @param {string} params.animation_template - Animation type (breathing-idle, walking, attack-forward, etc.)
   * @param {string[]} [params.directions] - Which directions to animate
   */
  async createCharacterAnimation(params) {
    const body = {
      character_id: params.character_id,
      animation_template: params.animation_template || params.animation,
      ...(params.directions && { directions: params.directions }),
      ...(params.outline && { outline: params.outline }),
      ...(params.shading && { shading: params.shading }),
      ...(params.detail && { detail: params.detail })
    };

    const result = await this.request('/characters/animations', 'POST', body);

    const jobId = result.job_id || result.background_job_id;
    if (jobId) {
      return this.waitForJob(jobId);
    }

    return result;
  }

  /**
   * Get list of created characters
   */
  async listCharacters(limit = 100, offset = 0) {
    return this.request(`/characters?limit=${limit}&offset=${offset}`);
  }

  /**
   * Get character details
   */
  async getCharacter(characterId) {
    return this.request(`/characters/${characterId}`);
  }

  /**
   * Export character with animations as ZIP
   */
  async exportCharacterZip(characterId) {
    return this.request(`/characters/${characterId}/zip`);
  }

  // =====================
  // Animation
  // =====================

  /**
   * Animate with text description
   * @param {Object} params
   * @param {string} params.character_description - Character description
   * @param {string} params.action_description - Action to animate
   * @param {Object} [params.reference_image] - Reference image {type, base64, format}
   * @param {number} [params.image_size] - Output size (32-128)
   */
  async animateWithText(params) {
    // image_size must be an object with width and height if provided
    let imageSize = null;
    if (params.image_size) {
      const size = params.image_size;
      imageSize = typeof size === 'object' ? size : { width: size, height: size };
    }

    const body = {
      character_description: params.character_description,
      action_description: params.action_description,
      ...(params.reference_image && { reference_image: params.reference_image }),
      ...(imageSize && { image_size: imageSize }),
      ...(params.no_background && { no_background: true }),
      ...(params.seed !== undefined && { seed: params.seed })
    };

    const result = await this.request('/animate-with-text-v2', 'POST', body);

    const jobId = result.job_id || result.background_job_id;
    if (jobId) {
      return this.waitForJob(jobId);
    }

    return result;
  }

  // =====================
  // Style Matching
  // =====================

  /**
   * Generate image matching a style reference
   * @param {Object} params
   * @param {string} params.description - What to generate
   * @param {Object[]} params.style_images - Array of style reference images
   */
  async generateWithStyle(params) {
    const body = {
      description: params.description || params.prompt,
      style_images: params.style_images,
      ...(params.image_size && { image_size: params.image_size }),
      ...(params.seed !== undefined && { seed: params.seed })
    };

    const result = await this.request('/generate-with-style-v2', 'POST', body);

    const jobId = result.job_id || result.background_job_id;
    if (jobId) {
      return this.waitForJob(jobId);
    }

    return result;
  }

  // =====================
  // Batch Processing
  // =====================

  /**
   * Process multiple generations with concurrency control
   * @param {Function} generatorFn - Async function that generates one item
   * @param {Array} paramsList - Array of parameter objects
   * @param {number} [concurrency] - Max concurrent requests
   */
  async generateBatch(generatorFn, paramsList, concurrency = null) {
    const maxConcurrent = concurrency || this.maxConcurrent;
    const results = [];
    const queue = [...paramsList];
    const inProgress = new Set();

    const processNext = async () => {
      if (queue.length === 0) return null;

      const params = queue.shift();
      const index = paramsList.indexOf(params);

      try {
        const result = await generatorFn(params);
        results[index] = { success: true, result };
      } catch (error) {
        results[index] = { success: false, error: error.message };
        console.error(`Batch item ${index} failed:`, error.message);
      }
    };

    // Initial batch
    const workers = [];
    for (let i = 0; i < Math.min(maxConcurrent, paramsList.length); i++) {
      workers.push(processNext());
    }

    // Process queue
    while (queue.length > 0 || workers.some(w => w !== null)) {
      await Promise.race(workers.filter(w => w !== null));

      // Refill workers
      for (let i = 0; i < workers.length; i++) {
        if (workers[i] === null || await Promise.race([workers[i], Promise.resolve('pending')]) !== 'pending') {
          workers[i] = processNext();
        }
      }
    }

    await Promise.all(workers.filter(w => w !== null));
    return results;
  }

  // =====================
  // Utility Methods
  // =====================

  /**
   * Convert base64 image data to buffer
   */
  base64ToBuffer(base64Data) {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64, 'base64');
  }

  /**
   * Extract image info from API response
   * Handles both direct responses and job completion responses
   * @param {Object} result - API response
   * @returns {Object} - { base64, width, height, type }
   */
  extractImageInfo(result) {
    // Check various locations where image data might be
    const locations = [
      result.last_response?.images?.[0],
      result.last_response?.image,
      result.result?.images?.[0],
      result.result?.image,
      result.images?.[0],
      result.image,
      result.data?.images?.[0],
      result.data?.image,
      result.output?.images?.[0],
      result.output?.image
    ];

    for (const loc of locations) {
      if (loc?.base64) {
        return loc;
      }
    }

    // Direct base64 at root
    if (result.base64) {
      return { base64: result.base64, type: 'unknown' };
    }

    // Note: For character creation endpoints, use saveImage() which handles rotation_urls
    // This method is primarily for endpoints that return base64 image data directly
    return null;
  }

  /**
   * Convert image data to PNG buffer
   * Handles both rgba_bytes and PNG formats
   * @param {Object} imageInfo - Image info from extractImageInfo
   * @returns {Promise<Buffer>} - PNG buffer
   */
  async convertToPng(imageInfo) {
    if (!imageInfo || !imageInfo.base64) {
      throw new Error('No image data to convert');
    }

    const rawBuffer = Buffer.from(imageInfo.base64, 'base64');

    // If it's rgba_bytes, convert to PNG
    if (imageInfo.type === 'rgba_bytes') {
      const width = imageInfo.width;
      const height = imageInfo.height || width;

      if (rawBuffer.length !== width * height * 4) {
        throw new Error(`RGBA buffer size mismatch: got ${rawBuffer.length}, expected ${width * height * 4}`);
      }

      return sharp(rawBuffer, {
        raw: {
          width: width,
          height: height,
          channels: 4
        }
      }).png().toBuffer();
    }

    // Check if it's already PNG
    const pngHeader = rawBuffer.slice(0, 4).toString('hex');
    if (pngHeader === '89504e47') {
      return rawBuffer;
    }

    // Try to convert with sharp anyway
    return sharp(rawBuffer).png().toBuffer();
  }

  /**
   * Extract and convert image from API result to PNG buffer
   * @param {Object} result - API response
   * @returns {Promise<Buffer>} - PNG buffer
   */
  async extractPngBuffer(result) {
    const imageInfo = this.extractImageInfo(result);
    if (!imageInfo) {
      throw new Error('No image data in API result');
    }
    return this.convertToPng(imageInfo);
  }

  /**
   * Save image result to file
   * Handles: rotation_urls (downloads), base64 data, and rgba_bytes conversion
   */
  async saveImage(result, filePath, direction = 'south') {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Check if result has rotation_urls (from character creation)
    if (result.rotation_urls) {
      const url = result.rotation_urls[direction];
      if (!url) {
        throw new Error(`No URL found for direction '${direction}'. Available: ${Object.keys(result.rotation_urls).join(', ')}`);
      }
      return this.downloadImage(url, filePath);
    }

    // Check character_data for rotation_urls
    if (result.character_data?.rotation_urls) {
      const url = result.character_data.rotation_urls[direction];
      if (!url) {
        throw new Error(`No URL found for direction '${direction}'. Available: ${Object.keys(result.character_data.rotation_urls).join(', ')}`);
      }
      return this.downloadImage(url, filePath);
    }

    // Fallback to base64/rgba_bytes extraction
    const pngBuffer = await this.extractPngBuffer(result);

    // Validate PNG
    const pngHeader = pngBuffer.slice(0, 4).toString('hex');
    if (pngHeader !== '89504e47') {
      throw new Error('Failed to create valid PNG');
    }

    await fs.writeFile(filePath, pngBuffer);
    return filePath;
  }

  /**
   * Download image from URL and save to file
   */
  async downloadImage(url, filePath) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return filePath;
  }

  /**
   * Save all rotation images from a character result
   */
  async saveAllRotations(result, outputDir, baseName) {
    const urls = result.rotation_urls || result.character_data?.rotation_urls;
    if (!urls) {
      throw new Error('No rotation_urls found in result');
    }

    await fs.mkdir(outputDir, { recursive: true });
    const saved = [];

    for (const [direction, url] of Object.entries(urls)) {
      const filePath = path.join(outputDir, `${baseName}_${direction}.png`);
      await this.downloadImage(url, filePath);
      saved.push({ direction, path: filePath });
    }

    return saved;
  }

  /**
   * Format image for API input
   */
  formatImageInput(buffer, format = 'png') {
    return {
      type: 'base64',
      base64: buffer.toString('base64'),
      format
    };
  }
}

// Singleton instance
let instance = null;

function getPixelLabClient(options = {}) {
  if (!instance) {
    instance = new PixelLabClient(options);
  }
  return instance;
}

module.exports = {
  PixelLabClient,
  getPixelLabClient
};
