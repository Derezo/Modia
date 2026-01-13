-- Migration: Add terrain barriers (obstacles) to world map
-- These provide visual features like lakes, mountain ranges, and dense forests

CREATE TABLE IF NOT EXISTS world_obstacles (
  id SERIAL PRIMARY KEY,
  obstacle_type VARCHAR(32) NOT NULL,  -- lake, mountain_range, dense_forest
  x DECIMAL NOT NULL,
  y DECIMAL NOT NULL,
  radius DECIMAL,           -- for circular obstacles (lakes, dense forests)
  length DECIMAL,           -- for linear obstacles (mountain ranges)
  angle DECIMAL,            -- rotation angle for linear obstacles (radians)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for spatial queries
CREATE INDEX IF NOT EXISTS idx_world_obstacles_position ON world_obstacles(x, y);
CREATE INDEX IF NOT EXISTS idx_world_obstacles_type ON world_obstacles(obstacle_type);
