-- Migration: 024_shared_inventory.sql
-- Description: Convert per-character inventory to user-level shared inventory
-- Equipment remains per-character, but unequipped items are shared across party

-- Step 1: Add user_id column to character_items for shared inventory
ALTER TABLE character_items
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Step 1b: Add listed flag to track items on marketplace
ALTER TABLE character_items
  ADD COLUMN IF NOT EXISTS listed BOOLEAN DEFAULT FALSE;

-- Step 2: Create index for efficient user-level queries
CREATE INDEX IF NOT EXISTS idx_character_items_user ON character_items(user_id);

-- Step 3: Make character_id nullable FIRST (before clearing values)
ALTER TABLE character_items
  ALTER COLUMN character_id DROP NOT NULL;

-- Step 4: Migrate existing unequipped items to user-level ownership
-- Set user_id based on the character's owner
UPDATE character_items ci
SET user_id = (
  SELECT c.user_id
  FROM characters c
  WHERE c.id = ci.character_id
)
WHERE ci.equipped_slot IS NULL AND ci.user_id IS NULL;

-- Step 5: Clear character_id on unequipped items (now owned by user)
UPDATE character_items
SET character_id = NULL
WHERE equipped_slot IS NULL AND user_id IS NOT NULL;

-- Step 6: Add ownership constraint
-- Either: equipped items must have character_id
-- Or: unequipped items must have user_id (and no character_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'character_items' AND constraint_name = 'check_item_ownership'
  ) THEN
    ALTER TABLE character_items
      ADD CONSTRAINT check_item_ownership CHECK (
        (equipped_slot IS NOT NULL AND character_id IS NOT NULL) OR
        (equipped_slot IS NULL AND user_id IS NOT NULL AND character_id IS NULL)
      );
  END IF;
END $$;

-- Step 7: Add index for equipped items query pattern
CREATE INDEX IF NOT EXISTS idx_character_items_equipped_char ON character_items(character_id)
  WHERE character_id IS NOT NULL AND equipped_slot IS NOT NULL;

-- Step 8: Add index for shared inventory query pattern
CREATE INDEX IF NOT EXISTS idx_character_items_shared ON character_items(user_id)
  WHERE user_id IS NOT NULL AND equipped_slot IS NULL;

-- Note: After this migration:
-- - Equipped items have: character_id set, user_id NULL, equipped_slot set
-- - Shared inventory items have: character_id NULL, user_id set, equipped_slot NULL
-- - Equipping: Sets character_id and equipped_slot, clears user_id
-- - Unequipping: Clears character_id and equipped_slot, sets user_id
