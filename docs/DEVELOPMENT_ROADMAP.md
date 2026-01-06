# Modia - Development Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 2.0 |
| Last Updated | January 2026 |

---

## 1. Development Overview

### 1.1 Development Philosophy

- **Iterative Development**: Build in small, testable increments
- **Playable Early**: Each phase produces a functional game state
- **Documentation First**: Requirements documented before implementation
- **Test As You Go**: Verify each feature before moving on

### 1.2 Phase Summary

| Phase | Focus | Key Deliverables |
|-------|-------|------------------|
| 1 | Foundation | Auth, DB, Project Setup |
| 2 | Characters & World | Character CRUD, World Map |
| 3 | Combat | Battle System, PvE |
| 4 | Economy | Items, Shops, Inventory |
| 5 | Multiplayer | WebSocket, Chat, PvP, Trading |
| 6 | Polish & Launch | UI, Balance, Deployment |

---

## 2. Phase 1: Foundation

### 2.1 Objectives

Establish the technical foundation for the project including authentication, database, and project structure.

### 2.2 Tasks

#### 2.2.1 Project Setup

- [x] Initialize monorepo with npm workspaces
- [x] Create API package structure
- [x] Create frontend package structure
- [x] Create shared constants package
- [x] Configure PM2 ecosystem file
- [x] Create .env.example template
- [x] Create .gitignore

#### 2.2.2 Database

- [x] Design complete database schema
- [x] Create migration system
- [x] Write 001_initial_schema.sql migration
- [x] Create database seeding script
- [x] Implement world generation seed
- [ ] Test migration rollback

#### 2.2.3 Authentication API

- [x] POST /api/auth/register
- [x] POST /api/auth/login
- [x] POST /api/auth/refresh
- [x] POST /api/auth/logout
- [x] GET /api/auth/me
- [x] JWT token generation/verification
- [x] Password hashing with bcrypt
- [x] Rate limiting middleware

#### 2.2.4 Frontend Foundation

- [x] HTML entry point
- [x] CSS base styles
- [x] Game class and loop
- [x] StateManager implementation
- [x] SceneManager implementation
- [x] InputHandler implementation
- [x] API client wrapper
- [x] WebSocket client wrapper

#### 2.2.5 Auth UI

- [x] LoginScene implementation
- [x] RegisterScene implementation
- [ ] Form validation feedback
- [ ] Loading states
- [ ] Error handling UI

### 2.3 Acceptance Criteria

- [ ] User can register a new account
- [ ] User can log in with existing credentials
- [ ] Invalid credentials show error message
- [ ] JWT tokens are stored and used for API calls
- [ ] Session persists across page refresh
- [ ] User can log out

### 2.4 Testing Checklist

- [ ] Register with valid credentials → Success
- [ ] Register with duplicate username → Error
- [ ] Register with invalid email → Error
- [ ] Login with valid credentials → Success
- [ ] Login with wrong password → Error
- [ ] Access protected route without token → 401
- [ ] Access protected route with valid token → Success
- [ ] Refresh token before expiry → New access token
- [ ] Use expired refresh token → Error

---

## 3. Phase 2: Characters & World

### 3.1 Objectives

Implement character creation, management, and world map navigation.

### 3.2 Tasks

#### 3.2.1 Character API

- [x] GET /api/characters (list)
- [x] POST /api/characters (create)
- [x] GET /api/characters/:id (details)
- [x] PUT /api/characters/:id (update)
- [x] DELETE /api/characters/:id
- [x] GET /api/characters/:id/stats
- [ ] Character stat calculation service
- [ ] Race/class validation

#### 3.2.2 Party API

- [x] GET /api/party
- [x] PUT /api/party (formation)
- [x] PUT /api/party/battle
- [ ] Validation for party constraints

#### 3.2.3 World API

- [x] GET /api/world/seed
- [x] GET /api/world/nodes
- [x] GET /api/world/nodes/:id
- [x] POST /api/world/travel
- [x] GET /api/world/current
- [ ] Node adjacency validation
- [ ] Travel restrictions

#### 3.2.4 World Generation

