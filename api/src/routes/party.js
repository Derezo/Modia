import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { MAX_PARTY_SIZE, MAX_BATTLE_PARTY_SIZE } from '../config/constants.js';
import partyWebsocket from '../services/partyWebsocket.js';
import { parseIdParam } from '../utils/parseParams.js';
import { isBlocked } from '../services/friendService.js';
import { validateDisplayName } from '../utils/nameValidation.js';

const router = express.Router();

async function lockOwnedCharacters(client, userId) {
  const result = await client.query(
    `SELECT id, hp_current, in_battle
     FROM characters
     WHERE user_id = $1
     ORDER BY id
     FOR UPDATE`,
    [userId]
  );

  if (result.rows.some(character => character.in_battle)) {
    throw new AppError('Cannot change party formation during battle', 400);
  }

  return result.rows;
}

// GET /api/party - Get current party formation
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, race, class, level, hp_current, hp_max, mp_current, mp_max, party_slot
     FROM characters
     WHERE user_id = $1 AND party_slot IS NOT NULL
     ORDER BY party_slot ASC`,
    [req.user.userId]
  );

  res.json({ party: result.rows });
}));

// PUT /api/party - Update party formation (reorder slots)
router.put('/', authenticate, asyncHandler(async (req, res) => {
  const { formation } = req.body; // Array of { characterId, slot }

  if (!Array.isArray(formation)) {
    throw new AppError('Formation must be an array', 400);
  }

  // Validate slots
  const slots = new Set();
  for (const { characterId: _characterId, slot } of formation) {
    if (slot < 1 || slot > MAX_PARTY_SIZE) {
      throw new AppError(`Slot must be between 1 and ${MAX_PARTY_SIZE}`, 400);
    }
    if (slots.has(slot)) {
      throw new AppError('Duplicate slot assignment', 400);
    }
    slots.add(slot);
  }

  const charIds = formation.map(f => f.characterId);
  const party = await withTransaction(async (client) => {
    const ownedCharacters = await lockOwnedCharacters(client, req.user.userId);
    const ownedIds = new Set(ownedCharacters.map(character => String(character.id)));
    if (
      new Set(charIds.map(String)).size !== charIds.length
      || charIds.some(characterId => !ownedIds.has(String(characterId)))
    ) {
      throw new AppError('One or more characters not found', 404);
    }

    // Ensure main character (oldest) stays in slot 1 while the roster is locked.
    const mainCharResult = await client.query(
      `SELECT id
       FROM characters
       WHERE user_id = $1
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [req.user.userId]
    );
    if (mainCharResult.rows.length > 0) {
      const mainCharId = mainCharResult.rows[0].id;
      const slot1Assignment = formation.find(f => f.slot === 1);
      if (
        !slot1Assignment
        || String(slot1Assignment.characterId) !== String(mainCharId)
      ) {
        throw new AppError('Main character must remain in slot 1', 400);
      }
    }

    await client.query(
      'UPDATE characters SET party_slot = NULL WHERE user_id = $1',
      [req.user.userId]
    );

    for (const { characterId, slot } of formation) {
      const update = await client.query(
        `UPDATE characters
         SET party_slot = $1
         WHERE id = $2 AND user_id = $3`,
        [slot, characterId, req.user.userId]
      );
      if (update.rowCount !== 1) {
        throw new AppError('Party formation changed - please retry', 409);
      }
    }

    const result = await client.query(
      `SELECT id, name, race, class, level, hp_current, hp_max, mp_current, mp_max, party_slot
       FROM characters
       WHERE user_id = $1 AND party_slot IS NOT NULL
       ORDER BY party_slot ASC`,
      [req.user.userId]
    );
    return result.rows;
  });

  res.json({ party });
}));

