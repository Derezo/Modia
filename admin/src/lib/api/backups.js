/**
 * Backups API - Backup management operations
 */

import { fetchAPI } from './client';

/**
 * Get list of all backups
 * @returns {Promise<object>} List of backups
 */
export const getBackups = () => fetchAPI('/backups');

/**
 * Create a new backup
 * @param {string} reason - Reason for backup
 * @param {object} options - Additional options
 * @returns {Promise<object>} Created backup info
 */
export const createBackup = (reason = 'manual', options = {}) =>
  fetchAPI('/backups', {
    method: 'POST',
    body: JSON.stringify({ reason, ...options }),
  });

/**
 * Get a specific backup's details
 * @param {string} timestamp - Backup timestamp
 * @returns {Promise<object>} Backup details
 */
export const getBackup = (timestamp) => fetchAPI(`/backups/${timestamp}`);

/**
 * Restore from a backup
 * @param {string} timestamp - Backup timestamp to restore
 * @returns {Promise<object>} Restore result
 */
export const restoreBackup = (timestamp) =>
  fetchAPI(`/backups/${timestamp}/restore`, {
    method: 'POST',
  });

/**
 * Delete a backup
 * @param {string} timestamp - Backup timestamp to delete
 * @returns {Promise<object>} Deletion result
 */
export const deleteBackup = (timestamp) =>
  fetchAPI(`/backups/${timestamp}`, {
    method: 'DELETE',
  });
