/**
 * Coliseum Service - Handles PvP matchmaking, turn timers, and match completion
 */

import { query, pool } from '../config/database.js';
import * as battleService from './battleService.js';
import * as dailyQuestService from './dailyQuestService.js';
import * as battleWebsocket from './battleWebsocket.js';
import { MAX_BATTLE_PARTY_SIZE } from '../config/constants.js';
import { calculateBattlePartyPower } from './characterValuationService.js';
import {
  calculateRatingChange,
  updatePvpRating,
  getPlayerRating,
  ensureRating,
  applyForfeitPenalty,
  checkAndUseWeeklyGrace,
  recordDisconnect as recordDisconnectEvent,
  forgiveDisconnect
} from './ratingService.js';
import { getTier } from '../../../shared/coliseum.js';

// PvP Turn Timer Constants
const PVP_TURN_TIMEOUT = 60000;          // 60 seconds per turn
const DISCONNECT_FORFEIT_TIME = 300000;  // 5 minutes to reconnect
const MAX_TURN_TIMEOUTS = 3;             // 3 timeouts = forfeit

// PPR Matchmaking Constants
const INITIAL_PPR_RANGE = 0.15;          // Initial +/- 15% PPR range
const PPR_RANGE_EXPANSION = 0.05;        // Expand by 5% every 30 seconds
const PPR_EXPANSION_INTERVAL = 30000;    // 30 seconds

// Turn timer tracking: battleId -> { timerId, startTime }
const turnTimers = new Map();

// Turn timeout counts: battleId -> { [playerId]: count }
const turnTimeoutCounts = new Map();

// Disconnect tracking: battleId -> { [playerId]: { disconnectTime, timerId } }
const disconnectTracking = new Map();

// Lazy-load websocket to avoid circular dependency
// websocket/index.js imports this file, so we can't destructure at top level
let _websocket = null;
async function getWebsocket() {
  if (!_websocket) {
    _websocket = await import('../websocket/index.js');
  }
  return _websocket;
}

// Matchmaking queue: Map of queueType -> Array of { userId, username, partyLevel, partySize, ppr, queuedAt }
const matchmakingQueues = new Map();

// Active matches: matchId -> { player1, player2, status, createdAt }
const activeMatches = new Map();

// Match ready check timers: matchId -> timerId (for the 31s ready timeout)
const matchReadyTimers = new Map();

// Match start timers: matchId -> timerId (for the 3s start delay)
const matchStartTimers = new Map();

// Queue settings by type
const QUEUE_SETTINGS = {
  '1v1': { minPlayers: 2, maxPlayers: 2, partySize: 1 },
  '3v3': { minPlayers: 2, maxPlayers: 2, partySize: 3 },
  '5v5': { minPlayers: 2, maxPlayers: 2, partySize: 5 }
};

// Match ID counter
let matchIdCounter = 1;

/**
 * Add a player to the matchmaking queue
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {number} partyLevel - Average party level
 * @param {number} partySize - Number of characters in battle party
 * @returns {Promise<Object>} Queue status
 */
async function joinQueue(queueType, userId, username, partyLevel, partySize) {
  const settings = QUEUE_SETTINGS[queueType];
  if (!settings) {
    return { success: false, error: 'Invalid queue type' };
  }

  // Validate party size
  if (partySize > settings.partySize) {
    return { success: false, error: `Maximum ${settings.partySize} characters allowed for ${queueType}` };
  }

  // Initialize queue if needed
  if (!matchmakingQueues.has(queueType)) {
    matchmakingQueues.set(queueType, []);
  }

  const queue = matchmakingQueues.get(queueType);

  // Check if already in queue
  const existingIndex = queue.findIndex(p => p.userId === userId);
  if (existingIndex >= 0) {
    return {
      success: true,
      position: existingIndex + 1,
      estimatedWait: calculateEstimatedWait(queue.length, existingIndex),
      ppr: queue[existingIndex].ppr,
      alreadyInQueue: true
    };
  }

  // Calculate Player Power Rating for matchmaking
  const ppr = await calculateBattlePartyPower(userId);

  // Ensure the player has a rating record
  await ensureRating(userId, queueType);

  // Add to queue with PPR
  const queueEntry = {
    userId,
    username,
    partyLevel,
    partySize,
    ppr,
    queuedAt: Date.now()
  };

  queue.push(queueEntry);

  // Join coliseum room for updates (async, fire and forget)
  getWebsocket().then(ws => {
    const roomName = `coliseum:${queueType}`;
    const { rooms } = ws;
    if (!rooms.has(roomName)) {
      rooms.set(roomName, new Set());
    }
    rooms.get(roomName).add(userId);

    // Send queue update to player
    ws.sendToUser(userId, {
      type: 'coliseum:queue_joined',
      payload: {
        queueType,
        position: queue.length,
        estimatedWait: calculateEstimatedWait(queue.length, queue.length - 1),
        queueSize: queue.length,
        ppr
      }
    });
  }).catch(err => console.error('Failed to join coliseum room:', err));

  // Try to create a match (now async due to PPR-based matching)
  const matchResult = await tryMatchmaking(queueType);

  // Broadcast global queue status to lobby (fire and forget)
  broadcastGlobalQueueStatus();

  // Broadcast queue players update to all in queue
  broadcastQueuePlayersUpdate(queueType).catch(err =>
    console.error('Failed to broadcast queue players update:', err)
  );

  return {
    success: true,
    position: queue.length,
    estimatedWait: calculateEstimatedWait(queue.length, queue.length - 1),
    queueSize: queue.length,
    ppr,
    matchFound: matchResult.matched
  };
}

/**
 * Remove a player from the matchmaking queue
 * @param {string} queueType - Queue type or null for all queues
 * @param {number} userId - User ID
 * @returns {boolean} Success
 */
function leaveQueue(queueType, userId) {
  if (queueType) {
    return removeFromQueue(queueType, userId);
  }

  // Remove from all queues
  let removed = false;
  matchmakingQueues.forEach((queue, type) => {
    if (removeFromQueue(type, userId)) {
      removed = true;
    }
  });

  return removed;
}

