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
