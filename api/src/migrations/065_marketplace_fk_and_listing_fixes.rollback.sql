-- Rollback Migration 065: Marketplace FK constraints and listing fixes
--
-- This reverses the FK constraint changes but cannot undo the data fixes

SET LOCAL lock_timeout = '5s';

-- =====================================================
-- PART 0: Restore UNIQUE (character_item_id, status) on item_listings
-- =====================================================
-- The forward migration allows many historical rows per (item, status).
-- The old constraint does not, so keep the newest row per pair and drop the
-- rest. Runs after rollback 066, so item_listing_sales.listing_id is nullable:
-- detach any sales rows from the dropped listings first (sales history kept).
WITH dupes AS (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY character_item_id, status ORDER BY id DESC
    ) AS rn
    FROM item_listings
  ) ranked
  WHERE rn > 1
)
UPDATE item_listing_sales SET listing_id = NULL
WHERE listing_id IN (SELECT id FROM dupes);

DELETE FROM item_listings il
USING (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY character_item_id, status ORDER BY id DESC
    ) AS rn
    FROM item_listings
  ) ranked
  WHERE rn > 1
) d
WHERE il.id = d.id;

DROP INDEX IF EXISTS uniq_item_listings_active_item;
ALTER TABLE item_listings DROP CONSTRAINT IF EXISTS unique_item_listing;
ALTER TABLE item_listings
  ADD CONSTRAINT unique_item_listing UNIQUE (character_item_id, status)
  DEFERRABLE INITIALLY DEFERRED;

-- =====================================================
-- PART 1: Restore original FK constraints
-- =====================================================

-- marketplace_audit: restore NOT NULL and original FKs
ALTER TABLE marketplace_audit
  DROP CONSTRAINT IF EXISTS marketplace_audit_user_id_fkey,
  DROP CONSTRAINT IF EXISTS marketplace_audit_character_id_fkey;

-- Note: Cannot restore NOT NULL if there are NULL values
-- ALTER TABLE marketplace_audit ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE marketplace_audit
  ADD CONSTRAINT marketplace_audit_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id),
  ADD CONSTRAINT marketplace_audit_character_id_fkey
    FOREIGN KEY (character_id) REFERENCES characters(id);

-- market_trades: restore original FKs
ALTER TABLE market_trades
  DROP CONSTRAINT IF EXISTS market_trades_buyer_id_fkey,
  DROP CONSTRAINT IF EXISTS market_trades_seller_id_fkey;

ALTER TABLE market_trades
  ADD CONSTRAINT market_trades_buyer_id_fkey
    FOREIGN KEY (buyer_id) REFERENCES users(id),
  ADD CONSTRAINT market_trades_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES users(id);

-- item_listing_sales: restore original FKs
ALTER TABLE item_listing_sales
  DROP CONSTRAINT IF EXISTS item_listing_sales_buyer_id_fkey,
  DROP CONSTRAINT IF EXISTS item_listing_sales_seller_id_fkey,
  DROP CONSTRAINT IF EXISTS item_listing_sales_buyer_character_id_fkey;

ALTER TABLE item_listing_sales
  ADD CONSTRAINT item_listing_sales_buyer_id_fkey
    FOREIGN KEY (buyer_id) REFERENCES users(id),
  ADD CONSTRAINT item_listing_sales_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES users(id),
  ADD CONSTRAINT item_listing_sales_buyer_character_id_fkey
    FOREIGN KEY (buyer_character_id) REFERENCES characters(id);

-- item_escrow: restore original FK
ALTER TABLE item_escrow
  DROP CONSTRAINT IF EXISTS item_escrow_character_id_fkey;

ALTER TABLE item_escrow
  ADD CONSTRAINT item_escrow_character_id_fkey
    FOREIGN KEY (character_id) REFERENCES characters(id);

-- Note: Data changes (listed flag backfill, cancelled listings, released reservations)
-- cannot be rolled back automatically

DO $$ BEGIN
  RAISE NOTICE 'Rollback 065 completed - note: data changes cannot be reversed';
END $$;
