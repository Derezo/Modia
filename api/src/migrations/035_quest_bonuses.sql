-- Migration 035: Quest Bonus Mechanics
-- Adds First Blood, Completion Bonus, and Perfect Week tracking

-- ============================================
-- FIRST BLOOD TRACKING
-- ============================================
-- First character to complete each quest template in a period gets bonus
ALTER TABLE daily_quest_history
  ADD COLUMN IF NOT EXISTS first_blood BOOLEAN DEFAULT FALSE;

-- Partial unique index ensures only one first_blood per quest per period
-- Uses unique constraint on (quest_template_id, period_start) WHERE first_blood = TRUE
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_quest_first_blood
  ON daily_quest_history (quest_template_id, period_start)
  WHERE first_blood = TRUE;

-- ============================================
-- COMPLETION BONUS TRACKING
-- ============================================
-- Track when a character completes ALL daily quests in a single day
CREATE TABLE IF NOT EXISTS character_completion_bonuses (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  period_start TIMESTAMP NOT NULL,  -- Day when bonus was earned
  bonus_gold INTEGER NOT NULL DEFAULT 0,
  bonus_xp INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_completion_bonus UNIQUE (character_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_completion_bonuses_character
  ON character_completion_bonuses(character_id);

-- ============================================
-- PERFECT WEEK TRACKING
-- ============================================
-- Track consecutive days of completing all quests for Perfect Week achievement
CREATE TABLE IF NOT EXISTS character_perfect_weeks (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  week_start TIMESTAMP NOT NULL,

  -- Track each day's completion (bitmask or count)
  days_completed INTEGER DEFAULT 0,  -- Count of days with all quests done
  day_1_complete BOOLEAN DEFAULT FALSE,
  day_2_complete BOOLEAN DEFAULT FALSE,
  day_3_complete BOOLEAN DEFAULT FALSE,
  day_4_complete BOOLEAN DEFAULT FALSE,
  day_5_complete BOOLEAN DEFAULT FALSE,
  day_6_complete BOOLEAN DEFAULT FALSE,
  day_7_complete BOOLEAN DEFAULT FALSE,

  -- Achievement state
  is_perfect BOOLEAN DEFAULT FALSE,      -- True when all 7 days complete
  rewards_claimed BOOLEAN DEFAULT FALSE, -- True when rewards have been claimed
  elite_quest_access BOOLEAN DEFAULT FALSE,  -- Unlocks elite quests for next week
  badge_granted BOOLEAN DEFAULT FALSE,   -- Profile badge awarded

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,  -- When Perfect Week was achieved

  CONSTRAINT unique_perfect_week UNIQUE (character_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_perfect_weeks_character
  ON character_perfect_weeks(character_id);

CREATE INDEX IF NOT EXISTS idx_perfect_weeks_active
  ON character_perfect_weeks(character_id, week_start)
  WHERE is_perfect = FALSE;

-- ============================================
-- QUEST CHAMPIONS VIEW
-- ============================================
-- Leaderboard view for Perfect Week achievers
CREATE OR REPLACE VIEW quest_champions AS
  SELECT
    c.id as character_id,
    c.name as character_name,
    c.class,
    c.level,
    u.username,
    cpw.week_start,
    cpw.completed_at,
    cpw.badge_granted,
    cpw.elite_quest_access
  FROM character_perfect_weeks cpw
  JOIN characters c ON c.id = cpw.character_id
  JOIN users u ON u.id = c.user_id
  WHERE cpw.is_perfect = TRUE
  ORDER BY cpw.completed_at DESC;

-- ============================================
-- FIRST BLOOD CHAMPIONS VIEW
-- ============================================
-- View showing today's First Blood winners
CREATE OR REPLACE VIEW todays_first_blood AS
  SELECT
    dqh.quest_template_id,
    dqt.quest_name,
    dqt.period,
    c.id as character_id,
    c.name as character_name,
    c.class,
    u.username,
    dqh.completed_at
  FROM daily_quest_history dqh
  JOIN daily_quest_templates dqt ON dqt.id = dqh.quest_template_id
  JOIN characters c ON c.id = dqh.character_id
  JOIN users u ON u.id = c.user_id
  WHERE dqh.first_blood = TRUE
    AND dqh.period_start >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
  ORDER BY dqh.completed_at;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Check if character has completed all daily quests for current period
CREATE OR REPLACE FUNCTION has_completed_all_daily_quests(p_character_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_period_start TIMESTAMP;
  v_total_assigned INTEGER;
  v_total_completed INTEGER;
BEGIN
  v_period_start := get_daily_period_start();

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_completed = TRUE)
  INTO v_total_assigned, v_total_completed
  FROM character_daily_quests
  WHERE character_id = p_character_id
    AND period = 'daily'
    AND period_start = v_period_start;

  -- Must have all 3 daily quests assigned and completed
  RETURN v_total_assigned >= 3 AND v_total_completed = v_total_assigned;
END;
$$ LANGUAGE plpgsql;

-- Get current week day number (1-7, Monday=1)
CREATE OR REPLACE FUNCTION get_current_week_day()
RETURNS INTEGER AS $$
BEGIN
  -- EXTRACT(DOW ...) returns 0=Sunday, 1=Monday, etc.
  -- Convert to 1=Monday, 7=Sunday
  RETURN CASE EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')
    WHEN 0 THEN 7  -- Sunday
    ELSE EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::INTEGER
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update Perfect Week progress for a character
CREATE OR REPLACE FUNCTION update_perfect_week_progress(p_character_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_week_start TIMESTAMP;
  v_day_num INTEGER;
BEGIN
  v_week_start := get_weekly_period_start();
  v_day_num := get_current_week_day();

  -- Validate day number is within expected range (defense in depth)
  IF v_day_num < 1 OR v_day_num > 7 THEN
    RAISE EXCEPTION 'Invalid day number: %. Expected 1-7.', v_day_num;
  END IF;

  -- Insert or update the perfect week record
  INSERT INTO character_perfect_weeks (character_id, week_start, days_completed)
  VALUES (p_character_id, v_week_start, 0)
  ON CONFLICT (character_id, week_start) DO NOTHING;

  -- Update the specific day column
  EXECUTE format(
    'UPDATE character_perfect_weeks SET day_%s_complete = TRUE, days_completed = days_completed + 1 WHERE character_id = $1 AND week_start = $2 AND day_%s_complete = FALSE',
    v_day_num, v_day_num
  ) USING p_character_id, v_week_start;

  -- Check if perfect week achieved (all 7 days)
  UPDATE character_perfect_weeks
  SET is_perfect = TRUE, completed_at = NOW()
  WHERE character_id = p_character_id
    AND week_start = v_week_start
    AND days_completed = 7
    AND is_perfect = FALSE;
END;
$$ LANGUAGE plpgsql;
