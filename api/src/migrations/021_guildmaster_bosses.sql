-- Migration 021: Guildmaster Bosses
-- Adds guildmaster templates for advancement trial boss battles

-- ============================================
-- GUILDMASTER TEMPLATES
-- ============================================
-- Boss templates for guild advancement trials
CREATE TABLE guildmaster_templates (
  id SERIAL PRIMARY KEY,

  -- Class identity (one guildmaster per advanced class)
  guild_class VARCHAR(32) NOT NULL UNIQUE,    -- Class this guildmaster represents
  guild_id VARCHAR(20) NOT NULL,              -- Base guild: warrior, wizard, monk, chemist
  guild_tier INTEGER NOT NULL CHECK (guild_tier BETWEEN 1 AND 4),

  -- Character info
  name VARCHAR(128) NOT NULL,
  title VARCHAR(128),                         -- e.g., "Grandmaster of the Sword"
  sprite_id VARCHAR(64) NOT NULL,
  portrait_id VARCHAR(64),

  -- Base stats (scaled to challenger level)
  base_level INTEGER DEFAULT 25,
  base_hp INTEGER NOT NULL,
  base_mp INTEGER NOT NULL,
  base_strength INTEGER NOT NULL,
  base_intelligence INTEGER NOT NULL,
  base_agility INTEGER NOT NULL,
  base_vitality INTEGER NOT NULL,

  -- Combat bonuses
  attack_bonus INTEGER DEFAULT 0,
  defense_bonus INTEGER DEFAULT 0,
  magic_attack_bonus INTEGER DEFAULT 0,
  magic_defense_bonus INTEGER DEFAULT 0,
  movement INTEGER DEFAULT 3,
  attack_range INTEGER DEFAULT 1,

  -- Skills (JSONB array of skill IDs from their class tree)
  skills JSONB NOT NULL DEFAULT '[]',

  -- Phase configuration (tier-dependent complexity)
  -- phases: [{threshold, name, abilities, statMods, onEnter}]
  phases JSONB NOT NULL DEFAULT '[]',

  -- Disciple configuration
  disciple_count INTEGER DEFAULT 2,
  -- disciple_classes: ["warrior", "warrior"] or ["warrior", "berserker", "paladin"]
  disciple_classes JSONB DEFAULT '[]',

  -- AI configuration
  ai_type VARCHAR(32) DEFAULT 'tactical',
  ai_config JSONB DEFAULT '{}',

  -- Lore and dialogue
  description TEXT,
  intro_dialogue TEXT,                        -- Before battle starts
  phase_dialogue JSONB DEFAULT '[]',          -- Per-phase dialogue
  victory_dialogue TEXT,                      -- Player wins
  defeat_dialogue TEXT,                       -- Player loses

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_guildmaster_guild ON guildmaster_templates(guild_id);
CREATE INDEX idx_guildmaster_tier ON guildmaster_templates(guild_tier);

-- ============================================
-- DISCIPLE TEMPLATES (optional - for custom disciples)
-- ============================================
-- Custom disciples beyond simple class copies
CREATE TABLE disciple_templates (
  id SERIAL PRIMARY KEY,
  guildmaster_id INTEGER REFERENCES guildmaster_templates(id) ON DELETE CASCADE,
  disciple_class VARCHAR(32) NOT NULL,
  disciple_name VARCHAR(64),                  -- Optional custom name

  -- Stats relative to guildmaster (multipliers)
  hp_ratio DECIMAL(3,2) DEFAULT 0.40,         -- 40% of guildmaster HP
  mp_ratio DECIMAL(3,2) DEFAULT 0.50,
  stat_ratio DECIMAL(3,2) DEFAULT 0.60,       -- 60% of guildmaster stats

  -- Skills subset
  skills JSONB DEFAULT '[]',

  -- AI (typically simpler than guildmaster)
  ai_type VARCHAR(32) DEFAULT 'aggressive',

  -- Position offset from guildmaster spawn
  spawn_offset_x INTEGER DEFAULT 0,
  spawn_offset_y INTEGER DEFAULT 0
);

CREATE INDEX idx_disciple_guildmaster ON disciple_templates(guildmaster_id);

-- ============================================
-- EXTEND BATTLES TABLE
-- ============================================
-- Add columns for advancement battles
ALTER TABLE battles
  ADD COLUMN IF NOT EXISTS is_advancement_battle BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS challenger_character_id INTEGER REFERENCES characters(id),
  ADD COLUMN IF NOT EXISTS target_class VARCHAR(32),
  ADD COLUMN IF NOT EXISTS guildmaster_template_id INTEGER REFERENCES guildmaster_templates(id);

CREATE INDEX idx_battles_advancement ON battles(is_advancement_battle)
  WHERE is_advancement_battle = TRUE;
CREATE INDEX idx_battles_challenger ON battles(challenger_character_id)
  WHERE challenger_character_id IS NOT NULL;

-- ============================================
-- ADVANCEMENT BATTLE HISTORY
-- ============================================
-- Track all advancement attempts (wins and losses)
CREATE TABLE advancement_battle_history (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  guildmaster_template_id INTEGER NOT NULL REFERENCES guildmaster_templates(id),
  target_class VARCHAR(32) NOT NULL,
  result VARCHAR(20) NOT NULL CHECK (result IN ('victory', 'defeat', 'fled')),
  duration_seconds INTEGER,                   -- Battle duration
  damage_dealt INTEGER,
  damage_taken INTEGER,
  phases_reached INTEGER DEFAULT 1,           -- Highest phase reached
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_adv_history_character ON advancement_battle_history(character_id);
CREATE INDEX idx_adv_history_result ON advancement_battle_history(result);

-- ============================================
-- SEED DATA: T1 AND T2 GUILDMASTERS
-- ============================================
-- Base class guildmasters (T1)
INSERT INTO guildmaster_templates (
  guild_class, guild_id, guild_tier, name, title, sprite_id,
  base_level, base_hp, base_mp, base_strength, base_intelligence, base_agility, base_vitality,
  attack_bonus, defense_bonus, magic_attack_bonus, magic_defense_bonus, movement, attack_range,
  skills, phases, disciple_count, disciple_classes, ai_type,
  intro_dialogue, victory_dialogue, defeat_dialogue
) VALUES
-- Warrior Guildmaster
('warrior', 'warrior', 1, 'Vorn the Unyielding', 'Guildmaster of Warriors', 'guildmaster_warrior',
 25, 800, 60, 35, 12, 18, 30,
 15, 20, 0, 5, 3, 1,
 '["power_strike", "cleave", "shield_bash", "fortify", "taunt"]',
 '[{"threshold": 1.0, "name": "Trial of Strength", "abilities": ["power_strike", "shield_bash", "taunt"]}]',
 2, '["warrior", "warrior"]', 'tactical',
 'So, you seek to prove your worth? Show me the strength of your conviction!',
 'Well fought! You have earned your place among the warriors.',
 'You lack the strength. Return when you are ready to face me again.'),

-- Wizard Guildmaster
('wizard', 'wizard', 1, 'Seraphina the Enlightened', 'Archmage of the Tower', 'guildmaster_wizard',
 25, 500, 200, 10, 40, 15, 15,
 0, 5, 25, 15, 3, 4,
 '["fireball", "ice_shard", "lightning_bolt", "mana_shield"]',
 '[{"threshold": 1.0, "name": "Arcane Examination", "abilities": ["fireball", "ice_shard", "lightning_bolt"]}]',
 2, '["wizard", "wizard"]', 'tactical',
 'Knowledge is power, young mage. Let us see if you have learned your lessons well.',
 'Impressive! Your mastery of the arcane arts is evident.',
 'Your understanding is incomplete. Study harder and return.'),

-- Monk Guildmaster
('monk', 'monk', 1, 'Master Chen', 'Grand Master of the Monastery', 'guildmaster_monk',
 25, 600, 100, 25, 18, 35, 22,
 10, 10, 5, 10, 4, 1,
 '["palm_strike", "flying_kick", "meditation", "counter_strike", "ki_burst"]',
 '[{"threshold": 1.0, "name": "Trial of Spirit", "abilities": ["palm_strike", "flying_kick", "counter_strike"]}]',
 2, '["monk", "monk"]', 'tactical',
 'The path to enlightenment requires discipline. Show me yours.',
 'Your spirit burns bright. You are ready for the next step.',
 'Your technique is lacking. Meditate on your failures.'),

-- Chemist Guildmaster
('chemist', 'chemist', 1, 'Aldric the Precise', 'Chief Apothecary', 'guildmaster_chemist',
 25, 550, 150, 12, 30, 20, 18,
 0, 5, 15, 10, 3, 3,
 '["acid_flask", "poison_cloud", "potion_throw", "smoke_bomb", "antidote"]',
 '[{"threshold": 1.0, "name": "Chemical Mastery", "abilities": ["acid_flask", "potion_throw", "smoke_bomb"]}]',
 2, '["chemist", "chemist"]', 'tactical',
 'Precision and knowledge are the chemist''s greatest tools. Prove you possess both.',
 'Excellent work! Your formulations are worthy of advancement.',
 'Your mixtures are unstable. Practice more before returning.');

-- T2 Advanced Class Guildmasters
INSERT INTO guildmaster_templates (
  guild_class, guild_id, guild_tier, name, title, sprite_id,
  base_level, base_hp, base_mp, base_strength, base_intelligence, base_agility, base_vitality,
  attack_bonus, defense_bonus, magic_attack_bonus, magic_defense_bonus, movement, attack_range,
  skills, phases, disciple_count, disciple_classes, ai_type,
  intro_dialogue, victory_dialogue, defeat_dialogue
) VALUES
-- Berserker Guildmaster (T2 Warrior)
('berserker', 'warrior', 2, 'Grimjaw the Bloodthirsty', 'Warlord of the Berserker Clan', 'guildmaster_berserker',
 35, 1200, 40, 50, 8, 22, 35,
 30, 5, 0, 0, 3, 1,
 '["rage_strike", "blood_frenzy", "reckless_charge", "berserker_leap", "rampage"]',
 '[{"threshold": 1.0, "name": "Controlled Fury", "abilities": ["rage_strike", "reckless_charge"], "statMods": {}},
   {"threshold": 0.5, "name": "BLOOD RAGE", "abilities": ["rage_strike", "blood_frenzy", "rampage"], "statMods": {"attack": 1.5, "defense": 0.6}, "onEnter": {"effect": "berserk", "duration": 99}}]',
 2, '["warrior", "berserker"]', 'aggressive',
 'BLOOD! FURY! RAGE! Show me you can survive the storm!',
 'Your rage burns bright! Welcome to the berserker brotherhood!',
 'Too weak! Come back when your fury can match mine!'),

-- Sorcerer Guildmaster (T2 Wizard)
('sorcerer', 'wizard', 2, 'Malachar the Infinite', 'Supreme Sorcerer', 'guildmaster_sorcerer',
 35, 650, 350, 8, 55, 18, 18,
 0, 5, 40, 25, 3, 5,
 '["arcane_bolt", "mana_shield", "spell_amplify", "arcane_explosion", "tri_element"]',
 '[{"threshold": 1.0, "name": "Arcane Control", "abilities": ["arcane_bolt", "tri_element"], "statMods": {}},
   {"threshold": 0.5, "name": "Unleashed Power", "abilities": ["arcane_explosion", "spell_amplify"], "statMods": {"magicAttack": 1.6}, "onEnter": {"effect": "amplify", "duration": 3}}]',
 2, '["wizard", "sorcerer"]', 'tactical',
 'Raw power flows through me. Can you withstand its fury?',
 'You command the arcane forces well. The title of Sorcerer is yours.',
 'Your power is insufficient. Return when you have grown stronger.'),

