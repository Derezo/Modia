-- Exactly-once receipts for battle terminal quest/progression effects.
-- The receipt is inserted and finalized in the same transaction as every
-- mutation performed by BattleTerminalProgression.

ALTER TABLE character_quests
  ADD COLUMN IF NOT EXISTS completion_battle_id INTEGER;

CREATE TABLE IF NOT EXISTS battle_terminal_progression_receipts (
  event_key VARCHAR(255) PRIMARY KEY,
  event_kind VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT battle_terminal_progression_receipts_kind_check
    CHECK (event_kind IN ('pve_victory', 'coliseum_victory')),
  CONSTRAINT battle_terminal_progression_receipts_payload_check
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT battle_terminal_progression_receipts_result_check
    CHECK (jsonb_typeof(result) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_quests_completion_battle
  ON character_quests(completion_battle_id)
  WHERE completion_battle_id IS NOT NULL;
