import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const battleRouteSource = readFileSync(
  path.resolve(__dirname, '../../routes/battle.js'),
  'utf8'
);

function routeSection(startMarker, endMarker) {
  const start = battleRouteSource.indexOf(startMarker);
  const end = battleRouteSource.indexOf(endMarker, start + startMarker.length);

  assert.notStrictEqual(start, -1, `Missing route marker: ${startMarker}`);
  assert.notStrictEqual(end, -1, `Missing route marker: ${endMarker}`);

  return battleRouteSource.slice(start, end);
}

describe('battle resume action-sequence contract', () => {
  it('starts a fresh sequence session when /battle/current restores a battle', () => {
    const currentRoute = routeSection(
      "router.get('/current'",
      "router.get('/:battleId/rejoin'"
    );

    assert.match(
      currentRoute,
      /resetActionSequence\(battleId, req\.user\.userId\)/,
      '/battle/current must reset the counter used by the newly-created BattleWebSocketManager'
    );
  });

  it('starts a fresh sequence session when /battle/start returns an existing battle', () => {
    const startRoute = routeSection(
      "router.post('/start'",
      "router.get('/current'"
    );
    const existingBattleResume = startRoute.slice(
      startRoute.indexOf('if (existingBattle.rows.length > 0)')
    );

    assert.match(
      existingBattleResume,
      /resetActionSequence\(battle\.id, req\.user\.userId\)/,
      '/battle/start must reset the counter before returning an existing active battle'
    );
  });

  it('keeps the explicit /battle/:battleId/rejoin path in the same sequence contract', () => {
    const rejoinRoute = routeSection(
      "router.get('/:battleId/rejoin'",
      "router.post('/action'"
    );

    assert.match(
      rejoinRoute,
      /resetActionSequence\(parseInt\(battleId\), req\.user\.userId\)/
    );
  });
});
