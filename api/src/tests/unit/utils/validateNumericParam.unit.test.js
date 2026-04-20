import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validatePositiveInt, parseIntOrThrow } from '../../../utils/validateNumericParam.js';
import { AppError } from '../../../middleware/errorHandler.js';

describe('validatePositiveInt', () => {
  it('returns valid for a value in range', () => {
    const result = validatePositiveInt(5, { min: 1, max: 10 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 5);
  });

  it('returns valid for string number in range', () => {
    const result = validatePositiveInt('42', { min: 1, max: 100 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 42);
  });

  it('returns invalid for value below min', () => {
    const result = validatePositiveInt(0, { min: 1, max: 10 });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Value must be at least 1');
  });

  it('returns invalid for value above max', () => {
    const result = validatePositiveInt(15, { min: 1, max: 10 });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Value must be at most 10');
  });

  it('returns invalid for NaN string', () => {
    const result = validatePositiveInt('abc', { min: 1, max: 10 });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Value must be a number');
  });

  it('returns invalid for undefined without default', () => {
    const result = validatePositiveInt(undefined);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Value is required');
  });

  it('returns invalid for null without default', () => {
    const result = validatePositiveInt(null);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Value is required');
  });

  it('returns invalid for empty string without default', () => {
    const result = validatePositiveInt('');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Value is required');
  });

  it('applies default value when missing', () => {
    const result = validatePositiveInt(undefined, { defaultValue: 10 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 10);
  });

  it('applies default value for null', () => {
    const result = validatePositiveInt(null, { defaultValue: 5 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 5);
  });

  it('applies default value for empty string', () => {
    const result = validatePositiveInt('', { defaultValue: 1 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 1);
  });

  it('uses provided value over default when value is present', () => {
    const result = validatePositiveInt(7, { defaultValue: 10 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 7);
  });

  it('uses default min of 1', () => {
    const result = validatePositiveInt(0);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Value must be at least 1');
  });

  it('handles edge case at exact min', () => {
    const result = validatePositiveInt(5, { min: 5, max: 10 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 5);
  });

  it('handles edge case at exact max', () => {
    const result = validatePositiveInt(10, { min: 5, max: 10 });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value, 10);
  });
});

describe('parseIntOrThrow', () => {
  it('returns the number on valid input', () => {
    const result = parseIntOrThrow(5, 'quantity', { min: 1, max: 10 });
    assert.strictEqual(result, 5);
  });

  it('returns the number from string input', () => {
    const result = parseIntOrThrow('42', 'quantity', { min: 1, max: 100 });
    assert.strictEqual(result, 42);
  });

  it('throws AppError with correct message on value below min', () => {
    assert.throws(
      () => parseIntOrThrow(0, 'quantity', { min: 1, max: 10 }),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.message, 'Invalid quantity: Value must be at least 1');
        return true;
      }
    );
  });

  it('throws AppError with correct message on value above max', () => {
    assert.throws(
      () => parseIntOrThrow(15, 'quantity', { min: 1, max: 10 }),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.message, 'Invalid quantity: Value must be at most 10');
        return true;
      }
    );
  });

  it('throws AppError on NaN string', () => {
    assert.throws(
      () => parseIntOrThrow('abc', 'quantity'),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.message, 'Invalid quantity: Value must be a number');
        return true;
      }
    );
  });

  it('throws AppError on undefined without default', () => {
    assert.throws(
      () => parseIntOrThrow(undefined, 'quantity'),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.message, 'Invalid quantity: Value is required');
        return true;
      }
    );
  });

  it('returns default value when missing', () => {
    const result = parseIntOrThrow(undefined, 'quantity', { defaultValue: 10 });
    assert.strictEqual(result, 10);
  });

  it('includes field name in error message', () => {
    assert.throws(
      () => parseIntOrThrow('bad', 'itemId'),
      (err) => {
        assert.ok(err.message.includes('itemId'));
        return true;
      }
    );
  });
});
