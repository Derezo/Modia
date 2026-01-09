-- Migration 012: Guild Recruitment System
-- ============================================
-- Adds tables for guild recruit pools, traits, and character traits
-- Enables hiring NPCs from guild halls with unique traits and starting skills

-- ============================================
-- TRAIT DEFINITIONS
-- ============================================
-- Traits are innate bonuses that recruits can have
-- Categories: combat, survival, utility, situational
-- Rarities affect both power and spawn rate

CREATE TABLE traits (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('combat', 'survival', 'utility', 'situational')),
  rarity VARCHAR(20) NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'legendary')),
  effect_type VARCHAR(50) NOT NULL,
  effect_value DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_traits_category ON traits(category);
CREATE INDEX idx_traits_rarity ON traits(rarity);

COMMENT ON TABLE traits IS 'Innate trait definitions that can be assigned to guild recruits';
COMMENT ON COLUMN traits.category IS 'combat, survival, utility, or situational';
COMMENT ON COLUMN traits.rarity IS 'common, uncommon, rare, or legendary - affects spawn rate';
COMMENT ON COLUMN traits.effect_type IS 'The type of effect this trait provides (e.g., damage_bonus, hp_regen)';
COMMENT ON COLUMN traits.effect_value IS 'The magnitude of the effect (percentages as decimals, e.g., 0.10 = 10%)';

-- ============================================
-- GUILD RECRUIT POOL
-- ============================================
-- Recruits available for hire at guild nodes
-- Generated procedurally based on guild class and node seed
-- Refreshed daily at guild-specific times

