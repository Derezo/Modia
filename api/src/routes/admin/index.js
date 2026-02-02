/**
 * @module admin/index
 * @description Admin route composition - combines sub-routers into unified admin API
 *
 * This module exports:
 * - Individual sub-routers for granular mounting
 * - Combined router for convenience
 *
 * Sub-routers:
 * - assets - Asset CRUD, regeneration queue, statistics
 * - characters - SD1.5 animation management, reference images, weights
 * - theme - Theme configuration and presets
 * - generation - Queue control, settings, seed management
 * - backups - Backup creation, restoration, deletion
 *
 * @see ../admin.js - Main admin router that composes these sub-routers
 */

export { default as assetsRouter } from './assets.js';
export { default as charactersRouter } from './characters.js';
export { default as themeRouter } from './theme.js';
export { default as generationRouter } from './generation.js';
export { default as backupsRouter } from './backups.js';

// Re-export shared utilities for use by main admin.js
export {
  requireDevMode,
  ensureUtilities,
  PROJECT_ROOT,
  METADATA_DIR,
  PRESETS_DIR,
  metadataUtils,
  backupUtils,
} from './shared.js';
