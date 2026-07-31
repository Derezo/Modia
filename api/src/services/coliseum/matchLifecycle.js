/**
 * @module coliseum/matchLifecycle
 * @description Match creation, ready check, start, and completion for PvP battles.
 *
 * Key responsibilities:
 * - Creating matches from matched players
 * - Ready check timeouts and handling
 * - Starting PvP battles (creating battle state, database records)
 * - Match completion with rating updates and snapshots
 * - Match cancellation
 *
 * @see matchmaking.js - Player pairing before match creation
 * @see turnTimer.js - Turn timing during matches
 * @see statistics.js - Match snapshots and stats
 */

import { query, withTransaction } from '../../config/database.js';
import * as battleService from '../battleService.js';
import * as battleWebsocket from '../battleWebsocket.js';
import { MAX_BATTLE_PARTY_SIZE } from '../../config/constants.js';
import { calculateBattlePartyPower } from '../characterValuationService.js';
import {
  calculateRatingChange,
  getPlayerRating,
  ensureRating,
  updatePvpRating,
  applyForfeitPenalty
} from '../ratingService.js';
import { getUserBadges, getPriorityBadges, getTier, getNextTierProgress } from '../../../../shared/coliseum.js';
import { getBatchUserAchievements } from '../achievementService.js';
import {
  activeMatches,
  matchReadyTimers,
  matchStartTimers,
  matchmakingQueues,
  matchIdCounter,
  getWebsocket,
  formationTimers,
  pendingFormations,
  FORMATION_SELECTION_TIMEOUT,
  FORMATION_TIMEOUT_BAN_DURATION
} from './constants.js';
import { validateFormationPayload } from '../battle/formationValidation.js';
import { broadcastQueueUpdate } from './queueBroadcaster.js';
import { captureTeamSnapshots, calculateMatchStats, calculateEnhancedMatchStats, getPlayerRank } from './statistics.js';
import { setCompleteMatchFn, cancelTurnTimer, startTurnTimer } from './turnTimer.js';
import { createPlayerBattleUnit } from '../battleUnitFactory.js';
import { loadActiveZodiacAbilities } from '../zodiacAbilityService.js';
import { loadZodiacCollectionBonus } from '../zodiacCollectionBonusService.js';
import battleStateRepository from '../battle/BattleStateRepository.js';
import { battleTerminalOutbox } from '../battle/BattleTerminalOutbox.js';
import {
  BATTLE_TERMINAL_COLISEUM_BADGES_EVENT_TYPE,
  BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
  buildColiseumBadgePayload,
  buildColiseumTerminalProgressionPayload
} from '../battle/BattleTerminalEffects.js';
import {
  AUTHORED_BATTLE_MAP_VERSION,
  extractBattleMutableState,
  generateBattleMap
} from '../battle/battleMapGenerationService.js';
import { deriveEncounterTerrainSeed } from '../battle/encounterService.js';
import {
  createNegotiatedBattleStateSnapshot,
  sendWithAck
} from '../messageReliability.js';

// Register completeMatch with turnTimer to break circular dependency
setCompleteMatchFn(completeMatch);

/**
 * Create a match from two matched players
 * @param {string} queueType - Queue type
 * @param {Object} player1 - First player queue entry
 * @param {Object} player2 - Second player queue entry
 * @returns {Promise<number>} Match ID
 */
export async function createMatch(queueType, player1, player2) {
  // Create match with PPR info
  const matchId = matchIdCounter.value++;
  const createdAt = Date.now();
  const match = {
    id: matchId,
    queueType,
    player1: {
      userId: player1.userId,
      username: player1.username,
      partyLevel: player1.partyLevel,
      ppr: player1.ppr,
      battleMapCapabilities: player1.battleMapCapabilities ?? null,
      ready: false
    },
    player2: {
      userId: player2.userId,
      username: player2.username,
      partyLevel: player2.partyLevel,
      ppr: player2.ppr,
      battleMapCapabilities: player2.battleMapCapabilities ?? null,
      ready: false
    },
    status: 'pending',
    createdAt,
    readyDeadline: createdAt + 10000 // 10 seconds to ready up
  };

  activeMatches.set(matchId, match);

  // Fetch achievements and ratings for badge display
  const userIds = [player1.userId, player2.userId];
  const [achievementsMap, ratingsResult] = await Promise.all([
    getBatchUserAchievements(userIds),
    query(
      `SELECT user_id, rating, win_streak, wins, losses FROM pvp_ratings
       WHERE user_id = ANY($1) AND queue_type = $2`,
      [userIds, queueType]
    )
  ]);

  // Build ratings lookup
  const ratingsMap = new Map();
  for (const row of ratingsResult.rows) {
    ratingsMap.set(row.user_id, {
      rating: row.rating,
      winStreak: row.win_streak || 0,
      wins: row.wins || 0,
      losses: row.losses || 0
    });
  }

  // Compute badges for each player
  const player1Badges = getPriorityBadges(
    getUserBadges(
      achievementsMap.get(player1.userId) || [],
      ratingsMap.get(player1.userId)?.winStreak || 0
    ),
    3
  );
  const player2Badges = getPriorityBadges(
    getUserBadges(
      achievementsMap.get(player2.userId) || [],
      ratingsMap.get(player2.userId)?.winStreak || 0
    ),
    3
  );

  // Notify both players of match found with ACK tracking - critical message
  getWebsocket().then(ws => {
    const matchPayload = {
      matchId,
      queueType,
      readyDeadline: match.readyDeadline
    };

    // Send match_found directly (coliseum has its own ready timeout/cancellation logic)
    const player1Ws = ws.connections?.get(player1.userId);
    if (player1Ws && player1Ws.readyState === 1) {
      player1Ws.send(JSON.stringify({
        type: 'coliseum:match_found',
        payload: {
          ...matchPayload,
          yourPPR: player1.ppr,
          opponent: {
            username: player2.username,
            partyLevel: player2.partyLevel,
            ppr: player2.ppr,
            rating: ratingsMap.get(player2.userId)?.rating || 1000,
            winStreak: ratingsMap.get(player2.userId)?.winStreak || 0,
            badges: player2Badges,
            wins: ratingsMap.get(player2.userId)?.wins || 0,
            totalMatches: (ratingsMap.get(player2.userId)?.wins || 0) + (ratingsMap.get(player2.userId)?.losses || 0)
          }
        }
      }));
    }

    const player2Ws = ws.connections?.get(player2.userId);
    if (player2Ws && player2Ws.readyState === 1) {
      player2Ws.send(JSON.stringify({
        type: 'coliseum:match_found',
        payload: {
          ...matchPayload,
          yourPPR: player2.ppr,
          opponent: {
            username: player1.username,
            partyLevel: player1.partyLevel,
            ppr: player1.ppr,
            rating: ratingsMap.get(player1.userId)?.rating || 1000,
            winStreak: ratingsMap.get(player1.userId)?.winStreak || 0,
            badges: player1Badges,
            wins: ratingsMap.get(player1.userId)?.wins || 0,
            totalMatches: (ratingsMap.get(player1.userId)?.wins || 0) + (ratingsMap.get(player1.userId)?.losses || 0)
          }
        }
      }));
    }

    // Update queue for remaining players
    broadcastQueueUpdate(queueType);
  }).catch(err => console.error('Failed to notify match found:', err));

  // Set timeout for ready check (tracked for test cleanup)
  const readyTimerId = setTimeout(() => checkMatchReady(matchId), 11000);
  matchReadyTimers.set(matchId, readyTimerId);

  return matchId;
}

