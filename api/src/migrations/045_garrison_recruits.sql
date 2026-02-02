-- Migration: 045_garrison_recruits
-- Description: Garrison recruit pool for castle nodes (faction-specific hireable NPCs)
-- Date: 2026-02-01

-- ============================================
-- GARRISON RECRUITS TABLE
-- ============================================
-- Recruits available for hire at castle nodes
-- Similar to guild_recruits but tied to castle garrisons
-- Refreshed periodically based on castle seed

CREATE TABLE garrison_recruits (
    id SERIAL PRIMARY KEY,
    castle_node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    race race_type NOT NULL,
    class class_type NOT NULL,
    level INTEGER DEFAULT 1 CHECK (level >= 1 AND level <= 256),
    experience INTEGER DEFAULT 0 CHECK (experience >= 0),
    stats JSONB NOT NULL,
    traits JSONB DEFAULT '[]',
    equipment JSONB DEFAULT '[]',
    skills JSONB DEFAULT '[]',
    price INTEGER NOT NULL CHECK (price > 0),
    generated_at TIMESTAMP DEFAULT NOW(),
    purchased_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    purchased_at TIMESTAMP
);

-- Index for looking up recruits by castle
CREATE INDEX idx_garrison_castle ON garrison_recruits(castle_node_id);

-- Partial index for available (unpurchased) recruits at a castle
CREATE INDEX idx_garrison_available ON garrison_recruits(castle_node_id)
    WHERE purchased_by IS NULL;

-- Index for finding recruits purchased by a specific user
CREATE INDEX idx_garrison_purchased_by ON garrison_recruits(purchased_by)
    WHERE purchased_by IS NOT NULL;

COMMENT ON TABLE garrison_recruits IS 'Recruits available for hire at castle garrison nodes';
COMMENT ON COLUMN garrison_recruits.castle_node_id IS 'Reference to the castle world node';
COMMENT ON COLUMN garrison_recruits.stats IS 'Character stats as JSONB: {strength, intelligence, agility, vitality, luck, hp_max, mp_max}';
COMMENT ON COLUMN garrison_recruits.traits IS 'Array of trait objects assigned to this recruit';
COMMENT ON COLUMN garrison_recruits.equipment IS 'Starting equipment as array of item objects';
COMMENT ON COLUMN garrison_recruits.skills IS 'Starting skills as array of skill IDs';
COMMENT ON COLUMN garrison_recruits.price IS 'Gold cost to recruit this unit';
COMMENT ON COLUMN garrison_recruits.purchased_by IS 'User ID who purchased this recruit, NULL if available';