- [x] SeededRandom implementation
- [x] World generation algorithm
- [x] Node placement (rings)
- [x] Guild placement (4 nodes)
- [x] Palace placement (1 node)
- [x] Connection generation
- [x] Feature assignment
- [ ] Name generation variety
- [ ] Difficulty tier calculation

#### 3.2.5 Character UI

- [x] CharacterSelectScene
- [x] CharacterCreateScene
- [x] Race selection interface
- [x] Class selection interface
- [ ] Stat preview display
- [ ] Character card component
- [ ] FormationScene implementation

#### 3.2.6 World Map UI

- [x] WorldMapScene basic implementation
- [x] Node rendering
- [x] Connection rendering
- [x] Current position indicator
- [x] Travel to adjacent nodes
- [ ] Pan and zoom controls
- [ ] Node hover information
- [ ] Node type icons/colors
- [ ] Mini-map display

### 3.3 Acceptance Criteria

- [ ] User can create character with name/race/class
- [ ] Character appears in selection screen
- [ ] User can delete character
- [ ] World map displays all nodes
- [ ] User can travel to adjacent nodes
- [ ] Cannot travel to non-adjacent nodes
- [ ] Current location is highlighted
- [ ] Node features are displayed

### 3.4 Testing Checklist

- [ ] Create character with all race/class combinations
- [ ] Attempt to create 13th character → Error
- [ ] Delete character → Removed from list
- [ ] View world map → All nodes visible
- [ ] Click adjacent node → Travel succeeds
- [ ] Click non-adjacent node → Travel fails
- [ ] World generation is deterministic (same seed = same world)

---

## 4. Phase 3: Combat System

### 4.1 Objectives

Implement the core turn-based tactical battle system for PvE encounters.

### 4.2 Tasks

#### 4.2.1 Battle API

- [x] POST /api/battle/start
- [x] GET /api/battle/current
- [x] POST /api/battle/action
- [x] GET /api/battle/rewards/:id
- [ ] Battle state validation
- [ ] Turn order management
- [ ] Action resolution

> **Note**: Flee mechanic removed from design. Characters respawn at last safe node on party wipe.

#### 4.2.2 Battle Engine

- [ ] Battle state machine
- [ ] Initiative calculation
- [ ] Movement system
  - [ ] Base movement: 3 tiles for all classes
  - [ ] Pathfinding (A*)
  - [ ] Terrain costs (Forest: 2, Water: 2, Normal: 1)
- [ ] Attack system
  - [ ] Damage calculation
  - [ ] Critical hits
  - [ ] Elemental damage
- [ ] Skill system
  - [ ] Load skill trees from SKILL_TREES.md definitions
  - [ ] XP-spending skill learning
  - [ ] MP consumption
  - [ ] Area of effect
- [ ] Status effects (no stacking, refresh duration only)
  - [ ] Effect application
  - [ ] Duration tracking
  - [ ] Turn-end processing
- [ ] Win/lose detection
- [ ] Reward calculation

#### 4.2.2.1 Skill Learning API (see API_SPECIFICATION.md Section 8-9)

- [ ] POST /api/skills/learn
- [ ] GET /api/skills/tree/:guildId
- [ ] GET /api/characters/:id/skills
- [ ] GET /api/guilds
- [ ] GET /api/guilds/:guildId
- [ ] GET /api/characters/:id/guilds

> **Note**: MVP includes 8 guilds (4 base + 4 advanced) as defined in SKILL_TREES.md

#### 4.2.3 Enemy System

- [x] Enemy template database (see ENEMY_SYSTEM.md)
- [ ] Enemy spawning by node type and difficulty tier
- [ ] Level scaling (enemy_level = avg_party_level × tier_multiplier)
- [ ] Enemy AI (7 archetypes defined in ENEMY_SYSTEM.md)
  - [ ] Aggressive, Defensive, Support, Tactical
  - [ ] Pack, Hit-and-Run, Ambush
  - [ ] Target selection
  - [ ] Ability usage
  - [ ] Positioning

#### 4.2.4 Battle Map Generation

- [ ] Terrain generation by node type
- [ ] Spawn point calculation
- [ ] Passability validation
- [ ] Path verification

#### 4.2.5 Battle UI

