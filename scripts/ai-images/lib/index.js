/**
 * AI Image Generation Library
 * Exports all utility modules for image generation scripts
 */

const {
  loadEnv,
  ensureDirectoryExists,
  fileExists,
  delay,
  loadMetadata,
  saveMetadata,
  getTimestamp,
  log,
  isDebugEnabled,
  formatBytes,
  isValidImageFormat,
  sanitizeFilename,
  getProjectRoot,
  getMetadataDir,
  getImageGeneratorRoot
} = require('./imageUtils');

const {
  runPythonScript,
  generateTile,
  generatePortrait,
  generateIcon,
  generateItem,
  generateNode,
  generateOverlay,
  runBatchGeneration
} = require('./pythonRunner');

const {
  getMetadataPath,
  loadMasterManifest,
  loadCategoryManifest,
  loadCategoryAssets,
  loadTileMetadata,
  loadPortraitMetadata,
  loadItemMetadata,
  loadIconMetadata,
  loadNodeMetadata,
  loadOverlayMetadata,
  updateAssetStatus,
  markAssetGenerated,
  getCategoryStats,
  getAllStats
} = require('./metadataUtils');

const {
  // Theme functions (new unified approach)
  loadTheme,
  clearThemeCache,
  buildThemedPrompt,
  getThemedNegativePrompt,
  // Layered composition system
  buildCleanItemPrompt,
  buildOverlayPrompt,
  getOverlayConfig,
  // NEW: Flat texture tile system
  buildFlatTilePrompt,
  buildWallPrompt,
  // Legacy functions
  NEGATIVE_PROMPT,
  STYLE_PREFIXES,
  REGIONAL_PALETTES,
  buildTilePrompt,
  buildPortraitPrompt,
  buildIconPrompt,
  buildItemPrompt,
  buildNodePrompt,
  getStylePrefix,
  getTriggerWord,
  getRegionalPalette
} = require('./promptBuilder');

const {
  getBackupDir,
  formatBackupTimestamp,
  parseBackupTimestamp,
  getImageOutputDir,
  getAssetImagePath,
  createBackup,
  restoreBackup,
  listBackups,
  getLatestBackup,
  getBackupInfo,
  deleteBackup,
  cleanupOldBackups
} = require('./backupUtils');

const {
  parseSimpleYaml,
  resolveBatchConfigPath,
  loadBatchConfig,
  getBatchConfigSummary
} = require('./batchConfig');

const {
  STANDARD_SIZES,
  SIZE_PRESETS,
  AI_RESOLUTIONS,
  checkImageMagick,
  getSizedPath,
  getSizedPathNonSquare,
  resizeImage,
  resizeImageNonSquare,
  applyDiamondMask,
  applyIsometricTransform,
  generateSizeVariants,
  generateSizeVariantsForDirectory,
  postProcessGenerated,
  postProcessTile,
  postProcessFlatTile,
  postProcessPortrait,
  postProcessItem,
  postProcessIcon,
  postProcessNode,
  postProcessWall,
  postProcessSlope,
  postProcessByType
} = require('./resizeUtils');

module.exports = {
  // Image utilities
  loadEnv,
  ensureDirectoryExists,
  fileExists,
  delay,
  loadMetadata,
  saveMetadata,
  getTimestamp,
  log,
  isDebugEnabled,
  formatBytes,
  isValidImageFormat,
  sanitizeFilename,
  getProjectRoot,
  getMetadataDir,
  getImageGeneratorRoot,

  // Python runners
  runPythonScript,
  generateTile,
  generatePortrait,
  generateIcon,
  generateItem,
  generateNode,
  generateOverlay,
  runBatchGeneration,

  // Metadata utilities
  getMetadataPath,
  loadMasterManifest,
  loadCategoryManifest,
  loadCategoryAssets,
  loadTileMetadata,
  loadPortraitMetadata,
  loadItemMetadata,
  loadIconMetadata,
  loadNodeMetadata,
  loadOverlayMetadata,
  updateAssetStatus,
  markAssetGenerated,
  getCategoryStats,
  getAllStats,

  // Theme functions (new unified approach)
  loadTheme,
  clearThemeCache,
  buildThemedPrompt,
  getThemedNegativePrompt,

  // Layered composition system
  buildCleanItemPrompt,
  buildOverlayPrompt,
  getOverlayConfig,

  // NEW: Flat texture tile system
  buildFlatTilePrompt,
  buildWallPrompt,

  // Prompt builders (legacy)
  NEGATIVE_PROMPT,
  STYLE_PREFIXES,
  REGIONAL_PALETTES,
  buildTilePrompt,
  buildPortraitPrompt,
  buildIconPrompt,
  buildItemPrompt,
  buildNodePrompt,
  getStylePrefix,
  getTriggerWord,
  getRegionalPalette,

  // Backup utilities
  getBackupDir,
  formatBackupTimestamp,
  parseBackupTimestamp,
  getImageOutputDir,
  getAssetImagePath,
  createBackup,
  restoreBackup,
  listBackups,
  getLatestBackup,
  getBackupInfo,
  deleteBackup,
  cleanupOldBackups,

  // Batch configuration
  parseSimpleYaml,
  resolveBatchConfigPath,
  loadBatchConfig,
  getBatchConfigSummary,

  // Resize utilities
  STANDARD_SIZES,
  SIZE_PRESETS,
  AI_RESOLUTIONS,
  checkImageMagick,
  getSizedPath,
  getSizedPathNonSquare,
  resizeImage,
  resizeImageNonSquare,
  applyDiamondMask,
  applyIsometricTransform,
  generateSizeVariants,
  generateSizeVariantsForDirectory,
  postProcessGenerated,
  postProcessTile,
  postProcessFlatTile,
  postProcessPortrait,
  postProcessItem,
  postProcessIcon,
  postProcessNode,
  postProcessWall,
  postProcessSlope,
  postProcessByType
};
