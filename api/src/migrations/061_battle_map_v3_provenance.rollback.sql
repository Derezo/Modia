-- BattleMap V3 rows must remain readable with their exact selection
-- provenance. Refuse to discard that contract while any such battle exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM battles
    WHERE battle_map_schema_version = 3
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back BattleMap V3 provenance while V3 battles exist';
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_battles_battle_map_content;
DROP INDEX IF EXISTS idx_battles_battle_map_catalog_release;

ALTER TABLE battles
  DROP CONSTRAINT IF EXISTS battles_v3_provenance_complete,
  DROP CONSTRAINT IF EXISTS battles_map_tier_valid,
  DROP CONSTRAINT IF EXISTS battles_map_hash_matches_version,
  DROP CONSTRAINT IF EXISTS battles_map_versions_supported,
  ADD CONSTRAINT battles_map_versions_supported
    CHECK (
      (battle_map_schema_version = 1 AND terrain_generation_version = 1)
      OR
      (battle_map_schema_version = 2 AND terrain_generation_version = 2)
    ),
  ADD CONSTRAINT battles_map_hash_matches_version
    CHECK (
      (battle_map_schema_version = 1 AND battle_map_full_hash IS NULL)
      OR
      (
        battle_map_schema_version = 2
        AND battle_map_full_hash ~ '^sha256:[0-9a-f]{64}$'
      )
    ),
  DROP COLUMN IF EXISTS battle_map_selection_provenance,
  DROP COLUMN IF EXISTS battle_map_selection_band,
  DROP COLUMN IF EXISTS battle_map_tier,
  DROP COLUMN IF EXISTS battle_map_theme,
  DROP COLUMN IF EXISTS battle_map_catalog_release_id,
  DROP COLUMN IF EXISTS battle_map_content_version,
  DROP COLUMN IF EXISTS battle_map_content_id;
