/**
 * Assets API - Image asset CRUD operations
 */

import { fetchAPI } from './client';

/**
 * Get assets by category with optional filters
 * @param {string} category - Asset category (tiles, portraits, items, etc.)
 * @param {object} params - Filter parameters
 * @returns {Promise<object>} Assets response
 */
export const getAssets = (category, params = {}) => {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.biome) searchParams.set('biome', params.biome);
  if (params.subcategory) searchParams.set('subcategory', params.subcategory);

  const query = searchParams.toString();
  return fetchAPI(`/assets/${category}${query ? `?${query}` : ''}`);
};

/**
 * Get a single asset by ID
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @param {object} options - Disambiguation options
 * @param {string} options.biome - Required for tiles category
 * @param {string} options.sourceFile - Alternative to biome (more precise)
 * @returns {Promise<object>} Asset details
 */
export const getAsset = (category, id, options = {}) => {
  const params = new URLSearchParams();
  if (options.biome) params.set('biome', options.biome);
  if (options.sourceFile) params.set('sourceFile', options.sourceFile);

  const query = params.toString();
  return fetchAPI(`/assets/${category}/${id}${query ? `?${query}` : ''}`);
};

/**
 * Get full prompt construction breakdown for an asset
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @param {object} options - Disambiguation options
 * @param {string} options.biome - Required for tiles category
 * @param {string} options.sourceFile - Alternative to biome (more precise)
 * @returns {Promise<object>} Prompt breakdown
 */
export const getAssetPrompt = (category, id, options = {}) => {
  const params = new URLSearchParams();
  if (options.biome) params.set('biome', options.biome);
  if (options.sourceFile) params.set('sourceFile', options.sourceFile);

  const query = params.toString();
  return fetchAPI(`/assets/${category}/${id}/prompt${query ? `?${query}` : ''}`);
};

/**
 * Update an asset's metadata
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @param {object} updates - Fields to update
 * @param {object} options - Disambiguation options for categories with ID collisions
 * @param {string} options.biome - For tiles category
 * @param {string} options.iconCategory - For icons category (status, augments, etc.)
 * @param {string} options.itemCategory - For items category (weapons, armor, etc.)
 * @param {string} options.sourceFile - Most precise (works for any category)
 * @returns {Promise<object>} Updated asset
 */
