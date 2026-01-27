/**
 * Audio Generation API - Audio generation queue operations
 */

import { fetchAPI } from './client';

/**
 * Queue audio generation for assets
 * @param {string} audioType - 'music' or 'sfx'
 * @param {object} filters - Filter parameters
 * @param {object} options - Generation options
 * @returns {Promise<object>} Generation job info
 */
export const generateAudio = (audioType, filters = {}, options = {}) =>
  fetchAPI('/audio/generate', {
    method: 'POST',
    body: JSON.stringify({ type: audioType, filters, options }),
  });

/**
 * Get current audio generation queue status
 * @returns {Promise<object>} Queue with current, pending, and history
 */
export const getAudioQueue = () => fetchAPI('/audio/generate/queue');

/**
 * Cancel a specific audio generation job
 * @param {string} jobId - Job ID to cancel
 * @returns {Promise<object>} Cancellation result
 */
export const cancelAudioJob = (jobId) =>
  fetchAPI('/audio/generate/cancel', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });

/**
 * Cancel all pending audio generation jobs
 * @returns {Promise<object>} Cancellation result
 */
export const cancelAllAudioJobs = () =>
  fetchAPI('/audio/generate/cancel', {
    method: 'POST',
    body: JSON.stringify({ all: true }),
  });
