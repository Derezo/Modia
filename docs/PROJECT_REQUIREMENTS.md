# Modia - Project Requirements Document

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 2.0 |
| Last Updated | January 2026 |
| Status | MVP Planning |

---

## 1. Executive Summary

### 1.1 Project Overview

Modia is a browser-based massively multiplayer online role-playing game (MMORPG) featuring:
- Tile-based isometric graphics
- Turn-based tactical combat
- Procedurally generated persistent world
- Party-based character management
- Real-time multiplayer features

### 1.2 Project Goals

1. Create an accessible browser-based RPG playable on any device
2. Support up to 25 concurrent players on a single 4GB VPS
3. Deliver a complete MVP with core gameplay loop within the planned timeline
4. Build a maintainable, extensible codebase for future expansion

### 1.3 Target Audience

- Casual RPG players seeking browser-based gaming
- Mobile gamers looking for deeper gameplay experiences
- Fans of tactical turn-based combat systems
- Players who enjoy persistent world exploration

---

## 2. Technical Requirements

### 2.1 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Backend Runtime | Node.js (v18+) | JavaScript ecosystem, async I/O, developer familiarity |
| Database | PostgreSQL | ACID compliance, JSON support, proven reliability |
| Frontend | Vanilla JavaScript + Canvas 2D | No build step, lightweight, universal browser support |
| Real-time | WebSocket (ws library) | Low latency, bidirectional communication |
| Authentication | JWT | Stateless, scalable, standard approach |
| Process Manager | PM2 | Clustering, monitoring, automatic restarts |

### 2.2 Infrastructure Requirements

| Requirement | Specification |
|-------------|---------------|
| Server | 4GB RAM VPS (minimum) |
| OS | Linux (Ubuntu 22.04 LTS recommended) |
| Node.js | v22.13.0 or higher (see `.nvmrc`) |
| PostgreSQL | v14 or higher |
| Storage | 20GB SSD minimum |
| Bandwidth | 100 Mbps |

### 2.3 Performance Targets

| Metric | Target |
|--------|--------|
| Concurrent Users | 25 maximum |
| API Response Time | < 200ms (p95) |
| WebSocket Latency | < 100ms |
| Page Load Time | < 3 seconds |
| Database Queries | < 50ms average |

### 2.4 Browser Support

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |
| Mobile Chrome | 90+ |
| Mobile Safari | 14+ |

### 2.5 Repository Structure

```
Modia/
├── api/                    # Backend Node.js application
├── frontend/               # Client-side application
├── shared/                 # Shared constants and utilities
├── docs/                   # Project documentation
├── package.json            # Monorepo workspace configuration
├── deploy.yaml             # lsd deploy configuration (VPS, secrets, services)
└── .env.example            # Environment variable template
```

---

## 3. Functional Requirements

### 3.1 Authentication System

#### FR-AUTH-001: User Registration
- **Description**: New users can create an account
- **Inputs**: Username (3-32 chars), Email, Password (8+ chars)
- **Outputs**: User account, JWT tokens
- **Acceptance Criteria**:
  - [ ] Username must be unique (case-insensitive)
  - [ ] Email must be valid format and unique
  - [ ] Password must be hashed with bcrypt (12 rounds)
  - [ ] System returns access token (15min) and refresh token (7 days)
  - [ ] New user starts with 100 gold

#### FR-AUTH-002: User Login
- **Description**: Existing users can authenticate
- **Inputs**: Username, Password
- **Outputs**: JWT tokens, user profile
- **Acceptance Criteria**:
  - [ ] Validate credentials against stored hash
  - [ ] Update last_login timestamp
  - [ ] Return access and refresh tokens
  - [ ] Rate limit: 10 attempts per 15 minutes

#### FR-AUTH-003: Token Refresh
- **Description**: Extend session without re-login
- **Inputs**: Valid refresh token
- **Outputs**: New access token
- **Acceptance Criteria**:
  - [ ] Validate refresh token signature and expiry
  - [ ] Return new access token
  - [ ] Original refresh token remains valid

