/**
 * Waveform Generator Utilities
 * Generates waveform peak data for audio visualization.
 *
 * @module waveformGenerator
 * @description Provides real ffmpeg-based waveform generation and fallback
 * pseudo-waveform for when ffmpeg is unavailable.
 *
 * @see adminAudio.js - Routes that use waveform data
 * @see scripts/audio/lib/waveformGenerator.js - Lower-level ffmpeg wrapper
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';

/**
 * Check if ffmpeg is available on the system
 * @returns {Promise<boolean>} True if ffmpeg is available
 */
export async function isFFmpegAvailable() {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version']);

    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });

    ffmpeg.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Generate waveform peaks from an audio file using ffmpeg
 * @param {string} audioPath - Path to the audio file
 * @param {number} [barCount=100] - Number of peaks to generate
 * @returns {Promise<number[]>} Array of normalized peak values (0-1)
 * @throws {Error} If audio file not found or ffmpeg fails
 */
export async function generateWaveformWithFFmpeg(audioPath, barCount = 100) {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  return new Promise((resolve, reject) => {
    // Use ffmpeg to extract raw PCM audio data
    const ffmpeg = spawn('ffmpeg', [
      '-i', audioPath,
      '-f', 's16le',      // 16-bit signed little-endian
      '-ac', '1',         // Mono
      '-ar', '8000',      // 8kHz sample rate for faster processing
      '-v', 'quiet',
      '-'                 // Output to stdout
    ]);

    const chunks = [];

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }

      const pcmData = Buffer.concat(chunks);
      const peaks = extractPeaksFromPCM(pcmData, barCount);
      resolve(peaks);
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`ffmpeg error: ${err.message}`));
    });
  });
}

/**
 * Extract peak values from PCM data
 * @param {Buffer} pcmData - Raw PCM audio data (16-bit signed, little-endian)
 * @param {number} barCount - Number of peaks to extract
 * @returns {number[]} Normalized peak values (0-1)
 */
function extractPeaksFromPCM(pcmData, barCount) {
  const sampleCount = pcmData.length / 2; // 2 bytes per 16-bit sample

  if (sampleCount === 0) {
    return new Array(barCount).fill(0);
  }

  const samplesPerBar = Math.floor(sampleCount / barCount);

  if (samplesPerBar === 0) {
    // Not enough samples - return what we have, padded with zeros
    const peaks = [];
    for (let i = 0; i < sampleCount; i++) {
      const sample = pcmData.readInt16LE(i * 2);
      peaks.push(Math.round(Math.abs(sample) / 32768 * 1000) / 1000);
    }
    while (peaks.length < barCount) {
      peaks.push(0);
    }
    return peaks;
  }

  const peaks = [];

  for (let bar = 0; bar < barCount; bar++) {
    const start = bar * samplesPerBar;
    const end = Math.min(start + samplesPerBar, sampleCount);

    let maxValue = 0;

    for (let i = start; i < end; i++) {
      const sample = Math.abs(pcmData.readInt16LE(i * 2));
      if (sample > maxValue) {
        maxValue = sample;
      }
    }

    // Normalize to 0-1 range and round to 3 decimal places
    peaks.push(Math.round(maxValue / 32768 * 1000) / 1000);
  }

  return peaks;
}

/**
 * Generate deterministic pseudo-waveform from a seed string.
 * Used as fallback when ffmpeg isn't available.
 * Creates a natural-looking waveform shape with envelope.
 *
 * @param {string} seed - Seed string (e.g., asset ID) for deterministic generation
 * @param {number} [barCount=100] - Number of peaks to generate
 * @returns {number[]} Array of pseudo-random peak values (0-1)
 */
export function generatePseudoWaveform(seed, barCount = 100) {
  // H1 FIX: Defensive null check for seed
  if (!seed || typeof seed !== 'string') {
    seed = 'fallback_' + Date.now();
  }

  // Simple seeded random using string hash
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  const peaks = [];
  for (let i = 0; i < barCount; i++) {
    // LCG random with seed variation per bar
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    const random = (hash % 1000) / 1000;

    // Create more natural looking waveform with envelope
    const position = i / barCount;
    const envelope = Math.sin(position * Math.PI) * 0.4 + 0.3;
    const value = 0.2 + random * envelope;

    peaks.push(Math.round(value * 1000) / 1000);
  }

  return peaks;
}

/**
 * Generate waveform data with automatic fallback to pseudo-waveform
 * @param {string} audioPath - Path to the audio file
 * @param {number} [barCount=100] - Number of peaks to generate
 * @returns {Promise<{ peaks: number[], isFallback: boolean }>}
 */
export async function generateWaveformWithFallback(audioPath, barCount = 100) {
  try {
    const peaks = await generateWaveformWithFFmpeg(audioPath, barCount);
    return { peaks, isFallback: false };
  } catch (err) {
    // Use filename or path as seed for pseudo-waveform
    const seed = audioPath.split('/').pop() || audioPath;
    const peaks = generatePseudoWaveform(seed, barCount);
    return { peaks, isFallback: true };
  }
}

export default {
  isFFmpegAvailable,
  generateWaveformWithFFmpeg,
  generatePseudoWaveform,
  generateWaveformWithFallback
};
