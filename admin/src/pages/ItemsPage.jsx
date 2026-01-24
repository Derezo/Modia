/**
 * ItemsPage - Manage item sprites
 * Uses AssetGrid for browsing and bulk operations
 */

import { CubeIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function ItemsPage() {
  return (
    <AssetGrid
      category="items"
      pageTitle="Items"
      pageDescription="Weapons, armor, accessories, and consumable sprites"
      pageIcon={CubeIcon}
    />
  );
}
