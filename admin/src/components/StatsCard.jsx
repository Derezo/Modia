/**
 * StatsCard - Individual statistic card component
 * Displays category name, progress bar, and count
 */

import {
  ImageIcon,
  PersonIcon,
  CubeIcon,
  MixerHorizontalIcon,
  GlobeIcon,
  LayersIcon,
  CheckCircledIcon,
  CrossCircledIcon,
} from '@radix-ui/react-icons';

// Map category names to icons
const categoryIcons = {
  tiles: ImageIcon,
  portraits: PersonIcon,
  items: CubeIcon,
  icons: MixerHorizontalIcon,
  nodes: GlobeIcon,
  overlays: LayersIcon,
};

// Map category names to display labels
const categoryLabels = {
  tiles: 'Battle Tiles',
  portraits: 'Character Portraits',
  items: 'Item Sprites',
  icons: 'UI Icons',
  nodes: 'Map Nodes',
  overlays: 'Overlays',
};

export default function StatsCard({ category, stats, onClick }) {
  const Icon = categoryIcons[category] || ImageIcon;
  const label = categoryLabels[category] || category;
  const { total, generated, pending, percentComplete } = stats;

  // Determine status color
  const getStatusColor = () => {
    if (percentComplete === 100) return 'text-accent-emerald';
    if (percentComplete >= 75) return 'text-accent-gold';
    if (percentComplete >= 50) return 'text-parchment-300';
    return 'text-accent-ruby';
  };

  const getProgressBarColor = () => {
    if (percentComplete === 100) return 'bg-accent-emerald';
    if (percentComplete >= 75) return 'bg-accent-gold';
    if (percentComplete >= 50) return 'bg-parchment-400';
    return 'bg-accent-ruby';
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="card-hover p-5 text-left w-full group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-midnight-800 rounded-lg group-hover:bg-midnight-700 transition-colors">
            <Icon className="w-5 h-5 text-accent-gold" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-parchment-100 capitalize">
              {label}
            </h3>
            <p className="text-sm text-parchment-400">
              {pending > 0 ? `${pending} pending` : 'Complete'}
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div className={`flex items-center gap-1 ${getStatusColor()}`}>
          {percentComplete === 100 ? (
            <CheckCircledIcon className="w-4 h-4" />
          ) : pending > 0 ? (
            <CrossCircledIcon className="w-4 h-4" />
          ) : null}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="h-2 bg-midnight-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${getProgressBarColor()}`}
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-parchment-300">
          <span className="font-semibold text-parchment-100">{generated}</span>
          {' / '}
          <span>{total}</span>
        </span>
        <span className={`font-semibold ${getStatusColor()}`}>
          {percentComplete}%
        </span>
      </div>
    </button>
  );
}
