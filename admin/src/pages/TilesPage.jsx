/**
 * TilesPage - Manage battle terrain tiles
 */

import { ImageIcon } from '@radix-ui/react-icons';

export default function TilesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-midnight-800 rounded-lg">
          <ImageIcon className="w-6 h-6 text-accent-gold" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-parchment-100">Tiles</h1>
          <p className="text-parchment-400">Battle terrain tiles (floors, walls, slopes) across biomes</p>
        </div>
      </div>

      <div className="card p-8 text-center">
        <p className="text-parchment-400 mb-4">
          Tile management interface coming soon.
        </p>
        <p className="text-parchment-500 text-sm">
          This page will include biome filtering, tile preview grid, and generation controls.
        </p>
      </div>
    </div>
  );
}
