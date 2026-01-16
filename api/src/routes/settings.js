import express from 'express';
import { query } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Default settings structure (7 categories, ~55 settings)
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
    uiScale: 1.0,                 // 0.75 to 1.5
    showFloatingText: true,       // floating damage/healing text
    particleQuality: 'high',      // 'low' | 'medium' | 'high'
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
    autoSave: true,               // auto-save progress
    confirmTravel: false,         // confirm before traveling
    showTutorialHints: true,      // show tutorial/help hints
    questMarkerStyle: 'icon'      // 'icon' | 'arrow' | 'both' | 'none'
  },
  controls: {
    keybindScheme: 'wasd',        // 'wasd' | 'arrows' | 'vim' | 'custom'
    touchGesturesEnabled: true,   // enable touch gestures on mobile
    doubleTapConfirm: true,       // require double-tap to confirm actions
    holdToCancel: true            // hold to cancel actions
  },
  social: {
    showOnlineStatus: true,       // show online status to others
    allowPartyInvites: true,      // allow party invitations
    allowFriendRequests: true,    // allow friend requests
    chatTimestamps: true,         // show timestamps in chat
    profanityFilter: true         // filter profanity in chat
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

    if (settings.display.particleQuality !== undefined) {
      const validQualities = ['low', 'medium', 'high'];
      if (!validQualities.includes(settings.display.particleQuality)) {
        return { valid: false, error: `particleQuality must be one of: ${validQualities.join(', ')}` };
      }
    }

    // Validate zoom/scale ranges
    if (settings.display.cameraZoom !== undefined) {
      const value = settings.display.cameraZoom;
      if (typeof value !== 'number' || value < 0.5 || value > 2.0) {
        return { valid: false, error: 'cameraZoom must be a number between 0.5 and 2.0' };
      }
    }

    if (settings.display.uiScale !== undefined) {
      const value = settings.display.uiScale;
      if (typeof value !== 'number' || value < 0.75 || value > 1.5) {
        return { valid: false, error: 'uiScale must be a number between 0.75 and 1.5' };
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

    if (settings.gameplay.questMarkerStyle !== undefined) {
      const validStyles = ['icon', 'arrow', 'both', 'none'];
      if (!validStyles.includes(settings.gameplay.questMarkerStyle)) {
        return { valid: false, error: `questMarkerStyle must be one of: ${validStyles.join(', ')}` };
      }
    }

    const gameplayBooleanFields = ['autoSave', 'confirmTravel', 'showTutorialHints'];
    for (const field of gameplayBooleanFields) {
      if (settings.gameplay[field] !== undefined && typeof settings.gameplay[field] !== 'boolean') {
        return { valid: false, error: `gameplay.${field} must be a boolean` };
      }
    }
  }

  // Validate controls settings if present
  if (settings.controls) {
    if (typeof settings.controls !== 'object') {
      return { valid: false, error: 'controls settings must be an object' };
    }

    if (settings.controls.keybindScheme !== undefined) {
      const validSchemes = ['wasd', 'arrows', 'vim', 'custom'];
      if (!validSchemes.includes(settings.controls.keybindScheme)) {
        return { valid: false, error: `keybindScheme must be one of: ${validSchemes.join(', ')}` };
      }
    }

    const controlsBooleanFields = ['touchGesturesEnabled', 'doubleTapConfirm', 'holdToCancel'];
    for (const field of controlsBooleanFields) {
      if (settings.controls[field] !== undefined && typeof settings.controls[field] !== 'boolean') {
        return { valid: false, error: `controls.${field} must be a boolean` };
      }
    }
  }

  // Validate social settings if present
  if (settings.social) {
    if (typeof settings.social !== 'object') {
      return { valid: false, error: 'social settings must be an object' };
    }

    const socialBooleanFields = ['showOnlineStatus', 'allowPartyInvites', 'allowFriendRequests', 'chatTimestamps', 'profanityFilter'];
    for (const field of socialBooleanFields) {
      if (settings.social[field] !== undefined && typeof settings.social[field] !== 'boolean') {
        return { valid: false, error: `social.${field} must be a boolean` };
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

export default router;
