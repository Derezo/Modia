/**
 * Tile Generation Utilities - Main Export
 */

const palettes = require('./palettes');
const noise = require('./noise');
const canvas = require('./canvas');
const watercolor = require('./watercolor');

module.exports = {
  ...palettes,
  ...noise,
  ...canvas,
  ...watercolor
};