/**
 * Player ready confirmation
 * @param {number} matchId - Match ID
 * @param {number} userId - User ID
 * @returns {Object} Result
 */
export function playerReady(matchId, userId) {
  const match = activeMatches.get(matchId);
  if (!match) {
    return { success: false, error: 'Match not found' };
  }

  if (match.status !== 'pending') {
    return { success: false, error: 'Match is not in pending state' };
  }

  // Mark player as ready
  if (match.player1.userId === userId) {
    match.player1.ready = true;
  } else if (match.player2.userId === userId) {
    match.player2.ready = true;
  } else {
    return { success: false, error: 'You are not in this match' };
  }

  // Check if both ready
  if (match.player1.ready && match.player2.ready) {
    match.status = 'ready';

    // Start formation selection phase
    startFormationPhase(matchId);
  } else {
    // Notify opponent that player is ready (async)
    getWebsocket().then(ws => {
      const opponentId = match.player1.userId === userId
        ? match.player2.userId
        : match.player1.userId;

      ws.sendToUser(opponentId, {
        type: 'coliseum:opponent_ready',
        payload: { matchId }
      });
    }).catch(err => console.error('Failed to notify opponent ready:', err));
  }

  return { success: true, bothReady: match.player1.ready && match.player2.ready };
}

/**
 * Start formation selection phase
 * @param {number} matchId - Match ID
 */
function startFormationPhase(matchId) {
  const match = activeMatches.get(matchId);
  if (!match) return;

  match.status = 'formation_selection';
  match.formationDeadline = Date.now() + FORMATION_SELECTION_TIMEOUT;

  // Initialize pending formations for this match
  pendingFormations.set(matchId, {});

  // Set formation timeout
  const timerId = setTimeout(() => checkFormationTimeout(matchId), FORMATION_SELECTION_TIMEOUT + 1000);
  formationTimers.set(matchId, timerId);

  // Notify both players of formation phase start
  getWebsocket().then(ws => {
    const formationPayload = {
      matchId,
      status: 'formation_selection',
      deadline: match.formationDeadline
    };

    ws.sendToUser(match.player1.userId, {
      type: 'coliseum:formation_started',
      payload: formationPayload
    });

    ws.sendToUser(match.player2.userId, {
      type: 'coliseum:formation_started',
      payload: formationPayload
    });
  }).catch(err => console.error('Failed to notify formation phase start:', err));

  console.log(`[Coliseum] Formation phase started for match ${matchId}`);
}

/**
 * Submit formation for a player
 * @param {number} matchId - Match ID
 * @param {number} userId - User ID
 * @param {Object} formation - Formation data { [characterId]: { tileX, tileY } }
 * @returns {Promise<Object>} Result
 */
export async function submitFormation(matchId, userId, formation) {
  const match = activeMatches.get(matchId);
  if (!match) {
    return { success: false, error: 'Match not found' };
  }

  if (match.status !== 'formation_selection') {
    return { success: false, error: 'Not in formation selection phase' };
  }

  // Validate player is in match
  const isPlayer1 = match.player1.userId === userId;
  const isPlayer2 = match.player2.userId === userId;
  if (!isPlayer1 && !isPlayer2) {
    return { success: false, error: 'You are not in this match' };
  }

  // Validate formation
  const queueType = match.queueType;
  const validationResult = await validateFormation(userId, formation, queueType);
  if (!validationResult.success) {
    return validationResult;
  }

  // Store formation
  const pending = pendingFormations.get(matchId) || {};
  pending[userId] = {
    formation,
    submittedAt: Date.now()
  };
  pendingFormations.set(matchId, pending);

  // Notify opponent
  const opponentId = isPlayer1 ? match.player2.userId : match.player1.userId;
  getWebsocket().then(ws => {
    ws.sendToUser(opponentId, {
      type: 'coliseum:opponent_formation_submitted',
      payload: { matchId }
    });
  }).catch(err => console.error('Failed to notify opponent formation submitted:', err));

  // Check if both submitted
  const player1Submitted = !!pending[match.player1.userId];
  const player2Submitted = !!pending[match.player2.userId];

  if (player1Submitted && player2Submitted) {
    // Clear formation timeout
    const timerId = formationTimers.get(matchId);
    if (timerId) {
      clearTimeout(timerId);
      formationTimers.delete(matchId);
    }

    // Start battle with formations
    await startMatchWithFormations(matchId);
  }

  return { success: true, bothSubmitted: player1Submitted && player2Submitted };
}

/**
 * Validate a player's formation
 * @param {number} userId - User ID
 * @param {Object} formation - Formation data { [characterId]: { tileX, tileY } }
 * @param {string} _queueType - Queue type (reserved for future queue-specific validation)
 * @returns {Promise<Object>} Validation result
 */
async function validateFormation(userId, formation, _queueType) {
  const payloadValidation = validateFormationPayload(formation, { required: true });
  if (!payloadValidation.success) return payloadValidation;
  const { characterIds } = payloadValidation;

  // Verify all characters belong to the user and are in battle party
  const result = await query(
    `SELECT id FROM characters
     WHERE user_id = $1 AND id = ANY($2) AND party_slot IS NOT NULL AND party_slot <= 5`,
    [userId, characterIds]
  );

  if (result.rows.length !== characterIds.length) {
    return { success: false, error: 'Invalid character selection' };
  }

  return { success: true };
}

/**
 * Check if formation timeout occurred
 * @param {number} matchId - Match ID
 */
async function checkFormationTimeout(matchId) {
  formationTimers.delete(matchId);

  const match = activeMatches.get(matchId);
  if (!match || match.status !== 'formation_selection') return;

  const pending = pendingFormations.get(matchId) || {};
  const player1Submitted = !!pending[match.player1.userId];
  const player2Submitted = !!pending[match.player2.userId];

  const ws = await getWebsocket();

  if (!player1Submitted && !player2Submitted) {
    // Both timed out - cancel match, ban both
    await applyQueueBan(match.player1.userId, match.queueType, 'formation_timeout');
    await applyQueueBan(match.player2.userId, match.queueType, 'formation_timeout');

    ws.sendToUser(match.player1.userId, {
      type: 'coliseum:formation_timeout',
      payload: { matchId, banDuration: FORMATION_TIMEOUT_BAN_DURATION, reason: 'Formation timeout' }
    });
    ws.sendToUser(match.player2.userId, {
      type: 'coliseum:formation_timeout',
      payload: { matchId, banDuration: FORMATION_TIMEOUT_BAN_DURATION, reason: 'Formation timeout' }
    });

    activeMatches.delete(matchId);
    pendingFormations.delete(matchId);
  } else if (!player1Submitted) {
    // Player 1 timed out
    await applyQueueBan(match.player1.userId, match.queueType, 'formation_timeout');

    ws.sendToUser(match.player1.userId, {
      type: 'coliseum:formation_timeout',
      payload: { matchId, banDuration: FORMATION_TIMEOUT_BAN_DURATION, reason: 'Formation timeout' }
    });
    ws.sendToUser(match.player2.userId, {
      type: 'coliseum:match_cancelled',
      payload: { matchId, reason: 'Opponent failed to submit formation' }
    });

    activeMatches.delete(matchId);
    pendingFormations.delete(matchId);
  } else if (!player2Submitted) {
    // Player 2 timed out
    await applyQueueBan(match.player2.userId, match.queueType, 'formation_timeout');

    ws.sendToUser(match.player2.userId, {
      type: 'coliseum:formation_timeout',
      payload: { matchId, banDuration: FORMATION_TIMEOUT_BAN_DURATION, reason: 'Formation timeout' }
    });
    ws.sendToUser(match.player1.userId, {
      type: 'coliseum:match_cancelled',
      payload: { matchId, reason: 'Opponent failed to submit formation' }
    });

    activeMatches.delete(matchId);
    pendingFormations.delete(matchId);
  }

  console.log(`[Coliseum] Formation timeout for match ${matchId}`);
}

