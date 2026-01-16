/**
 * Audio Generation Library
 * Exports all utility modules for audio generation scripts
 */

const { SunoClient, STATUS: SUNO_STATUS, DEFAULT_CONFIG: SUNO_CONFIG } = require('./sunoClient');
const { ElevenLabsSFXGenerator, DEFAULT_CONFIG: ELEVENLABS_CONFIG } = require('./elevenlabsClient');
const {
  buildMusicPrompt,
  buildSkillSFXPrompt,
  buildCombatSFXPrompt,
  buildAmbientPrompt,
  buildUISFXPrompt,
  REGION_THEMES,
  SKILL_SFX_TEMPLATES,
  BATTLE_MOODS
} = require('./promptBuilder');
const {
  ensureDirectoryExists,
  fileExists,
  delay,
  loadMetadata,
  saveMetadata,
  getTimestamp,
  log,
  formatBytes,
  isValidAudioFormat,
  sanitizeFilename
} = require('./audioUtils');

module.exports = {
  // Clients
  SunoClient,
  ElevenLabsSFXGenerator,

  // Status constants
  SUNO_STATUS,

  // Config defaults
  SUNO_CONFIG,
  ELEVENLABS_CONFIG,

  // Prompt builders
  buildMusicPrompt,
  buildSkillSFXPrompt,
  buildCombatSFXPrompt,
  buildAmbientPrompt,
  buildUISFXPrompt,

  // Prompt templates
  REGION_THEMES,
  SKILL_SFX_TEMPLATES,
  BATTLE_MOODS,

  // Utilities
  ensureDirectoryExists,
  fileExists,
  delay,
  loadMetadata,
  saveMetadata,
  getTimestamp,
  log,
  formatBytes,
  isValidAudioFormat,
  sanitizeFilename
};
