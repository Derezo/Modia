import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/050_world_migration_audit.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/050_world_migration_audit.rollback.sql'
);

const compact = (sql) => sql.replace(/\s+/g, ' ').trim();

describe('050 player-preserving world migration audit', () => {
  it('records a confirmed migration plan and its terminal verification', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /CREATE TABLE IF NOT EXISTS world_migration_runs/);
    assert.match(sql, /plan_hash VARCHAR\(64\) NOT NULL/);
    assert.match(sql, /CHECK \(plan_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    assert.match(sql, /status IN \('running', 'committed', 'failed'\)/);
    assert.match(sql, /preservation_report JSONB NOT NULL/);
    assert.match(sql, /verification_report JSONB NOT NULL/);
    assert.match(sql, /UNIQUE \(plan_hash\)/);
    assert.match(sql, /trg_world_migration_runs_immutable/);
    assert.match(sql, /OLD\.status <> 'running'/);
  });

  it('retains immutable old-to-new node identity without live graph FKs', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    const nodeMapDefinition = sql.match(
      /CREATE TABLE IF NOT EXISTS world_migration_node_maps \((.*?)\);/
    )?.[1];

    assert.ok(nodeMapDefinition, 'node mapping table definition is required');
    assert.match(nodeMapDefinition, /old_node_id INTEGER NOT NULL/);
    assert.match(nodeMapDefinition, /old_node_key VARCHAR\(200\) NOT NULL/);
    assert.match(nodeMapDefinition, /new_node_id INTEGER NOT NULL/);
    assert.match(nodeMapDefinition, /new_node_key VARCHAR\(200\) NOT NULL/);
    assert.match(nodeMapDefinition, /collision_group_size INTEGER NOT NULL/);
    assert.doesNotMatch(nodeMapDefinition, /REFERENCES world_nodes/);
    assert.match(sql, /trg_world_migration_node_maps_immutable/);
  });

  it('archives complete source rows and makes the ledger append-only', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(
      sql,
      /CREATE TABLE IF NOT EXISTS world_migration_progress_archive/
    );
    assert.match(sql, /source_identity JSONB NOT NULL/);
    assert.match(sql, /source_row JSONB NOT NULL/);
    assert.match(sql, /mapped_references JSONB NOT NULL/);
    assert.match(sql, /'merged'/);
    assert.match(sql, /'coverage'/);
    assert.match(sql, /'manual_review'/);
    assert.match(
      sql,
      /BEFORE UPDATE OR DELETE ON world_migration_progress_archive/
    );
    assert.match(sql, /RAISE EXCEPTION/);
  });

  it('rolls back audit objects in dependency order', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    const progressIndex = sql.indexOf(
      'DROP TABLE IF EXISTS world_migration_progress_archive'
    );
    const mapsIndex = sql.indexOf(
      'DROP TABLE IF EXISTS world_migration_node_maps'
    );
    const runsIndex = sql.indexOf('DROP TABLE IF EXISTS world_migration_runs');

    assert.ok(progressIndex >= 0);
    assert.ok(mapsIndex > progressIndex);
    assert.ok(runsIndex > mapsIndex);
    assert.match(
      sql,
      /DROP FUNCTION IF EXISTS prevent_terminal_world_migration_run_mutation/
    );
    assert.match(sql, /DROP FUNCTION IF EXISTS prevent_world_migration_audit_mutation/);
  });
});
