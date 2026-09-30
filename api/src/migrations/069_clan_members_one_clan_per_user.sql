-- Migration 069: A user belongs to at most one clan
--
-- clan_members has PRIMARY KEY (clan_id, user_id) and only a non-unique index
-- on user_id, so two concurrent invite accepts from different clans could put
-- one user in two clans. clanService.acceptInvite now serializes on the users
-- row; this unique index is the database backstop (23505 -> 409).
--
-- Repair first: if a user already has several memberships, keep one (a leader
-- row first, then the earliest joined) and delete the rest.
-- Idempotent: a re-run repairs nothing and the index already exists.

SET LOCAL lock_timeout = '5s';

DELETE FROM clan_members cm
USING (
  SELECT clan_id, user_id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY (role = 'leader') DESC, joined_at ASC NULLS LAST, clan_id ASC
         ) AS rn
  FROM clan_members
) ranked
WHERE ranked.rn > 1
  AND cm.clan_id = ranked.clan_id
  AND cm.user_id = ranked.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_clan_members_user
  ON clan_members (user_id);

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'clan_members'
      AND indexname = 'uniq_clan_members_user'
  ), 'Migration 069 failed: one-clan-per-user index missing';
  RAISE NOTICE 'Migration 069 completed successfully';
END $$;
