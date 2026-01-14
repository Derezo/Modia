-- Migration: Regional World System
-- ============================================
-- Adds 5-region system based on racial homelands
-- Each region has a castle, keep, guild, and dominant terrain
-- Characters track their home region for spawn/respawn

-- ============================================
-- WORLD REGIONS TABLE
-- ============================================
-- Stores metadata for each racial homeland region
CREATE TABLE IF NOT EXISTS world_regions (
  id SERIAL PRIMARY KEY,
  race VARCHAR(20) NOT NULL,
  castle_node_id INTEGER REFERENCES world_nodes(id) ON DELETE SET NULL,
  keep_node_id INTEGER REFERENCES world_nodes(id) ON DELETE SET NULL,
  guild_node_id INTEGER REFERENCES world_nodes(id) ON DELETE SET NULL,
  dominant_terrain VARCHAR(20) NOT NULL,
  secondary_terrains JSONB NOT NULL DEFAULT '[]',
  boundary_polygon JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- WORLD NODES - REGION TRACKING
-- ============================================
-- Add region tracking columns to world_nodes
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS region_id INTEGER;
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS region_race VARCHAR(20);
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS ring_distance INTEGER;

-- ============================================
-- CHARACTERS - HOME REGION
-- ============================================
-- Track character home region for spawn/respawn location
ALTER TABLE characters ADD COLUMN IF NOT EXISTS home_region_id INTEGER REFERENCES world_regions(id) ON DELETE SET NULL;

-- ============================================
-- INDEXES
-- ============================================
-- Optimize queries for region-based lookups
CREATE INDEX IF NOT EXISTS idx_world_nodes_region ON world_nodes(region_id);
CREATE INDEX IF NOT EXISTS idx_world_nodes_region_race ON world_nodes(region_race);
CREATE INDEX IF NOT EXISTS idx_world_nodes_ring ON world_nodes(ring_distance);
CREATE INDEX IF NOT EXISTS idx_characters_home_region ON characters(home_region_id);
CREATE INDEX IF NOT EXISTS idx_world_regions_race ON world_regions(race);
