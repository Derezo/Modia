# Modia - Technical Architecture Document

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 2.5 |
| Last Updated | February 2026 |
| Last Validated | 2026-02-01 |

---

## 1. System Overview

### 1.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Web Browser (Any Device)                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │   │
│  │  │   Canvas    │  │    State    │  │   Scene     │  │   Input    │ │   │
│  │  │  Renderer   │  │   Manager   │  │   Manager   │  │  Handler   │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │   │
│  │  ┌─────────────────────────────┐  ┌─────────────────────────────┐  │   │
│  │  │      HTTP API Client        │  │     WebSocket Client        │  │   │
│  │  └─────────────────────────────┘  └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │          HTTPS / WSS          │
                    └───────────────┬───────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER LAYER                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Nginx Reverse Proxy                          │   │
│  │              (SSL Termination, Static Files, Load Balancing)         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      PM2 Process Manager                             │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐          │   │
│  │  │   Node.js Instance 1    │  │   Node.js Instance 2    │          │   │
│  │  │  ┌───────────────────┐  │  │  ┌───────────────────┐  │          │   │
│  │  │  │   Express.js API  │  │  │  │   Express.js API  │  │          │   │
│  │  │  └───────────────────┘  │  │  └───────────────────┘  │          │   │
│  │  │  ┌───────────────────┐  │  │  ┌───────────────────┐  │          │   │
│  │  │  │ WebSocket Server  │  │  │  │ WebSocket Server  │  │          │   │
│  │  │  └───────────────────┘  │  │  └───────────────────┘  │          │   │
│  │  └─────────────────────────┘  └─────────────────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         PostgreSQL Database                          │   │
│  │                      (Connection Pool: 20 max)                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack Details

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 18+ | Server-side JavaScript execution |
| Framework | Express.js | 4.18 | HTTP API routing and middleware |
| Database | PostgreSQL | 14+ | Persistent data storage |
| WebSocket | ws | 8.14 | Real-time bidirectional communication |
| Auth | jsonwebtoken | 9.0 | JWT token generation/verification |
| Hashing | bcrypt | 5.1 | Password hashing |
| Process Manager | PM2 | Latest | Process clustering and monitoring |
| Reverse Proxy | Nginx | Latest | SSL, static files, load balancing |

---

## 2. Backend Architecture

### 2.1 Directory Structure

```
api/
├── package.json
└── src/
    ├── index.js                 # Application entry point
    │
    ├── config/
    │   ├── database.js          # PostgreSQL connection pool
    │   ├── jwt.js               # JWT configuration and helpers
    │   └── constants.js         # Game constants (races, classes, etc.)
    │
    ├── middleware/
    │   ├── auth.js              # JWT authentication middleware
    │   ├── errorHandler.js      # Global error handling
    │   └── rateLimiter.js       # Request rate limiting
    │
    ├── routes/
    │   ├── auth.js              # /api/auth/* endpoints
    │   ├── characters.js        # /api/characters/* endpoints
    │   ├── party.js             # /api/party/* endpoints
    │   ├── world.js             # /api/world/* endpoints
    │   └── battle.js            # /api/battle/* endpoints
    │
    ├── services/
    │   ├── authService.js       # Authentication business logic
    │   ├── characterService.js  # Character management logic
    │   ├── worldService.js      # World generation and navigation
    │   ├── battleService.js     # Combat system logic
    │   ├── battleTurnManager.js # Server-side turn loop manager
    │   └── battleReconnection.js # Reconnection handling
    │
    ├── websocket/
    │   └── index.js             # WebSocket server and handlers
    │
    ├── db/
    │   ├── migrate.js           # Migration runner
    │   └── seed.js              # Database seeding script
    │
    ├── utils/
    │   └── recruitmentUtils.js  # Shared recruit pricing and generation utilities
    │
    └── migrations/
        └── 001_initial_schema.sql
```

### 2.2 Request Flow

```
Client Request
      │
      ▼
┌─────────────┐
│   Nginx     │ ─── Static files served directly
└─────────────┘
      │
      ▼ (API requests)
┌─────────────┐
│ Rate Limiter│ ─── 429 if exceeded
└─────────────┘
      │
      ▼
┌─────────────┐
│  Express    │
│   Router    │
└─────────────┘
      │
      ▼
┌─────────────┐
│    Auth     │ ─── 401 if invalid token
│ Middleware  │
└─────────────┘
      │
      ▼
┌─────────────┐
│   Route     │
│  Handler    │
└─────────────┘
      │
      ▼
┌─────────────┐
│  Service    │
│   Layer     │
└─────────────┘
      │
      ▼
┌─────────────┐
│  Database   │
│   Query     │
└─────────────┘
      │
      ▼
┌─────────────┐
│  Response   │
│   JSON      │
└─────────────┘
```

### 2.3 Authentication Flow

```
Registration:
┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐
│ Client │────▶│  API   │────▶│ bcrypt │────▶│   DB   │
│        │     │        │     │  hash  │     │ INSERT │
└────────┘     └────────┘     └────────┘     └────────┘
                   │
                   ▼
              ┌────────┐
              │  JWT   │
              │ tokens │
              └────────┘

Login:
┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐
│ Client │────▶│  API   │────▶│   DB   │────▶│ bcrypt │
│        │     │        │     │ SELECT │     │compare │
└────────┘     └────────┘     └────────┘     └────────┘
                   │                              │
                   ▼                              ▼
              ┌────────┐                    ┌──────────┐
              │  JWT   │◀───────────────────│  Valid?  │
              │ tokens │                    └──────────┘

Token Refresh:
┌────────┐     ┌────────┐     ┌────────┐
│ Client │────▶│  API   │────▶│  JWT   │
│refresh │     │        │     │ verify │
│ token  │     │        │     │        │
└────────┘     └────────┘     └────────┘
                   │
                   ▼
              ┌────────┐
              │  New   │
              │ access │
              │ token  │
              └────────┘
```

### 2.4 WebSocket Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     WebSocket Server                             │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ connections │    │    rooms    │    │  handlers   │         │
│  │  Map<uid,   │    │ Map<room,   │    │             │         │
│  │    ws>      │    │  Set<uid>>  │    │ - auth      │         │
│  └─────────────┘    └─────────────┘    │ - chat      │         │
│                                         │ - coliseum  │         │
│                                         │ - market    │         │
│                                         └─────────────┘         │
└─────────────────────────────────────────────────────────────────┘

