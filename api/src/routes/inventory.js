import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { inventoryLimiter, gameReadLimiter } from '../middleware/gameplayRateLimiter.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Valid equipment slots (matches database enum)
const EQUIPMENT_SLOTS = ['main_hand', 'off_hand', 'head', 'body', 'legs', 'feet', 'accessory'];

// Rarity names by level
const RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Helper to get rarity name from ID
function getRarityName(rarityId) {
  return RARITY_NAMES[rarityId - 1] || 'common';
}

// Helper to format item for API response
function formatItem(item) {
  const modifications = item.modifications || {};

  return {
    instanceId: item.instance_id,
    templateId: item.template_id,
    // Use generated name if available, fallback to template name
    name: modifications.generatedName || item.name,
    displayName: modifications.generatedName || item.name,
    templateName: item.name,
    type: item.item_type,
    // Use rarity from modifications if available, fallback to template
    rarity: modifications.rarity
      ? getRarityName(modifications.rarity)
      : (RARITY_NAMES[item.rarity - 1] || 'common'),
    quantity: item.quantity,
    // Use scaled stats from generation, fallback to template
    baseStats: modifications.baseStats || item.stat_bonuses || {},
    bonusStats: modifications.bonusStats || {},
    augments: modifications.augments || [],
    material: modifications.material || null,
    itemData: modifications,
    description: item.description,
    // Equipment requirements for filtering
    level_requirement: item.level_requirement || 0,
    class_restriction: item.class_restriction || [],
    // Sprite ID for item icon display
    spriteId: item.sprite_id,
    // Equipment slot from template (for slot validation on client)
    equipmentSlot: item.equipment_slot || null,
    // Consumable effect (heal_hp, heal_mp, heal_both, revive, ...) so the
    // client can pick valid targets for out-of-battle use
    effectType: item.effect_type || null,
    effectValue: item.effect_value ?? null
  };
}

// GET /api/inventory/shared - Get user's shared inventory (unequipped items)
router.get('/shared', authenticate, gameReadLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Get all unequipped items owned by user (shared pool)
  const itemsResult = await query(
    `SELECT ci.id as instance_id, ci.quantity, ci.modifications,
            it.id as template_id, it.name, it.item_type, it.rarity,
            it.stat_bonuses, it.description, it.level_requirement, it.class_restriction,
            it.sprite_id, it.equipment_slot, it.effect_type, it.effect_value
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.user_id = $1 AND ci.equipped_slot IS NULL
     ORDER BY it.item_type, it.rarity DESC, it.name`,
    [userId]
  );

  const inventory = itemsResult.rows.map(item => formatItem(item));

  res.json({ inventory });
}));

// GET /api/inventory/:characterId - Get character's equipped items only
// Note: Use GET /api/inventory/shared for the shared inventory pool
router.get('/:characterId', authenticate, gameReadLimiter, asyncHandler(async (req, res) => {
  const { characterId } = req.params;

  // Verify character ownership
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  // Get equipped items only (character_id is set only for equipped items per migration 024)
  const itemsResult = await query(
    `SELECT ci.id as instance_id, ci.quantity, ci.equipped_slot, ci.modifications,
            it.id as template_id, it.name, it.item_type, it.rarity,
            it.stat_bonuses, it.description, it.level_requirement, it.class_restriction,
            it.sprite_id, it.equipment_slot
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1 AND ci.equipped_slot IS NOT NULL
     ORDER BY it.item_type, it.name`,
    [characterId]
  );

  // Build equipped map by slot
  const equipped = {};
  for (const item of itemsResult.rows) {
    equipped[item.equipped_slot] = formatItem(item);
  }

  res.json({ equipped });
}));

