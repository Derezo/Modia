-- Durable, transactional delivery for effects that happen after a battle
-- reaches a terminal state. Producers insert through the same transaction as
-- the terminal battle mutation; independent workers lease and dispatch rows.

CREATE TABLE IF NOT EXISTS battle_terminal_effect_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_key VARCHAR(255) NOT NULL UNIQUE,
  -- Deliberately not a foreign key: a queued terminal effect must survive
  -- later battle-history cleanup until it is dispatched or retained for ops.
  battle_id INTEGER NOT NULL,
  event_type VARCHAR(96) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claim_token UUID,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT battle_terminal_effect_outbox_event_type_check
    CHECK (length(trim(event_type)) > 0),
  CONSTRAINT battle_terminal_effect_outbox_payload_check
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT battle_terminal_effect_outbox_attempts_check
    CHECK (attempts >= 0),
  CONSTRAINT battle_terminal_effect_outbox_claim_check
    CHECK (
      (claim_token IS NULL AND claimed_at IS NULL)
      OR
      (claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    ),
  CONSTRAINT battle_terminal_effect_outbox_processed_check
    CHECK (
      processed_at IS NULL
      OR
      (claim_token IS NULL AND claimed_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_battle_terminal_effect_outbox_pending
  ON battle_terminal_effect_outbox(next_attempt_at, id)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_battle_terminal_effect_outbox_battle
  ON battle_terminal_effect_outbox(battle_id, event_type);
