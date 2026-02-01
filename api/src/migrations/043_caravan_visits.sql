-- Migration: 043_caravan_visits
-- Description: Track user visits to merchant caravans for refresh notifications
-- Date: 2026-02-01

-- User caravan visit tracking for notifications
CREATE TABLE IF NOT EXISTS user_caravan_visits (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  last_visited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notify_on_refresh BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (user_id, node_id)
);

-- Index for finding users to notify when a caravan refreshes
CREATE INDEX IF NOT EXISTS idx_caravan_visits_notify
  ON user_caravan_visits(node_id, notify_on_refresh)
  WHERE notify_on_refresh = TRUE;

-- Index for user's visited caravans (for UI display)
CREATE INDEX IF NOT EXISTS idx_caravan_visits_user
  ON user_caravan_visits(user_id, last_visited_at DESC);
