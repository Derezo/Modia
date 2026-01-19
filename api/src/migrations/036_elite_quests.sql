-- Migration 036: Elite Quest System
-- Adds elite daily quests, cosmetic titles, and rare equipment

-- ============================================
-- ELITE DAILY QUEST TEMPLATES
-- ============================================
-- Elite quests are unlocked by achieving a Perfect Week
-- They offer 2x rewards but require significantly more effort

INSERT INTO daily_quest_templates (
  quest_key, quest_name, quest_description, period, objective_type,
  objective_requirements, target_count, rewards, difficulty, min_level, max_level, selection_weight, is_active
) VALUES
-- Elite Daily Quests
('elite_daily_massacre', 'Massacre', 'Eliminate 30 enemies in a single day', 'daily', 'kill_enemies',
 '{"enemy_types": ["any"]}', 30, '{"gold": 800, "xp": 400}', 'elite', 25, 100, 50, true),
('elite_daily_explorer', 'Master Explorer', 'Visit 15 unique nodes', 'daily', 'visit_nodes',
 '{}', 15, '{"gold": 600, "xp": 300}', 'elite', 25, 100, 50, true),
('elite_daily_angler', 'Legendary Angler', 'Catch 3 Big One fish', 'daily', 'fish_catches',
 '{"is_big_one": true}', 3, '{"gold": 1000, "xp": 500}', 'elite', 20, 100, 50, true),
('elite_daily_merchant', 'Trade Baron', 'Sell 10 items on marketplace', 'daily', 'items_sold',
 '{}', 10, '{"gold": 1200, "xp": 600}', 'elite', 25, 100, 50, true);

-- ============================================
-- TITLE DEFINITIONS TABLE
-- ============================================
-- Defines available titles and how they are earned