Message Types:
┌────────────────────────────┬─────────────────────────────────────────────┐
│ Type                       │ Description                                  │
├────────────────────────────┼─────────────────────────────────────────────┤
│ auth                       │ Authenticate WebSocket with JWT              │
│ join_room                  │ Subscribe to room updates                    │
│ leave_room                 │ Unsubscribe from room                        │
│ chat_message               │ Send/receive chat messages                   │
│ coliseum_*                 │ PvP matchmaking and battle events            │
│ marketplace_*              │ Trading listing updates                      │
│ leaderboard_*              │ Ranking changes                              │
├────────────────────────────┼─────────────────────────────────────────────┤
│ battle:turn_start          │ Broadcast when any unit's turn begins        │
│ battle:intent_highlight    │ Enemy movement/attack range preview          │
│ battle:action_result       │ Results of battle actions for animation      │
│ battle:turn_end            │ Turn complete, announce next unit            │
│ battle:your_turn           │ Sent to controlling player when turn starts  │
│ battle:player_disconnected │ Player disconnected from battle              │
│ battle:player_reconnected  │ Player reconnected to battle                 │
│ battle:state_sync          │ Full battle state synchronization            │
│ battle:end                 │ Battle complete with rewards                 │
└────────────────────────────┴─────────────────────────────────────────────┘
```

### 2.5 Battle Turn Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Battle Turn Manager                            │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   CT Loop    │    │  Turn State  │    │  Broadcast   │      │
│  │  accumulate  │───▶│   Machine    │───▶│   Events     │      │
│  │  until 100   │    │              │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                             │                                   │
│                             ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  Player Turn: Wait for HTTP POST or WS action              ││
│  │  Enemy Turn: Calculate AI, broadcast intent, execute       ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Key Components:**

| File | Purpose |
|------|---------|
| `battleTurnManager.js` | Server-side async turn loop that accumulates CT, determines turn order, and coordinates turn execution |
| `battleWebsocket.js` | Broadcast functions for all battle events (turn_start, action_result, state_sync, etc.) |
| `battleReconnection.js` | Handle player disconnect/reconnect during active battles, preserving battle state |

**Turn Flow:**

1. **CT Accumulation**: Each unit accumulates CT based on agility until one reaches 100
2. **Turn Start**: Server broadcasts `battle:turn_start` to all clients in battle room
3. **Player Turn**: Server sends `battle:your_turn` to controlling player, waits for HTTP POST action or WebSocket action
4. **Enemy Turn**: Server calculates AI decision, broadcasts `battle:intent_highlight` for visual preview, then executes action
5. **Action Execution**: Server validates action, applies effects, broadcasts `battle:action_result`
6. **Turn End**: Server broadcasts `battle:turn_end`, advances to next unit

**Reconnection Handling:**

- On disconnect: Server broadcasts `battle:player_disconnected`, battle continues with AI controlling disconnected player's units
- On reconnect: Server sends `battle:state_sync` with full battle state, broadcasts `battle:player_reconnected`
- Timeout: After configurable period (default 5 minutes), disconnected player forfeits

---

## 3. Database Design

### 3.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   users     │       │   characters    │       │  world_nodes    │
├─────────────┤       ├─────────────────┤       ├─────────────────┤
│ id (PK)     │◀──┐   │ id (PK)         │   ┌──▶│ id (PK)         │
│ username    │   │   │ user_id (FK)────│───┘   │ node_type       │
│ email       │   │   │ name            │       │ name            │
│ password_   │   │   │ race            │       │ x_coord         │
│   hash      │   │   │ class           │       │ y_coord         │
│ gold        │   │   │ level           │       │ features        │
│ created_at  │   │   │ experience      │       │ local_seed      │
│ last_login  │   │   │ hp/mp/stats...  │       │ difficulty_tier │
│ is_banned   │   │   │ current_node_id─│───────│                 │
└─────────────┘   │   │ party_slot      │       └─────────────────┘
      │           │   │ in_battle       │               │
      │           │   └─────────────────┘               │
      │           │           │                         │
      │           │           │                         ▼
      │           │           │               ┌─────────────────────┐
      │           │           │               │world_node_connections│
      │           │           │               ├─────────────────────┤
      │           │           │               │ id (PK)             │
      │           │           │               │ from_node_id (FK)   │
      │           │           │               │ to_node_id (FK)     │
      │           │           │               │ path_type           │
      │           │           │               └─────────────────────┘
      │           │           │
      │           │           ▼
      │           │   ┌─────────────────┐
      │           │   │character_items  │       ┌─────────────────┐
      │           │   ├─────────────────┤       │ item_templates  │
      │           │   │ id (PK)         │       ├─────────────────┤
      │           │   │ character_id(FK)│       │ id (PK)         │
      │           │   │ item_template_id│──────▶│ name            │
      │           │   │ quantity        │       │ item_type       │
      │           │   │ is_equipped     │       │ equipment_slot  │
      │           │   │ equipped_slot   │       │ stat_bonuses    │
      │           │   │ modifications   │       │ base_price      │
      │           │   └─────────────────┘       │ rarity          │
      │           │                             └─────────────────┘
      │           │
      │           │   ┌─────────────────┐
      │           └───│    battles      │
      │               ├─────────────────┤
      │               │ id (PK)         │
      └──────────────▶│ player1_id (FK) │
                      │ player2_id (FK) │
                      │ battle_type     │
                      │ status          │
                      │ battle_state    │
                      │ map_seed        │
                      │ rewards         │
                      └─────────────────┘
```

### 3.2 Table Specifications

#### 3.2.1 users

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| username | VARCHAR(32) | UNIQUE NOT NULL | Login username |
| email | VARCHAR(255) | UNIQUE NOT NULL | Email address |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt hash |
| gold | INTEGER | DEFAULT 1000 | Currency balance |
| created_at | TIMESTAMP | DEFAULT NOW() | Registration time |
| last_login | TIMESTAMP | | Last login time |
| is_banned | BOOLEAN | DEFAULT FALSE | Account status |

**Indexes:**
- `idx_users_username` on `username`
- `idx_users_email` on `email`

#### 3.2.2 user_sessions

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK → users.id | Session owner |
| refresh_token_hash | VARCHAR(255) | NOT NULL | Hashed refresh token |
| expires_at | TIMESTAMP | NOT NULL | Token expiration |
| created_at | TIMESTAMP | DEFAULT NOW() | Session created |

#### 3.2.3 characters

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK → users.id | Owner |
| name | VARCHAR(24) | NOT NULL | Character name |
| race | race_type | NOT NULL | elf/dwarf/vampire/human/orc |
| class | class_type | NOT NULL | warrior/wizard/monk/chemist |
| level | INTEGER | DEFAULT 1, CHECK 1-100 | Character level (derived from total_xp_spent) |
| hp_current | INTEGER | NOT NULL | Current health |
| hp_max | INTEGER | NOT NULL | Maximum health |
| mp_current | INTEGER | NOT NULL | Current mana |
| mp_max | INTEGER | NOT NULL | Maximum mana |
| strength | INTEGER | NOT NULL | Physical power |
| intelligence | INTEGER | NOT NULL | Magical power |
| agility | INTEGER | NOT NULL | Speed/evasion |
| vitality | INTEGER | NOT NULL | Defense |
| luck | INTEGER | NOT NULL | Crit/drops |
| current_node_id | INTEGER | FK → world_nodes.id | Location |
| in_battle | BOOLEAN | DEFAULT FALSE | Battle status |
| party_slot | INTEGER | CHECK 1-12 | Formation slot |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

