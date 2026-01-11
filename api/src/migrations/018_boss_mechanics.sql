-- Migration 018: Boss Mechanics
-- Adds boss flag and phase system for multi-phase boss encounters

-- Add boss-related columns to enemy_templates
ALTER TABLE enemy_templates
  ADD COLUMN IF NOT EXISTS is_boss BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phases JSONB DEFAULT NULL;

-- Create index for boss lookups
CREATE INDEX IF NOT EXISTS idx_enemy_templates_is_boss ON enemy_templates(is_boss) WHERE is_boss = TRUE;

-- Create unique constraint for upsert operations
CREATE UNIQUE INDEX IF NOT EXISTS idx_boss_encounters_unique ON boss_encounters(battle_id, unit_id);

-- Add comments for documentation
COMMENT ON COLUMN enemy_templates.is_boss IS 'Whether this enemy is a boss with special mechanics';
COMMENT ON COLUMN enemy_templates.phases IS 'Phase configuration JSON: [{threshold: 0.75, abilities: [...], statMods: {...}}]';

-- Create boss_encounters table for tracking active boss fights
CREATE TABLE IF NOT EXISTS boss_encounters (
  id SERIAL PRIMARY KEY,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  enemy_template_id INTEGER REFERENCES enemy_templates(id) ON DELETE CASCADE,
  unit_id VARCHAR(32) NOT NULL,
  current_phase INTEGER DEFAULT 1,
  max_phases INTEGER DEFAULT 1,
  phase_triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for looking up boss state by battle
CREATE INDEX IF NOT EXISTS idx_boss_encounters_battle ON boss_encounters(battle_id);
CREATE INDEX IF NOT EXISTS idx_boss_encounters_unit ON boss_encounters(unit_id);

COMMENT ON TABLE boss_encounters IS 'Tracks phase state for active boss encounters';
COMMENT ON COLUMN boss_encounters.unit_id IS 'The enemy_X unit ID in the battle';
COMMENT ON COLUMN boss_encounters.current_phase IS 'Current phase number (1-indexed)';

-- Seed initial boss templates
-- Forest Guardian (2-phase boss for forest biome)
INSERT INTO enemy_templates (
  name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility,
  ai_type, archetype, spawn_node_types, min_difficulty_tier,
  experience_reward, gold_reward_min, gold_reward_max,
  movement, attack_range, attack_bonus, defense_bonus,
  is_boss, phases
) VALUES (
  'Forest Guardian', 'forest_guardian', 500, 100, 25, 15, 12,
  'defensive', 'plant', ARRAY['forest'], 3,
  500, 100, 200,
  2, 2, 10, 15,
  TRUE,
  '[
    {
      "threshold": 1.0,
      "name": "Awakened",
      "abilities": ["plant_vine_lash", "plant_entangle", "plant_regenerate"],
      "statMods": {}
    },
    {
      "threshold": 0.5,
      "name": "Enraged",
      "abilities": ["plant_vine_lash", "plant_entangle", "plant_thorn_volley", "plant_spore_cloud"],
      "statMods": {"attack": 1.5, "defense": 0.8},
      "onEnter": {"effect": "attack_up", "duration": 3}
    }
  ]'::jsonb
) ON CONFLICT (name) DO UPDATE SET
  is_boss = EXCLUDED.is_boss,
  phases = EXCLUDED.phases;

-- Cave Troll King (3-phase boss for cave biome)
INSERT INTO enemy_templates (
  name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility,
  ai_type, archetype, spawn_node_types, min_difficulty_tier,
  experience_reward, gold_reward_min, gold_reward_max,
  movement, attack_range, attack_bonus, defense_bonus,
  is_boss, phases
) VALUES (
  'Cave Troll King', 'cave_troll_king', 700, 50, 35, 8, 8,
  'aggressive', 'beast', ARRAY['cave'], 4,
  750, 150, 300,
  2, 1, 20, 20,
  TRUE,
  '[
    {
      "threshold": 1.0,
      "name": "Mighty",
      "abilities": ["construct_slam", "construct_ground_pound"],
      "statMods": {}
    },
    {
      "threshold": 0.66,
      "name": "Summoning",
      "abilities": ["construct_slam", "construct_ground_pound", "beast_howl"],
      "statMods": {"attack": 1.2},
      "onEnter": {"summon": "cave_troll_minion", "count": 2}
    },
    {
      "threshold": 0.33,
      "name": "Berserk",
      "abilities": ["construct_slam", "construct_ground_pound", "construct_demolish", "beast_frenzy"],
      "statMods": {"attack": 2.0, "defense": 0.5, "agility": 1.5},
      "onEnter": {"effect": "berserk", "duration": 99}
    }
  ]'::jsonb
) ON CONFLICT (name) DO UPDATE SET
  is_boss = EXCLUDED.is_boss,
  phases = EXCLUDED.phases;

-- Skeleton Lord (2-phase boss for ruins biome)
INSERT INTO enemy_templates (
  name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility,
  ai_type, archetype, spawn_node_types, min_difficulty_tier,
  experience_reward, gold_reward_min, gold_reward_max,
  movement, attack_range, attack_bonus, magic_attack_bonus,
  is_boss, phases
) VALUES (
  'Skeleton Lord', 'skeleton_lord', 400, 150, 20, 30, 15,
  'tactical', 'undead', ARRAY['ruins', 'dungeon'], 4,
  600, 120, 250,
  3, 3, 5, 25,
  TRUE,
  '[
    {
      "threshold": 1.0,
      "name": "Commanding",
      "abilities": ["undead_bone_strike", "undead_life_drain", "undead_raise_dead"],
      "statMods": {}
    },
    {
      "threshold": 0.5,
      "name": "Death Aura",
      "abilities": ["undead_bone_strike", "undead_life_drain", "undead_necrotic_burst", "undead_soul_rend"],
      "statMods": {"magicAttack": 1.5},
      "onEnter": {"aura": "death_aura", "damagePerTurn": 10}
    }
  ]'::jsonb
) ON CONFLICT (name) DO UPDATE SET
  is_boss = EXCLUDED.is_boss,
  phases = EXCLUDED.phases;

-- Create a troll minion template for Cave Troll King phase 2
INSERT INTO enemy_templates (
  name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility,
  ai_type, archetype, spawn_node_types, min_difficulty_tier,
  experience_reward, gold_reward_min, gold_reward_max,
  movement, attack_range
) VALUES (
  'Cave Troll Minion', 'cave_troll', 100, 20, 15, 5, 10,
  'aggressive', 'beast', ARRAY['cave'], 4,
  50, 10, 30,
  3, 1
) ON CONFLICT (name) DO NOTHING;
