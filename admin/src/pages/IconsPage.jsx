/**
 * IconsPage - Manage UI icons
 * Uses AssetGrid for browsing and bulk operations
 */

import { MixerHorizontalIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function IconsPage() {
  return (
    <AssetGrid
      category="icons"
      pageTitle="Icons"
      pageDescription="UI action icons and status effect indicators"
      pageIcon={MixerHorizontalIcon}
    />
  );
}
