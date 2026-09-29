import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BATTLE_TERMINAL_COLISEUM_BADGES_EVENT_TYPE,
  BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
  buildColiseumBadgePayload,
  buildColiseumTerminalProgressionPayload,
  buildPveTerminalProgressionPayload,
  registerBattleTerminalEffectHandlers,
  validateColiseumBadgePayload
} from '../../services/battle/BattleTerminalEffects.js';

describe('battle terminal effect payloads', () => {
  it('canonicalizes the exact committed PvE inputs into bounded progression', () => {
    const payload = buildPveTerminalProgressionPayload({
      battleId: 91,
      partyLeaderId: 7,
      rewardsData: {
        enemies: [
          { archetype: 'wolf' },
          { name: 'bandit' },
          { archetype: 'wolf' }
        ],
        droppedItems: [
          { templateId: 12 },
          { templateId: 4 },
          { templateId: 12 }
        ],
        players: [
          { ownerId: 8 },
          { ownerId: 9 },
          { ownerId: 8 }
        ],
        nodeId: 22,
        nodeType: 'forest',
        difficultyTier: 3,
        gold: 125
      },
      isAdvancementBattle: true,
      challengerCharacterId: 44
    });

    assert.deepEqual(payload, {
      version: 1,
      kind: 'pve_victory',
      partyLeaderId: 7,
      partyCharacterIds: [7],
      enemies: [
        { type: 'bandit', count: 1 },
        { type: 'wolf', count: 2 }
      ],
      droppedItems: [
        { templateId: 4, quantity: 1 },
        { templateId: 12, quantity: 2 }
      ],
      node: { id: 22, type: 'forest' },
      difficultyTier: 3,
      gold: 125,
      isPartyBattle: true,
      advancement: {
        challengerCharacterId: 44,
        battleId: 91
      }
    });
  });

  it('deduplicates and sorts partyCharacterIds canonically', () => {
    const payload = buildPveTerminalProgressionPayload({
      battleId: 100,
      partyLeaderId: 5,
      partyCharacterIds: [7, 3, 7, 5, 3, 9],
      rewardsData: {
        enemies: [],
        droppedItems: [],
        players: [],
        difficultyTier: 1,
        gold: 50
      }
    });

    // Duplicates removed, sorted numerically ascending
    assert.deepEqual(payload.partyCharacterIds, [3, 5, 7, 9]);
  });

  it('filters invalid values from partyCharacterIds', () => {
    const payload = buildPveTerminalProgressionPayload({
      battleId: 101,
      partyLeaderId: 2,
      partyCharacterIds: [4, null, undefined, 'invalid', NaN, 2, 8],
      rewardsData: {
        enemies: [],
        droppedItems: [],
        players: [],
        difficultyTier: 1,
        gold: 25
      }
    });

    // null, undefined, 'invalid', NaN filtered; duplicates removed; sorted
    assert.deepEqual(payload.partyCharacterIds, [2, 4, 8]);
  });

  it('falls back to partyLeaderId when partyCharacterIds is empty', () => {
    const payload = buildPveTerminalProgressionPayload({
      battleId: 102,
      partyLeaderId: 11,
      partyCharacterIds: [],
      rewardsData: {
        enemies: [],
        droppedItems: [],
        players: [],
        difficultyTier: 1,
        gold: 0
      }
    });

    assert.deepEqual(payload.partyCharacterIds, [11]);
  });

  it('rejects invalid producer data before it can enter the outbox', () => {
    assert.throws(
      () => buildPveTerminalProgressionPayload({
        battleId: 1,
        partyLeaderId: null,
        rewardsData: {
          enemies: [],
          droppedItems: [],
          players: [],
          difficultyTier: 1,
          gold: 0
        }
      }),
      /partyLeaderId/
    );
    assert.throws(
      () => buildColiseumTerminalProgressionPayload({
        winnerCharacterId: 4,
        queueType: ''
      }),
      /queueType/
    );
  });

  it('captures deterministic Coliseum progression and badge inputs', () => {
    assert.deepEqual(
      buildColiseumTerminalProgressionPayload({
        winnerCharacterId: 31,
        queueType: '1v1'
      }),
      {
        version: 1,
        kind: 'coliseum_victory',
        winnerCharacterId: 31,
        queueType: '1v1'
      }
    );

    const badgePayload = buildColiseumBadgePayload({
      winnerId: 8,
      winnerRating: 1000,
      loserRating: 1250,
      winnerPPR: 80,
      loserPPR: 120,
      winnerNewRating: 1032,
      finalState: {
        player1Id: 8,
        player2Id: 9,
        units: [
          { ownerId: 8, hp: 10 },
          { ownerId: 8, hp: 0 },
          { ownerId: 9, hp: 0 }
        ]
      }
    });

    assert.deepEqual(badgePayload, {
      version: 1,
      winnerId: 8,
      winnerRating: 1000,
      loserRating: 1250,
      winnerPPR: 80,
      loserPPR: 120,
      winnerNewRating: 1032,
      outcome: { flawless: false, comeback: true }
    });
    assert.throws(
      () => validateColiseumBadgePayload({
        ...badgePayload,
        winnerPPR: Number.NaN
      }),
      /winnerPPR/
    );
  });
});

describe('battle terminal effect registration', () => {
  it('registers and unregisters every durable handler', () => {
    const handlers = new Map();
    const outbox = {
      registerHandler(eventType, handler) {
        handlers.set(eventType, handler);
        return () => handlers.delete(eventType);
      }
    };

    const unregister = registerBattleTerminalEffectHandlers(outbox);
    assert.equal(typeof handlers.get(BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE), 'function');
    assert.equal(
      typeof handlers.get(BATTLE_TERMINAL_COLISEUM_BADGES_EVENT_TYPE),
      'function'
    );

    unregister();
    assert.equal(handlers.size, 0);
  });
});