// PUT /api/party/battle - Set battle party (top 5 for combat)
router.put('/battle', authenticate, asyncHandler(async (req, res) => {
  const { characterIds } = req.body; // Array of up to 5 character IDs

  if (!Array.isArray(characterIds)) {
    throw new AppError('characterIds must be an array', 400);
  }

  if (characterIds.length > MAX_BATTLE_PARTY_SIZE) {
    throw new AppError(`Cannot have more than ${MAX_BATTLE_PARTY_SIZE} characters in battle party`, 400);
  }

  if (characterIds.length === 0) {
    throw new AppError('Battle party must have at least 1 character', 400);
  }

  const battleParty = await withTransaction(async (client) => {
    const ownedCharacters = await lockOwnedCharacters(client, req.user.userId);
    const ownedById = new Map(
      ownedCharacters.map(character => [String(character.id), character])
    );
    if (
      new Set(characterIds.map(String)).size !== characterIds.length
      || characterIds.some(characterId => {
        const character = ownedById.get(String(characterId));
        return !character || character.hp_current <= 0;
      })
    ) {
      throw new AppError('One or more characters not found or are incapacitated', 400);
    }

    await client.query(
      `UPDATE characters SET party_slot = NULL
       WHERE user_id = $1 AND party_slot <= $2`,
      [req.user.userId, MAX_BATTLE_PARTY_SIZE]
    );

    for (let index = 0; index < characterIds.length; index++) {
      const update = await client.query(
        `UPDATE characters
         SET party_slot = $1
         WHERE id = $2 AND user_id = $3`,
        [index + 1, characterIds[index], req.user.userId]
      );
      if (update.rowCount !== 1) {
        throw new AppError('Battle party changed - please retry', 409);
      }
    }

    const result = await client.query(
      `SELECT id, name, race, class, level, hp_current, hp_max, mp_current, mp_max, party_slot
       FROM characters
       WHERE user_id = $1 AND party_slot <= $2
       ORDER BY party_slot ASC`,
      [req.user.userId, MAX_BATTLE_PARTY_SIZE]
    );
    return result.rows;
  });

  res.json({ battleParty });
}));

// ============================================================================
// MULTIPLAYER PARTY ROUTES
// ============================================================================

// GET /api/party/multiplayer/current - Get user's current multiplayer party
router.get('/multiplayer/current', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT p.id, p.name, p.party_type, p.status, p.max_members,
            p.leader_id, u.username as leader_username,
            pm.is_ready
     FROM parties p
     JOIN party_members pm ON p.id = pm.party_id
     JOIN users u ON p.leader_id = u.id
     WHERE pm.user_id = $1 AND p.status IN ('forming', 'ready')`,
    [req.user.userId]
  );

  if (result.rows.length === 0) {
    return res.json({ party: null });
  }

  const party = result.rows[0];

  // Get all members
  const membersResult = await query(
    `SELECT pm.user_id, pm.is_ready, pm.joined_at,
            u.username,
            c.id as character_id, c.name as character_name, c.race, c.class, c.level
     FROM party_members pm
     JOIN users u ON pm.user_id = u.id
     LEFT JOIN characters c ON c.user_id = pm.user_id AND c.party_slot = 1
     WHERE pm.party_id = $1
     ORDER BY pm.joined_at`,
    [party.id]
  );

  res.json({
    party: {
      id: party.id,
      name: party.name,
      partyType: party.party_type,
      status: party.status,
      maxMembers: party.max_members,
      leaderId: party.leader_id,
      leaderUsername: party.leader_username,
      isReady: party.is_ready,
      members: membersResult.rows
    }
  });
}));

// POST /api/party/multiplayer - Create a new multiplayer party
router.post('/multiplayer', authenticate, asyncHandler(async (req, res) => {
  const { name, partyType = 'adventure', maxMembers = 4 } = req.body;

  // Map legacy party types to DB enum values
  const typeAliases = {
    pve: 'adventure',
    pve_coop: 'adventure',
    pvp_team: 'coliseum_team'
  };
  const resolvedType = typeAliases[partyType] ?? partyType;

  // Validate party type against DB enum
  const validTypes = ['adventure', 'coliseum_team', 'raid'];
  if (!validTypes.includes(resolvedType)) {
    throw new AppError(`Invalid party type. Must be one of: ${validTypes.join(', ')}`, 400);
  }

  // Validate maxMembers
  const parsedMaxMembers = parseInt(maxMembers, 10);
  if (isNaN(parsedMaxMembers) || parsedMaxMembers < 2 || parsedMaxMembers > 8) {
    throw new AppError('maxMembers must be between 2 and 8', 400);
  }

  // Validate party name
  const partyName = name
    ? validateDisplayName(name, { label: 'Party name', min: 1, max: 64 })
    : `${req.user.username}'s Party`;

  // Check if user is already in a party
  const existingResult = await query(
    `SELECT p.id FROM parties p
     JOIN party_members pm ON p.id = pm.party_id
     WHERE pm.user_id = $1 AND p.status IN ('forming', 'ready')`,
    [req.user.userId]
  );

  if (existingResult.rows.length > 0) {
    throw new AppError('You are already in a party', 400);
  }

  // Create party
  const partyResult = await query(
    `INSERT INTO parties (leader_id, party_type, name, status, max_members)
     VALUES ($1, $2, $3, 'forming', $4)
     RETURNING id, name, party_type, status, max_members, created_at`,
    [req.user.userId, resolvedType, partyName, parsedMaxMembers]
  );

  const party = partyResult.rows[0];

  // Add leader as first member
  await query(
    `INSERT INTO party_members (party_id, user_id, is_ready)
     VALUES ($1, $2, false)`,
    [party.id, req.user.userId]
  );

  // Join party WebSocket room
  partyWebsocket.joinPartyRoom(party.id, req.user.userId);

  res.status(201).json({
    party: {
      id: party.id,
      name: party.name,
      partyType: party.party_type,
      status: party.status,
      maxMembers: party.max_members,
      leaderId: req.user.userId,
      members: [{
        userId: req.user.userId,
        username: req.user.username,
        isReady: false
      }]
    }
  });
}));

