/**
 * CharactersPage - Manage character sprite sheets
 * Uses AssetGrid for browsing and bulk operations
 */

import { AvatarIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function CharactersPage() {
  return (
    <AssetGrid
      category="characters"
      pageTitle="Characters"
      pageDescription="Animated character sprite sheets (64x512 vertical strips, 8 frames)"
      pageIcon={AvatarIcon}
    />
  );
}
