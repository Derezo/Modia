const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Valid equipment slots (matches database enum)
const EQUIPMENT_SLOTS = ['main_hand', 'off_hand', 'head', 'body', 'legs', 'feet', 'accessory'];

// Rarity names by level
const RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// GET /api/inventory/:characterId - Get character's inventory
router.get('/:characterId', authenticate, asyncHandler(async (req, res) => {
  const { characterId } = req.params;

  // Verify character ownership
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  // Get inventory items
  const itemsResult = await query(
    `SELECT ci.id as instance_id, ci.quantity, ci.equipped_slot, ci.modifications,
            it.id as template_id, it.name, it.item_type, it.rarity,
            it.stat_bonuses, it.description
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1
     ORDER BY ci.equipped_slot IS NOT NULL DESC, it.item_type, it.name`,
    [characterId]
  );

  // Separate equipped and inventory items
  const equipped = {};
  const inventory = [];

  for (const item of itemsResult.rows) {
    const formattedItem = {
      instanceId: item.instance_id,
      templateId: item.template_id,
      name: item.name,
      type: item.item_type,
      rarity: RARITY_NAMES[item.rarity - 1] || 'common',
      quantity: item.quantity,
      baseStats: item.stat_bonuses,
      itemData: item.modifications,
      description: item.description
    };

    if (item.equipped_slot) {
      equipped[item.equipped_slot] = formattedItem;
    } else {
      inventory.push(formattedItem);
    }
  }

  res.json({ equipped, inventory });
}));

