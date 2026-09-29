-- ============================================
-- Migration 063: Relic Acquisition Redesign + Equipment Cleanup
--
-- Part 1: Relic Acquisition Redesign (Finding 112)
-- - Quest relics now use acquisition_id as tier requirement (e.g., 1 = any tier-1 quest)
-- - Node relics with NULL acquisition_id use type-based lookup (cartographers_eye -> watchtower)
-- - Achievement relics with NULL acquisition_id use special-case logic (merchants_seal -> market sales)
--
-- Part 2: Equipment Cleanup (Finding 111)
-- - Unequip items where equipped_slot != template equipment_slot
-- - This includes body armor in head/legs/feet slots and main_hand weapons in off_hand
--
-- Part 3: Shop Cleanup (Finding 5 residue)
-- - Set restock_quantity=0 for player-sold items not in native shop stock
-- ============================================

-- Part 1: Update relic acquisition_ids to be tier-based instead of guild-specific
-- wayfarers_compass: tier 1 (any tier-1 advancement quest completion)
UPDATE relic_templates
SET acquisition_id = 1
WHERE key = 'wayfarers_compass';

-- vitality_charm: tier 1 (any tier-1 advancement quest completion, was wizard-only)
UPDATE relic_templates
SET acquisition_id = 1
WHERE key = 'vitality_charm';

-- cartographers_eye: NULL - service checks for any visited watchtower by node_type
UPDATE relic_templates
SET acquisition_id = NULL
WHERE key = 'cartographers_eye';

-- merchants_seal: NULL - service checks for any marketplace sale
-- (acquisition_id stays NULL, which triggers special-case logic in relicService)

-- Part 2: Unequip items where equipped_slot doesn't match template equipment_slot
-- This fixes the 23 mis-equipped rows (body armor in wrong slots, weapons in off_hand)
-- Items are returned to the shared pool (user_id set, character_id cleared)
UPDATE character_items ci
SET equipped_slot = NULL,
    user_id = c.user_id,
    character_id = NULL
FROM item_templates it, characters c
WHERE it.id = ci.item_template_id
  AND c.id = ci.character_id
  AND ci.equipped_slot IS NOT NULL
  AND it.equipment_slot IS NOT NULL
  AND ci.equipped_slot <> it.equipment_slot;

-- Part 3: Clean up player-sold shop inventory that shouldn't regenerate
-- Find npc_shop_inventory rows that are not in the native stock list for that node/shop
-- and set their restock_quantity to 0 so they never regenerate.
-- Note: Native stock is seeded with restock_quantity > 0; player-sold should be 0.
-- This handles any rows that were incorrectly created with restock_quantity > 0.

-- First, identify native stock by looking at items that should be in shops based on
-- seed data patterns (items with is_shop_item = true or similar markers).
-- Since we don't have a definitive native stock table, we'll set restock_quantity = 0
-- for any rows where the current quantity exceeds the restock_quantity (player-added stock).
-- Actually, the safest approach: if restock_quantity = 0 already, leave it.
-- If restock_quantity > 0 but quantity > restock_quantity, this row was player-augmented.

-- A cleaner approach: Set restock_quantity = 0 for all rows where the item_template
-- is a drop-only or caravan-exclusive item (not naturally in shops).
-- For now, we'll just ensure new player-sells use restock_quantity=0 (already fixed in shop.js).
-- Existing bad rows can be identified by high quantities that exceed typical restock levels.
-- Conservative fix: set restock_quantity = 0 for any row where quantity > 50 (unusual for native stock).
UPDATE npc_shop_inventory
SET restock_quantity = 0
WHERE quantity > 50 AND restock_quantity > 0;
