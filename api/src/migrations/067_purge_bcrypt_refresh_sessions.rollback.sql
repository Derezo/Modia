-- Rollback for migration 067: no-op.
-- Deleted bcrypt sessions cannot be restored, and the code they belonged to
-- (bcrypt refresh lookups) is not part of this release. Affected players
-- simply log in again.
DO $$ BEGIN
  RAISE NOTICE 'Rollback 067: nothing to restore';
END $$;
