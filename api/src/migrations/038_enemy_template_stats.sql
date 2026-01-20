-- Migration 038: Add base_vitality and base_luck to enemy_templates
-- These columns are referenced by battleUnitFactory.js for enemy stat calculations

ALTER TABLE enemy_templates
  ADD COLUMN IF NOT EXISTS base_vitality INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS base_luck INTEGER DEFAULT 5;

-- Also add archetype column if missing (used for stat growth calculations)
ALTER TABLE enemy_templates
  ADD COLUMN IF NOT EXISTS archetype VARCHAR(32) DEFAULT 'humanoid';

-- Also add elemental_resistances column if missing (used for damage calculations)
ALTER TABLE enemy_templates
  ADD COLUMN IF NOT EXISTS elemental_resistances JSONB DEFAULT '{}';

-- Create index for archetype-based queries
CREATE INDEX IF NOT EXISTS idx_enemy_templates_archetype ON enemy_templates(archetype);
