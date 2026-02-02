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
  getBattleStatusString
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
