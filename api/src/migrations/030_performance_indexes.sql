-- Performance indexes for regional world queries
-- Adds composite indexes identified during technical debt analysis

-- Composite index for region progress queries (HIGH priority)
-- Used by: world.js getRegionProgress endpoint for counting nodes by type within regions
-- Query pattern: SELECT node_type, COUNT(*) FROM world_nodes WHERE region_id = $1 GROUP BY node_type
CREATE INDEX IF NOT EXISTS idx_world_nodes_type_region
ON world_nodes(node_type, region_id);

-- Composite index for discovery lookups (MEDIUM priority)
-- Used by: world.js discovery joins to check if user has discovered specific nodes
-- Query pattern: SELECT * FROM user_node_discovery WHERE user_id = $1 AND node_id = $2
CREATE INDEX IF NOT EXISTS idx_user_discovery_user_node
ON user_node_discovery(user_id, node_id);

-- Composite index for clearance lookups (MEDIUM priority)
-- Used by: world.js clearance joins to check if user has cleared specific nodes
-- Query pattern: SELECT * FROM user_node_clearance WHERE user_id = $1 AND node_id = $2
CREATE INDEX IF NOT EXISTS idx_user_clearance_user_node
ON user_node_clearance(user_id, node_id);

-- Partial index for combat node queries (MEDIUM priority)
-- Used by: world.js combat node filtering, enemy spawning decisions
-- Query pattern: SELECT * FROM world_nodes WHERE region_id = $1 AND node_type IN ('forest', 'cave', 'mountain', 'bridge')
CREATE INDEX IF NOT EXISTS idx_world_nodes_combat
ON world_nodes(region_id, ring_distance)
WHERE node_type IN ('forest', 'cave', 'mountain', 'bridge');
