import { describe, it } from 'node:test';
import assert from 'node:assert';
import { decideTurnActions } from '../../../services/aiService.js';
import { quickDecision } from '../../../services/ai/utilityAI.js';
import { calculateStrategicPath } from '../../../services/ai/strategicPathfinding.js';
import { calculateDamageReceived } from '../../../services/ai/utilityFactors.js';
import { createMockBattleState } from './mockHelpers.js';

const ADVANCING_PATTERNS = [
  'aggressive',
  'defensive',
  'support',
  'tactical',
  'pack',
  'berserker',
  'ranged',
  'hit-and-run',
  'boss'
];

function createOpeningState(aiType, overrides = {}) {
  return createMockBattleState(
    [{ id: 'player', type: 'player', tileX: 2, tileY: 10 }],
    [
      {
        id: 'actor',
        type: 'enemy',
        aiType,
        tileX: 17,
        tileY: 10,
        movement: 3,
        ...overrides
      },
      { id: 'ally-1', type: 'enemy', aiType, tileX: 17, tileY: 11 },
      { id: 'ally-2', type: 'enemy', aiType, tileX: 17, tileY: 12 }
    ],
    {
      gridWidth: 20,
      gridHeight: 20,
      mapWidth: 20,
      mapHeight: 20
    }
  );
}

function distanceToPlayer(position, player) {
  return Math.abs(position.x - player.tileX) +
    Math.abs(position.y - player.tileY);
}

