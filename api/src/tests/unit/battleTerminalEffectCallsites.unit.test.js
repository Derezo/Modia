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

describe('durable battle terminal-effect callsites', () => {
  it('enqueues PvE progression inside the reward transaction', async () => {
    const route = await readSource('routes/battle.js');
    const start = route.indexOf("} else if (!isPvP && status === 'victory') {");
    const end = route.indexOf('} else {', start);
    const victoryBranch = route.slice(start, end);

    const transactionIndex = victoryBranch.indexOf(
      'const completion = await withTransaction(async client => {'
    );
    const rewardIndex = victoryBranch.indexOf(
      'await battleRewardService.distributeRewards(',
      transactionIndex
    );
    const enqueueIndex = victoryBranch.indexOf(
      'await battleTerminalOutbox.enqueue(client,',
      rewardIndex
    );
    const transactionReturnIndex = victoryBranch.indexOf(
      'return distributed;',
      enqueueIndex
    );

    assert.ok(transactionIndex >= 0);
    assert.ok(rewardIndex > transactionIndex);
    assert.ok(enqueueIndex > rewardIndex);
    assert.ok(transactionReturnIndex > enqueueIndex);
    assert.match(victoryBranch, /BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE/);
    assert.doesNotMatch(victoryBranch, /updateQuestProgress|completeAdvancementQuest/);
  });

  it('enqueues Coliseum progression and badges in the match transaction', async () => {
    const lifecycle = await readSource('services/coliseum/matchLifecycle.js');
    const completionStart = lifecycle.indexOf('export async function completeMatch(');
    const presentationStart = lifecycle.indexOf(
      'const presentationEvents = [',
      completionStart
    );
    const completion = lifecycle.slice(completionStart, presentationStart);
    const matchInsertIndex = completion.indexOf(
      'INSERT INTO coliseum_matches'
    );
    const progressionIndex = completion.indexOf(
      'eventType: BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE',
      matchInsertIndex
    );
    const badgeIndex = completion.indexOf(
      'eventType: BATTLE_TERMINAL_COLISEUM_BADGES_EVENT_TYPE',
      progressionIndex
    );

    assert.ok(matchInsertIndex >= 0);
    assert.ok(progressionIndex > matchInsertIndex);
    assert.ok(badgeIndex > progressionIndex);
    assert.doesNotMatch(
      completion,
      /dailyQuestService\.updateProgress|checkAndAwardBadges\(/
    );
  });

  it('starts delivery only after all handlers are registered', async () => {
    const source = await readSource('index.js');
    const registerIndex = source.indexOf('registerBattleTerminalEffectHandlers();');
    const listenIndex = source.indexOf('server.listen(');
    const workerIndex = source.indexOf('battleTerminalOutboxWorker.start();');

    assert.ok(registerIndex >= 0);
    assert.ok(listenIndex > registerIndex);
    assert.ok(workerIndex > listenIndex);
    assert.match(source, /server\.once\('close',[\s\S]*battleTerminalOutboxWorker\.stop\(\)/);
  });

  it('publishes terminal state before non-authoritative Coliseum panels', async () => {
    const route = await readSource('routes/battle.js');
    const actionStart = route.indexOf("router.post('/action'");
    const completionStart = route.indexOf('if (completion) {', actionStart);
    const completionEnd = route.indexOf('} else if (result.turnEnded)', completionStart);
    const terminalPublish = route.slice(completionStart, completionEnd);

    const stateIndex = terminalPublish.indexOf(
      'battleWebsocket.broadcastBattleEnd('
    );
    const resultIndex = terminalPublish.indexOf(
      'publishColiseumMatchResultEvents('
    );
    assert.ok(stateIndex >= 0);
    assert.ok(resultIndex > stateIndex);
  });

  it('exposes persistent delivery and worker status through health checks', async () => {
    const source = await readSource('routes/health.js');

    assert.match(source, /battleTerminalOutbox\.getDeliveryStatus\(\)/);
    assert.match(source, /battleTerminalOutboxWorker\.getStatus\(\)/);
    assert.match(source, /terminalDelivery\.exhausted/);
    assert.match(source, /terminalEffects/);
  });
});
