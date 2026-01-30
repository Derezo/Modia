-- Migration 042: Starting Trait Mappings
-- ============================================
-- Creates predetermined trait assignments for new characters based on race/class
-- Each race/class combination gets a trait that complements their playstyle

CREATE TABLE starting_trait_mappings (
  id SERIAL PRIMARY KEY,
  race VARCHAR(20) NOT NULL,
  class VARCHAR(20) NOT NULL,
  trait_id INTEGER NOT NULL REFERENCES traits(id),
  CONSTRAINT unique_race_class UNIQUE (race, class)
);

CREATE INDEX idx_starting_trait_mappings_race_class ON starting_trait_mappings(race, class);

COMMENT ON TABLE starting_trait_mappings IS 'Maps race/class combinations to starting traits for new characters';
COMMENT ON COLUMN starting_trait_mappings.race IS 'Character race (human, elf, dwarf, vampire, orc)';
COMMENT ON COLUMN starting_trait_mappings.class IS 'Character class (warrior, wizard, monk, chemist)';
COMMENT ON COLUMN starting_trait_mappings.trait_id IS 'The trait assigned to this race/class combination';

-- ============================================
-- STARTING TRAIT MAPPINGS (5 races x 4 classes = 20 mappings)
-- ============================================
-- Philosophy: Traits compensate for racial weaknesses or enhance class synergies

-- Human (balanced, compensate class gaps)
INSERT INTO starting_trait_mappings (race, class, trait_id) VALUES
  ('human', 'warrior', (SELECT id FROM traits WHERE name = 'Tough Skin')),
  ('human', 'wizard', (SELECT id FROM traits WHERE name = 'Mana Well')),
  ('human', 'monk', (SELECT id FROM traits WHERE name = 'Swift Feet')),
  ('human', 'chemist', (SELECT id FROM traits WHERE name = 'Fast Learner'));

-- Elf (high INT/AGI, compensate VIT)
INSERT INTO starting_trait_mappings (race, class, trait_id) VALUES
  ('elf', 'warrior', (SELECT id FROM traits WHERE name = 'Vitality')),
  ('elf', 'wizard', (SELECT id FROM traits WHERE name = 'Arcane Affinity')),
  ('elf', 'monk', (SELECT id FROM traits WHERE name = 'Quick Reflexes')),
  ('elf', 'chemist', (SELECT id FROM traits WHERE name = 'Eagle Eye'));

-- Dwarf (high STR/VIT, compensate INT)
INSERT INTO starting_trait_mappings (race, class, trait_id) VALUES
  ('dwarf', 'warrior', (SELECT id FROM traits WHERE name = 'Heavy Hitter')),
  ('dwarf', 'wizard', (SELECT id FROM traits WHERE name = 'Mana Well')),
  ('dwarf', 'monk', (SELECT id FROM traits WHERE name = 'Regeneration')),
  ('dwarf', 'chemist', (SELECT id FROM traits WHERE name = 'Treasure Hunter'));

-- Vampire (high AGI, lifesteal synergy)
INSERT INTO starting_trait_mappings (race, class, trait_id) VALUES
  ('vampire', 'warrior', (SELECT id FROM traits WHERE name = 'Berserker Blood')),
  ('vampire', 'wizard', (SELECT id FROM traits WHERE name = 'Sharp Mind')),
  ('vampire', 'monk', (SELECT id FROM traits WHERE name = 'Initiative')),
  ('vampire', 'chemist', (SELECT id FROM traits WHERE name = 'Regeneration'));

-- Orc (high STR, compensate INT/finesse)
INSERT INTO starting_trait_mappings (race, class, trait_id) VALUES
  ('orc', 'warrior', (SELECT id FROM traits WHERE name = 'Strong Arm')),
  ('orc', 'wizard', (SELECT id FROM traits WHERE name = 'Tough Skin')),
  ('orc', 'monk', (SELECT id FROM traits WHERE name = 'Precision')),
  ('orc', 'chemist', (SELECT id FROM traits WHERE name = 'Vitality'));
