-- Migration 025: Clan System
-- Adds clans for social grouping with invites and chat support

-- =====================================================
-- PART 1: Clans Table
-- =====================================================

CREATE TABLE IF NOT EXISTS clans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(32) UNIQUE NOT NULL,
  tag VARCHAR(6) NOT NULL,
  leader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description VARCHAR(256),
  max_members INTEGER DEFAULT 50,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for searching clans by name
CREATE INDEX IF NOT EXISTS idx_clans_name ON clans(name);

-- Index for finding clans led by a user
CREATE INDEX IF NOT EXISTS idx_clans_leader ON clans(leader_id);

-- =====================================================
-- PART 2: Clan Members Table
-- =====================================================

CREATE TABLE IF NOT EXISTS clan_members (
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(16) DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (clan_id, user_id),
  CHECK (role IN ('leader', 'officer', 'member'))
);

-- Index for finding a user's clan
CREATE INDEX IF NOT EXISTS idx_clan_members_user ON clan_members(user_id);

-- =====================================================
-- PART 3: Clan Invites Table
-- =====================================================

CREATE TABLE IF NOT EXISTS clan_invites (
  id SERIAL PRIMARY KEY,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) DEFAULT 'pending',
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMP DEFAULT NOW(),
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired'))
);

-- Index for finding pending invites for a user
CREATE INDEX IF NOT EXISTS idx_clan_invites_invitee
  ON clan_invites(invitee_id, status)
  WHERE status = 'pending';

-- Index for finding invites by clan
CREATE INDEX IF NOT EXISTS idx_clan_invites_clan ON clan_invites(clan_id);

-- =====================================================
-- PART 4: Clan Chat Messages Table
-- =====================================================

CREATE TABLE IF NOT EXISTS clan_messages (
  id SERIAL PRIMARY KEY,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fetching recent clan messages
CREATE INDEX IF NOT EXISTS idx_clan_messages_clan_time
  ON clan_messages(clan_id, created_at DESC);
