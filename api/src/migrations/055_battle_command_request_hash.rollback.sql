ALTER TABLE battle_command_results
  DROP CONSTRAINT IF EXISTS battle_command_results_request_hash_format,
  DROP COLUMN IF EXISTS request_hash;