**Constraints:**
- `UNIQUE (user_id, name)` - No duplicate names per user

#### 3.2.4 world_nodes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| node_type | node_type | NOT NULL | Type enum |
| name | VARCHAR(64) | NOT NULL | Display name |
| x_coord | INTEGER | NOT NULL | X position |
| y_coord | INTEGER | NOT NULL | Y position |
| distance_from_center | INTEGER | NOT NULL | Graph distance |
| features | JSONB | DEFAULT '[]' | Available features |
| guild_class | class_type | | For guild nodes |
| local_seed | INTEGER | NOT NULL | Generation seed |
| difficulty_tier | INTEGER | DEFAULT 1 | Enemy scaling |

**Constraints:**
- `UNIQUE (x_coord, y_coord)` - No overlapping nodes

#### 3.2.5 battles

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| battle_type | battle_type | NOT NULL | pve/pvp_coliseum |
| status | battle_status | DEFAULT 'active' | Current state |
| node_id | INTEGER | FK → world_nodes.id | Battle location |
| battle_state | JSONB | NOT NULL | Full state snapshot |
| map_seed | INTEGER | NOT NULL | Map generation seed |
| map_width | INTEGER | DEFAULT 8 | Grid width |
| map_height | INTEGER | DEFAULT 8 | Grid height |
| player1_id | INTEGER | FK → users.id | First player |
| player2_id | INTEGER | FK → users.id | Second player (PvP) |
| winner_id | INTEGER | FK → users.id | Victor |
| rewards | JSONB | | Earned rewards |
| started_at | TIMESTAMP | DEFAULT NOW() | Start time |
| ended_at | TIMESTAMP | | End time |

#### 3.2.6 character_xp

Tracks unspent and spent XP for the XP-spending leveling system.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| character_id | INTEGER | PK, FK → characters.id | Character |
| xp_pool | BIGINT | NOT NULL DEFAULT 0 | Unspent XP available |
| total_xp_earned | BIGINT | NOT NULL DEFAULT 0 | Lifetime XP earned from battles |
| total_xp_spent | BIGINT | NOT NULL DEFAULT 0 | XP spent on skills (determines level) |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last update time |

**Notes:**
- Character level is derived from `total_xp_spent` using formula: `XP Required for Level N = 100 × N^2.8`
- `xp_pool = total_xp_earned - total_xp_spent`

#### 3.2.7 character_guilds

Tracks guild memberships for multi-guild system.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| character_id | INTEGER | FK → characters.id | Character |
| guild_id | VARCHAR(50) | NOT NULL | Guild identifier (warrior, berserker, etc.) |
| guild_level | INTEGER | NOT NULL DEFAULT 1 | Level in this guild |
| xp_spent_in_guild | BIGINT | NOT NULL DEFAULT 0 | XP spent on this guild's skills |
| is_active | BOOLEAN | NOT NULL DEFAULT FALSE | Currently active guild |
| is_frozen | BOOLEAN | NOT NULL DEFAULT FALSE | Skills frozen (advanced from this guild) |
| unlocked_at | TIMESTAMP | DEFAULT NOW() | When guild was joined |

**Constraints:**
- `UNIQUE (character_id, guild_id)` - One membership per guild per character

**Indexes:**
- `idx_character_guilds_lookup` on `(character_id, is_active)`

#### 3.2.8 character_skills

Tracks learned skills and their levels.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| character_id | INTEGER | FK → characters.id | Character |
| guild_id | VARCHAR(50) | NOT NULL | Guild this skill belongs to |
| skill_id | VARCHAR(100) | NOT NULL | Skill identifier |
| level | INTEGER | NOT NULL DEFAULT 1, CHECK >= 1 | Current skill level |
| xp_invested | BIGINT | NOT NULL DEFAULT 0 | Total XP spent on this skill |
| is_frozen | BOOLEAN | NOT NULL DEFAULT FALSE | Cannot upgrade (guild frozen) |
| learned_at | TIMESTAMP | DEFAULT NOW() | When skill was first learned |

**Constraints:**
- `UNIQUE (character_id, skill_id)` - One entry per skill per character

**Indexes:**
- `idx_character_skills_lookup` on `(character_id, guild_id)`

#### 3.2.9 enemy_templates

Templates for enemy generation with player-level scaling.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | VARCHAR(100) | PRIMARY KEY | Enemy identifier |
| name | VARCHAR(100) | NOT NULL | Display name |
| enemy_type | VARCHAR(50) | NOT NULL | melee, ranged, tank, support, etc. |
| terrain_type | VARCHAR(50) | NOT NULL | forest, cave, mountain, bridge |
| difficulty_tier | INTEGER | NOT NULL, CHECK 1-5 | Difficulty rating |
| base_level | INTEGER | NOT NULL | Base level for stat calculation |
| hp_base | INTEGER | NOT NULL | Base HP |
| mp_base | INTEGER | NOT NULL | Base MP |
| strength | INTEGER | NOT NULL | STR stat |
| intelligence | INTEGER | NOT NULL | INT stat |
| agility | INTEGER | NOT NULL | AGI stat |
| vitality | INTEGER | NOT NULL | VIT stat |
| luck | INTEGER | NOT NULL | LUK stat |
| movement | INTEGER | NOT NULL DEFAULT 3 | Movement range |
| attack_range | INTEGER | NOT NULL DEFAULT 1 | Attack range |
| ai_archetype | VARCHAR(50) | NOT NULL | aggressive, defensive, support, tactical |
| xp_reward | INTEGER | NOT NULL | Base XP reward |
| gold_reward_min | INTEGER | NOT NULL | Minimum gold drop |
| gold_reward_max | INTEGER | NOT NULL | Maximum gold drop |
| drop_table | JSONB | NOT NULL DEFAULT '[]' | Item drop configuration |
| abilities | JSONB | NOT NULL DEFAULT '[]' | Available skills/attacks |
| sprite | VARCHAR(100) | NOT NULL | Sprite asset reference |

**Indexes:**
- `idx_enemy_templates_terrain` on `(terrain_type, difficulty_tier)`

#### 3.2.10 traits

Permanent passive bonuses acquired through guild recruitment.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| name | VARCHAR(50) | UNIQUE NOT NULL | Trait name |
| description | TEXT | NOT NULL | Display description |
| category | VARCHAR(20) | NOT NULL | combat, survival, utility, situational |
| rarity | VARCHAR(20) | NOT NULL | common, uncommon, rare, legendary |
| effect_type | VARCHAR(50) | NOT NULL | Type of effect to apply |
| effect_value | DECIMAL(5,2) | NOT NULL | Magnitude of effect |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

