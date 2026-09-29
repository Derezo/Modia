import express from 'express';
import { query } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';
import { clearSettingsCache } from '../services/userSettingsService.js';

const router = express.Router();

// SECURITY: Developer mode is STRICTLY disabled in production
// This mirrors the security pattern in debug.js
const isProduction = process.env.NODE_ENV === 'production';

// Default settings structure (8 categories, ~55 settings)
// IMPORTANT: This structure is mirrored in:
// - frontend/src/core/Game.js (defaults)
// - frontend/src/scenes/SettingsScene.js (UI)
// Keep all three in sync when making changes.
const DEFAULT_SETTINGS = {
  battle: {
    actionMenuStyle: 'radial',    // 'radial' | 'context' | 'actionbar'
    showDamageNumbers: true,      // moved from display
    showBattleGrid: true,         // moved from display
    autoEndTurn: false,           // automatically end turn when no actions available
    confirmEndTurn: true,         // show confirmation before ending turn
    showDamagePreview: true,      // show damage preview on hover
    showMissChance: true,         // show miss/hit chance percentages
    battleLogPosition: 'right',   // 'left' | 'right' | 'bottom'
    battleLogVisible: true        // show/hide battle log
  },
  audio: {
    masterVolume: 80,
    musicVolume: 70,
    sfxVolume: 80,
    uiVolume: 70,                  // UI sound effects volume
    muted: false,
    musicEnabled: true,            // enable/disable music
    sfxEnabled: true,              // enable/disable sound effects
    ambientEnabled: true           // enable/disable ambient sounds
  },
  display: {
    animationSpeed: 'normal',     // 'slow' | 'normal' | 'fast'
    cameraZoom: 1.0,              // 0.5 to 2.0
    showFloatingText: true,       // floating damage/healing text
    screenShake: true             // screen shake effects
  },
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    textSize: 'medium',           // 'small' | 'medium' | 'large'
    colorBlindMode: 'none',       // 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
    fontFamily: 'default',        // 'default' | 'dyslexic' | 'monospace'
    lineSpacing: 'normal',        // 'compact' | 'normal' | 'relaxed'
    cursorSize: 'normal',         // 'small' | 'normal' | 'large'
    screenReaderHints: false      // enable screen reader hints
  },
  gameplay: {
    confirmTravel: false          // confirm before traveling
  },
  social: {
    showOnlineStatus: true,       // show online status to others
    allowPartyInvites: true,      // allow party invitations
    allowFriendRequests: true,    // allow friend requests
    chatTimestamps: true          // show timestamps in chat
  },
  developer: {
    enabled: false,               // master toggle for all debug features
    audio: {
      logMusicChanges: false,     // log when playing a new track
      logRegionInfo: false,       // log when building audio keys
      logSFXPlayback: false,      // log when playing sound effects
      logMissingAssets: true      // show "npm run audio:generate" messages (default ON)
    },
    network: {
      logAPIRequests: false,      // log HTTP requests/responses
      logWebSocketMessages: false // log WebSocket messages
    },
    state: {
      logStateChanges: false,     // log StateManager changes
      logSceneTransitions: false  // log scene enter/exit
    },
    battle: {
      logTurnEvents: false,       // log turn transitions
      logDamageCalculations: false, // show damage formula breakdowns
      logAIDecisions: false       // show AI decision making
    },
    performance: {
      showFPS: false,             // show FPS counter overlay
      logSlowFrames: false        // log frames >32ms
    }
  }
};

// Maximum allowed size for settings JSON (16KB)
const MAX_SETTINGS_SIZE = 16 * 1024;

// Keys to skip for security (prototype pollution prevention)
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Prune an object to only include keys that exist in a schema.
 * Prevents storing arbitrary unknown keys that could accumulate indefinitely.
 *
 * @param {Object} input - Input object to prune
 * @param {Object} schema - Schema defining allowed keys (DEFAULT_SETTINGS)
 * @returns {Object} Pruned object containing only known keys
 */
