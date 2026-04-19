/**
 * Audio Metadata Service - Load, filter, and update audio metadata files
 *
 * Handles reading and writing to audio-metadata/ JSON files for both
 * music tracks and SFX effects. Provides filtering and summary calculations.
 *
 * @module audioMetadataService
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { AppError } from '../../middleware/errorHandler.js';
import { loadJsonFile, saveJsonFile } from '../../utils/jsonFileUtils.js';
import {
  VALID_MUSIC_CATEGORIES,
  VALID_SFX_CATEGORIES
} from '../../utils/assetConstants.js';

// Get project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata');
const FRONTEND_PUBLIC_DIR = path.join(PROJECT_ROOT, 'frontend', 'public');

/**
 * Load all music tracks from metadata files
 * @param {object} filters - Optional filters (category, region, status)
 * @returns {Promise<object>} { tracks, summary }
 */
export async function loadMusicMetadata(filters = {}) {
  const manifest = await loadJsonFile(path.join(METADATA_DIR, 'music/manifest.json'));
  if (!manifest) {
    throw new AppError('Music manifest not found', 500);
  }

  const tracks = [];
  const categoriesToLoad = filters.category
    ? [filters.category]
    : VALID_MUSIC_CATEGORIES;

  for (const category of categoriesToLoad) {
    const categoryInfo = manifest.categories[category];
    if (!categoryInfo) continue;

    for (const file of categoryInfo.files) {
      const filePath = path.join(METADATA_DIR, 'music', file);
      const data = await loadJsonFile(filePath);
      if (!data) continue;

      // Handle different file structures
      const tracksInFile = data.tracks || [];
      for (const track of tracksInFile) {
        // Add source file reference for updates
        tracks.push({
          ...track,
          _sourceFile: file,
          _category: category,
          _region: data.region || null
        });
      }
    }
  }

  // Apply filters
  let filteredTracks = tracks;

  if (filters.region) {
    filteredTracks = filteredTracks.filter(t => t.region === filters.region);
  }

  if (filters.status === 'generated') {
    filteredTracks = filteredTracks.filter(t => t.generated === true);
  } else if (filters.status === 'pending') {
    filteredTracks = filteredTracks.filter(t => !t.generated);
  }

  // Calculate summary
  const total = filteredTracks.length;
  const generated = filteredTracks.filter(t => t.generated === true).length;
  const pending = total - generated;

  return {
    tracks: filteredTracks,
    summary: {
      total,
      generated,
      pending,
      percentComplete: total > 0 ? Math.round((generated / total) * 100) : 0
    }
  };
}

/**
 * Load all SFX effects from metadata files
 * @param {object} filters - Optional filters (category, subcategory, status)
 * @returns {Promise<object>} { effects, summary }
 */
export async function loadSFXMetadata(filters = {}) {
  const manifest = await loadJsonFile(path.join(METADATA_DIR, 'sfx/manifest.json'));
  if (!manifest) {
    throw new AppError('SFX manifest not found', 500);
  }

  const effects = [];
  const categoriesToLoad = filters.category
    ? [filters.category]
    : VALID_SFX_CATEGORIES;

  for (const category of categoriesToLoad) {
    const categoryInfo = manifest.categories[category];
    if (!categoryInfo) continue;

    for (const file of categoryInfo.files) {
      const filePath = path.join(METADATA_DIR, 'sfx', file);
      const data = await loadJsonFile(filePath);
      if (!data) continue;

      // Handle different file structures
      const effectsInFile = data.effects || [];
      for (const effect of effectsInFile) {
        // Add source file reference for updates
        effects.push({
          ...effect,
          _sourceFile: file,
          _category: category
        });
      }
    }
  }

  // Apply filters
  let filteredEffects = effects;

  if (filters.subcategory) {
    filteredEffects = filteredEffects.filter(e => e.subcategory === filters.subcategory);
  }

  if (filters.status === 'generated') {
    filteredEffects = filteredEffects.filter(e => e.generated === true);
  } else if (filters.status === 'pending') {
    filteredEffects = filteredEffects.filter(e => !e.generated);
  }

  // Calculate summary
  const total = filteredEffects.length;
  const generated = filteredEffects.filter(e => e.generated === true).length;
  const pending = total - generated;

  return {
    effects: filteredEffects,
    summary: {
      total,
      generated,
      pending,
      percentComplete: total > 0 ? Math.round((generated / total) * 100) : 0
    }
  };
}

