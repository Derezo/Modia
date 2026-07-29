-- Migration 057: Preserve advancement quest history while enforcing one active quest

ALTER TABLE character_quests
  DROP CONSTRAINT IF EXISTS one_active_quest_per_character;

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_quests_one_active
  ON character_quests(character_id)
  WHERE status IN ('active', 'boss_ready');
