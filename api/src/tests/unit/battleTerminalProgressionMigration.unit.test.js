import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/054_battle_terminal_progression_receipts.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/054_battle_terminal_progression_receipts.rollback.sql'
);
const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('054 battle terminal progression receipt migration', () => {
  it('stores one payload and replayable result per stable event key', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /CREATE TABLE IF NOT EXISTS battle_terminal_progression_receipts/);
    assert.match(sql, /event_key VARCHAR\(255\) PRIMARY KEY/);
    assert.match(sql, /event_kind VARCHAR\(32\) NOT NULL/);
    assert.match(sql, /payload JSONB NOT NULL/);
    assert.match(sql, /result JSONB NOT NULL DEFAULT '\{\}'::JSONB/);
    assert.match(sql, /jsonb_typeof\(payload\) = 'object'/);
    assert.match(sql, /jsonb_typeof\(result\) = 'object'/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS completion_battle_id INTEGER/);
    assert.match(sql, /idx_character_quests_completion_battle/);
  });

  it('has a narrow rollback', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));
    assert.match(sql, /^DROP TABLE IF EXISTS battle_terminal_progression_receipts;/);
    assert.match(sql, /DROP INDEX IF EXISTS idx_character_quests_completion_battle/);
    assert.match(sql, /DROP COLUMN IF EXISTS completion_battle_id/);
  });
});
