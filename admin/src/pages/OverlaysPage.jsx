/**
 * OverlaysPage - Manage overlay assets
 * Uses AssetGrid for browsing and bulk operations
 */

import { LayersIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function OverlaysPage() {
  return (
    <AssetGrid
      category="overlays"
      pageTitle="Overlays"
      pageDescription="Rarity overlays and augment effects"
      pageIcon={LayersIcon}
    />
  );
}