- [ ] BattleScene implementation
- [ ] Isometric tile rendering
- [ ] Unit sprites
- [ ] Movement range overlay
- [ ] Attack range overlay
- [ ] Action menu
  - [ ] Move option
  - [ ] Attack option
  - [ ] Skill submenu
  - [ ] Item submenu
  - [ ] Wait option
- [ ] Turn order display
- [ ] HP/MP bars
- [ ] Battle log
- [ ] Victory/defeat screens
- [ ] Reward display

#### 4.2.6 Isometric Rendering

- [ ] Coordinate conversion (screen ↔ tile)
- [ ] Tile drawing order (depth sort)
- [ ] Unit positioning
- [ ] Animation system
  - [ ] Idle animation
  - [ ] Attack animation
  - [ ] Damage animation
  - [ ] Movement animation

### 4.3 Acceptance Criteria

- [ ] User can initiate battle at battle nodes
- [ ] Battle map generates correctly
- [ ] Units display in correct positions
- [ ] Player can move units within range (base: 3 tiles)
- [ ] Player can attack enemies in range
- [ ] Damage is calculated correctly
- [ ] Enemies take turns and act (AI archetypes)
- [ ] Battle ends on victory/defeat
- [ ] Rewards are distributed correctly
- [ ] XP is added to character's XP pool for skill spending

### 4.4 Testing Checklist

- [ ] Start battle at Forest node → Forest-themed map
- [ ] Start battle at Cave node → Cave-themed map
- [ ] Move unit → Valid positions only (3 tiles base)
- [ ] Attack enemy → Damage applied
- [ ] Defeat enemy → Removed from battle
- [ ] Defeat all enemies → Victory
- [ ] All player units defeated → Respawn at safe node
- [ ] XP awarded → Added to XP pool for skill spending

---

## 5. Phase 4: Economy & Inventory

### 5.1 Objectives

Implement the item system, inventory management, and NPC shops.

### 5.2 Tasks

#### 5.2.1 Item System

- [x] Item template database
- [ ] Item type handling
  - [ ] Weapons
  - [ ] Armor
  - [ ] Accessories
  - [ ] Consumables
- [ ] Equipment slots
- [ ] Stat bonuses from equipment
- [ ] Item rarity system

#### 5.2.2 Inventory API (see API_SPECIFICATION.md Section 10)

- [ ] GET /api/inventory/:characterId
- [ ] POST /api/inventory/equip
- [ ] POST /api/inventory/unequip
- [ ] POST /api/inventory/use
- [ ] POST /api/inventory/discard

#### 5.2.3 Shop API (see API_SPECIFICATION.md Section 11)

- [ ] GET /api/shops/:nodeId
- [ ] GET /api/shops/:nodeId/:shopType/inventory
- [ ] POST /api/shops/:nodeId/:shopType/buy
- [ ] POST /api/shops/:nodeId/:shopType/sell
- [ ] Shop inventory by type (weapon, armor, item, guild)
- [ ] Supply level pricing system

#### 5.2.4 Inventory UI

- [ ] InventoryScene implementation
- [ ] Item grid display
- [ ] Item detail modal
- [ ] Equip/unequip interface
- [ ] Character equipment slots
- [ ] Stat comparison
- [ ] Item use confirmation

#### 5.2.5 Shop UI

- [ ] ShopScene implementation
- [ ] Shop inventory display
- [ ] Buy interface
- [ ] Sell interface
- [ ] Price display
- [ ] Gold balance display

#### 5.2.6 Item Integration

- [ ] Loot drops from battles (see ITEM_SYSTEM.md Section 11)
  - [ ] Regular enemies: 1-3 items
  - [ ] Boss enemies: 2-4 items, guaranteed rare+
- [ ] Item use in battle
- [ ] Equipment stat application
- [ ] Consumable effects

### 5.3 Acceptance Criteria

- [ ] Characters have inventory
- [ ] Items can be equipped/unequipped
- [ ] Equipment affects stats
- [ ] NPC shops sell items
- [ ] User can buy items with gold
- [ ] User can sell items for gold
- [ ] Consumables work in battle
- [ ] Loot drops after battles

### 5.4 Testing Checklist

- [ ] View inventory → Shows items
- [ ] Equip weapon → Stats change
- [ ] Unequip weapon → Stats revert
- [ ] Buy item → Gold deducted, item added
- [ ] Sell item → Gold added, item removed
- [ ] Use potion in battle → HP restored
- [ ] Win battle → Loot received

