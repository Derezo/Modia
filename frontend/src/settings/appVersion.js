/**
 * @module appVersion
 * @description The game client version, injected at build time from the root
 * package.json via the Vite `define` in frontend/vite.config.js.
 *
 * Falls back to 'dev' when the module is loaded outside Vite (e.g. node --test).
 */
/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