/**
 * Remove a player from a specific queue
 */
function removeFromQueue(queueType, userId) {
  const queue = matchmakingQueues.get(queueType);
  if (!queue) return false;

  const index = queue.findIndex(p => p.userId === userId);
  if (index >= 0) {
    queue.splice(index, 1);

    // Broadcast global queue status to lobby (fire and forget)
    broadcastGlobalQueueStatus();

    // Broadcast queue players update to remaining players
    broadcastQueuePlayersUpdate(queueType).catch(err =>
      console.error('Failed to broadcast queue players update:', err)
    );

    // Leave coliseum room (async, fire and forget)
    getWebsocket().then(ws => {
      const roomName = `coliseum:${queueType}`;
      const { rooms } = ws;
      if (rooms.has(roomName)) {
        rooms.get(roomName).delete(userId);
      }

      // Send confirmation
      ws.sendToUser(userId, {
        type: 'coliseum:queue_left',
        payload: { queueType }
      });

      // Notify others of queue size change
      broadcastQueueUpdate(queueType);
    }).catch(err => console.error('Failed to leave coliseum room:', err));

    return true;
  }

  return false;
}

/**
 * Check if two players are matchable based on PPR
 * @param {Object} player1 - First player queue entry
 * @param {Object} player2 - Second player queue entry
 * @returns {boolean} True if players can be matched
 */
function arePlayersMatchable(player1, player2) {
  const now = Date.now();

  // Calculate expanded PPR range based on wait time
  // Start at 15%, expand by 5% every 30 seconds
  const getExpandedRange = (queuedAt) => {
    const waitTime = now - queuedAt;
    const expansions = Math.floor(waitTime / PPR_EXPANSION_INTERVAL);
    return INITIAL_PPR_RANGE + (expansions * PPR_RANGE_EXPANSION);
  };

  const p1Range = getExpandedRange(player1.queuedAt);
  const p2Range = getExpandedRange(player2.queuedAt);

  // Use the more generous range (longer wait time = wider range)
  const effectiveRange = Math.max(p1Range, p2Range);

  // Check if PPRs are within range of each other
  const pprDiff = Math.abs(player1.ppr - player2.ppr);
  const avgPPR = (player1.ppr + player2.ppr) / 2;
  const maxDiff = avgPPR * effectiveRange;

  return pprDiff <= maxDiff;
}

/**
 * Try to create a match from queued players
 * Uses PPR-based matchmaking with expanding range over time
 * @param {string} queueType - Queue type
 * @returns {Promise<Object>} Match result
 */
async function tryMatchmaking(queueType) {
  const settings = QUEUE_SETTINGS[queueType];
  const queue = matchmakingQueues.get(queueType);

  if (!queue || queue.length < settings.minPlayers) {
    return { matched: false };
  }

  // Sort queue by wait time (longest waiting first)
  queue.sort((a, b) => a.queuedAt - b.queuedAt);

  // Try to find a match for the longest-waiting player
  let player1 = null;
  let player2 = null;
  let player1Index = -1;
  let player2Index = -1;

  // Find first matchable pair
  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      if (arePlayersMatchable(queue[i], queue[j])) {
        player1 = queue[i];
        player2 = queue[j];
        player1Index = i;
        player2Index = j;
        break;
      }
    }
    if (player1 && player2) break;
  }

  if (!player1 || !player2) {
    return { matched: false };
  }

  // Remove matched players from queue (remove higher index first to preserve indices)
  queue.splice(player2Index, 1);
  queue.splice(player1Index, 1);

  // Create match with PPR info
  const matchId = matchIdCounter++;
  const match = {
    id: matchId,
    queueType,
    player1: {
      userId: player1.userId,
      username: player1.username,
      partyLevel: player1.partyLevel,
      ppr: player1.ppr,
      ready: false
    },
    player2: {
      userId: player2.userId,
      username: player2.username,
      partyLevel: player2.partyLevel,
      ppr: player2.ppr,
      ready: false
    },
    status: 'pending',
    createdAt: Date.now(),
    readyDeadline: Date.now() + 30000 // 30 seconds to ready up
  };

  activeMatches.set(matchId, match);

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
            ppr: player2.ppr
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
            ppr: player1.ppr
          }
        }
      }));
    }

    // Update queue for remaining players
    broadcastQueueUpdate(queueType);
  }).catch(err => console.error('Failed to notify match found:', err));

  // Set timeout for ready check (tracked for test cleanup)
  const readyTimerId = setTimeout(() => checkMatchReady(matchId), 31000);
  matchReadyTimers.set(matchId, readyTimerId);

  return { matched: true, matchId };
}

/**
 * Player ready confirmation
 * @param {number} matchId - Match ID
 * @param {number} userId - User ID
 * @returns {Object} Result
 */
