-- Migration: Add 'expired' status to order_status enum
-- For automatic expiration of marketplace orders after 7 days

-- Add 'expired' to the order_status enum
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'expired';

-- Add index for efficient expiration queries
CREATE INDEX IF NOT EXISTS idx_market_orders_expiration
ON market_orders (status, created_at)
WHERE status IN ('open', 'partial');

-- Optional: Add expires_at column if we want explicit expiration dates
-- (Already exists in the schema but may not be populated)
-- UPDATE market_orders SET expires_at = created_at + INTERVAL '7 days' WHERE expires_at IS NULL;