CREATE TABLE guild_recruits (
  id SERIAL PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  race VARCHAR(20) NOT NULL,
  gender VARCHAR(20) NOT NULL,
  class VARCHAR(20) NOT NULL,
  level INTEGER DEFAULT 1 CHECK (level >= 1 AND level <= 256),
  hp_max INTEGER NOT NULL CHECK (hp_max > 0),
  mp_max INTEGER NOT NULL CHECK (mp_max >= 0),
  strength INTEGER NOT NULL CHECK (strength > 0),
  intelligence INTEGER NOT NULL CHECK (intelligence > 0),
  agility INTEGER NOT NULL CHECK (agility > 0),
  vitality INTEGER NOT NULL CHECK (vitality > 0),
  luck INTEGER NOT NULL CHECK (luck > 0),
  stat_variance_percent DECIMAL(5,2) DEFAULT 0 CHECK (stat_variance_percent >= -50 AND stat_variance_percent <= 50),
  xp_pool INTEGER NOT NULL CHECK (xp_pool >= 50 AND xp_pool <= 150),
  price INTEGER NOT NULL CHECK (price > 0),
  is_emergency_restock BOOLEAN DEFAULT FALSE,
  purchased_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  purchased_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_guild_recruits_node ON guild_recruits(node_id);
CREATE INDEX idx_guild_recruits_available ON guild_recruits(node_id, purchased_by) WHERE purchased_by IS NULL;
CREATE INDEX idx_guild_recruits_purchased_by ON guild_recruits(purchased_by) WHERE purchased_by IS NOT NULL;
CREATE INDEX idx_guild_recruits_class ON guild_recruits(class);

COMMENT ON TABLE guild_recruits IS 'Pool of recruits available for hire at guild nodes';
COMMENT ON COLUMN guild_recruits.stat_variance_percent IS 'Percentage variance from base stats (-50 to +50)';
COMMENT ON COLUMN guild_recruits.xp_pool IS 'Initial XP to distribute (50-150), affects starting skill points';
COMMENT ON COLUMN guild_recruits.is_emergency_restock IS 'True if generated via emergency restock (higher cost)';
COMMENT ON COLUMN guild_recruits.purchased_by IS 'User ID who purchased this recruit, NULL if available';

-- ============================================
-- RECRUIT TRAITS (junction table)
-- ============================================
-- Each recruit can have 1-2 traits assigned
-- These become permanent character traits on purchase

CREATE TABLE recruit_traits (
  id SERIAL PRIMARY KEY,
  recruit_id INTEGER NOT NULL REFERENCES guild_recruits(id) ON DELETE CASCADE,
  trait_id INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
  CONSTRAINT unique_recruit_trait UNIQUE (recruit_id, trait_id)
);

CREATE INDEX idx_recruit_traits_recruit ON recruit_traits(recruit_id);
CREATE INDEX idx_recruit_traits_trait ON recruit_traits(trait_id);

COMMENT ON TABLE recruit_traits IS 'Maps recruits to their innate traits (1-2 per recruit)';

-- ============================================
-- RECRUIT STARTING SKILLS
-- ============================================
-- Each recruit can have 0-2 starting skills
-- skill_id references the skill trees in shared constants

CREATE TABLE recruit_skills (
  id SERIAL PRIMARY KEY,
  recruit_id INTEGER NOT NULL REFERENCES guild_recruits(id) ON DELETE CASCADE,
  skill_id VARCHAR(50) NOT NULL,
  CONSTRAINT unique_recruit_skill UNIQUE (recruit_id, skill_id)
);

CREATE INDEX idx_recruit_skills_recruit ON recruit_skills(recruit_id);
CREATE INDEX idx_recruit_skills_skill ON recruit_skills(skill_id);

COMMENT ON TABLE recruit_skills IS 'Starting skills for recruits (0-2 per recruit)';
COMMENT ON COLUMN recruit_skills.skill_id IS 'References skill IDs from character skill trees';

-- ============================================
-- CHARACTER TRAITS (for purchased recruits)
-- ============================================
-- When a recruit is purchased, their traits transfer to the character
-- These traits persist for the character's lifetime

CREATE TABLE character_traits (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  trait_id INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_character_trait UNIQUE (character_id, trait_id)
);

CREATE INDEX idx_character_traits_character ON character_traits(character_id);
CREATE INDEX idx_character_traits_trait ON character_traits(trait_id);

COMMENT ON TABLE character_traits IS 'Permanent traits assigned to characters (from hired recruits)';

-- ============================================
-- WORLD NODE RECRUIT REFRESH COLUMNS
-- ============================================
-- Add columns to track guild recruit refresh schedules

ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS recruit_refresh_hour INTEGER CHECK (recruit_refresh_hour >= 0 AND recruit_refresh_hour < 24);
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS last_recruit_refresh TIMESTAMP;

CREATE INDEX idx_world_nodes_recruit_refresh ON world_nodes(recruit_refresh_hour) WHERE node_type = 'guild';

COMMENT ON COLUMN world_nodes.recruit_refresh_hour IS 'Hour of day (0-23 UTC) when guild recruits refresh';
COMMENT ON COLUMN world_nodes.last_recruit_refresh IS 'Timestamp of last recruit pool refresh';

-- ============================================
-- SEED DATA: TRAIT DEFINITIONS
-- ============================================
-- Populate with initial trait set covering all categories and rarities

-- Combat traits
INSERT INTO traits (name, description, category, rarity, effect_type, effect_value) VALUES
  ('Strong Arm', 'Increases physical damage dealt by 5%', 'combat', 'common', 'physical_damage_bonus', 0.05),
  ('Sharp Mind', 'Increases magical damage dealt by 5%', 'combat', 'common', 'magic_damage_bonus', 0.05),
  ('Quick Reflexes', 'Increases agility-based evasion by 5%', 'combat', 'common', 'evasion_bonus', 0.05),
  ('Heavy Hitter', 'Increases critical hit damage by 10%', 'combat', 'uncommon', 'critical_damage_bonus', 0.10),
  ('Precision', 'Increases accuracy by 8%', 'combat', 'uncommon', 'accuracy_bonus', 0.08),
  ('Berserker Blood', 'Increases damage dealt by 15% when below 30% HP', 'combat', 'rare', 'low_hp_damage_bonus', 0.15),
  ('Arcane Affinity', 'Reduces MP costs by 12%', 'combat', 'rare', 'mp_cost_reduction', 0.12),
  ('Battle Master', 'Increases all damage dealt by 10%', 'combat', 'legendary', 'all_damage_bonus', 0.10)
ON CONFLICT (name) DO NOTHING;

-- Survival traits
INSERT INTO traits (name, description, category, rarity, effect_type, effect_value) VALUES
  ('Tough Skin', 'Reduces physical damage taken by 5%', 'survival', 'common', 'physical_resistance', 0.05),
  ('Magic Resistance', 'Reduces magical damage taken by 5%', 'survival', 'common', 'magic_resistance', 0.05),
  ('Vitality', 'Increases maximum HP by 8%', 'survival', 'common', 'hp_bonus', 0.08),
  ('Regeneration', 'Regenerate 2% HP per turn', 'survival', 'uncommon', 'hp_regen_percent', 0.02),
  ('Mana Well', 'Increases maximum MP by 10%', 'survival', 'uncommon', 'mp_bonus', 0.10),
  ('Iron Will', 'Reduces all damage taken by 8%', 'survival', 'rare', 'all_resistance', 0.08),
  ('Second Wind', 'Survive a killing blow once per battle with 1 HP', 'survival', 'rare', 'death_save', 1.00),
  ('Immortal Spirit', 'Increases HP and MP by 12%', 'survival', 'legendary', 'hp_mp_bonus', 0.12)
ON CONFLICT (name) DO NOTHING;

-- Utility traits
INSERT INTO traits (name, description, category, rarity, effect_type, effect_value) VALUES
  ('Swift Feet', 'Increases movement range by 1 tile', 'utility', 'common', 'movement_bonus', 1.00),
  ('Eagle Eye', 'Increases attack range by 1 tile', 'utility', 'common', 'range_bonus', 1.00),
  ('Fast Learner', 'Increases experience gained by 10%', 'utility', 'uncommon', 'xp_bonus', 0.10),
  ('Treasure Hunter', 'Increases gold drops by 15%', 'utility', 'uncommon', 'gold_bonus', 0.15),
  ('Initiative', 'Increases turn order priority by 15%', 'utility', 'rare', 'initiative_bonus', 0.15),
  ('Prodigy', 'Increases experience gained by 20%', 'utility', 'rare', 'xp_bonus', 0.20),
  ('Fortune Blessed', 'Increases luck stat effectiveness by 25%', 'utility', 'legendary', 'luck_effectiveness', 0.25)
ON CONFLICT (name) DO NOTHING;

-- Situational traits
INSERT INTO traits (name, description, category, rarity, effect_type, effect_value) VALUES
  ('Forest Walker', 'Bonus movement in forest terrain', 'situational', 'common', 'forest_movement', 1.00),
  ('Mountain Climber', 'Bonus movement in mountain terrain', 'situational', 'common', 'mountain_movement', 1.00),
  ('Night Owl', 'Increased stats during night battles', 'situational', 'uncommon', 'night_bonus', 0.08),
  ('Dragon Slayer', 'Bonus damage against dragon-type enemies', 'situational', 'uncommon', 'dragon_damage_bonus', 0.15),
  ('Undead Bane', 'Bonus damage against undead-type enemies', 'situational', 'uncommon', 'undead_damage_bonus', 0.15),
  ('Demon Hunter', 'Bonus damage against demon-type enemies', 'situational', 'rare', 'demon_damage_bonus', 0.20),
  ('Boss Killer', 'Bonus damage against boss enemies', 'situational', 'rare', 'boss_damage_bonus', 0.20),
  ('Chosen One', 'All situational bonuses apply at 50% effectiveness', 'situational', 'legendary', 'universal_situational', 0.50)
ON CONFLICT (name) DO NOTHING;
