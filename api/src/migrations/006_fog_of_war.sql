-- User node discovery tracking for fog of war
CREATE TABLE user_node_discovery (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  discovery_method VARCHAR(20) DEFAULT 'travel', -- 'travel', 'adjacent', 'initial'
  UNIQUE(user_id, node_id)
);

CREATE INDEX idx_user_discovery_user ON user_node_discovery(user_id);
CREATE INDEX idx_user_discovery_node ON user_node_discovery(node_id);

-- Function to discover node and adjacent nodes
CREATE OR REPLACE FUNCTION discover_node_and_adjacent(p_user_id INTEGER, p_node_id INTEGER)
RETURNS void AS $$
BEGIN
  -- Discover the visited node (mark as travel if not already discovered)
  INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
  VALUES (p_user_id, p_node_id, 'travel')
  ON CONFLICT (user_id, node_id)
  DO UPDATE SET discovery_method = 'travel', discovered_at = CURRENT_TIMESTAMP
  WHERE user_node_discovery.discovery_method != 'travel';

  -- Discover adjacent nodes (from connections)
  INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
  SELECT p_user_id,
         CASE WHEN from_node_id = p_node_id THEN to_node_id ELSE from_node_id END,
         'adjacent'
  FROM world_node_connections
  WHERE from_node_id = p_node_id OR to_node_id = p_node_id
  ON CONFLICT (user_id, node_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Initialize new users with starting node discovered
CREATE OR REPLACE FUNCTION initialize_user_discovery()
RETURNS TRIGGER AS $$
DECLARE
  starting_node_id INTEGER;
BEGIN
  -- Find the castle (starting node)
  SELECT id INTO starting_node_id FROM world_nodes WHERE node_type = 'castle' LIMIT 1;

  IF starting_node_id IS NOT NULL THEN
    PERFORM discover_node_and_adjacent(NEW.id, starting_node_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_user_discovery_init
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION initialize_user_discovery();

-- Backfill existing users with castle discovery
INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
SELECT u.id, wn.id, 'initial'
FROM users u
CROSS JOIN world_nodes wn
WHERE wn.node_type = 'castle'
ON CONFLICT DO NOTHING;

-- Also discover adjacent nodes for existing users
INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
SELECT und.user_id,
       CASE WHEN wnc.from_node_id = und.node_id THEN wnc.to_node_id ELSE wnc.from_node_id END,
       'adjacent'
FROM user_node_discovery und
JOIN world_node_connections wnc ON wnc.from_node_id = und.node_id OR wnc.to_node_id = und.node_id
ON CONFLICT DO NOTHING;
