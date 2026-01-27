/**
 * API Client for Admin Dashboard
 *
 * This file re-exports from the modular API for backward compatibility.
 * For new code, import directly from './api/index' or specific modules.
 *
 * @see ./api/index.js - Unified exports
 * @see ./api/assets.js - Image asset operations
 * @see ./api/audio.js - Audio asset operations
 * @see ./api/generation.js - Generation queue
 * @see ./api/backups.js - Backup management
 * @see ./api/theme.js - Theme configuration
 */

export { api, api as default } from './api/index';