/**
 * Apply queue ban to a user
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @param {string} reason - Ban reason
 */
export async function applyQueueBan(userId, queueType, reason) {
  const banUntil = new Date(Date.now() + FORMATION_TIMEOUT_BAN_DURATION);

  await query(
    `INSERT INTO coliseum_queue_bans (user_id, queue_type, ban_until, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, queue_type)
     DO UPDATE SET ban_until = $3, reason = $4`,
    [userId, queueType, banUntil, reason]
  );

  console.log(`[Coliseum] Applied queue ban to user ${userId} for ${queueType} until ${banUntil}`);
}

/**
 * Check if a user has an active queue ban
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @returns {Promise<Object|null>} Ban info or null if not banned
 */
export async function checkQueueBan(userId, queueType) {
  const result = await query(
    `SELECT ban_until, reason FROM coliseum_queue_bans
     WHERE user_id = $1 AND queue_type = $2 AND ban_until > NOW()`,
    [userId, queueType]
  );

  if (result.rows.length === 0) return null;

  return {
    banUntil: result.rows[0].ban_until,
    reason: result.rows[0].reason
  };
}

/**
 * Check if match is ready (called after timeout)
 * @param {number} matchId - Match ID
 */
function checkMatchReady(matchId) {
  // Clean up the ready timer for this match
  matchReadyTimers.delete(matchId);

  const match = activeMatches.get(matchId);
  if (!match || match.status !== 'pending') return;

  // Match not ready in time - cancel and return players to queue
  const notReadyUsers = [];

  if (!match.player1.ready) notReadyUsers.push(match.player1);
  if (!match.player2.ready) notReadyUsers.push(match.player2);

  getWebsocket().then(ws => {
    // Notify and return ready player to queue
    if (match.player1.ready && !match.player2.ready) {
      const player1Ws = ws.connections?.get(match.player1.userId);
      if (player1Ws && player1Ws.readyState === 1) {
        player1Ws.send(JSON.stringify({
          type: 'coliseum:match_cancelled',
          payload: { matchId, reason: 'Opponent did not ready' }
        }));
      }
      // Re-queue ready player at front (preserve PPR)
      const queue = matchmakingQueues.get(match.queueType) || [];
      queue.unshift({
        userId: match.player1.userId,
        username: match.player1.username,
        partyLevel: match.player1.partyLevel,
        ppr: match.player1.ppr,
        queuedAt: Date.now()
      });
      if (!matchmakingQueues.has(match.queueType)) {
        matchmakingQueues.set(match.queueType, queue);
      }
    }

    if (match.player2.ready && !match.player1.ready) {
      const player2Ws = ws.connections?.get(match.player2.userId);
      if (player2Ws && player2Ws.readyState === 1) {
        player2Ws.send(JSON.stringify({
          type: 'coliseum:match_cancelled',
          payload: { matchId, reason: 'Opponent did not ready' }
        }));
      }
      const queue = matchmakingQueues.get(match.queueType) || [];
      queue.unshift({
        userId: match.player2.userId,
        username: match.player2.username,
        partyLevel: match.player2.partyLevel,
        ppr: match.player2.ppr,
        queuedAt: Date.now()
      });
      if (!matchmakingQueues.has(match.queueType)) {
        matchmakingQueues.set(match.queueType, queue);
      }
    }

    // Notify non-ready players
    for (const user of notReadyUsers) {
      const userWs = ws.connections?.get(user.userId);
      if (userWs && userWs.readyState === 1) {
        userWs.send(JSON.stringify({
          type: 'coliseum:match_cancelled',
          payload: { matchId, reason: 'Failed to ready in time' }
        }));
      }
    }
  }).catch(err => console.error('Failed to handle match ready check:', err));

  // Remove match
  activeMatches.delete(matchId);
}

/**
 * Get a player's battle party characters with stats and equipment
 * Uses LATERAL JOIN to properly extract equipment bonuses from stat_bonuses JSON field
 * @param {number} userId - User ID
 * @param {Object|null} client - Optional caller-owned pg client
 * @param {Array<number>|null} characterIds - Optional exact character IDs to hydrate
 * @returns {Promise<Array>} Battle party characters
 */