**Categories:**
- `combat`: Damage bonuses, crit chance/damage
- `survival`: HP/MP bonuses, regeneration, damage resistance
- `utility`: Movement, initiative, XP/gold bonuses
- `situational`: Conditional bonuses (vs enemy types, terrain, low HP)

#### 3.2.11 guild_recruits

Guild recruitment pool (shared across all players).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| node_id | INTEGER | FK → world_nodes.id NOT NULL | Guild node |
| name | VARCHAR(50) | NOT NULL | Recruit name |
| race | race_type | NOT NULL | Character race |
| gender | VARCHAR(20) | NOT NULL | male, female, other |
| class | class_type | NOT NULL | Character class |
| level | INTEGER | DEFAULT 1 | Starting level |
| hp_max | INTEGER | NOT NULL | Maximum HP |
| mp_max | INTEGER | NOT NULL | Maximum MP |
| strength | INTEGER | NOT NULL | STR stat |
| intelligence | INTEGER | NOT NULL | INT stat |
| agility | INTEGER | NOT NULL | AGI stat |
| vitality | INTEGER | NOT NULL | VIT stat |
| luck | INTEGER | NOT NULL | LUK stat |
| stat_variance_percent | DECIMAL(5,2) | DEFAULT 0 | Variance from baseline |
| xp_pool | INTEGER | NOT NULL | Starting XP |
| price | INTEGER | NOT NULL | Gold cost |
| is_emergency_restock | BOOLEAN | DEFAULT FALSE | Emergency spawn flag |
| purchased_by | INTEGER | FK → users.id | Buyer (null if available) |
| purchased_at | TIMESTAMP | | Purchase time |
| created_at | TIMESTAMP | DEFAULT NOW() | Generation time |

#### 3.2.12 recruit_traits

Junction table for recruit traits.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| recruit_id | INTEGER | FK → guild_recruits.id CASCADE | Recruit |
| trait_id | INTEGER | FK → traits.id | Trait |

**Constraints:**
- `UNIQUE (recruit_id, trait_id)` - No duplicate traits

#### 3.2.13 recruit_skills

Junction table for recruit starting skills.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| recruit_id | INTEGER | FK → guild_recruits.id CASCADE | Recruit |
| skill_id | VARCHAR(50) | NOT NULL | Skill identifier |

**Constraints:**
- `UNIQUE (recruit_id, skill_id)` - No duplicate skills

#### 3.2.14 character_traits

Permanent traits attached to characters.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| character_id | INTEGER | FK → characters.id CASCADE | Character |
| trait_id | INTEGER | FK → traits.id | Trait |
| acquired_at | TIMESTAMP | DEFAULT NOW() | When trait was gained |

**Constraints:**
- `UNIQUE (character_id, trait_id)` - No duplicate traits per character

#### 3.2.15 exception_groups

Groups exceptions by fingerprint for tracking recurring errors.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| fingerprint | VARCHAR(64) | UNIQUE NOT NULL | Hash identifying unique error signature |
| exception_type | VARCHAR(100) | | Error class name |
| exception_message | TEXT | NOT NULL | Error message |
| stack_trace_normalized | TEXT | | Normalized stack trace |
| source_file | VARCHAR(255) | | File where error originated |
| source_line | INTEGER | | Line number |
| source_function | VARCHAR(255) | | Function name |
| first_seen_at | TIMESTAMP | DEFAULT NOW() | First occurrence |
| last_seen_at | TIMESTAMP | DEFAULT NOW() | Most recent occurrence |
| occurrence_count | INTEGER | DEFAULT 1 | Total occurrences |
| status | VARCHAR(20) | DEFAULT 'new' | new, investigating, resolved, ignored |
| resolved_at | TIMESTAMP | | When resolved |
| resolved_by | INTEGER | FK -> users.id | Admin who resolved |
| resolution_notes | TEXT | | Resolution details |

**Indexes:**
- `idx_exception_groups_fingerprint` on `fingerprint`
- `idx_exception_groups_status` on `(status, last_seen_at DESC)`

#### 3.2.16 exception_events

Individual exception occurrences with request context.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| exception_group_id | INTEGER | FK -> exception_groups.id CASCADE | Parent group |
| request_id | VARCHAR(36) | | UUID for request correlation |
| request_method | VARCHAR(10) | | HTTP method |
| request_url | TEXT | | Request URL |
| request_headers | JSONB | DEFAULT '{}' | Request headers |
| user_id | INTEGER | FK -> users.id | User if authenticated |
| character_id | INTEGER | FK -> characters.id | Active character |
| full_stack_trace | TEXT | | Complete stack trace |
| error_context | JSONB | DEFAULT '{}' | Additional context |
| ip_address | INET | | Client IP |
| user_agent | TEXT | | Browser/client info |
| environment | VARCHAR(20) | | development, production |
| created_at | TIMESTAMP | DEFAULT NOW() | When occurred |

**Indexes:**
- `idx_exception_events_group` on `(exception_group_id, created_at DESC)`
- `idx_exception_events_user` on `user_id` WHERE user_id IS NOT NULL
- `idx_exception_events_request` on `request_id` WHERE request_id IS NOT NULL

#### 3.2.17 user_feedback

User-submitted feedback including enhancement requests, bug reports, and abuse reports.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| feedback_type | feedback_type | NOT NULL | enhancement, bug, abuse |
| title | VARCHAR(200) | NOT NULL | Feedback title |
| description | TEXT | NOT NULL | Detailed description |
| user_id | INTEGER | FK -> users.id CASCADE | Submitter |
| character_id | INTEGER | FK -> characters.id | Active character |
| game_context | JSONB | DEFAULT '{}' | Game state context |
| ip_address | INET | | Client IP |
| user_agent | TEXT | | Browser/client info |
| reported_user_id | INTEGER | FK -> users.id | Reported user (abuse) |
| reported_character_id | INTEGER | FK -> characters.id | Reported character (abuse) |
| status | feedback_status | DEFAULT 'pending' | pending, reviewing, resolved, declined |
| admin_notes | TEXT | | Admin notes |
| resolved_at | TIMESTAMP | | When resolved |
| resolved_by | INTEGER | FK -> users.id | Admin who resolved |
| created_at | TIMESTAMP | DEFAULT NOW() | Submission time |

**Indexes:**
- `idx_user_feedback_user` on `(user_id, created_at DESC)`
- `idx_user_feedback_type` on `(feedback_type, status)`
- `idx_user_feedback_reported` on `reported_user_id` WHERE reported_user_id IS NOT NULL
- `idx_user_feedback_status` on `(status, created_at DESC)`