#### FR-AUTH-004: Logout
- **Description**: Invalidate user session
- **Inputs**: Refresh token (optional)
- **Outputs**: Success confirmation
- **Acceptance Criteria**:
  - [ ] If refresh token provided, invalidate that session
  - [ ] If no token, invalidate all user sessions

---

### 3.2 Character System

#### FR-CHAR-001: Character Creation
- **Description**: Player creates a new character
- **Inputs**: Name (2-24 chars), Race, Class
- **Outputs**: New character with calculated stats
- **Acceptance Criteria**:
  - [ ] Name unique per user account
  - [ ] Race must be: Human, Elf, Dwarf, Vampire, or Orc
  - [ ] Class must be: Warrior, Wizard, Monk, or Chemist
  - [ ] Initial stats calculated from race + class combination
  - [ ] Character starts at level 1 with 0 experience
  - [ ] Character placed at central Castle node
  - [ ] Maximum 12 characters per account

#### FR-CHAR-002: Character Listing
- **Description**: View all characters on account
- **Outputs**: Array of character summaries
- **Acceptance Criteria**:
  - [ ] Return all characters owned by user
  - [ ] Include: id, name, race, class, level, HP/MP, party slot
  - [ ] Order by party slot, then creation date

#### FR-CHAR-003: Character Details
- **Description**: View full character information
- **Inputs**: Character ID
- **Outputs**: Complete character data with computed stats
- **Acceptance Criteria**:
  - [ ] Include base stats and equipment bonuses
  - [ ] Include current location information
  - [ ] Include equipped items
  - [ ] Only accessible by owning user

#### FR-CHAR-004: Character Deletion
- **Description**: Remove a character permanently
- **Inputs**: Character ID
- **Acceptance Criteria**:
  - [ ] Cannot delete character while in battle
  - [ ] Remove all associated inventory items
  - [ ] Cascade delete battle participation records

#### FR-CHAR-005: Character Leveling (XP-Spending System)
- **Description**: Characters level up by spending accumulated XP
- **Trigger**: Player manually invests XP from battle rewards
- **Acceptance Criteria**:
  - [ ] XP accumulates in character's XP pool from battles
  - [ ] Level formula: `XP Required for Level N = 100 × N^2.8`
  - [ ] Maximum level: 100
  - [ ] Spending XP on skills/level unlocks increases total_xp_spent
  - [ ] Character level derived from total_xp_spent
  - [ ] Stats increase per level based on class growth rates

---

### 3.3 Party System

#### FR-PARTY-001: View Formation
- **Description**: See current party arrangement
- **Outputs**: Characters in party slots 1-12
- **Acceptance Criteria**:
  - [ ] Show characters assigned to party slots
  - [ ] Include character summary data
  - [ ] Order by slot number

#### FR-PARTY-002: Update Formation
- **Description**: Rearrange characters in party
- **Inputs**: Array of {characterId, slot} assignments
- **Acceptance Criteria**:
  - [ ] Slots 1-12 valid
  - [ ] No duplicate slot assignments
  - [ ] All characters must belong to user
  - [ ] Characters not in formation have null slot

#### FR-PARTY-003: Set Battle Party
- **Description**: Select characters for combat
- **Inputs**: Array of up to 5 character IDs
- **Acceptance Criteria**:
  - [ ] Maximum 5 characters
  - [ ] Minimum 1 character
  - [ ] Any character may be selected (all start at full HP/MP each battle)
  - [ ] Assigns characters to slots 1-5

---

### 3.4 World Map System

#### FR-WORLD-001: World Generation
- **Description**: Procedurally generate the game world
- **Inputs**: Global seed value
- **Outputs**: Node graph with connections
- **Acceptance Criteria**:
  - [ ] Deterministic generation from seed
  - [ ] Central Castle node at origin (0,0)
  - [ ] All nodes interconnected (no isolated nodes)
  - [ ] Exactly one Palace node, minimum 13 nodes from center
  - [ ] Four Guild nodes (one per class) at distance 5-8
  - [ ] Node names procedurally generated

