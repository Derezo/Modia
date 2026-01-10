-- Migration 015: Marketplace Audit Log
-- Tracks all marketplace operations for security and debugging

CREATE TABLE marketplace_audit (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    character_id INTEGER REFERENCES characters(id),
    order_id INTEGER REFERENCES market_orders(id) ON DELETE SET NULL,
    item_template_id INTEGER REFERENCES item_templates(id),

    -- Event details stored as JSONB for flexibility
    event_data JSONB NOT NULL DEFAULT '{}',

    -- Request context
    ip_address INET,
    user_agent TEXT,

    -- Result
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX idx_marketplace_audit_user ON marketplace_audit(user_id, created_at DESC);
CREATE INDEX idx_marketplace_audit_event ON marketplace_audit(event_type, created_at DESC);
CREATE INDEX idx_marketplace_audit_order ON marketplace_audit(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_marketplace_audit_item ON marketplace_audit(item_template_id) WHERE item_template_id IS NOT NULL;
CREATE INDEX idx_marketplace_audit_created ON marketplace_audit(created_at DESC);

-- Event types:
-- 'order_placed' - Limit order placed
-- 'order_cancelled' - Order cancelled by user
-- 'order_filled' - Order completely filled
-- 'order_partial_fill' - Order partially filled
-- 'market_buy' - Market buy executed
-- 'market_sell' - Market sell executed
-- 'trade_executed' - Trade between two parties
-- 'validation_failed' - Input validation failed
-- 'rate_limit_exceeded' - Rate limit hit
-- 'access_denied' - Location access denied

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_audit'),
    'marketplace_audit table not created';

  RAISE NOTICE 'Migration 015 completed successfully';
END $$;