// POST /api/inventory/equip - Equip an item
router.post('/equip', authenticate, inventoryLimiter, asyncHandler(async (req, res) => {
  const { characterId, itemInstanceId, slot } = req.body;

  // Validate numeric inputs
  const parsedCharacterId = parseInt(characterId, 10);
  const parsedItemInstanceId = parseInt(itemInstanceId, 10);
  if (isNaN(parsedCharacterId)) {
    throw new AppError('Invalid character ID', 400);
  }
  if (isNaN(parsedItemInstanceId)) {
    throw new AppError('Invalid item instance ID', 400);
  }

  // Validate slot
  if (!EQUIPMENT_SLOTS.includes(slot)) {
    throw new AppError('Invalid equipment slot', 400);
  }

  await withTransaction(async (client) => {
    // Character-first locking is shared with battle creation. If battle start
    // wins the lock, this request observes in_battle=true and cannot mutate
    // equipment after the combat snapshot is captured.
    const charResult = await client.query(
      `SELECT id, level, class, race, in_battle
       FROM characters
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [parsedCharacterId, req.user.userId]
    );
    if (charResult.rows.length === 0) {
      throw new AppError('Character not found', 404);
    }
    const character = charResult.rows[0];
    if (character.in_battle) {
      throw new AppError('Cannot change equipment during battle', 400);
    }

    // Verify item ownership with FOR UPDATE lock - check both character inventory and shared pool
    const itemResult = await client.query(
      `SELECT ci.id, ci.equipped_slot, ci.character_id, ci.user_id, ci.listed,
              it.item_type, it.equipment_slot, it.name,
              it.level_requirement, it.class_restriction, it.race_restriction
       FROM character_items ci
       JOIN item_templates it ON ci.item_template_id = it.id
       WHERE ci.id = $1 AND (ci.character_id = $2 OR ci.user_id = $3)
       FOR UPDATE OF ci`,
      [parsedItemInstanceId, parsedCharacterId, req.user.userId]
    );

    if (itemResult.rows.length === 0) {
      throw new AppError('Item not found in inventory', 404);
    }

    const item = itemResult.rows[0];

    // Check if item is listed on marketplace
    if (item.listed) {
      throw new AppError('Cannot equip items listed on the marketplace. Cancel the listing first.', 400);
    }

    // Check if item is already equipped
    if (item.equipped_slot) {
      throw new AppError('Item is already equipped', 400);
    }

    // Validate level requirement
    if (item.level_requirement && character.level < item.level_requirement) {
      throw new AppError(`Requires level ${item.level_requirement} (you are level ${character.level})`, 400);
    }

    // Validate class restriction
    if (item.class_restriction && item.class_restriction.length > 0) {
      if (!item.class_restriction.includes(character.class)) {
        const allowedClasses = item.class_restriction.join(', ');
        throw new AppError(`Only ${allowedClasses} can equip this item`, 400);
      }
    }

    // Validate race restriction
    if (item.race_restriction && item.race_restriction.length > 0) {
      if (!item.race_restriction.includes(character.race)) {
        const allowedRaces = item.race_restriction.join(', ');
        throw new AppError(`Only ${allowedRaces} can equip this item`, 400);
      }
    }

    // Validate item can be equipped in this slot
    const validSlotsForItem = getValidSlotsForItem(item.item_type);
    if (!validSlotsForItem.includes(slot)) {
      throw new AppError(`${item.item_type} cannot be equipped in ${slot}`, 400);
    }

    // SECURITY: Validate template equipment_slot matches the requested slot
    // All items (weapons, armor, accessories) must match exactly.
    // Dual-wield is a planned feature (CHARACTER_PROGRESSION.md) but not yet implemented.
    // Allowing main_hand weapons in off_hand would double weapon stats until the passive exists.
    if (item.equipment_slot && item.equipment_slot !== slot) {
      throw new AppError(`${item.name} can only be equipped in the ${item.equipment_slot} slot`, 400);
    }

    // Unequip any item currently in this slot - move to shared pool
    await client.query(
      `UPDATE character_items
       SET equipped_slot = NULL, character_id = NULL, user_id = $3
       WHERE character_id = $1 AND equipped_slot = $2`,
      [parsedCharacterId, slot, req.user.userId]
    );

    // Equip the new item - transfer ownership from shared pool to character
    await client.query(
      `UPDATE character_items
       SET equipped_slot = $1, character_id = $2, user_id = NULL
       WHERE id = $3`,
      [slot, parsedCharacterId, parsedItemInstanceId]
    );
  });

  // Return updated inventory
  const updatedInventory = await getCharacterInventory(parsedCharacterId);
  res.json(updatedInventory);
}));

// POST /api/inventory/unequip - Unequip an item
router.post('/unequip', authenticate, inventoryLimiter, asyncHandler(async (req, res) => {
  const { characterId, slot } = req.body;

  // Validate numeric input
  const parsedCharacterId = parseInt(characterId, 10);
  if (isNaN(parsedCharacterId)) {
    throw new AppError('Invalid character ID', 400);
  }

  // Validate slot
  if (!EQUIPMENT_SLOTS.includes(slot)) {
    throw new AppError('Invalid equipment slot', 400);
  }

  await withTransaction(async (client) => {
    const charResult = await client.query(
      `SELECT id, in_battle
       FROM characters
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [parsedCharacterId, req.user.userId]
    );
    if (charResult.rows.length === 0) {
      throw new AppError('Character not found', 404);
    }
    if (charResult.rows[0].in_battle) {
      throw new AppError('Cannot change equipment during battle', 400);
    }

    const result = await client.query(
      `UPDATE character_items
       SET equipped_slot = NULL, character_id = NULL, user_id = $3
       WHERE character_id = $1 AND equipped_slot = $2
       RETURNING id`,
      [parsedCharacterId, slot, req.user.userId]
    );
    if (result.rows.length === 0) {
      throw new AppError('No item equipped in that slot', 400);
    }
  });

  // Return updated inventory
  const updatedInventory = await getCharacterInventory(parsedCharacterId);
  res.json(updatedInventory);
}));