#### FR-WORLD-002: Node Types and Features
- **Description**: Each node type has specific features
- **Node Specifications**:

| Node Type | Features | Spawn Rules |
|-----------|----------|-------------|
| Castle | Coliseum, Tavern, Courtyard, Throne, Blacksmith, Apothecary, Temple, Stables, Marketplace | Central only |
| City | Tavern + 2 of (Blacksmith, Apothecary, Temple, Stables) | Any ring |
| Village | Farm + optional Apothecary (50% chance) | Any ring |
| Forest | Battle encounters | Ring 1+ |
| Cave | Battle encounters | Ring 2+ |
| Mountain | Battle encounters | Ring 2+ |
| Bridge | Battle encounters | Ring 2+ |
| Guild | Class-specific training | Distance 5-8 |
| Palace | Special (TBD) | Distance 13+ (exactly 1) |

#### FR-WORLD-003: Node Navigation
- **Description**: View and traverse the world map
- **Acceptance Criteria**:
  - [ ] Display all nodes on canvas with connections
  - [ ] Highlight current position
  - [ ] Show adjacent (traversable) nodes
  - [ ] Pan/zoom navigation controls

#### FR-WORLD-004: Travel Between Nodes
- **Description**: Move party to adjacent node
- **Inputs**: Target node ID
- **Acceptance Criteria**:
  - [ ] Target must be connected to current node
  - [ ] Cannot travel while in battle
  - [ ] All party characters move together
  - [ ] Update current_node_id for all party members

#### FR-WORLD-005: Node Interaction
- **Description**: Access node-specific features
- **Acceptance Criteria**:
  - [ ] Display available features for current node
  - [ ] Battle option for Forest/Cave/Mountain/Bridge nodes
  - [ ] Shop interfaces for Blacksmith/Apothecary
  - [ ] Chat interface for Tavern nodes

---

### 3.5 Battle System

#### FR-BATTLE-001: Initiate PvE Battle
- **Description**: Start combat at a battle node
- **Inputs**: Current node (must be battle type)
- **Outputs**: Battle instance with map and units
- **Acceptance Criteria**:
  - [ ] Generate 8x8 isometric tile map from seed
  - [ ] Place player units (up to 5) in spawn area
  - [ ] Generate enemies based on node difficulty
  - [ ] Calculate initiative order (agility-based)
  - [ ] Mark participating characters as in_battle

#### FR-BATTLE-002: Battle Map Generation
- **Description**: Create procedural battle terrain
- **Acceptance Criteria**:
  - [ ] 8x8 tile grid
  - [ ] Terrain types based on node type
  - [ ] Player spawn: bottom-left area
  - [ ] Enemy spawn: top-right area
  - [ ] Ensure valid paths between spawns

#### FR-BATTLE-003: Turn-Based Combat
- **Description**: Chess-style tactical combat
- **Turn Flow**:
  1. Determine turn order by initiative
  2. Active unit can: Move, Attack, Use Skill, Use Item, Wait
  3. Resolve action and effects
  4. Check win/lose conditions
  5. Advance to next unit

- **Acceptance Criteria**:
  - [ ] One action per unit per turn
  - [ ] Movement range based on class
  - [ ] Attack range based on weapon/skill
  - [ ] Status effects tick at turn end

#### FR-BATTLE-004: Movement System
- **Description**: Unit positioning on battle map
- **Acceptance Criteria**:
  - [ ] Base movement: 3 tiles for all classes
  - [ ] Movement bonuses from equipment/passives are additive
  - [ ] Terrain costs: Forest(2), Water(2), Normal(1)
  - [ ] Cannot move through occupied tiles
  - [ ] Cannot move through impassable terrain
  - [ ] Highlight valid movement tiles