async function getPlayerBattleParty(userId, client = null, characterIds = null) {
  const executeQuery = client
    ? client.query.bind(client)
    : query;
  const result = await executeQuery(
    `SELECT c.id, c.name, c.class, c.level, c.race, c.gender,
            c.hp_current, c.hp_max, c.mp_current, c.mp_max,
            c.strength, c.intelligence, c.agility, c.vitality, c.luck,
            COALESCE(eq.equip_strength, 0) as equip_strength,
            COALESCE(eq.equip_intelligence, 0) as equip_intelligence,
            COALESCE(eq.equip_agility, 0) as equip_agility,
            COALESCE(eq.equip_vitality, 0) as equip_vitality,
            COALESCE(eq.equip_luck, 0) as equip_luck,
            COALESCE(eq.equip_hp, 0) as equip_hp,
            COALESCE(eq.equip_mp, 0) as equip_mp,
            COALESCE(eq.equip_attack, 0) as equip_attack,
            COALESCE(eq.equip_defense, 0) as equip_defense,
            COALESCE(eq.equip_magic_attack, 0) as equip_magic_attack,
            COALESCE(eq.equip_magic_defense, 0) as equip_magic_defense
     FROM characters c
     LEFT JOIN LATERAL (
       SELECT
         SUM(COALESCE((it.stat_bonuses->>'strength')::int, 0) + COALESCE((ci.modifications->>'strength')::int, 0)) as equip_strength,
         SUM(COALESCE((it.stat_bonuses->>'intelligence')::int, 0) + COALESCE((ci.modifications->>'intelligence')::int, 0)) as equip_intelligence,
         SUM(COALESCE((it.stat_bonuses->>'agility')::int, 0) + COALESCE((ci.modifications->>'agility')::int, 0)) as equip_agility,
         SUM(COALESCE((it.stat_bonuses->>'vitality')::int, 0) + COALESCE((ci.modifications->>'vitality')::int, 0)) as equip_vitality,
         SUM(COALESCE((it.stat_bonuses->>'luck')::int, 0) + COALESCE((ci.modifications->>'luck')::int, 0)) as equip_luck,
         SUM(COALESCE((it.stat_bonuses->>'hp')::int, 0) + COALESCE((ci.modifications->>'hp_max')::int, 0)) as equip_hp,
         SUM(COALESCE((it.stat_bonuses->>'mp')::int, 0) + COALESCE((ci.modifications->>'mp_max')::int, 0)) as equip_mp,
         SUM(COALESCE((it.stat_bonuses->>'attack')::int, 0) + COALESCE((ci.modifications->>'attack')::int, 0)) as equip_attack,
         SUM(COALESCE((it.stat_bonuses->>'defense')::int, 0) + COALESCE((ci.modifications->>'defense')::int, 0)) as equip_defense,
         SUM(COALESCE((it.stat_bonuses->>'magic_attack')::int, 0) + COALESCE((ci.modifications->>'magic_attack')::int, 0)) as equip_magic_attack,
         SUM(COALESCE((it.stat_bonuses->>'magic_defense')::int, 0) + COALESCE((ci.modifications->>'magic_defense')::int, 0)) as equip_magic_defense
       FROM character_items ci
       JOIN item_templates it ON ci.item_template_id = it.id
       WHERE ci.character_id = c.id AND ci.equipped_slot IS NOT NULL
     ) eq ON true
     WHERE c.user_id = $1
       AND ($2::int[] IS NULL OR c.id = ANY($2::int[]))
       AND c.party_slot IS NOT NULL
       AND c.party_slot <= $3
     ORDER BY c.party_slot`,
    [userId, characterIds, MAX_BATTLE_PARTY_SIZE]
  );

  // Get skills for each character with full definitions (matching PvE pattern)
  const characters = result.rows;
  const hydratedCharacterIds = characters.map(c => c.id);
  const skillsResult = await executeQuery(
    `SELECT character_id, skill_id, level
     FROM character_skills
     WHERE character_id = ANY($1)`,
    [hydratedCharacterIds]
  );

  // Group skills by character and enhance with skill definitions
  const characterSkills = {};
  for (const row of skillsResult.rows) {
    if (!characterSkills[row.character_id]) {
      characterSkills[row.character_id] = [];
    }
    const char = characters.find(c => c.id === row.character_id);
    const skill = char
      ? battleService.resolveBattleSkill(char.class, row)
      : null;

    if (skill) {
      characterSkills[row.character_id].push(skill);
    }
  }

  // Assign enriched skills to each character
  for (const char of characters) {
    char.skills = characterSkills[char.id] || [];
  }

  return characters;
}

/**
 * Select only the configured battle-party characters present in a formation.
 * Formation keys are serialized as strings while database IDs may be numbers.
 *
 * @param {Array<Object>} party - Configured battle-party characters
 * @param {Object} formation - Submitted formation keyed by character ID
 * @returns {Array<Object>} Selected characters in configured party order
 */
export function selectFormationParty(party, formation) {
  const selectedIds = new Set(Object.keys(formation).map(String));
  return party.filter(character => selectedIds.has(String(character.id)));
}

/**
 * Serialize Coliseum creation against every battle lifecycle for both users,
 * then recheck the exact selected characters and authoritative battle records
 * inside the transaction.
 */
export async function reserveColiseumBattleParticipants(client, participants) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('reserveColiseumBattleParticipants requires a pg client');
  }
  if (!Array.isArray(participants) || participants.length !== 2) {
    throw new TypeError('A Coliseum battle requires two distinct users');
  }
  const normalizedParticipants = participants.map((participant) => {
    const userId = Number(participant?.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      throw new TypeError('Coliseum participant user IDs must be positive safe integers');
    }
    if (!Array.isArray(participant.characterIds) || participant.characterIds.length === 0) {
      throw new TypeError('Each Coliseum participant requires selected characters');
    }
    const characterIds = participant.characterIds.map(Number);
    if (characterIds.some(characterId =>
      !Number.isSafeInteger(characterId) || characterId < 1)) {
      throw new TypeError('Selected character IDs must be positive safe integers');
    }
    const uniqueCharacterIds = [...new Set(characterIds)]
      .sort((left, right) => left - right);
    if (uniqueCharacterIds.length !== characterIds.length) {
      throw new TypeError('Selected character IDs must be distinct');
    }
    return { userId, characterIds: uniqueCharacterIds };
  }).sort((left, right) => left.userId - right.userId);
  const participantUserIds = normalizedParticipants.map(participant => participant.userId);
  if (new Set(participantUserIds).size !== 2) {
    throw new TypeError('A Coliseum battle requires two distinct users');
  }
  // Lock every owned character to preserve the user-wide battle lifecycle
  // mutex shared with PvE and advancement battle creation. Only the exact
  // submitted IDs are validated, hydrated, snapshotted, and updated below.
  const lockedCharacters = await client.query(
    `SELECT id, user_id, party_slot, in_battle
     FROM characters
     WHERE user_id = ANY($1::int[])
     ORDER BY user_id, id
     FOR UPDATE`,
    [participantUserIds]
  );
  const lockedById = new Map(
    lockedCharacters.rows.map(character => [String(character.id), character])
  );
  const selectedCharacters = [];
  for (const participant of normalizedParticipants) {
    for (const characterId of participant.characterIds) {
      const character = lockedById.get(String(characterId));
      const partySlot = Number(character?.party_slot);
      if (
        !character
        || Number(character.user_id) !== participant.userId
        || !Number.isSafeInteger(partySlot)
        || partySlot < 1
        || partySlot > MAX_BATTLE_PARTY_SIZE
        || character.in_battle !== false
      ) {
        const error = new Error(
          'A selected Coliseum character is no longer owned, eligible, or available'
        );
        error.code = 'COLISEUM_PARTICIPANTS_CHANGED';
        throw error;
      }
      selectedCharacters.push(character);
    }
  }

  const hasActiveBattle = await battleStateRepository.hasActiveBattleForAnyPlayer(
    participantUserIds,
    { client }
  );
  if (hasActiveBattle) {
    const error = new Error('A matched player is already in an active battle');
    error.code = 'COLISEUM_BATTLE_ALREADY_ACTIVE';
    throw error;
  }
  return selectedCharacters;
}

/**
 * Start the match with submitted formations (create PvP battle)
 * @param {number} matchId - Match ID
 */