-- Ninja Guildmaster (T2 Monk)
('ninja', 'monk', 2, 'Shadow Master Kira', 'Head of the Shadow Arts', 'guildmaster_ninja',
 35, 700, 120, 30, 20, 50, 20,
 25, 5, 10, 10, 5, 1,
 '["shadow_step", "vanish", "backstab", "assassination", "shuriken", "kunai_barrage"]',
 '[{"threshold": 1.0, "name": "Testing Your Eyes", "abilities": ["shuriken", "shadow_step"], "statMods": {}},
   {"threshold": 0.5, "name": "From the Shadows", "abilities": ["vanish", "assassination", "backstab"], "statMods": {"agility": 1.5}, "onEnter": {"effect": "invisible", "duration": 2}}]',
 2, '["monk", "ninja"]', 'assassin',
 '...Can you see me? Then you have already lost.',
 'You move like shadow. Welcome to the path of the ninja.',
 'Too slow. The shadows reject you... for now.'),

-- Alchemist Guildmaster (T2 Chemist)
('alchemist', 'chemist', 2, 'Professor Volkov', 'Grand Alchemist', 'guildmaster_alchemist',
 35, 750, 250, 15, 45, 22, 22,
 0, 10, 30, 20, 3, 4,
 '["volatile_mix", "napalm", "elemental_bomb", "transmute", "matter_shift", "tactical_nuke"]',
 '[{"threshold": 1.0, "name": "Controlled Experiment", "abilities": ["volatile_mix", "transmute"], "statMods": {}},
   {"threshold": 0.5, "name": "Unstable Reaction", "abilities": ["napalm", "tactical_nuke"], "statMods": {"magicAttack": 1.4}, "onEnter": {"summon": "alchemical_turret", "count": 1}}]',
 2, '["chemist", "alchemist"]', 'tactical',
 'The laws of matter bend to my will. Let us see if you understand them.',
 'Your transmutations are masterful! The title of Alchemist is earned.',
 'Your formulas are flawed. Study the principles and return.');