#### FR-BATTLE-005: Attack System
- **Description**: Damage calculation and application
- **Formula**: `damage = (ATK * skill_power / 100) - (DEF * 0.3)`
- **Acceptance Criteria**:
  - [ ] Physical attacks use Strength vs Vitality
  - [ ] Magical attacks use Intelligence vs Intelligence/2
  - [ ] Critical hits: luck/200 chance, 1.5x damage
  - [ ] Minimum damage: 1

#### FR-BATTLE-006: Battle Resolution
- **Description**: End battle and distribute rewards
- **Victory Condition**: All enemies defeated
- **Defeat Condition**: All player units defeated
- **Acceptance Criteria**:
  - [ ] Calculate gold reward (base + variance)
  - [ ] Calculate experience reward
  - [ ] Distribute experience among surviving characters
  - [ ] Update character HP to post-battle values
  - [ ] Mark characters as not in_battle

---

### 3.6 Coliseum PvP System

#### FR-PVP-001: Matchmaking Queue
- **Description**: Find opponent for PvP battle
- **Inputs**: Battle party (up to 5 characters)
- **Acceptance Criteria**:
  - [ ] Calculate average party level
  - [ ] Match players within similar level range
  - [ ] Timeout after 2 minutes (return to queue or cancel)
  - [ ] WebSocket notifications for queue status

#### FR-PVP-002: PvP Battle
- **Description**: Real-time battle against another player
- **Acceptance Criteria**:
  - [ ] Same combat rules as PvE
  - [ ] 60 second turn timer
  - [ ] Auto-skip on timeout
  - [ ] Surrender option available
  - [ ] WebSocket sync for all actions

#### FR-PVP-003: PvP Rewards
- **Description**: Rewards for PvP participation
- **Acceptance Criteria**:
  - [ ] Winner receives gold and experience
  - [ ] Loser receives reduced experience (no gold)
  - [ ] Update leaderboard rankings

---

### 3.7 Real-Time Features

#### FR-RT-001: Tavern Chat
- **Description**: Per-node chat rooms
- **Acceptance Criteria**:
  - [ ] Join chat room when entering Tavern
  - [ ] Leave room when exiting Tavern
  - [ ] Messages broadcast to all room members
  - [ ] Show character name with messages
  - [ ] Message length limit: 160 characters
  - [ ] Client-side history scroll: 100 messages

#### FR-RT-002: Marketplace
- **Description**: Player-to-player trading
- **Acceptance Criteria**:
  - [ ] List items for sale with price
  - [ ] Browse/search active listings
  - [ ] Purchase listed items (gold transfer)
  - [ ] Real-time listing updates via WebSocket
  - [ ] Listing expiration: 7 days

#### FR-RT-003: Leaderboards
- **Description**: Player rankings
- **Categories**:
  - Highest character level
  - Most PvP wins
  - Most gold accumulated
- **Acceptance Criteria**:
  - [ ] Update on relevant events
  - [ ] Display top 100 per category
  - [ ] Show player's own rank

---

### 3.8 User Interface Requirements

#### FR-UI-001: Login Screen
- **Elements**: Logo, username input, password input, login button, register link
- **Acceptance Criteria**:
  - [ ] Form validation with error messages
  - [ ] Loading state during authentication
  - [ ] Remember session option

#### FR-UI-002: Registration Screen
- **Elements**: Username, email, password, confirm password inputs
- **Acceptance Criteria**:
  - [ ] Real-time validation feedback
  - [ ] Password strength indicator
  - [ ] Terms acceptance checkbox

#### FR-UI-003: Character Selection Screen
- **Elements**: 12-slot grid showing characters
- **Acceptance Criteria**:
  - [ ] Display character card with sprite, name, level, class
  - [ ] Empty slots show "Create Character" option
  - [ ] Click to select and enter game

#### FR-UI-004: Character Creation Screen
- **Elements**: Name input, race selection (5 options), class selection (4 options)
- **Acceptance Criteria**:
  - [ ] Visual selection with race/class icons
  - [ ] Description tooltip on hover
  - [ ] Preview of base stats
  - [ ] Create button (disabled until valid)

