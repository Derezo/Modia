-- Durable audit ledger for player-preserving world regeneration.
--
-- These tables deliberately do not reference world_nodes. A migration audit
-- must survive removal of the source graph and any later world regeneration.

CREATE TABLE IF NOT EXISTS world_migration_runs (
  id BIGSERIAL PRIMARY KEY,
  migration_kind VARCHAR(64) NOT NULL
    DEFAULT 'player_preserving_regeneration',
  source_seed_version INTEGER,
  target_seed_version INTEGER NOT NULL,
  world_seed BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  plan_hash VARCHAR(64) NOT NULL,
  source_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  target_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  preservation_report JSONB NOT NULL DEFAULT '{}'::JSONB,
  verification_report JSONB NOT NULL DEFAULT '{}'::JSONB,
  initiated_by TEXT NOT NULL DEFAULT CURRENT_USER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT world_migration_runs_kind_check
    CHECK (migration_kind = 'player_preserving_regeneration'),
  CONSTRAINT world_migration_runs_status_check
    CHECK (status IN ('running', 'committed', 'failed')),
  CONSTRAINT world_migration_runs_plan_hash_check
    CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT world_migration_runs_completion_check
    CHECK (
      (status = 'running' AND completed_at IS NULL)
      OR
      (status IN ('committed', 'failed') AND completed_at IS NOT NULL)
    ),
  CONSTRAINT world_migration_runs_plan_hash_key UNIQUE (plan_hash)
);

CREATE TABLE IF NOT EXISTS world_migration_node_maps (
  migration_id BIGINT NOT NULL
    REFERENCES world_migration_runs(id) ON DELETE RESTRICT,
  old_node_id INTEGER NOT NULL,
  old_node_key VARCHAR(200) NOT NULL,
  new_node_id INTEGER NOT NULL,
  new_node_key VARCHAR(200) NOT NULL,
  mapping_method VARCHAR(64) NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  reason TEXT NOT NULL,
  collision_group_size INTEGER NOT NULL DEFAULT 1,
  old_node_snapshot JSONB NOT NULL,
  new_node_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (migration_id, old_node_id),
  CONSTRAINT world_migration_node_maps_old_key_key
    UNIQUE (migration_id, old_node_key),
  CONSTRAINT world_migration_node_maps_confidence_check
    CHECK (confidence IN ('exact', 'high', 'medium', 'low', 'fallback')),
  CONSTRAINT world_migration_node_maps_collision_check
    CHECK (collision_group_size >= 1)
);

CREATE INDEX IF NOT EXISTS idx_world_migration_node_maps_target
  ON world_migration_node_maps(migration_id, new_node_id);

CREATE INDEX IF NOT EXISTS idx_world_migration_node_maps_method
  ON world_migration_node_maps(migration_id, mapping_method, confidence);

CREATE TABLE IF NOT EXISTS world_migration_progress_archive (
  id BIGSERIAL PRIMARY KEY,
  migration_id BIGINT NOT NULL
    REFERENCES world_migration_runs(id) ON DELETE RESTRICT,
  source_table TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_identity JSONB NOT NULL,
  source_row JSONB NOT NULL,
  disposition VARCHAR(24) NOT NULL,
  mapped_references JSONB NOT NULL DEFAULT '{}'::JSONB,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT world_migration_progress_archive_source_key
    UNIQUE (migration_id, source_table, source_key),
  CONSTRAINT world_migration_progress_archive_disposition_check
    CHECK (
      disposition IN (
        'mapped',
        'merged',
        'coverage',
        'historical',
        'unchanged',
        'regenerated',
        'manual_review'
      )
    ),
  CONSTRAINT world_migration_progress_archive_identity_check
    CHECK (jsonb_typeof(source_identity) = 'object'),
  CONSTRAINT world_migration_progress_archive_row_check
    CHECK (jsonb_typeof(source_row) = 'object'),
  CONSTRAINT world_migration_progress_archive_references_check
    CHECK (jsonb_typeof(mapped_references) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_world_migration_progress_archive_source
  ON world_migration_progress_archive(migration_id, source_table);

CREATE INDEX IF NOT EXISTS idx_world_migration_progress_archive_disposition
  ON world_migration_progress_archive(migration_id, disposition);

CREATE OR REPLACE FUNCTION prevent_world_migration_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% rows are immutable after insertion (attempted %)',
    TG_TABLE_NAME,
    TG_OP;
END
$$;

CREATE OR REPLACE FUNCTION prevent_terminal_world_migration_run_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'running' THEN
    RAISE EXCEPTION
      '% row % is immutable after reaching status % (attempted %)',
      TG_TABLE_NAME,
      OLD.id,
      OLD.status,
      TG_OP;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_world_migration_runs_immutable
  ON world_migration_runs;
CREATE TRIGGER trg_world_migration_runs_immutable
BEFORE UPDATE OR DELETE
ON world_migration_runs
FOR EACH ROW
EXECUTE FUNCTION prevent_terminal_world_migration_run_mutation();

DROP TRIGGER IF EXISTS trg_world_migration_node_maps_immutable
  ON world_migration_node_maps;
CREATE TRIGGER trg_world_migration_node_maps_immutable
BEFORE UPDATE OR DELETE
ON world_migration_node_maps
FOR EACH ROW
EXECUTE FUNCTION prevent_world_migration_audit_mutation();

DROP TRIGGER IF EXISTS trg_world_migration_progress_archive_immutable
  ON world_migration_progress_archive;
CREATE TRIGGER trg_world_migration_progress_archive_immutable
BEFORE UPDATE OR DELETE
ON world_migration_progress_archive
FOR EACH ROW
EXECUTE FUNCTION prevent_world_migration_audit_mutation();

COMMENT ON TABLE world_migration_runs IS
  'One durable execution record for an atomic player-preserving world regeneration; terminal rows are immutable';
COMMENT ON TABLE world_migration_node_maps IS
  'Immutable old-to-new node mapping ledger; target mappings may be many-to-one';
COMMENT ON TABLE world_migration_progress_archive IS
  'Immutable pre-migration snapshots of world-linked state and regenerated graph rows';
COMMENT ON COLUMN world_migration_node_maps.old_node_id IS
  'Historical source ID only; intentionally has no foreign key to world_nodes';
COMMENT ON COLUMN world_migration_node_maps.new_node_id IS
  'Target ID at migration time; intentionally has no foreign key to world_nodes';
