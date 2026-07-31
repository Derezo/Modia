import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  directory,
  '../../migrations/060_fishing_gameplay_overhaul.sql'
);
const rollbackPath = resolve(
  directory,
  '../../migrations/060_fishing_gameplay_overhaul.rollback.sql'
);
const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('060 server-authoritative fishing migration', () => {
  it('snapshots session gear, biome, and the exact 30-minute expiry', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    assert.match(sql, /selected_rod_key VARCHAR/);
    assert.match(sql, /selected_tackle_key VARCHAR/);
    assert.match(sql, /biome_key VARCHAR/);
    assert.match(sql, /session_expires_at TIMESTAMPTZ/);
    assert.match(sql, /started_at \+ INTERVAL '30 minutes'/);
  });

  it('persists revisioned cast phases, hidden rolls, challenge, and outcome', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    assert.match(sql, /CREATE TABLE IF NOT EXISTS user_fishing_attempts/);
    assert.match(sql, /cast_request_id UUID NOT NULL/);
    assert.match(sql, /revision INTEGER NOT NULL DEFAULT 0/);
    assert.match(sql, /is_big_catch BOOLEAN/);
    assert.match(sql, /rod_landing_rate NUMERIC/);
    assert.match(sql, /tackle_wait_reduction NUMERIC/);
    assert.match(sql, /reel_challenge JSONB/);
    assert.match(sql, /outcome JSONB/);
    assert.match(sql, /idx_fishing_attempts_one_unfinished/);
  });

  it('stores UUID action receipts with request-hash conflicts and responses', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    assert.match(sql, /CREATE TABLE IF NOT EXISTS fishing_action_receipts/);
    assert.match(sql, /action_id UUID PRIMARY KEY/);
    assert.match(sql, /request_hash CHAR\(64\) NOT NULL/);
    assert.match(sql, /response_body JSONB/);
    assert.match(sql, /request_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  it('enforces at most one catch for an attempt and durable value metadata', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    assert.match(sql, /ADD COLUMN IF NOT EXISTS attempt_id UUID/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS rarity VARCHAR/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS value INTEGER/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS size_multiplier NUMERIC/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS is_big_catch BOOLEAN/);
    assert.match(sql, /idx_fishing_catches_attempt_unique/);
  });

  it('seeds every gear catalog key before purchases and drops', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    for (const key of [
      'fishing:rod:weathered',
      'fishing:rod:riverwood',
      'fishing:rod:silverline',
      'fishing:rod:runebound',
      'fishing:tackle:earthworm',
      'fishing:tackle:slime_slug',
      'fishing:tackle:gilded_spinner',
      'fishing:tackle:abyssal_lure'
    ]) {
      assert.match(sql, new RegExp(key));
    }
    assert.match(sql, /'key_item'.*FALSE, FALSE/s);
    assert.match(sql, /'material'.*TRUE, FALSE/s);
  });

  it('migrates exact independent fixed-drop chances without touching ordinary loot', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    assert.match(sql, /earthworm.*"chance":0\.03/);
    assert.match(sql, /slime_slug.*"chance":0\.02/);
    assert.match(sql, /gilded_spinner.*"chance":0\.01/);
    assert.match(sql, /abyssal_lure.*"chance":0\.005/);
    assert.match(sql, /jsonb_set/);
  });

  it('has a narrow rollback for fishing-owned schema and fixed-drop fields', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));
    assert.match(sql, /DROP TABLE IF EXISTS fishing_action_receipts/);
    assert.match(sql, /DROP TABLE IF EXISTS user_fishing_attempts/);
    assert.match(sql, /DROP COLUMN IF EXISTS selected_rod_key/);
    assert.match(sql, /drop_table - 'fixedDrops'/);
    assert.doesNotMatch(sql, /DROP TABLE IF EXISTS user_fishing_sessions/);
  });
});
