import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseIdParam, parseLimit, parseBoundedInt, parseOffset } from '../../../utils/parseParams.js';
import { AppError } from '../../../middleware/errorHandler.js';

function assert400(fn, message) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof AppError);
    assert.strictEqual(err.statusCode, 400);
    if (message) assert.strictEqual(err.message, message);
    return true;
  });
}

describe('parseIdParam', () => {
  it('parses a positive integer', () => {
    assert.strictEqual(parseIdParam('42', 'userId'), 42);
    assert.strictEqual(parseIdParam(7), 7);
  });

  it('rejects non-numeric, missing, zero and negative ids with 400', () => {
    // GET /api/chat/presence/abc used to reach getPresence(NaN) and 500
    assert400(() => parseIdParam('abc', 'userId'), 'Invalid userId');
    assert400(() => parseIdParam(undefined, 'userId'), 'Invalid userId');
    assert400(() => parseIdParam('0', 'party ID'), 'Invalid party ID');
    assert400(() => parseIdParam('-3'), 'Invalid id');
  });
});

describe('parseLimit / parseBoundedInt / parseOffset', () => {
  it('uses the default when absent', () => {
    assert.strictEqual(parseLimit(undefined, 20, 50), 20);
    assert.strictEqual(parseOffset(''), 0);
    assert.strictEqual(parseBoundedInt(undefined, { default: 5 }), 5);
  });

  it('enforces bounds', () => {
    assert.strictEqual(parseLimit('50', 20, 50), 50);
    assert400(() => parseLimit('51', 20, 50));
    assert400(() => parseLimit('0', 20, 50));
    assert400(() => parseLimit('abc', 20, 50));
    assert400(() => parseOffset('-1'));
  });

  it('leaves bounds open when none are given', () => {
    assert.strictEqual(parseBoundedInt('-10', { name: 'delta' }), -10);
    assert400(() => parseBoundedInt(undefined, { name: 'delta' }));
  });
});

describe('strict integers within the PostgreSQL INTEGER range', () => {
  it('rejects ids beyond int4 instead of letting the query 500', () => {
    assert.strictEqual(parseIdParam('2147483647'), 2147483647);
    assert400(() => parseIdParam('2147483648', 'party ID'), 'Invalid party ID');
    assert400(() => parseIdParam('99999999999', 'invite ID'), 'Invalid invite ID');
    assert400(() => parseOffset('99999999999'));
    assert400(() => parseBoundedInt('-2147483649', { name: 'delta' }));
  });

  it('rejects partial numbers that parseInt accepted', () => {
    for (const bad of ['12abc', '1.9', '0x10', '1e3', ' ', '--1', 1.5, NaN, Infinity, {}, [], true]) {
      assert400(() => parseIdParam(bad), 'Invalid id');
    }
  });

  it('accepts plain, signed and padded integers', () => {
    assert.strictEqual(parseIdParam(' 42 '), 42);
    assert.strictEqual(parseIdParam('+7'), 7);
    assert.strictEqual(parseBoundedInt('-3', { name: 'delta' }), -3);
    assert.strictEqual(parseLimit(25, 20, 50), 25);
  });
});
