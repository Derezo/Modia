import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { MAX_PARTY_SIZE, MAX_BATTLE_PARTY_SIZE } from '../config/constants.js';
import partyWebsocket from '../services/partyWebsocket.js';

const router = express.Router();

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
  for (const { characterId, slot } of formation) {
    if (slot < 1 || slot > MAX_PARTY_SIZE) {
      throw new AppError(`Slot must be between 1 and ${MAX_PARTY_SIZE}`, 400);
    }
    if (slots.has(slot)) {
      throw new AppError('Duplicate slot assignment', 400);
    }
    slots.add(slot);
  }

  // Verify all characters belong to user
  const charIds = formation.map(f => f.characterId);
  const verifyResult = await query(
    `SELECT id FROM characters WHERE id = ANY($1) AND user_id = $2`,
    [charIds, req.user.userId]
  );

  if (verifyResult.rows.length !== charIds.length) {
    throw new AppError('One or more characters not found', 404);
  }

  // Clear existing slots first
  await query(
    'UPDATE characters SET party_slot = NULL WHERE user_id = $1',
    [req.user.userId]
  );

  // Set new slots
  for (const { characterId, slot } of formation) {
    await query(
      'UPDATE characters SET party_slot = $1 WHERE id = $2 AND user_id = $3',
      [slot, characterId, req.user.userId]
    );
  }

  // Return updated party
  const result = await query(
    `SELECT id, name, race, class, level, hp_current, hp_max, mp_current, mp_max, party_slot
     FROM characters
     WHERE user_id = $1 AND party_slot IS NOT NULL
     ORDER BY party_slot ASC`,
    [req.user.userId]
  );

  res.json({ party: result.rows });
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

  // Verify all characters belong to user and are alive
  const verifyResult = await query(
    `SELECT id FROM characters
     WHERE id = ANY($1) AND user_id = $2 AND hp_current > 0`,
    [characterIds, req.user.userId]
  );

  if (verifyResult.rows.length !== characterIds.length) {
    throw new AppError('One or more characters not found or are incapacitated', 400);
  }

  // Clear current battle party slots (1-5)
  await query(
    `UPDATE characters SET party_slot = NULL
     WHERE user_id = $1 AND party_slot <= $2`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  // Assign new battle party to slots 1-5
  for (let i = 0; i < characterIds.length; i++) {
    await query(
      'UPDATE characters SET party_slot = $1 WHERE id = $2 AND user_id = $3',
      [i + 1, characterIds[i], req.user.userId]
    );
  }

  // Return battle party
  const result = await query(
    `SELECT id, name, race, class, level, hp_current, hp_max, mp_current, mp_max, party_slot
     FROM characters
     WHERE user_id = $1 AND party_slot <= $2
     ORDER BY party_slot ASC`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  res.json({ battleParty: result.rows });
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
  const { name, partyType = 'pve_coop', maxMembers = 4 } = req.body;

  // Validate party type
  const validTypes = ['pve_coop', 'pvp_team', 'pvp_ffa'];
  if (!validTypes.includes(partyType)) {
    throw new AppError(`Invalid party type. Must be one of: ${validTypes.join(', ')}`, 400);
  }

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
    [req.user.userId, partyType, name || `${req.user.username}'s Party`, Math.min(maxMembers, 8)]
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

// GET /api/party/multiplayer/:partyId - Get party details
router.get('/multiplayer/:partyId', authenticate, asyncHandler(async (req, res) => {
  const { partyId } = req.params;

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
  const { partyId } = req.params;
  const { username } = req.body;

  if (!username) {
    throw new AppError('Username is required', 400);
  }

  // Verify user is party leader
  const partyResult = await query(
    `SELECT p.id, p.leader_id, p.status, p.max_members,
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
     WHERE party_id = $1 AND invitee_id = $2 AND status = 'pending'`,
    [partyId, targetUser.id]
  );

  if (existingInvite.rows.length > 0) {
    throw new AppError('Invite already pending for this player', 400);
  }

  // Create invite in database
  const inviteResult = await query(
    `INSERT INTO party_invites (party_id, inviter_id, invitee_id, status, expires_at)
     VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '5 minutes')
     RETURNING id, expires_at`,
    [partyId, req.user.userId, targetUser.id]
  );

  const invite = inviteResult.rows[0];

  // Send invite via WebSocket
  await partyWebsocket.sendInvite(
    req.user.userId,
    req.user.username,
    targetUser.id,
    null // No character ID needed for party invites
  );

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
  const { inviteId } = req.params;

  // Get and validate invite
  const inviteResult = await query(
    `SELECT pi.id, pi.party_id, pi.inviter_id, pi.invitee_id, pi.status, pi.expires_at,
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

  if (invite.status !== 'pending') {
    throw new AppError('Invite is no longer valid', 400);
  }

  if (new Date(invite.expires_at) < new Date()) {
    await query(
      "UPDATE party_invites SET status = 'expired' WHERE id = $1",
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
    "UPDATE party_invites SET status = 'accepted' WHERE id = $1",
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

  // Accept invite in WebSocket service
  await partyWebsocket.acceptInvite(parseInt(inviteId), req.user.userId, req.user.username);

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
  const { partyId } = req.params;

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
        "UPDATE parties SET status = 'disbanded' WHERE id = $1",
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
  const { partyId } = req.params;
  const { isReady } = req.body;

  if (typeof isReady !== 'boolean') {
    throw new AppError('isReady must be a boolean', 400);
  }

  // Verify membership and update
  const result = await query(
    `UPDATE party_members SET is_ready = $1
     WHERE party_id = $2 AND user_id = $3
     RETURNING user_id`,
    [isReady, partyId, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('You are not in this party', 404);
  }

  // Broadcast ready status change
  const roomName = `party:${partyId}`;
  const websocket = await import('../websocket/index.js');
  websocket.broadcastToRoom(roomName, {
    type: 'party:member_ready',
    payload: {
      partyId: parseInt(partyId),
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

  // Update party status if all ready
  if (allReady) {
    await query(
      "UPDATE parties SET status = 'ready' WHERE id = $1",
      [partyId]
    );
    websocket.broadcastToRoom(roomName, {
      type: 'party:all_ready',
      payload: { partyId: parseInt(partyId) }
    });
  }

  res.json({
    success: true,
    isReady,
    allReady
  });
}));

// POST /api/party/multiplayer/:partyId/start - Start battle (leader only)
router.post('/multiplayer/:partyId/start', authenticate, asyncHandler(async (req, res) => {
  const { partyId } = req.params;
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
    `SELECT pm.user_id FROM party_members pm WHERE pm.party_id = $1`,
    [partyId]
  );

  const memberIds = membersResult.rows.map(r => r.user_id);

  // Update party status
  await query(
    "UPDATE parties SET status = 'in_battle' WHERE id = $1",
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

// GET /api/party/multiplayer/invites - Get pending invites for current user
router.get('/multiplayer/invites', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT pi.id, pi.party_id, pi.expires_at,
            p.name as party_name,
            u.username as inviter_username
     FROM party_invites pi
     JOIN parties p ON pi.party_id = p.id
     JOIN users u ON pi.inviter_id = u.id
     WHERE pi.invitee_id = $1
       AND pi.status = 'pending'
       AND pi.expires_at > NOW()
     ORDER BY pi.created_at DESC`,
    [req.user.userId]
  );

  res.json({ invites: result.rows });
}));

// POST /api/party/multiplayer/decline/:inviteId - Decline an invite
router.post('/multiplayer/decline/:inviteId', authenticate, asyncHandler(async (req, res) => {
  const { inviteId } = req.params;

  const result = await query(
    `UPDATE party_invites SET status = 'declined'
     WHERE id = $1 AND invitee_id = $2 AND status = 'pending'
     RETURNING party_id, inviter_id`,
    [inviteId, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invite not found or already processed', 404);
  }

  // Notify inviter via WebSocket
  partyWebsocket.declineInvite(parseInt(inviteId), req.user.userId);

  res.json({ success: true });
}));

export default router;
