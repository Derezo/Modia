DROP TRIGGER IF EXISTS trg_battle_terminal_outbox_redrives_immutable
  ON battle_terminal_outbox_redrives;
DROP TABLE IF EXISTS battle_terminal_outbox_redrives;
DROP FUNCTION IF EXISTS prevent_battle_terminal_outbox_redrive_mutation();
