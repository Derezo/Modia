/**
 * Waveform Generator
 * Generates waveform peak data for audio visualization using ffmpeg
 *
 * @module waveformGenerator
 * @see adminAudio.js - Uses waveform data for frontend visualization
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, fileExists } = require('./audioUtils');

// Default configuration
const DEFAULT_CONFIG = {
  barCount: 150,     // Number of peaks to extract
  sampleRate: 8000,  // Lower sample rate for faster processing
  channels: 1        // Mono for simplicity
};

/**
 * Generate waveform peaks from an audio file using ffmpeg
 * Extracts PCM data and downsamples to specified number of peaks
 *
 * @param {string} audioPath - Path to the audio file
 * @param {number} [barCount=150] - Number of peaks to extract
 * @returns {Promise<number[]>} Array of peak values (0-1 normalized)
 */
async function generateWaveformPeaks(audioPath, barCount = DEFAULT_CONFIG.barCount) {
  if (!fileExists(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  return new Promise((resolve, reject) => {
    // Use ffmpeg to extract raw PCM audio data
    // -i: input file
    // -f: output format (signed 16-bit little-endian)
    // -ac: audio channels (mono)
    // -ar: sample rate
    // -: output to stdout
    const ffmpeg = spawn('ffmpeg', [
      '-i', audioPath,
      '-f', 's16le',
      '-ac', String(DEFAULT_CONFIG.channels),
      '-ar', String(DEFAULT_CONFIG.sampleRate),
      '-v', 'quiet',
      '-'
    ]);

    const chunks = [];

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (data) => {
      // ffmpeg outputs progress to stderr, ignore it
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }

      const pcmData = Buffer.concat(chunks);
      const peaks = extractPeaks(pcmData, barCount);
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
function extractPeaks(pcmData, barCount) {
  // Each sample is 2 bytes (16-bit)
  const sampleCount = pcmData.length / 2;

  if (sampleCount === 0) {
    return new Array(barCount).fill(0);
  }

  // Calculate samples per bar
  const samplesPerBar = Math.floor(sampleCount / barCount);

  if (samplesPerBar === 0) {
    // Not enough samples for the requested bar count
    // Just return what we have, padded with zeros
    const peaks = [];
    for (let i = 0; i < sampleCount; i++) {
      const sample = pcmData.readInt16LE(i * 2);
      peaks.push(Math.abs(sample) / 32768);
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

    // Normalize to 0-1 range (16-bit max is 32768)
    peaks.push(maxValue / 32768);
  }

  return peaks;
}

/**
 * Generate waveform and return as object suitable for JSON storage
 * @param {string} audioPath - Path to the audio file
 * @param {number} [barCount=150] - Number of peaks
 * @returns {Promise<object>} { peaks: number[], version: number }
 */
async function generateWaveformData(audioPath, barCount = DEFAULT_CONFIG.barCount) {
  const peaks = await generateWaveformPeaks(audioPath, barCount);

  // Round to 3 decimal places to reduce JSON size
  const roundedPeaks = peaks.map(p => Math.round(p * 1000) / 1000);

  return {
    peaks: roundedPeaks,
    version: 1,
    barCount: roundedPeaks.length,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Check if ffmpeg is available
 * @returns {Promise<boolean>}
 */
async function checkFfmpegAvailable() {
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

module.exports = {
  generateWaveformPeaks,
  generateWaveformData,
  checkFfmpegAvailable,
  DEFAULT_CONFIG
};