async function startMatchWithFormations(matchId) {
  // Clean up timers for this match
  matchReadyTimers.delete(matchId);
  matchStartTimers.delete(matchId);
  formationTimers.delete(matchId);

  const match = activeMatches.get(matchId);
  if (!match || (match.status !== 'ready' && match.status !== 'formation_selection')) return;

  match.status = 'starting';

  // Get submitted formations
  const pending = pendingFormations.get(matchId) || {};
  const player1Formation = pending[match.player1.userId]?.formation || {};
  const player2Formation = pending[match.player2.userId]?.formation || {};

  // Clean up pending formations
  pendingFormations.delete(matchId);

  try {
    const player1CharacterIds = Object.keys(player1Formation).map(Number);
    const player2CharacterIds = Object.keys(player2Formation).map(Number);
    const player1FormationSize = player1CharacterIds.length;
    const player2FormationSize = player2CharacterIds.length;
    const mapSeed = deriveEncounterTerrainSeed(
      match.createdAt + match.id,
      'arena',
      AUTHORED_BATTLE_MAP_VERSION
    );
    const creationIdempotencyKey = [
      'coliseum',
      match.queueType,
      match.id,
      match.createdAt,
      match.player1.userId,
      match.player2.userId
    ].join(':');
    const created = await withTransaction(async client => {
      const lockedParticipants = await reserveColiseumBattleParticipants(client, [
        {
          userId: match.player1.userId,
          characterIds: player1CharacterIds
        },
        {
          userId: match.player2.userId,
          characterIds: player2CharacterIds
        }
      ]);
      const lockedIdsByUser = new Map();
      for (const character of lockedParticipants) {
        const userId = Number(character.user_id);
        const characterIds = lockedIdsByUser.get(userId) ?? [];
        characterIds.push(Number(character.id));
        lockedIdsByUser.set(userId, characterIds);
      }

      // Hydrate the exact reserved characters through the transaction client.
      // Character mutations in inventory/skill flows serialize on the locked rows.
      const loadedPlayer1Party = await getPlayerBattleParty(
        match.player1.userId,
        client,
        player1CharacterIds
      );
      const loadedPlayer2Party = await getPlayerBattleParty(
        match.player2.userId,
        client,
        player2CharacterIds
      );
      const player1Party = selectFormationParty(loadedPlayer1Party, player1Formation);
      const player2Party = selectFormationParty(loadedPlayer2Party, player2Formation);

      // A validated formation must still resolve exactly after party data is loaded.
      if (player1FormationSize === 0 || player1Party.length !== player1FormationSize) {
        console.error('Player 1 formation characters are unavailable:', match.player1.userId);
        const error = new Error('Player 1 battle party data is unavailable');
        error.code = 'COLISEUM_PARTICIPANTS_CHANGED';
        throw error;
      }
      if (player2FormationSize === 0 || player2Party.length !== player2FormationSize) {
        console.error('Player 2 formation characters are unavailable:', match.player2.userId);
        const error = new Error('Player 2 battle party data is unavailable');
        error.code = 'COLISEUM_PARTICIPANTS_CHANGED';
        throw error;
      }

      const player1ZodiacCollectionBonus = await loadZodiacCollectionBonus(
        match.player1.userId,
        { client }
      );
      const player2ZodiacCollectionBonus = await loadZodiacCollectionBonus(
        match.player2.userId,
        { client }
      );
      const player1ZodiacAbilities = await loadActiveZodiacAbilities(
        match.player1.userId,
        { client }
      );
      const player2ZodiacAbilities = await loadActiveZodiacAbilities(
        match.player2.userId,
        { client }
      );

      // Build initial battle state
      const initialState = {
        turn: 1,
        phase: 'action',
        activeUnit: null,
        status: 'active',
        battleType: 'pvp',
        player1Id: match.player1.userId,
        player2Id: match.player2.userId,
        units: [],
        consumables: [],
        log: [{ type: 'battle_start', message: 'PvP Battle begins!', timestamp: Date.now() }]
      };

      // Add player 1's units (bottom side of map) - Team 1
      player1Party.forEach(char => {
        const formationPos = player1Formation[char.id];
        // Map 5x4 formation grid to battle map
        // Formation X: 0-4 -> Battle X: 2-10 (spread across center-bottom)
        // Formation Y: 0-3 -> Battle Y: 24-27 (bottom of map)
        const tileX = 2 + formationPos.tileX * 2;
        const tileY = 27 - formationPos.tileY;

        initialState.units.push(createPlayerBattleUnit({
          ...char,
          user_id: match.player1.userId,
          equip_hp: parseInt(char.equip_hp, 10) || 0,
          equip_mp: parseInt(char.equip_mp, 10) || 0,
          equip_strength: parseInt(char.equip_strength, 10) || 0,
          equip_intelligence: parseInt(char.equip_intelligence, 10) || 0,
          equip_agility: parseInt(char.equip_agility, 10) || 0,
          equip_vitality: parseInt(char.equip_vitality, 10) || 0,
          equip_luck: parseInt(char.equip_luck, 10) || 0,
          equip_attack: parseInt(char.equip_attack, 10) || 0,
          equip_defense: parseInt(char.equip_defense, 10) || 0,
          equip_magic_attack: parseInt(char.equip_magic_attack, 10) || 0,
          equip_magic_defense: parseInt(char.equip_magic_defense, 10) || 0
        }, { tileX, tileY }, char.skills || [], {
          teamId: 1,
          zodiacAbilities: player1ZodiacAbilities,
          zodiacCollectionBonus: player1ZodiacCollectionBonus
        }));
      });

      // Add player 2's units (top side of map) - Team 2
      player2Party.forEach(char => {
        const formationPos = player2Formation[char.id];
        // Map 5x4 formation grid to battle map
        // Player 2 is at top of map
        const tileX = 2 + formationPos.tileX * 2;
        const tileY = 4 + formationPos.tileY;

        initialState.units.push(createPlayerBattleUnit({
          ...char,
          user_id: match.player2.userId,
          equip_hp: parseInt(char.equip_hp, 10) || 0,
          equip_mp: parseInt(char.equip_mp, 10) || 0,
          equip_strength: parseInt(char.equip_strength, 10) || 0,
          equip_intelligence: parseInt(char.equip_intelligence, 10) || 0,
          equip_agility: parseInt(char.equip_agility, 10) || 0,
          equip_vitality: parseInt(char.equip_vitality, 10) || 0,
          equip_luck: parseInt(char.equip_luck, 10) || 0,
          equip_attack: parseInt(char.equip_attack, 10) || 0,
          equip_defense: parseInt(char.equip_defense, 10) || 0,
          equip_magic_attack: parseInt(char.equip_magic_attack, 10) || 0,
          equip_magic_defense: parseInt(char.equip_magic_defense, 10) || 0
        }, { tileX, tileY }, char.skills || [], {
          teamId: 2,
          zodiacAbilities: player2ZodiacAbilities,
          zodiacCollectionBonus: player2ZodiacCollectionBonus
        }));
      });

      // Initialize CT values for all units
      battleService.initializeCT(initialState.units);

      // Advance CT and find the first actor
      battleService.advanceToNextActor(initialState);

      // Generate turn predictions
      initialState.turnPredictions = battleService.predictTurnOrder(initialState, 10);

      const generatedMap = await generateBattleMap({
        terrainSeed: mapSeed,
        nodeType: 'arena',
        mapWidth: 32,
        mapHeight: 32,
        mode: 'pvp_coliseum',
        playerCount: player1Party.length,
        enemyCount: player2Party.length,
        enemyCapacity: player2Party.length,
        existingUnits: initialState.units,
        initialMutableState: initialState,
        competitiveBand: match.queueType,
        clientCapabilities: match.player1.battleMapCapabilities,
        additionalClientCapabilities: [
          match.player2.battleMapCapabilities
        ]
      });
      const result = await battleStateRepository.createBattle({
        battleType: 'pvp_coliseum',
        status: 'active',
        player1Id: match.player1.userId,
        player2Id: match.player2.userId,
        creationIdempotencyKey,
        finalMap: generatedMap.finalMap,
        legacyFlatState: generatedMap.legacyFlatState,
        initialMutableState: generatedMap.mutableState,
        selectionProvenance: generatedMap.selectionProvenance
      }, { client });

      // Mark characters as in battle in the same transaction as battle creation.
      for (const [userId, expectedCharacters] of [
        [match.player1.userId, player1Party],
        [match.player2.userId, player2Party]
      ]) {
        const lockedCharacterIds = lockedIdsByUser.get(Number(userId)) ?? [];
        const updateResult = await client.query(
          `UPDATE characters SET in_battle = true
           WHERE user_id = $1
             AND id = ANY($2::int[])
             AND party_slot IS NOT NULL
             AND party_slot <= $3
             AND in_battle = false`,
          [userId, lockedCharacterIds, MAX_BATTLE_PARTY_SIZE]
        );
        if (updateResult.rowCount !== expectedCharacters.length) {
          const error = new Error(
            `Coliseum participant update changed ${updateResult.rowCount} `
            + `of ${expectedCharacters.length} selected characters`
          );
          error.code = 'COLISEUM_PARTICIPANTS_CHANGED';
          throw error;
        }
      }
      return result;
    });

    const battleId = created.battleId;
    const persistedState = created.envelope.state;

    // Join both players to battle WebSocket room
    await battleWebsocket.joinBattle(battleId, match.player1.userId);
    await battleWebsocket.joinBattle(battleId, match.player2.userId);

    match.status = 'started';
    match.battleId = battleId;

    // Notify each player with a capability-negotiated, revisioned snapshot.
    // V2 maps can be delivered by reference when that exact hash is cached.
    const ws = await getWebsocket();
    const sendStarted = (player, opponent) => {
      const { negotiation, snapshot } = createNegotiatedBattleStateSnapshot(
        created.envelope,
        player.battleMapCapabilities
      );
      if (!negotiation.compatible) {
        throw new Error(
          `Persisted Coliseum map is incompatible with user ${player.userId}`
        );
      }
      const payload = {
        matchId,
        status: 'started',
        battleType: 'pvp_coliseum',
        battleId,
        mapSeed,
        nodeType: 'arena',
        stateRevision: created.envelope.stateRevision,
        battleMapSchemaVersion: created.envelope.battleMapSchemaVersion,
        terrainGenerationVersion: created.envelope.terrainGenerationVersion,
        battleMapCapabilities: negotiation,
        snapshot,
        opponentUsername: opponent.username
      };
      // Undeclared legacy V1 clients retain their old state field.
      if (
        player.battleMapCapabilities === null
        && created.envelope.battleMapSchemaVersion === 1
      ) {
        payload.state = persistedState;
      }
      const connection = ws.connections?.get(player.userId);
      if (connection?.readyState === 1) {
        sendWithAck(
          connection,
          { type: 'coliseum:match_started', payload },
          battleId,
          player.userId
        );
      } else {
        ws.sendToUser(player.userId, {
          type: 'coliseum:match_started',
          payload
        });
      }
    };

    sendStarted(match.player1, match.player2);
    sendStarted(match.player2, match.player1);

    console.log(`PvP Battle ${battleId} started: ${match.player1.username} vs ${match.player2.username}`);

    // Start turn timer for first player's turn
    const firstUnit = persistedState.units.find(u => u.id === persistedState.activeUnitId);
    if (firstUnit && firstUnit.type === 'player' && firstUnit.ownerId) {
      startTurnTimer(battleId, firstUnit.ownerId, false); // false = PvP, can forfeit
    }

  } catch (error) {
    console.error('Failed to create PvP battle:', {
      matchId,
      player1: match.player1.userId,
      player2: match.player2.userId,
      error: error.message,
      stack: error.stack
    });
    await cancelMatch(matchId, error.code === 'COLISEUM_BATTLE_ALREADY_ACTIVE'
      ? 'A player entered another battle'
      : 'Error creating battle');
  }
}

