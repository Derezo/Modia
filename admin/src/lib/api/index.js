/**
 * API Client - Unified exports
 *
 * Re-exports all API methods as a single `api` object for backward compatibility.
 * Individual modules can also be imported directly for tree-shaking benefits.
 *
 * Usage (backward compatible):
 *   import { api } from './lib/api';
 *   const assets = await api.getAssets('tiles');
 *
 * Usage (modular):
 *   import { getAssets } from './lib/api/assets';
 *   const assets = await getAssets('tiles');
 */

// Re-export individual modules for direct imports
export * from './config';
export * from './assets';
export * from './audio';
export * from './generation';
export * from './audioGeneration';
export * from './backups';
export * from './theme';
export * from './regeneration';

// Export the client utilities
export { fetchAPI, API_BASE } from './client';

// Import everything for the unified api object
import * as config from './config';
import * as assets from './assets';
import * as audio from './audio';
import * as generation from './generation';
import * as audioGeneration from './audioGeneration';
import * as backups from './backups';
import * as theme from './theme';
import * as regeneration from './regeneration';

/**
 * Unified API object for backward compatibility
 * All methods from the original api.js are available here
 */
export const api = {
  // Config
  getConfig: config.getConfig,
  getStats: config.getStats,
  getStatus: config.getStatus,

  // Assets
  getAssets: assets.getAssets,
  getAsset: assets.getAsset,
  getAssetPrompt: assets.getAssetPrompt,
  updateAsset: assets.updateAsset,
  bulkUpdateAssets: assets.bulkUpdateAssets,

  // Audio Assets
  getAudioAssets: audio.getAudioAssets,
  getAudioAsset: audio.getAudioAsset,
  updateAudioAsset: audio.updateAudioAsset,
  getAudioWaveform: audio.getAudioWaveform,
  getAudioStats: audio.getAudioStats,
  setMusicPrimaryVariant: audio.setMusicPrimaryVariant,
  getSunoTaskStatus: audio.getSunoTaskStatus,
  validateSfxPrompt: audio.validateSfxPrompt,

  // Image Generation
  generateAssets: generation.generateAssets,
  generateAssetsByIds: generation.generateAssetsByIds,
  getQueue: generation.getQueue,
  getJob: generation.getJob,
  cancelJob: generation.cancelJob,
  cancelAllJobs: generation.cancelAllJobs,

  // Audio Generation
  generateAudio: audioGeneration.generateAudio,
  getAudioQueue: audioGeneration.getAudioQueue,
  cancelAudioJob: audioGeneration.cancelAudioJob,
  cancelAllAudioJobs: audioGeneration.cancelAllAudioJobs,

  // Backups
  getBackups: backups.getBackups,
  createBackup: backups.createBackup,
  getBackup: backups.getBackup,
  restoreBackup: backups.restoreBackup,
  deleteBackup: backups.deleteBackup,

  // Theme
  getTheme: theme.getTheme,
  updateTheme: theme.updateTheme,
  getThemePresets: theme.getThemePresets,
  getThemePreset: theme.getThemePreset,
  saveThemePreset: theme.saveThemePreset,
  applyThemePreset: theme.applyThemePreset,
  deleteThemePreset: theme.deleteThemePreset,

  // Regeneration Queue
  getRegenerationQueue: regeneration.getRegenerationQueue,
  markForRegeneration: regeneration.markForRegeneration,
  markMultipleForRegeneration: regeneration.markMultipleForRegeneration,
  clearRegenerationQueue: regeneration.clearRegenerationQueue,
  processRegenerationQueue: regeneration.processRegenerationQueue,

  // Audio Regeneration Queue
  getAudioRegenerationQueue: regeneration.getAudioRegenerationQueue,
  markAudioForRegeneration: regeneration.markAudioForRegeneration,
  markMultipleAudioForRegeneration: regeneration.markMultipleAudioForRegeneration,
  processAudioRegenerationQueue: regeneration.processAudioRegenerationQueue,
};

export default api;
