/**
 * Shared utilities for admin generation services
 * Used by both adminGenerationService.js (images) and adminAudioGenerationService.js (audio)
 *
 * @module generationUtils
 */

/**
 * Generate unique job ID with customizable prefix
 * @param {string} prefix - Job ID prefix (default: 'job')
 * @returns {string} Unique job ID in format: {prefix}_{timestamp}_{random}
 */
export function generateJobId(prefix = 'job') {
  const randomSuffix = Math.random().toString(36).substring(2, 11);
  return `${prefix}_${Date.now()}_${randomSuffix}`;
}

/**
 * Parse progress line from generation script stdout
 *
 * Common patterns matched:
 * - [X/Y] - Asset progress (e.g., "[1/10] Generating: asset_name")
 * - Saved: path - File saved (with configurable extension)
 * - Generated: asset - Asset generated
 *
 * @param {string} line - Stdout line to parse
 * @param {Object} options - Parsing options
 * @param {string} options.fileExtension - File extension for 'Saved' pattern (default: 'png')
 * @param {Array<{regex: RegExp, processor: Function}>} options.extraPatterns - Additional patterns
 * @returns {Object|null} Parsed progress object or null if no pattern matched
 *
 * @example
 * // Basic usage for images
 * parseProgress('[1/10] Generating: portrait', { fileExtension: 'png' })
 * // Returns: { type: 'asset', current: 1, total: 10 }
 *
 * @example
 * // With extra patterns for audio
 * parseProgress('Queued: task_123', {
 *   extraPatterns: [
 *     { regex: /Queued:\s*(\S+)/i, processor: (m) => ({ type: 'queued', taskId: m[1] }) }
 *   ]
 * })
 * // Returns: { type: 'queued', taskId: 'task_123' }
 */
export function parseProgress(line, options = {}) {
  const { fileExtension = 'png', extraPatterns = [] } = options;

  // Match [X/Y] pattern for asset progress
  const assetMatch = line.match(/\[(\d+)\/(\d+)\]/);
  if (assetMatch) {
    return {
      type: 'asset',
      current: parseInt(assetMatch[1], 10),
      total: parseInt(assetMatch[2], 10)
    };
  }

  // Match Saved: path pattern for completed file
  const savedRegex = new RegExp(`Saved:\\s*(.+\\.${fileExtension})`, 'i');
  const savedMatch = line.match(savedRegex);
  if (savedMatch) {
    return { type: 'saved', path: savedMatch[1] };
  }

  // Match Generated: asset pattern
  const generatedMatch = line.match(/Generated:\s*(\S+)/i);
  if (generatedMatch) {
    return { type: 'generated', asset: generatedMatch[1] };
  }

  // Service-specific patterns
  for (const pattern of extraPatterns) {
    const match = line.match(pattern.regex);
    if (match) {
      return pattern.processor(match);
    }
  }

  return null;
}

/**
 * Parse step progress from stdout line (image generation specific)
 * Matches "Progress: X/Y steps" pattern
 *
 * @param {string} line - Stdout line to parse
 * @returns {Object|null} Step progress or null
 */
export function parseStepProgress(line) {
  const stepMatch = line.match(/Progress:\s*(\d+)\/(\d+)\s*steps/i);
  if (stepMatch) {
    return {
      type: 'step',
      current: parseInt(stepMatch[1], 10),
      total: parseInt(stepMatch[2], 10)
    };
  }
  return null;
}

export default {
  generateJobId,
  parseProgress,
  parseStepProgress
};
