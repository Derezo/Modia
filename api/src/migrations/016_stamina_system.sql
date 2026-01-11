-- Migration: Stamina System for World Travel
-- Adds stamina tracking to characters for multi-node travel costs

-- Add stamina columns to characters
ALTER TABLE characters
ADD COLUMN stamina INTEGER DEFAULT 8,
ADD COLUMN stamina_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN max_stamina INTEGER DEFAULT 8;

-- Ensure all existing characters have stamina set
UPDATE characters SET stamina = 8, max_stamina = 8, stamina_updated_at = CURRENT_TIMESTAMP
WHERE stamina IS NULL;

-- Add constraints
ALTER TABLE characters
ADD CONSTRAINT stamina_range CHECK (stamina >= 0 AND stamina <= max_stamina),
ADD CONSTRAINT max_stamina_positive CHECK (max_stamina > 0 AND max_stamina <= 20);

-- Index for stamina queries (useful for finding characters needing regen)
CREATE INDEX idx_characters_stamina_updated ON characters(stamina_updated_at)
WHERE stamina < max_stamina;

COMMENT ON COLUMN characters.stamina IS 'Current stamina for world map travel (1 per node)';
COMMENT ON COLUMN characters.stamina_updated_at IS 'Last time stamina was modified (for regen calculation)';
COMMENT ON COLUMN characters.max_stamina IS 'Maximum stamina capacity (default 8)';