function playerReady(matchId, userId) {
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

    // Notify both players match is ready to start (async)
    getWebsocket().then(ws => {
      const readyPayload = {
        matchId,
        status: 'ready',
        startIn: 3000 // 3 second countdown
      };

      ws.sendToUser(match.player1.userId, {
        type: 'coliseum:match_ready',
        payload: readyPayload
      });

      ws.sendToUser(match.player2.userId, {
        type: 'coliseum:match_ready',
        payload: readyPayload
      });
    }).catch(err => console.error('Failed to notify match ready:', err));

    // Schedule match start (tracked for test cleanup)
    const startTimerId = setTimeout(() => startMatch(matchId), 3000);
    matchStartTimers.set(matchId, startTimerId);
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
 * Check if match is ready (called after timeout)
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
 * Start the match (create PvP battle)
 */
async function startMatch(matchId) {
  // Clean up timers for this match
  matchReadyTimers.delete(matchId);
  matchStartTimers.delete(matchId);

  const match = activeMatches.get(matchId);
  if (!match || match.status !== 'ready') return;

  match.status = 'starting';

  try {
    // Get battle party characters for both players
    const [player1Party, player2Party] = await Promise.all([
      getPlayerBattleParty(match.player1.userId),
      getPlayerBattleParty(match.player2.userId)
    ]);

    // Validate battle party data
    if (!player1Party || player1Party.length === 0) {
      console.error('Player 1 battle party is empty or undefined:', match.player1.userId);
      cancelMatch(matchId, 'Battle party data unavailable');
      return;
    }
    if (!player2Party || player2Party.length === 0) {
      console.error('Player 2 battle party is empty or undefined:', match.player2.userId);
      cancelMatch(matchId, 'Battle party data unavailable');
      return;
    }

    // Generate map seed
    const mapSeed = Math.floor(Math.random() * 2147483647);

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
    player1Party.forEach((char, idx) => {
      initialState.units.push({
        id: char.id,
        type: 'player',
        teamId: 1, // Player 1's units are on team 1
        ownerId: match.player1.userId,
        name: char.name,
        class: char.class,
        level: char.level,
        hp: char.hp_current,
        maxHp: char.hp_max + (parseInt(char.equip_hp, 10) || 0),
        mp: char.mp_current,
        maxMp: char.mp_max + (parseInt(char.equip_mp, 10) || 0),
        strength: char.strength + (parseInt(char.equip_strength, 10) || 0),
        intelligence: char.intelligence + (parseInt(char.equip_intelligence, 10) || 0),
        agility: char.agility + (parseInt(char.equip_agility, 10) || 0),
        vitality: char.vitality + (parseInt(char.equip_vitality, 10) || 0),
        luck: char.luck + (parseInt(char.equip_luck, 10) || 0),
        attack: parseInt(char.equip_attack, 10) || 0,
        defense: parseInt(char.equip_defense, 10) || 0,
        magicAttack: parseInt(char.equip_magic_attack, 10) || 0,
        magicDefense: parseInt(char.equip_magic_defense, 10) || 0,
        tileX: 4 + (idx % 3) * 2,
        tileY: 26 - Math.floor(idx / 3) * 2,  // Bottom side
        ct: 0,
        hasActed: false,
        statusEffects: [],
        skills: char.skills || []
      });
    });

    // Add player 2's units (top side of map) - Team 2
    player2Party.forEach((char, idx) => {
      initialState.units.push({
        id: char.id,
        type: 'player',
        teamId: 2, // Player 2's units are on team 2
        ownerId: match.player2.userId,
        name: char.name,
        class: char.class,
        level: char.level,
        hp: char.hp_current,
        maxHp: char.hp_max + (parseInt(char.equip_hp, 10) || 0),
        mp: char.mp_current,
        maxMp: char.mp_max + (parseInt(char.equip_mp, 10) || 0),
        strength: char.strength + (parseInt(char.equip_strength, 10) || 0),
        intelligence: char.intelligence + (parseInt(char.equip_intelligence, 10) || 0),
        agility: char.agility + (parseInt(char.equip_agility, 10) || 0),
        vitality: char.vitality + (parseInt(char.equip_vitality, 10) || 0),
        luck: char.luck + (parseInt(char.equip_luck, 10) || 0),
        attack: parseInt(char.equip_attack, 10) || 0,
        defense: parseInt(char.equip_defense, 10) || 0,
        magicAttack: parseInt(char.equip_magic_attack, 10) || 0,
        magicDefense: parseInt(char.equip_magic_defense, 10) || 0,
        tileX: 4 + (idx % 3) * 2,
        tileY: 5 + Math.floor(idx / 3) * 2,  // Top side
        ct: 0,
        hasActed: false,
        statusEffects: [],
        skills: char.skills || []
      });
    });

    // Initialize CT values for all units
    battleService.initializeCT(initialState.units);

    // Advance CT and find the first actor
    battleService.advanceToNextActor(initialState);

    // Generate turn predictions
    initialState.turnPredictions = battleService.predictTurnOrder(initialState, 10);

    // Create battle record in database
    const battleResult = await query(
      `INSERT INTO battles (battle_type, status, battle_state, map_seed, map_width, map_height, player1_id, player2_id)
       VALUES ('pvp_coliseum', 'active', $1, $2, 32, 32, $3, $4)
       RETURNING id`,
      [JSON.stringify(initialState), mapSeed, match.player1.userId, match.player2.userId]
    );

    const battleId = battleResult.rows[0].id;

    // Mark characters as in battle for both players
    await Promise.all([
      query(
        `UPDATE characters SET in_battle = true
         WHERE user_id = $1 AND party_slot <= $2 AND party_slot IS NOT NULL`,
        [match.player1.userId, MAX_BATTLE_PARTY_SIZE]
      ),
      query(
        `UPDATE characters SET in_battle = true
         WHERE user_id = $1 AND party_slot <= $2 AND party_slot IS NOT NULL`,
        [match.player2.userId, MAX_BATTLE_PARTY_SIZE]
      )
    ]);

    // Join both players to battle WebSocket room
    await battleWebsocket.joinBattle(battleId, match.player1.userId);
    await battleWebsocket.joinBattle(battleId, match.player2.userId);

    match.status = 'started';
    match.battleId = battleId;

    // Notify both players with battle info
    const ws = await getWebsocket();
    const battlePayload = {
      matchId,
      status: 'started',
      battleType: 'pvp',
      battleId,
      mapSeed
    };

    ws.sendToUser(match.player1.userId, {
      type: 'coliseum:match_started',
      payload: {
        ...battlePayload,
        opponentUsername: match.player2.username
      }
    });

    ws.sendToUser(match.player2.userId, {
      type: 'coliseum:match_started',
      payload: {
        ...battlePayload,
        opponentUsername: match.player1.username
      }
    });

    console.log(`PvP Battle ${battleId} started: ${match.player1.username} vs ${match.player2.username}`);

  } catch (error) {
    console.error('Failed to create PvP battle:', {
      matchId,
      player1: match.player1.userId,
      player2: match.player2.userId,
      error: error.message,
      stack: error.stack
    });
    cancelMatch(matchId, 'Error creating battle');
  }
}

/**
 * Get a player's battle party characters with stats and equipment
 * Uses LATERAL JOIN to properly extract equipment bonuses from stat_bonuses JSON field
 */
async function getPlayerBattleParty(userId) {
  const result = await query(
    `SELECT c.id, c.name, c.class, c.level,
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
     WHERE c.user_id = $1 AND c.party_slot IS NOT NULL AND c.party_slot <= $2
     ORDER BY c.party_slot`,
    [userId, MAX_BATTLE_PARTY_SIZE]
  );

  // Get skills for each character
  const characters = result.rows;
  for (const char of characters) {
    const skillsResult = await query(
      'SELECT skill_id, level FROM character_skills WHERE character_id = $1',
      [char.id]
    );
    char.skills = skillsResult.rows.map(s => ({ id: s.skill_id, level: s.level }));
  }

  return characters;
}

/**
 * Cancel a match and notify players
 */
async function cancelMatch(matchId, reason) {
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

  activeMatches.delete(matchId);
}

/**
 * Calculate estimated wait time
 */
function calculateEstimatedWait(queueSize, position) {
  // Average match time ~5 minutes, so estimate based on position
  const averageMatchTime = 300; // 5 minutes in seconds
  return Math.ceil(position / 2) * averageMatchTime;
}

/**
 * Broadcast queue update to all waiting players
 */
async function broadcastQueueUpdate(queueType) {
  const queue = matchmakingQueues.get(queueType) || [];

  const ws = await getWebsocket();

  // Send position updates to each player
  queue.forEach((player, index) => {
    ws.sendToUser(player.userId, {
      type: 'coliseum:queue_update',
      payload: {
        queueType,
        position: index + 1,
        queueSize: queue.length,
        estimatedWait: calculateEstimatedWait(queue.length, index)
      }
    });
  });
}

/**
 * Broadcast queue sizes to all players in coliseum lobby
 */
async function broadcastGlobalQueueStatus() {
  const ws = await getWebsocket();
  const statuses = getAllQueueStatuses();

  // Broadcast to coliseum:lobby room
  ws.broadcastToRoom('coliseum:lobby', {
    type: 'coliseum:queue_stats_update',
    payload: { queues: statuses }
  });
}

/**
 * Get queue status
 * @param {string} queueType - Queue type
 * @returns {Object} Queue status
 */
function getQueueStatus(queueType) {
  const queue = matchmakingQueues.get(queueType) || [];
  return {
    queueType,
    queueSize: queue.length,
    averageWait: calculateEstimatedWait(queue.length, queue.length)
  };
}

/**
 * Get all queue statuses
 */
function getAllQueueStatuses() {
  return Object.keys(QUEUE_SETTINGS).map(type => getQueueStatus(type));
}

/**
 * Get players in a queue with their details
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @param {number|null} requestingUserId - The user requesting the list (for isCurrentUser flag)
 * @returns {Promise<Array>} Array of player objects with details
 */
async function getQueuePlayers(queueType, requestingUserId = null) {
  const queue = matchmakingQueues.get(queueType) || [];
  if (queue.length === 0) return [];

  const now = Date.now();

  // Get all user IDs in queue
  const userIds = queue.map(p => p.userId);

  // Batch fetch ratings from database
  const ratingsResult = await query(
    `SELECT user_id, rating, tier FROM pvp_ratings
     WHERE user_id = ANY($1) AND queue_type = $2`,
    [userIds, queueType]
  );

  const ratingsMap = new Map();
  for (const row of ratingsResult.rows) {
    ratingsMap.set(row.user_id, { rating: row.rating, tier: row.tier });
  }

  // Build player list with enriched data
  const players = queue.map((player, index) => {
    const ratingData = ratingsMap.get(player.userId) || { rating: 1000, tier: null };
    const tierInfo = getTier(ratingData.rating);
    const waitTimeSeconds = Math.floor((now - player.queuedAt) / 1000);

    return {
      position: index + 1,
      oduscatedId: obfuscateUserId(player.userId),
      username: player.username,
      rating: ratingData.rating,
      tier: ratingData.tier || tierInfo.name.toLowerCase(),
      tierColor: tierInfo.color,
      tierIcon: tierInfo.icon,
      partyLevel: player.partyLevel,
      waitTime: waitTimeSeconds,
      isCurrentUser: requestingUserId !== null && player.userId === requestingUserId
    };
  });

  return players;
}

/**
 * Simple obfuscation for user IDs in queue display
 * @param {number} userId - User ID
 * @returns {string} Obfuscated ID
 */
function obfuscateUserId(userId) {
  // Simple hash for display purposes (not cryptographic)
  const hash = (userId * 2654435761) >>> 0;
  return hash.toString(36).substring(0, 8);
}

/**
 * Broadcast queue players update to all players in a specific queue
 * @param {string} queueType - Queue type
 */
async function broadcastQueuePlayersUpdate(queueType) {
  const queue = matchmakingQueues.get(queueType) || [];
  if (queue.length === 0) return;

  const ws = await getWebsocket();
  const now = Date.now();

  // Get ratings for all players in batch
  const userIds = queue.map(p => p.userId);
  const ratingsResult = await query(
    `SELECT user_id, rating, tier FROM pvp_ratings
     WHERE user_id = ANY($1) AND queue_type = $2`,
    [userIds, queueType]
  );

  const ratingsMap = new Map();
  for (const row of ratingsResult.rows) {
    ratingsMap.set(row.user_id, { rating: row.rating, tier: row.tier });
  }

  // Send personalized update to each player in the queue
  for (const player of queue) {
    const players = queue.map((p, index) => {
      const ratingData = ratingsMap.get(p.userId) || { rating: 1000, tier: null };
      const tierInfo = getTier(ratingData.rating);
      const waitTimeSeconds = Math.floor((now - p.queuedAt) / 1000);

      return {
        position: index + 1,
        oduscatedId: obfuscateUserId(p.userId),
        username: p.username,
        rating: ratingData.rating,
        tier: ratingData.tier || tierInfo.name.toLowerCase(),
        tierColor: tierInfo.color,
        tierIcon: tierInfo.icon,
        partyLevel: p.partyLevel,
        waitTime: waitTimeSeconds,
        isCurrentUser: p.userId === player.userId
      };
    });

    ws.sendToUser(player.userId, {
      type: 'coliseum:queue_players_update',
      payload: {
        queueType,
        players,
        totalPlayers: players.length
      }
    });
  }
}

/**
 * Clean up player from all coliseum state (on disconnect)
 * @param {number} userId - User ID
 */
async function cleanupPlayer(userId) {
  // Remove from all queues
  leaveQueue(null, userId);

  const ws = await getWebsocket();

  // Cancel any pending matches
  activeMatches.forEach((match, matchId) => {
    if (match.player1.userId === userId || match.player2.userId === userId) {
      if (match.status === 'pending') {
        const opponentId = match.player1.userId === userId
          ? match.player2.userId
          : match.player1.userId;

        // Send match_cancelled directly
        const opponentWs = ws.connections?.get(opponentId);
        if (opponentWs && opponentWs.readyState === 1) {
          opponentWs.send(JSON.stringify({
            type: 'coliseum:match_cancelled',
            payload: { matchId, reason: 'Opponent disconnected' }
          }));
        }

        // Re-queue opponent (preserve PPR)
        const queue = matchmakingQueues.get(match.queueType) || [];
        const opponent = match.player1.userId === userId ? match.player2 : match.player1;
        queue.unshift({
          userId: opponent.userId,
          username: opponent.username,
          partyLevel: opponent.partyLevel,
          ppr: opponent.ppr,
          queuedAt: Date.now()
        });

        activeMatches.delete(matchId);
      } else if (match.status === 'started' && match.battleId) {
        // Handle disconnect during active battle
        handlePlayerDisconnect(match.battleId, userId);
      }
    }
  });
}

// =============================================================================
// TURN TIMER SYSTEM
// =============================================================================

/**
 * Start the turn timer for a PvP battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Current player's user ID
 */
function startTurnTimer(battleId, playerId) {
  // Cancel any existing timer
  cancelTurnTimer(battleId);

  const timerId = setTimeout(() => {
    handleTurnTimeout(battleId, playerId);
  }, PVP_TURN_TIMEOUT);

  turnTimers.set(battleId, {
    timerId,
    startTime: Date.now(),
    playerId
  });

  // Initialize timeout counts if needed
  if (!turnTimeoutCounts.has(battleId)) {
    turnTimeoutCounts.set(battleId, {});
  }

  // Broadcast timer started
  getWebsocket().then(ws => {
    ws.broadcastToRoom(`battle:${battleId}`, {
      type: 'battle:turn_timer_started',
      payload: {
        battleId,
        playerId,
        timeout: PVP_TURN_TIMEOUT,
        startTime: Date.now()
      }
    });
  }).catch(err => console.error('Failed to broadcast turn timer:', err));
}

/**
 * Cancel the turn timer for a battle
 * @param {number} battleId - Battle ID
 */
function cancelTurnTimer(battleId) {
  const timer = turnTimers.get(battleId);
  if (timer) {
    clearTimeout(timer.timerId);
    turnTimers.delete(battleId);
  }
}

/**
 * Handle turn timeout (player didn't act in time)
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who timed out
 */
async function handleTurnTimeout(battleId, playerId) {
  const counts = turnTimeoutCounts.get(battleId) || {};
  counts[playerId] = (counts[playerId] || 0) + 1;
  turnTimeoutCounts.set(battleId, counts);

  const timeoutsRemaining = MAX_TURN_TIMEOUTS - counts[playerId];

  if (counts[playerId] >= MAX_TURN_TIMEOUTS) {
    // Third timeout = forfeit
    console.log(`[Coliseum] Player ${playerId} forfeited battle ${battleId} due to timeout`);
    await endMatchByForfeit(battleId, playerId, 'timeout_forfeit');
  } else {
    // Skip turn and notify
    console.log(`[Coliseum] Skipping turn for player ${playerId} in battle ${battleId} (${timeoutsRemaining} remaining)`);

    // Skip the turn by ending it
    await skipPlayerTurn(battleId, playerId);

    // Notify players
    const ws = await getWebsocket();
    ws.broadcastToRoom(`battle:${battleId}`, {
      type: 'battle:turn_skipped',
      payload: {
        battleId,
        playerId,
        timeoutsRemaining,
        reason: 'timeout'
      }
    });
  }
}

/**
 * Skip a player's turn (used for timeout)
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player whose turn to skip
 */
async function skipPlayerTurn(battleId, playerId) {
  // Get battle state and advance to next actor
  const result = await query(
    'SELECT battle_state FROM battles WHERE id = $1',
    [battleId]
  );

  if (result.rows.length === 0) return;

  const state = result.rows[0].battle_state;
  const activeUnit = state.units.find(u => u.id === state.activeUnitId);

  if (activeUnit && activeUnit.ownerId === playerId) {
    // End this unit's turn
    battleService.advanceToNextActorWithCT(state);

    // Save updated state
    await query(
      'UPDATE battles SET battle_state = $1 WHERE id = $2',
      [JSON.stringify(state), battleId]
    );

    // Broadcast turn advanced
    const _ws = await getWebsocket();
    const nextUnit = state.units.find(u => u.id === state.activeUnitId);
    if (nextUnit) {
      battleWebsocket.broadcastTurnStart(battleId, {
        id: nextUnit.id,
        name: nextUnit.name,
        position: { x: nextUnit.tileX, y: nextUnit.tileY }
      }, nextUnit.type, battleService.predictTurnOrder(state, 10));

      // Start new turn timer if it's a player's turn
      if (nextUnit.type === 'player' && nextUnit.ownerId) {
        startTurnTimer(battleId, nextUnit.ownerId);
      }
    }
  }
}

/**
 * Handle player disconnect during battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who disconnected
 */
function handlePlayerDisconnect(battleId, playerId) {
  // Cancel turn timer
  cancelTurnTimer(battleId);

  // Record disconnect
  recordDisconnectEvent(playerId, null).then(disconnect => {
    // Initialize disconnect tracking
    if (!disconnectTracking.has(battleId)) {
      disconnectTracking.set(battleId, {});
    }

    const tracking = disconnectTracking.get(battleId);

    // Set forfeit timer
    const timerId = setTimeout(async () => {
      if (tracking[playerId] && !tracking[playerId].reconnected) {
        // Check if they can use weekly grace
        const usedGrace = await checkAndUseWeeklyGrace(playerId);
        if (usedGrace) {
          await forgiveDisconnect(disconnect.id);
        }
        await endMatchByForfeit(battleId, playerId, 'disconnect_forfeit', !usedGrace);
      }
    }, DISCONNECT_FORFEIT_TIME);

    tracking[playerId] = {
      disconnectTime: Date.now(),
      disconnectId: disconnect.id,
      timerId,
      reconnected: false
    };

    // Notify opponent
    getWebsocket().then(ws => {
      ws.broadcastToRoom(`battle:${battleId}`, {
        type: 'battle:opponent_disconnected',
        payload: {
          battleId,
          playerId,
          forfeitIn: DISCONNECT_FORFEIT_TIME
        }
      });
    }).catch(err => console.error('Failed to notify disconnect:', err));
  });
}

/**
 * Handle player reconnection during battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who reconnected
 */
function _handlePlayerReconnect(battleId, playerId) {
  const tracking = disconnectTracking.get(battleId);
  if (tracking && tracking[playerId]) {
    // Clear forfeit timer
    clearTimeout(tracking[playerId].timerId);
    tracking[playerId].reconnected = true;

    // Notify opponent
    getWebsocket().then(ws => {
      ws.broadcastToRoom(`battle:${battleId}`, {
        type: 'battle:opponent_reconnected',
        payload: { battleId, playerId }
      });
    }).catch(err => console.error('Failed to notify reconnect:', err));

    // Restart turn timer if it's this player's turn
    query(
      'SELECT battle_state FROM battles WHERE id = $1',
      [battleId]
    ).then(result => {
      if (result.rows.length > 0) {
        const state = result.rows[0].battle_state;
        const activeUnit = state.units.find(u => u.id === state.activeUnitId);
        if (activeUnit && activeUnit.ownerId === playerId) {
          startTurnTimer(battleId, playerId);
        }
      }
    });
  }
}

/**
 * End match by forfeit (surrender, timeout, or disconnect)
 * @param {number} battleId - Battle ID
 * @param {number} forfeiterId - Player who forfeited
 * @param {string} reason - Reason for forfeit
 * @param {boolean} applyPenalty - Whether to apply rating penalty
 */
async function endMatchByForfeit(battleId, forfeiterId, reason, applyPenalty = true) {
  // Get battle info
  const result = await query(
    'SELECT player1_id, player2_id, battle_state FROM battles WHERE id = $1',
    [battleId]
  );

  if (result.rows.length === 0) return;

  const { player1_id, player2_id, battle_state: _battle_state } = result.rows[0];
  const winnerId = forfeiterId === player1_id ? player2_id : player1_id;
  const loserId = forfeiterId;

  // Clean up timers
  cancelTurnTimer(battleId);
  turnTimeoutCounts.delete(battleId);
  disconnectTracking.delete(battleId);

  // Complete the match with forfeit reason
  await completeMatch(battleId, winnerId, loserId, reason, applyPenalty);
}

// =============================================================================
// MATCH COMPLETION AND SNAPSHOTS
// =============================================================================

/**
 * Capture team snapshots for match history
 * @param {number} winnerId - Winner user ID
 * @param {number} loserId - Loser user ID
 * @returns {Promise<Object>} Team snapshots
 */
async function captureTeamSnapshots(winnerId, loserId) {
  const captureTeam = async (userId) => {
    const chars = await query(
      `SELECT
         c.id, c.name, c.class, c.race, c.level, c.party_slot,
         c.strength, c.vitality, c.agility, c.intelligence, c.luck,
         c.hp_current, c.hp_max, c.mp_current, c.mp_max
       FROM characters c
       WHERE c.user_id = $1 AND c.party_slot IS NOT NULL AND c.party_slot <= $2
       ORDER BY c.party_slot`,
      [userId, MAX_BATTLE_PARTY_SIZE]
    );

    // Get equipment for each character
    const team = await Promise.all(chars.rows.map(async (char) => {
      const equip = await query(
        `SELECT ci.equipped_slot, it.name, it.rarity, it.slot_type
         FROM character_items ci
         JOIN item_templates it ON ci.item_template_id = it.id
         WHERE ci.character_id = $1 AND ci.equipped_slot IS NOT NULL`,
        [char.id]
      );

      return {
        ...char,
        equipment: equip.rows
      };
    }));

    return team;
  };

  const [winnerTeam, loserTeam] = await Promise.all([
    captureTeam(winnerId),
    captureTeam(loserId)
  ]);

  return {
    winner: { userId: winnerId, team: winnerTeam },
    loser: { userId: loserId, team: loserTeam }
  };
}

/**
 * Calculate match statistics from battle state
 * @param {number} battleId - Battle ID
 * @returns {Promise<Object>} Match statistics
 */
async function calculateMatchStats(battleId) {
  const result = await query(
    'SELECT battle_state, created_at FROM battles WHERE id = $1',
    [battleId]
  );

  if (result.rows.length === 0) return null;

  const { battle_state, created_at } = result.rows[0];
  const state = battle_state;

  // Calculate stats from battle log
  const stats = {
    totalTurns: state.turn || 0,
    duration: Math.floor((Date.now() - new Date(created_at).getTime()) / 1000),
    player1: { damageDealt: 0, healingDone: 0, unitsLost: 0 },
    player2: { damageDealt: 0, healingDone: 0, unitsLost: 0 }
  };

  // Count units lost
  for (const unit of state.units) {
    if (unit.hp <= 0) {
      if (unit.ownerId === state.player1Id) {
        stats.player1.unitsLost++;
      } else if (unit.ownerId === state.player2Id) {
        stats.player2.unitsLost++;
      }
    }
  }

  // Parse battle log for damage/healing (if available)
  if (state.log) {
    for (const entry of state.log) {
      if (entry.damage) {
        // Determine which player dealt damage
        const actor = state.units.find(u => u.id === entry.actorId);
        if (actor?.ownerId === state.player1Id) {
          stats.player1.damageDealt += entry.damage;
        } else if (actor?.ownerId === state.player2Id) {
          stats.player2.damageDealt += entry.damage;
        }
      }
      if (entry.healing) {
        const actor = state.units.find(u => u.id === entry.actorId);
        if (actor?.ownerId === state.player1Id) {
          stats.player1.healingDone += entry.healing;
        } else if (actor?.ownerId === state.player2Id) {
          stats.player2.healingDone += entry.healing;
        }
      }
    }
  }

  return stats;
}

/**
 * Complete a PvP match and record results
 * @param {number} battleId - Battle ID
 * @param {number} winnerId - Winner user ID
 * @param {number} loserId - Loser user ID
 * @param {string} reason - Victory reason: 'victory', 'surrender', 'timeout_forfeit', 'disconnect_forfeit'
 * @param {boolean} applyPenalty - Whether to apply forfeit penalty (default true for forfeits)
 */
async function completeMatch(battleId, winnerId, loserId, reason = 'victory', applyPenalty = true) {
  try {
    // Get match info
    const matchResult = await query(
      `SELECT b.id, b.battle_state, b.created_at,
              am.queue_type, am.id as active_match_id
       FROM battles b
       LEFT JOIN LATERAL (
         SELECT am.id, am.queue_type
         FROM (SELECT * FROM (VALUES (1)) AS dummy) d
         CROSS JOIN LATERAL (
           SELECT id, 'coliseum_match' as queue_type FROM battles WHERE id = $1
         ) am
       ) am ON true
       WHERE b.id = $1`,
      [battleId]
    );

    if (matchResult.rows.length === 0) {
      console.error(`[Coliseum] Battle ${battleId} not found for match completion`);
      return;
    }

    // Find the match in activeMatches
    let queueType = '1v1';
    let match = null;
    activeMatches.forEach((m, _matchId) => {
      if (m.battleId === battleId) {
        match = m;
        queueType = m.queueType;
      }
    });

    // Capture team snapshots
    const snapshot = await captureTeamSnapshots(winnerId, loserId);

    // Calculate match stats
    const stats = await calculateMatchStats(battleId);

    // Get current ratings
    const [winnerRating, loserRating] = await Promise.all([
      getPlayerRating(winnerId, queueType),
      getPlayerRating(loserId, queueType)
    ]);

    // Ensure ratings exist
    await Promise.all([
      ensureRating(winnerId, queueType),
      ensureRating(loserId, queueType)
    ]);

    const winnerCurrentRating = winnerRating?.rating || 1000;
    const loserCurrentRating = loserRating?.rating || 1000;

    // Get PPR values from match or calculate
    const winnerPPR = match?.player1?.userId === winnerId
      ? match.player1.ppr
      : (match?.player2?.ppr || await calculateBattlePartyPower(winnerId));
    const loserPPR = match?.player1?.userId === loserId
      ? match.player1.ppr
      : (match?.player2?.ppr || await calculateBattlePartyPower(loserId));

    // Calculate rating changes
    const ratingChange = calculateRatingChange(
      winnerCurrentRating,
      loserCurrentRating,
      winnerPPR,
      loserPPR
    );

    // Apply forfeit penalty if applicable
    const isForfeit = reason === 'surrender' || reason === 'timeout_forfeit' || reason === 'disconnect_forfeit';
    if (isForfeit && applyPenalty) {
      ratingChange.loserLoss = applyForfeitPenalty(ratingChange.loserLoss);
    }

    // Update ratings
    await Promise.all([
      updatePvpRating(winnerId, queueType, ratingChange.winnerGain, true),
      updatePvpRating(loserId, queueType, -ratingChange.loserLoss, false)
    ]);

    // Record match in database
    await query(
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
        JSON.stringify(stats)
      ]
    );

    // Update battle status
    await query(
      'UPDATE battles SET status = \'completed\', winner_id = $2 WHERE id = $1',
      [battleId, winnerId]
    );

    // Clean up active match
    if (match) {
      activeMatches.forEach((m, matchId) => {
        if (m.battleId === battleId) {
          activeMatches.delete(matchId);
        }
      });
    }

    // Notify both players of match result
    const ws = await getWebsocket();
    const resultPayload = {
      battleId,
      winnerId,
      loserId,
      reason,
      winnerRatingChange: ratingChange.winnerGain,
      loserRatingChange: -ratingChange.loserLoss,
      winnerNewRating: winnerCurrentRating + ratingChange.winnerGain,
      loserNewRating: Math.max(0, loserCurrentRating - ratingChange.loserLoss)
    };

    ws.sendToUser(winnerId, {
      type: 'coliseum:match_result',
      payload: { ...resultPayload, isWinner: true }
    });

    ws.sendToUser(loserId, {
      type: 'coliseum:match_result',
      payload: { ...resultPayload, isWinner: false }
    });

    // Daily/Weekly quest progress hooks (fire-and-forget pattern)
    // Track coliseum win for winner
    pool.query('SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1', [winnerId])
      .then(charResult => {
        const characterId = charResult.rows[0]?.id;
        if (characterId) {
          dailyQuestService.updateProgress(characterId, 'coliseum_wins', 1, {
            queueType
          }).catch(err => console.warn('[Quest] coliseum_wins progress failed:', err.message));
        }
      })
      .catch(err => console.warn('[Quest] Failed to get characterId for coliseum:', err.message));

    console.log(`[Coliseum] Match completed: Battle ${battleId}, Winner: ${winnerId} (+${ratingChange.winnerGain}), Loser: ${loserId} (-${ratingChange.loserLoss}), Reason: ${reason}`);

  } catch (error) {
    console.error('[Coliseum] Failed to complete match:', error);
  }
}