-- ============================================
-- SEED DATA: T1 QUEST TEMPLATES
-- ============================================
INSERT INTO advancement_quest_templates (
  guild_id, tier, target_class, prerequisite_class,
  quest_name, quest_description,
  material_requirements, enemy_requirements, node_requirements,
  boss_config, gold_reward, xp_reward, title_reward
) VALUES
-- Warrior T1 -> Berserker
('warrior', 1, 'berserker', NULL,
 'Path of Fury', 'Prove your worth to join the Berserker clan. Collect iron ore from the mountains, defeat forest beasts, and visit sacred warrior sites.',
 '[{"item_template_id": 1, "quantity": 5, "rarity": "common", "name": "Iron Ore"}]',
 '[{"enemy_archetype": "beast", "count": 10, "zone_tier": 1}]',
 '[{"node_type": "forest", "count": 2, "min_tier": 1}]',
 '{"guildmaster_class": "warrior", "phase_count": 1, "disciple_classes": ["warrior", "warrior"]}',
 500, 1000, 'Initiate of Fury'),

-- Wizard T1 -> Sorcerer
('wizard', 1, 'sorcerer', NULL,
 'Arcane Awakening', 'Channel raw magical power to become a Sorcerer. Gather arcane crystals, defeat magical creatures, and attune at ancient towers.',
 '[{"item_template_id": 2, "quantity": 5, "rarity": "common", "name": "Arcane Crystal"}]',
 '[{"enemy_archetype": "magical", "count": 10, "zone_tier": 1}]',
 '[{"node_type": "cave", "count": 2, "min_tier": 1}]',
 '{"guildmaster_class": "wizard", "phase_count": 1, "disciple_classes": ["wizard", "wizard"]}',
 500, 1000, 'Arcane Initiate'),

