import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PROJECT_ROOT = resolve(API_ROOT, '..');
const SCRIPT_PATH = resolve(PROJECT_ROOT, 'scripts/dev-setup.sh');

describe('development setup seed safeguards', () => {
  it('uses the same forward-migration inventory as the migration runner', () => {
    const output = execFileSync(
      'bash',
      ['-c', `
        source "$1"
        list_forward_migrations "$PROJECT_ROOT/api/src/migrations"
      `, 'bash', SCRIPT_PATH],
      { cwd: PROJECT_ROOT, encoding: 'utf8' }
    );

    assert.match(output, /049_worldgen_integrity\.sql/);
    assert.doesNotMatch(output, /\.rollback\.sql/);
  });

  it('fails closed when the persisted node count cannot be read', () => {
    const result = spawnSync(
      'bash',
      ['-c', `
        source "$1"
        run_query() { return 1; }
        check_seed
      `, 'bash', SCRIPT_PATH],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { ...process.env, WORLD_SEED: '123456' }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /could not read the persisted world node count/);
    assert.doesNotMatch(result.stdout + result.stderr, /Running seed/);
  });
});