/**
 * Update audio metadata in source file
 * @param {string} type - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated asset
 */
export async function updateAudioMetadata(type, id, updates) {
  // First find the asset to get its source file
  let asset = null;
  let sourceFilePath = null;
  let arrayKey = null;

  if (type === 'music') {
    const { tracks } = await loadMusicMetadata();
    asset = tracks.find(t => t.id === id);
    if (asset) {
      sourceFilePath = path.join(METADATA_DIR, 'music', asset._sourceFile);
      arrayKey = 'tracks';
    }
  } else {
    const { effects } = await loadSFXMetadata();
    asset = effects.find(e => e.id === id);
    if (asset) {
      sourceFilePath = path.join(METADATA_DIR, 'sfx', asset._sourceFile);
      arrayKey = 'effects';
    }
  }

  if (!asset || !sourceFilePath) {
    throw new AppError(`${type === 'music' ? 'Track' : 'Effect'} not found: ${id}`, 404);
  }

  // Load the source file
  const fileData = await loadJsonFile(sourceFilePath);
  if (!fileData) {
    throw new AppError(`Source file not found: ${asset._sourceFile}`, 500);
  }

  // Find and update the asset in the array
  const assetArray = fileData[arrayKey] || [];
  const assetIndex = assetArray.findIndex(a => a.id === id);

  if (assetIndex === -1) {
    throw new AppError(`Asset not found in source file: ${id}`, 500);
  }

  // Apply updates (excluding internal fields)
  const cleanUpdates = { ...updates };
  delete cleanUpdates._sourceFile;
  delete cleanUpdates._category;
  delete cleanUpdates._region;

  assetArray[assetIndex] = {
    ...assetArray[assetIndex],
    ...cleanUpdates
  };

  fileData[arrayKey] = assetArray;

  // Save the file
  await saveJsonFile(sourceFilePath, fileData);

  return assetArray[assetIndex];
}

/**
 * Transform audio asset to include dashboard-expected status field
 * Maps `generated: true/false` to `status: 'exists'|'missing'`
 * @param {object} asset - The audio asset (track or effect)
 * @returns {object} Asset with status field added
 */
export function transformAssetForResponse(asset) {
  return {
    ...asset,
    status: asset.generated ? 'exists' : 'missing'
  };
}

/**
 * Verify if an audio file exists on disk
 * @param {string} audioPath - Path from metadata (e.g., '/audio/music/...')
 * @returns {boolean} Whether the file exists
 */
export function verifyFileExists(audioPath) {
  if (!audioPath) return false;
  // Remove leading slash and resolve from frontend public dir
  const relativePath = audioPath.startsWith('/') ? audioPath.slice(1) : audioPath;
  const fullPath = path.join(FRONTEND_PUBLIC_DIR, relativePath);
  return existsSync(fullPath);
}

/**
 * Resolve audio file path from metadata path to absolute filesystem path
 * @param {string} metadataPath - Path from metadata (e.g., '/assets/audio/music/...')
 * @returns {string|null} Absolute path to the audio file, or null if no path provided
 */
export function resolveAudioPath(metadataPath) {
  if (!metadataPath) return null;
  // Remove leading slash and resolve from frontend public dir
  const relativePath = metadataPath.startsWith('/') ? metadataPath.slice(1) : metadataPath;
  return path.join(FRONTEND_PUBLIC_DIR, relativePath);
}

/**
 * Mark a single audio asset for regeneration
 * @param {string} type - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {boolean} mark - Whether to mark (true) or unmark (false)
 * @returns {Promise<object>} Result with message and asset info
 */
