/**
 * Unified Asset Components
 *
 * Generic components for both image and audio asset management.
 * These components use configuration to adapt behavior for different asset types.
 */

// Configurations
export {
  IMAGE_FILTER_CONFIG,
  AUDIO_FILTER_CONFIG,
  STATUS_OPTIONS,
  GRID_CONFIG,
  CATEGORY_LABELS,
  getFilterConfig,
  getGridConfig,
  getStatusOptions,
  isAudioType,
  isImageType,
  getCategoryLabel,
} from './configs';

// Components
export { default as UnifiedFilterBar } from './UnifiedFilterBar';

// Note: Additional unified components will be added as the refactoring progresses:
// - UnifiedAssetCard - Generic card with render props for type-specific content
// - UnifiedAssetGrid - Generic grid container with virtualization
// - UnifiedDetailPanel - Generic detail slide-over panel
