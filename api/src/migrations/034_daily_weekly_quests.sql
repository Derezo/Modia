-- Migration 034: Daily/Weekly Quest System
-- Adds repeatable daily and weekly quests for player retention

-- ============================================
-- QUEST PERIOD TYPE
-- ============================================
CREATE TYPE quest_period AS ENUM ('daily', 'weekly');

-- ============================================
-- DAILY/WEEKLY QUEST TEMPLATES
-- ============================================
-- Static quest definitions that get randomly assigned each period
CREATE TABLE IF NOT EXISTS daily_quest_templates (
  id SERIAL PRIMARY KEY,

  -- Quest identification
  quest_key VARCHAR(50) NOT NULL UNIQUE,  -- Internal key: 'kill_enemies_10', 'visit_nodes_5', etc.
  period quest_period NOT NULL,            -- daily or weekly

  -- Display info
  quest_name VARCHAR(100) NOT NULL,
  quest_description TEXT NOT NULL,

  -- Objective type and requirements
  -- Types: kill_enemies, visit_nodes, complete_battles, fish_catches, puzzle_solves,
  --        gold_earned, items_sold, coliseum_wins, party_battles
  objective_type VARCHAR(30) NOT NULL,

  -- Objective details (JSONB for flexibility)
  -- Examples:
  --   kill_enemies: {count: 10, enemy_types: ['goblin', 'wolf'], region: 'heartlands'}
  --   visit_nodes: {count: 5, node_types: ['tavern', 'shrine'], region: null}
  --   complete_battles: {count: 3, min_tier: 2}
  --   fish_catches: {count: 10, fish_types: ['common', 'uncommon']}
  objective_requirements JSONB NOT NULL DEFAULT '{}',

  -- Target count for completion
  target_count INTEGER NOT NULL CHECK (target_count > 0),

  -- Rewards (JSONB for flexibility)
  -- {gold: 500, xp: 200, items: [{item_id: 1, quantity: 1}], relics: []}
  rewards JSONB NOT NULL DEFAULT '{}',

  -- Quest difficulty/rarity affects reward multiplier
  difficulty VARCHAR(20) DEFAULT 'normal' CHECK (difficulty IN ('easy', 'normal', 'hard', 'elite')),

  -- Weight for random selection (higher = more likely to appear)
  selection_weight INTEGER DEFAULT 100,

  -- Level requirements
  min_level INTEGER DEFAULT 1,
  max_level INTEGER DEFAULT 100,

  -- Is this quest active in rotation?
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_daily_quest_templates_period ON daily_quest_templates(period);
CREATE INDEX idx_daily_quest_templates_active ON daily_quest_templates(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_daily_quest_templates_objective ON daily_quest_templates(objective_type);

-- ============================================
-- CHARACTER DAILY/WEEKLY QUESTS
-- ============================================
-- Active quests assigned to each character
CREATE TABLE IF NOT EXISTS character_daily_quests (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_template_id INTEGER NOT NULL REFERENCES daily_quest_templates(id),
  period quest_period NOT NULL,

  -- Progress tracking
  current_progress INTEGER DEFAULT 0,
  target_progress INTEGER NOT NULL,  -- Copied from template for historical accuracy

  -- State
  is_completed BOOLEAN DEFAULT FALSE,
  rewards_claimed BOOLEAN DEFAULT FALSE,

  -- Period tracking (for reset logic)
  period_start TIMESTAMP NOT NULL,    -- Start of the day/week this quest was assigned
  period_end TIMESTAMP NOT NULL,      -- When this quest expires

  -- Timestamps
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  claimed_at TIMESTAMP,

  -- Prevent duplicate quests in same period
  CONSTRAINT unique_quest_per_period UNIQUE (character_id, quest_template_id, period_start)
);

CREATE INDEX idx_character_daily_quests_character ON character_daily_quests(character_id);
CREATE INDEX idx_character_daily_quests_period ON character_daily_quests(period);
CREATE INDEX idx_character_daily_quests_active ON character_daily_quests(character_id, period_end)
  WHERE is_completed = FALSE;
CREATE INDEX idx_character_daily_quests_unclaimed ON character_daily_quests(character_id)
  WHERE is_completed = TRUE AND rewards_claimed = FALSE;

-- ============================================
-- QUEST COMPLETION HISTORY
-- ============================================
-- Track completed quests for statistics and streak tracking
CREATE TABLE IF NOT EXISTS daily_quest_history (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_template_id INTEGER NOT NULL REFERENCES daily_quest_templates(id),
  period quest_period NOT NULL,

  -- Snapshot of rewards granted
  rewards_granted JSONB NOT NULL,

  -- Period info
  period_start TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL,

  -- For streak calculations
  consecutive_days INTEGER DEFAULT 1
);

CREATE INDEX idx_daily_quest_history_character ON daily_quest_history(character_id);
CREATE INDEX idx_daily_quest_history_period ON daily_quest_history(character_id, period_start DESC);

-- ============================================
-- DAILY LOGIN STREAK TRACKING
-- ============================================
-- Track consecutive login days for bonus rewards
CREATE TABLE IF NOT EXISTS character_login_streaks (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_login_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_daily_reset TIMESTAMP,  -- Last time daily quests were reset for this character
  last_weekly_reset TIMESTAMP, -- Last time weekly quests were reset for this character
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get the start of the current day (UTC)
CREATE OR REPLACE FUNCTION get_daily_period_start()
RETURNS TIMESTAMP AS $$
BEGIN
  RETURN DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get the start of the current week (Monday UTC)
CREATE OR REPLACE FUNCTION get_weekly_period_start()
RETURNS TIMESTAMP AS $$
BEGIN
  RETURN DATE_TRUNC('week', NOW() AT TIME ZONE 'UTC');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get period end timestamp based on period type
CREATE OR REPLACE FUNCTION get_period_end(p_period quest_period, p_start TIMESTAMP)
RETURNS TIMESTAMP AS $$
BEGIN
  IF p_period = 'daily' THEN
    RETURN p_start + INTERVAL '1 day';
  ELSE
    RETURN p_start + INTERVAL '7 days';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Check if character needs new daily quests
CREATE OR REPLACE FUNCTION needs_daily_quest_refresh(p_character_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_last_reset TIMESTAMP;
  v_period_start TIMESTAMP;
BEGIN
  SELECT last_daily_reset INTO v_last_reset
  FROM character_login_streaks
  WHERE character_id = p_character_id;

  v_period_start := get_daily_period_start();

  -- Needs refresh if no record or last reset was before current period
  RETURN v_last_reset IS NULL OR v_last_reset < v_period_start;
END;
$$ LANGUAGE plpgsql;

-- Check if character needs new weekly quests
CREATE OR REPLACE FUNCTION needs_weekly_quest_refresh(p_character_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_last_reset TIMESTAMP;
  v_period_start TIMESTAMP;
BEGIN
  SELECT last_weekly_reset INTO v_last_reset
  FROM character_login_streaks
  WHERE character_id = p_character_id;

  v_period_start := get_weekly_period_start();

  -- Needs refresh if no record or last reset was before current period
  RETURN v_last_reset IS NULL OR v_last_reset < v_period_start;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED QUEST TEMPLATES
-- ============================================
INSERT INTO daily_quest_templates (quest_key, period, quest_name, quest_description, objective_type, objective_requirements, target_count, rewards, difficulty, min_level) VALUES
-- Daily Combat Quests
('daily_kill_10_enemies', 'daily', 'Monster Hunter', 'Defeat 10 enemies in battle', 'kill_enemies', '{}', 10, '{"gold": 200, "xp": 100}', 'easy', 1),
('daily_kill_20_enemies', 'daily', 'Seasoned Hunter', 'Defeat 20 enemies in battle', 'kill_enemies', '{}', 20, '{"gold": 400, "xp": 200}', 'normal', 5),
('daily_kill_specific_type', 'daily', 'Bounty Hunter', 'Defeat 15 enemies of a specific type', 'kill_enemies', '{"enemy_types": ["any"]}', 15, '{"gold": 350, "xp": 175}', 'normal', 5),
('daily_battles_3', 'daily', 'Battle Ready', 'Win 3 battles', 'complete_battles', '{}', 3, '{"gold": 300, "xp": 150}', 'normal', 1),
('daily_battles_5', 'daily', 'Veteran Fighter', 'Win 5 battles', 'complete_battles', '{}', 5, '{"gold": 500, "xp": 250}', 'hard', 10),

-- Daily Exploration Quests
('daily_visit_nodes_5', 'daily', 'Explorer', 'Visit 5 different map nodes', 'visit_nodes', '{}', 5, '{"gold": 150, "xp": 75}', 'easy', 1),
('daily_visit_nodes_10', 'daily', 'Wanderer', 'Visit 10 different map nodes', 'visit_nodes', '{}', 10, '{"gold": 300, "xp": 150}', 'normal', 5),
('daily_visit_taverns', 'daily', 'Social Butterfly', 'Visit 3 taverns', 'visit_nodes', '{"node_types": ["tavern"]}', 3, '{"gold": 200, "xp": 100}', 'normal', 1),
('daily_visit_shrines', 'daily', 'Pilgrim', 'Visit 2 shrines', 'visit_nodes', '{"node_types": ["shrine"]}', 2, '{"gold": 250, "xp": 125}', 'normal', 5),

-- Daily Activity Quests
('daily_fish_5', 'daily', 'Casual Angler', 'Catch 5 fish', 'fish_catches', '{}', 5, '{"gold": 150, "xp": 75}', 'easy', 1),
('daily_fish_15', 'daily', 'Dedicated Fisher', 'Catch 15 fish', 'fish_catches', '{}', 15, '{"gold": 350, "xp": 175}', 'normal', 5),
('daily_puzzle_1', 'daily', 'Puzzle Novice', 'Complete 1 ruins puzzle', 'puzzle_solves', '{}', 1, '{"gold": 200, "xp": 100}', 'normal', 5),
('daily_puzzle_3', 'daily', 'Puzzle Master', 'Complete 3 ruins puzzles', 'puzzle_solves', '{}', 3, '{"gold": 500, "xp": 250}', 'hard', 10),

-- Daily Economy Quests
('daily_gold_earned_500', 'daily', 'Gold Digger', 'Earn 500 gold', 'gold_earned', '{}', 500, '{"gold": 100, "xp": 50}', 'easy', 1),
('daily_gold_earned_2000', 'daily', 'Treasure Hunter', 'Earn 2000 gold', 'gold_earned', '{}', 2000, '{"gold": 400, "xp": 200}', 'normal', 10),
('daily_sell_items_3', 'daily', 'Merchant', 'Sell 3 items on the marketplace', 'items_sold', '{}', 3, '{"gold": 300, "xp": 150}', 'normal', 5),

-- Weekly Combat Quests
('weekly_kill_100_enemies', 'weekly', 'Warmonger', 'Defeat 100 enemies in battle', 'kill_enemies', '{}', 100, '{"gold": 2000, "xp": 1000}', 'normal', 1),
('weekly_kill_200_enemies', 'weekly', 'Slayer', 'Defeat 200 enemies in battle', 'kill_enemies', '{}', 200, '{"gold": 4000, "xp": 2000}', 'hard', 10),
('weekly_battles_20', 'weekly', 'Battle Commander', 'Win 20 battles', 'complete_battles', '{}', 20, '{"gold": 2500, "xp": 1250}', 'normal', 5),
('weekly_battles_50', 'weekly', 'War Hero', 'Win 50 battles', 'complete_battles', '{}', 50, '{"gold": 5000, "xp": 2500}', 'elite', 20),

-- Weekly Exploration Quests
('weekly_visit_nodes_30', 'weekly', 'Cartographer', 'Visit 30 different map nodes', 'visit_nodes', '{}', 30, '{"gold": 1500, "xp": 750}', 'normal', 1),
('weekly_visit_all_regions', 'weekly', 'World Traveler', 'Visit nodes in all 5 regions', 'visit_regions', '{}', 5, '{"gold": 3000, "xp": 1500}', 'hard', 10),

-- Weekly Activity Quests
('weekly_fish_50', 'weekly', 'Master Angler', 'Catch 50 fish', 'fish_catches', '{}', 50, '{"gold": 1500, "xp": 750}', 'normal', 1),
('weekly_fish_big_one', 'weekly', 'Big Game Fisher', 'Catch 3 Big Ones', 'fish_catches', '{"is_big_one": true}', 3, '{"gold": 3000, "xp": 1500}', 'hard', 10),
('weekly_puzzle_10', 'weekly', 'Archaeologist', 'Complete 10 ruins puzzles', 'puzzle_solves', '{}', 10, '{"gold": 2500, "xp": 1250}', 'normal', 5),

-- Weekly Social Quests
('weekly_coliseum_5', 'weekly', 'Arena Champion', 'Win 5 Coliseum matches', 'coliseum_wins', '{}', 5, '{"gold": 2000, "xp": 1000}', 'normal', 15),
('weekly_coliseum_15', 'weekly', 'Coliseum Legend', 'Win 15 Coliseum matches', 'coliseum_wins', '{}', 15, '{"gold": 5000, "xp": 2500}', 'elite', 20),
('weekly_party_battles_10', 'weekly', 'Team Player', 'Complete 10 battles with a party', 'party_battles', '{}', 10, '{"gold": 2000, "xp": 1000}', 'normal', 5)

ON CONFLICT (quest_key) DO NOTHING;