#### FR-UI-005: World Map Screen
- **Elements**: Node graph, current position indicator, menus
- **Acceptance Criteria**:
  - [ ] Pan with drag, zoom with scroll/pinch
  - [ ] Tap node to see details
  - [ ] Tap adjacent node to travel
  - [ ] Menu button for player options

#### FR-UI-006: Formation Screen
- **Elements**: 12-slot character grid, drag-drop interface
- **Acceptance Criteria**:
  - [ ] Drag characters to reorder
  - [ ] Slots 1-5 highlighted as "Battle Party"
  - [ ] Character stats visible on selection
  - [ ] Save button to confirm changes

#### FR-UI-007: Battle Screen
- **Elements**: Isometric tile map, unit sprites, action menu, turn order
- **Acceptance Criteria**:
  - [ ] Clear visual for active unit
  - [ ] Movement range highlighting
  - [ ] Attack range highlighting
  - [ ] HP/MP bars above units
  - [ ] Action menu: Move, Attack, Skill, Item, Wait
  - [ ] Battle log for action history

---

## 4. Non-Functional Requirements

### 4.1 Security

| ID | Requirement |
|----|-------------|
| NFR-SEC-001 | Passwords hashed with bcrypt (cost factor 12) |
| NFR-SEC-002 | JWT tokens signed with HS256 algorithm |
| NFR-SEC-003 | Rate limiting on authentication endpoints |
| NFR-SEC-004 | SQL injection prevention via parameterized queries |
| NFR-SEC-005 | XSS prevention via input sanitization |
| NFR-SEC-006 | HTTPS required in production |

### 4.2 Performance

| ID | Requirement |
|----|-------------|
| NFR-PERF-001 | Support 25 concurrent users |
| NFR-PERF-002 | API response time < 200ms (p95) |
| NFR-PERF-003 | WebSocket message latency < 100ms |
| NFR-PERF-004 | Client-side rendering at 30+ FPS |
| NFR-PERF-005 | Initial page load < 3 seconds |

### 4.3 Reliability

| ID | Requirement |
|----|-------------|
| NFR-REL-001 | 99% uptime target |
| NFR-REL-002 | Automatic process restart on crash (PM2) |
| NFR-REL-003 | Database connection pooling |
| NFR-REL-004 | Graceful degradation on WebSocket failure |

### 4.4 Scalability

| ID | Requirement |
|----|-------------|
| NFR-SCALE-001 | Stateless API design for horizontal scaling |
| NFR-SCALE-002 | Database schema supports sharding by user_id |
| NFR-SCALE-003 | WebSocket rooms for targeted broadcasts |

### 4.5 Maintainability

| ID | Requirement |
|----|-------------|
| NFR-MAINT-001 | Code organized by feature/domain |
| NFR-MAINT-002 | Consistent error handling patterns |
| NFR-MAINT-003 | Database migrations for schema changes |
| NFR-MAINT-004 | Environment-based configuration |

---

## 5. User Stories

### 5.1 Authentication

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-001 | New player | Register an account | I can save my progress |
| US-002 | Returning player | Log in to my account | I can continue playing |
| US-003 | Player | Stay logged in | I don't have to re-authenticate frequently |
| US-004 | Player | Log out | I can secure my account on shared devices |

### 5.2 Character Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-005 | New player | Create my first character | I can start playing |
| US-006 | Player | Choose race and class | I can customize my playstyle |
| US-007 | Player | View my characters | I can see their stats and progress |
| US-008 | Player | Delete a character | I can free up slots for new characters |
| US-009 | Player | Have multiple characters | I can try different builds |

### 5.3 Party Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-010 | Player | Arrange my party formation | I can organize my characters |
| US-011 | Player | Select my battle party | I can choose who fights |
| US-012 | Player | See party member status | I know who needs healing |

### 5.4 World Exploration

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-013 | Player | See the world map | I can plan my journey |
| US-014 | Player | Travel between nodes | I can explore new areas |
| US-015 | Player | See what's at each node | I know what activities are available |
| US-016 | Player | Return to the castle | I can access all services |

