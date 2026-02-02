-- ============================================
-- PVP ACHIEVEMENTS MIGRATION
-- ============================================
-- Adds achievement badges system for Coliseum PvP
--
-- Badge Types:
--   Milestone Badges (Permanent):
--     - first_blood: Win first PvP match
--     - veteran: Win 50 PvP matches
--     - legend: Win 200 PvP matches
--     - climber: Reach Gold tier
--     - elite: Reach Master tier
--     - champion: Reach Grandmaster tier
--
--   Skill Badges (Earned Through Feats):
--     - giant_slayer: Beat opponent 200+ ELO above you
--     - underdog: Win with 20%+ PPR disadvantage
--     - flawless: Win without losing a single unit
--     - comeback: Win after losing 50%+ of units first
--
--   Streak Badges (Dynamic - computed from winStreak, not stored)
-- ============================================

-- Create pvp_achievements table
CREATE TABLE IF NOT EXISTS pvp_achievements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key VARCHAR(64) NOT NULL,
  earned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);

-- Index for efficient user badge lookups
CREATE INDEX IF NOT EXISTS idx_pvp_achievements_user ON pvp_achievements(user_id);

-- Index for querying all users with a specific badge
CREATE INDEX IF NOT EXISTS idx_pvp_achievements_key ON pvp_achievements(achievement_key);

-- Comments for documentation
COMMENT ON TABLE pvp_achievements IS 'Stores permanently earned PvP achievement badges for users';
COMMENT ON COLUMN pvp_achievements.user_id IS 'User who earned the achievement';
COMMENT ON COLUMN pvp_achievements.achievement_key IS 'Unique key identifying the achievement type (e.g., first_blood, veteran)';
COMMENT ON COLUMN pvp_achievements.earned_at IS 'Timestamp when the achievement was earned';

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pvp_achievements'),
    'pvp_achievements table not created';

  RAISE NOTICE 'Migration 047 (PvP Achievements) completed successfully';
END $$;
