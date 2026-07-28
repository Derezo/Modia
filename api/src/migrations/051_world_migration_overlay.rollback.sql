-- Roll back migration 051 semantic overlay persistence.

ALTER TABLE seed_metadata
  DROP COLUMN IF EXISTS migration_overlay;