### 5.5 Combat

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-017 | Player | Start a battle | I can earn rewards |
| US-018 | Player | Move my units tactically | I can gain positional advantage |
| US-019 | Player | Attack enemies | I can defeat them |
| US-020 | Player | Use skills and items | I can employ strategy |
| US-021 | Player | Surrender in PvP | I can end a losing match early |
| US-022 | Player | Win battles | I can earn gold and experience |

### 5.6 PvP

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-023 | Player | Queue for PvP | I can fight other players |
| US-024 | Player | Fight matched opponents | Battles are fair |
| US-025 | Player | Earn PvP rewards | I'm incentivized to compete |
| US-026 | Player | See my ranking | I can track my progress |

### 5.7 Social

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-027 | Player | Chat in taverns | I can socialize |
| US-028 | Player | Trade with others | I can get items I need |
| US-029 | Player | See leaderboards | I can compare with others |

---

## 6. Glossary

| Term | Definition |
|------|------------|
| Node | A location on the world map that can be visited |
| Party | The player's collection of up to 12 characters |
| Battle Party | The 5 characters selected for combat |
| Formation | The arrangement of characters in party slots |
| Initiative | Combat stat determining turn order |
| PvE | Player versus Environment (fighting NPCs) |
| PvP | Player versus Player (fighting other players) |
| Seed | Random number used for deterministic generation |
| MVP | Minimum Viable Product |

---

## 7. Appendices

### Appendix A: Race Statistics

| Race | HP | MP | STR | INT | AGI | VIT | LUK | Racial Trait |
|------|----|----|-----|-----|-----|-----|-----|--------------|
| Human | 100 | 50 | 10 | 10 | 10 | 10 | 10 | +10 MDEF, +10 MATK, -10% Max MP |
| Elf | 80 | 80 | 8 | 14 | 12 | 6 | 10 | +5% MP Regen per turn |
| Dwarf | 120 | 30 | 14 | 6 | 6 | 16 | 8 | +15% Two-Handed Weapon Damage |
| Vampire | 90 | 60 | 12 | 12 | 14 | 8 | 4 | 10% Lifesteal (no overkill healing) |
| Orc | 130 | 20 | 16 | 4 | 8 | 14 | 8 | +25% Crit Damage (additive: 175% total) |

### Appendix B: Class Growth Rates (Per Level)

| Class | HP | MP | STR | INT | AGI | VIT | Role |
|-------|----|----|-----|-----|-----|-----|------|
| Warrior | +15 | +3 | +3 | +1 | +1 | +2 | Tank/Melee DPS |
| Wizard | +8 | +12 | +1 | +4 | +1 | +1 | Ranged Magic DPS |
| Monk | +10 | +6 | +2 | +2 | +3 | +1 | Mobile Melee DPS |
| Chemist | +10 | +8 | +1 | +2 | +2 | +2 | Support/Healer |

### Appendix C: XP-Spending Level Table

Characters level up by spending accumulated XP on skills. Character level is derived from `total_xp_spent`.

**Formula**: `XP Required for Level N = 100 × N^2.8`

| Level | Total XP Spent | XP to Next Level |
|-------|----------------|------------------|
| 1 | 0 | 693 |
| 5 | 9,052 | 3,048 |
| 10 | 63,096 | 10,185 |
| 25 | 820,008 | 47,715 |
| 50 | 5,714,965 | 160,181 |
| 75 | 17,777,247 | 326,108 |
| 100 | 39,810,717 | N/A (Max) |

*Note: The 2.8 exponent creates a steep late-game curve. See [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) for detailed thresholds.*

*Note: XP is earned from battles and spent to unlock/level skills. The total spent determines character level.*

---

## 8. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | XP-spending leveling system; removed flee mechanic; updated racial traits; base movement 3 for all; chat limit 160 chars; updated XP formula to 100×N^2.2 |
