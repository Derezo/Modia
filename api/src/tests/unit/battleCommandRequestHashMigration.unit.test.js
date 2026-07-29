import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/055_battle_command_request_hash.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/055_battle_command_request_hash.rollback.sql'
);

const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('055 battle command request hash migration', () => {
  it('adds a nullable canonical request hash for rolling compatibility', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(
      sql,
      /ALTER TABLE battle_command_results ADD COLUMN IF NOT EXISTS request_hash VARCHAR\(71\)/
    );
    assert.match(sql, /request_hash IS NULL/);
    assert.match(sql, /request_hash ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
    assert.doesNotMatch(sql, /request_hash VARCHAR\(71\) NOT NULL/);
  });

  it('rolls back only the request-hash constraint and column', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.match(sql, /DROP CONSTRAINT IF EXISTS battle_command_results_request_hash_format/);
    assert.match(sql, /DROP COLUMN IF EXISTS request_hash/);
    assert.doesNotMatch(sql, /DROP TABLE/);
  });
});
