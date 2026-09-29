-- Rollback for migration 066: Restore original item_listing_sales FK behavior
--
-- NOT NULL is intentionally not restored. Once the forward migration has done
-- its job, rows orphaned by listing deletes keep listing_id = NULL, and a
-- SET NOT NULL would fail and leave `migrate:rollback` stuck on 066 (and so
-- unable to reach 065 or earlier). A nullable column is harmless to older
-- code, and Postgres accepts the FK below with NULL values present, so this
-- rollback always succeeds and sales history is kept.

SET LOCAL lock_timeout = '5s';

-- Step 1: Drop the modified constraint
ALTER TABLE item_listing_sales
  DROP CONSTRAINT IF EXISTS item_listing_sales_listing_id_fkey;

-- Step 2: Re-add the original FK (no ON DELETE action)
ALTER TABLE item_listing_sales
  ADD CONSTRAINT item_listing_sales_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES item_listings(id);