export async function markForRegeneration(type, id, mark = true) {
  // Load the appropriate metadata
  let asset = null;
  let assetPath = null;

  if (type === 'music') {
    const { tracks } = await loadMusicMetadata();
    asset = tracks.find(t => t.id === id);
    if (asset && asset._sourceFile) {
      assetPath = path.join(METADATA_DIR, 'music', asset._sourceFile);
    }
  } else {
    const { effects } = await loadSFXMetadata();
    asset = effects.find(e => e.id === id);
    if (asset && asset._sourceFile) {
      assetPath = path.join(METADATA_DIR, 'sfx', asset._sourceFile);
    }
  }

  if (!asset) {
    throw new AppError(`Audio asset not found: ${type}/${id}`, 404);
  }

  // Update the asset in its source file
  if (assetPath && existsSync(assetPath)) {
    const fileData = await loadJsonFile(assetPath);
    if (fileData) {
      // Handle array-based structure (tracks[] for music, effects[] for SFX)
      const arrayKey = type === 'music' ? 'tracks' : 'effects';
      const items = fileData[arrayKey];
      if (Array.isArray(items)) {
        const item = items.find(i => i.id === id);
        if (item) {
          item.needsRegeneration = mark;
          item.regenerationQueuedAt = mark ? new Date().toISOString() : null;
          await saveJsonFile(assetPath, fileData);
        }
      }
    }
  }

  return {
    message: mark ? 'Audio asset marked for regeneration' : 'Regeneration marker cleared',
    asset: { id, type, needsRegeneration: mark }
  };
}

/**
 * Mark multiple audio assets for regeneration
 * @param {string} type - 'music' or 'sfx'
 * @param {string[]} ids - Array of asset IDs
 * @param {boolean} mark - Whether to mark (true) or unmark (false)
 * @returns {Promise<object>} Result with counts
 */
export async function markMultipleForRegeneration(type, ids, mark = true) {
  // Load the appropriate metadata
  let assets = [];
  let baseDir = '';

  if (type === 'music') {
    const { tracks } = await loadMusicMetadata();
    assets = tracks;
    baseDir = path.join(METADATA_DIR, 'music');
  } else {
    const { effects } = await loadSFXMetadata();
    assets = effects;
    baseDir = path.join(METADATA_DIR, 'sfx');
  }

  // Group assets by source file for efficient updates
  const fileUpdates = new Map();
  const results = { success: 0, notFound: 0 };

  for (const id of ids) {
    const asset = assets.find(a => a.id === id);
    if (!asset) {
      results.notFound++;
      continue;
    }

    const sourceFile = asset._sourceFile;
    if (!sourceFile) {
      console.debug(`[adminAudio] Skipping asset ${id}: no _sourceFile metadata`);
      continue;
    }

    if (!fileUpdates.has(sourceFile)) {
      fileUpdates.set(sourceFile, []);
    }
    fileUpdates.get(sourceFile).push(id);
  }

  // Apply updates to each file
  // Audio metadata files use arrays: { tracks: [...] } for music, root array or { effects: [...] } for SFX
  const arrayKey = type === 'music' ? 'tracks' : null; // SFX files may be root arrays or have different structure

  for (const [sourceFile, assetIds] of fileUpdates) {
    const filePath = path.join(baseDir, sourceFile);
    if (!existsSync(filePath)) continue;

    try {
      const fileData = await loadJsonFile(filePath);
      if (!fileData) continue;

      // Get the asset array from the file
      let assetArray;
      if (arrayKey && fileData[arrayKey]) {
        assetArray = fileData[arrayKey];
      } else if (Array.isArray(fileData)) {
        assetArray = fileData;
      } else {
        // Try to find any array in the file
        const possibleKeys = ['tracks', 'effects', 'sounds'];
        for (const key of possibleKeys) {
          if (Array.isArray(fileData[key])) {
            assetArray = fileData[key];
            break;
          }
        }
      }

      if (!assetArray) {
        console.warn(`[AdminAudio] Could not find asset array in ${sourceFile}`);
        continue;
      }

      for (const id of assetIds) {
        const assetIndex = assetArray.findIndex(a => a.id === id);
        if (assetIndex !== -1) {
          assetArray[assetIndex].needsRegeneration = mark;
          assetArray[assetIndex].regenerationQueuedAt = mark ? new Date().toISOString() : null;
          results.success++;
        }
      }

      await saveJsonFile(filePath, fileData);
    } catch (error) {
      console.warn(`[AdminAudio] Failed to update ${sourceFile}:`, error.message);
    }
  }

  return {
    message: mark
      ? `Marked ${results.success} audio assets for regeneration`
      : `Cleared regeneration marker for ${results.success} audio assets`,
    updated: results.success,
    total: ids.length,
    notFound: results.notFound
  };
}

/**
 * Get the metadata directory path
 * @returns {string} Path to audio-metadata directory
 */
export function getMetadataDir() {
  return METADATA_DIR;
}

/**
 * Get the project root path
 * @returns {string} Path to project root
 */
export function getProjectRoot() {
  return PROJECT_ROOT;
}