#### 3.2.18 garrison_recruits

Castle garrison recruitment pool with regional race/class bias (shared across all players).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| node_id | INTEGER | FK -> world_nodes.id NOT NULL | Castle node |
| name | VARCHAR(50) | NOT NULL | Recruit name |
| race | race_type | NOT NULL | Character race (regional bias) |
| gender | VARCHAR(20) | NOT NULL | male, female, other |
| class | class_type | NOT NULL | Character class (mixed classes) |
| level | INTEGER | DEFAULT 1 | Starting level |
| hp_max | INTEGER | NOT NULL | Maximum HP |
| mp_max | INTEGER | NOT NULL | Maximum MP |
| strength | INTEGER | NOT NULL | STR stat |
| intelligence | INTEGER | NOT NULL | INT stat |
| agility | INTEGER | NOT NULL | AGI stat |
| vitality | INTEGER | NOT NULL | VIT stat |
| luck | INTEGER | NOT NULL | LUK stat |
| stat_variance_percent | DECIMAL(5,2) | DEFAULT 0 | Variance from baseline |
| xp_pool | INTEGER | NOT NULL | Starting XP |
| price | INTEGER | NOT NULL | Gold cost |
| purchased_by | INTEGER | FK -> users.id | Buyer (null if available) |
| purchased_at | TIMESTAMP | | Purchase time |
| created_at | TIMESTAMP | DEFAULT NOW() | Generation time |

**Constraints:**
- Only castle nodes can have garrison recruits
- Recruits regenerate hourly with regional race bias

**Indexes:**
- `idx_garrison_recruits_node` on `(node_id, purchased_by)`
- `idx_garrison_recruits_available` on `node_id` WHERE purchased_by IS NULL

**Enemy Level Scaling Formula:**
```
enemy_level = floor(avg_party_level × tier_multiplier)

tier_multiplier:
  - Tier 1 (Forest): 0.8 - 1.0
  - Tier 2 (Cave): 1.0 - 1.2
  - Tier 3 (Mountain): 1.2 - 1.5
  - Tier 4 (Bridge Boss): 1.5 - 2.0

stat_scaling:
  - HP: base_hp × (1 + enemy_level × 0.1)
  - ATK: base_atk × (1 + enemy_level × 0.05)
  - DEF: base_def × (1 + enemy_level × 0.05)
```

### 3.3 Custom Types (ENUMs)

```sql
CREATE TYPE race_type AS ENUM ('elf', 'dwarf', 'vampire', 'human', 'orc');
CREATE TYPE class_type AS ENUM ('warrior', 'wizard', 'monk', 'chemist');
CREATE TYPE node_type AS ENUM (
  -- Core settlement types
  'castle', 'city', 'village', 'keep', 'farm', 'guild',
  -- Battle terrain types
  'forest', 'cave', 'mountain',
  -- Activity/neutral types
  'fishing_spot', 'merchant_caravan', 'ruins', 'watchtower',
  -- Inter-region types
  'bridge', 'palace',
  -- Terminator types (Ring 3+ dead-ends)
  'chest', 'shrine', 'discovery'
);
CREATE TYPE item_type AS ENUM ('weapon', 'armor', 'accessory',
                               'consumable', 'material', 'key_item');
CREATE TYPE equipment_slot AS ENUM ('main_hand', 'off_hand', 'head',
                                    'body', 'feet', 'accessory1', 'accessory2');
CREATE TYPE battle_type AS ENUM ('pve', 'pvp_coliseum');
CREATE TYPE battle_status AS ENUM ('active', 'victory', 'defeat', 'draw');
CREATE TYPE listing_status AS ENUM ('active', 'sold', 'cancelled', 'expired');
CREATE TYPE feedback_type AS ENUM ('enhancement', 'bug', 'abuse');
CREATE TYPE feedback_status AS ENUM ('pending', 'reviewing', 'resolved', 'declined');
```

### 3.4 JSON Structures

#### battle_state JSONB Schema

```json
{
  "turn": 1,
  "phase": "player_turn",
  "activeUnitIndex": 0,
  "units": [
    {
      "id": "char_123",
      "type": "player",
      "name": "Hero",
      "class": "warrior",
      "hp": 100,
      "maxHp": 100,
      "mp": 30,
      "maxMp": 30,
      "strength": 15,
      "intelligence": 8,
      "agility": 10,
      "tileX": 1,
      "tileY": 6,
      "hasActed": false,
      "statusEffects": []
    }
  ],
  "log": [
    {"turn": 1, "action": "move", "actor": "char_123", "from": [0,7], "to": [1,6]}
  ]
}
```

#### features JSONB Schema (world_nodes)

```json
["tavern", "blacksmith", "apothecary"]
```

#### stat_bonuses JSONB Schema (item_templates)

```json
{
  "strength": 5,
  "hp_max": 20,
  "agility": 2
}
```

### 3.5 PostgreSQL Timestamp Handling

**CRITICAL:** PostgreSQL `TIMESTAMP` (without timezone) stores values without timezone info. When Node.js parses these, it interprets them as **local time**, not UTC, which can cause serious calculation bugs.

**Example Bug:**
```
Database stores: 2026-01-11 02:58:37.278 (intended as UTC)
Node.js parses as: 2026-01-11 02:58:37 LOCAL TIME (EST = UTC-5)
Result: timestamp appears 5 hours in the FUTURE

Stamina calculation:
  elapsedMs = Date.now() - futureTimestamp = -18,000,000ms
  regenPoints = floor(-18,000,000 / 120,000) = -150
  current = min(8, 7 + (-150)) = -143  ← BUG!
```

**Solution:** Configure the `pg` library to parse TIMESTAMP as UTC:

```javascript
// In api/src/config/database.js
import pg from 'pg';

// Type OID 1114 = TIMESTAMP WITHOUT TIME ZONE
// Append 'Z' to indicate UTC, preventing local time interpretation
pg.types.setTypeParser(1114, (val) => {
  return val === null ? null : new Date(val + 'Z');
});
```

**Alternative:** Migrate all TIMESTAMP columns to TIMESTAMPTZ (stores with timezone).

**Affected Operations:**
- Stamina regeneration calculations
- Session expiration checks
- Any elapsed time computation
- Battle timeout checks

---

### 3.6 Migration Index

All database migrations are located in `api/src/migrations/` and run sequentially.

