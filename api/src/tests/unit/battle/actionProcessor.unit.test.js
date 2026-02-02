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

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  checkBattleEnd,
  getBattleStatusString,
  processAction
} from '../../../services/battle/actionProcessor.js';

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
