import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(testDirectory, '../..');
const authoritativeCallsites = [
  'services/guildmasterBattleService.js',
  'services/battleRewardService.js',
  'services/coliseum/matchLifecycle.js',
  'services/coliseum/turnTimer.js',
  'services/coliseum/statistics.js'
];

describe('non-route battle-state callsites', () => {
  it('use the repository as the only authoritative battles-table boundary', async () => {
    const directBattleSql = /\b(?:from|update|insert\s+into|delete\s+from)\s+battles\b/i;
    for (const relativePath of authoritativeCallsites) {
      const source = await readFile(resolve(sourceRoot, relativePath), 'utf8');
      const executableSource = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      assert.doesNotMatch(executableSource, directBattleSql, relativePath);
      assert.match(source, /battleStateRepository\./, relativePath);
    }
  });

  it('uses deterministic creation and command idempotency keys', async () => {
    const [guildmaster, lifecycle, timer, rewards] = await Promise.all(
      [
        'services/guildmasterBattleService.js',
        'services/coliseum/matchLifecycle.js',
        'services/coliseum/turnTimer.js',
        'services/battleRewardService.js'
      ].map(relativePath => readFile(resolve(sourceRoot, relativePath), 'utf8'))
    );

    assert.match(guildmaster, /creationIdempotencyKey/);
    assert.match(lifecycle, /creationIdempotencyKey/);
    assert.match(lifecycle, /coliseum-match-complete:\$\{battleId\}/);
    assert.match(timer, /coliseum-turn-timeout:\$\{battleId\}:/);
    assert.match(rewards, /battle-rewards:\$\{battleId\}:\$\{userId\}/);
  });

  it('persists guildmaster boss encounters through the battle creation transaction', async () => {
    const source = await readFile(
      resolve(sourceRoot, 'services/guildmasterBattleService.js'),
      'utf8'
    );

    assert.match(
      source,
      /bossService\.saveBossEncounter\(\{[\s\S]*?battleId: result\.battleId[\s\S]*?\}, \{ client \}\)/
    );
  });
});