| # | File | Tables Created/Modified | Description |
|---|------|-------------------------|-------------|
| 001 | 001_initial_schema.sql | users, user_sessions, characters, world_nodes, world_node_connections, battles, item_templates, character_items | Core schema: auth, characters, world, battles, items |
| 002 | 002_character_skills.sql | character_skills | XP-based skill learning system |
| 003 | 003_shop_inventory.sql | shop_inventory, shop_transactions | NPC shop system with dynamic pricing |
| 004 | 004_marketplace.sql | marketplace_orders, marketplace_trades, gold_reservations, item_escrow | Player marketplace with order book |
| 005 | 005_chat_presence.sql | chat_messages, presence_status | Tavern chat and online presence |
| 006 | 006_fog_of_war.sql | discovered_nodes | Per-player world discovery tracking |
| 007 | 007_advanced_guilds.sql | (class enum extension) | Added berserker, sorcerer, ninja, alchemist classes |
| 008 | 008_character_gender.sql | characters.gender | Added gender column for portraits |
| 009 | 009_multiplayer_support.sql | parties, party_members, battle_players, pvp_ratings, coliseum_matches, leaderboard_cache | Multi-player parties and PvP infrastructure |
| 010 | 010_unified_unit_system.sql | enemy_templates, npc_skills | Unified enemy templates with AI config |
| 011 | 011_npc_skills.sql | (skill data) | NPC skill trees and monster archetypes |
| 012 | 012_guild_recruitment.sql | traits, guild_recruits, recruit_traits, recruit_skills, character_traits, world_nodes.recruit_refresh_hour | Trait system and guild recruitment pools |
| 013 | 013_user_settings.sql | user_settings | User preference storage (action menu style, etc.) |
| 014 | 014_social_pvp_systems.sql | notifications, friendships, lfg_posts, parties (fix), battles (pvp cols) | Notifications, friend system, LFG, PvP enhancements |
| 015 | 015_marketplace_audit.sql | marketplace_audit | Audit logging for marketplace security |
| 016 | 016_stamina_system.sql | characters (stamina cols) | Stamina tracking for world travel |
| 017 | 017_item_listings.sql | item_listings, item_listing_history | Unique item marketplace listings |
| 018 | 018_boss_mechanics.sql | enemy_templates (boss cols), boss_phases | Multi-phase boss encounter system |
| 019 | 019_node_blocking.sql | user_node_clearance | Combat node blocking until cleared |
| 020 | 020_guild_quest_system.sql | advancement_quest_templates, character_quests, character_quest_items, character_titles | Guild advancement quest system |
| 021 | 021_guildmaster_bosses.sql | guildmaster_templates, disciple_templates, advancement_battle_history | Guildmaster boss templates and battle history |
| 022 | 022_seed_metadata.sql | seed_metadata | Seed versioning for dev-setup |
| 023 | 023_order_expiration.sql | market_orders | Marketplace order expiration timestamps |
| 024 | 024_shared_inventory.sql | user_inventory | Shared inventory system across characters |
| 025 | 025_clans.sql | clans, clan_members, clan_invites | Clan system with ranks and invites |
| 026 | 026_skill_system_overhaul.sql | skill_templates, character_skills | Skill system overhaul with cooldowns |
| 027 | 027_terminator_nodes.sql | world_nodes (terminator cols) | Terminator nodes at map edges |
| 028 | 028_world_obstacles.sql | world_obstacles | World obstacle system for terrain |
| 029 | 029_regional_world.sql | world_regions, world_nodes (region cols) | Regional world system with 5 racial regions |
| 030 | 030_performance_indexes.sql | (indexes only) | Performance optimization indexes |
| 031 | 031_expanded_node_types.sql | (node_type enum) | Expanded node types (chest, shrine, discovery) |
| 032 | 032_elemental_system.sql | enemy_templates (elemental cols), characters (elemental cols) | Elemental damage and resistance system |
| 033 | 033_relic_system.sql | relics, character_relics | Relic collection system |
| 034 | 034_daily_weekly_quests.sql | daily_quests, weekly_quests, character_quest_progress | Daily/weekly quest system |
| 035 | 035_quest_bonuses.sql | quest_bonuses | Quest completion bonuses |
| 036 | 036_elite_quests.sql | elite_quest_templates, character_elite_quests | Elite quest challenges |
| 037 | 037_fix_character_hp_mp.sql | characters (hp/mp recalc) | HP/MP calculation fix for existing characters |
| 038 | 038_enemy_template_stats.sql | enemy_templates (vitality, luck, archetype, elemental_resistances) | Missing enemy stat columns |
| 039 | 039_zodiac_blessings.sql | user_zodiac_crystals, world_nodes (zodiac_sign), user_shrine_visits (signature cols) | Zodiac crystal collection system |
| 040 | 040_error_tracking.sql | exception_groups, exception_events, user_feedback | Error tracking and user feedback system |

**Migration Commands:**
```bash
npm run db:migrate        # Apply pending migrations
npm run db:status         # Show migration status
npm run db:rollback       # Roll back last migration (use with caution)
npm run db:fresh          # Drop all tables, re-migrate, re-seed
```

---

## 4. Frontend Architecture

### 4.1 Directory Structure

```
frontend/
├── package.json
└── public/
    ├── index.html
    ├── css/
    │   └── style.css
    └── src/
        ├── main.js                 # Entry point
        │
        ├── core/
        │   ├── Game.js             # Main game controller
        │   ├── StateManager.js     # Global state
        │   ├── SceneManager.js     # Scene transitions
        │   └── InputHandler.js     # Input abstraction
        │
        ├── api/
        │   ├── client.js           # HTTP client
        │   └── websocket.js        # WebSocket client
        │
        └── scenes/
            ├── Scene.js            # Base scene class
            ├── LoginScene.js
            ├── RegisterScene.js
            ├── CharacterSelectScene.js
            ├── CharacterCreateScene.js
            └── WorldMapScene.js
```

### 4.2 Game Loop

```javascript
class Game {
  gameLoop(currentTime) {
    // 1. Calculate delta time
    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    // 2. Update current scene (logic)
    this.scenes.update(deltaTime);

    // 3. Clear and render
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.scenes.render(this.ctx);

    // 4. Schedule next frame
    requestAnimationFrame((time) => this.gameLoop(time));
  }
}
```

### 4.3 State Management

```
┌─────────────────────────────────────────────────────────────────┐
│                      StateManager                                │
├─────────────────────────────────────────────────────────────────┤
│  state: {                                                        │
│    user: { id, username, gold }                                 │
│    token: "jwt..."                                              │
│    characters: [...]                                            │
│    activeCharacter: {...}                                       │
│    currentNode: {...}                                           │
│    battleState: {...}                                           │
│  }                                                              │
├─────────────────────────────────────────────────────────────────┤
│  Methods:                                                        │
│    get(key) → value                                             │
│    set(key, value) → notifies listeners                         │
│    subscribe(key, callback) → unsubscribe function              │
│    persist() → saves to localStorage                            │
│    hydrate() → loads from localStorage                          │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 Scene Lifecycle

```
┌─────────────┐
│  Inactive   │
└──────┬──────┘
       │ switchTo(sceneName)
       ▼
