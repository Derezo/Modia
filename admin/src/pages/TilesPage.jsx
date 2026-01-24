/**
 * TilesPage - Manage battle terrain tiles
 * Uses AssetGrid for browsing and bulk operations
 */

import { ImageIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function TilesPage() {
  return (
    <AssetGrid
      category="tiles"
      pageTitle="Tiles"
      pageDescription="Battle terrain tiles (floors, walls, slopes) across biomes"
      pageIcon={ImageIcon}
    />
  );
}
