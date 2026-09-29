/**
 * TIMESTAMP (without time zone) values must round-trip through node-postgres
 * regardless of the API process's TZ.
 *
 * Reads are parsed as UTC (type parser 1114 in config/database.js). Writes
 * must serialize Date parameters as UTC too; otherwise a value read and
 * written back (quest period_start / period_end) shifts by the process UTC
 * offset. That shift made daily quests assigned after 20:00 UTC on a UTC-4
 * host land already expired.
 *
 * The child process runs with TZ=America/New_York so the check is meaningful
 * even when the test runner itself is on UTC.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const databaseModule = resolve(here, '../../config/database.js');

const probe = `
  const { pool } = await import(${JSON.stringify(databaseModule)});
  const pg = (await import('pg')).default;
  const { createRequire } = await import('node:module');
  const require = createRequire(${JSON.stringify(databaseModule)});
  const { prepareValue } = require('pg/lib/utils');
  const parse = pg.types.getTypeParser(1114);
  const readBack = parse('2026-09-30 00:00:00');
  const written = prepareValue(readBack);
  console.log(JSON.stringify({
    offsetMinutes: new Date('2026-09-30T00:00:00Z').getTimezoneOffset(),
    readBack: readBack.toISOString(),
    written
  }));
  await pool.end();
`;

describe('TIMESTAMP round trip', () => {
  it('writes a Date read from a TIMESTAMP column back as the same UTC wall time', () => {
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', probe],
      { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }
    );
    const result = JSON.parse(out.trim().split('\n').pop());

    assert.notEqual(result.offsetMinutes, 0, 'probe runs in a non-UTC zone');
    assert.equal(result.readBack, '2026-09-30T00:00:00.000Z');
    assert.match(result.written, /^2026-09-30T00:00:00\.000\+00:00$/);
  });
});
