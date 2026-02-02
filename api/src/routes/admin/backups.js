/**
 * @module admin/backups
 * @description Backup management routes for AI-generated assets
 *
 * Key responsibilities:
 * - Backup listing
 * - Backup creation (full or by category)
 * - Backup details retrieval
 * - Backup restoration
 * - Backup deletion
 *
 * Route groups:
 * - GET /backups - List all backups
 * - POST /backups - Create a new backup
 * - GET /backups/:timestamp - Get backup details
 * - POST /backups/:timestamp/restore - Restore from backup
 * - DELETE /backups/:timestamp - Delete a backup
 *
 * @see backupUtils.js - Backup utility functions
 */

import express from 'express';
import { AppError, asyncHandler } from '../../middleware/errorHandler.js';
import {
  metadataUtils,
  backupUtils,
  ensureUtilities,
  VALID_CATEGORIES,
} from './shared.js';

const router = express.Router();

/**
 * Validate backup timestamp format to prevent path traversal
 * Expected format: 2024-01-20_15-30-00 (matches backupUtils.js formatBackupTimestamp)
 */
function validateTimestamp(timestamp) {
  const timestampPattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
  return timestampPattern.test(timestamp);
}

// ============================================================================
// BACKUP ROUTES
// ============================================================================

/**
 * GET /backups
 * List backups
 */
router.get('/', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  try {
    const backups = backupUtils.listBackups();
    res.json({
      backups,
      count: backups.length
    });
  } catch (error) {
    throw new AppError(`Failed to list backups: ${error.message}`, 500);
  }
}));

/**
 * POST /backups
 * Create backup
 * Body: { reason?: string, category?: string, assets?: array }
 * - assets: explicit list of assets to backup
 * - category: specific category to backup (tiles, portraits, etc.)
 * - If neither specified, backs up everything
 */
router.post('/', asyncHandler(async (req, res) => {
  ensureUtilities();
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { reason = 'manual', category, assets } = req.body;

  // Validate category if provided
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}. Valid: ${VALID_CATEGORIES.join(', ')}`, 400);
  }

  let assetsToBackup = assets;

  // If no assets specified, load from category or all categories
  if (!assetsToBackup) {
    assetsToBackup = [];
    const categoriesToBackup = category ? [category] : VALID_CATEGORIES;

    for (const cat of categoriesToBackup) {
      try {
        const data = metadataUtils.loadCategoryAssets(cat);
        assetsToBackup.push(...data.assets);
      } catch (error) {
        console.warn(`[Admin] Failed to load ${cat} for backup:`, error.message);
      }
    }
  }

  // Build backup reason with category info
  const backupReason = category ? `${reason} (${category})` : reason;

  try {
    const result = backupUtils.createBackup(assetsToBackup, { reason: backupReason });

    if (!result.success) {
      throw new AppError(result.error || 'Backup failed', 500);
    }

    res.status(201).json({
      message: 'Backup created successfully',
      timestamp: result.timestamp,
      assetCount: result.assetCount,
      backupDir: result.backupDir,
      category: category || 'all'
    });
  } catch (error) {
    throw new AppError(`Failed to create backup: ${error.message}`, 500);
  }
}));

/**
 * GET /backups/:timestamp
 * Get backup details
 */
router.get('/:timestamp', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { timestamp } = req.params;

  if (!validateTimestamp(timestamp)) {
    throw new AppError('Invalid timestamp format', 400);
  }

  try {
    const info = backupUtils.getBackupInfo(timestamp);

    if (!info) {
      throw new AppError(`Backup not found: ${timestamp}`, 404);
    }

    res.json(info);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(`Failed to get backup info: ${error.message}`, 500);
  }
}));

/**
 * POST /backups/:timestamp/restore
 * Restore from backup
 */
router.post('/:timestamp/restore', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { timestamp } = req.params;

  if (!validateTimestamp(timestamp)) {
    throw new AppError('Invalid timestamp format', 400);
  }

  try {
    const result = backupUtils.restoreBackup(timestamp);

    res.json({
      message: 'Backup restored successfully',
      ...result
    });
  } catch (error) {
    throw new AppError(`Failed to restore backup: ${error.message}`, 500);
  }
}));

/**
 * DELETE /backups/:timestamp
 * Delete a backup
 */
router.delete('/:timestamp', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { timestamp } = req.params;

  if (!validateTimestamp(timestamp)) {
    throw new AppError('Invalid timestamp format', 400);
  }

  try {
    const deleted = backupUtils.deleteBackup(timestamp);

    if (!deleted) {
      throw new AppError(`Backup not found: ${timestamp}`, 404);
    }

    res.json({
      message: 'Backup deleted successfully',
      timestamp
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(`Failed to delete backup: ${error.message}`, 500);
  }
}));

export default router;
