/**
 * Audio Duration Extraction Utilities
 * Extract actual audio duration using FFprobe with fallback estimation.
 *
 * @module audioDurationExtractor
 * @description Provides functions to extract audio file duration using FFprobe,
 * with a file-size-based fallback for cases where FFprobe is unavailable.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat, access, constants } from 'fs/promises';

const execFileAsync = promisify(execFile);

/**
 * Average bytes per second for MP3 at 128kbps
 * 128 kbps = 16 KB/s = 16384 bytes/second
 */
const MP3_BYTES_PER_SECOND_128KBPS = 16384;

/**
 * Extract audio duration using FFprobe
 *
 * @param {string} audioPath - Absolute path to the audio file
 * @returns {Promise<number>} Duration in seconds as a float
 * @throws {Error} If file doesn't exist or FFprobe fails
 *
 * @example
 * const duration = await extractDurationWithFFprobe('/path/to/audio.mp3');
 * console.log(`Duration: ${duration} seconds`);
 */
export async function extractDurationWithFFprobe(audioPath) {
  // Validate input
  if (!audioPath || typeof audioPath !== 'string') {
    throw new Error('Audio path is required and must be a string');
  }

  // Check if file exists and is readable
  try {
    await access(audioPath, constants.R_OK);
  } catch {
    throw new Error(`Audio file not found or not readable: ${audioPath}`);
  }

  // Run FFprobe to extract duration
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath
    ]);

    // Parse the duration from stdout
    const durationStr = stdout.trim();

    if (!durationStr) {
      throw new Error(`FFprobe returned empty duration for: ${audioPath}`);
    }

    const duration = parseFloat(durationStr);

    if (isNaN(duration) || duration < 0) {
      throw new Error(`FFprobe returned invalid duration "${durationStr}" for: ${audioPath}`);
    }

    return duration;
  } catch (error) {
    // Re-throw our custom errors
    if (error.message.includes('FFprobe returned')) {
      throw error;
    }

    // Handle FFprobe not found
    if (error.code === 'ENOENT') {
      throw new Error('FFprobe is not installed or not in PATH');
    }

    // Handle FFprobe execution errors
    throw new Error(`FFprobe failed for ${audioPath}: ${error.message}`);
  }
}

/**
 * Estimate audio duration from file size
 * Uses rough estimation for MP3: ~1 second per 16KB at 128kbps
 *
 * @param {string} audioPath - Absolute path to the audio file
 * @returns {Promise<number>} Estimated duration in seconds
 * @throws {Error} If file doesn't exist or stat fails
 */
async function estimateDurationFromFileSize(audioPath) {
  const stats = await stat(audioPath);
  const fileSizeBytes = stats.size;

  // Estimate duration based on typical MP3 bitrate (128kbps)
  const estimatedDuration = fileSizeBytes / MP3_BYTES_PER_SECOND_128KBPS;

  return estimatedDuration;
}

/**
 * Extract audio duration with fallback to file size estimation
 *
 * Attempts FFprobe first for accurate duration. If FFprobe fails,
 * falls back to estimating duration from file size (assuming 128kbps MP3).
 *
 * @param {string} audioPath - Absolute path to the audio file
 * @returns {Promise<number|null>} Duration in seconds, or null if both methods fail
 *
 * @example
 * const duration = await extractDurationWithFallback('/path/to/audio.mp3');
 * if (duration !== null) {
 *   console.log(`Duration: ${duration} seconds`);
 * } else {
 *   console.log('Could not determine duration');
 * }
 */
export async function extractDurationWithFallback(audioPath) {
  // Validate input
  if (!audioPath || typeof audioPath !== 'string') {
    console.warn('[audioDurationExtractor] Invalid audio path provided');
    return null;
  }

  // Try FFprobe first
  try {
    const duration = await extractDurationWithFFprobe(audioPath);
    return duration;
  } catch (ffprobeError) {
    console.warn(
      `[audioDurationExtractor] FFprobe failed for ${audioPath}: ${ffprobeError.message}. ` +
      'Falling back to file size estimation.'
    );
  }

  // Fallback to file size estimation
  try {
    const estimatedDuration = await estimateDurationFromFileSize(audioPath);
    console.warn(
      `[audioDurationExtractor] Using estimated duration (${estimatedDuration.toFixed(2)}s) ` +
      `based on file size for: ${audioPath}. Accuracy may vary based on actual bitrate.`
    );
    return estimatedDuration;
  } catch (statError) {
    console.warn(
      `[audioDurationExtractor] File size estimation failed for ${audioPath}: ${statError.message}`
    );
    return null;
  }
}

export default {
  extractDurationWithFFprobe,
  extractDurationWithFallback
};
