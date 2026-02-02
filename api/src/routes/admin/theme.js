/**
 * @module admin/theme
 * @description Theme configuration and preset management routes
 *
 * Key responsibilities:
 * - Theme CRUD operations (get, update)
 * - Theme preset listing, creation, application, and deletion
 * - Style configuration for AI image generation
 *
 * Route groups:
 * - GET /theme - Get current theme configuration
 * - PUT /theme - Update theme configuration
 * - GET /theme/presets - List all presets
 * - GET /theme/presets/:name - Get specific preset
 * - POST /theme/presets - Save current theme as preset
 * - POST /theme/presets/:name/apply - Apply preset to current theme
 * - DELETE /theme/presets/:name - Delete a preset
 *
 * @see shared.js - Common utilities and helpers
 */

import express from 'express';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import { AppError, asyncHandler } from '../../middleware/errorHandler.js';
import { loadJsonFile, saveJsonFile } from '../../utils/jsonFileUtils.js';
import { METADATA_DIR, PRESETS_DIR } from './shared.js';

const router = express.Router();

// ============================================================================
// THEME ROUTES
// ============================================================================

/**
 * GET /theme
 * Get theme.json
 */
router.get('/', asyncHandler(async (req, res) => {
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const theme = await loadJsonFile(themePath);

  if (!theme) {
    throw new AppError('Theme file not found', 404);
  }

  res.json(theme);
}));

/**
 * PUT /theme
 * Update theme.json
 */
router.put('/', asyncHandler(async (req, res) => {
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const currentTheme = await loadJsonFile(themePath);

  if (!currentTheme) {
    throw new AppError('Theme file not found', 404);
  }

  // Merge updates with current theme
  const updatedTheme = {
    ...currentTheme,
    ...req.body,
    // Preserve nested objects by merging them too
    style: { ...currentTheme.style, ...(req.body.style || {}) },
    categoryModifiers: { ...currentTheme.categoryModifiers, ...(req.body.categoryModifiers || {}) },
    rarityModifiers: { ...currentTheme.rarityModifiers, ...(req.body.rarityModifiers || {}) },
    overlayConfig: { ...currentTheme.overlayConfig, ...(req.body.overlayConfig || {}) },
    iconCategoryModifiers: { ...currentTheme.iconCategoryModifiers, ...(req.body.iconCategoryModifiers || {}) },
    loraDefaults: { ...currentTheme.loraDefaults, ...(req.body.loraDefaults || {}) }
  };

  try {
    await saveJsonFile(themePath, updatedTheme);
  } catch (error) {
    throw new AppError(`Failed to save theme: ${error.message}`, 500);
  }

  res.json({
    message: 'Theme updated successfully',
    theme: updatedTheme
  });
}));

// ============================================================================
// PRESET ROUTES
// ============================================================================

/**
 * GET /theme/presets
 * List all available theme presets
 */
router.get('/presets', asyncHandler(async (req, res) => {
  const presets = [];

  if (!existsSync(PRESETS_DIR)) {
    return res.json({ presets: [] });
  }

  const files = await fs.readdir(PRESETS_DIR);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const presetPath = path.join(PRESETS_DIR, file);
      const preset = await loadJsonFile(presetPath);
      if (preset) {
        presets.push({
          filename: file.replace('.json', ''),
          name: preset.name || file.replace('.json', ''),
          description: preset.description || '',
          builtin: preset.builtin === true
        });
      }
    } catch (error) {
      console.warn(`[Admin] Failed to load preset ${file}:`, error.message);
    }
  }

  res.json({ presets });
}));

/**
 * GET /theme/presets/:name
 * Get a specific theme preset
 */
router.get('/presets/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;

  // Validate name to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name', 400);
  }

  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const preset = await loadJsonFile(presetPath);

  if (!preset) {
    throw new AppError(`Preset not found: ${name}`, 404);
  }

  res.json(preset);
}));

/**
 * POST /theme/presets
 * Save current theme as a new preset
 * Body: { name: string, description?: string }
 */
router.post('/presets', asyncHandler(async (req, res) => {
  const { name, description = '' } = req.body;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name. Use only letters, numbers, underscores, and dashes.', 400);
  }

  // Check if preset exists and is builtin
  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const existingPreset = await loadJsonFile(presetPath);
  if (existingPreset?.builtin) {
    throw new AppError('Cannot overwrite built-in preset', 400);
  }

  // Load current theme
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const currentTheme = await loadJsonFile(themePath);

  if (!currentTheme) {
    throw new AppError('Current theme not found', 404);
  }

  // Create preset from current theme (exclude version and some fields)
  const preset = {
    name,
    description,
    builtin: false,
    savedAt: new Date().toISOString(),
    style: currentTheme.style,
    negativePrompt: currentTheme.negativePrompt,
    categoryModifiers: currentTheme.categoryModifiers
  };

  // Ensure presets directory exists
  if (!existsSync(PRESETS_DIR)) {
    await fs.mkdir(PRESETS_DIR, { recursive: true });
  }

  await saveJsonFile(presetPath, preset);

  res.status(201).json({
    message: 'Preset saved successfully',
    preset: {
      filename: name,
      name: preset.name,
      description: preset.description,
      builtin: false
    }
  });
}));

/**
 * POST /theme/presets/:name/apply
 * Apply a preset to the current theme
 */
router.post('/presets/:name/apply', asyncHandler(async (req, res) => {
  const { name } = req.params;

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name', 400);
  }

  // Load preset
  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const preset = await loadJsonFile(presetPath);

  if (!preset) {
    throw new AppError(`Preset not found: ${name}`, 404);
  }

  // Load current theme
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const currentTheme = await loadJsonFile(themePath);

  if (!currentTheme) {
    throw new AppError('Current theme not found', 404);
  }

  // Apply preset to theme (preserve version, loraDefaults, overlayConfig, etc.)
  const updatedTheme = {
    ...currentTheme,
    name: preset.name,
    description: preset.description || currentTheme.description,
    style: { ...currentTheme.style, ...preset.style },
    negativePrompt: preset.negativePrompt || currentTheme.negativePrompt,
    categoryModifiers: { ...currentTheme.categoryModifiers, ...preset.categoryModifiers }
  };

  await saveJsonFile(themePath, updatedTheme);

  res.json({
    message: `Preset "${name}" applied successfully`,
    theme: updatedTheme
  });
}));

/**
 * DELETE /theme/presets/:name
 * Delete a custom preset (cannot delete built-in presets)
 */
router.delete('/presets/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name', 400);
  }

  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const preset = await loadJsonFile(presetPath);

  if (!preset) {
    throw new AppError(`Preset not found: ${name}`, 404);
  }

  if (preset.builtin) {
    throw new AppError('Cannot delete built-in preset', 400);
  }

  await fs.unlink(presetPath);

  res.json({
    message: `Preset "${name}" deleted successfully`
  });
}));

export default router;
