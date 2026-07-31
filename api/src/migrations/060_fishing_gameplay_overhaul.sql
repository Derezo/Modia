-- Server-authoritative fishing gameplay.
--
-- The session row owns the durable basket and gear selection, each cast is a
-- revisioned attempt, and action receipts make every mutating request safely
-- retryable across API workers.

ALTER TABLE user_fishing_sessions
  ADD COLUMN IF NOT EXISTS selected_rod_key VARCHAR,
  ADD COLUMN IF NOT EXISTS selected_tackle_key VARCHAR,
  ADD COLUMN IF NOT EXISTS biome_key VARCHAR,
  ADD COLUMN IF NOT EXISTS biome_source VARCHAR,
  ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ;

UPDATE user_fishing_sessions
SET session_expires_at = started_at + INTERVAL '30 minutes'
WHERE session_expires_at IS NULL;

ALTER TABLE user_fishing_sessions
  ALTER COLUMN session_expires_at SET NOT NULL;

-- The retired Big One payload exposed the candidate catch before it was
-- earned. Existing baskets stay intact, but no old event survives rollout.
UPDATE user_fishing_sessions
SET big_one_active = FALSE,
    big_one_expires_at = NULL,
    big_one_fish = NULL
WHERE big_one_active = TRUE
   OR big_one_expires_at IS NOT NULL
   OR big_one_fish IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_fishing_attempts (
  attempt_id UUID PRIMARY KEY,
  session_id UUID NOT NULL
    REFERENCES user_fishing_sessions(session_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  cast_request_id UUID NOT NULL,
  phase VARCHAR(16) NOT NULL DEFAULT 'cast',
  revision INTEGER NOT NULL DEFAULT 0,
  cast_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  released_at TIMESTAMPTZ,
  bite_at TIMESTAMPTZ,
  hook_deadline TIMESTAMPTZ,
  hooked_at TIMESTAMPTZ,
  reel_deadline TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  cast_power SMALLINT,
  depth VARCHAR(8),
  is_big_catch BOOLEAN,
  rod_key VARCHAR NOT NULL,
  rod_landing_rate NUMERIC(5,4) NOT NULL,
  tackle_key VARCHAR,
  tackle_wait_reduction NUMERIC(5,4) NOT NULL DEFAULT 0,
  reel_challenge JSONB,
  outcome JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_fishing_attempts_phase_check
    CHECK (phase IN ('cast', 'wait', 'bite', 'reel', 'resolve', 'resolved', 'cancelled')),
  CONSTRAINT user_fishing_attempts_revision_check CHECK (revision >= 0),
  CONSTRAINT user_fishing_attempts_cast_power_check
    CHECK (cast_power IS NULL OR cast_power BETWEEN 0 AND 100),
  CONSTRAINT user_fishing_attempts_depth_check
    CHECK (depth IS NULL OR depth IN ('near', 'mid', 'deep')),
  CONSTRAINT user_fishing_attempts_rod_rate_check
    CHECK (rod_landing_rate >= 0 AND rod_landing_rate <= 1),
  CONSTRAINT user_fishing_attempts_tackle_rate_check
    CHECK (tackle_wait_reduction >= 0 AND tackle_wait_reduction <= 1),
  CONSTRAINT user_fishing_attempts_challenge_check
    CHECK (reel_challenge IS NULL OR jsonb_typeof(reel_challenge) = 'object'),
  CONSTRAINT user_fishing_attempts_outcome_check
    CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object'),
  UNIQUE (session_id, cast_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fishing_attempts_one_unfinished
  ON user_fishing_attempts(session_id)
  WHERE phase IN ('cast', 'wait', 'bite', 'reel', 'resolve');

CREATE INDEX IF NOT EXISTS idx_fishing_attempts_session_created
  ON user_fishing_attempts(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fishing_attempts_user_phase
  ON user_fishing_attempts(user_id, phase);

CREATE TABLE IF NOT EXISTS fishing_action_receipts (
  action_id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(24) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT fishing_action_receipts_hash_check
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fishing_action_receipts_response_check
    CHECK (response_body IS NULL OR jsonb_typeof(response_body) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_fishing_action_receipts_user_created
  ON fishing_action_receipts(user_id, created_at DESC);

ALTER TABLE user_fishing_catches
  ADD COLUMN IF NOT EXISTS session_id UUID
    REFERENCES user_fishing_sessions(session_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_id UUID
    REFERENCES user_fishing_attempts(attempt_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rarity VARCHAR(16),
  ADD COLUMN IF NOT EXISTS value INTEGER,
  ADD COLUMN IF NOT EXISTS size_multiplier NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS is_big_catch BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fishing_catches_attempt_unique
  ON user_fishing_catches(attempt_id)
  WHERE attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fishing_catches_session
  ON user_fishing_catches(session_id, caught_at);

-- Seed gameplay items before any purchase, drop, or cast can reference them.
INSERT INTO item_templates
  (catalog_key, name, description, item_type, equipment_slot, stat_bonuses,
   level_requirement, base_price, is_stackable, is_tradeable, rarity, sprite_id)
VALUES
  ('fishing:rod:weathered', 'Weathered Rod',
   'A dependable caravan rod with a 10% absolute Big Catch landing rate.',
   'key_item', NULL, '{"fishing_tool":"rod","big_catch_rate":0.10}'::JSONB,
   1, 40, FALSE, FALSE, 1, 'fishing_rod_weathered'),
  ('fishing:rod:riverwood', 'Riverwood Rod',
   'A flexible river rod with a 20% absolute Big Catch landing rate.',
   'key_item', NULL, '{"fishing_tool":"rod","big_catch_rate":0.20}'::JSONB,
   1, 250, FALSE, FALSE, 2, 'fishing_rod_riverwood'),
  ('fishing:rod:silverline', 'Silverline Rod',
   'A finely balanced rod with a 50% absolute Big Catch landing rate.',
   'key_item', NULL, '{"fishing_tool":"rod","big_catch_rate":0.50}'::JSONB,
   1, 1250, FALSE, FALSE, 4, 'fishing_rod_silverline'),
  ('fishing:rod:runebound', 'Runebound Rod',
   'An enchanted rod with an 85% absolute Big Catch landing rate.',
   'key_item', NULL, '{"fishing_tool":"rod","big_catch_rate":0.85}'::JSONB,
   1, 5000, FALSE, FALSE, 5, 'fishing_rod_runebound'),
  ('fishing:tackle:earthworm', 'Earthworm',
   'Basic bait that reduces the server-rolled wait by 15%.',
   'material', NULL, '{"fishing_tackle":true,"wait_reduction":0.15}'::JSONB,
   1, 1, TRUE, FALSE, 1, 'fishing_tackle_earthworm'),
  ('fishing:tackle:slime_slug', 'Slime Slug',
   'Sticky bait that reduces the server-rolled wait by 30%.',
   'material', NULL, '{"fishing_tackle":true,"wait_reduction":0.30}'::JSONB,
   1, 3, TRUE, FALSE, 2, 'fishing_tackle_slime_slug'),
  ('fishing:tackle:gilded_spinner', 'Gilded Spinner',
   'A bright lure that reduces the server-rolled wait by 50%.',
   'material', NULL, '{"fishing_tackle":true,"wait_reduction":0.50}'::JSONB,
   1, 10, TRUE, FALSE, 3, 'fishing_tackle_gilded_spinner'),
  ('fishing:tackle:abyssal_lure', 'Abyssal Lure',
   'A forbidden lure that reduces the server-rolled wait by 75%.',
   'material', NULL, '{"fishing_tackle":true,"wait_reduction":0.75}'::JSONB,
   1, 40, TRUE, FALSE, 5, 'fishing_tackle_abyssal_lure')
ON CONFLICT (catalog_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  item_type = EXCLUDED.item_type,
  equipment_slot = EXCLUDED.equipment_slot,
  stat_bonuses = EXCLUDED.stat_bonuses,
  level_requirement = EXCLUDED.level_requirement,
  base_price = EXCLUDED.base_price,
  is_stackable = EXCLUDED.is_stackable,
  is_tradeable = EXCLUDED.is_tradeable,
  rarity = EXCLUDED.rarity,
  sprite_id = EXCLUDED.sprite_id;

-- Fixed tackle drops are independent entries in the enemy drop table. Replace
-- only this field so ordinary loot chances, pools, and rarity weights remain
-- byte-for-byte authoritative.
UPDATE enemy_templates
SET drop_table = jsonb_set(
  CASE
    WHEN jsonb_typeof(drop_table) = 'object' THEN drop_table
    ELSE '{}'::JSONB
  END,
  '{fixedDrops}',
  '[{"catalogKey":"fishing:tackle:earthworm","chance":0.03}]'::JSONB,
  TRUE
)
WHERE LOWER(name) = 'harpy';

UPDATE enemy_templates
SET drop_table = jsonb_set(
  CASE
    WHEN jsonb_typeof(drop_table) = 'object' THEN drop_table
    ELSE '{}'::JSONB
  END,
  '{fixedDrops}',
  '[{"catalogKey":"fishing:tackle:slime_slug","chance":0.02}]'::JSONB,
  TRUE
)
WHERE LOWER(name) = 'forest slime';

UPDATE enemy_templates
SET drop_table = jsonb_set(
  CASE
    WHEN jsonb_typeof(drop_table) = 'object' THEN drop_table
    ELSE '{}'::JSONB
  END,
  '{fixedDrops}',
  '[{"catalogKey":"fishing:tackle:gilded_spinner","chance":0.01}]'::JSONB,
  TRUE
)
WHERE LOWER(name) = 'bridge bandit';

UPDATE enemy_templates
SET drop_table = jsonb_set(
  CASE
    WHEN jsonb_typeof(drop_table) = 'object' THEN drop_table
    ELSE '{}'::JSONB
  END,
  '{fixedDrops}',
  '[{"catalogKey":"fishing:tackle:abyssal_lure","chance":0.005}]'::JSONB,
  TRUE
)
WHERE LOWER(name) = 'bridge troll';