function pruneToSchema(input, schema) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {};
  }

  const result = {};

  for (const key of Object.keys(input)) {
    // Skip dangerous keys (prototype pollution)
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }

    // Only include keys that exist in the schema
    if (!(key in schema)) {
      continue;
    }

    const schemaValue = schema[key];
    const inputValue = input[key];

    // If schema value is an object, recurse and prune nested structure
    if (schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)) {
      // Input must also be an object for nested structure
      if (inputValue && typeof inputValue === 'object' && !Array.isArray(inputValue)) {
        result[key] = pruneToSchema(inputValue, schemaValue);
      }
      // Otherwise skip (don't include non-object for object schema)
    } else {
      // For primitive values, just copy if present
      if (inputValue !== undefined) {
        result[key] = inputValue;
      }
    }
  }

  return result;
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object to merge
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    // Skip dangerous keys
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }

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

    if (settings.battle.battleLogPosition !== undefined) {
      const validPositions = ['left', 'right', 'bottom'];
      if (!validPositions.includes(settings.battle.battleLogPosition)) {
        return { valid: false, error: `battleLogPosition must be one of: ${validPositions.join(', ')}` };
      }
    }

    const battleBooleanFields = ['showDamageNumbers', 'showBattleGrid', 'autoEndTurn', 'confirmEndTurn', 'showDamagePreview', 'showMissChance', 'battleLogVisible'];
    for (const field of battleBooleanFields) {
      if (settings.battle[field] !== undefined && typeof settings.battle[field] !== 'boolean') {
        return { valid: false, error: `battle.${field} must be a boolean` };
      }
    }
  }

  // Validate audio settings if present
  if (settings.audio) {
    if (typeof settings.audio !== 'object') {
      return { valid: false, error: 'audio settings must be an object' };
    }

    const volumeFields = ['masterVolume', 'musicVolume', 'sfxVolume', 'uiVolume'];
    for (const field of volumeFields) {
      if (settings.audio[field] !== undefined) {
        const value = settings.audio[field];
        if (typeof value !== 'number' || value < 0 || value > 100) {
          return { valid: false, error: `${field} must be a number between 0 and 100` };
        }
      }
    }

    const audioBooleanFields = ['muted', 'musicEnabled', 'sfxEnabled', 'ambientEnabled'];
    for (const field of audioBooleanFields) {
      if (settings.audio[field] !== undefined && typeof settings.audio[field] !== 'boolean') {
        return { valid: false, error: `audio.${field} must be a boolean` };
      }
    }
  }

  // Validate display settings if present
  if (settings.display) {
    if (typeof settings.display !== 'object') {
      return { valid: false, error: 'display settings must be an object' };
    }

    if (settings.display.animationSpeed !== undefined) {
      const validSpeeds = ['slow', 'normal', 'fast'];
      if (!validSpeeds.includes(settings.display.animationSpeed)) {
        return { valid: false, error: `animationSpeed must be one of: ${validSpeeds.join(', ')}` };
      }
    }

    // Validate zoom range
    if (settings.display.cameraZoom !== undefined) {
      const value = settings.display.cameraZoom;
      if (typeof value !== 'number' || value < 0.5 || value > 2.0) {
        return { valid: false, error: 'cameraZoom must be a number between 0.5 and 2.0' };
      }
    }

    const displayBooleanFields = ['showFloatingText', 'screenShake'];
    for (const field of displayBooleanFields) {
      if (settings.display[field] !== undefined && typeof settings.display[field] !== 'boolean') {
        return { valid: false, error: `display.${field} must be a boolean` };
      }
    }
  }

  // Validate accessibility settings if present
  if (settings.accessibility) {
    if (typeof settings.accessibility !== 'object') {
      return { valid: false, error: 'accessibility settings must be an object' };
    }

    if (settings.accessibility.textSize !== undefined) {
      const validSizes = ['small', 'medium', 'large'];
      if (!validSizes.includes(settings.accessibility.textSize)) {
        return { valid: false, error: `textSize must be one of: ${validSizes.join(', ')}` };
      }
    }

    if (settings.accessibility.colorBlindMode !== undefined) {
      const validModes = ['none', 'protanopia', 'deuteranopia', 'tritanopia'];
      if (!validModes.includes(settings.accessibility.colorBlindMode)) {
        return { valid: false, error: `colorBlindMode must be one of: ${validModes.join(', ')}` };
      }
    }

    if (settings.accessibility.fontFamily !== undefined) {
      const validFonts = ['default', 'dyslexic', 'monospace'];
      if (!validFonts.includes(settings.accessibility.fontFamily)) {
        return { valid: false, error: `fontFamily must be one of: ${validFonts.join(', ')}` };
      }
    }

    if (settings.accessibility.lineSpacing !== undefined) {
      const validSpacing = ['compact', 'normal', 'relaxed'];
      if (!validSpacing.includes(settings.accessibility.lineSpacing)) {
        return { valid: false, error: `lineSpacing must be one of: ${validSpacing.join(', ')}` };
      }
    }

    if (settings.accessibility.cursorSize !== undefined) {
      const validSizes = ['small', 'normal', 'large'];
      if (!validSizes.includes(settings.accessibility.cursorSize)) {
        return { valid: false, error: `cursorSize must be one of: ${validSizes.join(', ')}` };
      }
    }

    const accessibilityBooleanFields = ['highContrast', 'reducedMotion', 'screenReaderHints'];
    for (const field of accessibilityBooleanFields) {
      if (settings.accessibility[field] !== undefined && typeof settings.accessibility[field] !== 'boolean') {
        return { valid: false, error: `accessibility.${field} must be a boolean` };
      }
    }
  }

  // Validate gameplay settings if present
  if (settings.gameplay) {
    if (typeof settings.gameplay !== 'object') {
      return { valid: false, error: 'gameplay settings must be an object' };
    }

    const gameplayBooleanFields = ['confirmTravel'];
    for (const field of gameplayBooleanFields) {
      if (settings.gameplay[field] !== undefined && typeof settings.gameplay[field] !== 'boolean') {
        return { valid: false, error: `gameplay.${field} must be a boolean` };
      }
    }
  }

  // Validate social settings if present
  if (settings.social) {
    if (typeof settings.social !== 'object') {
      return { valid: false, error: 'social settings must be an object' };
    }

    const socialBooleanFields = ['showOnlineStatus', 'allowPartyInvites', 'allowFriendRequests', 'chatTimestamps'];
    for (const field of socialBooleanFields) {
      if (settings.social[field] !== undefined && typeof settings.social[field] !== 'boolean') {
        return { valid: false, error: `social.${field} must be a boolean` };
      }
    }
  }

  // Validate developer settings if present
  if (settings.developer) {
    if (typeof settings.developer !== 'object') {
      return { valid: false, error: 'developer settings must be an object' };
    }

    // SECURITY: Block developer mode from being enabled in production
    if (isProduction && settings.developer.enabled === true) {
      console.warn('[SECURITY] Attempted to enable developer mode in production');
      return { valid: false, error: 'Developer mode cannot be enabled in production' };
    }

    // Validate enabled (master toggle)
    if (settings.developer.enabled !== undefined && typeof settings.developer.enabled !== 'boolean') {
      return { valid: false, error: 'developer.enabled must be a boolean' };
    }

    // Validate audio debug settings
    if (settings.developer.audio) {
      if (typeof settings.developer.audio !== 'object') {
        return { valid: false, error: 'developer.audio settings must be an object' };
      }
      const audioBooleanFields = ['logMusicChanges', 'logRegionInfo', 'logSFXPlayback', 'logMissingAssets'];
      for (const field of audioBooleanFields) {
        if (settings.developer.audio[field] !== undefined && typeof settings.developer.audio[field] !== 'boolean') {
          return { valid: false, error: `developer.audio.${field} must be a boolean` };
        }
      }
    }

    // Validate network debug settings
    if (settings.developer.network) {
      if (typeof settings.developer.network !== 'object') {
        return { valid: false, error: 'developer.network settings must be an object' };
      }
      const networkBooleanFields = ['logAPIRequests', 'logWebSocketMessages'];
      for (const field of networkBooleanFields) {
        if (settings.developer.network[field] !== undefined && typeof settings.developer.network[field] !== 'boolean') {
          return { valid: false, error: `developer.network.${field} must be a boolean` };
        }
      }
    }

    // Validate state debug settings
    if (settings.developer.state) {
      if (typeof settings.developer.state !== 'object') {
        return { valid: false, error: 'developer.state settings must be an object' };
      }
      const stateBooleanFields = ['logStateChanges', 'logSceneTransitions'];
      for (const field of stateBooleanFields) {
        if (settings.developer.state[field] !== undefined && typeof settings.developer.state[field] !== 'boolean') {
          return { valid: false, error: `developer.state.${field} must be a boolean` };
        }
      }
    }

    // Validate battle debug settings
    if (settings.developer.battle) {
      if (typeof settings.developer.battle !== 'object') {
        return { valid: false, error: 'developer.battle settings must be an object' };
      }
      const battleBooleanFields = ['logTurnEvents', 'logDamageCalculations', 'logAIDecisions'];
      for (const field of battleBooleanFields) {
        if (settings.developer.battle[field] !== undefined && typeof settings.developer.battle[field] !== 'boolean') {
          return { valid: false, error: `developer.battle.${field} must be a boolean` };
        }
      }
    }

    // Validate performance debug settings
    if (settings.developer.performance) {
      if (typeof settings.developer.performance !== 'object') {
        return { valid: false, error: 'developer.performance settings must be an object' };
      }
      const performanceBooleanFields = ['showFPS', 'logSlowFrames'];
      for (const field of performanceBooleanFields) {
        if (settings.developer.performance[field] !== undefined && typeof settings.developer.performance[field] !== 'boolean') {
          return { valid: false, error: `developer.performance.${field} must be a boolean` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Sanitize settings for production - ensures developer mode is always disabled
 * @param {Object} settings - Settings object
 * @returns {Object} Sanitized settings
 */
function sanitizeSettingsForProduction(settings) {
  if (!isProduction) {
    return settings;
  }

  // Force developer mode off in production
  return {
    ...settings,
    developer: {
      ...DEFAULT_SETTINGS.developer,
      enabled: false
    }
  };
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

    return res.json({
      settings: sanitizeSettingsForProduction(insertResult.rows[0].settings)
    });
  }

  res.json({
    settings: sanitizeSettingsForProduction(result.rows[0].settings)
  });
}));

// PUT /api/settings - Update user settings (deep merge)
router.put('/', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const newSettings = req.body;

  // SECURITY: In production, strip all developer settings from the request
  // This prevents any attempt to modify developer settings via API
  if (isProduction && newSettings.developer) {
    console.warn(`[SECURITY] User ${userId} attempted to modify developer settings in production`);
    delete newSettings.developer;
  }

  // Prune incoming settings to only include known keys
  const prunedNewSettings = pruneToSchema(newSettings, DEFAULT_SETTINGS);

  // Validate pruned settings
  const validation = validateSettings(prunedNewSettings);
  if (!validation.valid) {
    throw new AppError(validation.error, 400);
  }

  // Get existing settings or use defaults
  const existingResult = await query(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    [userId]
  );

  // Start from defaults, then apply pruned existing settings (cleans up old junk keys)
  let currentSettings = DEFAULT_SETTINGS;
  if (existingResult.rows.length > 0) {
    const prunedExisting = pruneToSchema(existingResult.rows[0].settings, DEFAULT_SETTINGS);
    currentSettings = deepMerge(DEFAULT_SETTINGS, prunedExisting);
  }

  // Deep merge pruned new settings into existing
  let mergedSettings = deepMerge(currentSettings, prunedNewSettings);

  // SECURITY: Ensure developer mode is always disabled in production
  if (isProduction) {
    mergedSettings = sanitizeSettingsForProduction(mergedSettings);
  }

  // Safety net: reject if settings are too large
  const settingsJson = JSON.stringify(mergedSettings);
  if (settingsJson.length > MAX_SETTINGS_SIZE) {
    throw new AppError(`Settings exceed maximum allowed size (${MAX_SETTINGS_SIZE} bytes)`, 400);
  }

  // Upsert the settings
  const result = await query(
    `INSERT INTO user_settings (user_id, settings)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET settings = $2, updated_at = CURRENT_TIMESTAMP
     RETURNING settings`,
    [userId, JSON.stringify(mergedSettings)]
  );

  // Clear userSettingsService cache so privacy settings take effect immediately
  clearSettingsCache(userId);

  res.json({
    settings: sanitizeSettingsForProduction(result.rows[0].settings)
  });
}));

export default router;
