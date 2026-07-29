-- Add the revisioned persistence envelope required by BattleMapV2.
--
-- Existing rows are BattleMapV1 rows. The explicit defaults make a rolling
-- deployment safe while application writers are moved behind
-- BattleStateRepository.

ALTER TABLE battles
  ADD COLUMN IF NOT EXISTS state_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battle_map_schema_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS terrain_generation_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS battle_map_full_hash VARCHAR(71),
  ADD COLUMN IF NOT EXISTS creation_idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS creation_request_hash VARCHAR(71);

ALTER TABLE battles
  DROP CONSTRAINT IF EXISTS battles_state_revision_nonnegative,
  ADD CONSTRAINT battles_state_revision_nonnegative
    CHECK (state_revision >= 0),
  DROP CONSTRAINT IF EXISTS battles_map_versions_supported,
  ADD CONSTRAINT battles_map_versions_supported
    CHECK (
      (battle_map_schema_version = 1 AND terrain_generation_version = 1)
      OR
      (battle_map_schema_version = 2 AND terrain_generation_version = 2)
    ),
  DROP CONSTRAINT IF EXISTS battles_map_hash_matches_version,
  ADD CONSTRAINT battles_map_hash_matches_version
    CHECK (
      (battle_map_schema_version = 1 AND battle_map_full_hash IS NULL)
      OR
      (
        battle_map_schema_version = 2
        AND battle_map_full_hash ~ '^sha256:[0-9a-f]{64}$'
      )
    ),
  DROP CONSTRAINT IF EXISTS battles_creation_request_hash_format,
  ADD CONSTRAINT battles_creation_request_hash_format
    CHECK (
      creation_request_hash IS NULL
      OR creation_request_hash ~ '^sha256:[0-9a-f]{64}$'
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_battles_creation_idempotency
  ON battles(creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

-- A battle can produce at most one durable Coliseum result. This makes retrying
-- terminal commands safe and prevents ratings from being applied twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coliseum_matches_battle_unique
  ON coliseum_matches(battle_id)
  WHERE battle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS battle_command_results (
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(255) NOT NULL,
  command_type VARCHAR(96) NOT NULL,
  base_state_revision BIGINT NOT NULL,
  state_revision BIGINT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (battle_id, idempotency_key),
  CONSTRAINT battle_command_result_revisions
    CHECK (
      base_state_revision >= 0
      AND state_revision = base_state_revision + 1
    )
);
