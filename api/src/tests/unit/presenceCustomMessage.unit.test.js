/**
 * normalizeCustomMessage: the one rule REST PUT /api/chat/presence and the
 * WS presence_update handler both apply to customMessage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import presenceService from '../../services/presenceService.js';

const { normalizeCustomMessage } = presenceService;

describe('normalizeCustomMessage', () => {
  it('distinguishes no change (undefined) from clear (null, empty, whitespace)', () => {
    assert.equal(normalizeCustomMessage(undefined), undefined);
    assert.equal(normalizeCustomMessage(null), null);
    assert.equal(normalizeCustomMessage(''), null);
    assert.equal(normalizeCustomMessage('   '), null);
  });

  it('trims and keeps a normal message', () => {
    assert.equal(normalizeCustomMessage('  Brewing potions  '), 'Brewing potions');
  });

  it('rejects non-strings and over-length messages with 400', () => {
    for (const bad of [42, { text: 'hi' }, ['hi'], 'x'.repeat(129)]) {
      assert.throws(() => normalizeCustomMessage(bad), err => err.statusCode === 400);
    }
    assert.equal(normalizeCustomMessage('x'.repeat(128)).length, 128);
  });
});
