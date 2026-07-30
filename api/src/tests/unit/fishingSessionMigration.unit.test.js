import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/058_fishing_session_integrity.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/058_fishing_session_integrity.rollback.sql'
);
const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('058 fishing session integrity migration', () => {
  it('persists resumable state and an exactly-once collection result', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /CREATE TABLE IF NOT EXISTS user_fishing_sessions/);
    assert.match(sql, /session_id UUID PRIMARY KEY/);
    assert.match(sql, /catches JSONB NOT NULL DEFAULT '\[\]'::JSONB/);
    assert.match(sql, /collection_result JSONB/);
    assert.match(sql, /CHECK \(status IN \('active', 'collected', 'expired'\)\)/);
    assert.match(sql, /jsonb_typeof\(catches\) = 'array'/);
    assert.match(sql, /jsonb_typeof\(collection_result\) = 'object'/);
  });

  it('enforces one active fishing session per user across workers', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_fishing_sessions_one_active_per_user/);
    assert.match(sql, /ON user_fishing_sessions\(user_id\) WHERE status = 'active'/);
  });

  it('has a narrow rollback', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));
    assert.equal(sql, 'DROP TABLE IF EXISTS user_fishing_sessions;');
  });
});