/**
 * Handle player surrender
 * @param {number} battleId - Battle ID
 * @param {number} surrenderingPlayerId - Player who is surrendering
 */
async function _handleSurrender(battleId, surrenderingPlayerId) {
  console.log(`[Coliseum] Player ${surrenderingPlayerId} surrendering battle ${battleId}`);
  await endMatchByForfeit(battleId, surrenderingPlayerId, 'surrender', true);
}

// =============================================================================
// LEADERBOARD AND MATCH HISTORY
// =============================================================================

/**
 * Get leaderboard for a queue type
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @param {number} limit - Number of entries to return
 * @returns {Promise<Array>} Leaderboard entries
 */
async function _getLeaderboard(queueType = '1v1', limit = 100) {
  const result = await query(
    `SELECT
       pr.user_id,
       u.username,
       pr.rating,
       pr.peak_rating,
       pr.wins,
       pr.losses,
       pr.draws,
       pr.win_streak,
       pr.best_win_streak,
       pr.last_match_at,
       ROW_NUMBER() OVER (ORDER BY pr.rating DESC) as rank
     FROM pvp_ratings pr
     JOIN users u ON pr.user_id = u.id
     WHERE pr.queue_type = $1 AND (pr.wins + pr.losses) > 0
     ORDER BY pr.rating DESC
     LIMIT $2`,
    [queueType, limit]
  );

  return result.rows;
}

