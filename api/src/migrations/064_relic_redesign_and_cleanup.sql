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
-- Before this release, POST /shops/.../sell created new npc_shop_inventory rows
-- with restock_quantity = the sold quantity, so a drop-only or caravan item
-- sold into a shop regenerated forever. Native stock is fully defined by
-- SHOP_STOCK (api/src/db/templates/items.js); seedShopInventory inserts one
-- row per (shop_type, templateId) with restock_quantity = qty. Match that
-- list exactly rather than guessing from quantities.
--
-- KEEP IN SYNC: the VALUES list below must equal SHOP_STOCK. The unit test
-- migration064ShopStock.unit.test.js fails if the two drift apart.
CREATE TEMP TABLE migration_064_native_stock (
  shop_type VARCHAR(50) NOT NULL,
  item_template_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  PRIMARY KEY (shop_type, item_template_id)
) ON COMMIT DROP;

INSERT INTO migration_064_native_stock (shop_type, item_template_id, qty) VALUES
    ('blacksmith', 1, 10),
    ('blacksmith', 4, 8),
    ('blacksmith', 6, 8),
    ('blacksmith', 7, 10),
    ('blacksmith', 9, 8),
    ('blacksmith', 16, 6),
    ('blacksmith', 18, 6),
    ('blacksmith', 21, 10),
    ('blacksmith', 23, 10),
    ('blacksmith', 2, 4),
    ('blacksmith', 8, 4),
    ('blacksmith', 17, 3),
    ('blacksmith', 19, 3),
    ('blacksmith', 22, 4),
    ('blacksmith', 24, 4),
    ('blacksmith', 25, 3),
    ('apothecary', 12, 20),
    ('apothecary', 13, 15),
    ('apothecary', 14, 10),
    ('apothecary', 29, 8),
    ('apothecary', 30, 6),
    ('apothecary', 31, 3),
    ('apothecary', 32, 5),
    ('apothecary', 15, 2),
    ('farm', 12, 15),
    ('farm', 13, 10),
    ('farm', 14, 8);

-- 1) Player-sold rows (not native to that shop type) never regenerate
UPDATE npc_shop_inventory s
SET restock_quantity = 0
WHERE s.restock_quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM migration_064_native_stock n
    WHERE n.shop_type = s.shop_type
      AND n.item_template_id = s.item_template_id
  );

-- 2) Native rows get their seeded restock level back (undoes any drift)
UPDATE npc_shop_inventory s
SET restock_quantity = n.qty
FROM migration_064_native_stock n
WHERE n.shop_type = s.shop_type
  AND n.item_template_id = s.item_template_id
  AND s.restock_quantity IS DISTINCT FROM n.qty;
