-- ============================================
-- COLISEUM TIER SYSTEM MIGRATION
-- ============================================
-- Adds tier tracking columns to pvp_ratings table
-- for the Coliseum PvP ranking system.
--
-- Tiers:
--   Unranked:    0-999     (Gray)
--   Bronze:      1000-1199 (Bronze)
--   Silver:      1200-1399 (Silver)
--   Gold:        1400-1599 (Gold)
--   Platinum:    1600-1799 (Ice Blue)
--   Master:      1800-1999 (Purple)
--   Grandmaster: 2000+     (Crimson)
-- ============================================

-- Add tier column to track current tier
ALTER TABLE pvp_ratings
ADD COLUMN IF NOT EXISTS tier VARCHAR(32);

-- Add peak_tier column to track highest tier achieved
ALTER TABLE pvp_ratings
ADD COLUMN IF NOT EXISTS peak_tier VARCHAR(32);

-- Add tier_protection_losses to track losses at tier boundary
-- (for future tier demotion protection feature)
ALTER TABLE pvp_ratings
ADD COLUMN IF NOT EXISTS tier_protection_losses INTEGER DEFAULT 0;

-- Create function to calculate tier from rating
CREATE OR REPLACE FUNCTION get_tier_from_rating(rating INTEGER)
RETURNS VARCHAR(32) AS $$
BEGIN
  IF rating >= 2000 THEN RETURN 'Grandmaster';
  ELSIF rating >= 1800 THEN RETURN 'Master';
  ELSIF rating >= 1600 THEN RETURN 'Platinum';
  ELSIF rating >= 1400 THEN RETURN 'Gold';
  ELSIF rating >= 1200 THEN RETURN 'Silver';
  ELSIF rating >= 1000 THEN RETURN 'Bronze';
  ELSE RETURN 'Unranked';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update existing records with calculated tiers
UPDATE pvp_ratings
SET tier = get_tier_from_rating(rating),
    peak_tier = get_tier_from_rating(peak_rating)
WHERE tier IS NULL OR peak_tier IS NULL;

-- Add index for tier-based queries (leaderboard filtering by tier)
CREATE INDEX IF NOT EXISTS idx_pvp_ratings_tier ON pvp_ratings(queue_type, tier);

-- Comment on columns for documentation
COMMENT ON COLUMN pvp_ratings.tier IS 'Current competitive tier based on rating (Unranked, Bronze, Silver, Gold, Platinum, Master, Grandmaster)';
COMMENT ON COLUMN pvp_ratings.peak_tier IS 'Highest tier ever achieved by this player';
COMMENT ON COLUMN pvp_ratings.tier_protection_losses IS 'Number of losses at tier boundary before demotion (for tier protection feature)';
