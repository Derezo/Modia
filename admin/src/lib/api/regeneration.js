/**
 * Regeneration API - Queue management for asset regeneration
 */

import { fetchAPI } from './client';

// ============================================
// Image Regeneration Queue
// ============================================

/**
 * Get the unified regeneration queue across all asset types
 * @returns {Promise<object>} Queue with items grouped by category
 */
export const getRegenerationQueue = () => fetchAPI('/regeneration-queue');

/**
 * Mark a single asset for regeneration
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @param {boolean} mark - True to mark, false to unmark
 * @returns {Promise<object>} Updated asset status
 */
export const markForRegeneration = (category, id, mark = true) =>
  fetchAPI(`/assets/${category}/${id}/mark-regeneration`, {
    method: 'PUT',
    body: JSON.stringify({ mark }),
  });

/**
 * Mark multiple assets for regeneration
 * @param {string} category - Asset category
 * @param {string[]} ids - Array of asset IDs
 * @param {boolean} mark - True to mark, false to unmark
 * @param {object} options - Additional options
 * @param {string} options.biome - Required for tiles category
 * @returns {Promise<object>} Result with updated count
 */
export const markMultipleForRegeneration = (category, ids, mark = true, options = {}) =>
  fetchAPI('/assets/mark-multiple', {
    method: 'PUT',
    body: JSON.stringify({ category, ids, mark, biome: options.biome }),
  });

/**
 * Clear all items from the regeneration queue
 * @param {string} category - Optional category to clear (all if omitted)
 * @returns {Promise<object>} Result with cleared count
 */
export const clearRegenerationQueue = (category = null) =>
  fetchAPI('/regeneration-queue/clear', {
    method: 'POST',
    body: JSON.stringify({ category }),
  });

/**
 * Process the regeneration queue (start batch generation)
 * @param {object} options - Generation options
 * @returns {Promise<object>} Generation job info
 */
export const processRegenerationQueue = (options = {}) =>
  fetchAPI('/generate/regeneration-queue', {
    method: 'POST',
    body: JSON.stringify(options),
  });

// ============================================
// Audio Regeneration Queue
// ============================================

/**
 * Get audio items marked for regeneration
 * @returns {Promise<object>} Audio queue items grouped by type
 */
export const getAudioRegenerationQueue = () => fetchAPI('/audio/regeneration-queue');

/**
 * Mark a single audio asset for regeneration
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {boolean} mark - True to mark, false to unmark
 * @returns {Promise<object>} Updated asset status
 */
export const markAudioForRegeneration = (audioType, id, mark = true) =>
  fetchAPI(`/audio/${audioType}/${id}/mark-regeneration`, {
    method: 'PUT',
    body: JSON.stringify({ mark }),
  });

/**
 * Mark multiple audio assets for regeneration
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string[]} ids - Array of asset IDs
 * @param {boolean} mark - True to mark, false to unmark
 * @returns {Promise<object>} Result with updated count
 */
export const markMultipleAudioForRegeneration = (audioType, ids, mark = true) =>
  fetchAPI('/audio/mark-multiple', {
    method: 'PUT',
    body: JSON.stringify({ type: audioType, ids, mark }),
  });

/**
 * Process audio regeneration queue (start batch generation)
 * @param {object} options - Options
 * @returns {Promise<object>} Generation job info
 */
export const processAudioRegenerationQueue = (options = {}) =>
  fetchAPI('/audio/generate/regeneration-queue', {
    method: 'POST',
    body: JSON.stringify(options),
  });
