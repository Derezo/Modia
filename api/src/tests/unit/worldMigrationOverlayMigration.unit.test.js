import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/051_world_migration_overlay.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/051_world_migration_overlay.rollback.sql'
);

const compact = (sql) => sql.replace(/\s+/g, ' ').trim();

describe('051 world migration overlay migration', () => {
  it('adds nullable JSONB semantic overlay metadata idempotently', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(
      sql,
      /ALTER TABLE seed_metadata ADD COLUMN IF NOT EXISTS migration_overlay JSONB/
    );
    assert.doesNotMatch(sql, /migration_overlay JSONB NOT NULL/);
    assert.doesNotMatch(sql, /migration_overlay JSONB DEFAULT/);
  });

  it('drops only the semantic overlay metadata on rollback', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.match(
      sql,
      /ALTER TABLE seed_metadata DROP COLUMN IF EXISTS migration_overlay/
    );
    assert.doesNotMatch(sql, /DROP TABLE/);
  });
});
