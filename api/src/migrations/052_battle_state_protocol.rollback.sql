-- Remove the revisioned battle-state persistence envelope.

DROP TABLE IF EXISTS battle_command_results;
DROP INDEX IF EXISTS idx_coliseum_matches_battle_unique;
DROP INDEX IF EXISTS idx_battles_creation_idempotency;

ALTER TABLE battles
  DROP CONSTRAINT IF EXISTS battles_map_hash_matches_version,
  DROP CONSTRAINT IF EXISTS battles_creation_request_hash_format,
  DROP CONSTRAINT IF EXISTS battles_map_versions_supported,
  DROP CONSTRAINT IF EXISTS battles_state_revision_nonnegative,
  DROP COLUMN IF EXISTS creation_request_hash,
  DROP COLUMN IF EXISTS creation_idempotency_key,
  DROP COLUMN IF EXISTS battle_map_full_hash,
  DROP COLUMN IF EXISTS terrain_generation_version,
  DROP COLUMN IF EXISTS battle_map_schema_version,
  DROP COLUMN IF EXISTS state_revision;
