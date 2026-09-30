-- Rollback for migration 068: drop the one-leader-per-user index.
-- Characters moved out of slot 1 by the repair step are not restored; they
-- remain recruitable into the formation as before.
DROP INDEX IF EXISTS uniq_characters_user_party_leader;
