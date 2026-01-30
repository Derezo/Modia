/**
 * ObstaclesPage - Manage battle environment obstacles
 * Uses AssetGrid for browsing and bulk operations
 */

import { BoxModelIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function ObstaclesPage() {
  return (
    <AssetGrid
      category="obstacles"
      pageTitle="Obstacles"
      pageDescription="Environment obstacles for battle maps (rocks, trees)"
      pageIcon={BoxModelIcon}
    />
  );
}