-- Monk T1 -> Ninja
('monk', 1, 'ninja', NULL,
 'Way of Shadows', 'Walk the path of the ninja. Collect shadow essence, eliminate targets silently, and visit hidden shrines.',
 '[{"item_template_id": 3, "quantity": 5, "rarity": "common", "name": "Shadow Essence"}]',
 '[{"enemy_archetype": "humanoid", "count": 10, "zone_tier": 1}]',
 '[{"node_type": "mountain", "count": 2, "min_tier": 1}]',
 '{"guildmaster_class": "monk", "phase_count": 1, "disciple_classes": ["monk", "monk"]}',
 500, 1000, 'Shadow Initiate'),

-- Chemist T1 -> Alchemist
('chemist', 1, 'alchemist', NULL,
 'Alchemical Foundation', 'Master the art of transmutation. Gather rare reagents, test your concoctions on creatures, and study at ancient laboratories.',
 '[{"item_template_id": 4, "quantity": 5, "rarity": "common", "name": "Philosopher''s Dust"}]',
 '[{"enemy_archetype": "plant", "count": 10, "zone_tier": 1}]',
 '[{"node_type": "forest", "count": 2, "min_tier": 1}]',
 '{"guildmaster_class": "chemist", "phase_count": 1, "disciple_classes": ["chemist", "chemist"]}',
 500, 1000, 'Apprentice Alchemist');

