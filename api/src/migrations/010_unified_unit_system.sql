-- Migration 010: Unified Unit System
-- Adds fields to enemy_templates to support the unified BattleUnit abstraction
-- Enables NPCs to have classes, guilds, movement ranges, and combat bonuses

-- Add new columns to enemy_templates for unified unit system
ALTER TABLE enemy_templates
  ADD COLUMN IF NOT EXISTS enemy_class VARCHAR(32) DEFAULT 'monster',
  ADD COLUMN IF NOT EXISTS movement INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS attack_range INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attack_bonus INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defense_bonus INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS magic_attack_bonus INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS magic_defense_bonus INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archetype VARCHAR(32) DEFAULT 'beast',
  ADD COLUMN IF NOT EXISTS guild VARCHAR(32),
  ADD COLUMN IF NOT EXISTS guild_level INTEGER DEFAULT 1;

-- Add index for archetype lookups (used by monster skill trees)
CREATE INDEX IF NOT EXISTS idx_enemy_templates_archetype ON enemy_templates(archetype);

-- Add index for guild lookups (used by humanoid NPCs)
CREATE INDEX IF NOT EXISTS idx_enemy_templates_guild ON enemy_templates(guild);

-- Update existing enemy templates with appropriate archetypes based on their names
-- This provides initial data for the monster skill system

-- Forest creatures -> beast archetype
UPDATE enemy_templates SET archetype = 'beast'
WHERE LOWER(name) LIKE '%wolf%' OR LOWER(name) LIKE '%bear%' OR LOWER(name) LIKE '%boar%'
   OR LOWER(name) LIKE '%spider%' OR LOWER(name) LIKE '%rat%' OR LOWER(name) LIKE '%snake%';

-- Undead creatures
UPDATE enemy_templates SET archetype = 'undead'
WHERE LOWER(name) LIKE '%skeleton%' OR LOWER(name) LIKE '%zombie%' OR LOWER(name) LIKE '%ghost%'
   OR LOWER(name) LIKE '%wraith%' OR LOWER(name) LIKE '%lich%' OR LOWER(name) LIKE '%vampire%';

-- Dragons
UPDATE enemy_templates SET archetype = 'dragon', movement = 4, attack_range = 2
WHERE LOWER(name) LIKE '%dragon%' OR LOWER(name) LIKE '%drake%' OR LOWER(name) LIKE '%wyrm%';

-- Elementals
UPDATE enemy_templates SET archetype = 'elemental'
WHERE LOWER(name) LIKE '%elemental%' OR LOWER(name) LIKE '%golem%' OR LOWER(name) LIKE '%spirit%';

-- Insects
UPDATE enemy_templates SET archetype = 'insect'
WHERE LOWER(name) LIKE '%spider%' OR LOWER(name) LIKE '%scorpion%' OR LOWER(name) LIKE '%beetle%'
   OR LOWER(name) LIKE '%wasp%' OR LOWER(name) LIKE '%ant%';

-- Plants
UPDATE enemy_templates SET archetype = 'plant'
WHERE LOWER(name) LIKE '%treant%' OR LOWER(name) LIKE '%vine%' OR LOWER(name) LIKE '%fungus%'
   OR LOWER(name) LIKE '%mushroom%' OR LOWER(name) LIKE '%plant%';

-- Demons
UPDATE enemy_templates SET archetype = 'demon'
WHERE LOWER(name) LIKE '%demon%' OR LOWER(name) LIKE '%imp%' OR LOWER(name) LIKE '%devil%'
   OR LOWER(name) LIKE '%fiend%';

-- Constructs
UPDATE enemy_templates SET archetype = 'construct', defense_bonus = 5
WHERE LOWER(name) LIKE '%golem%' OR LOWER(name) LIKE '%construct%' OR LOWER(name) LIKE '%automaton%';

-- Humanoid NPCs (goblins, bandits, etc.) -> humanoid archetype with warrior guild
UPDATE enemy_templates SET archetype = 'humanoid', enemy_class = 'warrior', guild = 'warrior'
WHERE LOWER(name) LIKE '%goblin%' OR LOWER(name) LIKE '%orc%' OR LOWER(name) LIKE '%bandit%'
   OR LOWER(name) LIKE '%thief%' OR LOWER(name) LIKE '%knight%' OR LOWER(name) LIKE '%soldier%';

-- Mage-type humanoids
UPDATE enemy_templates SET archetype = 'humanoid', enemy_class = 'wizard', guild = 'wizard'
WHERE LOWER(name) LIKE '%mage%' OR LOWER(name) LIKE '%wizard%' OR LOWER(name) LIKE '%sorcerer%'
   OR LOWER(name) LIKE '%shaman%' OR LOWER(name) LIKE '%necromancer%';

-- Update movement for fast creatures
UPDATE enemy_templates SET movement = 4
WHERE LOWER(name) LIKE '%wolf%' OR LOWER(name) LIKE '%ninja%' OR LOWER(name) LIKE '%assassin%';

-- Update movement for slow creatures
UPDATE enemy_templates SET movement = 2
WHERE LOWER(name) LIKE '%golem%' OR LOWER(name) LIKE '%treant%' OR LOWER(name) LIKE '%zombie%';

-- Update attack range for ranged creatures
UPDATE enemy_templates SET attack_range = 3
WHERE LOWER(name) LIKE '%archer%' OR LOWER(name) LIKE '%mage%' OR LOWER(name) LIKE '%wizard%';

COMMENT ON COLUMN enemy_templates.enemy_class IS 'Class for skill lookup (monster, warrior, wizard, etc.)';
COMMENT ON COLUMN enemy_templates.archetype IS 'Monster archetype for skill trees (beast, dragon, undead, etc.)';
COMMENT ON COLUMN enemy_templates.guild IS 'Guild for humanoid NPCs (warrior, wizard, monk, chemist)';
COMMENT ON COLUMN enemy_templates.guild_level IS 'Guild level for humanoid NPCs (affects skill selection)';
COMMENT ON COLUMN enemy_templates.movement IS 'Base movement range in tiles';
COMMENT ON COLUMN enemy_templates.attack_range IS 'Base attack range in tiles (1 = melee)';
