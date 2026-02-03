-- Queue ban tracking for formation phase timeouts
CREATE TABLE IF NOT EXISTS coliseum_queue_bans (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    queue_type VARCHAR(16) NOT NULL,
    ban_until TIMESTAMP NOT NULL,
    reason VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, queue_type)
);

-- Index for efficient ban lookups (includes ban_until for filtering)
CREATE INDEX IF NOT EXISTS idx_coliseum_queue_bans_lookup
ON coliseum_queue_bans(user_id, queue_type, ban_until);
