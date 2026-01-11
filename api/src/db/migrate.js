import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../../.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'modia',
  user: process.env.DB_USER || 'modia',
  password: process.env.DB_PASSWORD || '',
});

const migrationsDir = join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query('SELECT name FROM migrations ORDER BY id');
  return new Set(result.rows.map(row => row.name));
}

async function runMigrations() {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.includes('.rollback.'))
    .sort();

  console.log(`Found ${files.length} migration files`);

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }

    console.log(`Applying ${file}...`);
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file} successfully`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to apply ${file}:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('All migrations completed');
}

async function rollback() {
  await ensureMigrationsTable();

  const result = await pool.query(
    'SELECT name FROM migrations ORDER BY id DESC LIMIT 1'
  );

  if (result.rows.length === 0) {
    console.log('No migrations to rollback');
    return;
  }

  const lastMigration = result.rows[0].name;
  console.log(`Rolling back ${lastMigration}...`);

  // Look for corresponding rollback file
  const rollbackFile = lastMigration.replace('.sql', '.rollback.sql');
  const rollbackPath = join(migrationsDir, rollbackFile);

  if (existsSync(rollbackPath)) {
    const sql = readFileSync(rollbackPath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('DELETE FROM migrations WHERE name = $1', [lastMigration]);
      await client.query('COMMIT');
      console.log(`Rolled back ${lastMigration} successfully`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to rollback ${lastMigration}:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  } else {
    console.log(`No rollback file found for ${lastMigration}`);
    console.log('Removing migration record only...');
    await pool.query('DELETE FROM migrations WHERE name = $1', [lastMigration]);
  }
}

const command = process.argv[2];

if (command === 'rollback') {
  rollback()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
    .finally(() => pool.end());
} else {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
    .finally(() => pool.end());
}