┌─────────────┐
│   enter()   │ ── Create UI, load data, setup listeners
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   update()  │◀─┐ ── Called every frame (deltaTime)
└──────┬──────┘  │
       │         │
       ▼         │
┌─────────────┐  │
│   render()  │──┘ ── Draw to canvas
└──────┬──────┘
       │ switchTo(otherScene)
       ▼
┌─────────────┐
│    exit()   │ ── Cleanup UI, remove listeners
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Inactive   │
└─────────────┘
```

### 4.5 Canvas Rendering Layers

```
┌─────────────────────────────────────┐
│          Modal Layer (top)          │  ← Dialogs, popups
├─────────────────────────────────────┤
│           HUD Layer                 │  ← Health bars, gold, menus
├─────────────────────────────────────┤
│          Game Layer                 │  ← Characters, world, battles
├─────────────────────────────────────┤
│       Background Layer              │  ← Sky, terrain base
└─────────────────────────────────────┘
```

---

## 5. Procedural Generation

### 5.1 World Generation Algorithm

The world uses a 6-phase 5-region generation system. Each region has a unique race-themed castle and is partitioned using Voronoi tessellation.

**Coordinate System:** 1 unit = 30 pixels. World bounds: [-50, 50] in both X and Y axes.

> **Full Documentation:** See `docs/WORLDGEN_TECHNICAL_DEEP_DIVE.md` for complete algorithm details, configuration reference, and debugging guide.

```
Input: seed (integer)

Phase 1: Castle Placement
  - Initialize SeededRandom(seed)
  - Place 5 castles using force-directed simulation + Lloyd's relaxation
  - Minimum distance between castles: 25 units
  - Each castle assigned a race (orc, elf, human, dwarf, vampire)
  - Note: Lloyd's implementation pushes AWAY from centroid (unconventional)

Phase 2: Voronoi Partitioning
  - Generate Voronoi diagram from castle positions (d3-delaunay library)
  - Each region bounded by Voronoi edges
  - Identify border segments between adjacent regions
  - Find Grand Palace position (farthest Voronoi vertex from all castles)
  - Note: Voronoi uses 0-indexed regions; other phases use 1-indexed

Phase 3: Internal Node Generation (per region)
  - ~60-80 nodes per region using Poisson disk sampling
  - Initial ring assignment via EUCLIDEAN distance from castle (approximation):
    - Ring 0 (0-5 units): Castle guards only
    - Ring 1 (5-12 units): Cities, villages, primary guild
    - Ring 2 (12-20 units): Keep, secondary guilds, farms
    - Ring 3 (20+ units): Battle nodes, activity nodes
  - Node type distribution:
    - Settlements: castle, 2-3 cities, 6-10 villages, 1 keep, 2-4 farms
    - Guilds: 3 per region (1 primary matching castle race, 2 secondary)
    - Battle: 40-50% (forest, cave, mountain)
    - Activity: 20-30% (fishing_spot, ruins, merchant_caravan)
    - Watchtower: max 1 per region (Ring 3+, 30% spawn chance)

Phase 4: Internal Connections
  - Minimum Spanning Tree for base connectivity
  - 20% extra connections beyond MST (max distance: 12 units)
  - Ring distance RECALCULATED via BFS from castle (authoritative):
    - Ring 0: 0 hops (castle itself)
    - Ring 1: 1-2 hops
    - Ring 2: 3-5 hops
    - Ring 3: 6+ hops

Phase 5: Inter-Region Connections
  - Border classification by edge length:
    - Short (<10 units): Bridge only
    - Medium (10-20 units): Bridge + wilderness zone (2-4 nodes)
    - Long (20+ units): Bridge + wilderness + trade route (3-5 nodes)
  - Bridge nodes: chokepoints between regions (exactly 2 connections)
  - Wilderness zones: higher difficulty border conflicts (thematic names)
  - Trade routes: safe paths connecting cities (commerce-themed names)
  - Grand Palace: endgame destination (tier 5 difficulty)
  - Gap infill: intermediate nodes inserted when connections exceed 13.3 units (400px)

Phase 6: Validation & Cleanup
  - Calculate difficulty tiers (1-5) based on ring distance
  - Assign terminators to Ring 3+ dead-ends (~6% of nodes):
    - 30% chest (one-time loot)
    - 30% shrine (temporary buffs)
    - 40% discovery (lore rewards)
  - Verify full connectivity (BFS from any castle)
  - Validate max spacing constraint (all connections ≤ 13.3 units / 400px)

Output: nodes[], connections[], regions[], palace
```

**Ring Distance Clarification:**
- Phase 3 uses Euclidean distance for initial type assignment (approximation)
- Phase 4 recalculates via BFS for authoritative ring values
- A node may change rings between Phase 3 and Phase 4

**Inter-Region Node Naming:**
- Trade routes: "Merchant's Rest", "Trader's Crossing", "Wayfarer's Glen"
- Wilderness zones: "Bandit's Hollow", "Outlaw Pass", "No Man's Land"
- Bridges: Region-pair specific names ("Border Crossing", "War's End Bridge")

### 5.2 Seeded Random Number Generator

```javascript
// Mulberry32 algorithm
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
```

### 5.3 Battle Map Generation

```
Input: seed, nodeType, width=8, height=8

1. Initialize SeededRandom(seed)

2. Define terrain probabilities by nodeType:
   - forest: { grass: 0.6, tree: 0.25, rock: 0.1, water: 0.05 }
   - cave: { stone: 0.7, rock: 0.15, lava: 0.1, water: 0.05 }
   - mountain: { rock: 0.5, stone: 0.3, snow: 0.15, cliff: 0.05 }

3. For each tile (x, y):
   a. Roll random value
   b. Assign terrain based on cumulative probability
   c. Set passable flag (trees, rocks, lava, cliffs = impassable)

4. Define spawn areas:
   - Player: bottom-left quadrant
   - Enemy: top-right quadrant

5. Validate connectivity:
   - Ensure path exists between spawn areas
   - If not, clear blocking tiles

6. Return { tiles[][], playerSpawns[], enemySpawns[] }
```

---

## 6. Deployment Architecture

### 6.1 Local Development Setup

For local development, PostgreSQL runs in a Docker container via Docker Compose.

#### Prerequisites

- Docker and Docker Compose installed
- Node.js 18+

#### Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: modia-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-modia}
      POSTGRES_USER: ${DB_USER:-modia}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-modia_dev_password}
    ports:
      - "${DB_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-modia} -d ${DB_NAME:-modia}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

#### Local Development Workflow

```bash
# 1. Start PostgreSQL container
docker compose up -d

# 2. Copy environment file
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Run database migrations
npm run db:migrate

# 5. Seed the database (generates world)
npm run db:seed

# 6. Start API server (with hot reload)
npm run dev:api

