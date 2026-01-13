-- Skill System Overhaul
-- ============================================
-- Adds spent_xp tracking for character leveling based on skill investment
-- Character level is now calculated from cumulative XP spent on skills

-- Add spent_xp column to track cumulative XP invested in skills
ALTER TABLE characters
ADD COLUMN IF NOT EXISTS spent_xp BIGINT DEFAULT 0 NOT NULL;

-- Create index for level queries that may filter by spent_xp
CREATE INDEX IF NOT EXISTS idx_characters_spent_xp ON characters(spent_xp);

-- Backfill spent_xp from existing skill investments
-- Formula approximates total cost: sum of (baseCost * level * 1.2^(level-1))
-- Using average baseCost of 50 as approximation
UPDATE characters c
SET spent_xp = COALESCE((
  SELECT SUM(
    GREATEST(1, 50 * cs.level * POWER(1.2, cs.level - 1))::BIGINT
  )
  FROM character_skills cs
  WHERE cs.character_id = c.id
), 0)
WHERE spent_xp = 0;

-- Migrate existing skill levels from 1-20 scale to 1-100 scale
-- Proportional conversion: new_level = (old_level / old_max_level) * 100
-- Old max was typically 10-20, using 10 as default
UPDATE character_skills
SET level = LEAST(100, GREATEST(1, level * 5))
WHERE level < 100;

-- Remove the old level constraint if it exists and add new one for max 100
-- Note: The original constraint is CHECK (level >= 1) - no max limit was set
-- We'll add a new constraint with max 100
ALTER TABLE character_skills DROP CONSTRAINT IF EXISTS character_skills_level_check;
ALTER TABLE character_skills ADD CONSTRAINT character_skills_level_check CHECK (level >= 1 AND level <= 100);

-- Add a comment explaining the spent_xp system
COMMENT ON COLUMN characters.spent_xp IS 'Cumulative XP spent on learning skills. Character level derived from spent_xp using formula: level where spent_xp >= level^2.8 * 100';
