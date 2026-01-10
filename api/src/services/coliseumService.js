/**
 * Coliseum Service - Handles PvP matchmaking and queue management
 */

import { query } from '../config/database.js';
import * as battleService from './battleService.js';
import * as battleWebsocket from './battleWebsocket.js';
import { MAX_BATTLE_PARTY_SIZE } from '../config/constants.js';

// Lazy-load websocket to avoid circular dependency
// websocket/index.js imports this file, so we can't destructure at top level
let _websocket = null;
async function getWebsocket() {
  if (!_websocket) {
    _websocket = await import('../websocket/index.js');
  }
  return _websocket;
}

// Matchmaking queue: Map of queueType -> Array of { userId, username, partyLevel, partySize, queuedAt }
const matchmakingQueues = new Map();

// Active matches: matchId -> { player1, player2, status, createdAt }
const activeMatches = new Map();

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
 * @returns {Object} Queue status
 */
function joinQueue(queueType, userId, username, partyLevel, partySize) {
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
      alreadyInQueue: true
    };
  }

  // Add to queue
  const queueEntry = {
    userId,
    username,
    partyLevel,
    partySize,
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
        queueSize: queue.length
      }
    });
  }).catch(err => console.error('Failed to join coliseum room:', err));

  // Try to create a match
  const matchResult = tryMatchmaking(queueType);

  return {
    success: true,
    position: queue.length,
    estimatedWait: calculateEstimatedWait(queue.length, queue.length - 1),
    queueSize: queue.length,
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
 * Try to create a match from queued players
 * @param {string} queueType - Queue type
 * @returns {Object} Match result
 */
function tryMatchmaking(queueType) {
  const settings = QUEUE_SETTINGS[queueType];
  const queue = matchmakingQueues.get(queueType);

  if (!queue || queue.length < settings.minPlayers) {
    return { matched: false };
  }

  // Simple matchmaking: match first two players in queue
  // TODO: Add skill-based matchmaking using partyLevel

  const player1 = queue.shift();
  const player2 = queue.shift();

  if (!player1 || !player2) {
    // Put player back if only one available
    if (player1) queue.unshift(player1);
    if (player2) queue.unshift(player2);
    return { matched: false };
  }

  // Create match
  const matchId = matchIdCounter++;
  const match = {
    id: matchId,
    queueType,
    player1: {
      userId: player1.userId,
      username: player1.username,
      partyLevel: player1.partyLevel,
      ready: false
    },
    player2: {
      userId: player2.userId,
      username: player2.username,
      partyLevel: player2.partyLevel,
      ready: false
    },
    status: 'pending',
    createdAt: Date.now(),
    readyDeadline: Date.now() + 30000 // 30 seconds to ready up
  };

  activeMatches.set(matchId, match);

  // Notify both players of match found (async, fire and forget)
  getWebsocket().then(ws => {
    const matchPayload = {
      matchId,
      queueType,
      readyDeadline: match.readyDeadline
    };

    ws.sendToUser(player1.userId, {
      type: 'coliseum:match_found',
      payload: {
        ...matchPayload,
        opponent: {
          username: player2.username,
          partyLevel: player2.partyLevel
        }
      }
    });

    ws.sendToUser(player2.userId, {
      type: 'coliseum:match_found',
      payload: {
        ...matchPayload,
        opponent: {
          username: player1.username,
          partyLevel: player1.partyLevel
        }
      }
    });

    // Update queue for remaining players
    broadcastQueueUpdate(queueType);
  }).catch(err => console.error('Failed to notify match found:', err));

  // Set timeout for ready check
  setTimeout(() => checkMatchReady(matchId), 31000);

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

    // Schedule match start
    setTimeout(() => startMatch(matchId), 3000);
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
  const match = activeMatches.get(matchId);
  if (!match || match.status !== 'pending') return;

  // Match not ready in time - cancel and return players to queue
  const notReadyUsers = [];

  if (!match.player1.ready) notReadyUsers.push(match.player1);
  if (!match.player2.ready) notReadyUsers.push(match.player2);

  getWebsocket().then(ws => {
    // Notify and return ready player to queue
    if (match.player1.ready && !match.player2.ready) {
      ws.sendToUser(match.player1.userId, {
        type: 'coliseum:match_cancelled',
        payload: { matchId, reason: 'Opponent did not ready' }
      });
      // Re-queue ready player at front
      const queue = matchmakingQueues.get(match.queueType) || [];
      queue.unshift({
        userId: match.player1.userId,
        username: match.player1.username,
        partyLevel: match.player1.partyLevel,
        queuedAt: Date.now()
      });
      if (!matchmakingQueues.has(match.queueType)) {
        matchmakingQueues.set(match.queueType, queue);
      }
    }

    if (match.player2.ready && !match.player1.ready) {
      ws.sendToUser(match.player2.userId, {
        type: 'coliseum:match_cancelled',
        payload: { matchId, reason: 'Opponent did not ready' }
      });
      const queue = matchmakingQueues.get(match.queueType) || [];
      queue.unshift({
        userId: match.player2.userId,
        username: match.player2.username,
        partyLevel: match.player2.partyLevel,
        queuedAt: Date.now()
      });
      if (!matchmakingQueues.has(match.queueType)) {
        matchmakingQueues.set(match.queueType, queue);
      }
    }

    // Notify non-ready players
    for (const user of notReadyUsers) {
      ws.sendToUser(user.userId, {
        type: 'coliseum:match_cancelled',
        payload: { matchId, reason: 'Failed to ready in time' }
      });
    }
  }).catch(err => console.error('Failed to handle match ready check:', err));

  // Remove match
  activeMatches.delete(matchId);
}

/**
 * Start the match (create PvP battle)
 */
async function startMatch(matchId) {
  const match = activeMatches.get(matchId);
  if (!match || match.status !== 'ready') return;

  match.status = 'starting';

  try {
    // Get battle party characters for both players
    const [player1Party, player2Party] = await Promise.all([
      getPlayerBattleParty(match.player1.userId),
      getPlayerBattleParty(match.player2.userId)
    ]);

    if (player1Party.length === 0 || player2Party.length === 0) {
      // Cancel match if either player has no characters
      cancelMatch(matchId, 'No battle party available');
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

    // Add player 1's units (bottom side of map)
    player1Party.forEach((char, idx) => {
      initialState.units.push({
        id: char.id,
        type: 'player',
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

    // Add player 2's units (top side of map)
    player2Party.forEach((char, idx) => {
      initialState.units.push({
        id: char.id,
        type: 'player',
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
       VALUES ('pvp', 'active', $1, $2, 32, 32, $3, $4)
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
    console.error('Failed to create PvP battle:', error);
    cancelMatch(matchId, 'Failed to create battle');
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
      `SELECT skill_id, skill_level FROM character_skills WHERE character_id = $1`,
      [char.id]
    );
    char.skills = skillsResult.rows.map(s => ({ id: s.skill_id, level: s.skill_level }));
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

  ws.sendToUser(match.player1.userId, {
    type: 'coliseum:match_cancelled',
    payload: { matchId, reason }
  });

  ws.sendToUser(match.player2.userId, {
    type: 'coliseum:match_cancelled',
    payload: { matchId, reason }
  });

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

        ws.sendToUser(opponentId, {
          type: 'coliseum:match_cancelled',
          payload: { matchId, reason: 'Opponent disconnected' }
        });

        // Re-queue opponent
        const queue = matchmakingQueues.get(match.queueType) || [];
        const opponent = match.player1.userId === userId ? match.player2 : match.player1;
        queue.unshift({
          userId: opponent.userId,
          username: opponent.username,
          partyLevel: opponent.partyLevel,
          queuedAt: Date.now()
        });

        activeMatches.delete(matchId);
      }
    }
  });
}

export {
  joinQueue,
  leaveQueue,
  playerReady,
  getQueueStatus,
  getAllQueueStatuses,
  cleanupPlayer,
  QUEUE_SETTINGS
};

export default {
  joinQueue,
  leaveQueue,
  playerReady,
  getQueueStatus,
  getAllQueueStatuses,
  cleanupPlayer,
  QUEUE_SETTINGS
};
