-- ============================================
-- MULTIPLAYER SUPPORT MIGRATION
-- ============================================
-- Adds support for:
-- - Multi-player parties (grouping users for co-op/team battles)
-- - Flexible battle player system (3+ players)
-- - PvP rating/ELO tracking
-- - Additional battle types (co-op, team, FFA)
-- ============================================

-- Add new battle types for multiplayer modes
ALTER TYPE battle_type ADD VALUE IF NOT EXISTS 'pve_coop';
ALTER TYPE battle_type ADD VALUE IF NOT EXISTS 'pvp_team';
ALTER TYPE battle_type ADD VALUE IF NOT EXISTS 'pvp_ffa';

-- ============================================
-- CREATE ENUM TYPES (idempotent)
-- ============================================

DO $$ BEGIN
    CREATE TYPE party_type AS ENUM ('adventure', 'coliseum_team', 'raid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE party_status AS ENUM ('forming', 'ready', 'in_battle', 'disbanded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE party_role AS ENUM ('leader', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- PARTIES TABLE
-- ============================================
-- Multi-player party for grouping users together
-- Different from single-player "party" (which is just formation slots)

CREATE TABLE IF NOT EXISTS parties (
    id SERIAL PRIMARY KEY,
    leader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    party_type party_type DEFAULT 'adventure',
    party_status party_status DEFAULT 'forming',
    current_node_id INTEGER REFERENCES world_nodes(id),
    max_members INTEGER DEFAULT 4,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    disbanded_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_parties_leader ON parties(leader_id);
CREATE INDEX IF NOT EXISTS idx_parties_status ON parties(party_status) WHERE party_status != 'disbanded';

-- ============================================
-- PARTY MEMBERS TABLE
-- ============================================
-- Links users to parties with their role

CREATE TABLE IF NOT EXISTS party_members (
    id SERIAL PRIMARY KEY,
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    party_role party_role DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint if it doesn't exist
DO $$ BEGIN
    ALTER TABLE party_members ADD CONSTRAINT unique_user_party UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_party_members_party ON party_members(party_id);
CREATE INDEX IF NOT EXISTS idx_party_members_user ON party_members(user_id);

-- ============================================
-- PARTY INVITES TABLE
-- ============================================
-- Pending party invitations

CREATE TABLE IF NOT EXISTS party_invites (
    id SERIAL PRIMARY KEY,
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_status invite_status DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '5 minutes'),
    responded_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_party_invites_to_user ON party_invites(to_user_id) WHERE invite_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_party_invites_party ON party_invites(party_id) WHERE invite_status = 'pending';

-- ============================================
-- BATTLE PLAYERS TABLE
-- ============================================
-- Flexible player participation for 3+ player battles
-- Tracks which USERS are in a battle (not units - those are in battle_participants)
-- Replaces the need for fixed player1_id, player2_id columns

CREATE TABLE IF NOT EXISTS battle_players (
    id SERIAL PRIMARY KEY,
    battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team INTEGER DEFAULT 0,  -- 0 = no team (solo/FFA), 1+ = team number
    is_winner BOOLEAN,
    rewards JSONB,  -- Individual rewards for this participant
    connected BOOLEAN DEFAULT TRUE,
    disconnected_at TIMESTAMP,
    reconnected_at TIMESTAMP,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint if it doesn't exist
DO $$ BEGIN
    ALTER TABLE battle_players ADD CONSTRAINT unique_battle_player UNIQUE (battle_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_battle_players_battle ON battle_players(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_players_user ON battle_players(user_id);

-- ============================================
-- PVP RATINGS TABLE
-- ============================================
-- ELO-style rating tracking for competitive matchmaking

CREATE TABLE IF NOT EXISTS pvp_ratings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    queue_type VARCHAR(16) NOT NULL DEFAULT '1v1',  -- '1v1', '3v3', '5v5'
    rating INTEGER DEFAULT 1000,
    peak_rating INTEGER DEFAULT 1000,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    win_streak INTEGER DEFAULT 0,
    best_win_streak INTEGER DEFAULT 0,
    last_match_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint if it doesn't exist
DO $$ BEGIN
    ALTER TABLE pvp_ratings ADD CONSTRAINT unique_user_queue_rating UNIQUE (user_id, queue_type);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_pvp_ratings_user ON pvp_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_pvp_ratings_queue ON pvp_ratings(queue_type);
CREATE INDEX IF NOT EXISTS idx_pvp_ratings_leaderboard ON pvp_ratings(queue_type, rating DESC);

-- ============================================
-- COLISEUM MATCHES TABLE
-- ============================================
-- Track completed coliseum matches for history

CREATE TABLE IF NOT EXISTS coliseum_matches (
    id SERIAL PRIMARY KEY,
    battle_id INTEGER REFERENCES battles(id) ON DELETE SET NULL,
    queue_type VARCHAR(16) NOT NULL,
    winner_user_id INTEGER REFERENCES users(id),
    loser_user_id INTEGER REFERENCES users(id),
    winner_rating_change INTEGER,
    loser_rating_change INTEGER,
    match_duration_seconds INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coliseum_matches_winner ON coliseum_matches(winner_user_id);
CREATE INDEX IF NOT EXISTS idx_coliseum_matches_loser ON coliseum_matches(loser_user_id);
CREATE INDEX IF NOT EXISTS idx_coliseum_matches_recent ON coliseum_matches(created_at DESC);

-- ============================================
-- ADD QUEUE TYPE TO COLISEUM QUEUE
-- ============================================
-- Add queue type column if it doesn't exist

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'coliseum_queue' AND column_name = 'queue_type'
    ) THEN
        ALTER TABLE coliseum_queue ADD COLUMN queue_type VARCHAR(16) DEFAULT '1v1';
    END IF;
END $$;

-- ============================================
-- MIGRATION HELPER: Populate battle_players
-- ============================================
-- Migrate existing battles to use the new battle_players table

INSERT INTO battle_players (battle_id, user_id, team, is_winner, rewards)
SELECT
    id as battle_id,
    player1_id as user_id,
    1 as team,
    CASE
        WHEN status = 'victory' AND winner_id = player1_id THEN TRUE
        WHEN status = 'defeat' AND winner_id = player1_id THEN TRUE
        WHEN status IN ('victory', 'defeat') THEN FALSE
        ELSE NULL
    END as is_winner,
    CASE WHEN player1_id = winner_id OR (winner_id IS NULL AND status = 'victory') THEN rewards ELSE NULL END as rewards
FROM battles
WHERE player1_id IS NOT NULL
ON CONFLICT (battle_id, user_id) DO NOTHING;

INSERT INTO battle_players (battle_id, user_id, team, is_winner, rewards)
SELECT
    id as battle_id,
    player2_id as user_id,
    2 as team,
    CASE
        WHEN winner_id = player2_id THEN TRUE
        WHEN status IN ('victory', 'defeat') THEN FALSE
        ELSE NULL
    END as is_winner,
    CASE WHEN player2_id = winner_id THEN rewards ELSE NULL END as rewards
FROM battles
WHERE player2_id IS NOT NULL
ON CONFLICT (battle_id, user_id) DO NOTHING;
