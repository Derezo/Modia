-- Migration: 013_user_settings.sql
-- Description: Add user settings table for persisting user preferences
-- Created: January 2026

-- User settings table storing JSONB preferences
CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{"battle":{"actionMenuStyle":"radial"}}' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient user lookup
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp on changes
DROP TRIGGER IF EXISTS trigger_user_settings_updated ON user_settings;
CREATE TRIGGER trigger_user_settings_updated
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_user_settings_timestamp();

-- Comments
COMMENT ON TABLE user_settings IS 'Stores user preferences as JSONB for flexible settings';
COMMENT ON COLUMN user_settings.settings IS 'JSON object containing all user preferences. Schema: { battle: { actionMenuStyle: "radial"|"context"|"actionbar" } }';