// GET /api/party/multiplayer/invites - Get pending invites for current user
// NOTE: This route MUST be registered before /multiplayer/:partyId to avoid shadowing
router.get('/multiplayer/invites', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT pi.id, pi.party_id, pi.expires_at,
            p.name as party_name,
            u.username as inviter_username
     FROM party_invites pi
     JOIN parties p ON pi.party_id = p.id
     JOIN users u ON pi.inviter_id = u.id
     WHERE pi.invitee_id = $1
       AND pi.invite_status = 'pending'
       AND pi.expires_at > NOW()
     ORDER BY pi.created_at DESC`,
    [req.user.userId]
  );

  res.json({ invites: result.rows });
}));

// POST /api/party/multiplayer/decline/:inviteId - Decline an invite
// NOTE: This route MUST be registered before /multiplayer/:partyId to avoid shadowing
router.post('/multiplayer/decline/:inviteId', authenticate, asyncHandler(async (req, res) => {
  const inviteId = parseIdParam(req.params.inviteId, 'invite ID');

  const result = await query(
    `UPDATE party_invites SET invite_status = 'declined', responded_at = NOW()
     WHERE id = $1 AND invitee_id = $2 AND invite_status = 'pending'
     RETURNING party_id, inviter_id`,
    [inviteId, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invite not found or already processed', 404);
  }

  // Notify inviter via WebSocket
  partyWebsocket.declineInvite(inviteId, req.user.userId);

  res.json({ success: true });
}));

// GET /api/party/multiplayer/:partyId - Get party details
router.get('/multiplayer/:partyId', authenticate, asyncHandler(async (req, res) => {
  const partyId = parseIdParam(req.params.partyId, 'party ID');

  // Verify user is a member (security: don't expose party info to non-members)
  const memberCheck = await query(
    'SELECT 1 FROM party_members WHERE party_id = $1 AND user_id = $2',
    [partyId, req.user.userId]
  );

  if (memberCheck.rows.length === 0) {
    throw new AppError('Party not found', 404);
  }

  // Get party info
  const partyResult = await query(
    `SELECT p.id, p.name, p.party_type, p.status, p.max_members, p.leader_id,
            u.username as leader_username
     FROM parties p
     JOIN users u ON p.leader_id = u.id
     WHERE p.id = $1`,
    [partyId]
  );

  if (partyResult.rows.length === 0) {
    throw new AppError('Party not found', 404);
  }

  const party = partyResult.rows[0];

  // Get members
  const membersResult = await query(
    `SELECT pm.user_id, pm.is_ready, pm.joined_at,
            u.username,
            c.id as character_id, c.name as character_name, c.race, c.class, c.level
     FROM party_members pm
     JOIN users u ON pm.user_id = u.id
     LEFT JOIN characters c ON c.user_id = pm.user_id AND c.party_slot = 1
     WHERE pm.party_id = $1
     ORDER BY pm.joined_at`,
    [partyId]
  );

  res.json({
    party: {
      id: party.id,
      name: party.name,
      partyType: party.party_type,
      status: party.status,
      maxMembers: party.max_members,
      leaderId: party.leader_id,
      leaderUsername: party.leader_username,
      members: membersResult.rows
    }
  });
}));

// POST /api/party/multiplayer/:partyId/invite - Invite a player by username
router.post('/multiplayer/:partyId/invite', authenticate, asyncHandler(async (req, res) => {
  const partyId = parseIdParam(req.params.partyId, 'party ID');
  const { username } = req.body;

  if (!username) {
    throw new AppError('Username is required', 400);
  }

  // Verify user is party leader
  const partyResult = await query(
    `SELECT p.id, p.name, p.leader_id, p.status, p.max_members,
            (SELECT COUNT(*) FROM party_members WHERE party_id = p.id) as member_count
     FROM parties p
     WHERE p.id = $1`,
    [partyId]
  );

  if (partyResult.rows.length === 0) {
    throw new AppError('Party not found', 404);
  }

  const party = partyResult.rows[0];

  if (party.leader_id !== req.user.userId) {
    throw new AppError('Only the party leader can invite players', 403);
  }

  if (party.status !== 'forming') {
    throw new AppError('Cannot invite to a party that is not forming', 400);
  }

  if (parseInt(party.member_count) >= party.max_members) {
    throw new AppError('Party is full', 400);
  }

  // Find target user
  const userResult = await query(
    'SELECT id, username FROM users WHERE username = $1',
    [username]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const targetUser = userResult.rows[0];

  if (targetUser.id === req.user.userId) {
    throw new AppError('Cannot invite yourself', 400);
  }

  // Check if either user has blocked the other
  const blocked = await isBlocked(req.user.userId, targetUser.id);
  if (blocked) {
    throw new AppError('Cannot invite this player', 400);
  }

  // Check if target is already in a party
  const targetPartyCheck = await query(
    `SELECT p.id FROM parties p
     JOIN party_members pm ON p.id = pm.party_id
     WHERE pm.user_id = $1 AND p.status IN ('forming', 'ready')`,
    [targetUser.id]
  );

  if (targetPartyCheck.rows.length > 0) {
    throw new AppError('That player is already in a party', 400);
  }

  // Check for existing pending invite
  const existingInvite = await query(
    `SELECT id FROM party_invites
     WHERE party_id = $1 AND invitee_id = $2 AND invite_status = 'pending'`,
    [partyId, targetUser.id]
  );

  if (existingInvite.rows.length > 0) {
    throw new AppError('Invite already pending for this player', 400);
  }

  // Create invite in database
  const inviteResult = await query(
    `INSERT INTO party_invites (party_id, inviter_id, invitee_id, invite_status, expires_at)
     VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '5 minutes')
     RETURNING id, expires_at`,
    [partyId, req.user.userId, targetUser.id]
  );

  const invite = inviteResult.rows[0];

  // Send invite via WebSocket with DB invite ID
  await partyWebsocket.sendInvite({
    inviteId: invite.id,
    expiresAt: invite.expires_at,
    fromUserId: req.user.userId,
    fromUsername: req.user.username,
    toUserId: targetUser.id,
    partyId,
    partyName: party.name
  });

  res.json({
    success: true,
    invite: {
      id: invite.id,
      inviteeUsername: targetUser.username,
      expiresAt: invite.expires_at
    }
  });
}));

// POST /api/party/multiplayer/join/:inviteId - Accept invite and join party
router.post('/multiplayer/join/:inviteId', authenticate, asyncHandler(async (req, res) => {
  const inviteId = parseIdParam(req.params.inviteId, 'invite ID');

  // Get and validate invite
  const inviteResult = await query(
    `SELECT pi.id, pi.party_id, pi.inviter_id, pi.invitee_id, pi.invite_status, pi.expires_at,
            p.name as party_name, p.status as party_status, p.max_members,
            (SELECT COUNT(*) FROM party_members WHERE party_id = p.id) as member_count
     FROM party_invites pi
     JOIN parties p ON pi.party_id = p.id
     WHERE pi.id = $1`,
    [inviteId]
  );

  if (inviteResult.rows.length === 0) {
    throw new AppError('Invite not found', 404);
  }

  const invite = inviteResult.rows[0];

  if (invite.invitee_id !== req.user.userId) {
    throw new AppError('This invite is not for you', 403);
  }

  if (invite.invite_status !== 'pending') {
    throw new AppError('Invite is no longer valid', 400);
  }

  if (new Date(invite.expires_at) < new Date()) {
    await query(
      'UPDATE party_invites SET invite_status = \'expired\' WHERE id = $1',
      [inviteId]
    );
    throw new AppError('Invite has expired', 400);
  }

  if (invite.party_status !== 'forming') {
    throw new AppError('Party is no longer accepting members', 400);
  }

  if (parseInt(invite.member_count) >= invite.max_members) {
    throw new AppError('Party is full', 400);
  }

  // Check if user is already in a party
  const existingParty = await query(
    `SELECT p.id FROM parties p
     JOIN party_members pm ON p.id = pm.party_id
     WHERE pm.user_id = $1 AND p.status IN ('forming', 'ready')`,
    [req.user.userId]
  );

  if (existingParty.rows.length > 0) {
    throw new AppError('You are already in a party', 400);
  }

  // Update invite status
  await query(
    'UPDATE party_invites SET invite_status = \'accepted\', responded_at = NOW() WHERE id = $1',
    [inviteId]
  );

  // Add user to party
  await query(
    `INSERT INTO party_members (party_id, user_id, is_ready)
     VALUES ($1, $2, false)`,
    [invite.party_id, req.user.userId]
  );

  // Join party WebSocket room
  partyWebsocket.joinPartyRoom(invite.party_id, req.user.userId);

  // Broadcast member joined
  partyWebsocket.broadcastMemberJoined(
    invite.party_id,
    req.user.userId,
    req.user.username,
    null // Character name can be fetched separately
  );

  // Get updated party info
  const partyResult = await query(
    `SELECT p.id, p.name, p.party_type, p.status, p.max_members, p.leader_id,
            u.username as leader_username
     FROM parties p
     JOIN users u ON p.leader_id = u.id
     WHERE p.id = $1`,
    [invite.party_id]
  );

  const membersResult = await query(
    `SELECT pm.user_id, pm.is_ready, u.username
     FROM party_members pm
     JOIN users u ON pm.user_id = u.id
     WHERE pm.party_id = $1`,
    [invite.party_id]
  );

  res.json({
    success: true,
    party: {
      ...partyResult.rows[0],
      members: membersResult.rows
    }
  });
}));

// POST /api/party/multiplayer/:partyId/leave - Leave a party
router.post('/multiplayer/:partyId/leave', authenticate, asyncHandler(async (req, res) => {
  const partyId = parseIdParam(req.params.partyId, 'party ID');

  // Verify membership
  const memberResult = await query(
    `SELECT pm.user_id, p.leader_id, p.status,
            (SELECT COUNT(*) FROM party_members WHERE party_id = p.id) as member_count
     FROM party_members pm
     JOIN parties p ON pm.party_id = p.id
     WHERE pm.party_id = $1 AND pm.user_id = $2`,
    [partyId, req.user.userId]
  );

  if (memberResult.rows.length === 0) {
    throw new AppError('You are not in this party', 404);
  }

  const membership = memberResult.rows[0];
  const isLeader = membership.leader_id === req.user.userId;
  const memberCount = parseInt(membership.member_count);

  // Leave WebSocket room
  partyWebsocket.leavePartyRoom(parseInt(partyId), req.user.userId);

  // Remove member
  await query(
    'DELETE FROM party_members WHERE party_id = $1 AND user_id = $2',
    [partyId, req.user.userId]
  );

  if (isLeader) {
    if (memberCount <= 1) {
      // Last member leaving - disband party
      await query(
        'UPDATE parties SET status = \'disbanded\' WHERE id = $1',
        [partyId]
      );
      partyWebsocket.broadcastPartyDisbanded(parseInt(partyId), 'Leader left');
    } else {
      // Transfer leadership to next oldest member
      const newLeaderResult = await query(
        `SELECT pm.user_id, u.username
         FROM party_members pm
         JOIN users u ON pm.user_id = u.id
         WHERE pm.party_id = $1
         ORDER BY pm.joined_at
         LIMIT 1`,
        [partyId]
      );

      if (newLeaderResult.rows.length > 0) {
        const newLeader = newLeaderResult.rows[0];
        await query(
          'UPDATE parties SET leader_id = $1 WHERE id = $2',
          [newLeader.user_id, partyId]
        );
        partyWebsocket.broadcastLeaderChanged(
          parseInt(partyId),
          newLeader.user_id,
          newLeader.username
        );
      }
    }
  }

  // Broadcast member left
  partyWebsocket.broadcastMemberLeft(parseInt(partyId), req.user.userId, req.user.username, 'left');

  res.json({ success: true });
}));

// PUT /api/party/multiplayer/:partyId/ready - Set ready status
router.put('/multiplayer/:partyId/ready', authenticate, asyncHandler(async (req, res) => {
  const partyId = parseIdParam(req.params.partyId, 'party ID');
  const { isReady } = req.body;

  if (typeof isReady !== 'boolean') {
    throw new AppError('isReady must be a boolean', 400);
  }

  // First check party status - only allow ready changes when forming or ready
  const partyCheck = await query(
    `SELECT p.status FROM parties p
     JOIN party_members pm ON p.id = pm.party_id
     WHERE pm.party_id = $1 AND pm.user_id = $2`,
    [partyId, req.user.userId]
  );

  if (partyCheck.rows.length === 0) {
    throw new AppError('You are not in this party', 404);
  }

  const partyStatus = partyCheck.rows[0].status;
  if (partyStatus !== 'forming' && partyStatus !== 'ready') {
    throw new AppError('Cannot change ready status - party is in battle or disbanded', 409);
  }

  // Update ready status
  await query(
    `UPDATE party_members SET is_ready = $1
     WHERE party_id = $2 AND user_id = $3`,
    [isReady, partyId, req.user.userId]
  );

  // Broadcast ready status change
  const roomName = `party:${partyId}`;
  const websocket = await import('../websocket/index.js');
  websocket.broadcastToRoom(roomName, {
    type: 'party:member_ready',
    payload: {
      partyId,
      userId: req.user.userId,
      isReady
    }
  });

  // Check if all members are ready
  const readyCheck = await query(
    `SELECT COUNT(*) as total,
            COUNT(CASE WHEN is_ready THEN 1 END) as ready_count
     FROM party_members
     WHERE party_id = $1`,
    [partyId]
  );

  const { total, ready_count } = readyCheck.rows[0];
  const allReady = parseInt(total) > 1 && parseInt(ready_count) === parseInt(total);

  // Update party status based on ready state (only when forming or ready)
  if (allReady) {
    await query(
      'UPDATE parties SET status = \'ready\' WHERE id = $1 AND status IN (\'forming\', \'ready\')',
      [partyId]
    );
    websocket.broadcastToRoom(roomName, {
      type: 'party:all_ready',
      payload: { partyId }
    });
  } else {
    // Reset to forming if not all ready and currently ready
    await query(
      'UPDATE parties SET status = \'forming\' WHERE id = $1 AND status = \'ready\'',
      [partyId]
    );
  }

  res.json({
    success: true,
    isReady,
    allReady
  });
}));

// POST /api/party/multiplayer/:partyId/start - Start battle (leader only)
router.post('/multiplayer/:partyId/start', authenticate, asyncHandler(async (req, res) => {
  const partyId = parseIdParam(req.params.partyId, 'party ID');
  const { nodeId } = req.body;

  if (!nodeId) {
    throw new AppError('nodeId is required', 400);
  }

  // Verify user is leader and party is ready
  const partyResult = await query(
    `SELECT p.id, p.leader_id, p.party_type, p.status
     FROM parties p
     WHERE p.id = $1`,
    [partyId]
  );

  if (partyResult.rows.length === 0) {
    throw new AppError('Party not found', 404);
  }

  const party = partyResult.rows[0];

  if (party.leader_id !== req.user.userId) {
    throw new AppError('Only the party leader can start the battle', 403);
  }

  if (party.status !== 'ready') {
    throw new AppError('Not all party members are ready', 400);
  }

  // Get all party members
  const membersResult = await query(
    'SELECT pm.user_id FROM party_members pm WHERE pm.party_id = $1',
    [partyId]
  );

  const memberIds = membersResult.rows.map(r => r.user_id);

  // Update party status
  await query(
    'UPDATE parties SET status = \'in_battle\' WHERE id = $1',
    [partyId]
  );

  // Broadcast battle starting
  const roomName = `party:${partyId}`;
  const websocket = await import('../websocket/index.js');
  websocket.broadcastToRoom(roomName, {
    type: 'party:battle_starting',
    payload: {
      partyId: parseInt(partyId),
      nodeId,
      partyType: party.party_type,
      memberIds
    }
  });

  res.json({
    success: true,
    message: 'Battle starting',
    nodeId,
    memberIds
  });
}));

export default router;