---

## 6. Phase 5: Multiplayer Features

### 6.1 Objectives

Implement real-time multiplayer features including chat, trading, and PvP.

### 6.2 Tasks

#### 6.2.1 WebSocket Infrastructure

- [x] WebSocket server setup
- [x] Connection management
- [x] Authentication via JWT
- [x] Room/channel system
- [ ] Heartbeat/keepalive
- [ ] Reconnection handling
- [ ] Cross-instance messaging (future)

#### 6.2.2 Tavern Chat

- [x] join_room event
- [x] leave_room event
- [x] chat_message event
- [ ] Message history (recent)
- [ ] User list display
- [ ] TavernScene implementation

#### 6.2.3 Marketplace (see API_SPECIFICATION.md Section 12)

- [ ] GET /api/marketplace/orderbook/:itemTemplateId
- [ ] GET /api/marketplace/orders/mine
- [ ] POST /api/marketplace/orders/limit
- [ ] POST /api/marketplace/orders/market
- [ ] DELETE /api/marketplace/orders/:orderId
- [ ] GET /api/marketplace/history/:itemTemplateId
- [ ] Max 10 open orders per player (buy + sell combined)
- [ ] WebSocket listing updates
- [ ] MarketplaceScene implementation
- [ ] Order book display
- [ ] Listing creation UI
- [ ] Purchase confirmation

#### 6.2.4 Coliseum PvP (see API_SPECIFICATION.md Section 7.7)

- [x] coliseum_queue_join event
- [x] coliseum_queue_leave event
- [ ] Matchmaking algorithm
- [ ] PvP battle initialization
- [ ] Real-time turn sync (pvp:turn_sync event)
- [ ] pvp:queue_joined, pvp:match_found events
- [ ] pvp:opponent_action, pvp:disconnect events
- [ ] Turn timer (60 seconds)
- [ ] Surrender option
- [ ] Match results
- [ ] ColiseumScene implementation
- [ ] Queue status display
- [ ] Opponent display
- [ ] PvP battle UI

#### 6.2.5 Leaderboards

- [ ] GET /api/leaderboard/:category
- [ ] Leaderboard calculation
- [ ] Real-time updates
- [ ] LeaderboardScene implementation

### 6.3 Acceptance Criteria

- [ ] Users can chat in Tavern
- [ ] Chat messages appear in real-time
- [ ] Users can list items for sale
- [ ] Users can purchase listings
- [ ] Listings update in real-time
- [ ] Users can queue for PvP
- [ ] Matched players enter battle
- [ ] PvP battles work correctly
- [ ] Leaderboards display rankings

### 6.4 Testing Checklist

- [ ] Two users chat → Messages visible to both
- [ ] Create marketplace listing → Appears for all
- [ ] Purchase listing → Item transferred, gold transferred
- [ ] Queue for PvP → Wait for match
- [ ] Two users queue → Matched together
- [ ] Complete PvP battle → Results recorded
- [ ] Check leaderboard → Rankings correct

---

## 7. Phase 6: Polish & Launch

### 7.1 Objectives

Finalize the game for initial release with UI polish, balance, and deployment.

### 7.2 Tasks

#### 7.2.1 UI/UX Polish

- [ ] Consistent visual theme
- [ ] Responsive design testing
- [ ] Mobile touch optimization
- [ ] Loading indicators
- [ ] Error messages
- [ ] Success feedback
- [ ] Tooltips and help text
- [ ] Smooth transitions
- [ ] Animation polish

#### 7.2.2 Game Balance

- [ ] Stat curve review
- [ ] Damage formula tuning
- [ ] Enemy difficulty scaling
- [ ] Gold economy balance
- [ ] Experience curve review
- [ ] Item pricing balance
- [ ] PvP matchmaking tuning

#### 7.2.3 Performance

- [ ] API response time audit
- [ ] Database query optimization
- [ ] Frontend render performance
- [ ] Memory usage profiling
- [ ] WebSocket efficiency
- [ ] Asset optimization

#### 7.2.4 Testing

