import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(testDirectory, '../..');

async function readSource(relativePath) {
  return readFile(resolve(sourceRoot, relativePath), 'utf8');
}

describe('background terminal revision guard', () => {
  it('threads the originating revision into the locked PvE reward transition', async () => {
    const [route, rewards] = await Promise.all([
      readSource('routes/battle.js'),
      readSource('services/battleRewardService.js')
    ]);

    const victoryStart = route.indexOf(
      "} else if (!isPvP && status === 'victory') {"
    );
    const victoryEnd = route.indexOf('} else {', victoryStart);
    const victoryBranch = route.slice(victoryStart, victoryEnd);

    assert.match(
      victoryBranch,
      /distributeRewards\([\s\S]*finalState:\s*state,[\s\S]*expectedRevision,[\s\S]*client/
    );
    assert.match(
      rewards,
      /loadBattle\(battleId,[\s\S]*forUpdate:\s*true[\s\S]*battle\.stateRevision !== expectedRevision[\s\S]*throw new BattleStateConflictError/
    );
    assert.match(
      rewards,
      /expectedRevision:\s*expectedRevision \?\? battle\.stateRevision/
    );
  });

  it('binds background terminal completion to a deterministic command request', async () => {
    const route = await readSource('routes/battle.js');
    const registrationStart = route.indexOf(
      'battleService.setBattleTerminalCompletionHandler'
    );
    const registrationEnd = route.indexOf('/**', registrationStart);
    const registration = route.slice(registrationStart, registrationEnd);

    assert.match(registration, /commandIdentity:\s*idempotencyKey/);
    assert.match(
      registration,
      /idempotencyRequest:\s*\{[\s\S]*battleId:[\s\S]*expectedRevision,[\s\S]*reason,[\s\S]*winningTeamId:/
    );
  });
});