CREATE TABLE IF NOT EXISTS title_definitions (
  id SERIAL PRIMARY KEY,
  title_key VARCHAR(50) UNIQUE NOT NULL,
  title_name VARCHAR(100) NOT NULL,
  title_description TEXT,
  rarity VARCHAR(20) DEFAULT 'rare' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  requirement_type VARCHAR(50),  -- 'perfect_week', 'elite_quest', 'achievement', 'manual'
  requirement_value JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed title definitions
INSERT INTO title_definitions (title_key, title_name, title_description, rarity, requirement_type, requirement_value) VALUES
('perfectionist', 'The Perfectionist', 'Achieved a Perfect Week by completing all daily quests for 7 consecutive days', 'epic', 'perfect_week', '{}'),
('elite_hunter', 'Elite Hunter', 'Completed 10 elite quests', 'legendary', 'elite_quest', '{"count": 10}'),
('quest_champion', 'Quest Champion', 'Completed 100 quests total', 'rare', 'achievement', '{"count": 100}'),
('dedicated', 'The Dedicated', 'Maintained a 30-day login streak', 'epic', 'streak', '{"days": 30}'),
('first_blood', 'First Strike', 'Claimed First Blood 5 times', 'rare', 'first_blood', '{"count": 5}');

-- ============================================
-- ELITE QUEST COMPLETION TRACKING
-- ============================================
-- Track elite quest completions for title progress

CREATE TABLE IF NOT EXISTS character_elite_quest_stats (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  elite_quests_completed INTEGER DEFAULT 0,
  elite_quests_claimed INTEGER DEFAULT 0,
  first_elite_completed_at TIMESTAMP,
  last_elite_completed_at TIMESTAMP,
  CONSTRAINT unique_elite_stats UNIQUE (character_id)
);

CREATE INDEX IF NOT EXISTS idx_elite_stats_character
  ON character_elite_quest_stats(character_id);

-- ============================================
-- RARE EQUIPMENT FOR ELITE QUEST DROPS
-- ============================================
-- These items have a chance to drop when claiming elite quest rewards

INSERT INTO item_templates (
  name, description, item_type, equipment_slot, stat_bonuses,
  level_requirement, base_price, rarity, is_tradeable, sprite_id
) VALUES
-- Epic Weapons (rarity 4)
('Perfectionist''s Blade', 'A blade forged for those who accept nothing less than perfection',
 'weapon', 'main_hand', '{"strength": 25, "agility": 15, "luck": 10}',
 25, 5000, 4, true, 'weapon_perfectionist_blade'),

('Staff of Diligence', 'A magical staff that rewards dedication with power',
 'weapon', 'main_hand', '{"intelligence": 30, "mp": 100, "magic_attack": 20}',
 25, 5000, 4, true, 'weapon_staff_diligence'),

-- Epic Armor (rarity 4)
('Crown of Diligence', 'Worn by those who prove their dedication week after week',
 'armor', 'head', '{"vitality": 20, "intelligence": 15, "mp": 50}',
 25, 4500, 4, true, 'armor_crown_diligence'),

('Vestments of Persistence', 'Armor blessed by the gods of perseverance',
 'armor', 'body', '{"vitality": 35, "defense": 25, "hp": 150}',
 25, 5500, 4, true, 'armor_vestments_persistence'),

-- Epic Accessories (rarity 4)
('Ring of the Dedicated', 'A symbol of unwavering commitment to one''s goals',
 'accessory', 'accessory', '{"luck": 20, "agility": 10, "hp": 100}',
 20, 4000, 4, true, 'accessory_ring_dedicated'),

('Pendant of Excellence', 'Grants its wearer the fortune of the committed',
 'accessory', 'accessory', '{"luck": 15, "strength": 10, "intelligence": 10, "crit_rate": 5}',
 20, 4500, 4, true, 'accessory_pendant_excellence');

-- ============================================
-- HELPER FUNCTION: CHECK ELITE QUEST ACCESS
-- ============================================
-- Returns true if character has unlocked elite quests via Perfect Week

CREATE OR REPLACE FUNCTION has_elite_quest_access(p_character_id INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM character_perfect_weeks
    WHERE character_id = p_character_id
      AND elite_quest_access = TRUE
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: AWARD TITLE ON PERFECT WEEK
-- ============================================
-- Automatically awards "The Perfectionist" title when Perfect Week is achieved

CREATE OR REPLACE FUNCTION award_perfectionist_title()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_perfect = TRUE AND (OLD.is_perfect IS NULL OR OLD.is_perfect = FALSE) THEN
    -- Award the title if not already owned
    INSERT INTO character_titles (character_id, title)
    VALUES (NEW.character_id, 'The Perfectionist')
    ON CONFLICT (character_id, title) DO NOTHING;

    -- Grant elite quest access for next period
    NEW.elite_quest_access := TRUE;
    NEW.badge_granted := TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_award_perfectionist ON character_perfect_weeks;
CREATE TRIGGER trigger_award_perfectionist
  BEFORE UPDATE ON character_perfect_weeks
  FOR EACH ROW
  EXECUTE FUNCTION award_perfectionist_title();

-- ============================================
-- UPDATE ELITE QUEST STATS FUNCTION
-- ============================================
-- Call this when an elite quest is completed

CREATE OR REPLACE FUNCTION update_elite_quest_stats(p_character_id INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO character_elite_quest_stats (character_id, elite_quests_completed, first_elite_completed_at, last_elite_completed_at)
  VALUES (p_character_id, 1, NOW(), NOW())
  ON CONFLICT (character_id) DO UPDATE SET
    elite_quests_completed = character_elite_quest_stats.elite_quests_completed + 1,
    last_elite_completed_at = NOW();

  -- Check if Elite Hunter title should be awarded (10 elite quests)
  IF (SELECT elite_quests_completed FROM character_elite_quest_stats WHERE character_id = p_character_id) >= 10 THEN
    INSERT INTO character_titles (character_id, title)
    VALUES (p_character_id, 'Elite Hunter')
    ON CONFLICT (character_id, title) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;
