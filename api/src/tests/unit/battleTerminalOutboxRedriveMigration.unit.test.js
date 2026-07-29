import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/056_battle_terminal_outbox_redrives.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/056_battle_terminal_outbox_redrives.rollback.sql'
);
const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('056 battle terminal outbox redrive migration', () => {
  it('stores an immutable operator audit without coupling retention', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /CREATE TABLE IF NOT EXISTS battle_terminal_outbox_redrives/);
    assert.match(sql, /outbox_event_id BIGINT NOT NULL/);
    assert.match(sql, /event_key VARCHAR\(255\) NOT NULL/);
    assert.match(sql, /previous_attempts INTEGER NOT NULL/);
    assert.match(sql, /previous_last_error TEXT/);
    assert.match(sql, /actor VARCHAR\(255\) NOT NULL/);
    assert.match(sql, /reason TEXT NOT NULL/);
    assert.match(sql, /redriven_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.doesNotMatch(sql, /REFERENCES battle_terminal_effect_outbox/);
    assert.match(sql, /BEFORE UPDATE OR DELETE/);
    assert.match(sql, /prevent_battle_terminal_outbox_redrive_mutation/);
  });

  it('has a narrow rollback', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.match(sql, /^DROP TRIGGER IF EXISTS/);
    assert.match(sql, /DROP TABLE IF EXISTS battle_terminal_outbox_redrives/);
    assert.match(sql, /DROP FUNCTION IF EXISTS prevent_battle_terminal_outbox_redrive_mutation/);
  });
});
