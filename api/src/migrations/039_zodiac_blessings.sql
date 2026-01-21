-- Migration: Zodiac crystal relics collection system
-- Tracks which zodiac crystals each user has collected from zodiac shrines

-- Zodiac crystal relics collection
CREATE TABLE IF NOT EXISTS user_zodiac_crystals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zodiac_sign VARCHAR(20) NOT NULL,
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  shrine_node_id INTEGER REFERENCES world_nodes(id),
  UNIQUE(user_id, zodiac_sign)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_zodiac_crystals_user ON user_zodiac_crystals(user_id);

-- Add zodiac_sign column to world_nodes for shrine nodes
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS zodiac_sign VARCHAR(20);

-- Track active zodiac signature abilities
ALTER TABLE user_shrine_visits ADD COLUMN IF NOT EXISTS signature_ability VARCHAR(50);
ALTER TABLE user_shrine_visits ADD COLUMN IF NOT EXISTS signature_used BOOLEAN DEFAULT FALSE;
