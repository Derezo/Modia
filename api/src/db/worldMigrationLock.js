export const WORLD_MIGRATION_LOCK_KEY =
  'modia:player-preserving-world-migration:v1';

/**
 * Activity mutations take a shared lock before touching world-node tables.
 * The player-preserving world migration takes the matching exclusive lock,
 * quiescing these writes before it begins its alphabetical table locks.
 */
export async function lockAgainstWorldMigration(client) {
  await client.query(
    'SELECT pg_advisory_xact_lock_shared(hashtext($1))',
    [WORLD_MIGRATION_LOCK_KEY]
  );
}
