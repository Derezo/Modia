-- Migration 067: Purge legacy bcrypt refresh-token sessions
--
-- v0.5.2 stores refresh tokens as sha256 hex (hashRefreshToken) and looks
-- sessions up by exact hash; bcrypt truncated JWTs at 72 bytes, so the old
-- bcrypt rows are deliberately no longer accepted (POST /auth/refresh).
-- Every user_sessions row written before this release holds a bcrypt hash
-- ('$2a$' / '$2b$' prefix) and can never match again. Delete them so the
-- cut-over is explicit and they do not linger for up to 7 days.
--
-- RELEASE NOTE: every player signed in before the v0.5.2 deploy is asked to
-- log in again once their current access token (1h) expires.
--
-- sha256 hex never starts with '$', so this only matches bcrypt rows.
-- Idempotent: a re-run deletes nothing.

SET LOCAL lock_timeout = '5s';

DELETE FROM user_sessions
WHERE refresh_token_hash LIKE '$2%';

DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM user_sessions WHERE refresh_token_hash LIKE '$2%'
  ), 'Migration 067 failed: bcrypt refresh sessions remain';
  RAISE NOTICE 'Migration 067 completed successfully';
END $$;
