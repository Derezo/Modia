-- Shop System Migration
-- ============================================
-- NPC shops with dynamic pricing based on supply

-- ============================================
-- NPC SHOP INVENTORY TABLE
-- Tracks item stock at each shop location
-- ============================================
CREATE TABLE npc_shop_inventory (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
    shop_type VARCHAR(32) NOT NULL, -- 'blacksmith', 'apothecary', 'farm'
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 10,
    restock_quantity INTEGER NOT NULL DEFAULT 10, -- Max quantity after restock
    last_restock TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_shop_item UNIQUE (node_id, shop_type, item_template_id),
    CONSTRAINT valid_quantity CHECK (quantity >= 0),
    CONSTRAINT valid_shop_type CHECK (shop_type IN ('blacksmith', 'apothecary', 'farm'))
);

-- Indexes for common queries
CREATE INDEX idx_shop_inventory_node ON npc_shop_inventory(node_id);
CREATE INDEX idx_shop_inventory_shop ON npc_shop_inventory(node_id, shop_type);
CREATE INDEX idx_shop_inventory_item ON npc_shop_inventory(item_template_id);

-- ============================================
-- SHOP TRANSACTIONS TABLE (optional audit log)
-- Tracks buy/sell history for analytics
-- ============================================
CREATE TABLE shop_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    node_id INTEGER NOT NULL REFERENCES world_nodes(id),
    shop_type VARCHAR(32) NOT NULL,
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    transaction_type VARCHAR(16) NOT NULL, -- 'buy' or 'sell'
    quantity INTEGER NOT NULL,
    price_per_unit INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_transaction_type CHECK (transaction_type IN ('buy', 'sell'))
);

CREATE INDEX idx_shop_transactions_user ON shop_transactions(user_id);
CREATE INDEX idx_shop_transactions_node ON shop_transactions(node_id);
CREATE INDEX idx_shop_transactions_date ON shop_transactions(created_at DESC);
