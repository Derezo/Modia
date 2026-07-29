import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/052_battle_state_protocol.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/052_battle_state_protocol.rollback.sql'
);

const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('052 battle state protocol migration', () => {
  it('adds a nonnegative revision, explicit map identity, and creation idempotency', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /state_revision BIGINT NOT NULL DEFAULT 0/);
    assert.match(sql, /CHECK \(state_revision >= 0\)/);
    assert.match(sql, /battle_map_schema_version SMALLINT NOT NULL DEFAULT 1/);
    assert.match(sql, /terrain_generation_version SMALLINT NOT NULL DEFAULT 1/);
    assert.match(sql, /battle_map_full_hash VARCHAR\(71\)/);
    assert.match(sql, /battle_map_full_hash ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_battles_creation_idempotency/);
  });

  it('stores one idempotent result for each committed successor revision', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /CREATE TABLE IF NOT EXISTS battle_command_results/);
    assert.match(sql, /PRIMARY KEY \(battle_id, idempotency_key\)/);
    assert.match(sql, /state_revision = base_state_revision \+ 1/);
    assert.match(sql, /battle_id INTEGER NOT NULL REFERENCES battles\(id\) ON DELETE CASCADE/);
  });

  it('rolls back only the protocol table, index, constraints, and columns', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.match(sql, /DROP TABLE IF EXISTS battle_command_results/);
    assert.match(sql, /DROP INDEX IF EXISTS idx_battles_creation_idempotency/);
    assert.match(sql, /DROP COLUMN IF EXISTS state_revision/);
    assert.doesNotMatch(sql, /DROP TABLE IF EXISTS battles/);
  });
});
