const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { MAX_PARTY_SIZE, MAX_BATTLE_PARTY_SIZE } = require('../config/constants');

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

module.exports = router;
