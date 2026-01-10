/**
 * Asset Cache Manager
 * Handles caching of generated PixelLab assets to prevent duplicate API calls
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AssetCacheManager {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || process.env.PIXELLAB_CACHE_DIR || '.pixellab-cache';
    this.assetsDir = options.assetsDir || path.join(__dirname, '../../../frontend/public/assets/sprites');
    this.indexPath = path.join(this.cacheDir, 'index.json');
    this.index = null;
    this.initialized = false;
  }

  /**
   * Initialize cache directory and load index
   */
  async init() {
    if (this.initialized) return;

    // Create cache directories
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.mkdir(path.join(this.cacheDir, 'generations'), { recursive: true });
    await fs.mkdir(this.assetsDir, { recursive: true });

    // Load or create index
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf-8');
      this.index = JSON.parse(indexData);
    } catch (error) {
      this.index = {
        version: 1,
        createdAt: new Date().toISOString(),
        entries: {}
      };
      await this.saveIndex();
    }

    this.initialized = true;
  }

  /**
   * Save index to disk
   */
  async saveIndex() {
    await fs.writeFile(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  /**
   * Generate cache key from parameters
   */
  generateCacheKey(assetType, params) {
    const keyParams = {
      type: assetType,
      prompt: params.prompt || params.description,
      seed: params.seed,
      width: params.width || params.image_size || params.size,
      height: params.height || params.image_size || params.size,
      shape: params.shape || params.tile_shape,
      outline: params.outline,
      shading: params.shading,
      detail: params.detail,
      isometric: params.isometric,
      view: params.view
    };

    // Remove undefined values
    Object.keys(keyParams).forEach(key => {
      if (keyParams[key] === undefined) {
        delete keyParams[key];
      }
    });

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(keyParams))
      .digest('hex')
      .substring(0, 16);

    return `${assetType}_${hash}`;
  }

  /**
   * Check if asset exists in cache
   */
  async has(cacheKey) {
    await this.init();
    return !!this.index.entries[cacheKey];
  }

  /**
   * Get cached asset path
   */
  async get(cacheKey) {
    await this.init();

    const entry = this.index.entries[cacheKey];
    if (!entry) return null;

    // Verify file exists
    const fullPath = path.join(this.cacheDir, entry.path);
    try {
      await fs.access(fullPath);
      // Update access time
      entry.accessedAt = new Date().toISOString();
      await this.saveIndex();
      return fullPath;
    } catch {
      // File missing, remove from index
      delete this.index.entries[cacheKey];
      await this.saveIndex();
      return null;
    }
  }

  /**
   * Get asset metadata
   */
  async getMetadata(cacheKey) {
    await this.init();
    return this.index.entries[cacheKey] || null;
  }

  /**
   * Store asset in cache
   * @param {string} cacheKey - Cache key
   * @param {Buffer} imageBuffer - Image data
   * @param {Object} metadata - Additional metadata
   */
  async set(cacheKey, imageBuffer, metadata = {}) {
    await this.init();

    const relativePath = `generations/${cacheKey}.png`;
    const fullPath = path.join(this.cacheDir, relativePath);

    // Save image file
    await fs.writeFile(fullPath, imageBuffer);

    // Update index
    this.index.entries[cacheKey] = {
      path: relativePath,
      ...metadata,
      size: imageBuffer.length,
      checksum: crypto.createHash('md5').update(imageBuffer).digest('hex'),
      createdAt: new Date().toISOString(),
      accessedAt: new Date().toISOString()
    };

    await this.saveIndex();
    return fullPath;
  }

  /**
   * Extract image info from API response
   * Handles both direct responses and job completion responses
   */
  extractImageInfo(result) {
    // Job completion response (from waitForJob) - most common
    if (result.last_response?.image) {
      return result.last_response.image;
    }
    // Direct image response
    if (result.image) {
      return result.image;
    }
    // Data wrapper
    if (result.data?.image) {
      return result.data.image;
    }
    // Direct base64
    if (result.base64) {
      return { base64: result.base64, type: 'unknown' };
    }
    return null;
  }

  /**
   * Convert image data to PNG buffer
   * Handles rgba_bytes format from PixelLab API
   */
  async convertToPng(imageInfo) {
    if (!imageInfo || !imageInfo.base64) {
      throw new Error('No image data to convert');
    }

    const rawBuffer = Buffer.from(imageInfo.base64, 'base64');

    // If it's rgba_bytes, convert to PNG using sharp
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
   * Get or generate asset (helper for common pattern)
   * @param {string} assetType - Type of asset
   * @param {Object} params - Generation parameters
   * @param {Function} generatorFn - Async function to generate if not cached
   */
  async getOrGenerate(assetType, params, generatorFn) {
    const cacheKey = this.generateCacheKey(assetType, params);

    // Check cache
    const cached = await this.get(cacheKey);
    if (cached) {
      console.log(`Cache hit: ${cacheKey}`);
      return { cached: true, path: cached, cacheKey };
    }

    // Generate
    console.log(`Cache miss, generating: ${cacheKey}`);
    const result = await generatorFn(params);

    // Extract and convert image to PNG
    let imageBuffer;
    if (Buffer.isBuffer(result)) {
      imageBuffer = result;
    } else {
      const imageInfo = this.extractImageInfo(result);
      if (!imageInfo) {
        throw new Error('Unable to extract image data from API result. Keys: ' + Object.keys(result).join(', '));
      }
      imageBuffer = await this.convertToPng(imageInfo);
    }

    // Validate PNG
    const pngHeader = imageBuffer.slice(0, 4).toString('hex');
    if (pngHeader !== '89504e47') {
      throw new Error('Generated image is not a valid PNG');
    }

    // Cache the result
    const cachePath = await this.set(cacheKey, imageBuffer, {
      type: assetType,
      params: params
    });

    return { cached: false, path: cachePath, cacheKey, result };
  }

  /**
   * Copy cached asset to frontend assets directory
   * @param {string} cacheKey - Cache key
   * @param {string} destPath - Relative path in assets dir (e.g., 'terrain/forest/grass_0.png')
   */
  async copyToAssets(cacheKey, destPath) {
    const cachedPath = await this.get(cacheKey);
    if (!cachedPath) {
      throw new Error(`Cache key not found: ${cacheKey}`);
    }

    const fullDestPath = path.join(this.assetsDir, destPath);
    const destDir = path.dirname(fullDestPath);

    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(cachedPath, fullDestPath);

    return fullDestPath;
  }

  /**
   * List all cached assets of a type
   */
  async listByType(assetType) {
    await this.init();

    return Object.entries(this.index.entries)
      .filter(([key, entry]) => entry.type === assetType || key.startsWith(assetType + '_'))
      .map(([key, entry]) => ({ key, ...entry }));
  }

  /**
   * Invalidate/remove cache entry
   */
  async invalidate(cacheKey) {
    await this.init();

    const entry = this.index.entries[cacheKey];
    if (!entry) return false;

    // Remove file
    try {
      const fullPath = path.join(this.cacheDir, entry.path);
      await fs.unlink(fullPath);
    } catch {
      // File may not exist
    }

    // Remove from index
    delete this.index.entries[cacheKey];
    await this.saveIndex();

    return true;
  }

  /**
   * Clear all cache
   */
  async clear() {
    await this.init();

    // Remove all generation files
    const generationsDir = path.join(this.cacheDir, 'generations');
    try {
      const files = await fs.readdir(generationsDir);
      await Promise.all(files.map(f => fs.unlink(path.join(generationsDir, f))));
    } catch {
      // Directory may not exist
    }

    // Reset index
    this.index = {
      version: 1,
      createdAt: new Date().toISOString(),
      entries: {}
    };
    await this.saveIndex();
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    await this.init();

    const entries = Object.values(this.index.entries);
    const totalSize = entries.reduce((sum, e) => sum + (e.size || 0), 0);

    const byType = {};
    entries.forEach(entry => {
      const type = entry.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    });

    return {
      totalEntries: entries.length,
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      byType
    };
  }

  /**
   * Prune old/unused entries
   * @param {number} maxAgeDays - Remove entries older than this
   */
  async prune(maxAgeDays = 30) {
    await this.init();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const cutoffTime = cutoff.getTime();

    let pruned = 0;
    for (const [key, entry] of Object.entries(this.index.entries)) {
      const accessTime = new Date(entry.accessedAt || entry.createdAt).getTime();
      if (accessTime < cutoffTime) {
        await this.invalidate(key);
        pruned++;
      }
    }

    return pruned;
  }
}

// Singleton instance
let instance = null;

function getAssetCacheManager(options = {}) {
  if (!instance) {
    instance = new AssetCacheManager(options);
  }
  return instance;
}

export {
  AssetCacheManager,
  getAssetCacheManager
};
