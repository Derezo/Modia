-- Modia Initial Database Schema
-- ============================================

-- Custom types
CREATE TYPE race_type AS ENUM ('elf', 'dwarf', 'vampire', 'human', 'orc');
CREATE TYPE class_type AS ENUM ('warrior', 'wizard', 'monk', 'chemist');
CREATE TYPE node_type AS ENUM ('castle', 'city', 'village', 'forest', 'cave', 'mountain', 'bridge', 'guild', 'palace');
CREATE TYPE item_type AS ENUM ('weapon', 'armor', 'accessory', 'consumable', 'material', 'key_item');
CREATE TYPE equipment_slot AS ENUM ('main_hand', 'off_hand', 'head', 'body', 'legs', 'feet', 'accessory');
CREATE TYPE battle_type AS ENUM ('pve', 'pvp_coliseum');
CREATE TYPE battle_status AS ENUM ('active', 'victory', 'defeat', 'draw', 'fled');
CREATE TYPE listing_status AS ENUM ('active', 'sold', 'cancelled', 'expired');

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    gold INTEGER DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_banned BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- USER SESSIONS (JWT refresh tokens)
-- ============================================
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(refresh_token_hash);

-- ============================================
-- WORLD NODES TABLE
-- ============================================
CREATE TABLE world_nodes (
    id SERIAL PRIMARY KEY,
    node_type node_type NOT NULL,
    name VARCHAR(64) NOT NULL,
    x_coord INTEGER NOT NULL,
    y_coord INTEGER NOT NULL,
    distance_from_center INTEGER NOT NULL,
    features JSONB DEFAULT '[]',
    guild_class class_type,
    local_seed INTEGER NOT NULL,
    difficulty_tier INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_coordinates UNIQUE (x_coord, y_coord)
);

CREATE INDEX idx_world_nodes_type ON world_nodes(node_type);
CREATE INDEX idx_world_nodes_coords ON world_nodes(x_coord, y_coord);

-- ============================================
-- WORLD NODE CONNECTIONS
-- ============================================
CREATE TABLE world_node_connections (
    id SERIAL PRIMARY KEY,
    from_node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
    to_node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
    path_type VARCHAR(32) DEFAULT 'road',
    CONSTRAINT unique_connection UNIQUE (from_node_id, to_node_id),
    CONSTRAINT no_self_connection CHECK (from_node_id != to_node_id)
);

CREATE INDEX idx_connections_from ON world_node_connections(from_node_id);
CREATE INDEX idx_connections_to ON world_node_connections(to_node_id);

-- ============================================
-- CHARACTERS TABLE
-- ============================================
CREATE TABLE characters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(24) NOT NULL,
    race race_type NOT NULL,
    class class_type NOT NULL,
    level INTEGER DEFAULT 1 CHECK (level >= 1 AND level <= 256),
    experience BIGINT DEFAULT 0,
    hp_current INTEGER NOT NULL,
    hp_max INTEGER NOT NULL,
    mp_current INTEGER NOT NULL,
    mp_max INTEGER NOT NULL,
    strength INTEGER NOT NULL,
    intelligence INTEGER NOT NULL,
    agility INTEGER NOT NULL,
    vitality INTEGER NOT NULL,
    luck INTEGER NOT NULL,
    current_node_id INTEGER REFERENCES world_nodes(id),
    in_battle BOOLEAN DEFAULT FALSE,
    party_slot INTEGER CHECK (party_slot >= 1 AND party_slot <= 12),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_character_name UNIQUE (user_id, name)
);

CREATE INDEX idx_characters_user ON characters(user_id);
CREATE INDEX idx_characters_level ON characters(level DESC);

-- ============================================
-- ITEM TEMPLATES
-- ============================================
CREATE TABLE item_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    description TEXT,
    item_type item_type NOT NULL,
    equipment_slot equipment_slot,
    stat_bonuses JSONB DEFAULT '{}',
    class_restriction class_type[],
    race_restriction race_type[],
    level_requirement INTEGER DEFAULT 1,
    effect_type VARCHAR(32),
    effect_value INTEGER,
    base_price INTEGER DEFAULT 0,
    is_tradeable BOOLEAN DEFAULT TRUE,
    rarity INTEGER DEFAULT 1 CHECK (rarity >= 1 AND rarity <= 5),
    sprite_id VARCHAR(64)
);

CREATE INDEX idx_item_templates_type ON item_templates(item_type);

