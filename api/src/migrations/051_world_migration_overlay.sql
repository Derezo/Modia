-- Persist the deterministic semantic overlay applied by a player-preserving
-- world migration. Ordinary generated worlds leave this metadata NULL.

ALTER TABLE seed_metadata
  ADD COLUMN IF NOT EXISTS migration_overlay JSONB;
