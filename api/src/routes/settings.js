const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');

// Default settings structure
const DEFAULT_SETTINGS = {
  battle: {
    actionMenuStyle: 'radial' // 'radial' | 'context' | 'actionbar'
  }
};

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object to merge
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Validate settings structure
 * @param {Object} settings - Settings to validate
 * @returns {Object} Validation result { valid: boolean, error?: string }
 */
function validateSettings(settings) {
  if (typeof settings !== 'object' || settings === null) {
    return { valid: false, error: 'Settings must be an object' };
  }

  // Validate battle settings if present
  if (settings.battle) {
    if (typeof settings.battle !== 'object') {
      return { valid: false, error: 'battle settings must be an object' };
    }

    if (settings.battle.actionMenuStyle !== undefined) {
      const validStyles = ['radial', 'context', 'actionbar'];
      if (!validStyles.includes(settings.battle.actionMenuStyle)) {
        return { valid: false, error: `actionMenuStyle must be one of: ${validStyles.join(', ')}` };
      }
    }
  }

  return { valid: true };
}

// GET /api/settings - Get current user's settings
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Try to get existing settings
  const result = await query(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    // Create default settings for this user
    const insertResult = await query(
      `INSERT INTO user_settings (user_id, settings)
       VALUES ($1, $2)
       RETURNING settings`,
      [userId, JSON.stringify(DEFAULT_SETTINGS)]
    );

    return res.json({ settings: insertResult.rows[0].settings });
  }

  res.json({ settings: result.rows[0].settings });
}));

// PUT /api/settings - Update user settings (deep merge)
router.put('/', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const newSettings = req.body;

  // Validate incoming settings
  const validation = validateSettings(newSettings);
  if (!validation.valid) {
    throw new AppError(validation.error, 400);
  }

  // Get existing settings or use defaults
  const existingResult = await query(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    [userId]
  );

  let currentSettings = DEFAULT_SETTINGS;
  if (existingResult.rows.length > 0) {
    currentSettings = existingResult.rows[0].settings;
  }

  // Deep merge new settings into existing
  const mergedSettings = deepMerge(currentSettings, newSettings);

  // Upsert the settings
  const result = await query(
    `INSERT INTO user_settings (user_id, settings)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET settings = $2, updated_at = CURRENT_TIMESTAMP
     RETURNING settings`,
    [userId, JSON.stringify(mergedSettings)]
  );

  res.json({ settings: result.rows[0].settings });
}));

module.exports = router;
