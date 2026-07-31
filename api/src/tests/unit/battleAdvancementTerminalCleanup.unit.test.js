import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAdvancementChallengerStatus
} from '../../services/battleRewardService.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(testDirectory, '../..');

describe('advancement battle terminal cleanup', () => {
  it('clears a non-party advancement challenger by authoritative character id', async () => {
    const queries = [];
    const client = {
      async query(text, params) {
        queries.push({ text, params });
        return { rows: [] };
      }
    };

    const cleared = await clearAdvancementChallengerStatus(client, {
      isAdvancementBattle: true,
      challengerCharacterId: 73
    });

    assert.equal(cleared, true);
    assert.equal(queries.length, 1);
    assert.match(queries[0].text, /SET in_battle = false WHERE id = \$1/);
    assert.doesNotMatch(queries[0].text, /party_slot/);
    assert.deepEqual(queries[0].params, [73]);
  });

  it('keeps normal battle cleanup scoped to the existing party path', async () => {
    const client = {
      async query() {
        assert.fail('non-advancement cleanup must remain with the normal party path');
      }
    };

    const cleared = await clearAdvancementChallengerStatus(client, {
      isAdvancementBattle: false,
      challengerCharacterId: null
    });

    assert.equal(cleared, false);
  });

  it('runs challenger cleanup inside both victory and defeat transactions', async () => {
    const [rewardServiceSource, battleRouteSource] = await Promise.all([
      readFile(resolve(sourceRoot, 'services/battleRewardService.js'), 'utf8'),
      readFile(resolve(sourceRoot, 'routes/battle.js'), 'utf8')
    ]);

    const victoryStart = rewardServiceSource.indexOf(
      'const distribute = async (transactionClient) => {'
    );
    const victoryEnd = rewardServiceSource.indexOf(
      '\n  return client',
      victoryStart
    );
    const victoryTransaction = rewardServiceSource.slice(victoryStart, victoryEnd);
    assert.match(
      victoryTransaction,
      /loadBattle[\s\S]*clearAdvancementChallengerStatus\(transactionClient, battle\)/
    );

    const defeatStart = battleRouteSource.indexOf(
      "} else {\n    const terminalStatus = isPvP ? 'victory' : status;"
    );
    const defeatEnd = battleRouteSource.indexOf(
      '\n  // Authoritative deltas',
      defeatStart
    );
    const defeatTransaction = battleRouteSource.slice(defeatStart, defeatEnd);
    assert.match(defeatTransaction, /withTransaction\(async client =>/);
    assert.match(
      defeatTransaction,
      /commitMutableState[\s\S]*clearAdvancementChallengerStatus\([\s\S]*client,[\s\S]*committed\.envelope/
    );
    assert.match(
      defeatTransaction,
      /WHERE user_id = ANY\(\$1::int\[\]\) AND party_slot <= \$2/
    );
    assert.match(
      defeatTransaction,
      /state\.units[\s\S]*characterId \?\? unit\.id[\s\S]*WHERE user_id = \$1 AND id = ANY\(\$2::int\[\]\)/
    );
  });
});
