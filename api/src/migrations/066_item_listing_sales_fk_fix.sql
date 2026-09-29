-- Migration 066: Fix item_listing_sales.listing_id FK constraint
--
-- Problem: When a player buys equipment from the marketplace and then sells it
-- to an NPC shop, the character_items deletion cascades to item_listings (via
-- ON DELETE CASCADE), but item_listing_sales.listing_id has no ON DELETE action.
-- This causes a FK violation (error 23503 -> 400 "Invalid reference").
--
-- Solution: Make listing_id nullable and add ON DELETE SET NULL so the cascade
-- chain doesn't break. The sales history is preserved with listing_id = NULL.

-- Step 1: Drop the existing constraint
ALTER TABLE item_listing_sales
  DROP CONSTRAINT IF EXISTS item_listing_sales_listing_id_fkey;

-- Step 2: Make listing_id nullable (was NOT NULL)
ALTER TABLE item_listing_sales
  ALTER COLUMN listing_id DROP NOT NULL;

-- Step 3: Re-add the FK with ON DELETE SET NULL
ALTER TABLE item_listing_sales
  ADD CONSTRAINT item_listing_sales_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES item_listings(id) ON DELETE SET NULL;

-- Verification
DO $$
DECLARE
  fk_action TEXT;
BEGIN
  SELECT confdeltype INTO fk_action
  FROM pg_constraint
  WHERE conname = 'item_listing_sales_listing_id_fkey';

  -- 'n' = SET NULL
  ASSERT fk_action = 'n',
    'Migration failed: listing_id FK should have ON DELETE SET NULL';

  RAISE NOTICE 'Migration 066 completed successfully';
END $$;