/**
 * Cancel a match and notify players
 * @param {number} matchId - Match ID
 * @param {string} reason - Cancellation reason
 */
export async function cancelMatch(matchId, reason) {
  const match = activeMatches.get(matchId);
  if (!match) return;

  const ws = await getWebsocket();

  // Send match_cancelled directly
  const player1Ws = ws.connections?.get(match.player1.userId);
  if (player1Ws && player1Ws.readyState === 1) {
    player1Ws.send(JSON.stringify({
      type: 'coliseum:match_cancelled',
      payload: { matchId, reason }
    }));
  }

  const player2Ws = ws.connections?.get(match.player2.userId);
  if (player2Ws && player2Ws.readyState === 1) {
    player2Ws.send(JSON.stringify({
      type: 'coliseum:match_cancelled',
      payload: { matchId, reason }
    }));
  }

  // Clean up formation-related state
  const formationTimerId = formationTimers.get(matchId);
  if (formationTimerId) {
    clearTimeout(formationTimerId);
    formationTimers.delete(matchId);
  }
  pendingFormations.delete(matchId);

  activeMatches.delete(matchId);
}

/**
 * Complete a PvP match and record results
 * @param {number} battleId - Battle ID
 * @param {number} winnerId - Winner user ID
 * @param {number} loserId - Loser user ID
 * @param {string} reason - Victory reason: 'victory', 'surrender', 'timeout_forfeit', 'disconnect_forfeit'
 * @param {boolean} applyPenalty - Whether to apply forfeit penalty (default true for forfeits)
 * @param {Object} options - Atomic terminal-command options
 */
