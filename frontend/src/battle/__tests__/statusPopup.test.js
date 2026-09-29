import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getStatusPopup } from '../statusPopup.js';

describe('getStatusPopup', () => {
  it('labels a resisted effect as resisted and plays no effect sound', () => {
    assert.deepEqual(
      getStatusPopup({ type: 'resisted', effect: 'bleed', targetId: 3 }),
      { label: 'BLEED RESISTED', sound: null }
    );
  });

  it('labels an applied debuff with the effect name and its sound', () => {
    assert.deepEqual(
      getStatusPopup({ type: 'debuff', effect: 'bleed', duration: 3 }),
      { label: 'BLEED', sound: 'bleed' }
    );
  });

  it('keeps the CLEANSED label for effect-less cleanses', () => {
    assert.equal(getStatusPopup({ type: 'cleanse' }).label, 'CLEANSED');
  });

  it('returns null when there is nothing to show', () => {
    assert.equal(getStatusPopup(null), null);
    assert.equal(getStatusPopup({}), null);
  });
});
