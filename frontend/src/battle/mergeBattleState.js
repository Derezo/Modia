function getUnitKey(unit) {
  const id = unit?.id ?? unit?.unitId;
  return id == null ? null : String(id);
}

/**
 * Merge a partial WebSocket state patch without discarding fields omitted by
 * the server. Unit patches are merged by ID so sparse HP/position updates keep
 * the complete records required by BattleScene.syncUnitsWithState().
 */
export function mergeBattleStatePatch(currentState, statePatch) {
  if (!statePatch || typeof statePatch !== 'object') return currentState;

  const current = currentState && typeof currentState === 'object'
    ? currentState
    : {};
  const merged = { ...current, ...statePatch };
  const currentUnits = Array.isArray(current.units) ? current.units : [];

  if (!Array.isArray(statePatch.units)) {
    if (currentUnits.length > 0) merged.units = currentUnits;
    return merged;
  }

  const patchById = new Map();
  const unkeyedPatches = [];
  for (const unitPatch of statePatch.units) {
    const key = getUnitKey(unitPatch);
    if (key === null) {
      unkeyedPatches.push(unitPatch);
    } else {
      patchById.set(key, unitPatch);
    }
  }

  const units = currentUnits.map(unit => {
    const key = getUnitKey(unit);
    const unitPatch = key === null ? null : patchById.get(key);
    if (!unitPatch) return { ...unit };
    patchById.delete(key);
    return { ...unit, ...unitPatch };
  });

  for (const unitPatch of patchById.values()) units.push({ ...unitPatch });
  for (const unitPatch of unkeyedPatches) units.push({ ...unitPatch });
  merged.units = units;

  return merged;
}

/** Apply authoritative map layers carried by a state patch. */
export function applyBattleMapPatch(grid, statePatch) {
  if (!grid || !statePatch || typeof statePatch !== 'object') return;

  if (typeof statePatch.nodeType === 'string' && statePatch.nodeType.length > 0) {
    grid.nodeType = statePatch.nodeType;
  }
  if (Array.isArray(statePatch.terrain)) {
    grid.setTerrain(statePatch.terrain);
  }
  if (Array.isArray(statePatch.elevation)) {
    grid.setElevation(statePatch.elevation, statePatch.elevationFormat || 'auto');
  }
  if (Array.isArray(statePatch.variants)) {
    grid.setTileVariants(statePatch.variants);
  }
  if (Array.isArray(statePatch.obstacles)) {
    grid.setObstacles(statePatch.obstacles);
  }
  if (Array.isArray(statePatch.elevationConnections)) {
    grid.setElevationConnections(statePatch.elevationConnections);
  }
  if (Array.isArray(statePatch.renderMask) ||
      Array.isArray(statePatch.playableMask)) {
    if (!Array.isArray(statePatch.renderMask) ||
        !Array.isArray(statePatch.playableMask)) {
      throw new TypeError(
        'V3 battle-map hydration requires renderMask and playableMask together'
      );
    }
    grid.setMasks(statePatch.renderMask, statePatch.playableMask);
  }
  if (Array.isArray(statePatch.transitions)) {
    grid.setTransitions(statePatch.transitions);
  }
  if (Array.isArray(statePatch.decorations)) {
    grid.setDecorations(statePatch.decorations);
  }
}
