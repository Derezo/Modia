-- Marketplace Order Book System
-- ============================================

-- Order type for buy/sell orders
CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_status AS ENUM ('open', 'partial', 'filled', 'cancelled');

-- ============================================
-- MARKET ORDERS - Full Order Book
-- ============================================
CREATE TABLE market_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    side order_side NOT NULL,
    price INTEGER NOT NULL CHECK (price > 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    quantity_filled INTEGER DEFAULT 0,
    status order_status DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    CONSTRAINT valid_fill CHECK (quantity_filled <= quantity)
);

-- Index for order book queries (best bid/ask)
CREATE INDEX idx_market_orders_book ON market_orders(item_template_id, side, status, price, created_at);
CREATE INDEX idx_market_orders_user ON market_orders(user_id, status);
CREATE INDEX idx_market_orders_active ON market_orders(status) WHERE status IN ('open', 'partial');

-- ============================================
-- MARKET TRADES - Trade History
-- ============================================
CREATE TABLE market_trades (
    id SERIAL PRIMARY KEY,
    buy_order_id INTEGER REFERENCES market_orders(id),
    sell_order_id INTEGER REFERENCES market_orders(id),
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    price INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total_gold INTEGER NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_market_trades_item ON market_trades(item_template_id, executed_at DESC);
CREATE INDEX idx_market_trades_buyer ON market_trades(buyer_id, executed_at DESC);
CREATE INDEX idx_market_trades_seller ON market_trades(seller_id, executed_at DESC);

-- ============================================
-- GOLD RESERVATIONS - Reserved gold for buy orders
-- ============================================
CREATE TABLE gold_reservations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    reserved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_order_reservation UNIQUE (order_id)
);

CREATE INDEX idx_gold_reservations_user ON gold_reservations(user_id);

-- ============================================
-- ITEM ESCROW - Escrowed items for sell orders
-- ============================================
CREATE TABLE item_escrow (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id),
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    escrowed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_order_escrow UNIQUE (order_id)
);

CREATE INDEX idx_item_escrow_character ON item_escrow(character_id);
CREATE INDEX idx_item_escrow_order ON item_escrow(order_id);

-- ============================================
-- VIEWS FOR ORDER BOOK AGGREGATION
-- ============================================

-- View for aggregated order book (depth)
CREATE OR REPLACE VIEW order_book_depth AS
SELECT
    item_template_id,
    side,
    price,
    SUM(quantity - quantity_filled) as total_quantity,
    COUNT(*) as order_count,
    MIN(created_at) as oldest_order
FROM market_orders
WHERE status IN ('open', 'partial')
GROUP BY item_template_id, side, price
ORDER BY item_template_id, side,
    CASE WHEN side = 'buy' THEN price END DESC,
    CASE WHEN side = 'sell' THEN price END ASC;

-- View for recent trade history
CREATE OR REPLACE VIEW recent_trades AS
SELECT
    mt.item_template_id,
    it.name as item_name,
    mt.price,
    mt.quantity,
    mt.total_gold,
    mt.executed_at
FROM market_trades mt
JOIN item_templates it ON mt.item_template_id = it.id
ORDER BY mt.executed_at DESC;

-- ============================================
-- FUNCTION: Update order status
-- ============================================
CREATE OR REPLACE FUNCTION update_order_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.quantity_filled >= NEW.quantity THEN
        NEW.status := 'filled';
    ELSIF NEW.quantity_filled > 0 THEN
        NEW.status := 'partial';
    END IF;
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_order_status
BEFORE UPDATE ON market_orders
FOR EACH ROW
WHEN (OLD.quantity_filled IS DISTINCT FROM NEW.quantity_filled)
EXECUTE FUNCTION update_order_status();
