-- Migration: Error Tracking System
-- Adds tables for exception tracking and user feedback

-- Exception groups (unique exceptions by fingerprint)
-- Groups multiple occurrences of the same error together
CREATE TABLE exception_groups (
    id SERIAL PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL UNIQUE,
    exception_type VARCHAR(100),
    exception_message TEXT NOT NULL,
    stack_trace_normalized TEXT,
    source_file VARCHAR(255),
    source_line INTEGER,
    source_function VARCHAR(255),
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    occurrence_count INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'investigating', 'resolved', 'ignored')),
    resolved_at TIMESTAMP,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT
);

CREATE INDEX idx_exception_groups_fingerprint ON exception_groups(fingerprint);
CREATE INDEX idx_exception_groups_status ON exception_groups(status, last_seen_at DESC);

-- Exception events (individual occurrences)
-- Stores full context for each error occurrence
CREATE TABLE exception_events (
    id SERIAL PRIMARY KEY,
    exception_group_id INTEGER NOT NULL REFERENCES exception_groups(id) ON DELETE CASCADE,
    request_id VARCHAR(36),
    request_method VARCHAR(10),
    request_url TEXT,
    request_headers JSONB DEFAULT '{}',
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    full_stack_trace TEXT,
    error_context JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    environment VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_exception_events_group ON exception_events(exception_group_id, created_at DESC);
CREATE INDEX idx_exception_events_user ON exception_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_exception_events_request ON exception_events(request_id) WHERE request_id IS NOT NULL;

-- User feedback (enhancements, bugs, abuse reports)
-- Allows players to submit feedback from within the game
CREATE TYPE feedback_type AS ENUM ('enhancement', 'bug', 'abuse');
CREATE TYPE feedback_status AS ENUM ('pending', 'reviewing', 'resolved', 'declined');

CREATE TABLE user_feedback (
    id SERIAL PRIMARY KEY,
    feedback_type feedback_type NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    game_context JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    -- For abuse reports: the reported player
    reported_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reported_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    -- Admin tracking
    status feedback_status DEFAULT 'pending',
    admin_notes TEXT,
    resolved_at TIMESTAMP,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_feedback_user ON user_feedback(user_id, created_at DESC);
CREATE INDEX idx_user_feedback_type ON user_feedback(feedback_type, status);
CREATE INDEX idx_user_feedback_reported ON user_feedback(reported_user_id) WHERE reported_user_id IS NOT NULL;
CREATE INDEX idx_user_feedback_status ON user_feedback(status, created_at DESC);
