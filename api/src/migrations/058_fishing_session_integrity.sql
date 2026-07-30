-- Durable fishing sessions make refresh recovery and reward settlement
-- authoritative across API workers and process restarts.

CREATE TABLE IF NOT EXISTS user_fishing_sessions (
  session_id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  node_name VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_catch_at TIMESTAMPTZ,
  catches JSONB NOT NULL DEFAULT '[]'::JSONB,
  total_value INTEGER NOT NULL DEFAULT 0,
  big_one_active BOOLEAN NOT NULL DEFAULT FALSE,
  big_one_expires_at TIMESTAMPTZ,
  big_one_fish JSONB,
  collection_result JSONB,
  collected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_fishing_sessions_status_check
    CHECK (status IN ('active', 'collected', 'expired')),
  CONSTRAINT user_fishing_sessions_catches_check
    CHECK (jsonb_typeof(catches) = 'array'),
  CONSTRAINT user_fishing_sessions_total_value_check
    CHECK (total_value >= 0),
  CONSTRAINT user_fishing_sessions_big_one_check
    CHECK (
      (big_one_active = FALSE)
      OR (big_one_expires_at IS NOT NULL AND big_one_fish IS NOT NULL)
    ),
  CONSTRAINT user_fishing_sessions_result_check
    CHECK (
      collection_result IS NULL
      OR jsonb_typeof(collection_result) = 'object'
    )
);

-- A user can fish at only one node at a time. This partial unique index is
-- also the cross-process arbiter for concurrent start requests.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fishing_sessions_one_active_per_user
  ON user_fishing_sessions(user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_fishing_sessions_user_status
  ON user_fishing_sessions(user_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_fishing_sessions_node
  ON user_fishing_sessions(node_id);
