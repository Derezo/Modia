-- Migration 068: At most one party leader (party_slot = 1) per user
--
-- POST /api/characters and registration create a user's first character in
-- party_slot 1 under a users-row FOR UPDATE lock plus a count re-check. This
-- partial unique index is the database backstop behind that lock: a second
-- slot-1 character for the same user fails with 23505 (409) instead of
-- creating an extra free character.
--
-- Only slot 1 is constrained. Formation and battle-party writes clear slots
-- before re-assigning them, but recruitment picks MAX(party_slot)+1 capped at
-- the party size, which can repeat a higher slot, so a full
-- (user_id, party_slot) index is not safe yet.
--
-- Repair first: if a user already has several slot-1 characters, keep the
-- oldest (lowest id) as leader and move the rest out of the formation.
-- Idempotent: a re-run repairs nothing and the index already exists.

SET LOCAL lock_timeout = '5s';

UPDATE characters c
SET party_slot = NULL
WHERE c.party_slot = 1
  AND EXISTS (
    SELECT 1 FROM characters older
    WHERE older.user_id = c.user_id
      AND older.party_slot = 1
      AND older.id < c.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_characters_user_party_leader
  ON characters (user_id)
  WHERE party_slot = 1;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'characters'
      AND indexname = 'uniq_characters_user_party_leader'
  ), 'Migration 068 failed: party leader index missing';
  RAISE NOTICE 'Migration 068 completed successfully';
END $$;
