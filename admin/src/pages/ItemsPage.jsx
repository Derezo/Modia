/**
 * ItemsPage - Manage item sprites
 */

import { CubeIcon } from '@radix-ui/react-icons';

export default function ItemsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-midnight-800 rounded-lg">
          <CubeIcon className="w-6 h-6 text-accent-gold" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-parchment-100">Items</h1>
          <p className="text-parchment-400">Equipment, weapons, armor, and consumable item sprites</p>
        </div>
      </div>

      <div className="card p-8 text-center">
        <p className="text-parchment-400 mb-4">
          Item sprite management interface coming soon.
        </p>
        <p className="text-parchment-500 text-sm">
          This page will include category filtering, item preview grid, and generation controls.
        </p>
      </div>
    </div>
  );
}
