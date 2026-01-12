-- Migration: 022_seed_metadata
-- Track seed version and world seed to enable smart seeding decisions in dev-setup

CREATE TABLE IF NOT EXISTS seed_metadata (
    id INTEGER PRIMARY KEY DEFAULT 1,
    seed_version INTEGER NOT NULL,
    world_seed INTEGER NOT NULL,
    item_template_count INTEGER NOT NULL DEFAULT 0,
    enemy_template_count INTEGER NOT NULL DEFAULT 0,
    world_node_count INTEGER NOT NULL DEFAULT 0,
    seeded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Singleton pattern: only one row allowed
    CONSTRAINT seed_metadata_singleton CHECK (id = 1)
);

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_seed_metadata_version ON seed_metadata(seed_version);
