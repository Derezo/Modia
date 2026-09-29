import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';
import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// Fix TIMESTAMP parsing: PostgreSQL TIMESTAMP (without timezone) returns strings
// like "2026-01-11 02:58:37.278" which JavaScript interprets as LOCAL time.
// This causes bugs when server timezone differs from UTC.
// Type OID 1114 = TIMESTAMP WITHOUT TIME ZONE
pg.types.setTypeParser(1114, (val) => {
  // Append 'Z' to indicate UTC, preventing local time interpretation
  return val === null ? null : new Date(val + 'Z');
});

// The write side must match: node-postgres serializes Date parameters in the
// process's LOCAL time by default, and a TIMESTAMP column drops the offset. A
// Date read back as UTC (above) and written again (e.g. quest period_start /
// period_end) would shift by the process UTC offset; on a UTC-4 host, daily
// quests assigned after 20:00 UTC were born already expired. Serialize Dates
// as UTC so reads and writes round-trip.
pg.defaults.parseInputDatesAsUTC = true;

// Fix BIGINT parsing: PostgreSQL BIGINT is returned as string by node-postgres
// because JavaScript Number can't safely represent all 64-bit integers.
// For game values (XP, gold, scores), we're well under MAX_SAFE_INTEGER (9 quadrillion).
// Type OID 20 = BIGINT
pg.types.setTypeParser(20, (val) => {
  return val === null ? null : parseInt(val, 10);
});

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../../.env') });

const isTestEnv = process.env.NODE_ENV === 'test';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'modia',
  user: process.env.DB_USER || 'modia',
  password: process.env.DB_PASSWORD || '',
  max: isTestEnv ? 5 : 20,
  idleTimeoutMillis: isTestEnv ? 1000 : 30000,
  // Production fails fast on pool exhaustion. Dev and test servers absorb
  // bursts from parallel integration suites (--test-concurrency=4) instead
  // of failing requests with "Connection terminated due to connection timeout".
  connectionTimeoutMillis: process.env.NODE_ENV === 'production' ? 2000 : 10000,
  // Allow Node.js to exit when pool is idle (important for tests)
  allowExitOnIdle: isTestEnv,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  // Use structured logger - shows full SQL and params in single line
  logger.query(text, params, duration, result.rowCount);

  return result;
};

const getClient = async () => {
  const client = await pool.connect();
  return client;
};

/**
 * Execute a callback within a database transaction.
 * Automatically commits on success, rolls back on error.
 * @param {Function} callback - Async function receiving the client
 * @returns {Promise<any>} Result of the callback
 */
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    logger.debug('withTransaction', 'BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    logger.debug('withTransaction', 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.debug('withTransaction', `ROLLBACK: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
};

export {
  pool,
  query,
  getClient,
  withTransaction
};
