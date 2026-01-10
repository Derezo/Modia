-- Migration 014: Social & PvP Systems
-- Adds notifications, friendships, LFG posts, and PvP enhancements

-- =====================================================
-- PART 1: Fix Party Schema Mismatches
-- =====================================================

-- Fix party_invites column names to match existing code
ALTER TABLE party_invites RENAME COLUMN from_user_id TO inviter_id;
ALTER TABLE party_invites RENAME COLUMN to_user_id TO invitee_id;

-- Add missing columns for party system
ALTER TABLE parties ADD COLUMN IF NOT EXISTS name VARCHAR(64);
ALTER TABLE parties RENAME COLUMN party_status TO status;
ALTER TABLE party_members ADD COLUMN IF NOT EXISTS is_ready BOOLEAN DEFAULT FALSE;

-- =====================================================
-- PART 2: Notifications System
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  message TEXT,
  payload JSONB,
  read_at TIMESTAMP,
  dismissed_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient unread notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

-- Index for cleanup of expired notifications
CREATE INDEX IF NOT EXISTS idx_notifications_expires
  ON notifications(expires_at)
  WHERE expires_at IS NOT NULL AND dismissed_at IS NULL;

-- =====================================================
-- PART 3: Friendships System
-- =====================================================

CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  is_favorite BOOLEAN DEFAULT FALSE,
  note VARCHAR(256),
  created_at TIMESTAMP DEFAULT NOW(),
  accepted_at TIMESTAMP,
  UNIQUE(user_id, friend_id),
  CHECK (user_id != friend_id),
  CHECK (status IN ('pending', 'accepted', 'blocked'))
);

-- Index for looking up friend requests sent to a user
CREATE INDEX IF NOT EXISTS idx_friendships_friend_status
  ON friendships(friend_id, status);

-- Index for looking up a user's friends
CREATE INDEX IF NOT EXISTS idx_friendships_user_status
  ON friendships(user_id, status);

-- =====================================================
-- PART 4: LFG (Looking For Group) Posts
-- =====================================================

CREATE TABLE IF NOT EXISTS lfg_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id INTEGER REFERENCES parties(id) ON DELETE CASCADE,
  title VARCHAR(64) NOT NULL,
  description VARCHAR(256),
  looking_for VARCHAR(32)[] DEFAULT '{}',
  min_level INTEGER DEFAULT 1,
  max_level INTEGER DEFAULT 100,
  content_tier INTEGER CHECK (content_tier IS NULL OR content_tier BETWEEN 1 AND 5),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for active LFG posts (sorted by expiration)
-- Note: We index all posts and filter at query time since NOW() is not immutable
CREATE INDEX IF NOT EXISTS idx_lfg_active
  ON lfg_posts(expires_at DESC);

-- Index for user's LFG posts (for enforcing one active post per user at query time)
CREATE INDEX IF NOT EXISTS idx_lfg_user_expires
  ON lfg_posts(user_id, expires_at DESC);

-- =====================================================
-- PART 5: PvP Enhancements
-- =====================================================

-- Match snapshots for replay/details
ALTER TABLE coliseum_matches
  ADD COLUMN IF NOT EXISTS match_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS match_stats JSONB;

-- Disconnect tracking for forfeit logic
CREATE TABLE IF NOT EXISTS pvp_disconnects (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id INTEGER REFERENCES coliseum_matches(id) ON DELETE SET NULL,
  disconnected_at TIMESTAMP NOT NULL,
  reconnected_at TIMESTAMP,
  was_forgiven BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pvp_disconnects_user
  ON pvp_disconnects(user_id, created_at DESC);

-- Weekly grace tracking for disconnects
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_disconnect_grace TIMESTAMP;

-- =====================================================
-- PART 6: Courtyard Feature for Castle Nodes
-- =====================================================

-- Update castle nodes to include courtyard feature if not present
UPDATE world_nodes
SET features = features || '["courtyard"]'::jsonb
WHERE node_type = 'castle'
  AND NOT (features ? 'courtyard');

-- =====================================================
-- PART 7: Helper Functions
-- =====================================================

-- Function to clean up expired notifications
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM notifications
  WHERE expires_at IS NOT NULL
    AND expires_at < NOW()
    AND dismissed_at IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired LFG posts
CREATE OR REPLACE FUNCTION cleanup_expired_lfg_posts()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM lfg_posts
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Verify all tables exist
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications'),
    'notifications table not created';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friendships'),
    'friendships table not created';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lfg_posts'),
    'lfg_posts table not created';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pvp_disconnects'),
    'pvp_disconnects table not created';

  RAISE NOTICE 'Migration 014 completed successfully';
END $$;