// POST /api/inventory/use - Use a consumable item from shared pool
router.post('/use', authenticate, inventoryLimiter, asyncHandler(async (req, res) => {
  const { itemInstanceId, targetCharacterId } = req.body;
  const userId = req.user.userId;

  // Validate numeric inputs
  const parsedItemInstanceId = parseInt(itemInstanceId, 10);
  const parsedTargetCharacterId = parseInt(targetCharacterId, 10);
  if (isNaN(parsedItemInstanceId)) {
    throw new AppError('Invalid item instance ID', 400);
  }
  if (isNaN(parsedTargetCharacterId)) {
    throw new AppError('Target character ID is required', 400);
  }

  const usedItem = await withTransaction(async (client) => {
    const targetResult = await client.query(
      `SELECT id, hp_current, hp_max, mp_current, mp_max, in_battle
       FROM characters
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [parsedTargetCharacterId, userId]
    );
    if (targetResult.rows.length === 0) {
      throw new AppError('Target character not found', 404);
    }
    const target = targetResult.rows[0];
    if (target.in_battle) {
      throw new AppError('Cannot use inventory items during battle', 400);
    }

    const itemResult = await client.query(
      `SELECT ci.id, ci.quantity, it.item_type, it.stat_bonuses,
              it.effect_type, it.effect_value, it.name
       FROM character_items ci
       JOIN item_templates it ON ci.item_template_id = it.id
       WHERE ci.id = $1 AND ci.user_id = $2
       FOR UPDATE OF ci`,
      [parsedItemInstanceId, userId]
    );
    if (itemResult.rows.length === 0) {
      throw new AppError('Item not found in shared inventory', 404);
    }
    const item = itemResult.rows[0];
    if (item.item_type !== 'consumable') {
      throw new AppError('Item is not consumable', 400);
    }
    const stats = item.stat_bonuses || {};

    // Derive effect from effect_type/effect_value (canonical), falling back to stat_bonuses
    // Canonical types: heal_hp, heal_mp, heal_both, cure_poison, cure_all, revive
    const effectType = item.effect_type;
    const effectValue = item.effect_value || 0;
    const appliedEffects = {};
    let effectApplied = false;

    // Check for revive on living target BEFORE decrementing
    if (effectType === 'revive' && target.hp_current > 0) {
      throw new AppError('Cannot use revive item on a living character', 400);
    }

    // Check for heal on dead target BEFORE decrementing
    if (effectType && effectType !== 'revive' && target.hp_current <= 0) {
      throw new AppError('Cannot use this item on a defeated character', 400);
    }

    // Apply effects based on effect_type (matches battle actionProcessor.js semantics)
    if (effectType === 'heal_hp') {
      const healAmount = Math.min(effectValue, target.hp_max - target.hp_current);
      if (healAmount > 0) {
        await client.query(
          'UPDATE characters SET hp_current = hp_current + $1 WHERE id = $2',
          [healAmount, parsedTargetCharacterId]
        );
        appliedEffects.hp_restored = healAmount;
        effectApplied = true;
      }
    } else if (effectType === 'heal_mp') {
      const mpAmount = Math.min(effectValue, target.mp_max - target.mp_current);
      if (mpAmount > 0) {
        await client.query(
          'UPDATE characters SET mp_current = mp_current + $1 WHERE id = $2',
          [mpAmount, parsedTargetCharacterId]
        );
        appliedEffects.mp_restored = mpAmount;
        effectApplied = true;
      }
    } else if (effectType === 'heal_both') {
      // heal_both: HP = effectValue, MP = effectValue / 2 (per stateEvaluator/actionProcessor)
      const healAmount = Math.min(effectValue, target.hp_max - target.hp_current);
      const mpAmount = Math.min(Math.floor(effectValue / 2), target.mp_max - target.mp_current);
      if (healAmount > 0 || mpAmount > 0) {
        await client.query(
          'UPDATE characters SET hp_current = LEAST(hp_current + $1, hp_max), mp_current = LEAST(mp_current + $2, mp_max) WHERE id = $3',
          [healAmount, mpAmount, parsedTargetCharacterId]
        );
        if (healAmount > 0) appliedEffects.hp_restored = healAmount;
        if (mpAmount > 0) appliedEffects.mp_restored = mpAmount;
        effectApplied = true;
      }
    } else if (effectType === 'revive') {
      // revive only works when hp_current <= 0, sets HP to effectValue% of hp_max
      const reviveHp = Math.floor(target.hp_max * effectValue / 100);
      await client.query(
        'UPDATE characters SET hp_current = $1 WHERE id = $2',
        [reviveHp, parsedTargetCharacterId]
      );
      appliedEffects.revived = true;
      appliedEffects.hp_restored = reviveHp;
      effectApplied = true;
    } else if (effectType === 'cure_poison' || effectType === 'cure_all') {
      // Out-of-battle status effects are not persistent - these items only work in battle
      // Throw error BEFORE decrementing to preserve the item for actual battle use
      throw new AppError('There is no status effect to cure outside battle', 400);
    }

    // Fallback to stat_bonuses.hp_restore/mp_restore if no effect_type
    if (!effectApplied && (stats.hp_restore || stats.mp_restore)) {
      if (stats.hp_restore) {
        const healAmount = Math.min(stats.hp_restore, target.hp_max - target.hp_current);
        if (healAmount > 0) {
          await client.query(
            'UPDATE characters SET hp_current = hp_current + $1 WHERE id = $2',
            [healAmount, parsedTargetCharacterId]
          );
          appliedEffects.hp_restored = healAmount;
          effectApplied = true;
        }
      }

      if (stats.mp_restore) {
        const mpAmount = Math.min(stats.mp_restore, target.mp_max - target.mp_current);
        if (mpAmount > 0) {
          await client.query(
            'UPDATE characters SET mp_current = mp_current + $1 WHERE id = $2',
            [mpAmount, parsedTargetCharacterId]
          );
          appliedEffects.mp_restored = mpAmount;
          effectApplied = true;
        }
      }
    }

    // Reject BEFORE decrementing if no effect was applicable
    if (!effectApplied) {
      throw new AppError('This item has no out-of-battle effect', 400);
    }

    // Reduce quantity or remove item
    if (item.quantity > 1) {
      await client.query(
        'UPDATE character_items SET quantity = quantity - 1 WHERE id = $1',
        [parsedItemInstanceId]
      );
    } else {
      await client.query(
        'DELETE FROM character_items WHERE id = $1',
        [parsedItemInstanceId]
      );
    }

    return { name: item.name, effects: appliedEffects };
  });

  res.json({
    success: true,
    message: `Used ${usedItem.name}`,
    effects: usedItem.effects
  });
}));

// POST /api/inventory/discard - Discard an item from shared pool
router.post('/discard', authenticate, inventoryLimiter, asyncHandler(async (req, res) => {
  const { itemInstanceId } = req.body;
  const userId = req.user.userId;

  // Validate numeric input
  const parsedItemInstanceId = parseInt(itemInstanceId, 10);
  if (isNaN(parsedItemInstanceId)) {
    throw new AppError('Invalid item instance ID', 400);
  }

  // SECURITY: Strict quantity validation to prevent exploits
  // If quantity not provided, we'll discard all after checking ownership
  let discardQty;
  if (req.body.quantity !== undefined) {
    discardQty = parseInt(req.body.quantity, 10);
    if (!Number.isInteger(discardQty) || isNaN(discardQty)) {
      throw new AppError('Quantity must be a valid integer', 400);
    }
    if (discardQty < 1) {
      throw new AppError('Quantity must be at least 1', 400);
    }
  }

  // Use transaction with FOR UPDATE to prevent race conditions
  const result = await withTransaction(async (client) => {
    // Get item info with lock - check shared pool ownership
    const itemResult = await client.query(
      'SELECT id, quantity, equipped_slot, listed FROM character_items WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [parsedItemInstanceId, userId]
    );

    if (itemResult.rows.length === 0) {
      throw new AppError('Item not found in shared inventory', 404);
    }

    const item = itemResult.rows[0];

    // Check if listed on marketplace
    if (item.listed) {
      throw new AppError('Cannot discard items listed on the marketplace. Cancel the listing first.', 400);
    }

    // Shared pool items should never be equipped, but check anyway
    if (item.equipped_slot) {
      throw new AppError('Cannot discard equipped items', 400);
    }

    // If no quantity specified, discard all; otherwise validate against owned amount
    const finalDiscardQty = discardQty !== undefined ? discardQty : item.quantity;

    if (finalDiscardQty > item.quantity) {
      throw new AppError(`Cannot discard ${finalDiscardQty} items, only have ${item.quantity}`, 400);
    }

    if (finalDiscardQty >= item.quantity) {
      // Remove entire stack
      await client.query('DELETE FROM character_items WHERE id = $1', [parsedItemInstanceId]);
    } else {
      // Reduce quantity
      await client.query(
        'UPDATE character_items SET quantity = quantity - $1 WHERE id = $2',
        [finalDiscardQty, parsedItemInstanceId]
      );
    }

    return finalDiscardQty;
  });

  res.json({ success: true, discarded: result });
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
            it.stat_bonuses, it.description, it.level_requirement, it.class_restriction,
            it.sprite_id, it.equipment_slot
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1
     ORDER BY ci.equipped_slot IS NOT NULL DESC, it.item_type, it.name`,
    [characterId]
  );

  const equipped = {};
  const inventory = [];

  for (const item of itemsResult.rows) {
    const formattedItem = formatItem(item);

    if (item.equipped_slot) {
      equipped[item.equipped_slot] = formattedItem;
    } else {
      inventory.push(formattedItem);
    }
  }

  return { equipped, inventory };
}

export default router;