/**
 * Get match history
 * @param {string} filter - 'all' for global, 'mine' for user's matches
 * @param {number} userId - User ID (required if filter is 'mine')
 * @param {number} limit - Number of matches to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Array>} Match history
 */
async function _getMatchHistory(filter = 'all', userId = null, limit = 50, offset = 0) {
  let queryStr;
  let params;

  if (filter === 'mine' && userId) {
    queryStr = `
      SELECT
        cm.id,
        cm.battle_id,
        cm.queue_type,
        cm.winner_user_id,
        cm.loser_user_id,
        winner.username as winner_username,
        loser.username as loser_username,
        cm.winner_rating_change,
        cm.loser_rating_change,
        cm.match_duration_seconds,
        cm.created_at
      FROM coliseum_matches cm
      JOIN users winner ON cm.winner_user_id = winner.id
      JOIN users loser ON cm.loser_user_id = loser.id
      WHERE cm.winner_user_id = $1 OR cm.loser_user_id = $1
      ORDER BY cm.created_at DESC
      LIMIT $2 OFFSET $3`;
    params = [userId, limit, offset];
  } else {
    queryStr = `
      SELECT
        cm.id,
        cm.battle_id,
        cm.queue_type,
        cm.winner_user_id,
        cm.loser_user_id,
        winner.username as winner_username,
        loser.username as loser_username,
        cm.winner_rating_change,
        cm.loser_rating_change,
        cm.match_duration_seconds,
        cm.created_at
      FROM coliseum_matches cm
      JOIN users winner ON cm.winner_user_id = winner.id
      JOIN users loser ON cm.loser_user_id = loser.id
      ORDER BY cm.created_at DESC
      LIMIT $1 OFFSET $2`;
    params = [limit, offset];
  }

  const result = await query(queryStr, params);
  return result.rows;
}

