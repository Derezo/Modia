-- Migration: Relic System + Gold Sinks
-- ============================================
-- Adds relic system for premium feature gating
-- Adds marketplace tax ledger for audit trail
-- Relics are account-wide (not character-specific)

-- ============================================
-- RELIC TEMPLATES TABLE
-- ============================================
-- Defines all available relics in the game
CREATE TABLE IF NOT EXISTS relic_templates (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    rarity VARCHAR(20) DEFAULT 'common',
    acquisition_type VARCHAR(30) NOT NULL,  -- 'quest', 'node', 'shop', 'guild', 'achievement'
    acquisition_id INTEGER,                  -- Optional reference to specific quest/node/etc
    effects JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- USER RELICS TABLE
-- ============================================
-- Tracks which relics each user has collected (account-wide)
CREATE TABLE IF NOT EXISTS user_relics (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relic_id INTEGER NOT NULL REFERENCES relic_templates(id) ON DELETE CASCADE,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, relic_id)
);

-- ============================================
-- MARKETPLACE TAX LEDGER
-- ============================================
-- Audit trail for marketplace fees (5% seller fee)
CREATE TABLE IF NOT EXISTS marketplace_tax_ledger (
    id SERIAL PRIMARY KEY,
    order_id INTEGER,
    listing_id INTEGER,
    trade_id INTEGER,
    seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    item_template_id INTEGER,
    gross_amount INTEGER NOT NULL,
    tax_amount INTEGER NOT NULL,
    net_amount INTEGER NOT NULL,
    tax_rate NUMERIC(5,4) DEFAULT 0.05,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- FAST TRAVEL LOG
-- ============================================
-- Tracks fast travel usage for analytics
CREATE TABLE IF NOT EXISTS fast_travel_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    from_node_id INTEGER REFERENCES world_nodes(id) ON DELETE SET NULL,
    to_node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
    gold_cost INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- STAMINA RESTORE LOG
-- ============================================
-- Tracks stamina restore purchases
CREATE TABLE IF NOT EXISTS stamina_restore_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    node_id INTEGER REFERENCES world_nodes(id) ON DELETE SET NULL,
    stamina_amount INTEGER NOT NULL,
    gold_cost INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_user_relics_user ON user_relics(user_id);
CREATE INDEX IF NOT EXISTS idx_user_relics_relic ON user_relics(relic_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_tax_seller ON marketplace_tax_ledger(seller_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_tax_created ON marketplace_tax_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_fast_travel_user ON fast_travel_log(user_id);
CREATE INDEX IF NOT EXISTS idx_stamina_restore_user ON stamina_restore_log(user_id);

-- ============================================
-- SEED INITIAL RELICS
-- ============================================
INSERT INTO relic_templates (key, name, description, rarity, acquisition_type, effects) VALUES
(
    'wayfarers_compass',
    'Wayfarer''s Compass',
    'A mystical compass that allows instant travel to any region capital. The journey still costs gold for provisions and magical energy.',
    'rare',
    'quest',
    '{"unlock": "fast_travel", "cost_base": 100, "cost_per_distance": 50}'
),
(
    'vitality_charm',
    'Vitality Charm',
    'An enchanted charm that can restore your stamina at any town. Each point of stamina costs 100 gold to restore.',
    'rare',
    'quest',
    '{"unlock": "stamina_restore", "cost_per_point": 100}'
),
(
    'merchants_seal',
    'Merchant''s Seal',
    'A seal of approval from the Merchant''s Guild. Reduces marketplace fees from 5% to 3%.',
    'epic',
    'achievement',
    '{"unlock": "reduced_marketplace_fee", "fee_rate": 0.03}'
),
(
    'cartographers_eye',
    'Cartographer''s Eye',
    'Reveals more of the fog of war when visiting watchtowers.',
    'uncommon',
    'node',
    '{"unlock": "extended_watchtower", "reveal_bonus": 2}'
)
ON CONFLICT (key) DO NOTHING;
