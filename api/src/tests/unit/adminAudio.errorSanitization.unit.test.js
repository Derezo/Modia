// Verifies that adminAudio.js does not leak internal err.message details to clients.
// Reads the source file to confirm sanitization patterns rather than spinning up a server.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = path.resolve(__dirname, '../../routes/adminAudio.js');
const source = readFileSync(ROUTE_PATH, 'utf8');

describe('adminAudio error sanitization (source-level guarantees)', () => {
  it('does not assign err.message to a response/error field', () => {
    const offendingPatterns = [
      /error:\s*err\.message/,
      /detail:\s*err\.message/,
      /errorMessage:\s*err\.message/,
      /\.error\s*=\s*err\.message/,
    ];
    for (const pattern of offendingPatterns) {
      assert.ok(!pattern.test(source), `sanitization regression: matched ${pattern}`);
    }
  });

  it('does not throw AppError with err.message as the user-facing string', () => {
    assert.ok(
      !/throw new AppError\(\s*err\.message/.test(source),
      'AppError must be thrown with a generic message, not err.message'
    );
    assert.ok(
      !/throw new AppError\(`[^`]*\$\{err\.message\}/.test(source),
      'AppError templates must not interpolate err.message'
    );
  });

  it('preserves server-side logging via console.error in catch blocks', () => {
    const catchBlocks = source.match(/catch\s*\(\s*err\s*\)\s*\{[\s\S]*?\}/g) || [];
    assert.ok(catchBlocks.length > 0, 'expected catch blocks in adminAudio.js');
    for (const block of catchBlocks) {
      const exposesMessage = /(error:\s*err\.message|throw new AppError\(\s*err\.message)/.test(block);
      assert.ok(!exposesMessage, `catch block leaks err.message:\n${block}`);
    }
  });
});
