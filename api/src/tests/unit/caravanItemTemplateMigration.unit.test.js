import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/059_caravan_item_templates.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/059_caravan_item_templates.rollback.sql'
);
const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('059 caravan item templates migration', () => {
  it('adds an idempotent nullable catalog key with a unique index', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(
      sql,
      /ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS catalog_key VARCHAR;/
    );
    assert.doesNotMatch(sql, /catalog_key VARCHAR NOT NULL/);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_item_templates_catalog_key ON item_templates\(catalog_key\);/
    );
    assert.doesNotMatch(sql, /ALTER TABLE character_items/);
  });

  it('refuses rollback when any table references a caravan template', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.match(sql, /FROM information_schema\.columns/);
    assert.match(sql, /column_name = 'item_template_id'/);
    assert.match(sql, /WHERE template\.catalog_key LIKE ''caravan:%%''/);
    assert.match(sql, /IF has_references THEN RAISE EXCEPTION/);
    assert.ok(
      sql.indexOf('RAISE EXCEPTION') < sql.indexOf('DELETE FROM item_templates'),
      'rollback must refuse referenced data before deleting templates'
    );
  });

  it('preserves other catalog namespaces and only removes caravan rows', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.match(
      sql,
      /catalog_key NOT LIKE 'caravan:%'/
    );
    assert.match(
      sql,
      /Cannot roll back caravan item templates: non-caravan catalog keys exist/
    );
    assert.match(
      sql,
      /DELETE FROM item_templates WHERE catalog_key LIKE 'caravan:%';/
    );
    assert.match(
      sql,
      /DROP INDEX IF EXISTS idx_item_templates_catalog_key;/
    );
    assert.match(
      sql,
      /ALTER TABLE item_templates DROP COLUMN IF EXISTS catalog_key;$/
    );
    assert.ok(
      sql.indexOf('DELETE FROM item_templates')
        < sql.indexOf('DROP INDEX IF EXISTS idx_item_templates_catalog_key'),
      'catalog-owned rows must be removed before the key used to identify them'
    );
  });
});