- [ ] Full gameplay walkthrough
- [ ] Edge case testing
- [ ] Cross-browser testing
- [ ] Mobile device testing
- [ ] Load testing (25 users)
- [ ] Security audit

#### 7.2.5 Deployment

- [ ] VPS server setup
- [ ] PostgreSQL installation
- [ ] Node.js installation
- [ ] Nginx configuration
- [ ] SSL certificate (Let's Encrypt)
- [ ] PM2 configuration
- [ ] Domain setup
- [ ] Monitoring setup
- [ ] Backup strategy
- [ ] Deployment documentation

#### 7.2.6 Documentation

- [x] PROJECT_REQUIREMENTS.md (v2.0)
- [x] TECHNICAL_ARCHITECTURE.md (v2.0)
- [x] GAME_DESIGN.md (v2.0)
- [x] DEVELOPMENT_ROADMAP.md (v2.0)
- [x] API_SPECIFICATION.md (v2.0)
- [x] CHARACTER_PROGRESSION.md (v2.0)
- [x] ITEM_SYSTEM.md (v2.0)
- [x] ECONOMY_SYSTEM.md (v2.0)
- [x] SKILL_TREES.md (v1.0 - NEW)
- [x] ENEMY_SYSTEM.md (v1.0 - NEW)
- [ ] README.md (setup guide)
- [ ] CONTRIBUTING.md
- [ ] CHANGELOG.md

### 7.3 Launch Checklist

- [ ] All Phase 1-5 features complete
- [ ] All critical bugs fixed
- [ ] Performance targets met
- [ ] Security review passed
- [ ] Deployment successful
- [ ] DNS configured
- [ ] SSL working
- [ ] Monitoring active
- [ ] Backup tested

---

## 8. Post-Launch Roadmap

### 8.1 Immediate Post-Launch

- Bug fixes and hotfixes
- Performance monitoring
- Player feedback collection
- Balance adjustments

### 8.2 Version 1.1 Features

| Feature | Description |
|---------|-------------|
| Remaining Advanced Guilds | 12 additional guilds beyond MVP's 4 advanced |
| Guild Quest System | Guild advancement through quests |
| More Skills | Expand skill trees beyond MVP definitions |
| New Enemies | Additional enemy types per terrain |
| Quest System | Daily/weekly quests |

### 8.3 Version 1.2 Features

| Feature | Description |
|---------|-------------|
| Guild System | Player guilds |
| Cooperative Battles | Team vs bosses |
| Equipment Crafting | Item creation |
| Achievement System | Milestones and rewards |

### 8.4 Long-term Vision

| Feature | Description |
|---------|-------------|
| New Regions | Expand world map |
| New Races/Classes | More character options |
| Seasonal Events | Limited-time content |
| Mobile App | Native mobile clients |

---

## 9. Risk Assessment

### 9.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebSocket scalability | High | Redis pub/sub for multi-instance |
| Database bottleneck | Medium | Query optimization, read replicas |
| Memory limits | Medium | PM2 memory restart, profiling |
| Browser compatibility | Low | Progressive enhancement, polyfills |

### 9.2 Game Design Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Unbalanced combat | High | Iterative testing, player feedback |
| Boring progression | High | Multiple progression paths |
| Economy inflation | Medium | Gold sinks, monitoring |
| Low player retention | High | Daily rewards, social features |

### 9.3 Project Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope creep | High | Strict MVP definition |
| Technical debt | Medium | Regular refactoring |
| Documentation lag | Low | Document during development |

---

## 10. Success Metrics

### 10.1 Technical Metrics

| Metric | Target |
|--------|--------|
| API uptime | 99% |
| API response time (p95) | < 200ms |
| WebSocket latency | < 100ms |
| Error rate | < 1% |
| Concurrent users | 25 |

### 10.2 Game Metrics

| Metric | Target |
|--------|--------|
| New registrations | Track |
| Daily active users | Track |
| Session duration | > 15 min average |
| Battle completion rate | > 80% |
| Character progression | Track levels |

---

## 11. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | Documentation overhaul: Updated task tracking to reflect XP-spending system, removed flee mechanic, added SKILL_TREES.md and ENEMY_SYSTEM.md references, updated API endpoints to match API_SPECIFICATION.md v2.0, added drop table and enemy AI references, marked all documentation as complete |
