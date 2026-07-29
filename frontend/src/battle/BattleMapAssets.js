function collectAuthoredAssetRecords(layer, records = []) {
  if (!Array.isArray(layer)) return records;
  for (const value of layer) {
    if (Array.isArray(value)) {
      collectAuthoredAssetRecords(value, records);
    } else if (value?.assetKey) {
      records.push(value);
    }
  }
  return records;
}

/**
 * Build the map-specific visual preload manifest consumed by BattleScene.
 * BattleMapV2 authored layers use flat records, but hydrated/runtime patches
 * may expose obstacles as a row-major grid. Traverse either representation
 * without changing the permissive V1 obstacle manifest.
 */
export function collectBattleMapAssetManifest(state, grid) {
  if (state?.battleMapSchemaVersion === 2) {
    return collectAuthoredAssetRecords([
      state.obstacles,
      state.transitions,
      state.decorations
    ]);
  }

  return Array.from(new Map(
    (grid?.obstacles?.flat?.() ?? []).filter(Boolean).map(obstacle => [
      `${obstacle.type}:${obstacle.variant}`,
      obstacle
    ])
  ).values());
}
