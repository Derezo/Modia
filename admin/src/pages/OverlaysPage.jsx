/**
 * OverlaysPage - Manage overlay assets
 */

import { LayersIcon } from '@radix-ui/react-icons';

export default function OverlaysPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-midnight-800 rounded-lg">
          <LayersIcon className="w-6 h-6 text-accent-gold" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-parchment-100">Overlays</h1>
          <p className="text-parchment-400">Rarity overlays and augment effects</p>
        </div>
      </div>

      <div className="card p-8 text-center">
        <p className="text-parchment-400 mb-4">
          Overlay management interface coming soon.
        </p>
        <p className="text-parchment-500 text-sm">
          This page will include subcategory filtering, overlay preview grid, and generation controls.
        </p>
      </div>
    </div>
  );
}
