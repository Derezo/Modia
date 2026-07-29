-- Rollback Migration 057: Restore the original all-history uniqueness rule
--
-- Refuse the rollback before changing schema if the newly preserved history
-- cannot satisfy the former constraint. An operator can explicitly archive
-- duplicate history and retry; rollback never deletes player progress.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM character_quests
    GROUP BY character_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot rollback migration 057: character quest history contains duplicates';
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_character_quests_one_active;

ALTER TABLE character_quests
  ADD CONSTRAINT one_active_quest_per_character UNIQUE (character_id);
