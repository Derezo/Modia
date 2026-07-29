-- Immutable operator audit for supported redrive of exhausted battle terminal
-- effects. The ledger deliberately has no foreign key so it survives any
-- later outbox retention or cleanup policy.

CREATE TABLE IF NOT EXISTS battle_terminal_outbox_redrives (
  id BIGSERIAL PRIMARY KEY,
  outbox_event_id BIGINT NOT NULL,
  event_key VARCHAR(255) NOT NULL,
  previous_attempts INTEGER NOT NULL,
  previous_last_error TEXT,
  actor VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  redriven_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT battle_terminal_outbox_redrives_attempts_check
    CHECK (previous_attempts > 0),
  CONSTRAINT battle_terminal_outbox_redrives_actor_check
    CHECK (length(trim(actor)) > 0),
  CONSTRAINT battle_terminal_outbox_redrives_reason_check
    CHECK (length(trim(reason)) > 0 AND length(reason) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_battle_terminal_outbox_redrives_event
  ON battle_terminal_outbox_redrives(event_key, redriven_at DESC);

CREATE OR REPLACE FUNCTION prevent_battle_terminal_outbox_redrive_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% rows are immutable after insertion (attempted %)',
    TG_TABLE_NAME,
    TG_OP;
END
$$;

DROP TRIGGER IF EXISTS trg_battle_terminal_outbox_redrives_immutable
  ON battle_terminal_outbox_redrives;
CREATE TRIGGER trg_battle_terminal_outbox_redrives_immutable
BEFORE UPDATE OR DELETE
ON battle_terminal_outbox_redrives
FOR EACH ROW
EXECUTE FUNCTION prevent_battle_terminal_outbox_redrive_mutation();

COMMENT ON TABLE battle_terminal_outbox_redrives IS
  'Immutable audit ledger for operator redrive of exhausted battle terminal effects';
