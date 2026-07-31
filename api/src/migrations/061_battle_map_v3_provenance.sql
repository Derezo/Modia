-- Extend the persisted battle-map envelope for immutable BattleMap V3 content.
--
-- V3 activation is owned by the deployed catalog, never by database state.
-- These columns record the deterministic selection that already happened so
-- retries, reconnects, audits, and rollbacks can prove which immutable release
-- produced a battle.

ALTER TABLE battles
  ADD COLUMN IF NOT EXISTS battle_map_content_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS battle_map_content_version INTEGER,
  ADD COLUMN IF NOT EXISTS battle_map_catalog_release_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS battle_map_theme VARCHAR(64),
  ADD COLUMN IF NOT EXISTS battle_map_tier SMALLINT,
  ADD COLUMN IF NOT EXISTS battle_map_selection_band VARCHAR(64),
  ADD COLUMN IF NOT EXISTS battle_map_selection_provenance JSONB;

ALTER TABLE battles
  DROP CONSTRAINT IF EXISTS battles_map_versions_supported,
  ADD CONSTRAINT battles_map_versions_supported
    CHECK (
      (battle_map_schema_version = 1 AND terrain_generation_version = 1)
      OR
      (battle_map_schema_version = 2 AND terrain_generation_version = 2)
      OR
      (battle_map_schema_version = 3 AND terrain_generation_version = 3)
    ),
  DROP CONSTRAINT IF EXISTS battles_map_hash_matches_version,
  ADD CONSTRAINT battles_map_hash_matches_version
    CHECK (
      (battle_map_schema_version = 1 AND battle_map_full_hash IS NULL)
      OR
      (
        battle_map_schema_version IN (2, 3)
        AND battle_map_full_hash ~ '^sha256:[0-9a-f]{64}$'
      )
    ),
  DROP CONSTRAINT IF EXISTS battles_map_tier_valid,
  ADD CONSTRAINT battles_map_tier_valid
    CHECK (
      battle_map_tier IS NULL
      OR battle_map_tier BETWEEN 1 AND 5
    ),
  DROP CONSTRAINT IF EXISTS battles_v3_provenance_complete,
  ADD CONSTRAINT battles_v3_provenance_complete
    CHECK (
      (
        battle_map_schema_version IN (1, 2)
        AND battle_map_content_id IS NULL
        AND battle_map_content_version IS NULL
        AND battle_map_catalog_release_id IS NULL
        AND battle_map_theme IS NULL
        AND battle_map_tier IS NULL
        AND battle_map_selection_band IS NULL
        AND battle_map_selection_provenance IS NULL
      )
      OR
      (
        battle_map_schema_version = 3
        AND battle_map_content_id IS NOT NULL
        AND battle_map_content_version >= 1
        AND battle_map_catalog_release_id IS NOT NULL
        AND battle_map_theme IS NOT NULL
        AND battle_map_selection_band IS NOT NULL
        AND battle_map_selection_provenance IS NOT NULL
        AND jsonb_typeof(battle_map_selection_provenance) = 'object'
      )
    );

CREATE INDEX IF NOT EXISTS idx_battles_battle_map_catalog_release
  ON battles(battle_map_catalog_release_id)
  WHERE battle_map_catalog_release_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_battles_battle_map_content
  ON battles(battle_map_content_id, battle_map_content_version)
  WHERE battle_map_content_id IS NOT NULL;
