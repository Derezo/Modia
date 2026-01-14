-- Migration: Add expanded node types for world generation improvements
-- Adds activity nodes, utility nodes, and farm settlements

-- Add new node types to the enum
-- Note: ALTER TYPE ADD VALUE cannot be run inside a transaction block in some contexts
-- but works fine in standard migration execution
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'fishing_spot';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'merchant_caravan';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'ruins';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'watchtower';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'farm';

-- Add zodiac shrine support columns
-- Uses existing 'shrine' node_type with shrine_buff_type column for zodiac identification
-- Valid zodiac types: zodiac_aries, zodiac_taurus, zodiac_gemini, zodiac_cancer,
-- zodiac_leo, zodiac_virgo, zodiac_libra, zodiac_scorpio, zodiac_sagittarius,
-- zodiac_capricorn, zodiac_aquarius, zodiac_pisces

-- Add column for watchtower reveal radius (how many hops of nodes it reveals)
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS watchtower_reveal_radius INTEGER DEFAULT 2;

-- Add column for merchant caravan inventory refresh tracking
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS caravan_inventory_seed INTEGER;
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS caravan_last_refresh TIMESTAMP WITH TIME ZONE;

-- Add column for ruins puzzle state
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS ruins_puzzle_type VARCHAR(32);
ALTER TABLE world_nodes ADD COLUMN IF NOT EXISTS ruins_reward_tier INTEGER DEFAULT 1;

-- Track fishing spot catches (per user per node)
CREATE TABLE IF NOT EXISTS user_fishing_catches (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  fish_type VARCHAR(32) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  caught_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Track ruins puzzle completions (one-time per user per ruins)
CREATE TABLE IF NOT EXISTS user_ruins_completions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  puzzle_solved BOOLEAN DEFAULT FALSE,
  reward_claimed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, node_id)
);

-- Track watchtower activations (reveals map)
CREATE TABLE IF NOT EXISTS user_watchtower_activations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  activated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, node_id)
);

-- Track merchant caravan transactions
CREATE TABLE IF NOT EXISTS user_caravan_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  item_bought VARCHAR(64),
  item_sold VARCHAR(64),
  gold_spent INTEGER DEFAULT 0,
  gold_earned INTEGER DEFAULT 0,
  transaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fishing_catches_user ON user_fishing_catches(user_id);
CREATE INDEX IF NOT EXISTS idx_fishing_catches_node ON user_fishing_catches(node_id);
CREATE INDEX IF NOT EXISTS idx_ruins_completions_user ON user_ruins_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_watchtower_activations_user ON user_watchtower_activations(user_id);
CREATE INDEX IF NOT EXISTS idx_caravan_transactions_user ON user_caravan_transactions(user_id);
-- Note: Partial index on node_type='watchtower' deferred as enum values are not visible until commit
