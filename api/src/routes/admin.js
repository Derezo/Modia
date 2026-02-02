/**
 * @module admin
 * @description Admin Routes Composition for AI-generated image asset management (development only)
 *
 * SECURITY: These endpoints are NEVER available in production, regardless of env vars.
 * They are only available when NODE_ENV is 'development' or 'test'.
 *
 * This file composes sub-routers from the admin/ directory:
 * - assets.js - Asset CRUD, regeneration queue, statistics
 * - characters.js - SD1.5 animation management, reference images, weights
 * - theme.js - Theme configuration and presets
 * - generation.js - Queue control, settings, seed management
 * - backups.js - Backup creation, restoration, deletion
 *
 * Route groups:
 * - /assets/* - Asset operations (assets.js)
 * - /assets/characters/:id/* - Character animation management (characters.js)
 * - /theme/* - Theme configuration (theme.js)
 * - /generate/* - Generation queue (generation.js)
 * - /backups/* - Backup operations (backups.js)
 * - /config - Admin configuration
 * - /status - Admin API status
 * - /stats - Generation statistics (assets.js)
 * - /regeneration-queue/* - Regeneration queue management (assets.js)
 *
 * @see admin/assets.js - Asset CRUD operations
 * @see admin/characters.js - SD1.5 animation management
 * @see admin/theme.js - Theme configuration
 * @see admin/generation.js - Queue control
 * @see admin/backups.js - Backup operations
 * @see adminAudio.js - Audio asset admin routes
 */

import express from 'express';
import path from 'path';
import { asyncHandler } from '../middleware/errorHandler.js';
import { loadJsonFile } from '../utils/jsonFileUtils.js';

import {
  assetsRouter,
  charactersRouter,
  themeRouter,
  generationRouter,
  backupsRouter,
  requireDevMode,
  METADATA_DIR,
  metadataUtils,
  backupUtils,
} from './admin/index.js';

const router = express.Router();

// Apply dev mode check to all routes (rate limiting removed - requireDevMode already blocks production)
router.use(requireDevMode);

// ============================================================================
// SUB-ROUTER COMPOSITION
// ============================================================================

// Character-specific routes must be mounted BEFORE generic asset routes
// to ensure /assets/characters/:id/* is matched before /assets/:category/:id
router.use('/assets/characters', charactersRouter);

// Asset routes (CRUD, regeneration marking, bulk operations)
router.use('/assets', assetsRouter);

// Theme routes
router.use('/theme', themeRouter);

// Generation queue routes
router.use('/generate', generationRouter);

// Backup routes
router.use('/backups', backupsRouter);

// ============================================================================
// CONFIG ROUTE (must be before '/' mount to avoid being caught by /:category)
// ============================================================================

/**
 * GET /api/admin/config
 * Get admin configuration including LoRA models and category defaults
 * Returns validLoraModels (array of IDs), loraModels (full metadata), and defaultLoraByCategory
 */
router.get('/config', asyncHandler(async (req, res) => {
  const manifestPath = path.join(METADATA_DIR, 'manifest.json');
  const manifest = await loadJsonFile(manifestPath);

  if (!manifest) {
    res.status(404).json({ error: 'Manifest file not found' });
    return;
  }

  res.json({
    // Array of valid model IDs (for validation)
    validLoraModels: Object.keys(manifest.loraModels || {}),
    // Full model metadata object (for display names, descriptions)
    loraModels: manifest.loraModels || {},
    // Category to default model mapping
    defaultLoraByCategory: manifest.categoryDefaults || {},
    // SD1.5 LoRA models for character animations
    sd15LoraModels: manifest.sd15LoraModels || {},
    sd15Defaults: manifest.sd15Defaults || {
      loraModel: 'pixel-art-xl',
      referenceLoraModel: 'pixel-art-xl'
    }
  });
}));

// ============================================================================
// STATUS ROUTE (must be before '/' mount to avoid being caught by /:category)
// ============================================================================

/**
 * GET /api/admin/status
 * Check admin API status
 */
router.get('/status', (req, res) => {
  res.json({
    enabled: true,
    environment: process.env.NODE_ENV || 'unknown',
    metadataDir: METADATA_DIR,
    utilitiesLoaded: {
      metadata: !!metadataUtils,
      backup: !!backupUtils
    }
  });
});

// Note: regeneration-queue, stats, and some generation routes are in assets.js
// but need to be mounted at the admin root level (not under /assets).
// We mount the assets router at '/' as well for these specific routes.
// Express will match the more specific paths first.
router.use('/', assetsRouter);

export default router;
