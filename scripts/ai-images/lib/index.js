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
  generateWall,
  generatePortrait,
  generateIcon,
  generateItem,
  generateNode,
  generateObstacle,
  generateOverlay,
  runBatchGeneration,
  removeBackground,
  generateCharacterFrame,
  generateAnimation,
  generateReferenceImage
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
  loadObstacleMetadata,
  loadOverlayMetadata,
  loadCharacterMetadata,
  updateAssetStatus,
  markAssetGenerated,
  loadRegenerationQueue,
  markForRegeneration,
  clearRegenerationMarker,
  recordGenerationFailure,
  getCategoryStats,
  getAllStats,
  getEffectiveLoraModel
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
  // SD1.5 animation generation support
  SD15_LORA_TRIGGERS,
  getSD15LoraTrigger,
  buildSD15CharacterPrompt,
  buildSD15ReferencePrompt,
  getSD15NegativePrompt,
  // Legacy functions
  NEGATIVE_PROMPT,
  STYLE_PREFIXES,
  REGIONAL_PALETTES,
  buildPortraitPrompt,
  buildIconPrompt,
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

const { parseBaseArgs, VALID_LORA_MODELS, BASE_DEFAULTS } = require('./parseArgs');
const { applyKeyFilter } = require('./filterAssets');

const {
  getAssetPathsModule,
  CATEGORY_BASE_DIRS,
  getOutputDir,
  getOriginalsFilePath
} = require('./assetPathsBridge');

const {
  STANDARD_SIZES,
  SIZE_PRESETS,
  AI_RESOLUTIONS,
  checkImageMagick,
  getImageDimensions,
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
  postProcessByType,
  postProcessWithDualWrite,
  getCanonicalSizedPath,
  generateCanonicalSizeVariants,
  concatenateVerticalStrip
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
  generateWall,
  generatePortrait,
  generateIcon,
  generateItem,
  generateNode,
  generateObstacle,
  generateOverlay,
  runBatchGeneration,
  removeBackground,
  generateCharacterFrame,
  generateAnimation,
  generateReferenceImage,

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
  loadObstacleMetadata,
  loadOverlayMetadata,
  loadCharacterMetadata,
  updateAssetStatus,
  markAssetGenerated,
  loadRegenerationQueue,
  markForRegeneration,
  clearRegenerationMarker,
  recordGenerationFailure,
  getCategoryStats,
  getAllStats,
  getEffectiveLoraModel,

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

  // SD1.5 animation generation support
  SD15_LORA_TRIGGERS,
  getSD15LoraTrigger,
  buildSD15CharacterPrompt,
  buildSD15ReferencePrompt,
  getSD15NegativePrompt,

  // Prompt builders (legacy)
  NEGATIVE_PROMPT,
  STYLE_PREFIXES,
  REGIONAL_PALETTES,
  buildPortraitPrompt,
  buildIconPrompt,
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
  getImageDimensions,
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
  postProcessByType,
  postProcessWithDualWrite,
  getCanonicalSizedPath,
  generateCanonicalSizeVariants,
  concatenateVerticalStrip,

  // Shared argument parsing
  parseBaseArgs,
  VALID_LORA_MODELS,
  BASE_DEFAULTS,

  // Shared asset filtering
  applyKeyFilter,

  // Asset path bridge (shared/assetPaths.js CJS bridge)
  getAssetPathsModule,
  CATEGORY_BASE_DIRS,
  getOutputDir,
  getOriginalsFilePath
};