-- ============================================
-- CHARACTER ITEMS (inventory)
-- ============================================
CREATE TABLE character_items (
    id SERIAL PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    quantity INTEGER DEFAULT 1,
    is_equipped BOOLEAN DEFAULT FALSE,
    equipped_slot equipment_slot,
    modifications JSONB DEFAULT '{}',
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_quantity CHECK (quantity > 0)
);

CREATE INDEX idx_character_items_char ON character_items(character_id);
CREATE INDEX idx_character_items_equipped ON character_items(character_id, is_equipped);

-- ============================================
-- ENEMY TEMPLATES
-- ============================================
CREATE TABLE enemy_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    sprite_id VARCHAR(64),
    base_hp INTEGER NOT NULL,
    base_mp INTEGER NOT NULL,
    base_strength INTEGER NOT NULL,
    base_intelligence INTEGER NOT NULL,
    base_agility INTEGER NOT NULL,
    ai_type VARCHAR(32) DEFAULT 'balanced',
    abilities JSONB DEFAULT '[]',
    drop_table JSONB DEFAULT '[]',
    experience_reward INTEGER NOT NULL,
    gold_reward_min INTEGER DEFAULT 0,
    gold_reward_max INTEGER DEFAULT 10,
    spawn_node_types node_type[] NOT NULL,
    min_difficulty_tier INTEGER DEFAULT 1
);

-- ============================================
-- BATTLES TABLE
-- ============================================
CREATE TABLE battles (
    id SERIAL PRIMARY KEY,
    battle_type battle_type NOT NULL,
    status battle_status DEFAULT 'active',
    node_id INTEGER REFERENCES world_nodes(id),
    battle_state JSONB NOT NULL,
    map_seed INTEGER NOT NULL,
    map_width INTEGER DEFAULT 8,
    map_height INTEGER DEFAULT 8,
    player1_id INTEGER REFERENCES users(id),
    player2_id INTEGER REFERENCES users(id),
    winner_id INTEGER REFERENCES users(id),
    rewards JSONB,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP
);

CREATE INDEX idx_battles_active ON battles(status) WHERE status = 'active';
CREATE INDEX idx_battles_player1 ON battles(player1_id);
CREATE INDEX idx_battles_player2 ON battles(player2_id);

-- ============================================
-- BATTLE PARTICIPANTS
-- ============================================
CREATE TABLE battle_participants (
    id SERIAL PRIMARY KEY,
    battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES characters(id),
    enemy_template_id INTEGER REFERENCES enemy_templates(id),
    enemy_name VARCHAR(64),
    team INTEGER NOT NULL,
    tile_x INTEGER NOT NULL,
    tile_y INTEGER NOT NULL,
    current_hp INTEGER NOT NULL,
    current_mp INTEGER NOT NULL,
    status_effects JSONB DEFAULT '[]',
    initiative INTEGER NOT NULL,
    has_acted_this_turn BOOLEAN DEFAULT FALSE,
    is_alive BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_battle_participants_battle ON battle_participants(battle_id);
CREATE INDEX idx_battle_participants_character ON battle_participants(character_id);

-- ============================================
-- MARKETPLACE LISTINGS
-- ============================================
CREATE TABLE marketplace_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    seller_character_id INTEGER NOT NULL REFERENCES characters(id),
    item_template_id INTEGER NOT NULL REFERENCES item_templates(id),
    quantity INTEGER DEFAULT 1,
    price_per_unit INTEGER NOT NULL,
    status listing_status DEFAULT 'active',
    buyer_id INTEGER REFERENCES users(id),
    listed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    sold_at TIMESTAMP
);

CREATE INDEX idx_marketplace_active ON marketplace_listings(status, item_template_id) WHERE status = 'active';
CREATE INDEX idx_marketplace_seller ON marketplace_listings(seller_id);

-- ============================================
-- CHAT MESSAGES
-- ============================================
CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id),
    node_id INTEGER REFERENCES world_nodes(id),
    channel VARCHAR(32) DEFAULT 'general',
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_node ON chat_messages(node_id, created_at DESC);

-- ============================================
-- COLISEUM QUEUE
-- ============================================
CREATE TABLE coliseum_queue (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    party_characters INTEGER[] NOT NULL,
    average_level INTEGER NOT NULL,
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_in_queue UNIQUE (user_id)
);

-- ============================================
-- LEADERBOARD CACHE
-- ============================================
CREATE TABLE leaderboard_cache (
    id SERIAL PRIMARY KEY,
    category VARCHAR(32) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    character_id INTEGER REFERENCES characters(id),
    score BIGINT NOT NULL,
    rank INTEGER NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_category_rank UNIQUE (category, rank)
);

CREATE INDEX idx_leaderboard_category ON leaderboard_cache(category, rank);
