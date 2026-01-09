-- Migration 011: NPC Skill System
-- Adds database tables for NPC skills and skill assignments
-- Supports both monster skill trees and humanoid guild skills

-- Table for storing monster skill definitions (populated from monsterSkillTrees.js)
-- This allows database-level queries and assignments while config defines behavior
CREATE TABLE IF NOT EXISTS npc_skill_templates (
  id SERIAL PRIMARY KEY,
  skill_id VARCHAR(64) NOT NULL UNIQUE,
  archetype VARCHAR(32) NOT NULL,
  branch VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  power INTEGER DEFAULT 100,
  range INTEGER DEFAULT 1,
  mp_cost INTEGER DEFAULT 0,
  damage_type VARCHAR(16) DEFAULT 'physical',
  effect VARCHAR(32),
  effect_chance DECIMAL(3,2) DEFAULT 1.0,
  effect_duration INTEGER DEFAULT 0,
  aoe_radius INTEGER DEFAULT 0,
  cooldown INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Junction table linking enemy templates to their available skills
-- Allows fine-grained control over which skills each enemy type can use
CREATE TABLE IF NOT EXISTS enemy_template_skills (
  id SERIAL PRIMARY KEY,
  enemy_template_id INTEGER NOT NULL REFERENCES enemy_templates(id) ON DELETE CASCADE,
  skill_id VARCHAR(64) NOT NULL,
  min_enemy_level INTEGER DEFAULT 1,
  unlock_chance DECIMAL(3,2) DEFAULT 1.0,
  base_skill_level INTEGER DEFAULT 1,
  level_scaling DECIMAL(3,2) DEFAULT 0.1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(enemy_template_id, skill_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_npc_skills_archetype ON npc_skill_templates(archetype);
CREATE INDEX IF NOT EXISTS idx_npc_skills_branch ON npc_skill_templates(archetype, branch);
CREATE INDEX IF NOT EXISTS idx_npc_skills_priority ON npc_skill_templates(priority DESC);
CREATE INDEX IF NOT EXISTS idx_enemy_template_skills_template ON enemy_template_skills(enemy_template_id);
CREATE INDEX IF NOT EXISTS idx_enemy_template_skills_skill ON enemy_template_skills(skill_id);

-- Populate npc_skill_templates with monster skills from monsterSkillTrees.js
-- Beast archetype - Predator branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('beast_bite', 'beast', 'predator', 'Bite', 'A vicious bite attack', 110, 1, 0, 'physical', NULL, 1.0, 0, 6),
  ('beast_claw_swipe', 'beast', 'predator', 'Claw Swipe', 'Slash with sharp claws', 95, 1, 0, 'physical', 'bleed', 0.25, 0, 5),
  ('beast_pounce', 'beast', 'predator', 'Pounce', 'Leap at prey from distance', 120, 2, 5, 'physical', 'stun', 0.20, 0, 7),
  ('beast_savage_bite', 'beast', 'predator', 'Savage Bite', 'A ferocious tearing bite', 140, 1, 10, 'physical', 'bleed', 0.40, 0, 8),
  ('beast_frenzy', 'beast', 'predator', 'Frenzy', 'Enter a wild frenzy', 80, 1, 15, 'physical', 'berserk', 1.0, 0, 6)
ON CONFLICT (skill_id) DO NOTHING;

-- Beast archetype - Pack branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('beast_howl', 'beast', 'pack', 'Howl', 'Rally nearby allies', 0, 0, 5, 'support', 'attack_up', 1.0, 2, 7),
  ('beast_pack_tactics', 'beast', 'pack', 'Pack Tactics', 'Bonus damage near allies', 100, 1, 0, 'physical', NULL, 1.0, 0, 5),
  ('beast_intimidate', 'beast', 'pack', 'Intimidate', 'Frighten enemies', 0, 2, 8, 'debuff', 'fear', 0.60, 0, 6),
  ('beast_coordinated_strike', 'beast', 'pack', 'Coordinated Strike', 'Strike with pack bonus', 130, 1, 12, 'physical', NULL, 1.0, 0, 8)
ON CONFLICT (skill_id) DO NOTHING;

-- Dragon archetype - Breath branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('dragon_fire_breath', 'dragon', 'breath', 'Fire Breath', 'Cone of searing flames', 130, 3, 15, 'fire', 'burn', 0.40, 3, 9),
  ('dragon_frost_breath', 'dragon', 'breath', 'Frost Breath', 'Cone of freezing cold', 120, 3, 15, 'ice', 'slow', 0.50, 2, 8),
  ('dragon_lightning_breath', 'dragon', 'breath', 'Lightning Breath', 'Arc of electricity', 140, 3, 20, 'lightning', 'paralyze', 0.25, 1, 9),
  ('dragon_poison_breath', 'dragon', 'breath', 'Poison Breath', 'Cloud of toxic gas', 100, 3, 12, 'poison', 'poison', 0.60, 4, 7),
  ('dragon_inferno', 'dragon', 'breath', 'Inferno', 'Massive fire explosion', 180, 4, 35, 'fire', 'burn', 0.60, 3, 2, 10)
ON CONFLICT (skill_id) DO NOTHING;

-- Dragon archetype - Physical branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('dragon_tail_swipe', 'dragon', 'physical', 'Tail Swipe', 'Sweep with massive tail', 110, 2, 0, 'physical', 'knockback', 0.50, 0, 6),
  ('dragon_claw_rend', 'dragon', 'physical', 'Claw Rend', 'Tear with dragon claws', 125, 1, 0, 'physical', 'bleed', 0.35, 0, 7),
  ('dragon_wing_buffet', 'dragon', 'physical', 'Wing Buffet', 'Blast with wing wind', 90, 2, 5, 'physical', 'knockback', 0.70, 1, 5),
  ('dragon_crushing_bite', 'dragon', 'physical', 'Crushing Bite', 'Devastating jaw attack', 160, 1, 10, 'physical', 'armor_break', 0.40, 0, 8)
ON CONFLICT (skill_id) DO NOTHING;

-- Dragon archetype - Presence branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('dragon_intimidating_roar', 'dragon', 'presence', 'Intimidating Roar', 'Terrify all nearby', 0, 0, 10, 'debuff', 'fear', 0.70, 3, 8),
  ('dragon_ancient_presence', 'dragon', 'presence', 'Ancient Presence', 'Aura of dread', 0, 0, 15, 'debuff', 'weakness', 0.80, 4, 7),
  ('dragon_draconic_might', 'dragon', 'presence', 'Draconic Might', 'Boost own power', 0, 0, 20, 'buff', 'attack_up', 1.0, 0, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Undead archetype - Necrotic branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('undead_life_drain', 'undead', 'necrotic', 'Life Drain', 'Steal life force', 100, 2, 10, 'dark', 'drain', 1.0, 0, 0, 8),
  ('undead_death_touch', 'undead', 'necrotic', 'Death Touch', 'Touch of death', 80, 1, 8, 'dark', 'curse', 0.40, 3, 0, 7),
  ('undead_soul_rend', 'undead', 'necrotic', 'Soul Rend', 'Tear at the soul', 130, 2, 15, 'dark', 'mp_drain', 0.60, 0, 0, 8),
  ('undead_necrotic_burst', 'undead', 'necrotic', 'Necrotic Burst', 'Explosion of death energy', 120, 3, 20, 'dark', 'curse', 0.50, 2, 2, 9),
  ('undead_raise_dead', 'undead', 'necrotic', 'Raise Dead', 'Summon undead minion', 0, 3, 30, 'summon', NULL, 1.0, 0, 0, 6)
ON CONFLICT (skill_id) DO NOTHING;

-- Undead archetype - Physical branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('undead_bone_strike', 'undead', 'physical', 'Bone Strike', 'Strike with skeletal limbs', 100, 1, 0, 'physical', NULL, 1.0, 0, 5),
  ('undead_grasp', 'undead', 'physical', 'Undead Grasp', 'Grab and hold', 80, 1, 5, 'physical', 'immobilize', 0.45, 0, 6),
  ('undead_bone_shatter', 'undead', 'physical', 'Bone Shatter', 'Explosive bone fragments', 110, 2, 8, 'physical', 'bleed', 0.30, 1, 7),
  ('undead_relentless_assault', 'undead', 'physical', 'Relentless Assault', 'Unending attack', 90, 1, 0, 'physical', NULL, 1.0, 0, 5)
ON CONFLICT (skill_id) DO NOTHING;

-- Elemental archetype - Fire branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('elemental_flame_burst', 'elemental', 'fire', 'Flame Burst', 'Burst of fire', 110, 3, 8, 'fire', 'burn', 0.30, 2, 0, 6),
  ('elemental_fire_bolt', 'elemental', 'fire', 'Fire Bolt', 'Bolt of fire', 90, 4, 5, 'fire', NULL, 1.0, 0, 0, 5),
  ('elemental_immolate', 'elemental', 'fire', 'Immolate', 'Engulf in flames', 140, 2, 15, 'fire', 'burn', 0.60, 3, 0, 8),
  ('elemental_fire_storm', 'elemental', 'fire', 'Fire Storm', 'Rain of fire', 130, 4, 25, 'fire', 'burn', 0.40, 2, 2, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Elemental archetype - Ice branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('elemental_frost_bolt', 'elemental', 'ice', 'Frost Bolt', 'Bolt of ice', 90, 4, 5, 'ice', 'slow', 0.35, 2, 0, 5),
  ('elemental_ice_shard', 'elemental', 'ice', 'Ice Shard', 'Sharp ice projectile', 100, 3, 6, 'ice', NULL, 1.0, 0, 0, 5),
  ('elemental_freeze', 'elemental', 'ice', 'Freeze', 'Freeze in place', 60, 3, 12, 'ice', 'frozen', 0.50, 1, 0, 7),
  ('elemental_blizzard', 'elemental', 'ice', 'Blizzard', 'Freezing storm', 120, 4, 22, 'ice', 'slow', 0.60, 2, 2, 8)
ON CONFLICT (skill_id) DO NOTHING;

-- Elemental archetype - Lightning branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('elemental_shock', 'elemental', 'lightning', 'Shock', 'Jolt of electricity', 95, 3, 5, 'lightning', 'paralyze', 0.20, 0, 5),
  ('elemental_lightning_bolt', 'elemental', 'lightning', 'Lightning Bolt', 'Powerful lightning strike', 130, 4, 12, 'lightning', 'paralyze', 0.30, 0, 7),
  ('elemental_chain_lightning', 'elemental', 'lightning', 'Chain Lightning', 'Bouncing electricity', 100, 4, 18, 'lightning', 'paralyze', 0.25, 0, 8),
  ('elemental_thunderstorm', 'elemental', 'lightning', 'Thunderstorm', 'Massive electrical storm', 150, 5, 30, 'lightning', 'paralyze', 0.40, 2, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Elemental archetype - Earth branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('elemental_rock_throw', 'elemental', 'earth', 'Rock Throw', 'Hurl a boulder', 100, 3, 5, 'earth', NULL, 1.0, 0, 5),
  ('elemental_earthquake', 'elemental', 'earth', 'Earthquake', 'Shake the ground', 110, 0, 20, 'earth', 'knockdown', 0.50, 3, 8),
  ('elemental_stone_skin', 'elemental', 'earth', 'Stone Skin', 'Harden defense', 0, 0, 10, 'buff', 'defense_up', 1.0, 0, 6),
  ('elemental_avalanche', 'elemental', 'earth', 'Avalanche', 'Crushing rock slide', 140, 4, 25, 'earth', 'slow', 0.45, 2, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Construct archetype - Tank branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('construct_slam', 'construct', 'tank', 'Slam', 'Heavy slam attack', 120, 1, 0, 'physical', 'stun', 0.25, 0, 6),
  ('construct_ground_pound', 'construct', 'tank', 'Ground Pound', 'Pound the ground', 100, 1, 8, 'physical', 'knockdown', 0.45, 1, 7),
  ('construct_iron_defense', 'construct', 'tank', 'Iron Defense', 'Greatly boost defense', 0, 0, 10, 'buff', 'defense_up', 1.0, 0, 8),
  ('construct_fortress', 'construct', 'tank', 'Fortress', 'Become immovable', 0, 0, 15, 'buff', 'immovable', 1.0, 0, 7),
  ('construct_repair', 'construct', 'tank', 'Repair', 'Self-repair systems', 0, 0, 20, 'heal', NULL, 1.0, 0, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Construct archetype - Siege branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('construct_boulder_hurl', 'construct', 'siege', 'Boulder Hurl', 'Throw massive boulder', 130, 4, 10, 'physical', 'knockback', 0.60, 0, 7),
  ('construct_siege_strike', 'construct', 'siege', 'Siege Strike', 'Devastating blow', 150, 1, 15, 'physical', 'armor_break', 0.50, 0, 8),
  ('construct_artillery_barrage', 'construct', 'siege', 'Artillery Barrage', 'Rain of projectiles', 110, 5, 25, 'physical', NULL, 1.0, 2, 8),
  ('construct_demolish', 'construct', 'siege', 'Demolish', 'Destructive attack', 180, 1, 20, 'physical', 'stun', 0.35, 0, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Demon archetype - Hellfire branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('demon_hellfire_bolt', 'demon', 'hellfire', 'Hellfire Bolt', 'Bolt of hellfire', 120, 4, 10, 'fire', 'burn', 0.40, 3, 0, 7),
  ('demon_infernal_blast', 'demon', 'hellfire', 'Infernal Blast', 'Explosion of hellfire', 140, 3, 18, 'fire', 'burn', 0.50, 3, 2, 8),
  ('demon_soul_fire', 'demon', 'hellfire', 'Soul Fire', 'Fire that burns the soul', 130, 3, 15, 'dark', 'mp_drain', 0.45, 0, 0, 8),
  ('demon_rain_of_fire', 'demon', 'hellfire', 'Rain of Fire', 'Hellfire from above', 160, 5, 30, 'fire', 'burn', 0.60, 3, 3, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Demon archetype - Corruption branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('demon_corrupt', 'demon', 'corruption', 'Corrupt', 'Corrupt the target', 80, 3, 12, 'dark', 'curse', 0.55, 3, 0, 7),
  ('demon_dark_pact', 'demon', 'corruption', 'Dark Pact', 'Sacrifice HP for power', 0, 0, 0, 'buff', 'attack_up', 1.0, 5, 0, 6),
  ('demon_mind_shatter', 'demon', 'corruption', 'Mind Shatter', 'Attack the mind', 100, 3, 15, 'dark', 'confusion', 0.50, 2, 0, 8),
  ('demon_dominate', 'demon', 'corruption', 'Dominate', 'Take control briefly', 0, 3, 25, 'debuff', 'charm', 0.30, 1, 0, 9),
  ('demon_torment', 'demon', 'corruption', 'Torment', 'Inflict agony', 90, 4, 10, 'dark', 'fear', 0.45, 2, 0, 7)
ON CONFLICT (skill_id) DO NOTHING;

-- Insect archetype - Swarm branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('insect_sting', 'insect', 'swarm', 'Sting', 'Venomous sting', 90, 1, 0, 'physical', 'poison', 0.35, 3, 0, 5),
  ('insect_web_shot', 'insect', 'swarm', 'Web Shot', 'Shoot sticky webbing', 50, 3, 8, 'physical', 'immobilize', 0.60, 2, 0, 7),
  ('insect_swarm_attack', 'insect', 'swarm', 'Swarm Attack', 'Attack with the swarm', 80, 2, 12, 'physical', 'bleed', 0.40, 2, 1, 7),
  ('insect_acid_spray', 'insect', 'swarm', 'Acid Spray', 'Spray corrosive acid', 100, 3, 10, 'poison', 'armor_break', 0.45, 0, 1, 6),
  ('insect_burrow', 'insect', 'swarm', 'Burrow', 'Burrow underground', 0, 0, 5, 'movement', 'hidden', 1.0, 1, 0, 6),
  ('insect_cocoon', 'insect', 'swarm', 'Cocoon', 'Wrap in protective cocoon', 0, 0, 15, 'heal', 'regenerate', 1.0, 3, 0, 8)
ON CONFLICT (skill_id) DO NOTHING;

-- Plant archetype - Nature branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('plant_vine_lash', 'plant', 'nature', 'Vine Lash', 'Whip with vines', 90, 2, 0, 'physical', NULL, 1.0, 0, 0, 5),
  ('plant_entangle', 'plant', 'nature', 'Entangle', 'Trap in vines', 60, 3, 10, 'physical', 'immobilize', 0.65, 2, 1, 7),
  ('plant_spore_cloud', 'plant', 'nature', 'Spore Cloud', 'Release toxic spores', 80, 0, 12, 'poison', 'poison', 0.55, 3, 2, 7),
  ('plant_thorn_volley', 'plant', 'nature', 'Thorn Volley', 'Fire sharp thorns', 100, 4, 8, 'physical', 'bleed', 0.30, 2, 0, 6),
  ('plant_regenerate', 'plant', 'nature', 'Regenerate', 'Natural healing', 0, 0, 10, 'heal', 'regenerate', 1.0, 3, 0, 8),
  ('plant_photosynthesis', 'plant', 'nature', 'Photosynthesis', 'Absorb sunlight to heal', 0, 0, 5, 'heal', NULL, 1.0, 0, 0, 6),
  ('plant_root_grip', 'plant', 'nature', 'Root Grip', 'Roots grab from below', 70, 3, 8, 'physical', 'slow', 0.70, 2, 0, 6)
ON CONFLICT (skill_id) DO NOTHING;

-- Humanoid archetype - Melee branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('humanoid_slash', 'humanoid', 'melee', 'Slash', 'Basic sword attack', 100, 1, 0, 'physical', NULL, 1.0, 0, 5),
  ('humanoid_power_strike', 'humanoid', 'melee', 'Power Strike', 'Heavy weapon blow', 130, 1, 8, 'physical', 'stun', 0.25, 0, 7),
  ('humanoid_shield_bash', 'humanoid', 'melee', 'Shield Bash', 'Bash with shield', 80, 1, 5, 'physical', 'stun', 0.40, 0, 6),
  ('humanoid_cleave', 'humanoid', 'melee', 'Cleave', 'Wide sweeping attack', 90, 1, 10, 'physical', NULL, 1.0, 1, 7),
  ('humanoid_execute', 'humanoid', 'melee', 'Execute', 'Finishing blow', 180, 1, 15, 'physical', NULL, 1.0, 0, 9)
ON CONFLICT (skill_id) DO NOTHING;

-- Humanoid archetype - Ranged branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, aoe_radius, priority)
VALUES
  ('humanoid_arrow_shot', 'humanoid', 'ranged', 'Arrow Shot', 'Basic arrow attack', 90, 4, 0, 'physical', NULL, 1.0, 0, 5),
  ('humanoid_aimed_shot', 'humanoid', 'ranged', 'Aimed Shot', 'Carefully aimed arrow', 130, 5, 8, 'physical', NULL, 1.0, 0, 7),
  ('humanoid_volley', 'humanoid', 'ranged', 'Volley', 'Rain of arrows', 80, 5, 15, 'physical', NULL, 1.0, 2, 8),
  ('humanoid_poison_arrow', 'humanoid', 'ranged', 'Poison Arrow', 'Arrow with poison tip', 100, 4, 10, 'physical', 'poison', 0.50, 0, 7),
  ('humanoid_snipe', 'humanoid', 'ranged', 'Snipe', 'Long range precision shot', 150, 6, 12, 'physical', NULL, 1.0, 0, 8)
ON CONFLICT (skill_id) DO NOTHING;

-- Humanoid archetype - Magic branch
INSERT INTO npc_skill_templates (skill_id, archetype, branch, name, description, power, range, mp_cost, damage_type, effect, effect_chance, effect_duration, aoe_radius, priority)
VALUES
  ('humanoid_magic_bolt', 'humanoid', 'magic', 'Magic Bolt', 'Basic magic missile', 90, 4, 5, 'magic', NULL, 1.0, 0, 0, 5),
  ('humanoid_fireball', 'humanoid', 'magic', 'Fireball', 'Explosive fire spell', 120, 4, 15, 'fire', 'burn', 0.35, 2, 1, 7),
  ('humanoid_ice_spike', 'humanoid', 'magic', 'Ice Spike', 'Piercing ice magic', 100, 4, 10, 'ice', 'slow', 0.40, 2, 0, 6),
  ('humanoid_heal_ally', 'humanoid', 'magic', 'Heal Ally', 'Restore ally health', 0, 4, 12, 'heal', NULL, 1.0, 0, 0, 8),
  ('humanoid_curse', 'humanoid', 'magic', 'Curse', 'Weaken the enemy', 0, 4, 10, 'debuff', 'curse', 0.60, 3, 0, 7),
  ('humanoid_magic_shield', 'humanoid', 'magic', 'Magic Shield', 'Protective barrier', 0, 3, 15, 'buff', 'magic_shield', 1.0, 3, 0, 7)
ON CONFLICT (skill_id) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE npc_skill_templates IS 'Monster and NPC skill definitions for procedural skill assignment';
COMMENT ON TABLE enemy_template_skills IS 'Maps enemy templates to their available skill pools';
COMMENT ON COLUMN npc_skill_templates.priority IS 'AI usage priority (1-10, higher = more likely to use)';
COMMENT ON COLUMN npc_skill_templates.damage_type IS 'physical, fire, ice, lightning, earth, dark, poison, magic, heal, buff, debuff, summon, movement, support';
COMMENT ON COLUMN enemy_template_skills.unlock_chance IS 'Probability (0-1) that this skill is available when generating enemy';
COMMENT ON COLUMN enemy_template_skills.level_scaling IS 'How much skill level increases per enemy level';
