/**
 * NodesPage - Manage world map nodes
 * Uses AssetGrid for browsing and bulk operations
 */

import { GlobeIcon } from '@radix-ui/react-icons';
import AssetGrid from '../components/AssetGrid';

export default function NodesPage() {
  return (
    <AssetGrid
      category="nodes"
      pageTitle="Nodes"
      pageDescription="World map location node icons"
      pageIcon={GlobeIcon}
    />
  );
}
