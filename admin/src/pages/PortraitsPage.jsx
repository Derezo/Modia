/**
 * PortraitsPage - Manage character and enemy portraits
 * Uses AssetGrid for browsing and bulk operations
 */

import { PersonIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function PortraitsPage() {
  return (
    <AssetGrid
      category="portraits"
      pageTitle="Portraits"
      pageDescription="Character and enemy portrait sprites"
      pageIcon={PersonIcon}
    />
  );
}
