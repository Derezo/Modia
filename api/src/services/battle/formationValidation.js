export const FORMATION_GRID_WIDTH = 5;
export const FORMATION_GRID_HEIGHT = 4;

/**
 * Validate the client-authored 5x4 formation payload before its coordinates
 * reach battle state. The caller remains responsible for database ownership
 * checks when an allowed-character set is not supplied.
 */
export function validateFormationPayload(formation, options = {}) {
  const {
    required = false,
    maxCharacters = 5,
    allowedCharacterIds = null
  } = options;

  if (formation == null) {
    return required
      ? { success: false, error: 'Invalid formation data' }
      : { success: true, characterIds: null };
  }

  if (typeof formation !== 'object' || Array.isArray(formation)) {
    return { success: false, error: 'Invalid formation data' };
  }

  const entries = Object.entries(formation);
  if (entries.length === 0) {
    return required
      ? { success: false, error: 'Invalid formation data' }
      : { success: true, characterIds: null };
  }
  if (entries.length > maxCharacters) {
    return { success: false, error: `Formation cannot have more than ${maxCharacters} characters` };
  }

  const allowed = allowedCharacterIds == null
    ? null
    : new Set(allowedCharacterIds.map(Number));
  const characterIds = [];
  const positions = new Set();

  for (const [rawCharacterId, position] of entries) {
    if (!/^[1-9]\d*$/.test(rawCharacterId)) {
      return { success: false, error: 'Invalid formation data' };
    }

    const characterId = Number(rawCharacterId);
    if (!Number.isSafeInteger(characterId) || (allowed && !allowed.has(characterId))) {
      return { success: false, error: 'Invalid character selection' };
    }
    characterIds.push(characterId);

    if (!position ||
        !Number.isInteger(position.tileX) ||
        !Number.isInteger(position.tileY)) {
      return { success: false, error: 'Invalid position data' };
    }
    if (position.tileX < 0 || position.tileX >= FORMATION_GRID_WIDTH ||
        position.tileY < 0 || position.tileY >= FORMATION_GRID_HEIGHT) {
      return { success: false, error: 'Position out of bounds' };
    }

    const key = `${position.tileX},${position.tileY}`;
    if (positions.has(key)) {
      return { success: false, error: 'Duplicate positions not allowed' };
    }
    positions.add(key);
  }

  return { success: true, characterIds };
}
