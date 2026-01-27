/**
 * Audio API - Audio asset CRUD operations
 */

import { fetchAPI } from './client';

/**
 * Get audio assets by type with optional filters
 * @param {string} audioType - 'music' or 'sfx'
 * @param {object} params - Filter parameters
 * @returns {Promise<object>} Audio assets response
 */
export const getAudioAssets = (audioType, params = {}) => {
  const searchParams = new URLSearchParams();
  if (params.category) searchParams.set('category', params.category);
  if (params.region) searchParams.set('region', params.region);
  if (params.subcategory) searchParams.set('subcategory', params.subcategory);
  if (params.status) searchParams.set('status', params.status);
  const query = searchParams.toString();
  return fetchAPI(`/audio/${audioType}${query ? `?${query}` : ''}`);
};

/**
 * Get a single audio asset by ID
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @returns {Promise<object>} Audio asset details
 */
export const getAudioAsset = (audioType, id) => fetchAPI(`/audio/${audioType}/${id}`);

/**
 * Update an audio asset's metadata
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated asset
 */
export const updateAudioAsset = (audioType, id, updates) =>
  fetchAPI(`/audio/${audioType}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

/**
 * Get waveform visualization data for an audio asset
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @returns {Promise<object>} Waveform data
 */
export const getAudioWaveform = (audioType, id) => fetchAPI(`/audio/${audioType}/${id}/waveform`);

/**
 * Get overall audio statistics
 * @returns {Promise<object>} Audio stats for music and sfx
 */
export const getAudioStats = () => fetchAPI('/audio/stats');

// ============================================
// Music-specific
// ============================================

/**
 * Set the primary variant for a music track
 * @param {string} trackId - Music track ID
 * @param {string} variantPath - Path to the variant file
 * @returns {Promise<object>} Updated track info
 */
export const setMusicPrimaryVariant = (trackId, variantPath) =>
  fetchAPI(`/audio/music/${trackId}/primary`, {
    method: 'POST',
    body: JSON.stringify({ variantPath }),
  });

/**
 * Get Suno generation task status
 * @param {string} taskId - Suno task ID
 * @returns {Promise<object>} Task status
 */
export const getSunoTaskStatus = (taskId) => fetchAPI(`/audio/suno/status/${taskId}`);

// ============================================
// SFX-specific
// ============================================

/**
 * Validate an SFX prompt before generation
 * @param {string} prompt - The prompt to validate
 * @returns {Promise<object>} Validation result
 */
export const validateSfxPrompt = (prompt) =>
  fetchAPI('/audio/sfx/validate', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
