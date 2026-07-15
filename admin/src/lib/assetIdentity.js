/**
 * Return the metadata key used by the asset APIs.
 *
 * Selection IDs deliberately are not sent to the API: they contain scope data
 * that keeps repeated metadata keys independent in the admin UI.
 */
export function getAssetRawId(asset) {
  return asset?.key || asset?.id || '';
}

function selectionPart(value) {
  return encodeURIComponent(String(value || ''));
}

/**
 * Build a stable, category-aware identity for selection and React keys.
 */
export function getAssetSelectionId(asset, category) {
  const rawId = getAssetRawId(asset);

  if (category === 'tiles') {
    return [
      category,
      asset?._biome || asset?.biome || asset?.outputPath,
      asset?._tileCategory || asset?.tileCategory || asset?.category,
      asset?._sourceFile,
      rawId,
    ].map(selectionPart).join('::');
  }

  if (category === 'icons') {
    return [category, asset?._iconCategory || asset?._subcategory, asset?._sourceFile, rawId]
      .map(selectionPart)
      .join('::');
  }

  if (category === 'items') {
    return [category, asset?._itemCategory || asset?._subcategory, asset?._sourceFile, rawId]
      .map(selectionPart)
      .join('::');
  }

  return [category, asset?._sourceFile, rawId].map(selectionPart).join('::');
}

/**
 * Resolve UI selection IDs back to the full asset objects needed for scoped
 * API operations.
 */
export function getSelectedAssets(assets, selectedIds, category) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return (assets || []).filter((asset) => selected.has(getAssetSelectionId(asset, category)));
}

/**
 * Group tiles by the two filters understood by the deterministic tile
 * compiler. Each group contains raw metadata IDs suitable for API calls.
 */
export function groupTileAssetsByScope(assets) {
  const groups = new Map();

  for (const asset of assets || []) {
    const biome = asset?._biome || asset?.biome || asset?.outputPath || '';
    const subcategory = asset?._tileCategory || asset?.tileCategory || asset?.category || '';
    const groupKey = JSON.stringify([biome, subcategory]);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { biome, subcategory, assetIds: [] });
    }

    const rawId = getAssetRawId(asset);
    if (rawId) groups.get(groupKey).assetIds.push(rawId);
  }

  return Array.from(groups.values());
}
