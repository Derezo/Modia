import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FORMATION_GRID_HEIGHT,
  FORMATION_GRID_WIDTH,
  validateFormationPayload
} from '../../../services/battle/formationValidation.js';

describe('battle formation validation', () => {
  it('accepts a unique in-bounds subset owned by the player', () => {
    const result = validateFormationPayload({
      11: { tileX: 0, tileY: 0 },
      12: { tileX: 4, tileY: 3 }
    }, { allowedCharacterIds: [11, 12, 13] });

    assert.deepEqual(result, { success: true, characterIds: [11, 12] });
    assert.equal(FORMATION_GRID_WIDTH, 5);
    assert.equal(FORMATION_GRID_HEIGHT, 4);
  });

  it('treats an omitted optional formation as the default party layout', () => {
    assert.deepEqual(
      validateFormationPayload(undefined, { allowedCharacterIds: [11] }),
      { success: true, characterIds: null }
    );
  });

  it('rejects foreign characters, duplicate cells, and non-integer coordinates', () => {
    assert.equal(validateFormationPayload(
      { 99: { tileX: 0, tileY: 0 } },
      { allowedCharacterIds: [11] }
    ).success, false);
    assert.equal(validateFormationPayload({
      11: { tileX: 0, tileY: 0 },
      12: { tileX: 0, tileY: 0 }
    }).success, false);
    assert.deepEqual(
      validateFormationPayload({ 11: { tileX: 1.5, tileY: 2 } }),
      { success: false, error: 'Invalid position data' }
    );
    assert.deepEqual(
      validateFormationPayload({ 11: { tileX: 2, tileY: Number.NaN } }),
      { success: false, error: 'Invalid position data' }
    );
  });

  it('requires at least one character when formation is mandatory', () => {
    assert.equal(validateFormationPayload({}, { required: true }).success, false);
    assert.equal(validateFormationPayload(null, { required: true }).success, false);
  });

  it('accepts at most five characters', () => {
    const fiveCharacters = Object.fromEntries(
      [11, 12, 13, 14, 15].map((characterId, index) => [
        characterId,
        { tileX: index, tileY: 0 }
      ])
    );

    assert.equal(
      validateFormationPayload(fiveCharacters, { required: true }).success,
      true
    );
    assert.deepEqual(
      validateFormationPayload({
        ...fiveCharacters,
        16: { tileX: 0, tileY: 1 }
      }, { required: true }),
      { success: false, error: 'Formation cannot have more than 5 characters' }
    );
  });
});
