import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/053_battle_terminal_outbox.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/053_battle_terminal_outbox.rollback.sql'
);

const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('053 battle terminal outbox migration', () => {
  it('stores durable idempotent events and delivery state', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /CREATE TABLE IF NOT EXISTS battle_terminal_effect_outbox/);
    assert.match(sql, /event_key VARCHAR\(255\) NOT NULL UNIQUE/);
    assert.match(sql, /battle_id INTEGER NOT NULL/);
    assert.doesNotMatch(sql, /battle_id INTEGER NOT NULL REFERENCES battles/);
    assert.match(sql, /attempts INTEGER NOT NULL DEFAULT 0/);
    assert.match(sql, /next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(sql, /last_error TEXT/);
    assert.match(sql, /processed_at TIMESTAMPTZ/);
  });

  it('indexes pending events for operational drains', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /idx_battle_terminal_effect_outbox_pending/);
    assert.match(sql, /ON battle_terminal_effect_outbox\(next_attempt_at, id\) WHERE processed_at IS NULL/);
  });

  it('has a narrow rollback', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.equal(sql, 'DROP TABLE IF EXISTS battle_terminal_effect_outbox;');
  });
});
