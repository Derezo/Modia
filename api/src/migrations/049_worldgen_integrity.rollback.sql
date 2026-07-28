-- Roll back migration 049 finalized world-generation persistence fields.

ALTER TABLE seed_metadata
  DROP CONSTRAINT IF EXISTS seed_metadata_route_manifest_hash_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_route_manifest_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_output_hash_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_structural_graph_hash_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_random_stream_version_check,
  DROP CONSTRAINT IF EXISTS seed_metadata_generator_version_check,
  DROP COLUMN IF EXISTS route_manifest_hash,
  DROP COLUMN IF EXISTS route_manifest,
  DROP COLUMN IF EXISTS output_hash,
  DROP COLUMN IF EXISTS structural_graph_hash,
  DROP COLUMN IF EXISTS random_stream_version,
  DROP COLUMN IF EXISTS generator_version;

DROP INDEX IF EXISTS idx_world_node_connections_route_segment;
DROP INDEX IF EXISTS idx_world_node_connections_route_id;
DROP INDEX IF EXISTS idx_world_node_connections_route_pair_key;
DROP INDEX IF EXISTS idx_world_node_connections_opening_role;
DROP INDEX IF EXISTS idx_world_node_connections_edge_key;

ALTER TABLE world_node_connections
  DROP CONSTRAINT IF EXISTS world_node_connections_route_metadata_check,
  DROP CONSTRAINT IF EXISTS world_node_connections_region_pair_check,
  DROP CONSTRAINT IF EXISTS world_node_connections_opening_role_check,
  DROP CONSTRAINT IF EXISTS world_node_connections_path_type_check,
  DROP COLUMN IF EXISTS route_difficulty_tier,
  DROP COLUMN IF EXISTS difficulty_policy,
  DROP COLUMN IF EXISTS segment_kind,
  DROP COLUMN IF EXISTS segment_order,
  DROP COLUMN IF EXISTS segment_index,
  DROP COLUMN IF EXISTS route_kind,
  DROP COLUMN IF EXISTS region_pair,
  DROP COLUMN IF EXISTS route_pair_key,
  DROP COLUMN IF EXISTS route_id,
  DROP COLUMN IF EXISTS opening_role,
  DROP COLUMN IF EXISTS edge_key;

ALTER TABLE world_node_connections
  ALTER COLUMN path_type DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_world_nodes_castle_coherence
  ON world_nodes;
DROP TRIGGER IF EXISTS trg_world_regions_castle_coherence
  ON world_regions;
DROP TRIGGER IF EXISTS trg_world_regions_generator_identity_immutable
  ON world_regions;
DROP FUNCTION IF EXISTS worldgen_check_region_castle_from_node();
DROP FUNCTION IF EXISTS worldgen_check_region_castle_from_region();
DROP FUNCTION IF EXISTS worldgen_assert_region_castle_coherence(INTEGER);
DROP FUNCTION IF EXISTS worldgen_region_identity_is_immutable();

DROP INDEX IF EXISTS idx_world_regions_generator_coordinates;
DROP INDEX IF EXISTS idx_world_regions_castle_key;

ALTER TABLE world_regions
  DROP CONSTRAINT IF EXISTS world_regions_generator_identity_check,
  DROP COLUMN IF EXISTS generator_y,
  DROP COLUMN IF EXISTS generator_x,
  DROP COLUMN IF EXISTS castle_key;

DROP INDEX IF EXISTS idx_world_nodes_route_segment;
DROP INDEX IF EXISTS idx_world_nodes_route_pair_key;
DROP INDEX IF EXISTS idx_world_nodes_route_id;
DROP INDEX IF EXISTS idx_world_nodes_opening_role;
DROP INDEX IF EXISTS idx_world_nodes_opening_destination;

ALTER TABLE world_nodes
  DROP CONSTRAINT IF EXISTS world_nodes_route_metadata_check,
  DROP CONSTRAINT IF EXISTS world_nodes_region_pair_check,
  DROP CONSTRAINT IF EXISTS world_nodes_opening_destination_node_key_fkey,
  DROP CONSTRAINT IF EXISTS world_nodes_opening_destination_check,
  DROP CONSTRAINT IF EXISTS world_nodes_opening_role_check,
  DROP CONSTRAINT IF EXISTS world_nodes_ruins_reward_tier_check,
  DROP CONSTRAINT IF EXISTS world_nodes_ring_distance_check,
  DROP CONSTRAINT IF EXISTS world_nodes_difficulty_tier_check,
  DROP COLUMN IF EXISTS route_difficulty_tier,
  DROP COLUMN IF EXISTS difficulty_policy,
  DROP COLUMN IF EXISTS segment_kind,
  DROP COLUMN IF EXISTS segment_index,
  DROP COLUMN IF EXISTS route_order,
  DROP COLUMN IF EXISTS route_kind,
  DROP COLUMN IF EXISTS region_pair,
  DROP COLUMN IF EXISTS route_pair_key,
  DROP COLUMN IF EXISTS route_id,
  DROP COLUMN IF EXISTS opening_destination_node_key,
  DROP COLUMN IF EXISTS opening_role;

DROP INDEX IF EXISTS idx_world_nodes_node_key;

ALTER TABLE world_nodes
  DROP COLUMN IF EXISTS node_key;

UPDATE world_nodes
SET ruins_reward_tier = 1
WHERE ruins_reward_tier IS NULL;

ALTER TABLE world_nodes
  ALTER COLUMN difficulty_tier DROP NOT NULL,
  ALTER COLUMN ruins_reward_tier SET DEFAULT 1;

DROP FUNCTION IF EXISTS worldgen_region_route_suffix(JSONB);
DROP FUNCTION IF EXISTS worldgen_region_ids_are_canonical(JSONB, INTEGER);
