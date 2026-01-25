/**
 * Audio Components - Barrel export file
 *
 * @module audio
 * @description Audio asset management components for the admin dashboard.
 *
 * Components:
 * - AudioGrid: Main grid component for audio asset display with filtering and bulk actions
 * - AudioDetail: Slide-over panel for viewing and editing audio asset details
 * - AudioCard: Grid card for audio asset display
 * - AudioPlayer: Playback controls with seek bar
 * - WaveformDisplay: Canvas-based waveform visualization
 * - AudioFilterBar: Filter controls for audio grids
 * - VariantSelector: Select primary variant from Suno generation
 * - PromptValidator: SFX prompt validation with comma checking
 * - PollingStatusCard: Generation progress display
 */

export { default as AudioGrid } from './AudioGrid';
export { default as AudioDetail } from './AudioDetail';
export { default as AudioCard } from './AudioCard';
export { default as AudioPlayer } from './AudioPlayer';
export { default as WaveformDisplay } from './WaveformDisplay';
export { default as AudioFilterBar } from './AudioFilterBar';
export { default as VariantSelector } from './VariantSelector';
export { default as PromptValidator } from './PromptValidator';
export { default as PollingStatusCard } from './PollingStatusCard';
