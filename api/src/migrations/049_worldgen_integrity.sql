-- Persist the finalized world-generation model and its integrity contract.
--
-- New identity envelopes are nullable for legacy rows. Once populated, their
-- component fields must be complete and coherent; ordinary nodes/connections
-- are not assigned route defaults.

CREATE OR REPLACE FUNCTION worldgen_region_ids_are_canonical(
  region_ids JSONB,
  required_length INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  region_id_json JSONB;
  region_id_text TEXT;
  region_id_value NUMERIC;
  previous_region_id NUMERIC := 0;
BEGIN
  IF region_ids IS NULL OR jsonb_typeof(region_ids) <> 'array' THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(region_ids) < 2
     OR (
       required_length IS NOT NULL
       AND jsonb_array_length(region_ids) <> required_length
     ) THEN
    RETURN FALSE;
  END IF;

  FOR region_id_json IN
    SELECT value
    FROM jsonb_array_elements(region_ids)
  LOOP
    IF jsonb_typeof(region_id_json) <> 'number' THEN
      RETURN FALSE;
    END IF;
    region_id_text := region_id_json #>> '{}';
    IF region_id_text !~ '^[1-9][0-9]*$' THEN
      RETURN FALSE;
    END IF;

    region_id_value := region_id_text::NUMERIC;
    IF region_id_value > 2147483647
       OR region_id_value <= previous_region_id THEN
      RETURN FALSE;
    END IF;
    previous_region_id := region_id_value;
  END LOOP;

  RETURN TRUE;
END
$$;

CREATE OR REPLACE FUNCTION worldgen_region_route_suffix(region_ids JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT string_agg(value, '-' ORDER BY ordinal)
  FROM jsonb_array_elements_text(region_ids)
    WITH ORDINALITY AS region_id(value, ordinal)
$$;

-- ============================================================================
-- WORLD NODES
-- ============================================================================

ALTER TABLE world_nodes
  ADD COLUMN IF NOT EXISTS node_key VARCHAR(200);

UPDATE world_nodes
SET node_key = 'legacy:node:' || id
WHERE node_key IS NULL;

ALTER TABLE world_nodes
  ALTER COLUMN node_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_nodes_node_key
  ON world_nodes(node_key);

UPDATE world_nodes
SET difficulty_tier = LEAST(5, GREATEST(1, COALESCE(difficulty_tier, 1)));

UPDATE world_nodes
SET ring_distance = 0
WHERE ring_distance < 0;

DO $$
DECLARE
  legacy_ruins_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO legacy_ruins_count
  FROM world_nodes
  WHERE node_type::text = 'ruins'
    AND (
      ruins_reward_tier IS NULL
      OR ruins_reward_tier NOT BETWEEN 1 AND 3
    );

  UPDATE world_nodes
  SET ruins_reward_tier = 1
  WHERE node_type::text = 'ruins'
    AND (
      ruins_reward_tier IS NULL
      OR ruins_reward_tier NOT BETWEEN 1 AND 3
    );

  RAISE NOTICE
    '049_worldgen_integrity: backfilled % legacy ruins row(s) to reward Tier 1',
    legacy_ruins_count;
END
$$;

UPDATE world_nodes
SET ruins_reward_tier = NULL
WHERE node_type::text <> 'ruins';

ALTER TABLE world_nodes
  ADD COLUMN IF NOT EXISTS opening_role VARCHAR(64),
  ADD COLUMN IF NOT EXISTS opening_destination_node_key VARCHAR(200),
  ADD COLUMN IF NOT EXISTS route_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS route_pair_key VARCHAR(200),
  ADD COLUMN IF NOT EXISTS region_pair JSONB,
  ADD COLUMN IF NOT EXISTS route_kind VARCHAR(32),
  ADD COLUMN IF NOT EXISTS route_order INTEGER,
  ADD COLUMN IF NOT EXISTS segment_index INTEGER,
  ADD COLUMN IF NOT EXISTS segment_kind VARCHAR(96),
  ADD COLUMN IF NOT EXISTS difficulty_policy VARCHAR(64),
  ADD COLUMN IF NOT EXISTS route_difficulty_tier INTEGER;

ALTER TABLE world_nodes
  ALTER COLUMN difficulty_tier SET NOT NULL,
  ALTER COLUMN ruins_reward_tier DROP DEFAULT,
  ALTER COLUMN opening_role DROP DEFAULT,
  ALTER COLUMN opening_destination_node_key DROP DEFAULT,
  ALTER COLUMN route_id DROP DEFAULT,
  ALTER COLUMN route_pair_key DROP DEFAULT,
  ALTER COLUMN region_pair DROP DEFAULT,
  ALTER COLUMN route_kind DROP DEFAULT,
  ALTER COLUMN route_order DROP DEFAULT,
  ALTER COLUMN segment_index DROP DEFAULT,
  ALTER COLUMN segment_kind DROP DEFAULT,
  ALTER COLUMN difficulty_policy DROP DEFAULT,
  ALTER COLUMN route_difficulty_tier DROP DEFAULT;

ALTER TABLE world_nodes
  DROP CONSTRAINT IF EXISTS world_nodes_difficulty_tier_check,
  DROP CONSTRAINT IF EXISTS world_nodes_ring_distance_check,
  DROP CONSTRAINT IF EXISTS world_nodes_ruins_reward_tier_check,
  DROP CONSTRAINT IF EXISTS world_nodes_opening_role_check,
  DROP CONSTRAINT IF EXISTS world_nodes_opening_destination_check,
  DROP CONSTRAINT IF EXISTS world_nodes_opening_destination_node_key_fkey,
  DROP CONSTRAINT IF EXISTS world_nodes_region_pair_check,
  DROP CONSTRAINT IF EXISTS world_nodes_route_metadata_check;

ALTER TABLE world_nodes
  ADD CONSTRAINT world_nodes_difficulty_tier_check
    CHECK (difficulty_tier BETWEEN 1 AND 5),
  ADD CONSTRAINT world_nodes_ring_distance_check
    CHECK (ring_distance IS NULL OR ring_distance >= 0),
  ADD CONSTRAINT world_nodes_ruins_reward_tier_check
    CHECK (
      (
        node_type::text = 'ruins'
        AND ruins_reward_tier IS NOT NULL
        AND ruins_reward_tier BETWEEN 1 AND 3
      )
      OR
      (node_type::text <> 'ruins' AND ruins_reward_tier IS NULL)
    ),
  ADD CONSTRAINT world_nodes_opening_role_check
    CHECK (
      opening_role IS NULL
      OR (
        opening_role = 'designated_safe_destination'
        AND node_type::text IN ('city', 'village', 'guild', 'keep')
      )
      OR (
        opening_role = 'tier_1_boundary'
        AND node_type::text IN ('forest', 'cave', 'mountain', 'bridge')
        AND difficulty_tier = 1
      )
    ),
  ADD CONSTRAINT world_nodes_opening_destination_check
    CHECK (
      opening_destination_node_key IS NULL
      OR node_type::text = 'castle'
    ),
  ADD CONSTRAINT world_nodes_opening_destination_node_key_fkey
    FOREIGN KEY (opening_destination_node_key)
    REFERENCES world_nodes(node_key)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT world_nodes_region_pair_check
    CHECK (
      region_pair IS NULL
      OR worldgen_region_ids_are_canonical(region_pair)
    ),
  ADD CONSTRAINT world_nodes_route_metadata_check
    CHECK (
      (
        route_kind IS NULL
        AND route_id IS NULL
        AND route_pair_key IS NULL
        AND region_pair IS NULL
        AND route_order IS NULL
        AND segment_index IS NULL
        AND segment_kind IS NULL
        AND difficulty_policy IS NULL
        AND route_difficulty_tier IS NULL
      )
      OR
      (
        route_kind IN ('bridge', 'trade', 'wilderness', 'palace')
        AND route_id IS NOT NULL
        AND region_pair IS NOT NULL
        AND worldgen_region_ids_are_canonical(
          region_pair,
          CASE WHEN route_kind = 'palace' THEN NULL ELSE 2 END
        )
        AND route_id =
          route_kind || ':' || worldgen_region_route_suffix(region_pair)
        AND (
          route_pair_key =
            'route-pair:' || worldgen_region_route_suffix(region_pair)
          OR (route_kind = 'palace' AND route_pair_key IS NULL)
        )
        AND segment_index IS NOT NULL
        AND segment_index >= 0
        AND (route_order IS NULL OR route_order >= 0)
        AND segment_kind IS NOT NULL
        AND segment_kind ~ ('^' || route_kind || '(_[a-z0-9]+)*$')
        AND difficulty_policy IS NOT NULL
        AND difficulty_policy = CASE route_kind
          WHEN 'bridge' THEN 'standard_bridge'
          WHEN 'trade' THEN 'lower_risk_trade'
          WHEN 'wilderness' THEN 'higher_risk_wilderness'
          WHEN 'palace' THEN 'palace_approach'
        END
        AND (
          (
            route_kind IN ('trade', 'wilderness')
            AND route_difficulty_tier BETWEEN 1 AND 5
          )
          OR
          (
            route_kind IN ('bridge', 'palace')
            AND route_difficulty_tier IS NULL
          )
        )
      )
    );

CREATE INDEX IF NOT EXISTS idx_world_nodes_opening_destination
  ON world_nodes(opening_destination_node_key)
  WHERE opening_destination_node_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_world_nodes_opening_role
  ON world_nodes(opening_role)
  WHERE opening_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_world_nodes_route_id
  ON world_nodes(route_id)
  WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_world_nodes_route_pair_key
  ON world_nodes(route_pair_key)
  WHERE route_pair_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_world_nodes_route_segment
  ON world_nodes(route_id, segment_index)
  WHERE route_id IS NOT NULL;

-- ============================================================================
-- WORLD REGIONS
-- ============================================================================

ALTER TABLE world_regions
  ADD COLUMN IF NOT EXISTS castle_key VARCHAR(200),
  ADD COLUMN IF NOT EXISTS generator_x INTEGER,
  ADD COLUMN IF NOT EXISTS generator_y INTEGER;

ALTER TABLE world_regions
  ALTER COLUMN castle_key DROP DEFAULT,
  ALTER COLUMN generator_x DROP DEFAULT,
  ALTER COLUMN generator_y DROP DEFAULT;

ALTER TABLE world_regions
  DROP CONSTRAINT IF EXISTS world_regions_generator_identity_check;

ALTER TABLE world_regions
  ADD CONSTRAINT world_regions_generator_identity_check
    CHECK (
      (
        castle_key IS NULL
        AND generator_x IS NULL
        AND generator_y IS NULL
      )
      OR
      (
        castle_key IS NOT NULL
        AND castle_key = 'castle:' || id
        AND generator_x IS NOT NULL
        AND generator_y IS NOT NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_regions_castle_key
  ON world_regions(castle_key)
  WHERE castle_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_world_regions_generator_coordinates
  ON world_regions(generator_x, generator_y)
  WHERE castle_key IS NOT NULL;

CREATE OR REPLACE FUNCTION worldgen_region_identity_is_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.castle_key IS NOT NULL
     AND (
       NEW.castle_key IS DISTINCT FROM OLD.castle_key
       OR NEW.generator_x IS DISTINCT FROM OLD.generator_x
       OR NEW.generator_y IS DISTINCT FROM OLD.generator_y
     ) THEN
    RAISE EXCEPTION
      'world region % generator identity is immutable (% at %,%)',
      OLD.id, OLD.castle_key, OLD.generator_x, OLD.generator_y;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_world_regions_generator_identity_immutable
  ON world_regions;
CREATE TRIGGER trg_world_regions_generator_identity_immutable
BEFORE UPDATE OF castle_key, generator_x, generator_y
ON world_regions
FOR EACH ROW
EXECUTE FUNCTION worldgen_region_identity_is_immutable();

CREATE OR REPLACE FUNCTION worldgen_assert_region_castle_coherence(
  checked_region_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  checked_region world_regions%ROWTYPE;
  checked_castle world_nodes%ROWTYPE;
BEGIN
  SELECT *
  INTO checked_region
  FROM world_regions
  WHERE id = checked_region_id;

  IF NOT FOUND OR checked_region.castle_key IS NULL THEN
    RETURN;
  END IF;

  IF checked_region.castle_node_id IS NULL THEN
    RAISE EXCEPTION
      'world region % has generator identity % but no castle node',
      checked_region.id, checked_region.castle_key;
  END IF;

  SELECT *
  INTO checked_castle
  FROM world_nodes
  WHERE id = checked_region.castle_node_id;

  IF NOT FOUND
     OR checked_castle.node_type::text <> 'castle'
     OR checked_castle.region_id IS DISTINCT FROM checked_region.id
     OR checked_castle.x_coord IS DISTINCT FROM checked_region.generator_x
     OR checked_castle.y_coord IS DISTINCT FROM checked_region.generator_y THEN
    RAISE EXCEPTION
      'world region % generator % at (%,%) disagrees with castle node %',
      checked_region.id,
      checked_region.castle_key,
      checked_region.generator_x,
      checked_region.generator_y,
      checked_region.castle_node_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION worldgen_check_region_castle_from_region()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM worldgen_assert_region_castle_coherence(NEW.id);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_world_regions_castle_coherence
  ON world_regions;
CREATE CONSTRAINT TRIGGER trg_world_regions_castle_coherence
AFTER INSERT OR UPDATE
ON world_regions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION worldgen_check_region_castle_from_region();

CREATE OR REPLACE FUNCTION worldgen_check_region_castle_from_node()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_region_id INTEGER;
BEGIN
  FOR referenced_region_id IN
    SELECT id
    FROM world_regions
    WHERE castle_key IS NOT NULL
      AND castle_node_id IN (OLD.id, NEW.id)
  LOOP
    PERFORM worldgen_assert_region_castle_coherence(referenced_region_id);
  END LOOP;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_world_nodes_castle_coherence
  ON world_nodes;
CREATE CONSTRAINT TRIGGER trg_world_nodes_castle_coherence
AFTER UPDATE
ON world_nodes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION worldgen_check_region_castle_from_node();

-- ============================================================================
-- WORLD NODE CONNECTIONS
-- ============================================================================

ALTER TABLE world_node_connections
  ADD COLUMN IF NOT EXISTS edge_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS opening_role VARCHAR(64),
  ADD COLUMN IF NOT EXISTS route_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS route_pair_key VARCHAR(200),
  ADD COLUMN IF NOT EXISTS region_pair JSONB,
  ADD COLUMN IF NOT EXISTS route_kind VARCHAR(32),
  ADD COLUMN IF NOT EXISTS segment_index INTEGER,
  ADD COLUMN IF NOT EXISTS segment_order INTEGER,
  ADD COLUMN IF NOT EXISTS segment_kind VARCHAR(96),
  ADD COLUMN IF NOT EXISTS difficulty_policy VARCHAR(64),
  ADD COLUMN IF NOT EXISTS route_difficulty_tier INTEGER;

UPDATE world_node_connections
SET edge_key = 'legacy:edge:' || id
WHERE edge_key IS NULL;

-- Clean up the pre-release 049 draft if it was applied manually. Those
-- defaults described ordinary edges as routes; the canonical envelope is null.
UPDATE world_node_connections
SET route_id = NULL,
    route_pair_key = NULL,
    region_pair = NULL,
    route_kind = NULL,
    segment_index = NULL,
    segment_order = NULL,
    segment_kind = NULL,
    difficulty_policy = NULL
WHERE route_id IS NULL
  AND route_kind = 'regional';

UPDATE world_node_connections
SET path_type = 'road'
WHERE path_type IS NULL;

ALTER TABLE world_node_connections
  ALTER COLUMN edge_key SET NOT NULL,
  ALTER COLUMN path_type SET NOT NULL,
  ALTER COLUMN opening_role DROP DEFAULT,
  ALTER COLUMN route_id DROP DEFAULT,
  ALTER COLUMN route_pair_key DROP DEFAULT,
  ALTER COLUMN region_pair DROP DEFAULT,
  ALTER COLUMN route_kind DROP DEFAULT,
  ALTER COLUMN segment_index DROP DEFAULT,
  ALTER COLUMN segment_order DROP DEFAULT,
  ALTER COLUMN segment_kind DROP DEFAULT,
  ALTER COLUMN difficulty_policy DROP DEFAULT,
  ALTER COLUMN route_difficulty_tier DROP DEFAULT;

ALTER TABLE world_node_connections
  DROP CONSTRAINT IF EXISTS world_node_connections_path_type_check,
  DROP CONSTRAINT IF EXISTS world_node_connections_opening_role_check,
  DROP CONSTRAINT IF EXISTS world_node_connections_region_pair_check,
  DROP CONSTRAINT IF EXISTS world_node_connections_route_metadata_check;

ALTER TABLE world_node_connections
  ADD CONSTRAINT world_node_connections_path_type_check
    CHECK (path_type IN ('road', 'trail', 'bridge', 'tunnel')),
  ADD CONSTRAINT world_node_connections_opening_role_check
    CHECK (
      opening_role IS NULL
      OR opening_role IN (
        'designated_safe_edge',
        'tier_1_boundary_edge'
      )
    ),
  ADD CONSTRAINT world_node_connections_region_pair_check
    CHECK (
      region_pair IS NULL
      OR worldgen_region_ids_are_canonical(region_pair)
    ),
  ADD CONSTRAINT world_node_connections_route_metadata_check
    CHECK (
      (
        route_kind IS NULL
        AND route_id IS NULL
        AND route_pair_key IS NULL
        AND region_pair IS NULL
        AND segment_index IS NULL
        AND segment_order IS NULL
        AND segment_kind IS NULL
        AND difficulty_policy IS NULL
        AND route_difficulty_tier IS NULL
      )
      OR
      (
        route_kind IN ('bridge', 'trade', 'wilderness', 'palace')
        AND route_id IS NOT NULL
        AND region_pair IS NOT NULL
        AND worldgen_region_ids_are_canonical(
          region_pair,
          CASE WHEN route_kind = 'palace' THEN NULL ELSE 2 END
        )
        AND route_id =
          route_kind || ':' || worldgen_region_route_suffix(region_pair)
        AND (
          route_pair_key =
            'route-pair:' || worldgen_region_route_suffix(region_pair)
          OR (route_kind = 'palace' AND route_pair_key IS NULL)
        )
        AND segment_index IS NOT NULL
        AND segment_index >= 0
        AND segment_order IS NOT NULL
        AND segment_order = segment_index
        AND segment_kind IS NOT NULL
        AND segment_kind ~ ('^' || route_kind || '(_[a-z0-9]+)*$')
        AND difficulty_policy IS NOT NULL
        AND difficulty_policy = CASE route_kind
          WHEN 'bridge' THEN 'standard_bridge'
          WHEN 'trade' THEN 'lower_risk_trade'
          WHEN 'wilderness' THEN 'higher_risk_wilderness'
          WHEN 'palace' THEN 'palace_approach'
        END
        AND (
          (
            route_kind IN ('trade', 'wilderness')
            AND route_difficulty_tier BETWEEN 1 AND 5
          )
          OR
          (
            route_kind IN ('bridge', 'palace')
            AND route_difficulty_tier IS NULL
          )
        )
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_node_connections_edge_key
  ON world_node_connections(edge_key);
CREATE INDEX IF NOT EXISTS idx_world_node_connections_opening_role
  ON world_node_connections(opening_role)
  WHERE opening_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_world_node_connections_route_id
  ON world_node_connections(route_id)
  WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_world_node_connections_route_pair_key
  ON world_node_connections(route_pair_key)
  WHERE route_pair_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_world_node_connections_route_segment
  ON world_node_connections(route_id, segment_index)
  WHERE route_id IS NOT NULL;

-- ============================================================================
-- SEED METADATA
-- ============================================================================

ALTER TABLE seed_metadata
  ADD COLUMN IF NOT EXISTS generator_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS random_stream_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS structural_graph_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS output_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS route_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS route_manifest_hash CHAR(64);

ALTER TABLE seed_metadata
  DROP CONSTRAINT IF EXISTS seed_metadata_generator_version_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_random_stream_version_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_structural_graph_hash_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_output_hash_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_route_manifest_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_route_manifest_hash_check;

ALTER TABLE seed_metadata
  ADD CONSTRAINT seed_metadata_generator_version_check
    CHECK (generator_version > 0),
  ADD CONSTRAINT seed_metadata_random_stream_version_check
    CHECK (random_stream_version > 0),
  ADD CONSTRAINT seed_metadata_structural_graph_hash_check
    CHECK (
      structural_graph_hash IS NULL
      OR structural_graph_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT seed_metadata_output_hash_check
    CHECK (output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT seed_metadata_route_manifest_check
    CHECK (jsonb_typeof(route_manifest) = 'array'),
  ADD CONSTRAINT seed_metadata_route_manifest_hash_check
    CHECK (
      route_manifest_hash IS NULL
      OR route_manifest_hash ~ '^[0-9a-f]{64}$'
    );