export const updateAsset = (category, id, updates, options = {}) =>
  fetchAPI(`/assets/${category}/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...updates,
      biome: options.biome,
      iconCategory: options.iconCategory,
      itemCategory: options.itemCategory,
      sourceFile: options.sourceFile,
    }),
  });

/**
 * Bulk update multiple assets' metadata
 * @param {string} category - Asset category
 * @param {string[]} assetIds - Array of asset IDs to update
 * @param {object} updates - Fields to update (qualityScore, priority, loraModel, note)
 * @param {object} options - Additional options
 * @param {string} options.biome - Required for tiles category
 * @param {string} options.subcategory - Tile category (floors, slopes, walls)
 * @returns {Promise<object>} Result with updated count and any errors
 */
export const bulkUpdateAssets = (category, assetIds, updates, options = {}) =>
  fetchAPI('/assets/bulk-update', {
    method: 'POST',
    body: JSON.stringify({
      assetIds,
      category,
      updates,
      biome: options.biome,
      subcategory: options.subcategory,
    }),
  });

// ============================================================================
// SD1.5 Animation Controls (Character Assets)
// ============================================================================

/**
 * Get character animations with generation status
 * @param {string} characterId - Character ID (e.g., 'warrior', 'mage')
 * @returns {Promise<object>} Animations with status { animations: { idle: { generated, path }, ... } }
 */
export const getCharacterAnimations = (characterId) =>
  fetchAPI(`/assets/characters/${characterId}/animations`);

/**
 * Update character SD1.5 weights
 * @param {string} characterId - Character ID
 * @param {object} weights - Weight configuration { controlnetWeight, ipadapterWeight }
 * @returns {Promise<object>} Updated weights
 */
export const updateCharacterWeights = (characterId, weights) =>
  fetchAPI(`/assets/characters/${characterId}/weights`, {
    method: 'PUT',
    body: JSON.stringify(weights),
  });

/**
 * Get available weight presets
 * @param {string} characterId - Character ID
 * @returns {Promise<object>} Presets { presets: { balanced: {...}, ... }, current: {...} }
 */
export const getWeightPresets = (characterId) =>
  fetchAPI(`/assets/characters/${characterId}/weights/presets`);

/**
 * Get reference image status for a character
 * @param {string} characterId - Character ID
 * @returns {Promise<object>} Reference image status { exists, path, generatedAt }
 */
export const getReferenceImageStatus = (characterId) =>
  fetchAPI(`/assets/characters/${characterId}/reference`);

/**
 * Generate reference image for a character
 * @param {string} characterId - Character ID
 * @param {object} options - Generation options (loraModel, etc.)
 * @returns {Promise<object>} Generation result
 */
export const generateReferenceImage = (characterId, options = {}) =>
  fetchAPI(`/assets/characters/${characterId}/reference/generate`, {
    method: 'POST',
    body: JSON.stringify(options),
  });

/**
 * Generate specific animation for a character
 * @param {string} characterId - Character ID
 * @param {string} animation - Animation name (idle, walk, attack, etc.)
 * @returns {Promise<object>} Generation result
 */
export const generateCharacterAnimation = (characterId, animation) =>
  fetchAPI(`/assets/characters/${characterId}/animations/${animation}/generate`, {
    method: 'POST',
  });

/**
 * Generate multiple animations for a character with SD1.5 mode
 * @param {string} characterId - Character ID
 * @param {string[]} animations - Array of animation names to generate
 * @param {object} options - Generation options
 * @returns {Promise<object>} Generation job info
 */
export const generateCharacterAnimations = (characterId, animations, options = {}) =>
  fetchAPI('/generate', {
    method: 'POST',
    body: JSON.stringify({
      category: 'characters',
      filters: { id: characterId },
      options: {
        sd15Mode: true,
        animations,
        ...options,
      },
    }),
  });

// ============================================================================
// Frame Description Overrides (Character Assets)
// ============================================================================

/**
 * Get frame description overrides for a character
 * @param {string} characterId - Character ID
 * @param {string|null} animation - Optional specific animation to get
 * @returns {Promise<object>} Frame descriptions { defaults, overrides, ... }
 */
export const getFrameDescriptions = (characterId, animation = null) => {
  const query = animation ? `?animation=${encodeURIComponent(animation)}` : '';
  return fetchAPI(`/assets/characters/${characterId}/frame-descriptions${query}`);
};

/**
 * Update frame description overrides for a character
 * @param {string} characterId - Character ID
 * @param {object} frameDescriptionOverrides - Overrides by animation { animation: [frame1, frame2, ...] }
 * @returns {Promise<object>} Updated overrides
 */
export const updateFrameDescriptions = (characterId, frameDescriptionOverrides) =>
  fetchAPI(`/assets/characters/${characterId}/frame-descriptions`, {
    method: 'PUT',
    body: JSON.stringify({ frameDescriptionOverrides }),
  });

/**
 * Remove frame description overrides for a specific animation
 * @param {string} characterId - Character ID
 * @param {string} animation - Animation to remove overrides for
 * @returns {Promise<object>} Result
 */
export const deleteFrameDescriptionOverrides = (characterId, animation) =>
  fetchAPI(`/assets/characters/${characterId}/frame-descriptions/${animation}`, {
    method: 'DELETE',
  });

// ============================================================================
// Background Removal & Reprocessing
// ============================================================================

/**
 * Reprocess an asset with background removal and regenerate size variants
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @param {object} options - Reprocessing options
 * @param {string} options.model - rembg model to use (optional, uses category default)
 * @param {string} options.biome - Required for tiles category
 * @returns {Promise<object>} Reprocessing result { success, model, variants, backgroundRemovalApplied }
 */
export const reprocessAsset = (category, id, options = {}) =>
  fetchAPI(`/assets/${category}/${id}/reprocess`, {
    method: 'POST',
    body: JSON.stringify({
      model: options.model || undefined,
      biome: options.biome || undefined,
    }),
  });
