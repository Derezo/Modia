-- Bind each battle command idempotency receipt to the normalized request that
-- produced it. The nullable rollout preserves receipts written before this
-- migration; BattleStateRepository verifies and backfills those on replay.

ALTER TABLE battle_command_results
  ADD COLUMN IF NOT EXISTS request_hash VARCHAR(71);

ALTER TABLE battle_command_results
  DROP CONSTRAINT IF EXISTS battle_command_results_request_hash_format,
  ADD CONSTRAINT battle_command_results_request_hash_format
    CHECK (
      request_hash IS NULL
      OR request_hash ~ '^sha256:[0-9a-f]{64}$'
    );
