-- Chat and Presence System Migration
-- ============================================

-- Create presence status enum
CREATE TYPE presence_status AS ENUM ('online', 'away', 'busy', 'offline');

-- ============================================
-- PLAYER PRESENCE TABLE
-- ============================================
CREATE TABLE player_presence (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status presence_status DEFAULT 'offline',
    custom_message VARCHAR(128),
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    current_node_id INTEGER REFERENCES world_nodes(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_presence UNIQUE (user_id)
);

CREATE INDEX idx_presence_status ON player_presence(status) WHERE status != 'offline';
CREATE INDEX idx_presence_user ON player_presence(user_id);

-- ============================================
-- ENHANCE CHAT MESSAGES TABLE
-- ============================================
-- Add room_type to distinguish message types
ALTER TABLE chat_messages ADD COLUMN room_type VARCHAR(32) DEFAULT 'global';

-- Add target_user_id for direct messages
ALTER TABLE chat_messages ADD COLUMN target_user_id INTEGER REFERENCES users(id);

-- Add party_id for party chat
ALTER TABLE chat_messages ADD COLUMN party_id INTEGER;

-- Add reactions as JSONB array
ALTER TABLE chat_messages ADD COLUMN reactions JSONB DEFAULT '[]';

-- Add sender_user_id (direct link to user for easier queries)
ALTER TABLE chat_messages ADD COLUMN sender_user_id INTEGER REFERENCES users(id);

-- Create indexes for efficient querying
CREATE INDEX idx_chat_room_type ON chat_messages(room_type, created_at DESC);
CREATE INDEX idx_chat_dm ON chat_messages(sender_user_id, target_user_id, created_at DESC)
    WHERE room_type = 'dm';
CREATE INDEX idx_chat_party ON chat_messages(party_id, created_at DESC)
    WHERE room_type = 'party';

-- ============================================
-- MESSAGE REACTIONS TABLE (normalized)
-- ============================================
CREATE TABLE chat_reactions (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_message_reaction UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON chat_reactions(message_id);

-- ============================================
-- FUNCTION: Update presence timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_presence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_presence_update
    BEFORE UPDATE ON player_presence
    FOR EACH ROW
    EXECUTE FUNCTION update_presence_timestamp();
