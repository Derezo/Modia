-- Item Listings System for Unique Items
-- ============================================
-- Supports trading individual item instances with modifications (augments, etc.)
-- Coexists with the order book system - order book for commodities, listings for unique items

-- ============================================
-- ITEM LISTINGS - Individual item sales
-- ============================================
CREATE TABLE item_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    character_item_id INTEGER NOT NULL REFERENCES character_items(id) ON DELETE CASCADE,
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    price INTEGER NOT NULL CHECK (price > 0),
    suggested_price INTEGER,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    -- Snapshot of item modifications at listing time (in case original is modified)
    modifications_snapshot JSONB DEFAULT '{}',
    CONSTRAINT unique_item_listing UNIQUE (character_item_id, status)
        DEFERRABLE INITIALLY DEFERRED
);

-- Indexes for common queries
CREATE INDEX idx_item_listings_template ON item_listings(item_template_id, status, price);
CREATE INDEX idx_item_listings_seller ON item_listings(seller_id, status);
CREATE INDEX idx_item_listings_active ON item_listings(status) WHERE status = 'active';
CREATE INDEX idx_item_listings_augments ON item_listings USING GIN (modifications_snapshot jsonb_path_ops);

-- ============================================
-- ITEM LISTING SALES - Purchase history for individual items
-- ============================================
CREATE TABLE item_listing_sales (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES item_listings(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    buyer_character_id INTEGER NOT NULL REFERENCES characters(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    price INTEGER NOT NULL,
    modifications JSONB DEFAULT '{}',
    sold_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_item_listing_sales_buyer ON item_listing_sales(buyer_id, sold_at DESC);
CREATE INDEX idx_item_listing_sales_seller ON item_listing_sales(seller_id, sold_at DESC);
CREATE INDEX idx_item_listing_sales_template ON item_listing_sales(item_template_id, sold_at DESC);

-- ============================================
-- FUNCTION: Update listing timestamp on modification
-- ============================================
CREATE OR REPLACE FUNCTION update_listing_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_listing_timestamp
BEFORE UPDATE ON item_listings
FOR EACH ROW
EXECUTE FUNCTION update_listing_timestamp();

-- ============================================
-- Add is_stackable to item_templates for easier querying
-- ============================================
ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS is_stackable BOOLEAN DEFAULT FALSE;

-- Update existing items - consumables and materials are stackable
UPDATE item_templates SET is_stackable = TRUE WHERE item_type IN ('consumable', 'material');
UPDATE item_templates SET is_stackable = FALSE WHERE item_type NOT IN ('consumable', 'material');