-- T2 Quest Templates
INSERT INTO advancement_quest_templates (
  guild_id, tier, target_class, prerequisite_class,
  quest_name, quest_description,
  material_requirements, enemy_requirements, node_requirements,
  boss_config, gold_reward, xp_reward, title_reward
) VALUES
-- Warrior T2 -> Paladin
('warrior', 2, 'paladin', 'berserker',
 'Holy Oath', 'Embrace the light and become a Paladin. Gather blessed materials, purify corrupted creatures, and pray at sacred temples.',
 '[{"item_template_id": 5, "quantity": 8, "rarity": "uncommon", "name": "Blessed Steel"}]',
 '[{"enemy_archetype": "undead", "count": 15, "zone_tier": 2}]',
 '[{"node_type": "village", "count": 3, "min_tier": 1}]',
 '{"guildmaster_class": "berserker", "phase_count": 2, "disciple_classes": ["warrior", "berserker"]}',
 1000, 2500, 'Knight of Light'),

-- Wizard T2 -> Summoner
('wizard', 2, 'summoner', 'sorcerer',
 'Pact of Summoning', 'Forge bonds with otherworldly beings. Collect summoning materials, defeat elemental spirits, and perform rituals at nexus points.',
 '[{"item_template_id": 6, "quantity": 8, "rarity": "uncommon", "name": "Spirit Binding Dust"}]',
 '[{"enemy_archetype": "elemental", "count": 15, "zone_tier": 2}]',
 '[{"node_type": "cave", "count": 3, "min_tier": 1}]',
 '{"guildmaster_class": "sorcerer", "phase_count": 2, "disciple_classes": ["wizard", "sorcerer"]}',
 1000, 2500, 'Spiritcaller'),

-- Monk T2 -> Martial Artist
('monk', 2, 'martial_artist', 'ninja',
 'Perfect Form', 'Master every stance and strike. Collect training materials, defeat martial masters, and meditate at ancient dojos.',
 '[{"item_template_id": 7, "quantity": 8, "rarity": "uncommon", "name": "Tiger Claw"}]',
 '[{"enemy_archetype": "beast", "count": 15, "zone_tier": 2}]',
 '[{"node_type": "mountain", "count": 3, "min_tier": 1}]',
 '{"guildmaster_class": "ninja", "phase_count": 2, "disciple_classes": ["monk", "ninja"]}',
 1000, 2500, 'Master of Fists'),

-- Chemist T2 -> Medic
('chemist', 2, 'medic', 'alchemist',
 'Oath of Healing', 'Dedicate yourself to saving lives. Gather healing herbs, cure the afflicted, and study at renowned hospitals.',
 '[{"item_template_id": 8, "quantity": 8, "rarity": "uncommon", "name": "Lifeleaf Extract"}]',
 '[{"enemy_archetype": "plant", "count": 15, "zone_tier": 2}]',
 '[{"node_type": "village", "count": 3, "min_tier": 1}]',
 '{"guildmaster_class": "alchemist", "phase_count": 2, "disciple_classes": ["chemist", "alchemist"]}',
 1000, 2500, 'Field Medic');
