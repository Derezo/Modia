/**
 * WaveformDisplay - Canvas-based waveform visualization
 * Renders an array of peak values as vertical bars with playback position indicator.
 *
 * @module WaveformDisplay
 * @description Visualizes audio waveform data for preview thumbnails and detail views.
 */

import { useRef, useEffect, useMemo, memo } from 'react';

/**
 * Default color configuration using Modia theme
 */
const DEFAULT_COLORS = {
  background: 'transparent',
  waveform: '#d4a44a', // accent-gold
  waveformPlayed: '#2e8b57', // accent-emerald
  progress: '#f5f0e8', // parchment-100
};

/**
 * WaveformDisplay component for audio visualization
 *
 * @param {Object} props - Component props
 * @param {number[]} props.peaks - Array of peak values (0-1 range)
 * @param {number} [props.progress=0] - Playback progress (0-1 range)
 * @param {number} [props.height=48] - Canvas height in pixels
 * @param {string} [props.className] - Additional CSS classes
 * @param {Object} [props.colors] - Custom color overrides
 * @param {boolean} [props.showProgress=true] - Whether to show progress indicator
 * @param {number} [props.barWidth=2] - Width of each bar in pixels
 * @param {number} [props.barGap=1] - Gap between bars in pixels
 */
const WaveformDisplay = memo(function WaveformDisplay({
  peaks = [],
  progress = 0,
  height = 48,
  className = '',
  colors = {},
  showProgress = true,
  barWidth = 2,
  barGap = 1,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Merge custom colors with defaults - memoize to prevent effect re-runs
  const mergedColors = useMemo(
    () => ({ ...DEFAULT_COLORS, ...colors }),
    [colors]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    const rect = container.getBoundingClientRect();
    const width = rect.width;

    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // If no peaks, draw placeholder bars
    const peakData = peaks.length > 0 ? peaks : generatePlaceholderPeaks(50);

    // Calculate number of bars that fit
    const totalBarWidth = barWidth + barGap;
    const numBars = Math.floor(width / totalBarWidth);

    // Resample peaks to match available bars
    const resampledPeaks = resamplePeaks(peakData, numBars);

    // Calculate progress position
    const progressX = showProgress ? width * Math.min(1, Math.max(0, progress)) : 0;

    // Draw waveform bars
    const centerY = height / 2;
    const maxBarHeight = height * 0.8;

    resampledPeaks.forEach((peak, i) => {
      const x = i * totalBarWidth;
      const barHeight = Math.max(2, peak * maxBarHeight);
      const y = centerY - barHeight / 2;

      // Color based on playback position
      const isPlayed = showProgress && x < progressX;
      ctx.fillStyle = isPlayed ? mergedColors.waveformPlayed : mergedColors.waveform;

      // Draw rounded bar
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1);
      ctx.fill();
    });

    // Draw progress line
    if (showProgress && progress > 0 && progress < 1) {
      ctx.strokeStyle = mergedColors.progress;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(progressX, 0);
      ctx.lineTo(progressX, height);
      ctx.stroke();
    }
  }, [peaks, progress, height, mergedColors, showProgress, barWidth, barGap]);

  return (
    <div ref={containerRef} className={`w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: `${height}px` }}
      />
    </div>
  );
});

/**
 * Resample peaks array to a target number of samples
 * Uses linear interpolation for smooth downsampling
 */
function resamplePeaks(peaks, targetCount) {
  if (peaks.length === 0) return new Array(targetCount).fill(0.3);
  if (peaks.length === targetCount) return peaks;

  const result = [];
  const ratio = peaks.length / targetCount;

  for (let i = 0; i < targetCount; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, peaks.length - 1);
    const fraction = srcIndex - srcIndexFloor;

    // Linear interpolation
    const value = peaks[srcIndexFloor] * (1 - fraction) + peaks[srcIndexCeil] * fraction;
    result.push(value);
  }

  return result;
}

/**
 * Generate placeholder peaks for empty waveform display
 */
function generatePlaceholderPeaks(count) {
  const peaks = [];
  for (let i = 0; i < count; i++) {
    // Create a gentle wave pattern
    peaks.push(0.2 + Math.sin(i * 0.3) * 0.1);
  }
  return peaks;
}

export default WaveformDisplay;
