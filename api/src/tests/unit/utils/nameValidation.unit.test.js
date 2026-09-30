/**
 * Unit tests for display-name and free-text validation used by party, clan
 * and LFG routes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDisplayName, validateFreeText } from '../../../utils/nameValidation.js';

const rejects400 = (fn, pattern) => assert.throws(fn, err => {
  assert.equal(err.statusCode, 400);
  if (pattern) assert.match(err.message, pattern);
  return true;
});

describe('validateDisplayName (party names)', () => {
  const partyName = name => validateDisplayName(name, { label: 'Party name', min: 1, max: 64 });

  it('accepts and trims a normal party name', () => {
    assert.equal(partyName('  Dawn Raiders  '), 'Dawn Raiders');
  });

  it('rejects a party name over the maximum length', () => {
    assert.equal(partyName('a'.repeat(64)).length, 64);
    rejects400(() => partyName('a'.repeat(65)), /between 1 and 64/);
  });

  it('rejects non-string, markup and letterless names', () => {
    rejects400(() => partyName(42), /must be a string/);
    rejects400(() => partyName('<script>'), /invalid characters/);
    rejects400(() => partyName('1234'), /must contain a letter/);
  });
});

describe('validateFreeText (LFG apply message)', () => {
  const message = text => validateFreeText(text, { label: 'Message', max: 256 });

  it('treats a missing message as none', () => {
    assert.equal(message(undefined), null);
    assert.equal(message('   '), null);
  });

  it('rejects non-string, oversized and markup messages', () => {
    rejects400(() => message({ text: 'hi' }), /must be a string/);
    rejects400(() => message('x'.repeat(257)), /256 characters or less/);
    rejects400(() => message('<b>hi</b>'), /invalid characters/);
  });
});
