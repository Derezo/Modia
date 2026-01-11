-- Migration 019: Node Blocking System
-- Adds user-specific node clearance tracking for combat node progression

-- User node clearance tracking table
-- Tracks which combat nodes each user has cleared by defeating enemies
CREATE TABLE user_node_clearance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  cleared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  battle_id INTEGER REFERENCES battles(id),  -- Which battle cleared it (optional)
  UNIQUE(user_id, node_id)
);

-- Indexes for efficient lookups
CREATE INDEX idx_user_clearance_user ON user_node_clearance(user_id);
CREATE INDEX idx_user_clearance_node ON user_node_clearance(node_id);

-- Function to check if a node is blocked for a specific user
-- Combat nodes (forest, cave, mountain, bridge) start blocked until cleared
CREATE OR REPLACE FUNCTION is_node_blocked(p_user_id INTEGER, p_node_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_node_type TEXT;
  v_is_cleared BOOLEAN;
BEGIN
  -- Get node type
  SELECT node_type::TEXT INTO v_node_type FROM world_nodes WHERE id = p_node_id;

  -- Only combat nodes can be blocked
  IF v_node_type NOT IN ('forest', 'cave', 'mountain', 'bridge') THEN
    RETURN FALSE;
  END IF;

  -- Check if user has cleared this node
  SELECT EXISTS(
    SELECT 1 FROM user_node_clearance
    WHERE user_id = p_user_id AND node_id = p_node_id
  ) INTO v_is_cleared;

  -- Blocked if NOT cleared
  RETURN NOT v_is_cleared;
END;
$$ LANGUAGE plpgsql;

-- Function to get all blocked nodes for a user (for efficient pathfinding)
CREATE OR REPLACE FUNCTION get_blocked_nodes(p_user_id INTEGER)
RETURNS TABLE(node_id INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT wn.id
  FROM world_nodes wn
  WHERE wn.node_type IN ('forest', 'cave', 'mountain', 'bridge')
  AND NOT EXISTS (
    SELECT 1 FROM user_node_clearance unc
    WHERE unc.user_id = p_user_id AND unc.node_id = wn.id
  );
END;
$$ LANGUAGE plpgsql;

-- Function to mark a node as cleared for a user
CREATE OR REPLACE FUNCTION clear_node_for_user(
  p_user_id INTEGER,
  p_node_id INTEGER,
  p_battle_id INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO user_node_clearance (user_id, node_id, battle_id)
  VALUES (p_user_id, p_node_id, p_battle_id)
  ON CONFLICT (user_id, node_id) DO NOTHING;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