describe('opening engagement behavior', () => {
  for (const pattern of ADVANCING_PATTERNS) {
    it(`${pattern} advances while out of attack range`, () => {
      const state = createOpeningState(pattern);
      const player = state.units[0];
      const actor = state.units[1];
      const originalDistance = distanceToPlayer(
        { x: actor.tileX, y: actor.tileY },
        player
      );

      const result = quickDecision(actor, state, pattern);
      const move = result.bestAction.find(action => action.type === 'move');

      assert.ok(move, `${pattern} should move instead of waiting`);
      assert.ok(
        distanceToPlayer(move.position, player) < originalDistance,
        `${pattern} should close distance to the player`
      );
    });
  }

  it('the full AI service advances strategies that previously waited', () => {
    for (const pattern of ['support', 'pack', 'ranged', 'boss']) {
      const state = createOpeningState(pattern);
      const actor = state.units[1];
      const player = state.units[0];
      const originalDistance = distanceToPlayer(
        { x: actor.tileX, y: actor.tileY },
        player
      );

      const actions = decideTurnActions(actor, state);
      const move = actions.find(action => action.actionType === 'move');

      assert.ok(move, `${pattern} should return an executable move`);
      assert.ok(
        distanceToPlayer(move.targetTile, player) < originalDistance,
        `${pattern} executable move should close distance`
      );
    }
  });

  it('follows the strategic path around a blocking wall', () => {
    const terrain = Array.from(
      { length: 12 },
      () => Array(12).fill('grass')
    );
    for (let y = 0; y < 8; y++) {
      terrain[y][6] = 'rock';
    }

    const state = createMockBattleState(
      [{ id: 'player', type: 'player', tileX: 2, tileY: 5 }],
      [{
        id: 'actor',
        type: 'enemy',
        aiType: 'aggressive',
        tileX: 8,
        tileY: 5,
        movement: 3
      }],
      {
        terrain,
        gridWidth: 12,
        gridHeight: 12,
        mapWidth: 12,
        mapHeight: 12
      }
    );
    const actor = state.units[1];
    const strategicPath = calculateStrategicPath(actor, state);

    const result = quickDecision(actor, state, 'aggressive');
    const move = result.bestAction.find(action => action.type === 'move');

    assert.ok(move, 'aggressive AI should advance around the wall');
    assert.ok(
      strategicPath.path.some(tile =>
        tile.x === move.position.x && tile.y === move.position.y
      ),
      'the opening move should stay on the obstacle-aware strategic path'
    );
  });

  it('lets support and pack units advance without abandoning their formation', () => {
    for (const pattern of ['support', 'pack']) {
      const state = createMockBattleState(
        [{ id: 'player', type: 'player', tileX: 2, tileY: 10 }],
        [
          {
            id: 'actor',
            type: 'enemy',
            aiType: pattern,
            tileX: 17,
            tileY: 10,
            movement: 3
          },
          { id: 'ally-1', type: 'enemy', tileX: 18, tileY: 10 },
          { id: 'ally-2', type: 'enemy', tileX: 19, tileY: 10 }
        ],
        {
          gridWidth: 20,
          gridHeight: 20,
          mapWidth: 20,
          mapHeight: 20
        }
      );
      const actor = state.units[1];
      const player = state.units[0];
      const allies = state.units.slice(2);

      const result = quickDecision(actor, state, pattern);
      const move = result.bestAction.find(action => action.type === 'move');

      assert.ok(move, `${pattern} should advance with its formation`);
      assert.ok(
        distanceToPlayer(move.position, player) <
          distanceToPlayer({ x: actor.tileX, y: actor.tileY }, player),
        `${pattern} should still close distance`
      );
      assert.ok(
        allies.some(ally =>
          distanceToPlayer(move.position, ally) <= 2
        ),
        `${pattern} should keep at least one ally nearby`
      );
    }
  });

  it('lets a critically wounded support unit choose safety over lethal progress', () => {
    const state = createMockBattleState(
      [{
        id: 'player',
        type: 'player',
        tileX: 5,
        tileY: 10,
        movement: 3,
        strength: 80,
        attack: 60
      }],
      [{
        id: 'actor',
        type: 'enemy',
        aiType: 'support',
        tileX: 10,
        tileY: 10,
        movement: 3,
        hp: 20,
        maxHp: 200
      }],
      {
        gridWidth: 20,
        gridHeight: 20,
        mapWidth: 20,
        mapHeight: 20
      }
    );
    const actor = state.units[1];

    const result = quickDecision(actor, state, 'support');
    const move = result.bestAction.find(action => action.type === 'move');

    assert.ok(move, 'wounded support should reposition');
    assert.ok(
      calculateDamageReceived(
        actor,
        move.position.x,
        move.position.y,
        state
      ) < actor.hp,
      'wounded support should avoid a position with expected lethal damage'
    );
  });

  it('moves a ranged unit into its preferred firing band', () => {
    const state = createMockBattleState(
      [{ id: 'player', type: 'player', tileX: 5, tileY: 10 }],
      [{
        id: 'actor',
        type: 'enemy',
        aiType: 'ranged',
        tileX: 10,
        tileY: 10,
        movement: 3,
        attackRange: 4
      }],
      {
        gridWidth: 20,
        gridHeight: 20,
        mapWidth: 20,
        mapHeight: 20
      }
    );
    const actor = state.units[1];
    const player = state.units[0];

    const result = quickDecision(actor, state, 'ranged');
    const move = result.bestAction.find(action => action.type === 'move');
    const attack = result.bestAction.find(action => action.type === 'attack');

    assert.ok(move, 'ranged unit should move into firing range');
    assert.ok(attack, 'ranged unit should attack after establishing range');
    const firingDistance = distanceToPlayer(move.position, player);
    assert.ok(
      firingDistance >= actor.attackRange - 1 &&
        firingDistance <= actor.attackRange,
      'ranged unit should remain near maximum range while able to attack'
    );
  });

  it('allows a hidden ambusher to hold until a player enters spring range', () => {
    const state = createOpeningState('ambush', { isHidden: true });
    const actor = state.units[1];

    const result = quickDecision(actor, state, 'ambush');

    assert.deepStrictEqual(result.bestAction, [{ type: 'wait' }]);
  });

  it('makes a revealed ambusher advance like other combatants', () => {
    const state = createOpeningState('ambush', { isHidden: false });
    const actor = state.units[1];

    const result = quickDecision(actor, state, 'ambush');

    assert.ok(
      result.bestAction.some(action => action.type === 'move'),
      'a revealed ambusher should advance'
    );
  });
});
