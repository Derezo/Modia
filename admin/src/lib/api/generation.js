/**
 * Generation API - Image generation queue operations
 */

import { fetchAPI } from './client';

/**
 * Queue image generation for assets
 * @param {string} category - Asset category
 * @param {object} filters - Filter parameters
 * @param {object} options - Generation options
 * @returns {Promise<object>} Generation job info
 */
export const generateAssets = (category, filters = {}, options = {}) =>
  fetchAPI('/generate', {
    method: 'POST',
    body: JSON.stringify({ category, filters, options }),
  });

/**
 * Generate specific assets by ID
 * @param {string} category - Asset category
 * @param {string[]} assetIds - Array of asset IDs
 * @param {object} options - Generation options
 * @param {object} extraFilters - Additional filters (biome, subcategory, etc.)
 * @returns {Promise<object>} Generation job info
 */
export const generateAssetsByIds = (category, assetIds, options = {}, extraFilters = {}) =>
  fetchAPI('/generate', {
    method: 'POST',
    body: JSON.stringify({
      category,
      filters: { ids: assetIds, ...extraFilters },
      options,
    }),
  });

/**
 * Get current generation queue status
 * @returns {Promise<object>} Queue with current, pending, and stats
 */
export const getQueue = () => fetchAPI('/generate/queue');

/**
 * Get a specific job's status
 * @param {string} jobId - Job ID
 * @returns {Promise<object>} Job details
 */
export const getJob = (jobId) => fetchAPI(`/generate/job/${jobId}`);

/**
 * Cancel a specific generation job
 * @param {string} jobId - Job ID to cancel
 * @returns {Promise<object>} Cancellation result
 */
export const cancelJob = (jobId) =>
  fetchAPI('/generate/cancel', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });

/**
 * Cancel all pending generation jobs
 * @returns {Promise<object>} Cancellation result
 */
export const cancelAllJobs = () =>
  fetchAPI('/generate/cancel', {
    method: 'POST',
    body: JSON.stringify({ all: true }),
  });
