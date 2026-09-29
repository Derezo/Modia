/**
 * User Settings Service
 * Provides a cached getter for user settings with focus on social privacy settings
 */

import { query } from '../config/database.js';

// Default social settings (mirrors settings.js)
const DEFAULT_SOCIAL_SETTINGS = {
  showOnlineStatus: true,
  allowPartyInvites: true,
  allowFriendRequests: true,
  chatTimestamps: true
};

// In-memory cache with TTL for user social settings
// Key: userId, Value: { settings, cachedAt }
const socialSettingsCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Get a user's social settings
 * @param {number} userId - User ID
 * @returns {Promise<object>} Social settings merged with defaults
 */
export async function getSocialSettings(userId) {
  // Check cache first
  const cached = socialSettingsCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.settings;
  }

  // Query database
  const result = await query(
    `SELECT settings->'social' as social_settings
     FROM user_settings
     WHERE user_id = $1`,
    [userId]
  );

  let socialSettings;
  if (result.rows.length === 0 || !result.rows[0].social_settings) {
    socialSettings = { ...DEFAULT_SOCIAL_SETTINGS };
  } else {
    // Merge with defaults to ensure all fields exist
    socialSettings = {
      ...DEFAULT_SOCIAL_SETTINGS,
      ...result.rows[0].social_settings
    };
  }

  // Update cache
  socialSettingsCache.set(userId, {
    settings: socialSettings,
    cachedAt: Date.now()
  });

  return socialSettings;
}

/**
 * Clear cached settings for a user (call this when settings are updated)
 * @param {number} userId - User ID
 */
export function clearSettingsCache(userId) {
  socialSettingsCache.delete(userId);
}

/**
 * Check if a user allows friend requests
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Whether friend requests are allowed
 */
export async function allowsFriendRequests(userId) {
  const settings = await getSocialSettings(userId);
  return settings.allowFriendRequests !== false;
}

/**
 * Check if a user allows party invites
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Whether party invites are allowed
 */
export async function allowsPartyInvites(userId) {
  const settings = await getSocialSettings(userId);
  return settings.allowPartyInvites !== false;
}

/**
 * Check if a user shows their online status
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Whether online status should be visible
 */
export async function showsOnlineStatus(userId) {
  const settings = await getSocialSettings(userId);
  return settings.showOnlineStatus !== false;
}

export default {
  getSocialSettings,
  clearSettingsCache,
  allowsFriendRequests,
  allowsPartyInvites,
  showsOnlineStatus
};
