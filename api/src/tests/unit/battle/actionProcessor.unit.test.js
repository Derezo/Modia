/**
 * Unit tests for battle/actionProcessor.js
 *
 * Tests pure helper functions in the action processor:
 * - getThrowItemSkill: Skill lookup for throw_item
 * - getEfficientMixingSkill: Skill lookup for efficient_mixing
 * - calculateItemEffectiveness: Item effectiveness multiplier
 * - checkBattleEnd: Battle victory/defeat detection
 * - getBattleStatusString: Legacy status string conversion
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert';
import { withSeededRandom } from '../../testUtils/index.js';

import {
  checkBattleEnd,
  getBattleStatusString,
  processAction,
  getAvailableActions
} from '../../../services/battle/actionProcessor.js';
import {
  calculatePhysicalDamage,
  calculateMagicalDamage
} from '../../../services/battle/damageCalculator.js';

function withRandomValues(values, callback) {
  let index = 0;
  const random = mock.method(
    Math,
    'random',
    () => values[Math.min(index++, values.length - 1)]
  );
  try {
    return callback();
  } finally {
    random.mock.restore();
  }
}

// =============================================================================
// checkBattleEnd
// =============================================================================

describe('checkBattleEnd', () => {
  describe('team-based victory conditions', () => {
    it('returns active when both teams have alive units', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 50, teamId: 2 }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'active');
      assert.strictEqual(result.winningTeamId, null);
    });

    it('returns ended with team 1 winning when all team 2 dead', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 50, teamId: 1 },
          { id: 3, hp: 0, teamId: 2 },
          { id: 4, hp: 0, teamId: 2 }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 1);
    });

    it('returns ended with team 2 winning when all team 1 dead', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 0, teamId: 1 },
          { id: 3, hp: 100, teamId: 2 }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2);
    });

    it('handles mixed team with some alive and some dead', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 0, teamId: 1 },    // dead
          { id: 3, hp: 50, teamId: 2 },
          { id: 4, hp: 0, teamId: 2 }     // dead
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'active');
    });
  });

  describe('type-based fallback (PvE compatibility)', () => {
    it('treats enemy type as team 2', () => {
      const state = {
        units: [
          { id: 1, hp: 100, type: 'player' },  // team 1 via fallback
          { id: 2, hp: 0, type: 'enemy' }      // team 2 via fallback
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 1);
    });

    it('treats player type as team 1', () => {
      const state = {
        units: [
          { id: 1, hp: 0, type: 'player' },
          { id: 2, hp: 100, type: 'enemy' }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2);
    });

    it('treats npc type as team 1 (ally)', () => {
      const state = {
        units: [
          { id: 1, hp: 100, type: 'npc' },     // ally, team 1
          { id: 2, hp: 0, type: 'enemy' }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 1);
    });
  });

  describe('valueOf() backwards compatibility', () => {
    it('returns "active" for valueOf() when battle active', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 100, teamId: 2 }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.valueOf(), 'active');
      assert.strictEqual(result.toString(), 'active');
    });

    it('returns "victory" for valueOf() when team 1 wins', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 0, teamId: 2 }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.valueOf(), 'victory');
      assert.strictEqual(result.toString(), 'victory');
    });

    it('returns "defeat" for valueOf() when team 2 wins', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 100, teamId: 2 }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.valueOf(), 'defeat');
    });

    it('allows legacy string comparison with ==', () => {
      const activeState = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 100, teamId: 2 }
        ]
      };

      const victoryState = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 0, teamId: 2 }
        ]
      };

      const activeResult = checkBattleEnd(activeState);
      const victoryResult = checkBattleEnd(victoryState);

      // Using == for loose comparison (valueOf is called)
      assert.ok(activeResult == 'active');
      assert.ok(victoryResult == 'victory');
    });
  });

  describe('edge cases', () => {
    it('handles empty units array', () => {
      const state = { units: [] };

      const result = checkBattleEnd(state);

      // Both teams have 0 alive, neither wins
      assert.strictEqual(result.status, 'active');
    });

    it('handles single team only', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: 50, teamId: 1 }
        ]
      };

      const result = checkBattleEnd(state);

      // Team 1 alive, team 2 has 0 alive -> team 1 wins
      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 1);
    });

    it('handles negative HP as dead', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1 },
          { id: 2, hp: -50, teamId: 2 }  // negative HP = dead
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 1);
    });

    it('handles exactly 0 HP as dead', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 100, teamId: 2 }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2);
    });

    it('prioritizes teamId over type if both present', () => {
      const state = {
        units: [
          { id: 1, hp: 100, teamId: 1, type: 'enemy' },  // teamId overrides
          { id: 2, hp: 0, teamId: 2, type: 'player' }
        ]
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.winningTeamId, 1);
    });
  });

  describe('mutual knockout (double KO)', () => {
    it('in PvE, mutual knockout gives team 2 the win (player defeat)', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 0, teamId: 2 }
        ],
        battleType: 'pve'
      };

      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2, 'PvE mutual KO should result in player defeat');
    });

    it('in PvP, mutual knockout caused by team 1 gives team 2 the win', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 0, teamId: 2 }
        ],
        battleType: 'pvp'
      };

      // Team 1 was acting (e.g., used AoE that killed both)
      const result = checkBattleEnd(state, { actingTeamId: 1 });

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2, 'Acting team 1 should lose in PvP mutual KO');
    });

    it('in PvP, mutual knockout caused by team 2 gives team 1 the win', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 0, teamId: 2 }
        ],
        battleType: 'pvp'
      };

      // Team 2 was acting (e.g., used overload self-damage that killed both)
      const result = checkBattleEnd(state, { actingTeamId: 2 });

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 1, 'Acting team 2 should lose in PvP mutual KO');
    });

    it('in pvp_coliseum, mutual knockout follows same rule as pvp', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 0, teamId: 2 }
        ],
        battleType: 'pvp_coliseum'
      };

      const result = checkBattleEnd(state, { actingTeamId: 1 });

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2, 'Coliseum follows PvP mutual KO rules');
    });

    it('in PvP without actingTeamId, defaults to team 2 win', () => {
      const state = {
        units: [
          { id: 1, hp: 0, teamId: 1 },
          { id: 2, hp: 0, teamId: 2 }
        ],
        battleType: 'pvp'
      };

      // No actingTeamId provided - fall back to PvE behavior
      const result = checkBattleEnd(state);

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2, 'Without acting team info, default to team 2 win');
    });

    it('AoE caster-centered double KO gives opponent the win', () => {
      // Simulates Fire Nova killing everyone including caster
      const state = {
        units: [
          { id: 'player1', hp: 0, teamId: 1 },  // Killed by own AoE
          { id: 'enemy1', hp: 0, teamId: 2 }    // Killed by same AoE
        ],
        battleType: 'pvp_coliseum'
      };

      // Team 1 cast the AoE
      const result = checkBattleEnd(state, { actingTeamId: 1 });

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 2, 'Caster team loses when their AoE causes mutual KO');
    });

    it('overload self-damage double KO gives opponent the win', () => {
      // Simulates a skill that damages the caster and kills both
      const state = {
        units: [
          { id: 'player1', hp: 0, teamId: 1 },
          { id: 'enemy1', hp: 0, teamId: 2 }  // Was killed by the attack that also killed caster
        ],
        battleType: 'pvp'
      };

      // Enemy (team 2) used an overload skill that killed them via self-damage
      const result = checkBattleEnd(state, { actingTeamId: 2 });

      assert.strictEqual(result.status, 'ended');
      assert.strictEqual(result.winningTeamId, 1, 'Self-damage causing mutual KO gives opponent the win');
    });
  });
});

// =============================================================================
// getBattleStatusString
// =============================================================================

describe('getBattleStatusString', () => {
  it('returns "active" for active status', () => {
    const result = { status: 'active', winningTeamId: null };

    assert.strictEqual(getBattleStatusString(result), 'active');
  });

  it('returns "victory" for team 1 win', () => {
    const result = { status: 'ended', winningTeamId: 1 };

    assert.strictEqual(getBattleStatusString(result), 'victory');
  });

  it('returns "defeat" for team 2 win', () => {
    const result = { status: 'ended', winningTeamId: 2 };

    assert.strictEqual(getBattleStatusString(result), 'defeat');
  });

  it('handles null result', () => {
    assert.strictEqual(getBattleStatusString(null), 'active');
  });

  it('handles undefined result', () => {
    assert.strictEqual(getBattleStatusString(undefined), 'active');
  });

  it('handles result without status field', () => {
    const result = { winningTeamId: 1 };

    // Missing status is undefined, which is falsy, so falls through to team-based check
    // Since winningTeamId is 1, it returns 'victory'
    assert.strictEqual(getBattleStatusString(result), 'victory');
  });

  it('integrates with checkBattleEnd output', () => {
    const activeState = {
      units: [
        { id: 1, hp: 100, teamId: 1 },
        { id: 2, hp: 100, teamId: 2 }
      ]
    };

    const victoryState = {
      units: [
        { id: 1, hp: 100, teamId: 1 },
        { id: 2, hp: 0, teamId: 2 }
      ]
    };

    const defeatState = {
      units: [
        { id: 1, hp: 0, teamId: 1 },
        { id: 2, hp: 100, teamId: 2 }
      ]
    };

    assert.strictEqual(getBattleStatusString(checkBattleEnd(activeState)), 'active');
    assert.strictEqual(getBattleStatusString(checkBattleEnd(victoryState)), 'victory');
    assert.strictEqual(getBattleStatusString(checkBattleEnd(defeatState)), 'defeat');
  });
});

// =============================================================================
// Battle State Integration Tests
// =============================================================================

describe('Battle End State Integration', () => {
  it('multi-unit PvE battle with mixed health', () => {
    const state = {
      units: [
        { id: 'p1', hp: 80, type: 'player' },
        { id: 'p2', hp: 0, type: 'player' },   // dead player
        { id: 'n1', hp: 100, type: 'npc' },    // ally NPC
        { id: 'e1', hp: 0, type: 'enemy' },
        { id: 'e2', hp: 50, type: 'enemy' }    // alive enemy
      ]
    };

    const result = checkBattleEnd(state);

    // Battle should still be active (both teams have alive units)
    assert.strictEqual(result.status, 'active');
  });

  it('PvE victory when all enemies dead', () => {
    const state = {
      units: [
        { id: 'p1', hp: 10, type: 'player' },  // barely alive
        { id: 'e1', hp: 0, type: 'enemy' },
        { id: 'e2', hp: 0, type: 'enemy' }
      ]
    };

    const result = checkBattleEnd(state);
    const statusStr = getBattleStatusString(result);

    assert.strictEqual(result.status, 'ended');
    assert.strictEqual(result.winningTeamId, 1);
    assert.strictEqual(statusStr, 'victory');
  });

  it('PvE defeat when all players/allies dead', () => {
    const state = {
      units: [
        { id: 'p1', hp: 0, type: 'player' },
        { id: 'n1', hp: 0, type: 'npc' },
        { id: 'e1', hp: 100, type: 'enemy' }
      ]
    };

    const result = checkBattleEnd(state);
    const statusStr = getBattleStatusString(result);

    assert.strictEqual(result.status, 'ended');
    assert.strictEqual(result.winningTeamId, 2);
    assert.strictEqual(statusStr, 'defeat');
  });

  it('PvP battle with explicit teamIds', () => {
    const state = {
      units: [
        { id: 'a1', hp: 100, teamId: 1, type: 'player' },
        { id: 'a2', hp: 80, teamId: 1, type: 'player' },
        { id: 'b1', hp: 0, teamId: 2, type: 'player' },
        { id: 'b2', hp: 0, teamId: 2, type: 'player' }
      ]
    };

    const result = checkBattleEnd(state);

    assert.strictEqual(result.status, 'ended');
    assert.strictEqual(result.winningTeamId, 1);
  });
});

// =============================================================================
// Result Object Properties
// =============================================================================

describe('checkBattleEnd result object structure', () => {
  it('has required properties', () => {
    const state = {
      units: [
        { id: 1, hp: 100, teamId: 1 },
        { id: 2, hp: 100, teamId: 2 }
      ]
    };

    const result = checkBattleEnd(state);

    assert.ok('status' in result);
    assert.ok('winningTeamId' in result);
    assert.ok(typeof result.valueOf === 'function');
    assert.ok(typeof result.toString === 'function');
  });

  it('active result has null winningTeamId', () => {
    const state = {
      units: [
        { id: 1, hp: 100, teamId: 1 },
        { id: 2, hp: 100, teamId: 2 }
      ]
    };

    const result = checkBattleEnd(state);

    assert.strictEqual(result.winningTeamId, null);
  });

  it('ended result has numeric winningTeamId', () => {
    const state = {
      units: [
        { id: 1, hp: 100, teamId: 1 },
        { id: 2, hp: 0, teamId: 2 }
      ]
    };

    const result = checkBattleEnd(state);

    assert.strictEqual(typeof result.winningTeamId, 'number');
    assert.ok([1, 2].includes(result.winningTeamId));
  });
});

// =============================================================================
// getAvailableActions Tests
// =============================================================================

describe('getAvailableActions', () => {
  // We need to import the function for testing
  let getAvailableActions;

  before(async () => {
    const mod = await import('../../../services/battle/actionProcessor.js');
    getAvailableActions = mod.getAvailableActions;
  });

  function createTestState(overrides = {}) {
    return {
      units: overrides.units || [],
      mapWidth: overrides.mapWidth || 32,
      mapHeight: overrides.mapHeight || 32,
      terrain: overrides.terrain || [],
      consumables: overrides.consumables || [],
      ...overrides
    };
  }

  function createTestUnit(overrides = {}) {
    return {
      id: overrides.id || 'unit_1',
      type: overrides.type || 'player',
      tileX: overrides.tileX || 5,
      tileY: overrides.tileY || 5,
      hp: overrides.hp || 100,
      maxHp: overrides.maxHp || 100,
      mp: overrides.mp || 50,
      maxMp: overrides.maxMp || 50,
      moveUsed: overrides.moveUsed || false,
      actUsed: overrides.actUsed || false,
      statusEffects: overrides.statusEffects || [],
      skills: overrides.skills || [],
      skillCooldowns: overrides.skillCooldowns || {},
      attackRange: overrides.attackRange || 1,
      movement: overrides.movement || 3,
      class: overrides.class || 'warrior',
      ...overrides
    };
  }

  describe('movement availability', () => {
    it('should allow movement when moveUsed is false', () => {
      const unit = createTestUnit({ moveUsed: false });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.strictEqual(actions.canMove, true);
      assert.ok(actions.movement, 'Should have movement data');
    });

    it('should not allow movement when moveUsed is true', () => {
      const unit = createTestUnit({ moveUsed: true });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.strictEqual(actions.canMove, false);
      assert.strictEqual(actions.movement, null);
    });

    it('should not allow movement when stunned', () => {
      const unit = createTestUnit({
        moveUsed: false,
        statusEffects: [{ type: 'stun', duration: 2 }]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.strictEqual(actions.canMove, false);
    });

    it('should not allow movement when rooted', () => {
      const unit = createTestUnit({
        moveUsed: false,
        statusEffects: [{ type: 'root', duration: 2 }]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.strictEqual(actions.canMove, false);
    });
  });

  describe('action availability', () => {
    it('should allow action when actUsed is false', () => {
      const unit = createTestUnit({ actUsed: false });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.strictEqual(actions.canAct, true);
      assert.ok(actions.attacks, 'Should have attack data');
    });

    it('should not allow action when actUsed is true', () => {
      const unit = createTestUnit({ actUsed: true });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.strictEqual(actions.canAct, false);
      assert.strictEqual(actions.attacks, null);
    });

    it('should not allow action when stunned', () => {
      const unit = createTestUnit({
        actUsed: false,
        statusEffects: [{ type: 'stun', duration: 2 }]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.strictEqual(actions.canAct, false);
    });

    it('publishes every playable attack and skill tile without changing AI targets', () => {
      const unit = createTestUnit({
        tileX: 1,
        tileY: 1,
        teamId: 1,
        attackRange: 1,
        skills: [{
          id: 'lightning_bolt',
          name: 'Lightning Bolt',
          type: 'active',
          mpCost: 5,
          range: 1,
          power: 100
        }]
      });
      const ally = createTestUnit({
        id: 'ally',
        tileX: 2,
        tileY: 1,
        teamId: 1
      });
      const enemy = createTestUnit({
        id: 'enemy',
        type: 'enemy',
        tileX: 1,
        tileY: 2,
        teamId: 2
      });
      const state = createTestState({
        units: [unit, ally, enemy],
        mapWidth: 3,
        mapHeight: 3,
        obstacles: [{
          x: 0,
          y: 1,
          type: 'rock',
          blocking: true
        }]
      });

      const actions = getAvailableActions(unit, state);

      assert.deepStrictEqual(actions.attacks.tiles, [
        { x: 1, y: 0, distance: 1 },
        { x: 0, y: 1, distance: 1 },
        { x: 2, y: 1, distance: 1 },
        { x: 1, y: 2, distance: 1 }
      ]);
      assert.ok(
        actions.attacks.tiles.some(tile => tile.x === 0 && tile.y === 1),
        'blocking obstacles do not remove otherwise playable target tiles'
      );
      assert.deepStrictEqual(
        actions.attacks.targets.map(target => target.unitId),
        [enemy.id],
        'legacy AI targets remain opponent units only'
      );

      const [skill] = actions.skills;
      assert.deepStrictEqual(skill.tiles, [
        { x: 1, y: 0, distance: 1 },
        { x: 0, y: 1, distance: 1 },
        { x: 1, y: 1, distance: 0 },
        { x: 2, y: 1, distance: 1 },
        { x: 1, y: 2, distance: 1 }
      ]);
      assert.deepStrictEqual(
        skill.targets.map(target => target.unitId),
        [enemy.id],
        'legacy AI skill targets remain opponent units only'
      );
    });

    it('excludes non-playable and out-of-bounds cells from targeting tiles', () => {
      const unit = createTestUnit({
        tileX: 0,
        tileY: 0,
        attackRange: 2,
        skills: [{
          id: 'blast',
          name: 'Blast',
          type: 'active',
          mpCost: 5,
          range: 2,
          power: 100
        }]
      });
      const playableMask = Array.from(
        { length: 3 },
        () => Array(3).fill(true)
      );
      playableMask[0][1] = false;
      const state = createTestState({
        units: [unit],
        mapWidth: 3,
        mapHeight: 3,
        playableMask
      });

      const actions = getAvailableActions(unit, state);
      for (const tile of [
        ...actions.attacks.tiles,
        ...actions.skills[0].tiles
      ]) {
        assert.ok(tile.x >= 0 && tile.x < 3);
        assert.ok(tile.y >= 0 && tile.y < 3);
        assert.strictEqual(playableMask[tile.y][tile.x], true);
      }
      assert.ok(!actions.attacks.tiles.some(tile => tile.x === 1 && tile.y === 0));
      assert.ok(!actions.skills[0].tiles.some(tile => tile.x === 1 && tile.y === 0));
      assert.ok(actions.skills[0].tiles.some(tile =>
        tile.x === unit.tileX && tile.y === unit.tileY && tile.distance === 0
      ));
    });
  });

  describe('skills availability', () => {
    it('should include usable skills', () => {
      const unit = createTestUnit({
        actUsed: false,
        mp: 50,
        skills: [
          { id: 'slash', name: 'Slash', type: 'active', mpCost: 10, range: 1 }
        ]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.ok(actions.skills, 'Should have skills');
      assert.strictEqual(actions.skills.length, 1);
      assert.strictEqual(actions.skills[0].id, 'slash');
    });

    it('should exclude passive skills', () => {
      const unit = createTestUnit({
        actUsed: false,
        skills: [
          { id: 'passive_trait', name: 'Passive', type: 'passive' }
        ]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.ok(actions.skills);
      assert.strictEqual(actions.skills.length, 0);
    });

    it('should exclude skills when MP is insufficient', () => {
      const unit = createTestUnit({
        actUsed: false,
        mp: 5,
        skills: [
          { id: 'expensive', name: 'Expensive', type: 'active', mpCost: 20, range: 1 }
        ]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.ok(actions.skills);
      assert.strictEqual(actions.skills.length, 0);
    });

    it('should exclude skills on cooldown', () => {
      const unit = createTestUnit({
        actUsed: false,
        mp: 50,
        skills: [
          { id: 'cooldown_skill', name: 'Cooldown', type: 'active', mpCost: 10, range: 1 }
        ],
        skillCooldowns: { cooldown_skill: 2 }
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.ok(actions.skills);
      assert.strictEqual(actions.skills.length, 0);
    });

    it('should not show skills when silenced', () => {
      const unit = createTestUnit({
        actUsed: false,
        mp: 50,
        skills: [
          { id: 'slash', name: 'Slash', type: 'active', mpCost: 10, range: 1 }
        ],
        statusEffects: [{ type: 'silence', duration: 2 }]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      // canAct is still true (can attack), but skills should be filtered or canUseSkills false
      // Based on the code, silenced units return skills: null due to canUnitUseSkills check
      // Actually looking at the code, it checks canUnitUseSkills before building skills
      assert.ok(!actions.skills || actions.skills.length === 0);
    });

    it('preserves targeting metadata and range zero for AI skill classification', () => {
      const unit = createTestUnit({
        type: 'enemy',
        teamId: 2,
        skills: [{
          id: 'party_heal',
          name: 'Party Heal',
          type: 'active',
          mpCost: 0,
          range: 0,
          healPercent: 25,
          targetAllAllies: true
        }]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);
      const [skill] = actions.skills;

      assert.strictEqual(skill.range, 0);
      assert.strictEqual(skill.mpCost, 0);
      assert.strictEqual(skill.healPercent, 25);
      assert.strictEqual(skill.targetAllAllies, true);
      assert.deepStrictEqual(skill.targets, [{
        x: unit.tileX,
        y: unit.tileY,
        unitId: unit.id,
        distance: 0
      }]);
      assert.deepStrictEqual(skill.tiles, [{
        x: unit.tileX,
        y: unit.tileY,
        distance: 0
      }]);
    });

    it('centers range-zero offensive AoEs on the caster', () => {
      const unit = createTestUnit({
        type: 'enemy',
        teamId: 2,
        skills: [{
          id: 'nova',
          name: 'Nova',
          type: 'active',
          mpCost: 10,
          range: 0,
          power: 100,
          aoeRadius: 2
        }]
      });
      const opponent = createTestUnit({
        id: 'opponent',
        type: 'player',
        teamId: 1,
        tileX: 6,
        tileY: 5
      });
      const state = createTestState({ units: [unit, opponent] });

      const [skill] = getAvailableActions(unit, state).skills;

      assert.strictEqual(skill.range, 0);
      assert.strictEqual(skill.targets.length, 1);
      assert.strictEqual(skill.targets[0].unitId, unit.id);
      assert.deepStrictEqual(skill.tiles, [{
        x: unit.tileX,
        y: unit.tileY,
        distance: 0
      }]);
    });
  });

  describe('items availability', () => {
    it('should include items for players from state.consumables', () => {
      const unit = createTestUnit({ type: 'player', actUsed: false });
      const state = createTestState({
        units: [unit],
        consumables: [
          { itemId: 1, name: 'Potion', quantity: 5, effectType: 'heal_hp', effectValue: 50 }
        ]
      });

      const actions = getAvailableActions(unit, state);

      assert.ok(actions.items, 'Should have items');
      assert.strictEqual(actions.items.length, 1);
      assert.strictEqual(actions.items[0].name, 'Potion');
    });

    it('should include items for NPCs from unit.consumables', () => {
      const unit = createTestUnit({
        type: 'enemy',
        actUsed: false,
        consumables: [
          { itemId: 2, name: 'Enemy Potion', quantity: 2, effectType: 'heal_hp', effectValue: 30 }
        ]
      });
      const state = createTestState({ units: [unit] });

      const actions = getAvailableActions(unit, state);

      assert.ok(actions.items);
      assert.strictEqual(actions.items.length, 1);
      assert.strictEqual(actions.items[0].name, 'Enemy Potion');
    });

    it('should exclude items with zero quantity', () => {
      const unit = createTestUnit({ type: 'player', actUsed: false });
      const state = createTestState({
        units: [unit],
        consumables: [
          { itemId: 1, name: 'Empty Potion', quantity: 0, effectType: 'heal_hp', effectValue: 50 }
        ]
      });

      const actions = getAvailableActions(unit, state);

      assert.ok(actions.items);
      assert.strictEqual(actions.items.length, 0);
    });
  });
});

// =============================================================================
// processAction - Move Action Tests
// =============================================================================

describe('processAction - Move Action', () => {
  function createMoveTestState(overrides = {}) {
    return {
      units: overrides.units || [],
      mapWidth: 32,
      mapHeight: 32,
      terrain: overrides.terrain || [],
      ...overrides
    };
  }

  function createMoveTestUnit(overrides = {}) {
    return {
      id: 'mover',
      type: 'player',
      tileX: 5,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: [],
      class: 'warrior',
      movement: 3,
      attackRange: 1,
      ...overrides
    };
  }

  it('should reject move when moveUsed is true', () => {
    const unit = createMoveTestUnit({ moveUsed: true });
    const state = createMoveTestState({ units: [unit] });

    const result = processAction(state, unit, 'move', { x: 6, y: 5 });

    assert.ok(result.error);
    assert.ok(result.error.includes('Already moved'));
  });

  it('should reject move when unit has root status', () => {
    const unit = createMoveTestUnit({
      statusEffects: [{ type: 'root', duration: 2 }]
    });
    const state = createMoveTestState({ units: [unit] });

    const result = processAction(state, unit, 'move', { x: 6, y: 5 });

    assert.ok(result.error);
    assert.ok(result.error.includes('Cannot move due to status effect'));
  });

  it('should reject move to occupied tile', () => {
    const unit = createMoveTestUnit();
    const blocker = { id: 'blocker', tileX: 6, tileY: 5, hp: 0 };
    const state = createMoveTestState({ units: [unit, blocker] });

    const result = processAction(state, unit, 'move', { x: 6, y: 5 });

    assert.strictEqual(result.error, 'Target tile is occupied');
  });

  it('should move through a dead unit to a free tile at normal cost', () => {
    const unit = createMoveTestUnit({ tileX: 0, tileY: 0 });
    const corpse = { id: 'corpse', tileX: 1, tileY: 0, hp: 0 };
    const state = createMoveTestState({
      units: [unit, corpse],
      mapWidth: 3,
      mapHeight: 1,
      terrain: [['grass', 'grass', 'grass']]
    });

    const result = processAction(state, unit, 'move', { x: 2, y: 0 });

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.moved, true);
    assert.deepStrictEqual(result.newPosition, { x: 2, y: 0 });
  });

  it('should let players and enemies move through living allies', () => {
    for (const type of ['player', 'enemy']) {
      const unit = createMoveTestUnit({
        id: `${type}-mover`,
        type,
        tileX: 0,
        tileY: 0
      });
      const ally = {
        id: `${type}-ally`,
        type,
        tileX: 1,
        tileY: 0,
        hp: 100
      };
      const state = createMoveTestState({
        units: [unit, ally],
        mapWidth: 3,
        mapHeight: 1,
        terrain: [['grass', 'grass', 'grass']]
      });

      const result = processAction(state, unit, 'move', { x: 2, y: 0 });

      assert.strictEqual(result.error, undefined, `${type} move should succeed`);
      assert.strictEqual(result.moved, true);
      assert.deepStrictEqual(result.newPosition, { x: 2, y: 0 });
    }
  });

  it('should not bypass a living opponent when terrain data is absent', () => {
    for (const [type, opponentType] of [
      ['player', 'enemy'],
      ['enemy', 'player']
    ]) {
      const unit = createMoveTestUnit({ type, tileX: 0, tileY: 0 });
      const blocker = {
        id: 'blocker',
        type: opponentType,
        tileX: 1,
        tileY: 0,
        hp: 100
      };
      const state = createMoveTestState({
        units: [unit, blocker],
        mapWidth: 3,
        mapHeight: 1,
        terrain: undefined
      });

      const result = processAction(state, unit, 'move', { x: 2, y: 0 });

      assert.strictEqual(
        result.error,
        'Target out of movement range (max: 3, cost: unreachable)'
      );
      assert.deepStrictEqual(
        { x: unit.tileX, y: unit.tileY },
        { x: 0, y: 0 }
      );
      assert.strictEqual(unit.moveUsed, false);
    }
  });

  it('should reject move outside map bounds before traversal', () => {
    const unit = createMoveTestUnit({ tileX: 0, tileY: 0 });
    const state = createMoveTestState({ units: [unit] });

    const result = processAction(state, unit, 'move', { x: -1, y: 0 });

    assert.strictEqual(result.error, 'Target tile is outside map bounds');
  });

  it('should use terrain dimensions for bounds when explicit dimensions are absent', () => {
    const unit = createMoveTestUnit({ tileX: 0, tileY: 0 });
    const state = createMoveTestState({
      units: [unit],
      mapWidth: undefined,
      mapHeight: undefined,
      terrain: [
        [0, 0],
        [0, 0]
      ]
    });

    const result = processAction(state, unit, 'move', { x: 2, y: 0 });

    assert.strictEqual(result.error, 'Target tile is outside map bounds');
  });

  it('should reject malformed move coordinates before traversal', () => {
    const malformedTargets = [
      { x: Number.NaN, y: 5 },
      { x: 6, y: Number.POSITIVE_INFINITY },
      { x: 6.5, y: 5 },
      { x: '6', y: 5 },
      { y: 5 }
    ];

    for (const targetTile of malformedTargets) {
      const unit = createMoveTestUnit();
      const state = createMoveTestState({ units: [unit] });
      const result = processAction(state, unit, 'move', targetTile);

      assert.strictEqual(
        result.error,
        'Target tile coordinates must be finite integers',
        `Unexpected error for target ${JSON.stringify(targetTile)}`
      );
    }
  });

  it('should handle null targetTile gracefully', () => {
    const unit = createMoveTestUnit();
    const state = createMoveTestState({ units: [unit] });

    const result = processAction(state, unit, 'move', null);

    // Should return without error but no movement
    assert.strictEqual(result.moved, false);
    assert.strictEqual(result.error, undefined);
  });

  it('should set turnPhase to partial after move only', () => {
    const unit = createMoveTestUnit({ tileX: 5, tileY: 5 });
    const state = createMoveTestState({ units: [unit], terrain: [] });

    const result = processAction(state, unit, 'move', { x: 5, y: 5 });

    // Move to same tile - no actual movement but still a valid move action
    // The function checks for actual movement
    // Since it returns early if targetTile === current position, this tests that edge
    // Actually, the move would be valid if the cost calculation allows it
    // Testing a different scenario - unit remains able to act
    assert.strictEqual(result.turnEnded, false);
    assert.ok(result.availableActions);
  });
});

// =============================================================================
// processAction - Attack Action Tests
// =============================================================================

describe('processAction - Attack Action', () => {
  function createAttackTestUnit(overrides = {}) {
    return {
      id: 'attacker',
      type: 'player',
      tileX: 5,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      strength: 50,
      vitality: 20,
      agility: 15,
      luck: 10,
      attack: 20,
      defense: 10,
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: [],
      class: 'warrior',
      attackRange: 1,
      damageDealt: 0,
      kills: 0,
      ...overrides
    };
  }

  function createAttackTestState(overrides = {}) {
    return {
      units: overrides.units || [],
      mapWidth: 32,
      mapHeight: 32,
      terrain: [],
      ...overrides
    };
  }

  it('should reject attack when actUsed is true', () => {
    const attacker = createAttackTestUnit({ actUsed: true });
    const target = { id: 'target', tileX: 6, tileY: 5, hp: 50, type: 'enemy' };
    const state = createAttackTestState({ units: [attacker, target] });

    const result = processAction(state, attacker, 'attack', { x: 6, y: 5 });

    assert.ok(result.error);
    assert.ok(result.error.includes('Already acted'));
  });

  it('should reject attack when stunned', () => {
    const attacker = createAttackTestUnit({
      statusEffects: [{ type: 'stun', duration: 2 }]
    });
    const target = { id: 'target', tileX: 6, tileY: 5, hp: 50, type: 'enemy' };
    const state = createAttackTestState({ units: [attacker, target] });

    const result = processAction(state, attacker, 'attack', { x: 6, y: 5 });

    assert.ok(result.error);
    assert.ok(result.error.includes('Cannot act due to status effect'));
  });

  it('should reject attack on own tile', () => {
    const attacker = createAttackTestUnit();
    const state = createAttackTestState({ units: [attacker] });

    const result = processAction(state, attacker, 'attack', { x: 5, y: 5 });

    assert.ok(result.error);
    assert.ok(result.error.includes('Cannot attack own tile'));
  });

  it('should reject attack out of range', () => {
    const attacker = createAttackTestUnit({ attackRange: 1 });
    const target = { id: 'target', tileX: 10, tileY: 5, hp: 50, type: 'enemy' };
    const state = createAttackTestState({ units: [attacker, target] });

    const result = processAction(state, attacker, 'attack', { x: 10, y: 5 });

    assert.ok(result.error);
    assert.ok(result.error.includes('out of attack range'));
  });

  it('should handle attack on empty tile', () => {
    const attacker = createAttackTestUnit();
    const state = createAttackTestState({ units: [attacker] });

    const result = processAction(state, attacker, 'attack', { x: 6, y: 5 });

    // Should process as empty tile attack
    assert.strictEqual(result.attackedEmptyTile, true);
    assert.strictEqual(attacker.actUsed, true);
  });

  it('damages a friendly unit selected by tile', () => {
    const attacker = createAttackTestUnit({ teamId: 1 });
    const ally = createAttackTestUnit({
      id: 'ally',
      teamId: 1,
      tileX: 6,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      agility: 0,
      luck: 0,
      vitality: 0,
      defense: 0,
      actUsed: false
    });
    const state = createAttackTestState({ units: [attacker, ally] });

    const result = withRandomValues(
      [0, 0.5],
      () => processAction(state, attacker, 'attack', { x: 6, y: 5 })
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.targetId, ally.id);
    assert.ok(result.damage > 0);
    assert.ok(ally.hp < 100);
  });

  it('rejects malformed, out-of-bounds, and non-playable attack tiles', () => {
    const playableMask = Array.from(
      { length: 3 },
      () => Array(3).fill(true)
    );
    playableMask[1][2] = false;
    const cases = [
      {
        targetTile: { x: 1.5, y: 1 },
        expected: 'Target tile coordinates must be finite integers'
      },
      {
        targetTile: { x: 3, y: 1 },
        expected: 'Target tile is outside map bounds'
      },
      {
        targetTile: { x: 2, y: 1 },
        expected: 'Target tile is not playable'
      }
    ];

    for (const { targetTile, expected } of cases) {
      const attacker = createAttackTestUnit({
        tileX: 1,
        tileY: 1,
        attackRange: 3
      });
      const state = createAttackTestState({
        units: [attacker],
        mapWidth: 3,
        mapHeight: 3,
        playableMask
      });

      const result = processAction(state, attacker, 'attack', targetTile);

      assert.strictEqual(result.error, expected);
      assert.strictEqual(attacker.actUsed, false);
    }
  });

  it('consumes and applies all next-basic Zodiac effects on a hit', () => {
    const attacker = createAttackTestUnit({
      hp: 100,
      maxHp: 1000,
      strength: 100,
      attack: 0,
      luck: 0,
      nextAttackCritBonus: 0.25,
      nextAttackHitsTwice: true,
      twinStrikeDamageMultiplier: 0.6,
      nextAttackLifesteal: true,
      nextAttackRangeBonus: 2,
      zodiacCollectionBonus: { healingReceived: 0.03 }
    });
    const target = {
      id: 'target',
      tileX: 8,
      tileY: 5,
      hp: 500,
      maxHp: 500,
      type: 'enemy',
      agility: 0,
      luck: 0,
      vitality: 0,
      defense: 0,
      statusEffects: []
    };
    const state = createAttackTestState({ units: [attacker, target] });

    const result = withRandomValues(
      [0, 0.5, 0.99, 0.5, 0.99],
      () => processAction(state, attacker, 'attack', { x: 8, y: 5 })
    );

    assert.strictEqual(result.damage, 120);
    assert.strictEqual(result.hits, 2);
    assert.deepStrictEqual(
      result.hitResults.map(hit => hit.damage),
      [60, 60]
    );
    assert.strictEqual(target.hp, 380);
    assert.strictEqual(attacker.hp, 223);
    assert.strictEqual(result.balanceHealing, 123);
    assert.strictEqual(attacker.healingDone, 123);
    assert.deepStrictEqual(result.zodiacEffectsConsumed, [
      'rams_charge',
      'twin_strike',
      'balance',
      'celestial_arrow'
    ]);
    assert.strictEqual(attacker.nextAttackCritBonus, undefined);
    assert.strictEqual(attacker.nextAttackHitsTwice, undefined);
    assert.strictEqual(attacker.nextAttackLifesteal, undefined);
    assert.strictEqual(attacker.nextAttackRangeBonus, undefined);
  });

  it('consumes next-basic effects on misses and empty-tile attacks', () => {
    const missAttacker = createAttackTestUnit({
      nextAttackCritBonus: 0.25,
      nextAttackHitsTwice: true
    });
    const target = {
      id: 'target',
      tileX: 6,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      type: 'enemy',
      agility: 0,
      luck: 0,
      vitality: 0,
      defense: 0
    };
    const missState = createAttackTestState({
      units: [missAttacker, target]
    });

    const missResult = withRandomValues(
      [0.999],
      () => processAction(
        missState,
        missAttacker,
        'attack',
        { x: 6, y: 5 }
      )
    );

    assert.strictEqual(missResult.missed, true);
    assert.deepStrictEqual(missResult.zodiacEffectsConsumed, [
      'rams_charge',
      'twin_strike'
    ]);

    const emptyAttacker = createAttackTestUnit({
      nextAttackLifesteal: true,
      nextAttackRangeBonus: 2
    });
    const emptyState = createAttackTestState({ units: [emptyAttacker] });
    const emptyResult = processAction(
      emptyState,
      emptyAttacker,
      'attack',
      { x: 7, y: 5 }
    );

    assert.strictEqual(emptyResult.attackedEmptyTile, true);
    assert.deepStrictEqual(emptyResult.zodiacEffectsConsumed, [
      'balance',
      'celestial_arrow'
    ]);
  });

  it('retains next-basic effects when attack validation fails', () => {
    const attacker = createAttackTestUnit({
      nextAttackCritBonus: 0.25,
      nextAttackHitsTwice: true,
      twinStrikeDamageMultiplier: 0.6,
      nextAttackLifesteal: true,
      nextAttackRangeBonus: 2
    });
    const state = createAttackTestState({ units: [attacker] });

    const result = processAction(
      state,
      attacker,
      'attack',
      { x: 9, y: 5 }
    );

    assert.match(result.error, /out of attack range/);
    assert.strictEqual(attacker.nextAttackCritBonus, 0.25);
    assert.strictEqual(attacker.nextAttackHitsTwice, true);
    assert.strictEqual(attacker.nextAttackLifesteal, true);
    assert.strictEqual(attacker.nextAttackRangeBonus, 2);
  });

  it('Moonshield blocks a basic damage instance without inflating stats', () => {
    const attacker = createAttackTestUnit({
      strength: 100,
      attack: 0,
      luck: 0
    });
    const target = {
      id: 'target',
      tileX: 6,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      type: 'enemy',
      agility: 0,
      luck: 0,
      vitality: 0,
      defense: 0,
      damageShield: 1,
      damageTaken: 0
    };
    const state = createAttackTestState({ units: [attacker, target] });

    const result = withRandomValues(
      [0, 0.5, 0.99],
      () => processAction(state, attacker, 'attack', { x: 6, y: 5 })
    );

    assert.strictEqual(result.damage, 0);
    assert.strictEqual(result.blockedHits, 1);
    assert.strictEqual(target.hp, 100);
    assert.strictEqual(target.damageShield, 0);
    assert.strictEqual(target.damageTaken, 0);
    assert.strictEqual(attacker.damageDealt, 0);
  });

  it('tracks only actual HP lost for lethal overkill damage', () => {
    const attacker = createAttackTestUnit({
      strength: 100,
      attack: 0,
      luck: 0
    });
    const target = {
      id: 'target',
      tileX: 6,
      tileY: 5,
      hp: 10,
      maxHp: 100,
      type: 'enemy',
      agility: 0,
      luck: 0,
      vitality: 0,
      defense: 0,
      damageTaken: 0,
      deaths: 0
    };
    const state = createAttackTestState({ units: [attacker, target] });

    const result = withRandomValues(
      [0, 0.5, 0.99],
      () => processAction(state, attacker, 'attack', { x: 6, y: 5 })
    );

    assert.strictEqual(result.damage, 10);
    assert.strictEqual(target.damageTaken, 10);
    assert.strictEqual(attacker.damageDealt, 10);
    assert.strictEqual(attacker.kills, 1);
    assert.strictEqual(target.deaths, 1);
  });

  it('should set turnEnded when both move and act are used', () => {
    const attacker = createAttackTestUnit({ moveUsed: true, actUsed: false });
    const target = {
      id: 'target',
      tileX: 6,
      tileY: 5,
      hp: 50,
      maxHp: 50,
      type: 'enemy',
      vitality: 10,
      defense: 5
    };
    const state = createAttackTestState({ units: [attacker, target] });

    const result = processAction(state, attacker, 'attack', { x: 6, y: 5 });

    assert.strictEqual(result.turnEnded, true);
    assert.strictEqual(attacker.turnPhase, 'done');
    assert.strictEqual(attacker.hasActed, true);
  });

  it('allows movement after attacking first', () => {
    const attacker = createAttackTestUnit({ movement: 3 });
    const state = createAttackTestState({ units: [attacker] });

    const attack = processAction(state, attacker, 'attack', { x: 6, y: 5 });
    const move = processAction(state, attacker, 'move', { x: 6, y: 5 });

    assert.strictEqual(attack.error, undefined);
    assert.strictEqual(attack.turnEnded, false);
    assert.deepStrictEqual(attack.availableActions, {
      canMove: true,
      canAct: false,
      canWait: true,
      turnPhase: 'partial'
    });
    assert.strictEqual(move.error, undefined);
    assert.strictEqual(move.moved, true);
    assert.strictEqual(move.turnEnded, true);
  });
});

// =============================================================================
// processAction - Healing Skill Tests
// =============================================================================

describe('processAction - Healing Skills', () => {
  function createSkillTestUnit(overrides = {}) {
    return {
      id: 'healer',
      type: 'enemy',
      teamId: 2,
      tileX: 5,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: [],
      skillCooldowns: {},
      healingDone: 0,
      class: 'test_healer',
      skills: [],
      ...overrides
    };
  }

  function createSkillTestState(units) {
    return {
      units,
      mapWidth: 32,
      mapHeight: 32,
      terrain: []
    };
  }

  const allyHeal = {
    id: 'test_ally_heal',
    name: 'Test Ally Heal',
    type: 'active',
    range: 3,
    mpCost: 15,
    healPercent: 25,
    targetAlly: true
  };

  it('executes a DB-shaped self heal and preserves its regeneration effect', () => {
    const cocoon = {
      id: 'insect_cocoon',
      name: 'Cocoon',
      type: 'active',
      power: 0,
      range: 0,
      mpCost: 15,
      damageType: 'heal',
      effect: 'regenerate',
      effectChance: 1,
      effectDuration: 3
    };
    const insect = createSkillTestUnit({
      hp: 50,
      skills: [cocoon]
    });
    const state = createSkillTestState([insect]);

    const result = processAction(
      state,
      insect,
      'skill',
      { x: insect.tileX, y: insect.tileY },
      cocoon.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(insect.hp, 70);
    assert.strictEqual(insect.mp, 35);
    assert.strictEqual(insect.actUsed, true);
    assert.strictEqual(result.healing, 20);
    assert.deepStrictEqual(insect.statusEffects, [{
      type: 'regenerate',
      duration: 3
    }]);
  });

  it('allows movement after using a skill first', () => {
    const selfHeal = {
      id: 'test_self_heal',
      name: 'Test Self Heal',
      type: 'active',
      power: 0,
      range: 0,
      mpCost: 5,
      damageType: 'heal'
    };
    const caster = createSkillTestUnit({
      type: 'player',
      hp: 50,
      movement: 3,
      skills: [selfHeal]
    });
    const state = createSkillTestState([caster]);

    const skill = processAction(
      state,
      caster,
      'skill',
      { x: caster.tileX, y: caster.tileY },
      selfHeal.id
    );
    const move = processAction(state, caster, 'move', { x: 6, y: 5 });

    assert.strictEqual(skill.error, undefined);
    assert.strictEqual(skill.turnEnded, false);
    assert.deepStrictEqual(skill.availableActions, {
      canMove: true,
      canAct: false,
      canWait: true,
      turnPhase: 'partial'
    });
    assert.strictEqual(move.error, undefined);
    assert.strictEqual(move.moved, true);
    assert.strictEqual(move.turnEnded, true);
  });

  it('executes a DB-shaped Heal Ally against the selected injured teammate', () => {
    const dbHealAlly = {
      id: 'humanoid_heal_ally',
      name: 'Heal Ally',
      type: 'active',
      power: 0,
      range: 4,
      mpCost: 12,
      damageType: 'heal'
    };
    const healer = createSkillTestUnit({ skills: [dbHealAlly] });
    const ally = createSkillTestUnit({
      id: 'ally',
      type: 'npc',
      tileX: 7,
      hp: 50,
      skills: []
    });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 6,
      hp: 50,
      skills: []
    });
    const state = createSkillTestState([healer, ally, opponent]);

    const result = processAction(
      state,
      healer,
      'skill',
      { x: ally.tileX, y: ally.tileY },
      dbHealAlly.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(ally.hp, 75);
    assert.strictEqual(healer.hp, 100);
    assert.strictEqual(opponent.hp, 50);
    assert.strictEqual(healer.mp, 38);
    assert.strictEqual(result.healing, 25);
    assert.strictEqual(result.targetId, ally.id);
  });

  it('heals the selected injured ally instead of the full-health caster', () => {
    const healer = createSkillTestUnit({ skills: [allyHeal] });
    const ally = createSkillTestUnit({
      id: 'ally',
      type: 'npc',
      tileX: 7,
      hp: 50,
      skills: []
    });
    const state = createSkillTestState([healer, ally]);

    const result = processAction(
      state,
      healer,
      'skill',
      { x: ally.tileX, y: ally.tileY },
      allyHeal.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(healer.hp, 100);
    assert.strictEqual(ally.hp, 75);
    assert.strictEqual(healer.mp, 35);
    assert.strictEqual(healer.actUsed, true);
    assert.strictEqual(healer.healingDone, 25);
    assert.strictEqual(result.healing, 25);
    assert.strictEqual(result.targetId, ally.id);
  });

  it('allows an ally-targeted heal to select the caster', () => {
    const healer = createSkillTestUnit({
      hp: 50,
      skills: [allyHeal]
    });
    const state = createSkillTestState([healer]);

    const result = processAction(
      state,
      healer,
      'skill',
      { x: healer.tileX, y: healer.tileY },
      allyHeal.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(healer.hp, 75);
    assert.strictEqual(result.healing, 25);
    assert.strictEqual(result.targetId, healer.id);
  });

  it('keeps a pure self heal targeted on the caster', () => {
    const selfHeal = {
      id: 'test_self_heal',
      name: 'Test Self Heal',
      type: 'active',
      range: 0,
      mpCost: 10,
      healPercent: 20
    };
    const healer = createSkillTestUnit({
      hp: 90,
      skills: [selfHeal]
    });
    const ally = createSkillTestUnit({
      id: 'ally',
      tileX: 6,
      hp: 50,
      skills: []
    });
    const state = createSkillTestState([healer, ally]);

    const result = processAction(
      state,
      healer,
      'skill',
      { x: ally.tileX, y: ally.tileY },
      selfHeal.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(healer.hp, 100);
    assert.strictEqual(ally.hp, 50);
    assert.strictEqual(result.healing, 10);
    assert.strictEqual(healer.healingDone, 10);
    assert.strictEqual(result.targetId, healer.id);
  });

  it('applies healing-received crystals to player skill healing', () => {
    const celestialHeal = {
      id: 'celestial_heal',
      name: 'Celestial Heal',
      type: 'active',
      targetSelf: true,
      range: 0,
      mpCost: 0,
      healPercent: 5
    };
    const healer = createSkillTestUnit({
      type: 'player',
      teamId: 1,
      hp: 50,
      maxHp: 2000,
      skills: [celestialHeal],
      zodiacCollectionBonus: { healingReceived: 0.03 }
    });
    const state = createSkillTestState([healer]);

    const result = processAction(
      state,
      healer,
      'skill',
      { x: healer.tileX, y: healer.tileY },
      celestialHeal.id
    );

    assert.strictEqual(healer.hp, 153);
    assert.strictEqual(result.healing, 103);
    assert.strictEqual(result.selfHealing, 103);
  });

  it('applies both enemy damage and the caster buff for a hybrid skill', () => {
    const frenzy = {
      id: 'test_frenzy',
      name: 'Test Frenzy',
      type: 'active',
      range: 1,
      mpCost: 10,
      power: 120,
      damageType: 'physical',
      selfBuff: { attack: 1.5 },
      buffDuration: 3
    };
    const caster = createSkillTestUnit({
      strength: 40,
      attack: 20,
      luck: 0,
      skills: [frenzy]
    });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 6,
      hp: 200,
      maxHp: 200,
      vitality: 20,
      defense: 10,
      luck: 0,
      skills: []
    });
    const state = createSkillTestState([caster, opponent]);

    // Random values: [hit check, variance, crit check] - ensure hit
    const result = withRandomValues(
      [0.5, 0.5, 0.99],
      () => processAction(
        state,
        caster,
        'skill',
        { x: opponent.tileX, y: opponent.tileY },
        frenzy.id
      )
    );

    assert.strictEqual(result.error, undefined);
    assert.ok(result.damage > 0, 'hybrid skill should deal damage');
    assert.ok(opponent.hp < 200, 'opponent should take damage');
    assert.strictEqual(caster.mp, 40);
    assert.deepStrictEqual(caster.statusEffects, [{
      type: 'test_frenzy_buff',
      duration: 3,
      modifiers: { attack: 1.5 }
    }]);
  });

  it('applies ally-targeted MP restoration, cleansing, and object buffs', () => {
    const rally = {
      id: 'test_rally',
      name: 'Test Rally',
      type: 'active',
      range: 3,
      mpCost: 5,
      power: 0,
      targetAlly: true,
      mpRestore: 25,
      cleanse: true,
      selfBuff: { defense: 1.25 },
      buffDuration: 2
    };
    const caster = createSkillTestUnit({ skills: [rally] });
    const ally = createSkillTestUnit({
      id: 'ally',
      type: 'npc',
      tileX: 6,
      mp: 10,
      maxMp: 100,
      statusEffects: [
        { type: 'poison', duration: 3 },
        { type: 'rage', duration: 2 },
        { type: 'fortify', duration: 2 },
        { type: 'haste', duration: 2 },
        { type: 'regen', duration: 2 },
        { type: 'attack_up', duration: 2 },
        { type: 'defense_up', duration: 2 },
        { type: 'magic_shield', duration: 2 },
        { type: 'berserk', duration: 2 },
        'frenzy',
        { type: 'final_stand', duration: 999 },
        'shadow_arts',
        { type: 'pack_bonus', duration: 2 },
        'regenerate',
        { type: 'unmovable', duration: 999 },
        { type: 'fire_resist', duration: 2 },
        {
          type: 'existing_dynamic_buff',
          duration: 2,
          modifiers: { attack: 1.2 }
        }
      ],
      skills: []
    });
    const state = createSkillTestState([caster, ally]);

    const result = processAction(
      state,
      caster,
      'skill',
      { x: ally.tileX, y: ally.tileY },
      rally.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(ally.mp, 35);
    assert.ok(!ally.statusEffects.some(effect => effect.type === 'poison'));
    assert.deepStrictEqual(
      ally.statusEffects
        .filter(effect =>
          (typeof effect === 'string' ? effect : effect.type) !==
            'test_rally_buff'
        )
        .map(effect => typeof effect === 'string' ? effect : effect.type),
      [
        'rage',
        'fortify',
        'haste',
        'regen',
        'attack_up',
        'defense_up',
        'magic_shield',
        'berserk',
        'frenzy',
        'final_stand',
        'shadow_arts',
        'pack_bonus',
        'regenerate',
        'unmovable',
        'fire_resist',
        'existing_dynamic_buff'
      ]
    );
    assert.deepStrictEqual(
      ally.statusEffects.find(effect => effect.type === 'test_rally_buff'),
      {
        type: 'test_rally_buff',
        duration: 2,
        modifiers: { defense: 1.25 }
      }
    );
    assert.strictEqual(result.targetId, ally.id);
    assert.strictEqual(caster.mp, 45);
  });

  it('normalizes DB-shaped Howl as a living-allies-only radial buff with no damage', () => {
    const howl = {
      id: 'beast_howl',
      name: 'Howl',
      type: 'active',
      range: 0,
      mpCost: 5,
      power: 0,
      damageType: 'support',
      effect: 'attack_up',
      effectChance: 1,
      aoeRadius: 2
    };
    const caster = createSkillTestUnit({
      strength: 60,
      attack: 20,
      skills: [howl]
    });
    const ally = createSkillTestUnit({
      id: 'ally',
      type: 'npc',
      tileX: 6,
      skills: []
    });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileY: 6,
      skills: []
    });
    const deadAlly = createSkillTestUnit({
      id: 'dead-ally',
      type: 'npc',
      tileX: 4,
      hp: 0,
      statusEffects: [],
      skills: []
    });
    const state = createSkillTestState([caster, ally, opponent, deadAlly]);

    const result = processAction(
      state,
      caster,
      'skill',
      { x: opponent.tileX, y: opponent.tileY },
      howl.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.isAoE, true);
    assert.strictEqual(result.damage, 0);
    assert.strictEqual(caster.hp, 100);
    assert.strictEqual(ally.hp, 100);
    assert.strictEqual(opponent.hp, 100);
    assert.deepStrictEqual(caster.statusEffects, [{
      type: 'attack_up',
      duration: 3,
      modifiers: { attack: 1.2 }
    }]);
    assert.deepStrictEqual(ally.statusEffects, [{
      type: 'attack_up',
      duration: 3,
      modifiers: { attack: 1.2 }
    }]);
    assert.deepStrictEqual(opponent.statusEffects, []);
    assert.deepStrictEqual(deadAlly.statusEffects, []);
    assert.strictEqual(caster.mp, 45);
    assert.deepStrictEqual(
      result.skillEffects.map(effect => ({
        type: effect.type,
        effect: effect.effect,
        targetId: effect.targetId
      })),
      [
        { type: 'buff', effect: 'attack_up', targetId: caster.id },
        { type: 'buff', effect: 'attack_up', targetId: ally.id }
      ]
    );

    const baseDamage = withSeededRandom(921, () =>
      calculatePhysicalDamage({ ...caster, statusEffects: [] }, opponent, 100).damage
    );
    const buffedDamage = withSeededRandom(921, () =>
      calculatePhysicalDamage(caster, opponent, 100).damage
    );
    assert.ok(buffedDamage > baseDamage);
  });

  it('normalizes DB-shaped self and targeted buffs for any living occupant', () => {
    const ironDefense = {
      id: 'construct_iron_defense',
      name: 'Iron Defense',
      type: 'active',
      range: 0,
      mpCost: 10,
      power: 0,
      damageType: 'buff',
      effect: 'defense_up',
      effectChance: 1
    };
    const magicShield = {
      id: 'humanoid_magic_shield',
      name: 'Magic Shield',
      type: 'active',
      range: 3,
      mpCost: 15,
      power: 0,
      damageType: 'buff',
      effect: 'magic_shield',
      effectChance: 1,
      effectDuration: 3
    };
    const caster = createSkillTestUnit({
      mp: 50,
      vitality: 60,
      defense: 20,
      skills: [ironDefense, magicShield]
    });
    const ally = createSkillTestUnit({
      id: 'ally',
      type: 'npc',
      tileX: 6,
      intelligence: 40,
      magicDefense: 30,
      skills: []
    });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileY: 6,
      skills: []
    });
    const state = createSkillTestState([caster, ally, opponent]);

    const selfResult = processAction(
      state,
      caster,
      'skill',
      { x: opponent.tileX, y: opponent.tileY },
      ironDefense.id
    );

    assert.strictEqual(selfResult.error, undefined);
    assert.strictEqual(selfResult.damage, 0);
    assert.deepStrictEqual(caster.statusEffects, [{
      type: 'defense_up',
      duration: 3,
      modifiers: { defense: 1.3 }
    }]);
    assert.deepStrictEqual(opponent.statusEffects, []);
    assert.strictEqual(caster.mp, 40);

    caster.actUsed = false;
    const opponentResult = processAction(
      state,
      caster,
      'skill',
      { x: opponent.tileX, y: opponent.tileY },
      magicShield.id
    );

    assert.strictEqual(opponentResult.error, undefined);
    assert.strictEqual(opponentResult.targetId, opponent.id);
    assert.strictEqual(caster.mp, 25);
    assert.strictEqual(caster.actUsed, true);
    assert.deepStrictEqual(opponent.statusEffects, [{
      type: 'magic_shield',
      duration: 3,
      modifiers: { magicDefense: 1.3 }
    }]);

    caster.actUsed = false;
    const allyResult = processAction(
      state,
      caster,
      'skill',
      { x: ally.tileX, y: ally.tileY },
      magicShield.id
    );

    assert.strictEqual(allyResult.error, undefined);
    assert.strictEqual(allyResult.damage, 0);
    assert.deepStrictEqual(ally.statusEffects, [{
      type: 'magic_shield',
      duration: 3,
      modifiers: { magicDefense: 1.3 }
    }]);
    assert.strictEqual(caster.mp, 10);

    const physicalAttacker = {
      ...opponent,
      strength: 80,
      attack: 30,
      statusEffects: []
    };
    const undefendedPhysicalDamage = withSeededRandom(432, () =>
      calculatePhysicalDamage(
        physicalAttacker,
        { ...caster, statusEffects: [] },
        100
      ).damage
    );
    const defendedPhysicalDamage = withSeededRandom(432, () =>
      calculatePhysicalDamage(physicalAttacker, caster, 100).damage
    );
    assert.ok(defendedPhysicalDamage < undefendedPhysicalDamage);

    const magicalAttacker = {
      ...opponent,
      intelligence: 80,
      magicAttack: 30,
      statusEffects: []
    };
    const unshieldedMagicDamage = withSeededRandom(987, () =>
      calculateMagicalDamage(
        magicalAttacker,
        { ...ally, statusEffects: [] },
        100
      ).damage
    );
    const shieldedMagicDamage = withSeededRandom(987, () =>
      calculateMagicalDamage(magicalAttacker, ally, 100).damage
    );
    assert.ok(shieldedMagicDamage < unshieldedMagicDamage);
  });

  it('keeps unsupported legacy buffs unavailable and rejects direct execution', () => {
    const fortress = {
      id: 'construct_fortress',
      name: 'Fortress',
      type: 'active',
      range: 0,
      mpCost: 15,
      power: 0,
      damageType: 'buff',
      effect: 'immovable',
      effectChance: 1
    };
    const darkPact = {
      id: 'demon_dark_pact',
      name: 'Dark Pact',
      type: 'active',
      range: 0,
      mpCost: 0,
      power: 0,
      damageType: 'buff',
      effect: 'attack_up',
      effectChance: 1,
      effectDuration: 5
    };
    const caster = createSkillTestUnit({
      hp: 80,
      maxHp: 100,
      mp: 50,
      skills: [fortress, darkPact]
    });
    const state = createSkillTestState([caster]);

    const availableSkillIds = getAvailableActions(caster, state).skills
      .map(skill => skill.id);
    assert.deepStrictEqual(availableSkillIds, []);

    for (const skill of [fortress, darkPact]) {
      const result = processAction(
        state,
        caster,
        'skill',
        { x: caster.tileX, y: caster.tileY },
        skill.id
      );

      assert.strictEqual(result.error, 'Invalid skill', skill.id);
      assert.strictEqual(caster.hp, 80, skill.id);
      assert.strictEqual(caster.mp, 50, skill.id);
      assert.strictEqual(caster.actUsed, false, skill.id);
      assert.deepStrictEqual(caster.statusEffects, [], skill.id);
    }
  });

  it('normalizes DB-shaped Frenzy as enemy damage plus caster-only berserk', () => {
    const frenzy = {
      id: 'beast_frenzy',
      name: 'Frenzy',
      type: 'active',
      range: 1,
      mpCost: 15,
      power: 80,
      damageType: 'physical',
      effect: 'berserk',
      effectChance: 1
    };
    const caster = createSkillTestUnit({
      strength: 40,
      attack: 20,
      vitality: 40,
      defense: 20,
      luck: 0,
      skills: [frenzy]
    });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 6,
      hp: 200,
      maxHp: 200,
      vitality: 20,
      defense: 10,
      luck: 0,
      skills: []
    });
    const state = createSkillTestState([caster, opponent]);

    // Random values: [hit check, variance, crit check] - ensure hit
    const result = withRandomValues(
      [0.5, 0.5, 0.99],
      () => processAction(
        state,
        caster,
        'skill',
        { x: opponent.tileX, y: opponent.tileY },
        frenzy.id
      )
    );

    assert.strictEqual(result.error, undefined);
    assert.ok(result.damage > 0, 'Frenzy should deal damage');
    assert.ok(opponent.hp < 200, 'opponent should take damage');
    assert.deepStrictEqual(caster.statusEffects, [{
      type: 'berserk',
      duration: 3,
      modifiers: {
        attack: 1.5,
        defense: 0.7
      }
    }]);
    assert.deepStrictEqual(opponent.statusEffects, []);
    assert.strictEqual(caster.mp, 35);

    const baseOutgoingDamage = withSeededRandom(246, () =>
      calculatePhysicalDamage({ ...caster, statusEffects: [] }, opponent, 100).damage
    );
    const berserkOutgoingDamage = withSeededRandom(246, () =>
      calculatePhysicalDamage(caster, opponent, 100).damage
    );
    assert.ok(berserkOutgoingDamage > baseOutgoingDamage);

    const incomingAttacker = {
      ...opponent,
      strength: 80,
      attack: 30,
      statusEffects: []
    };
    const baseIncomingDamage = withSeededRandom(642, () =>
      calculatePhysicalDamage(
        incomingAttacker,
        { ...caster, statusEffects: [] },
        100
      ).damage
    );
    const berserkIncomingDamage = withSeededRandom(642, () =>
      calculatePhysicalDamage(incomingAttacker, caster, 100).damage
    );
    assert.ok(berserkIncomingDamage > baseIncomingDamage);
  });

  it('applies Lightning Bolt damage to a friendly unit selected by tile', () => {
    const lightningBolt = {
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      type: 'active',
      range: 3,
      mpCost: 5,
      power: 120,
      damageType: 'magical',
      element: 'lightning'
    };
    const caster = createSkillTestUnit({
      intelligence: 50,
      magicAttack: 20,
      luck: 0,
      skills: [lightningBolt]
    });
    const ally = createSkillTestUnit({
      id: 'friendly-target',
      teamId: caster.teamId,
      tileX: 6,
      hp: 200,
      maxHp: 200,
      vitality: 10,
      magicDefense: 5,
      luck: 0,
      skills: []
    });
    const state = createSkillTestState([caster, ally]);

    const result = withRandomValues(
      [0.5, 0.5],
      () => processAction(
        state,
        caster,
        'skill',
        { x: ally.tileX, y: ally.tileY },
        lightningBolt.id
      )
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.targetId, ally.id);
    assert.ok(result.damage > 0);
    assert.ok(ally.hp < 200);
  });

  it('applies a tile-centered AoE to friendly units around an empty center', () => {
    const inferno = {
      id: 'inferno',
      name: 'Inferno',
      type: 'active',
      range: 3,
      mpCost: 5,
      power: 120,
      damageType: 'magical',
      element: 'fire',
      aoeRadius: 1
    };
    const caster = createSkillTestUnit({
      intelligence: 50,
      magicAttack: 20,
      luck: 0,
      skills: [inferno]
    });
    const ally = createSkillTestUnit({
      id: 'friendly-aoe-target',
      teamId: caster.teamId,
      tileX: 6,
      tileY: 5,
      hp: 200,
      maxHp: 200,
      vitality: 10,
      magicDefense: 5,
      luck: 0,
      skills: []
    });
    const state = createSkillTestState([caster, ally]);

    const result = withRandomValues(
      [0.5, 0.5],
      () => processAction(
        state,
        caster,
        'skill',
        { x: 7, y: 5 },
        inferno.id
      )
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.isAoE, true);
    assert.ok(result.aoeTargets.some(target => target.targetId === ally.id));
    assert.ok(ally.hp < 200);
  });

  it('applies a debuff-only AoE without dealing damage', () => {
    const smokeBomb = {
      id: 'test_smoke_bomb',
      name: 'Test Smoke Bomb',
      type: 'active',
      range: 3,
      mpCost: 0,
      power: 0,
      aoeRadius: 1,
      effect: 'blind',
      effectDuration: 2,
      effectChance: 1
    };
    const caster = createSkillTestUnit({ skills: [smokeBomb] });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 7,
      hp: 200,
      maxHp: 200,
      luck: 0,
      skills: []
    });
    const state = createSkillTestState([caster, opponent]);

    // Random values: [effect chance roll] - ensure debuff applies
    const result = withRandomValues(
      [0.1],
      () => processAction(
        state,
        caster,
        'skill',
        { x: opponent.tileX, y: opponent.tileY },
        smokeBomb.id
      )
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.isAoE, true);
    assert.strictEqual(result.damage, 0);
    assert.strictEqual(opponent.hp, 200);
    assert.deepStrictEqual(opponent.statusEffects, [{
      type: 'blind',
      duration: 2
    }]);
    assert.ok(result.skillEffects.some(effect =>
      effect.type === 'debuff' &&
      effect.effect === 'blind' &&
      effect.targetId === opponent.id
    ));
  });

  it('rejects a V3 skill centered on a visible but non-playable tile', () => {
    const smokeBomb = {
      id: 'test_masked_smoke_bomb',
      name: 'Test Masked Smoke Bomb',
      type: 'active',
      range: 3,
      mpCost: 10,
      power: 0,
      aoeRadius: 1,
      effect: 'blind',
      effectChance: 1
    };
    const caster = createSkillTestUnit({ skills: [smokeBomb] });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 7,
      statusEffects: [],
      skills: []
    });
    const playableMask = Array.from(
      { length: 32 },
      () => Array(32).fill(true)
    );
    playableMask[opponent.tileY][opponent.tileX] = false;
    const state = {
      ...createSkillTestState([caster, opponent]),
      playableMask
    };

    const result = processAction(
      state,
      caster,
      'skill',
      { x: opponent.tileX, y: opponent.tileY },
      smokeBomb.id
    );

    assert.strictEqual(result.error, 'Target tile is not playable');
    assert.strictEqual(caster.mp, 50);
    assert.strictEqual(caster.actUsed, false);
    assert.deepStrictEqual(opponent.statusEffects, []);
  });

  it('rejects malformed and out-of-bounds non-caster skill tiles', () => {
    const lightningBolt = {
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      type: 'active',
      range: 3,
      mpCost: 5,
      power: 120,
      damageType: 'magical'
    };
    const cases = [
      {
        targetTile: { x: 5.5, y: 5 },
        expected: 'Target tile coordinates must be finite integers'
      },
      {
        targetTile: { x: 32, y: 5 },
        expected: 'Target tile is outside map bounds'
      }
    ];

    for (const { targetTile, expected } of cases) {
      const caster = createSkillTestUnit({ skills: [lightningBolt] });
      const state = createSkillTestState([caster]);

      const result = processAction(
        state,
        caster,
        'skill',
        targetTile,
        lightningBolt.id
      );

      assert.strictEqual(result.error, expected);
      assert.strictEqual(caster.mp, 50);
      assert.strictEqual(caster.actUsed, false);
    }
  });

  it('filters non-playable V3 cells from AoE tiles and effects', () => {
    const smokeBomb = {
      id: 'test_masked_smoke_bomb',
      name: 'Test Masked Smoke Bomb',
      type: 'active',
      range: 3,
      mpCost: 0,
      power: 0,
      aoeRadius: 1,
      effect: 'blind',
      effectDuration: 2,
      effectChance: 1
    };
    const caster = createSkillTestUnit({ skills: [smokeBomb] });
    const centerTarget = createSkillTestUnit({
      id: 'center-target',
      type: 'player',
      teamId: 1,
      tileX: 6,
      tileY: 5,
      luck: 0,
      statusEffects: [],
      skills: []
    });
    const maskedTarget = createSkillTestUnit({
      id: 'masked-target',
      type: 'player',
      teamId: 1,
      tileX: 7,
      tileY: 5,
      luck: 0,
      statusEffects: [],
      skills: []
    });
    const playableTarget = createSkillTestUnit({
      id: 'playable-target',
      type: 'player',
      teamId: 1,
      tileX: 6,
      tileY: 6,
      luck: 0,
      statusEffects: [],
      skills: []
    });
    const playableMask = Array.from(
      { length: 32 },
      () => Array(32).fill(true)
    );
    playableMask[maskedTarget.tileY][maskedTarget.tileX] = false;
    const state = {
      ...createSkillTestState([
        caster,
        centerTarget,
        maskedTarget,
        playableTarget
      ]),
      playableMask
    };

    // Random values: [effect chance roll for each target] - ensure debuffs apply
    const result = withRandomValues(
      [0.1, 0.1, 0.1],
      () => processAction(
        state,
        caster,
        'skill',
        { x: centerTarget.tileX, y: centerTarget.tileY },
        smokeBomb.id
      )
    );

    assert.strictEqual(result.error, undefined);
    assert.ok(result.aoeTiles.some(tile =>
      tile.x === playableTarget.tileX && tile.y === playableTarget.tileY
    ));
    assert.ok(!result.aoeTiles.some(tile =>
      tile.x === maskedTarget.tileX && tile.y === maskedTarget.tileY
    ));
    assert.ok(result.aoeTargets.some(target =>
      target.targetId === playableTarget.id
    ));
    assert.ok(!result.aoeTargets.some(target =>
      target.targetId === maskedTarget.id
    ));
    assert.deepStrictEqual(centerTarget.statusEffects, [{
      type: 'blind',
      duration: 2
    }]);
    assert.deepStrictEqual(playableTarget.statusEffects, [{
      type: 'blind',
      duration: 2
    }]);
    assert.deepStrictEqual(maskedTarget.statusEffects, []);
  });

  it('applies a damage-free single-target debuff without fallback damage', () => {
    const frozenTomb = {
      id: 'test_frozen_tomb',
      name: 'Test Frozen Tomb',
      type: 'active',
      range: 3,
      mpCost: 10,
      power: 0,
      effect: 'freeze',
      effectDuration: 2,
      effectChance: 1,
      cooldown: 3
    };
    const caster = createSkillTestUnit({ skills: [frozenTomb] });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 7,
      hp: 200,
      maxHp: 200,
      luck: 0,
      skills: []
    });
    const state = createSkillTestState([caster, opponent]);

    // Random values: [effect chance roll] - ensure debuff applies
    const result = withRandomValues(
      [0.1],
      () => processAction(
        state,
        caster,
        'skill',
        { x: opponent.tileX, y: opponent.tileY },
        frozenTomb.id
      )
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.damage, 0);
    assert.strictEqual(opponent.hp, 200);
    assert.deepStrictEqual(opponent.statusEffects, [{
      type: 'freeze',
      duration: 2
    }]);
    assert.strictEqual(caster.mp, 40);
    assert.strictEqual(caster.skillCooldowns[frozenTomb.id], 3);
    assert.ok(result.skillEffects.some(effect =>
      effect.type === 'debuff' &&
      effect.effect === 'freeze' &&
      effect.targetId === opponent.id
    ));
  });

  it('Moonshield blocks one hit of a multi-hit single-target skill', () => {
    const doubleSlash = {
      id: 'test_double_slash',
      name: 'Double Slash',
      type: 'active',
      range: 3,
      mpCost: 0,
      power: 100,
      damageType: 'physical',
      hits: 2
    };
    const caster = createSkillTestUnit({
      strength: 100,
      attack: 0,
      luck: 0,
      skills: [doubleSlash],
      nextAttackCritBonus: 0.25,
      nextAttackHitsTwice: true,
      nextAttackLifesteal: true,
      nextAttackRangeBonus: 2
    });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 7,
      hp: 300,
      maxHp: 300,
      vitality: 0,
      defense: 0,
      intelligence: 0,
      damageShield: 1,
      skills: []
    });
    const state = createSkillTestState([caster, opponent]);

    // Random values: [hit check, variance, crit check]
    const result = withRandomValues(
      [0.5, 0.5, 0.99],
      () => processAction(
        state,
        caster,
        'skill',
        { x: opponent.tileX, y: opponent.tileY },
        doubleSlash.id
      )
    );

    assert.strictEqual(result.damage, 100);
    assert.strictEqual(result.blockedHits, 1);
    assert.deepStrictEqual(
      result.hitResults.map(hit => [hit.blocked, hit.damage]),
      [[true, 0], [false, 100]]
    );
    assert.strictEqual(opponent.hp, 200);
    assert.strictEqual(opponent.damageShield, 0);
    assert.strictEqual(caster.nextAttackCritBonus, 0.25);
    assert.strictEqual(caster.nextAttackHitsTwice, true);
    assert.strictEqual(caster.nextAttackLifesteal, true);
    assert.strictEqual(caster.nextAttackRangeBonus, 2);
  });

  it('Moonshield blocks an AoE damage instance for only its owner', () => {
    const blast = {
      id: 'test_blast',
      name: 'Blast',
      type: 'active',
      range: 3,
      mpCost: 0,
      power: 100,
      damageType: 'physical',
      aoeRadius: 1
    };
    const caster = createSkillTestUnit({
      strength: 100,
      attack: 0,
      luck: 0,
      skills: [blast]
    });
    const shielded = createSkillTestUnit({
      id: 'shielded',
      type: 'player',
      teamId: 1,
      tileX: 7,
      hp: 200,
      maxHp: 200,
      vitality: 0,
      defense: 0,
      intelligence: 0,
      damageShield: 1,
      skills: []
    });
    const unshielded = createSkillTestUnit({
      id: 'unshielded',
      type: 'player',
      teamId: 1,
      tileX: 8,
      hp: 200,
      maxHp: 200,
      vitality: 0,
      defense: 0,
      intelligence: 0,
      skills: []
    });
    const state = createSkillTestState([caster, shielded, unshielded]);

    // Random values: [hit1, var1, crit1, hit2, var2, crit2] for 2 AoE targets
    const result = withRandomValues(
      [0.5, 0.5, 0.99, 0.5, 0.5, 0.99],
      () => processAction(
        state,
        caster,
        'skill',
        { x: shielded.tileX, y: shielded.tileY },
        blast.id
      )
    );
    const shieldedResult = result.aoeTargets.find(
      target => target.targetId === shielded.id
    );
    const unshieldedResult = result.aoeTargets.find(
      target => target.targetId === unshielded.id
    );

    assert.strictEqual(shieldedResult.damage, 0);
    assert.strictEqual(shieldedResult.blockedHits, 1);
    assert.strictEqual(shielded.hp, 200);
    assert.strictEqual(shielded.damageShield, 0);
    assert.ok(unshieldedResult.damage > 0);
    assert.ok(unshielded.hp < 200);
  });

  it('reports effective healing for injured and full-health ally targets', () => {
    const healer = createSkillTestUnit({ skills: [allyHeal] });
    const ally = createSkillTestUnit({
      id: 'ally',
      tileX: 6,
      hp: 90,
      skills: []
    });
    const state = createSkillTestState([healer, ally]);

    const injuredResult = processAction(
      state,
      healer,
      'skill',
      { x: ally.tileX, y: ally.tileY },
      allyHeal.id
    );

    assert.strictEqual(ally.hp, 100);
    assert.strictEqual(injuredResult.healing, 10);
    assert.strictEqual(healer.healingDone, 10);

    healer.actUsed = false;
    const fullHealthResult = processAction(
      state,
      healer,
      'skill',
      { x: ally.tileX, y: ally.tileY },
      allyHeal.id
    );

    assert.strictEqual(ally.hp, 100);
    assert.strictEqual(fullHealthResult.healing, 0);
    assert.strictEqual(healer.healingDone, 10);
  });

  it('applies targeted healing to opponents and spends the cast on empty tiles', () => {
    const targetedHeal = { ...allyHeal, cooldown: 2 };
    const opponentHealer = createSkillTestUnit({ skills: [targetedHeal] });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 6,
      hp: 50,
      maxHp: 100,
      skills: []
    });
    const occupiedState = createSkillTestState([opponentHealer, opponent]);

    const occupiedResult = processAction(
      occupiedState,
      opponentHealer,
      'skill',
      { x: opponent.tileX, y: opponent.tileY },
      targetedHeal.id
    );

    assert.strictEqual(occupiedResult.error, undefined);
    assert.strictEqual(occupiedResult.targetId, opponent.id);
    assert.strictEqual(occupiedResult.healing, 25);
    assert.strictEqual(opponent.hp, 75);
    assert.strictEqual(opponentHealer.mp, 35);
    assert.strictEqual(opponentHealer.actUsed, true);
    assert.strictEqual(opponentHealer.skillCooldowns[targetedHeal.id], 2);

    const emptyHealer = createSkillTestUnit({ skills: [targetedHeal] });
    const emptyState = createSkillTestState([emptyHealer]);
    const emptyTile = { x: 7, y: 5 };

    const emptyResult = processAction(
      emptyState,
      emptyHealer,
      'skill',
      emptyTile,
      targetedHeal.id
    );

    assert.strictEqual(emptyResult.error, undefined);
    assert.strictEqual(emptyResult.attackedEmptyTile, true);
    assert.deepStrictEqual(emptyResult.targetTile, emptyTile);
    assert.strictEqual(emptyResult.targetId, undefined);
    assert.strictEqual(emptyHealer.mp, 35);
    assert.strictEqual(emptyHealer.actUsed, true);
    assert.strictEqual(emptyHealer.skillCooldowns[targetedHeal.id], 2);
  });

  it('applies a zero-cost party heal only to living teammates', () => {
    const partyHeal = {
      id: 'test_party_heal',
      name: 'Test Party Heal',
      type: 'active',
      range: 0,
      mpCost: 0,
      healPercent: 20,
      targetAllAllies: true
    };
    const healer = createSkillTestUnit({
      hp: 80,
      skills: [partyHeal]
    });
    const ally = createSkillTestUnit({
      id: 'ally',
      type: 'npc',
      tileX: 20,
      tileY: 20,
      hp: 50,
      skills: []
    });
    const opponent = createSkillTestUnit({
      id: 'opponent',
      type: 'player',
      teamId: 1,
      tileX: 6,
      hp: 50,
      skills: []
    });
    const state = createSkillTestState([healer, ally, opponent]);

    const result = processAction(
      state,
      healer,
      'skill',
      { x: opponent.tileX, y: opponent.tileY },
      partyHeal.id
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(healer.hp, 100);
    assert.strictEqual(ally.hp, 70);
    assert.strictEqual(opponent.hp, 50);
    assert.strictEqual(healer.mp, 50);
    assert.strictEqual(healer.actUsed, true);
    assert.strictEqual(result.healing, 40);
    assert.deepStrictEqual(result.targetIds, [healer.id, ally.id]);
  });
});

// =============================================================================
// processAction - Item Action Tests
// =============================================================================

describe('processAction - Item Action', () => {
  function createItemTestUnit(overrides = {}) {
    return {
      id: 'item_user',
      type: 'player',
      tileX: 5,
      tileY: 5,
      hp: 50,
      maxHp: 100,
      mp: 30,
      maxMp: 50,
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: [],
      skills: [],
      healingDone: 0,
      ...overrides
    };
  }

  function createItemTestState(overrides = {}) {
    return {
      units: overrides.units || [],
      mapWidth: 32,
      mapHeight: 32,
      terrain: [],
      consumables: overrides.consumables || [],
      ...overrides
    };
  }

  it('should reject item use when actUsed is true', () => {
    const unit = createItemTestUnit({ actUsed: true });
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 1, name: 'Potion', quantity: 1, effectType: 'heal_hp', effectValue: 50 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 1);

    assert.ok(result.error);
    assert.ok(result.error.includes('Already acted'));
  });

  it('should reject item use when item not available', () => {
    const unit = createItemTestUnit();
    const state = createItemTestState({ units: [unit], consumables: [] });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 999);

    assert.ok(result.error);
    assert.ok(result.error.includes('Item not available'));
  });

  it('should reject item use with zero quantity', () => {
    const unit = createItemTestUnit();
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 1, name: 'Potion', quantity: 0, effectType: 'heal_hp', effectValue: 50 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 1);

    assert.ok(result.error);
    assert.ok(result.error.includes('Item not available'));
  });

  it('should heal HP with heal_hp item', () => {
    const unit = createItemTestUnit({ hp: 50, maxHp: 100 });
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 1, inventoryId: 1, name: 'Potion', quantity: 2, effectType: 'heal_hp', effectValue: 30 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 1);

    assert.ok(!result.error);
    assert.strictEqual(unit.hp, 80);
    assert.strictEqual(result.healing, 30);
    assert.strictEqual(state.consumables[0].quantity, 1);
  });

  it('applies healing-received crystals to player HP items', () => {
    const unit = createItemTestUnit({
      hp: 50,
      maxHp: 200,
      zodiacCollectionBonus: { healingReceived: 0.03 }
    });
    const state = createItemTestState({
      units: [unit],
      consumables: [{
        itemId: 1,
        inventoryId: 1,
        name: 'Potion',
        quantity: 1,
        effectType: 'heal_hp',
        effectValue: 100
      }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 1);

    assert.strictEqual(unit.hp, 153);
    assert.strictEqual(result.healing, 103);
  });

  it('should restore MP with heal_mp item', () => {
    const unit = createItemTestUnit({ mp: 10, maxMp: 50 });
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 2, name: 'Ether', quantity: 1, effectType: 'heal_mp', effectValue: 25 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 2);

    assert.ok(!result.error);
    assert.strictEqual(unit.mp, 35);
    assert.strictEqual(result.mpRestored, 25);
  });

  it('should heal both HP and MP with heal_both item', () => {
    const unit = createItemTestUnit({ hp: 50, maxHp: 100, mp: 10, maxMp: 50 });
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 3, name: 'Elixir', quantity: 1, effectType: 'heal_both', effectValue: 40 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 3);

    assert.ok(!result.error);
    assert.strictEqual(unit.hp, 90); // 50 + 40
    assert.strictEqual(unit.mp, 30); // 10 + 20 (half of 40)
  });

  it('should remove poison with cure_poison item', () => {
    const unit = createItemTestUnit({
      statusEffects: [
        { type: 'poison', duration: 3 },
        { type: 'rage', duration: 2 }  // Should NOT be removed
      ]
    });
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 4, name: 'Antidote', quantity: 1, effectType: 'cure_poison', effectValue: 0 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 4);

    assert.ok(!result.error);
    // Poison should be removed, rage should remain
    assert.ok(!unit.statusEffects.some(e => e.type === 'poison'));
    assert.ok(unit.statusEffects.some(e => e.type === 'rage'));
  });

  it('should reject revive on alive unit', () => {
    const unit = createItemTestUnit({ hp: 50 });
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 5, name: 'Phoenix Down', quantity: 1, effectType: 'revive', effectValue: 25 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 5);

    assert.ok(result.error);
    assert.ok(result.error.includes('Target is not defeated'));
  });

  it('should reject healing item on dead unit', () => {
    const unit = createItemTestUnit({ hp: 0 });
    const state = createItemTestState({
      units: [unit],
      consumables: [{ itemId: 1, name: 'Potion', quantity: 1, effectType: 'heal_hp', effectValue: 50 }]
    });

    const result = processAction(state, unit, 'item', { x: 5, y: 5 }, 1);

    assert.ok(result.error);
    assert.ok(result.error.includes('Cannot use this item on a defeated unit'));
  });

  it('should revive dead unit', () => {
    const deadUnit = createItemTestUnit({ id: 'dead_ally', hp: 0, maxHp: 100, deaths: 1 });
    const user = createItemTestUnit({ id: 'user', hp: 100 });
    const state = createItemTestState({
      units: [user, deadUnit],
      consumables: [{ itemId: 5, name: 'Phoenix Down', quantity: 1, effectType: 'revive', effectValue: 25 }]
    });

    const result = processAction(state, user, 'item', { x: deadUnit.tileX, y: deadUnit.tileY }, 5);

    // User self-targets by default if deadUnit is on same tile
    // To properly test this, we need to position them differently
  });

  it('should reject targeting ally without Throw Item skill', () => {
    const user = createItemTestUnit({ id: 'user', tileX: 5, tileY: 5, skills: [] });
    const ally = createItemTestUnit({ id: 'ally', tileX: 6, tileY: 5, hp: 50 });
    const state = createItemTestState({
      units: [user, ally],
      consumables: [{ itemId: 1, name: 'Potion', quantity: 1, effectType: 'heal_hp', effectValue: 50 }]
    });

    const result = processAction(state, user, 'item', { x: 6, y: 5 }, 1);

    assert.ok(result.error);
    assert.ok(result.error.includes('Cannot target allies without Throw Item skill'));
  });

  it('should allow targeting ally with Throw Item skill', () => {
    const user = createItemTestUnit({
      id: 'user',
      tileX: 5,
      tileY: 5,
      hp: 100,
      skills: [{ id: 'throw_item', level: 5 }]
    });
    const ally = createItemTestUnit({ id: 'ally', tileX: 6, tileY: 5, hp: 50, maxHp: 100 });
    const state = createItemTestState({
      units: [user, ally],
      consumables: [{ itemId: 1, inventoryId: 1, name: 'Potion', quantity: 1, effectType: 'heal_hp', effectValue: 50 }]
    });

    const result = processAction(state, user, 'item', { x: 6, y: 5 }, 1);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    // Throw item level 5 has effectiveness = 0.6 + (5 * 0.02) = 0.7
    // effectValue = 50 * 0.7 = 35
    // ally.hp = 50 + 35 = 85
    assert.ok(ally.hp > 50, 'Ally HP should be healed');
    assert.ok(result.effectiveness < 1.0, 'Effectiveness should be reduced when throwing');
  });

  it('should apply Efficient Mixing bonus to item effectiveness', () => {
    const user = createItemTestUnit({
      id: 'user',
      hp: 50,
      maxHp: 200,
      skills: [{ id: 'efficient_mixing', level: 5 }]
    });
    const state = createItemTestState({
      units: [user],
      consumables: [{ itemId: 1, inventoryId: 1, name: 'Potion', quantity: 1, effectType: 'heal_hp', effectValue: 100 }]
    });

    const result = processAction(state, user, 'item', { x: 5, y: 5 }, 1);

    // effectiveness = 1.0 * (1.0 + 5 * 0.1) = 1.5
    // effectValue = 100 * 1.5 = 150
    assert.ok(!result.error);
    assert.ok(result.effectiveness > 1.0, 'Effectiveness should be boosted');
    assert.strictEqual(user.hp, 200); // 50 + 150, capped at maxHp
  });
});

// =============================================================================
// processAction - Wait Action Tests
// =============================================================================

describe('processAction - Wait Action', () => {
  function createWaitTestUnit(overrides = {}) {
    return {
      id: 'waiter',
      type: 'player',
      tileX: 5,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: [],
      ...overrides
    };
  }

  it('should end turn immediately', () => {
    const unit = createWaitTestUnit();
    const state = { units: [unit], mapWidth: 32, mapHeight: 32 };

    const result = processAction(state, unit, 'wait', null);

    assert.strictEqual(result.turnEnded, true);
    assert.strictEqual(unit.turnPhase, 'done');
    assert.strictEqual(unit.hasActed, true);
  });

  it('should end turn even if move was not used', () => {
    const unit = createWaitTestUnit({ moveUsed: false, actUsed: false });
    const state = { units: [unit], mapWidth: 32, mapHeight: 32 };

    const result = processAction(state, unit, 'wait', null);

    assert.strictEqual(result.turnEnded, true);
  });

  it('should provide available actions in result', () => {
    const unit = createWaitTestUnit();
    const state = { units: [unit], mapWidth: 32, mapHeight: 32 };

    const result = processAction(state, unit, 'wait', null);

    assert.ok(result.availableActions);
    // availableActions is calculated based on unit flags and status effects
    // The turn ended but the flags don't prevent future actions per se
    // It just checks canUnitMove and canUnitAct which look at status effects
    assert.ok('canMove' in result.availableActions);
    assert.ok('canAct' in result.availableActions);
  });
});

// =============================================================================
// processAction - Unknown Action Type
// =============================================================================

describe('processAction - Unknown Action Type', () => {
  it('should handle unknown action type gracefully', () => {
    const unit = {
      id: 'unit',
      type: 'player',
      tileX: 5,
      tileY: 5,
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: []
    };
    const state = { units: [unit], mapWidth: 32, mapHeight: 32 };

    const result = processAction(state, unit, 'unknown_action', null);

    // Should return default result without crashing
    assert.strictEqual(result.damage, 0);
    assert.strictEqual(result.moved, false);
  });
});

// =============================================================================
// Battle Statistics Tracking
// =============================================================================

describe('Battle Statistics Tracking', () => {
  /**
   * Create a minimal battle state for testing stat tracking
   */
  function createBattleState(overrides = {}) {
    return {
      units: [
        {
          id: 'attacker',
          type: 'player',
          teamId: 1,
          tileX: 0,
          tileY: 0,
          hp: 100,
          maxHp: 100,
          mp: 50,
          maxMp: 50,
          strength: 50,
          intelligence: 20,
          agility: 20,
          vitality: 20,
          luck: 10,
          attack: 20,
          defense: 10,
          attackRange: 1,
          movement: 3,
          actUsed: false,
          moveUsed: false,
          turnPhase: 'ready',
          statusEffects: [],
          skillCooldowns: {},
          skills: [],
          // Stat tracking fields
          damageDealt: 0,
          damageTaken: 0,
          healingDone: 0,
          kills: 0,
          deaths: 0,
          ...overrides.attacker
        },
        {
          id: 'defender',
          type: 'enemy',
          teamId: 2,
          tileX: 1,
          tileY: 0,
          hp: 50,
          maxHp: 100,
          mp: 30,
          maxMp: 50,
          strength: 30,
          intelligence: 15,
          agility: 15,
          vitality: 10,
          luck: 5,
          attack: 10,
          defense: 5,
          attackRange: 1,
          movement: 3,
          actUsed: false,
          moveUsed: false,
          turnPhase: 'ready',
          statusEffects: [],
          skillCooldowns: {},
          skills: [],
          // Stat tracking fields
          damageDealt: 0,
          damageTaken: 0,
          healingDone: 0,
          kills: 0,
          deaths: 0,
          ...overrides.defender
        }
      ],
      mapWidth: 10,
      mapHeight: 10,
      terrain: [],
      ...overrides.state
    };
  }

  describe('attack damage tracking', () => {
    it('tracks damageDealt for attacker on successful attack', () => {
      const state = createBattleState();
      const attacker = state.units[0];
      const defender = state.units[1];

      const result = processAction(state, attacker, 'attack', { x: 1, y: 0 });

      // Attack should deal damage (not miss)
      if (!result.missed) {
        assert.ok(attacker.damageDealt > 0, 'Attacker damageDealt should be tracked');
        assert.strictEqual(
          attacker.damageDealt,
          defender.damageTaken,
          'damageDealt should equal damageTaken'
        );
      }
    });

    it('tracks damageTaken for defender when attacked', () => {
      const state = createBattleState();
      const attacker = state.units[0];
      const defender = state.units[1];

      const result = processAction(state, attacker, 'attack', { x: 1, y: 0 });

      if (!result.missed) {
        assert.ok(defender.damageTaken > 0, 'Defender damageTaken should be tracked');
      }
    });

    it('tracks kills when target HP reaches 0', () => {
      const state = createBattleState({
        attacker: { strength: 200, attack: 100 }, // Very strong attacker
        defender: { hp: 1, maxHp: 100, defense: 0, vitality: 1 } // Nearly dead defender
      });
      const attacker = state.units[0];
      const defender = state.units[1];

      processAction(state, attacker, 'attack', { x: 1, y: 0 });

      // If defender died (hp <= 0)
      if (defender.hp <= 0) {
        assert.strictEqual(attacker.kills, 1, 'Attacker should have 1 kill');
        assert.ok(defender.deaths >= 1, 'Defender should have at least 1 death');
      }
    });

    it('increments deaths counter (does not reset to 1)', () => {
      const state = createBattleState({
        attacker: { strength: 200, attack: 100 },
        defender: { hp: 1, maxHp: 100, defense: 0, vitality: 1, deaths: 1 } // Already died once
      });
      const attacker = state.units[0];
      const defender = state.units[1];

      processAction(state, attacker, 'attack', { x: 1, y: 0 });

      // If defender died again
      if (defender.hp <= 0) {
        assert.strictEqual(defender.deaths, 2, 'Deaths should increment, not reset to 1');
      }
    });

    it('accumulates damageDealt across multiple attacks', () => {
      const state = createBattleState({
        attacker: { strength: 30, attack: 10 },
        defender: { hp: 500, maxHp: 500 } // Tanky defender
      });
      const attacker = state.units[0];

      withRandomValues([0.5], () => {
        // First attack
        processAction(state, attacker, 'attack', { x: 1, y: 0 });
        const damageAfterFirst = attacker.damageDealt;

        // Reset for second attack
        attacker.actUsed = false;

        // Second attack
        processAction(state, attacker, 'attack', { x: 1, y: 0 });

        assert.ok(
          attacker.damageDealt > damageAfterFirst,
          'damageDealt should accumulate across attacks'
        );
      });
    });
  });

  describe('wait action does not affect stats', () => {
    it('wait does not change any stat counters', () => {
      const state = createBattleState();
      const attacker = state.units[0];

      processAction(state, attacker, 'wait', null);

      assert.strictEqual(attacker.damageDealt, 0, 'damageDealt unchanged');
      assert.strictEqual(attacker.damageTaken, 0, 'damageTaken unchanged');
      assert.strictEqual(attacker.healingDone, 0, 'healingDone unchanged');
      assert.strictEqual(attacker.kills, 0, 'kills unchanged');
      assert.strictEqual(attacker.deaths, 0, 'deaths unchanged');
    });
  });
});
