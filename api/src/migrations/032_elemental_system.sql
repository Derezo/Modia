-- Migration 032: Elemental Damage System
-- Adds elemental resistances to enemy templates for the 8-element damage system:
-- fire, ice, lightning, earth, wind, water, holy, dark
--
-- Resistance values: negative = weak (more damage), positive = resist (less damage)
-- -100 = 200% damage (very weak)
-- -50 = 150% damage (weak)
-- 0 = 100% damage (normal)
-- 50 = 50% damage (resist)
-- 90 = 10% damage (highly resistant, capped)
-- 100 = immune
-- 150 = absorb (heals instead)

-- Add elemental_resistances column to enemy_templates if it doesn't exist
-- Using JSONB for flexible resistance storage
-- Note: This column may be used by battleUnitFactory when generating enemy units
ALTER TABLE enemy_templates ADD COLUMN IF NOT EXISTS elemental_resistances JSONB DEFAULT '{}';

-- Create an index for faster queries on enemies with specific resistances
CREATE INDEX IF NOT EXISTS idx_enemy_templates_elemental ON enemy_templates USING GIN (elemental_resistances);

-- Seed thematic elemental resistances based on enemy archetypes and names
-- These are applied in the application layer (enemies.js template) rather than here
-- to keep all enemy data in one place for easier maintenance

COMMENT ON COLUMN enemy_templates.elemental_resistances IS 'JSON object mapping element names to resistance values. Negative = weakness, positive = resistance. Example: {"fire": -50, "ice": 50}';
