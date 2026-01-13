-- Migration: Add terminator treasure nodes
-- These are special nodes at map edges with exactly 1 connection

-- Add new node types to the enum
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'chest';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'shrine';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'discovery';

-- Add terminator fields to world_nodes
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS is_terminator BOOLEAN DEFAULT FALSE;
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS shrine_buff_type VARCHAR(32);
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS lore_key VARCHAR(64);

-- Track chest loot claims (one-time per user)
CREATE TABLE IF NOT EXISTS user_chest_claims (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  gold_awarded INTEGER NOT NULL DEFAULT 0,
  items_awarded JSONB DEFAULT '[]',
  claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, node_id)
);

-- Track shrine buff visits (with cooldown)
CREATE TABLE IF NOT EXISTS user_shrine_visits (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  buff_type VARCHAR(32) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_visited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, node_id)
);

-- Track discovery unlocks (one-time per user)
CREATE TABLE IF NOT EXISTS user_discoveries (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  lore_key VARCHAR(64),
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, node_id)
);

-- Index for querying active buffs
CREATE INDEX IF NOT EXISTS idx_shrine_visits_expires ON user_shrine_visits(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_shrine_visits_buff_type ON user_shrine_visits(buff_type);