export async function completeMatch(
  battleId,
  winnerId,
  loserId,
  reason = 'victory',
  applyPenalty = true,
  {
    finalState = null,
    expectedRevision = null,
    consumedInventoryId = null,
    actingUserId = null,
    battleCommand = null,
    publish = true
  } = {}
) {
  let battleEnvelope;
  try {
    battleEnvelope = await battleStateRepository.loadBattle(battleId);
  } catch (error) {
    if (error?.code !== 'BATTLE_NOT_FOUND') throw error;
    console.error(`[Coliseum] Battle ${battleId} not found for match completion`);
    return { idempotent: true, missing: true, commit: null };
  }

  const priorCompletion = await query(
    `SELECT id, queue_type, winner_user_id, loser_user_id,
            winner_rating_change, loser_rating_change
     FROM coliseum_matches
     WHERE battle_id = $1
     LIMIT 1`,
    [battleId]
  );
  if (priorCompletion.rows.length > 0) {
    const commandReceipt = battleCommand
      ? await battleStateRepository.findCommandReceipt({
        battleId,
        commandType: battleCommand.commandType,
        idempotencyKey: battleCommand.idempotencyKey,
        idempotencyRequest: battleCommand.idempotencyRequest
      })
      : null;
    if (battleCommand && !commandReceipt) {
      const error = new Error(
        `Battle ${battleId} completed without the requested command receipt`
      );
      error.code = 'BATTLE_STATE_CONFLICT';
      error.actualRevision = battleEnvelope.stateRevision;
      throw error;
    }
    return {
      idempotent: true,
      commit: commandReceipt,
      matchResult: priorCompletion.rows[0]
    };
  }

  if (battleEnvelope.battleType !== 'pvp_coliseum') {
    const error = new Error(`Battle ${battleId} is not a Coliseum battle`);
    error.code = 'COLISEUM_BATTLE_TYPE_MISMATCH';
    throw error;
  }
  const participantIds = new Set([
    String(battleEnvelope.player1Id),
    String(battleEnvelope.player2Id)
  ]);
  if (!participantIds.has(String(winnerId))
    || !participantIds.has(String(loserId))
    || String(winnerId) === String(loserId)) {
    const error = new Error(`Winner and loser do not match battle ${battleId}`);
    error.code = 'COLISEUM_PARTICIPANT_MISMATCH';
    throw error;
  }

  let match = null;
  activeMatches.forEach(candidate => {
    if (candidate.battleId === battleId) match = candidate;
  });
  const encodedQueueType = battleEnvelope.creationIdempotencyKey
    ?.match(/^coliseum:([^:]+):/)?.[1];
  const queueType = match?.queueType || encodedQueueType || '1v1';
  const [snapshot, stats, enhancedStats, winnerOldRank, loserOldRank] =
    await Promise.all([
      captureTeamSnapshots(winnerId, loserId),
      calculateMatchStats(battleId),
      calculateEnhancedMatchStats(battleId),
      getPlayerRank(winnerId, queueType),
      getPlayerRank(loserId, queueType)
    ]);
  const winnerPPR = match?.player1?.userId === winnerId
    ? match.player1.ppr
    : (match?.player2?.ppr || await calculateBattlePartyPower(winnerId));
  const loserPPR = match?.player1?.userId === loserId
    ? match.player1.ppr
    : (match?.player2?.ppr || await calculateBattlePartyPower(loserId));
  const enhancedStatsToStore = {
    ...stats,
    unitStats: enhancedStats?.unitStats || [],
    battleSummary: enhancedStats?.battleSummary || null,
    totalDamage:
      enhancedStats?.unitStats?.reduce((sum, unit) => sum + (unit.damageDealt || 0), 0) || 0,
    totalHealing:
      enhancedStats?.unitStats?.reduce((sum, unit) => sum + (unit.healingDone || 0), 0) || 0,
    totalKills:
      enhancedStats?.unitStats?.reduce((sum, unit) => sum + (unit.kills || 0), 0) || 0,
    turnCount: enhancedStats?.battleSummary?.totalTurns || stats?.totalTurns || 0
  };
  const isForfeit = [
    'surrender',
    'timeout_forfeit',
    'disconnect_forfeit'
  ].includes(reason);

  const transactionResult = await withTransaction(async client => {
    const lockedBattle = await battleStateRepository.loadBattle(battleId, {
      client,
      forUpdate: true
    });
    const existingResult = await client.query(
      `SELECT id, queue_type, winner_user_id, loser_user_id,
              winner_rating_change, loser_rating_change
       FROM coliseum_matches
       WHERE battle_id = $1
       LIMIT 1`,
      [battleId]
    );
    if (existingResult.rows.length > 0) {
      const commandReceipt = battleCommand
        ? await battleStateRepository.findCommandReceipt({
          battleId,
          commandType: battleCommand.commandType,
          idempotencyKey: battleCommand.idempotencyKey,
          idempotencyRequest: battleCommand.idempotencyRequest
        }, { client })
        : null;
      if (battleCommand && !commandReceipt) {
        const error = new Error(
          `Battle ${battleId} completed without the requested command receipt`
        );
        error.code = 'BATTLE_STATE_CONFLICT';
        error.actualRevision = lockedBattle.stateRevision;
        throw error;
      }
      return {
        idempotent: true,
        commit: commandReceipt,
        matchResult: existingResult.rows[0]
      };
    }
    if (lockedBattle.status !== 'active') {
      const error = new Error(
        `Battle ${battleId} is already ${lockedBattle.status} with winner ${lockedBattle.winnerId}`
      );
      error.code = 'COLISEUM_BATTLE_ALREADY_TERMINAL';
      throw error;
    }
    if (expectedRevision !== null
      && lockedBattle.stateRevision !== expectedRevision) {
      const error = new Error(
        `Battle ${battleId} revision ${lockedBattle.stateRevision} does not match ${expectedRevision}`
      );
      error.code = 'BATTLE_STATE_CONFLICT';
      error.expectedRevision = expectedRevision;
      error.actualRevision = lockedBattle.stateRevision;
      throw error;
    }

    const orderedUserIds = [winnerId, loserId]
      .sort((left, right) => Number(left) - Number(right));
    for (const userId of orderedUserIds) {
      await ensureRating(userId, queueType, { client });
    }
    const ratingsByUser = new Map();
    for (const userId of orderedUserIds) {
      ratingsByUser.set(
        String(userId),
        await getPlayerRating(userId, queueType, {
          client,
          forUpdate: true
        })
      );
    }
    const winnerCurrentRating =
      ratingsByUser.get(String(winnerId))?.rating ?? 1000;
    const loserCurrentRating =
      ratingsByUser.get(String(loserId))?.rating ?? 1000;
    const ratingChange = calculateRatingChange(
      winnerCurrentRating,
      loserCurrentRating,
      winnerPPR,
      loserPPR
    );
    if (isForfeit && applyPenalty) {
      ratingChange.loserLoss = applyForfeitPenalty(ratingChange.loserLoss);
    }

    const ratingCommands = [
      {
        userId: winnerId,
        change: ratingChange.winnerGain,
        isWin: true
      },
      {
        userId: loserId,
        change: -ratingChange.loserLoss,
        isWin: false
      }
    ].sort((left, right) => Number(left.userId) - Number(right.userId));
    const updatedRatings = new Map();
    for (const command of ratingCommands) {
      updatedRatings.set(
        String(command.userId),
        await updatePvpRating(
          command.userId,
          queueType,
          command.change,
          command.isWin,
          { client }
        )
      );
    }

    const commit = await battleStateRepository.completeBattle({
      battleId,
      expectedRevision: lockedBattle.stateRevision,
      commandType: 'coliseum_match_complete',
      idempotencyKey: `coliseum-match-complete:${battleId}`,
      ...(battleCommand ?? {}),
      mutableState: finalState
        ? extractBattleMutableState(finalState)
        : lockedBattle.mutableState,
      status: 'victory',
      winnerId
    }, { client });
    if (commit.idempotent) {
      const error = new Error(
        `Battle ${battleId} has a terminal command without a Coliseum result`
      );
      error.code = 'COLISEUM_INCOMPLETE_TERMINAL_TRANSACTION';
      throw error;
    }

    if (consumedInventoryId !== null && consumedInventoryId !== undefined) {
      if (actingUserId === null || actingUserId === undefined) {
        throw new TypeError('actingUserId is required when consuming an item');
      }
      const inventoryResult = await client.query(
        `SELECT quantity
         FROM character_items
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [consumedInventoryId, actingUserId]
      );
      if (inventoryResult.rows.length === 0
        || inventoryResult.rows[0].quantity < 1) {
        const error = new Error('Consumable inventory changed - please retry');
        error.code = 'BATTLE_CONSUMABLE_CONFLICT';
        throw error;
      }
      if (inventoryResult.rows[0].quantity > 1) {
        await client.query(
          'UPDATE character_items SET quantity = quantity - 1 WHERE id = $1',
          [consumedInventoryId]
        );
      } else {
        await client.query(
          'DELETE FROM character_items WHERE id = $1',
          [consumedInventoryId]
        );
      }
    }

    await client.query(
      `INSERT INTO coliseum_matches
         (battle_id, queue_type, winner_user_id, loser_user_id,
          winner_rating_change, loser_rating_change,
          match_duration_seconds, match_snapshot, match_stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        battleId,
        queueType,
        winnerId,
        loserId,
        ratingChange.winnerGain,
        -ratingChange.loserLoss,
        stats?.duration || 0,
        JSON.stringify(snapshot),
        JSON.stringify(enhancedStatsToStore)
      ]
    );
    const battleCharacterIds = [
      ...new Set(
        commit.envelope.mutableState.units
          .filter(unit => unit.type === 'player'
            && participantIds.has(String(unit.ownerId)))
          .map(unit => Number(unit.id))
          .filter(Number.isSafeInteger)
      )
    ];
    const releaseResult = await client.query(
      `UPDATE characters
       SET in_battle = false
       WHERE id = ANY($1::int[]) AND user_id = ANY($2::int[])`,
      [battleCharacterIds, [winnerId, loserId]]
    );
    if (releaseResult.rowCount !== battleCharacterIds.length) {
      const error = new Error(
        `Coliseum cleanup released ${releaseResult.rowCount} `
        + `of ${battleCharacterIds.length} battle characters`
      );
      error.code = 'COLISEUM_PARTICIPANT_CLEANUP_CONFLICT';
      throw error;
    }
    const winnerCharacterResult = await client.query(
      `SELECT id
       FROM characters
       WHERE user_id = $1 AND party_slot = 1
       LIMIT 1`,
      [winnerId]
    );
    const winnerCharacterId = winnerCharacterResult.rows[0]?.id;
    if (!winnerCharacterId) {
      throw new Error(
        `Cannot enqueue terminal progression for Coliseum battle ${battleId}: `
        + `winner ${winnerId} has no party leader`
      );
    }
    await battleTerminalOutbox.enqueue(client, {
      battleId,
      eventType: BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
      payload: buildColiseumTerminalProgressionPayload({
        winnerCharacterId,
        queueType
      })
    });
    await battleTerminalOutbox.enqueue(client, {
      battleId,
      eventType: BATTLE_TERMINAL_COLISEUM_BADGES_EVENT_TYPE,
      payload: buildColiseumBadgePayload({
        winnerId,
        winnerRating: winnerCurrentRating,
        loserRating: loserCurrentRating,
        winnerPPR,
        loserPPR,
        winnerNewRating: updatedRatings.get(String(winnerId)).rating,
        finalState: commit.envelope.state
      })
    });

    return {
      idempotent: false,
      commit,
      ratingChange,
      winnerCurrentRating,
      loserCurrentRating,
      winnerRating: updatedRatings.get(String(winnerId)),
      loserRating: updatedRatings.get(String(loserId))
    };
  });

  if (transactionResult.idempotent) return transactionResult;

  const {
    commit,
    ratingChange,
    winnerCurrentRating,
    loserCurrentRating,
    winnerRating,
    loserRating
  } = transactionResult;
  const winnerNewRating = winnerRating.rating;
  const loserNewRating = loserRating.rating;
  const winnerOldTier = getTier(winnerCurrentRating);
  const loserOldTier = getTier(loserCurrentRating);
  const winnerNewTier = getTier(winnerNewRating);
  const loserNewTier = getTier(loserNewRating);
  const [winnerNewRank, loserNewRank] = await Promise.all([
    getPlayerRank(winnerId, queueType),
    getPlayerRank(loserId, queueType)
  ]);

  activeMatches.forEach((candidate, matchId) => {
    if (candidate.battleId === battleId) activeMatches.delete(matchId);
  });
  cancelTurnTimer(battleId);

  const player1Id = commit.envelope.player1Id ?? winnerId;
  const player2Id = commit.envelope.player2Id ?? loserId;
  const pvpInfo = {
    player1Id,
    player2Id,
    winningTeamId: String(winnerId) === String(player1Id) ? 1 : 2
  };
  if (publish) {
    await battleWebsocket.broadcastStateUpdate(battleId, commit.update);
    const battleStatus = reason === 'surrender' ? 'surrender' : 'victory';
    await battleWebsocket.broadcastBattleEnd(
      battleId,
      battleStatus,
      null,
      pvpInfo
    );
  }

  const resultPayload = {
    battleId,
    winnerId,
    loserId,
    reason,
    winnerRatingChange: ratingChange.winnerGain,
    loserRatingChange: -ratingChange.loserLoss,
    winnerNewRating,
    loserNewRating
  };
  const presentationEvents = [
    {
      userId: winnerId,
      message: {
        type: 'coliseum:match_result',
        payload: {
          ...resultPayload,
          isWinner: true,
          unitStats: enhancedStats?.unitStats || null,
          battleSummary: enhancedStats?.battleSummary || null,
          pvpResult: {
            oldRating: winnerCurrentRating,
            newRating: winnerNewRating,
            ratingChange: ratingChange.winnerGain,
            oldTier: winnerOldTier.name,
            newTier: winnerNewTier.name,
            tierChanged: winnerOldTier.name !== winnerNewTier.name,
            oldRank: winnerOldRank?.rank ?? null,
            newRank: winnerNewRank?.rank ?? null,
            pointsToNextTier:
              getNextTierProgress(winnerNewRating)?.pointsNeeded ?? null,
            surrenderPenalty: false
          }
        }
      }
    },
    {
      userId: loserId,
      message: {
        type: 'coliseum:match_result',
        payload: {
          ...resultPayload,
          isWinner: false,
          unitStats: enhancedStats?.unitStats || null,
          battleSummary: enhancedStats?.battleSummary || null,
          pvpResult: {
            oldRating: loserCurrentRating,
            newRating: loserNewRating,
            ratingChange: -ratingChange.loserLoss,
            oldTier: loserOldTier.name,
            newTier: loserNewTier.name,
            tierChanged: loserOldTier.name !== loserNewTier.name,
            oldRank: loserOldRank?.rank ?? null,
            newRank: loserNewRank?.rank ?? null,
            pointsToNextTier:
              getNextTierProgress(loserNewRating)?.pointsNeeded ?? null,
            surrenderPenalty: isForfeit && applyPenalty
          }
        }
      }
    }
  ];
  if (publish) {
    await publishColiseumMatchResultEvents(presentationEvents);
  }

  console.log(
    `[Coliseum] Match completed: Battle ${battleId}, Winner: ${winnerId} `
    + `(+${ratingChange.winnerGain}), Loser: ${loserId} `
    + `(-${ratingChange.loserLoss}), Reason: ${reason}`
  );
  return {
    ...transactionResult,
    pvpInfo,
    queueType,
    winnerNewRank,
    loserNewRank,
    presentationEvents
  };
}

/**
 * Publish non-authoritative Coliseum result panels after the caller has
 * emitted the authoritative state revision and terminal lifecycle event.
 */
export async function publishColiseumMatchResultEvents(events) {
  if (!Array.isArray(events)) {
    throw new TypeError('Coliseum presentation events must be an array');
  }
  if (events.length === 0) return;

  const ws = await getWebsocket();
  for (const event of events) {
    const userId = Number(event?.userId);
    if (!event
      || !Number.isSafeInteger(userId)
      || userId < 1
      || !event.message
      || typeof event.message !== 'object') {
      throw new TypeError('Invalid Coliseum presentation event');
    }
    ws.sendToUser(userId, event.message);
  }
}
