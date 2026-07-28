DROP TRIGGER IF EXISTS trg_world_migration_runs_immutable
  ON world_migration_runs;
DROP TRIGGER IF EXISTS trg_world_migration_progress_archive_immutable
  ON world_migration_progress_archive;
DROP TRIGGER IF EXISTS trg_world_migration_node_maps_immutable
  ON world_migration_node_maps;

DROP TABLE IF EXISTS world_migration_progress_archive;
DROP TABLE IF EXISTS world_migration_node_maps;
DROP TABLE IF EXISTS world_migration_runs;

DROP FUNCTION IF EXISTS prevent_terminal_world_migration_run_mutation();
DROP FUNCTION IF EXISTS prevent_world_migration_audit_mutation();
