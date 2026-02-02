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

import { query, pool } from '../../config/database.js';
import * as battleService from '../battleService.js';
import * as dailyQuestService from '../dailyQuestService.js';
import * as battleWebsocket from '../battleWebsocket.js';
import { MAX_BATTLE_PARTY_SIZE } from '../../config/constants.js';
import { calculateBattlePartyPower } from '../characterValuationService.js';
import {
  calculateRatingChange,
  updatePvpRating,
  getPlayerRating,
  ensureRating,
  applyForfeitPenalty
} from '../ratingService.js';
import { getUserBadges, getPriorityBadges } from '../../../../shared/coliseum.js';
import { checkAndAwardBadges, getBatchUserAchievements } from '../achievementService.js';
import {
  activeMatches,
  matchReadyTimers,
  matchStartTimers,
  matchmakingQueues,
  matchIdCounter,
  getWebsocket
} from './constants.js';
import { broadcastQueueUpdate } from './queueBroadcaster.js';
import { captureTeamSnapshots, calculateMatchStats } from './statistics.js';
import { setCompleteMatchFn, cancelTurnTimer, startTurnTimer } from './turnTimer.js';

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
    readyDeadline: Date.now() + 10000 // 10 seconds to ready up
  };

  activeMatches.set(matchId, match);

  // Fetch achievements and ratings for badge display
  const userIds = [player1.userId, player2.userId];
  const [achievementsMap, ratingsResult] = await Promise.all([
    getBatchUserAchievements(userIds),
    query(
      `SELECT user_id, rating, win_streak FROM pvp_ratings
       WHERE user_id = ANY($1) AND queue_type = $2`,
      [userIds, queueType]
    )
  ]);

  // Build ratings lookup
  const ratingsMap = new Map();
  for (const row of ratingsResult.rows) {
    ratingsMap.set(row.user_id, { rating: row.rating, winStreak: row.win_streak || 0 });
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
            badges: player2Badges
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
            badges: player1Badges
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
 * @returns {Promise<Array>} Battle party characters
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

  // Get skills for each character with full definitions (matching PvE pattern)
  const characters = result.rows;
  const characterIds = characters.map(c => c.id);
  const skillsResult = await query(
    `SELECT character_id, skill_id, level
     FROM character_skills
     WHERE character_id = ANY($1)`,
    [characterIds]
  );

  // Group skills by character and enhance with skill definitions
  const characterSkills = {};
  for (const row of skillsResult.rows) {
    if (!characterSkills[row.character_id]) {
      characterSkills[row.character_id] = [];
    }
    const char = characters.find(c => c.id === row.character_id);
    const skillDef = char ? battleService.getSkillDefinition(char.class, row.skill_id) : null;

    if (skillDef) {
      characterSkills[row.character_id].push({
        id: row.skill_id,
        name: skillDef.name,
        level: row.level,
        mpCost: skillDef.mpCost || 0,
        range: skillDef.range || 1,
        power: skillDef.power || 100,
        type: skillDef.type || 'active',
        effect: skillDef.effect || null,
        aoeRadius: skillDef.aoeRadius || 0,
        description: skillDef.description || ''
      });
    }
  }

  // Assign enriched skills to each character
  for (const char of characters) {
    char.skills = characterSkills[char.id] || [];
  }

  return characters;
}

/**
 * Start the match (create PvP battle)
 * @param {number} matchId - Match ID
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

    // Start turn timer for first player's turn
    const firstUnit = initialState.units.find(u => u.id === initialState.activeUnitId);
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
    cancelMatch(matchId, 'Error creating battle');
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

  activeMatches.delete(matchId);
}

/**
 * Complete a PvP match and record results
 * @param {number} battleId - Battle ID
 * @param {number} winnerId - Winner user ID
 * @param {number} loserId - Loser user ID
 * @param {string} reason - Victory reason: 'victory', 'surrender', 'timeout_forfeit', 'disconnect_forfeit'
 * @param {boolean} applyPenalty - Whether to apply forfeit penalty (default true for forfeits)
 */
export async function completeMatch(battleId, winnerId, loserId, reason = 'victory', applyPenalty = true) {
  try {
    // Get match info
    const matchResult = await query(
      'SELECT id, battle_state FROM battles WHERE id = $1',
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

    // Update battle status (use 'victory' as battles table uses battle_status enum)
    await query(
      'UPDATE battles SET status = \'victory\', winner_id = $2 WHERE id = $1',
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

    // Clean up turn timer
    cancelTurnTimer(battleId);

    // Broadcast battle:end so frontend can show victory/defeat screen
    // Get player1_id, player2_id from battles table to determine winning team
    const battlePlayersResult = await query(
      'SELECT player1_id, player2_id FROM battles WHERE id = $1',
      [battleId]
    );
    const battlePlayers = battlePlayersResult.rows[0];
    const player1Id = battlePlayers?.player1_id || winnerId;
    const player2Id = battlePlayers?.player2_id || loserId;
    const winningTeamId = winnerId === player1Id ? 1 : 2;

    const pvpInfo = {
      player1Id,
      player2Id,
      winningTeamId
    };

    // Map surrender/forfeit reasons to appropriate battle end status
    const battleStatus = reason === 'surrender' ? 'surrender' : 'victory';
    await battleWebsocket.broadcastBattleEnd(battleId, battleStatus, null, pvpInfo);

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

    // Check and award achievement badges (fire-and-forget pattern)
    const battleState = matchResult.rows[0]?.battle_state;
    checkAndAwardBadges(winnerId, {
      winnerRating: winnerCurrentRating,
      loserRating: loserCurrentRating,
      winnerPPR,
      loserPPR,
      battleState,
      winnerNewRating: winnerCurrentRating + ratingChange.winnerGain
    }).then(newBadges => {
      if (newBadges.length > 0) {
        console.log(`[Coliseum] Awarded badges to ${winnerId}:`, newBadges.map(b => b.key).join(', '));
        // Notify winner of new badges
        ws.sendToUser(winnerId, {
          type: 'coliseum:badges_earned',
          payload: { badges: newBadges }
        });
      }
    }).catch(err => console.warn('[Coliseum] Badge check failed:', err.message));

    console.log(`[Coliseum] Match completed: Battle ${battleId}, Winner: ${winnerId} (+${ratingChange.winnerGain}), Loser: ${loserId} (-${ratingChange.loserLoss}), Reason: ${reason}`);

  } catch (error) {
    console.error('[Coliseum] Failed to complete match:', error);
  }
}
