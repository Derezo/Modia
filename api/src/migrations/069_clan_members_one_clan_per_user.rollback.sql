-- Rollback for migration 069: drop the one-clan-per-user index.
-- Memberships deleted by the repair step are not restored.
DROP INDEX IF EXISTS uniq_clan_members_user;
