-- Rollback for migration 066: Restore original item_listing_sales FK behavior
--
-- Note: This rollback sets listing_id back to NOT NULL, which may fail if any
-- rows have listing_id = NULL (from cascade deletes during the forward migration).
-- Run a cleanup query first if needed.

-- Step 1: Drop the modified constraint
ALTER TABLE item_listing_sales
  DROP CONSTRAINT IF EXISTS item_listing_sales_listing_id_fkey;

-- Step 2: Restore NOT NULL (may fail if NULLs exist)
-- If this fails, you'll need to delete rows with NULL listing_id first:
--   DELETE FROM item_listing_sales WHERE listing_id IS NULL;
ALTER TABLE item_listing_sales
  ALTER COLUMN listing_id SET NOT NULL;

-- Step 3: Re-add the original FK (no ON DELETE action)
ALTER TABLE item_listing_sales
  ADD CONSTRAINT item_listing_sales_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES item_listings(id);
