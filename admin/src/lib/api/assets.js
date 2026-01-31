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
 * @returns {Promise<object>} Asset details
 */
export const getAsset = (category, id) => fetchAPI(`/assets/${category}/${id}`);

/**
 * Get full prompt construction breakdown for an asset
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @returns {Promise<object>} Prompt breakdown
 */
export const getAssetPrompt = (category, id) => fetchAPI(`/assets/${category}/${id}/prompt`);

/**
 * Update an asset's metadata
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated asset
 */
export const updateAsset = (category, id, updates) =>
  fetchAPI(`/assets/${category}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

/**
 * Bulk update multiple assets' metadata
 * @param {string} category - Asset category
 * @param {string[]} assetIds - Array of asset IDs to update
 * @param {object} updates - Fields to update (qualityScore, priority, loraModel, note)
 * @returns {Promise<object>} Result with updated count and any errors
 */
export const bulkUpdateAssets = (category, assetIds, updates) =>
  fetchAPI('/assets/bulk-update', {
    method: 'POST',
    body: JSON.stringify({ assetIds, category, updates }),
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
 * @returns {Promise<object>} Generation result
 */
export const generateReferenceImage = (characterId) =>
  fetchAPI(`/assets/characters/${characterId}/reference/generate`, {
    method: 'POST',
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