// POST /api/inventory/equip - Equip an item
router.post('/equip', authenticate, asyncHandler(async (req, res) => {
  const { characterId, itemInstanceId, slot } = req.body;

  // Validate slot
  if (!EQUIPMENT_SLOTS.includes(slot)) {
    throw new AppError('Invalid equipment slot', 400);
  }

  // Verify character ownership
  const charResult = await query(
    'SELECT id, in_battle FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (charResult.rows[0].in_battle) {
    throw new AppError('Cannot change equipment during battle', 400);
  }

  // Verify item ownership and get item info
  const itemResult = await query(
    `SELECT ci.id, ci.equipped_slot, it.item_type, it.equipment_slot
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.id = $1 AND ci.character_id = $2`,
    [itemInstanceId, characterId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found in inventory', 404);
  }

  const item = itemResult.rows[0];

  // Check if item is already equipped
  if (item.equipped_slot) {
    throw new AppError('Item is already equipped', 400);
  }

  // Validate item can be equipped in this slot
  const validSlots = getValidSlotsForItem(item.item_type);
  if (!validSlots.includes(slot)) {
    throw new AppError(`${item.item_type} cannot be equipped in ${slot}`, 400);
  }

  await withTransaction(async (client) => {
    // Unequip any item currently in this slot
    await client.query(
      `UPDATE character_items SET equipped_slot = NULL
       WHERE character_id = $1 AND equipped_slot = $2`,
      [characterId, slot]
    );

    // Equip the new item
    await client.query(
      'UPDATE character_items SET equipped_slot = $1 WHERE id = $2',
      [slot, itemInstanceId]
    );
  });

  // Return updated inventory
  const updatedInventory = await getCharacterInventory(characterId);
  res.json(updatedInventory);
}));

// POST /api/inventory/unequip - Unequip an item
router.post('/unequip', authenticate, asyncHandler(async (req, res) => {
  const { characterId, slot } = req.body;

  // Validate slot
  if (!EQUIPMENT_SLOTS.includes(slot)) {
    throw new AppError('Invalid equipment slot', 400);
  }

  // Verify character ownership
  const charResult = await query(
    'SELECT id, in_battle FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (charResult.rows[0].in_battle) {
    throw new AppError('Cannot change equipment during battle', 400);
  }

  // Unequip the item
  const result = await query(
    `UPDATE character_items SET equipped_slot = NULL
     WHERE character_id = $1 AND equipped_slot = $2
     RETURNING id`,
    [characterId, slot]
  );

  if (result.rows.length === 0) {
    throw new AppError('No item equipped in that slot', 400);
  }

  // Return updated inventory
  const updatedInventory = await getCharacterInventory(characterId);
  res.json(updatedInventory);
}));

// POST /api/inventory/use - Use a consumable item
router.post('/use', authenticate, asyncHandler(async (req, res) => {
  const { characterId, itemInstanceId, targetCharacterId } = req.body;

  // Verify character ownership
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  // Get item info
  const itemResult = await query(
    `SELECT ci.id, ci.quantity, it.item_type, it.stat_bonuses, it.effect_type, it.effect_value, it.name
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.id = $1 AND ci.character_id = $2`,
    [itemInstanceId, characterId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found in inventory', 404);
  }

  const item = itemResult.rows[0];

  // Verify it's a consumable
  if (item.item_type !== 'consumable') {
    throw new AppError('Item is not consumable', 400);
  }

  // Get target character (default to self)
  const targetId = targetCharacterId || characterId;
  const targetResult = await query(
    'SELECT id, hp_current, hp_max, mp_current, mp_max FROM characters WHERE id = $1 AND user_id = $2',
    [targetId, req.user.userId]
  );

  if (targetResult.rows.length === 0) {
    throw new AppError('Target character not found', 404);
  }

  const target = targetResult.rows[0];
  const stats = item.stat_bonuses || {};

  await withTransaction(async (client) => {
    // Apply item effects
    if (stats.hp_restore) {
      const newHp = Math.min(target.hp_max, target.hp_current + stats.hp_restore);
      await client.query(
        'UPDATE characters SET hp_current = $1 WHERE id = $2',
        [newHp, targetId]
      );
    }

    if (stats.mp_restore) {
      const newMp = Math.min(target.mp_max, target.mp_current + stats.mp_restore);
      await client.query(
        'UPDATE characters SET mp_current = $1 WHERE id = $2',
        [newMp, targetId]
      );
    }

    // Reduce quantity or remove item
    if (item.quantity > 1) {
      await client.query(
        'UPDATE character_items SET quantity = quantity - 1 WHERE id = $1',
        [itemInstanceId]
      );
    } else {
      await client.query(
        'DELETE FROM character_items WHERE id = $1',
        [itemInstanceId]
      );
    }
  });

  res.json({
    success: true,
    message: `Used ${item.name}`,
    effects: stats
  });
}));

// POST /api/inventory/discard - Discard an item
router.post('/discard', authenticate, asyncHandler(async (req, res) => {
  const { characterId, itemInstanceId, quantity } = req.body;

  // Verify character ownership
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  // Get item info
  const itemResult = await query(
    'SELECT id, quantity, equipped_slot FROM character_items WHERE id = $1 AND character_id = $2',
    [itemInstanceId, characterId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found in inventory', 404);
  }

  const item = itemResult.rows[0];

  // Can't discard equipped items
  if (item.equipped_slot) {
    throw new AppError('Unequip item before discarding', 400);
  }

  const discardQty = quantity || item.quantity;

  if (discardQty >= item.quantity) {
    // Remove entire stack
    await query('DELETE FROM character_items WHERE id = $1', [itemInstanceId]);
  } else {
    // Reduce quantity
    await query(
      'UPDATE character_items SET quantity = quantity - $1 WHERE id = $2',
      [discardQty, itemInstanceId]
    );
  }

  res.json({ success: true, discarded: discardQty });
}));

// Helper: Get valid equipment slots for item type
// Maps item_type enum to valid equipment_slot enum values
function getValidSlotsForItem(itemType) {
  const slotMap = {
    weapon: ['main_hand', 'off_hand'],
    armor: ['head', 'body', 'legs', 'feet'],
    accessory: ['accessory']
  };
  return slotMap[itemType] || [];
}

// Helper: Get character inventory (for returning after updates)
async function getCharacterInventory(characterId) {
  const itemsResult = await query(
    `SELECT ci.id as instance_id, ci.quantity, ci.equipped_slot, ci.modifications,
            it.id as template_id, it.name, it.item_type, it.rarity,
            it.stat_bonuses, it.description
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1
     ORDER BY ci.equipped_slot IS NOT NULL DESC, it.item_type, it.name`,
    [characterId]
  );

  const equipped = {};
  const inventory = [];

  for (const item of itemsResult.rows) {
    const formattedItem = {
      instanceId: item.instance_id,
      templateId: item.template_id,
      name: item.name,
      type: item.item_type,
      rarity: RARITY_NAMES[item.rarity - 1] || 'common',
      quantity: item.quantity,
      baseStats: item.stat_bonuses,
      itemData: item.modifications,
      description: item.description
    };

    if (item.equipped_slot) {
      equipped[item.equipped_slot] = formattedItem;
    } else {
      inventory.push(formattedItem);
    }
  }

  return { equipped, inventory };
}

module.exports = router;