/**
 * Get detailed match information
 * @param {number} matchId - Coliseum match ID
 * @returns {Promise<Object>} Match details with snapshots and stats
 */
async function _getMatchDetails(matchId) {
  const result = await query(
    `SELECT
       cm.*,
       winner.username as winner_username,
       loser.username as loser_username
     FROM coliseum_matches cm
     JOIN users winner ON cm.winner_user_id = winner.id
     JOIN users loser ON cm.loser_user_id = loser.id
     WHERE cm.id = $1`,
    [matchId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Get a player's rank in the leaderboard
 * @param {number} userId - User ID
 * @param {string} queueType - Queue type
 * @returns {Promise<Object>} Player's rank and rating info
 */
async function _getPlayerRank(userId, queueType = '1v1') {
  const result = await query(
    `SELECT
       user_id,
       rating,
       wins,
       losses,
       (SELECT COUNT(*) + 1 FROM pvp_ratings
        WHERE queue_type = $2 AND rating > pr.rating) as rank
     FROM pvp_ratings pr
     WHERE user_id = $1 AND queue_type = $2`,
    [userId, queueType]
  );

  if (result.rows.length === 0) {
    return { rank: null, rating: 1000, wins: 0, losses: 0 };
  }

  return result.rows[0];
}

/**
 * Reset all internal state and cancel all timers (for test cleanup)
 * @private - Only for testing
 */
function _resetForTests() {
  // Cancel match ready timers
  for (const timerId of matchReadyTimers.values()) {
    clearTimeout(timerId);
  }
  matchReadyTimers.clear();

  // Cancel match start timers
  for (const timerId of matchStartTimers.values()) {
    clearTimeout(timerId);
  }
  matchStartTimers.clear();

  // Cancel turn timers
  for (const timer of turnTimers.values()) {
    clearTimeout(timer.timerId);
  }
  turnTimers.clear();

  // Cancel disconnect tracking timers
  for (const tracking of disconnectTracking.values()) {
    for (const playerTracking of Object.values(tracking)) {
      if (playerTracking.timerId) {
        clearTimeout(playerTracking.timerId);
      }
    }
  }
  disconnectTracking.clear();

  // Clear remaining state
  turnTimeoutCounts.clear();
  matchmakingQueues.clear();
  activeMatches.clear();
}

// Only export functions used externally - internal functions remain private
export {
  // Queue management (used by websocket/index.js and tests)
  joinQueue,
  leaveQueue,
  playerReady,
  getQueueStatus,
  getAllQueueStatuses,
  getQueuePlayers,
  broadcastGlobalQueueStatus,
  cleanupPlayer,
  QUEUE_SETTINGS,
  // Test cleanup
  _resetForTests
};

export default {
  joinQueue,
  leaveQueue,
  playerReady,
  getQueueStatus,
  getAllQueueStatuses,
  getQueuePlayers,
  broadcastGlobalQueueStatus,
  cleanupPlayer,
  QUEUE_SETTINGS,
  _resetForTests
};
