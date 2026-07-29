DROP TABLE IF EXISTS battle_terminal_progression_receipts;
DROP INDEX IF EXISTS idx_character_quests_completion_battle;
ALTER TABLE character_quests
  DROP COLUMN IF EXISTS completion_battle_id;