# 7. Start frontend dev server (separate terminal)
npm run dev:frontend
```

#### Useful Docker Commands

```bash
# View container status
docker compose ps

# View PostgreSQL logs
docker compose logs -f postgres

# Stop containers
docker compose down

# Stop and remove volumes (reset database)
docker compose down -v

# Connect to PostgreSQL CLI
docker compose exec postgres psql -U modia -d modia
```

#### Local Development Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Machine                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Browser (localhost:8080)                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            │                                 │
│              ┌─────────────┴─────────────┐                  │
│              │                           │                  │
│              ▼                           ▼                  │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │   Frontend Server   │    │     API Server      │        │
│  │   (npx serve :8080) │    │  (Node.js :3000)    │        │
│  └─────────────────────┘    └─────────────────────┘        │
│                                        │                    │
│                                        ▼                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Docker Container                           │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │           PostgreSQL 16 (:5432)                   │  │ │
│  │  │           Volume: postgres_data                   │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

### 6.2 Production Server Setup (4GB VPS)

```
┌─────────────────────────────────────────────────────────────────┐
│                        4GB VPS                                   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     Nginx                                  │  │
│  │  - Listen :80, :443                                       │  │
│  │  - SSL termination (Let's Encrypt)                        │  │
│  │  - Serve /frontend/public/* directly                      │  │
│  │  - Proxy /api/* → localhost:3000                          │  │
│  │  - Proxy /ws → localhost:3000 (WebSocket upgrade)         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     PM2                                    │  │
│  │  - 2 Node.js instances (cluster mode)                     │  │
│  │  - Max 1GB memory per instance                            │  │
│  │  - Auto-restart on crash                                  │  │
│  │  - Log rotation                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  PostgreSQL                                │  │
│  │  - shared_buffers: 512MB                                  │  │
│  │  - max_connections: 50                                    │  │
│  │  - Connection pool: 20                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Memory Budget:                                                  │
│  - OS + Nginx: ~500MB                                           │
│  - Node.js (2x): ~2GB                                           │
│  - PostgreSQL: ~1GB                                             │
│  - Buffer: ~500MB                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 PM2 Configuration

PM2 process layout is declared in `deploy.yaml` (`services:` block) and rendered on the VPS by `lsd` at deploy time — there is no checked-in `ecosystem.config.js`. Current production layout:

- `modia-api` — `api/src/index.js`, fork mode, single instance, 512M cap
- Single instance until WebSocket sticky sessions or Redis pub/sub are added

See `deploy.yaml` for the source of truth and `docs/DEPLOYMENT.md` for the deploy workflow.

### 6.3 Nginx Configuration

```nginx
upstream modia_api {
    ip_hash;  # Sticky sessions for WebSocket
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}

server {
    listen 80;
    server_name modia.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name modia.example.com;

    ssl_certificate /etc/letsencrypt/live/modia.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/modia.example.com/privkey.pem;

    # Frontend static files
    location / {
        root <APP_DIR>/frontend/public;
        try_files $uri $uri/ /index.html;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API proxy
    location /api {
        proxy_pass http://modia_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://modia_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

---

## 7. Security Considerations

### 7.1 Authentication Security

| Measure | Implementation |
|---------|----------------|
| Password Hashing | bcrypt with cost factor 12 |
| Token Signing | HS256 with 256-bit secret |
| Access Token Expiry | 15 minutes |
| Refresh Token Expiry | 7 days |
| Rate Limiting | 10 auth attempts per 15 min |

### 7.2 Input Validation

| Endpoint | Validation |
|----------|------------|
| Username | 3-32 chars, alphanumeric |
| Email | Valid email format |
| Password | Minimum 8 characters |
| Character Name | 2-24 chars |
| Chat Message | Max 160 chars, sanitized |

### 7.3 SQL Injection Prevention

All database queries use parameterized statements:

```javascript
// ✓ Safe
await query('SELECT * FROM users WHERE id = $1', [userId]);

// ✗ Unsafe (never do this)
await query(`SELECT * FROM users WHERE id = ${userId}`);
```

### 7.4 HTTPS

- TLS 1.2+ required in production
- SSL certificates via Let's Encrypt
- HSTS headers enabled

---

## 8. Monitoring and Logging

### 8.1 PM2 Monitoring

```bash
pm2 monit          # Real-time dashboard
pm2 logs           # View logs
pm2 status         # Instance status
```

### 8.2 Application Logging

```javascript
// Log levels: error, warn, info, debug
console.error('Database connection failed', err);
console.warn('Rate limit approaching for user', userId);
console.info('User registered', { userId, username });
console.log('Query executed', { duration: 50 });
```

### 8.3 Health Check Endpoint

```
GET /api/health

Response:
{
  "status": "ok",
  "timestamp": "2026-01-06T12:00:00.000Z",
  "uptime": 3600,
  "memory": {
    "used": 150000000,
    "total": 1000000000
  }
}
```

---

## 9. Future Scalability

### 9.1 Horizontal Scaling Path

When player count exceeds single server capacity:

1. **Database**: Migrate to managed PostgreSQL (RDS, Cloud SQL)
2. **Sessions**: Add Redis for shared state
3. **WebSocket**: Implement Redis pub/sub for cross-instance messaging
4. **Load Balancer**: Add external LB (nginx, HAProxy, or cloud LB)
5. **Static Assets**: Move to CDN

### 9.2 Database Sharding Strategy

If database becomes bottleneck:

- Shard by `user_id` for user/character data
- Keep world data on single instance (read replicas)
- Battles: partition by date for archival

---

## 10. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | Added character_xp, character_guilds, character_skills, enemy_templates tables; removed experience column; updated max level to 100; removed 'fled' status |
| 2.1 | Jan 2026 | - | Added battle WebSocket events (turn_start, intent_highlight, action_result, turn_end, your_turn, player_disconnected, player_reconnected, state_sync, end); added Section 2.5 Battle Turn Architecture; added battleTurnManager.js and battleReconnection.js to services directory |
| 2.2 | Jan 2026 | - | Section 5.1 World Generation: Clarified two-phase ring distance calculation (Euclidean in Phase 3, BFS in Phase 4); documented Lloyd's relaxation inversion; noted Voronoi 0-indexed vs nodesByRegion 1-indexed; added reference to WORLDGEN_TECHNICAL_DEEP_DIVE.md |
| 2.3 | Jan 2026 | - | Added migration 040 (error tracking); added tables exception_groups (3.2.15), exception_events (3.2.16), user_feedback (3.2.17); added feedback_type and feedback_status ENUMs (3.3) |
| 2.4 | Feb 2026 | - | Added garrison_recruits table (3.2.18) for castle recruitment with regional race/class bias. Updated default gold to 1000 (was 100). |
| 2.5 | Feb 2026 | - | Added utils directory with recruitmentUtils.js for shared recruit pricing and generation utilities. |
