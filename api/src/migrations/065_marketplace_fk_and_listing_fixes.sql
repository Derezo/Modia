-- Migration 065: Marketplace FK constraints and listing fixes
--
-- This migration:
-- 1. Updates FK constraints on marketplace tables to use ON DELETE SET NULL
--    so deleting a character or user with marketplace history doesn't cause 500 errors
-- 2. Backfills character_items.listed = TRUE for items with active item_listings
-- 3. Cancels any active listing whose item is equipped (data integrity fix)
-- 4. Releases stranded gold_reservations for filled orders
--
-- Part 3 first replaces item_listings' UNIQUE (character_item_id, status)
-- constraint with an active-only unique index. The old deferred constraint
-- allowed only ONE historical row per status, so cancelling an equipped
-- item's listing when the item already had a cancelled listing (list ->
-- cancel -> relist -> equip) failed at COMMIT and aborted this migration.
--
-- Runs after the PM2 reload against live traffic. DROP CONSTRAINT on an FK
-- takes ACCESS EXCLUSIVE on the referenced users/characters tables; fail fast
-- rather than queue every API query behind a blocked lock request. If this
-- times out, the transaction rolls back cleanly: re-run `npm run db:migrate`.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- =====================================================
-- PART 1: Update FK constraints to ON DELETE SET NULL
-- =====================================================

-- marketplace_audit: user_id and character_id
ALTER TABLE marketplace_audit
  DROP CONSTRAINT IF EXISTS marketplace_audit_user_id_fkey,
  DROP CONSTRAINT IF EXISTS marketplace_audit_character_id_fkey;

ALTER TABLE marketplace_audit
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE marketplace_audit
  ADD CONSTRAINT marketplace_audit_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT marketplace_audit_character_id_fkey
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;

-- market_trades: buyer_id and seller_id
ALTER TABLE market_trades
  DROP CONSTRAINT IF EXISTS market_trades_buyer_id_fkey,
  DROP CONSTRAINT IF EXISTS market_trades_seller_id_fkey;

ALTER TABLE market_trades
  ALTER COLUMN buyer_id DROP NOT NULL,
  ALTER COLUMN seller_id DROP NOT NULL;

ALTER TABLE market_trades
  ADD CONSTRAINT market_trades_buyer_id_fkey
    FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT market_trades_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL;

-- item_listing_sales: buyer_id, seller_id, buyer_character_id
ALTER TABLE item_listing_sales
  DROP CONSTRAINT IF EXISTS item_listing_sales_buyer_id_fkey,
  DROP CONSTRAINT IF EXISTS item_listing_sales_seller_id_fkey,
  DROP CONSTRAINT IF EXISTS item_listing_sales_buyer_character_id_fkey;

ALTER TABLE item_listing_sales
  ALTER COLUMN buyer_id DROP NOT NULL,
  ALTER COLUMN seller_id DROP NOT NULL,
  ALTER COLUMN buyer_character_id DROP NOT NULL;

ALTER TABLE item_listing_sales
  ADD CONSTRAINT item_listing_sales_buyer_id_fkey
    FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT item_listing_sales_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT item_listing_sales_buyer_character_id_fkey
    FOREIGN KEY (buyer_character_id) REFERENCES characters(id) ON DELETE SET NULL;

-- item_escrow: character_id (historical context, can be NULL after character deletion)
ALTER TABLE item_escrow
  DROP CONSTRAINT IF EXISTS item_escrow_character_id_fkey;

ALTER TABLE item_escrow
  ALTER COLUMN character_id DROP NOT NULL;

ALTER TABLE item_escrow
  ADD CONSTRAINT item_escrow_character_id_fkey
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;

-- =====================================================
-- PART 2: Backfill character_items.listed = TRUE
-- =====================================================

-- Set listed = TRUE for items with active item_listings
UPDATE character_items ci
SET listed = TRUE
WHERE ci.listed IS NOT TRUE
  AND EXISTS (
    SELECT 1 FROM item_listings il
    WHERE il.character_item_id = ci.id
      AND il.status = 'active'
  );

-- =====================================================
-- PART 3: Cancel listings for equipped items
-- =====================================================

-- Only one ACTIVE listing per item is an invariant; any number of historical
-- (cancelled / sold / expired) rows per item is legitimate. Swap the
-- (character_item_id, status) constraint for an active-only unique index so
-- the cancel below (and a second cancel of a relisted item at runtime,
-- cancelItemListing) cannot collide with an older cancelled row.
ALTER TABLE item_listings DROP CONSTRAINT IF EXISTS unique_item_listing;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_item_listings_active_item
  ON item_listings (character_item_id)
  WHERE status = 'active';

-- Cancel any active listing whose item is currently equipped
-- This is a data integrity fix - equipped items should not be listed
UPDATE item_listings il
SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
WHERE il.status = 'active'
  AND EXISTS (
    SELECT 1 FROM character_items ci
    WHERE ci.id = il.character_item_id
      AND ci.equipped_slot IS NOT NULL
  );

-- Clear the listed flag for these items
UPDATE character_items ci
SET listed = FALSE,
    modifications = ci.modifications - 'listed'
WHERE ci.equipped_slot IS NOT NULL
  AND ci.listed = TRUE;

-- =====================================================
-- PART 4: Release stranded gold_reservations
-- =====================================================

-- Return gold to users and delete stranded reservations
-- for orders that are already filled
-- Aggregate first to handle users with multiple stranded reservations
-- MAX_GOLD = 2147483647 (PostgreSQL INT max, from shared/constants.js)
WITH stranded AS (
  SELECT gr.user_id, SUM(gr.amount)::bigint AS total_amount
  FROM gold_reservations gr
  JOIN market_orders mo ON mo.id = gr.order_id
  WHERE mo.status = 'filled'
  GROUP BY gr.user_id
)
UPDATE users u
SET gold = LEAST(u.gold + s.total_amount, 2147483647)::int
FROM stranded s
WHERE u.id = s.user_id;

DELETE FROM gold_reservations gr
WHERE EXISTS (
  SELECT 1 FROM market_orders mo
  WHERE mo.id = gr.order_id
    AND mo.status = 'filled'
);

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
DECLARE
  stranded_count INTEGER;
  equipped_listed_count INTEGER;
BEGIN
  -- Verify no stranded reservations for filled orders
  SELECT COUNT(*) INTO stranded_count
  FROM gold_reservations gr
  JOIN market_orders mo ON mo.id = gr.order_id
  WHERE mo.status = 'filled';

  ASSERT stranded_count = 0,
    'Migration failed: stranded gold_reservations still exist';

  -- Verify no equipped items are listed
  SELECT COUNT(*) INTO equipped_listed_count
  FROM character_items
  WHERE equipped_slot IS NOT NULL AND listed = TRUE;

  ASSERT equipped_listed_count = 0,
    'Migration failed: equipped items still have listed flag';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_item_listing'
  ), 'Migration failed: unique_item_listing constraint still present';

  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'item_listings' AND indexname = 'uniq_item_listings_active_item'
  ), 'Migration failed: active-only listing index missing';

  RAISE NOTICE 'Migration 065 completed successfully';
END $$;
