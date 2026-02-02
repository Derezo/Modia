# Modia - API Specification

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| API Version | 2.9 |
| Base URL | `/api` |
| Last Updated | February 2026 |

---

## 1. Overview

### 1.1 Base URL

```
Development: http://localhost:3000/api
Production:  https://modia.example.com/api
```

### 1.2 Authentication

Most endpoints require JWT authentication via the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### 1.3 Response Format

All responses are JSON with the following structure:

**Success Response:**
```json
{
  "data": { ... }
}
```

**Error Response:**
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "requestId": "uuid-string",
  "details": { ... }
}
```

> **Note:** All error responses include a `requestId` field (UUID) for correlation with server-side exception tracking. Include this ID when reporting issues to help with debugging.

### 1.4 HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

---

## 2. Authentication Endpoints

### 2.1 Register

Create a new user account.

```
POST /api/auth/register
```

**Request Body:**
```json
{
  "username": "string (3-32 chars)",
  "email": "string (valid email)",
  "password": "string (8+ chars)"
}
```

**Response (201 Created):**
```json
{
  "user": {
    "id": 1,
    "username": "player1",
    "email": "player1@example.com",
    "gold": 1000
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Username, email, and password are required |
| 400 | Username must be between 3 and 32 characters |
| 400 | Password must be at least 8 characters |
| 400 | Invalid email format |
| 409 | Username already exists |
| 409 | Email already exists |

---

### 2.2 Register with Character

Atomic registration endpoint that creates a user account and first character in a single transaction. If any step fails, the entire operation rolls back.

```
POST /api/auth/register-with-character
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| username | string | Yes | 3-32 characters |
| email | string | Yes | Valid email format |
| password | string | Yes | Minimum 8 characters |
| characterName | string | Yes | 2-24 characters |
| race | string | Yes | One of: human, elf, dwarf, vampire, orc |
| characterClass | string | Yes | One of: warrior, wizard, monk, chemist |
| gender | string | No | One of: male, female, other (defaults to 'other') |

**Response (201 Created):**
```json
{
  "user": {
    "id": 1,
    "username": "newplayer",
    "email": "player@example.com",
    "gold": 500
  },
  "character": {
    "id": 1,
    "name": "Hero",
    "race": "human",
    "class": "warrior",
    "level": 1,
    "hp_current": 100,
    "hp_max": 100,
    "mp_current": 30,
    "mp_max": 30,
    "strength": 12,
    "intelligence": 10,
    "agility": 10,
    "vitality": 12,
    "luck": 10,
    "party_slot": 1,
    "current_node_id": 1,
    "in_battle": false,
    "created_at": "2026-01-30T12:00:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Username, email, and password are required |
| 400 | Character name, race, and class are required |
| 400 | Username must be between 3 and 32 characters |
| 400 | Password must be at least 8 characters |
| 400 | Invalid email format |
| 400 | Character name must be between 2 and 24 characters |
| 400 | Invalid race |
| 400 | Invalid class |
| 400 | Invalid gender |
| 409 | Username already exists |
| 409 | Email already exists |
| 409 | Character name already exists |
| 429 | Too many requests (10 per 15 minutes) |

**Notes:**
- Character spawns at the castle of their race's homeland region
- Starter equipment granted based on class
- Starter skills granted based on class
- Starting trait granted based on race/class combination
- Spawn node and adjacent nodes are auto-discovered

---

### 2.3 Login

Authenticate an existing user.

```
POST /api/auth/login
```

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response (200 OK):**
```json
{
  "user": {
    "id": 1,
    "username": "player1",
    "email": "player1@example.com",
    "gold": 500
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Username and password are required |
| 401 | Invalid username or password |
| 403 | Account has been banned |
| 429 | Too many login attempts |

---

### 2.4 Refresh Token

Get a new access token using a refresh token.

```
POST /api/auth/refresh
```

**Request Body:**
```json
{
  "refreshToken": "string"
}
```

**Response (200 OK):**
```json
{
  "user": {
    "id": 1,
    "username": "player1",
    "email": "player1@example.com",
    "gold": 500
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Refresh token is required |
| 401 | Invalid refresh token |
| 401 | Invalid or expired refresh token |

---

### 2.5 Logout

Invalidate refresh token(s).

```
POST /api/auth/logout
```

**Headers:** `Authorization: Bearer <token>`

**Request Body (optional):**
```json
{
  "refreshToken": "string"
}
```

**Response (200 OK):**
```json
{
  "message": "Logged out successfully"
}
```

---

### 2.6 Get Current User

Get the authenticated user's profile.

```
GET /api/auth/me
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "user": {
    "id": 1,
    "username": "player1",
    "email": "player1@example.com",
    "gold": 500,
    "created_at": "2026-01-01T00:00:00.000Z",
    "last_login": "2026-01-06T12:00:00.000Z"
  }
}
```

---

## 3. Character Endpoints

> **Main Character Concept:**
> - The first character created by a user is designated as the "main character"
> - The main character cannot be deleted
> - The main character must always remain in party slot 1
> - Additional party members are obtained through guild recruitment (see Section 9.5-9.6), not direct character creation

### 3.1 List Characters

Get all characters for the authenticated user.

```
GET /api/characters
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "characters": [
    {
      "id": 1,
      "name": "Hero",
      "race": "human",
      "class": "warrior",
      "level": 10,
      "experience": 6310,
      "hp_current": 250,
      "hp_max": 250,
      "mp_current": 80,
      "mp_max": 80,
      "strength": 40,
      "intelligence": 19,
      "agility": 19,
      "vitality": 28,
      "luck": 10,
      "party_slot": 1,
      "current_node_id": 1,
      "in_battle": false,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 3.2 Create Character

Create a new character.

```
POST /api/characters
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "string (2-24 chars)",
  "race": "human|elf|dwarf|vampire|orc",
  "characterClass": "warrior|wizard|monk|chemist"
}
```

**Response (201 Created):**
```json
{
  "character": {
    "id": 2,
    "name": "Mystic",
    "race": "elf",
    "class": "wizard",
    "level": 1,
    "experience": 0,
    "hp_current": 88,
    "hp_max": 88,
    "mp_current": 92,
    "mp_max": 92,
    "strength": 9,
    "intelligence": 18,
    "agility": 13,
    "vitality": 7,
    "luck": 10,
    "party_slot": 2,
    "current_node_id": 1,
    "in_battle": false,
    "created_at": "2026-01-06T12:00:00.000Z"
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Name, race, and class are required |
| 400 | Character name must be between 2 and 24 characters |
| 400 | Invalid race |
| 400 | Invalid class |
| 400 | Cannot have more than 12 characters |
| 400 | Cannot create characters manually. Use guild recruitment. |
| 409 | Character name already exists |

> **Note:** After creating your first (main) character, additional party members must be recruited from guild nodes. Direct character creation is only available for the initial main character. See Section 9.5 for guild recruitment.

---

### 3.3 Get Character

Get detailed information for a specific character.

```
GET /api/characters/:id
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "character": {
    "id": 1,
    "name": "Hero",
    "race": "human",
    "class": "warrior",
    "level": 10,
    "experience": 6310,
    "hp_current": 250,
    "hp_max": 250,
    "mp_current": 80,
    "mp_max": 80,
    "strength": 40,
    "intelligence": 19,
    "agility": 19,
    "vitality": 28,
    "luck": 10,
    "party_slot": 1,
    "current_node_id": 1,
    "current_node_name": "Royal Castle",
    "current_node_type": "castle",
    "in_battle": false,
    "created_at": "2026-01-01T00:00:00.000Z"
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Character not found |

---

### 3.4 Update Character

Update a character's name.

```
PUT /api/characters/:id
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "string (2-24 chars)"
}
```

**Response (200 OK):**
```json
{
  "character": {
    "id": 1,
    "name": "NewName",
    ...
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Name is required |
| 400 | Character name must be between 2 and 24 characters |
| 404 | Character not found |

---

### 3.5 Delete Character

Delete a character permanently.

```
DELETE /api/characters/:id
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "message": "Character deleted successfully"
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Cannot delete character while in battle |
| 400 | Cannot delete main character |
| 404 | Character not found |

---

### 3.6 Get Character Stats

Get computed stats including equipment bonuses.

```
GET /api/characters/:id/stats
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "stats": {
    "id": 1,
    "name": "Hero",
    "race": "human",
    "class": "warrior",
    "level": 10,
    "experience": 6310,
    "hp": {
      "current": 250,
      "max": 270
    },
    "mp": {
      "current": 80,
      "max": 80
    },
    "strength": 45,
    "intelligence": 19,
    "agility": 21,
    "vitality": 30,
    "luck": 10
  }
}
```

---

## 4. Party Endpoints

### 4.1 Get Party

Get current party formation.

```
GET /api/party
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "party": [
    {
      "id": 1,
      "name": "Hero",
      "race": "human",
      "class": "warrior",
      "level": 10,
      "hp_current": 250,
      "hp_max": 250,
      "mp_current": 80,
      "mp_max": 80,
      "party_slot": 1
    },
    {
      "id": 2,
      "name": "Mystic",
      "race": "elf",
      "class": "wizard",
      "level": 8,
      "hp_current": 144,
      "hp_max": 144,
      "mp_current": 176,
      "mp_max": 176,
      "party_slot": 2
    }
  ]
}
```

---

### 4.2 Update Formation

Rearrange characters in party slots.

```
PUT /api/party
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "formation": [
    { "characterId": 1, "slot": 1 },
    { "characterId": 2, "slot": 2 },
    { "characterId": 3, "slot": 3 }
  ]
}
```

**Response (200 OK):**
```json
{
  "party": [...]
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Formation must be an array |
| 400 | Slot must be between 1 and 12 |
| 400 | Duplicate slot assignment |
| 400 | Main character must remain in slot 1 |
| 404 | One or more characters not found |

---

### 4.3 Set Battle Party

Select characters for combat (slots 1-5).

```
PUT /api/party/battle
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterIds": [1, 2, 3]
}
```

**Response (200 OK):**
```json
{
  "battleParty": [
    { "id": 1, "name": "Hero", "party_slot": 1, ... },
    { "id": 2, "name": "Mystic", "party_slot": 2, ... },
    { "id": 3, "name": "Tank", "party_slot": 3, ... }
  ]
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | characterIds must be an array |
| 400 | Cannot have more than 5 characters in battle party |
| 400 | Battle party must have at least 1 character |
| 400 | One or more characters not found or are incapacitated |

---

## 5. World Endpoints

### 5.1 Get World Seed

Get the global world generation seed.

```
GET /api/world/seed
```

**Response (200 OK):**
```json
{
  "seed": 12345
}
```

---

### 5.2 Get All Nodes

Get all world nodes and connections.

```
GET /api/world/nodes
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "nodes": [
    {
      "id": 1,
      "node_type": "castle",
      "name": "Royal Castle",
      "x_coord": 0,
      "y_coord": 0,
      "distance_from_center": 0,
      "features": ["coliseum", "tavern", "courtyard", "throne", "blacksmith", "apothecary", "temple", "stables", "marketplace"],
      "guild_class": null,
      "local_seed": 54321,
      "difficulty_tier": 1
    },
    {
      "id": 2,
      "node_type": "forest",
      "name": "Dark Woods",
      "x_coord": 3,
      "y_coord": 1,
      "distance_from_center": 3,
      "features": [],
      "guild_class": null,
      "local_seed": 98765,
      "difficulty_tier": 1
    }
  ],
  "connections": [
    { "from_node_id": 1, "to_node_id": 2, "path_type": "road" },
    { "from_node_id": 2, "to_node_id": 1, "path_type": "road" }
  ]
}
```

---

### 5.3 Get Node Details

Get detailed information for a specific node.

```
GET /api/world/nodes/:id
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "node": {
    "id": 1,
    "node_type": "castle",
    "name": "Royal Castle",
    "x_coord": 0,
    "y_coord": 0,
    "distance_from_center": 0,
    "features": ["coliseum", "tavern", ...],
    "guild_class": null,
    "local_seed": 54321,
    "difficulty_tier": 1
  },
  "connectedNodes": [
    { "id": 2, "node_type": "forest", "name": "Dark Woods", "path_type": "road" },
    { "id": 3, "node_type": "city", "name": "Port Haven", "path_type": "road" }
  ]
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Node not found |

---

### 5.4 Travel

Move party to an adjacent node.

```
POST /api/world/travel
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "targetNodeId": 2
}
```

**Response (200 OK):**
```json
{
  "message": "Traveled successfully",
  "currentNode": {
    "id": 2,
    "node_type": "forest",
    "name": "Dark Woods",
    "features": [],
    "guild_class": null,
    "local_seed": 98765,
    "difficulty_tier": 1
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | targetNodeId is required |
| 400 | No active party character |
| 400 | Cannot travel while in battle |
| 400 | Target node is not connected to current location |

---

### 5.5 Get Current Location

Get the party's current node and available actions.

```
GET /api/world/current
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "currentNode": {
    "id": 2,
    "node_type": "forest",
    "name": "Dark Woods",
    "features": [],
    "guild_class": null,
    "local_seed": 98765,
    "difficulty_tier": 1
  },
  "availableActions": [
    { "type": "battle", "name": "Battle" }
  ]
}
```

---

### 5.6 Get World Obstacles

Get terrain obstacles for world map rendering.

```
GET /api/world/obstacles
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "obstacles": [
    { "id": 1, "obstacle_type": "lake", "x": 5.2, "y": -3.1, "radius": 6.5 },
    { "id": 2, "obstacle_type": "mountain_range", "x": -10, "y": 15, "length": 12, "angle": 0.78 },
    { "id": 3, "obstacle_type": "dense_forest", "x": 8, "y": 8, "radius": 4.2 }
  ]
}
```

---

### 5.7 Claim Chest (Terminator Node)

Claim one-time loot from a treasure chest node. User must be physically at the node.

```
POST /api/world/nodes/:id/claim-chest
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "gold_awarded": 250,
  "items_awarded": [],
  "new_gold_balance": 5250,
  "message": "You found 250 gold in the treasure chest!"
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | You must be at this location to claim the treasure |
| 400 | This node is not a treasure chest |
| 400 | You have already claimed this treasure |
| 404 | Node not found |

---

### 5.8 Visit Shrine (Terminator Node)

Receive a timed buff from a shrine node. User must be at the node. 24-hour cooldown per shrine.

```
POST /api/world/nodes/:id/visit-shrine
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "buff_name": "Pilgrim's Rest",
  "buff_description": "Stamina regenerates 50% faster",
  "expires_at": "2026-01-14T12:00:00.000Z",
  "duration_hours": 4,
  "message": "You received the blessing: Pilgrim's Rest!"
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | You must be at this location to receive the blessing |
| 400 | This node is not a shrine |
| 400 | Shrine is on cooldown. Return in X hour(s). |
| 404 | Node not found |
| 500 | Invalid shrine buff type |

---

### 5.9 Discover (Terminator Node)

Unlock lore content at a discovery site. User must be at the node. Can be revisited.

```
POST /api/world/nodes/:id/discover
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "already_discovered": false,
  "lore": {
    "title": "Ancient Monument",
    "text": "You discovered ancient secrets...",
    "lore_key": "lore_monument_001"
  },
  "message": "You have discovered Ancient Monument!"
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | You must be at this location to explore the discovery |
| 400 | This node is not a discovery site |
| 404 | Node not found |

---

### 5.10 Get Active Buffs

Get user's currently active shrine buffs.

```
GET /api/world/active-buffs
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "buffs": [
    {
      "buff_type": "stamina_regen",
      "buff_info": {
        "name": "Pilgrim's Rest",
        "description": "Stamina regenerates 50% faster",
        "duration": 4
      },
      "expires_at": "2026-01-14T12:00:00.000Z",
      "shrine_name": "Sacred Altar"
    }
  ]
}
```

---

### 5.11 Get My Discoveries

Get user's discovery progress.

```
GET /api/world/my-discoveries
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "discoveries": [
    {
      "discovered_at": "2026-01-13T10:30:00.000Z",
      "lore_key": "lore_monument_001",
      "name": "Ancient Monument",
      "node_id": 245
    }
  ],
  "discovered_count": 1,
  "total_count": 12
}
```

---

## 6. Battle Endpoints

### 6.1 Start Battle

Initiate a PvE battle at the current node.

```
POST /api/battle/start
```

**Headers:** `Authorization: Bearer <token>`

**Response (201 Created):**
```json
{
  "battleId": 1,
  "mapSeed": 123456,
  "mapWidth": 8,
  "mapHeight": 8,
  "state": {
    "turn": 1,
    "phase": "player_turn",
    "activeUnitIndex": 0,
    "units": [
      {
        "id": 1,
        "type": "player",
        "name": "Hero",
        "class": "warrior",
        "hp": 250,
        "maxHp": 250,
        "mp": 80,
        "maxMp": 80,
        "strength": 40,
        "intelligence": 19,
        "agility": 19,
        "tileX": 0,
        "tileY": 6,
        "hasActed": false,
        "statusEffects": []
      },
      {
        "id": "enemy_0",
        "type": "enemy",
        "name": "Forest Goblin",
        "class": "monster",
        "hp": 50,
        "maxHp": 50,
        "mp": 20,
        "maxMp": 20,
        "strength": 12,
        "intelligence": 6,
        "agility": 8,
        "tileX": 7,
        "tileY": 0,
        "hasActed": false,
        "statusEffects": []
      }
    ]
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | No battle party set |
| 400 | Already in a battle |
| 400 | Cannot battle with incapacitated characters |
| 400 | Cannot battle at this location |

---

### 6.2 Get Current Battle

Get the state of the active battle.

```
GET /api/battle/current
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "battleId": 1,
  "battleType": "pve",
  "mapSeed": 123456,
  "mapWidth": 8,
  "mapHeight": 8,
  "nodeType": "forest",
  "nodeName": "Dark Woods",
  "state": { ... }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | No active battle |

---

### 6.3 Submit Action

Submit a battle action for the active unit. The HTTP response provides immediate acknowledgment, while detailed action results are broadcast to all participants via WebSocket.

```
POST /api/battle/action
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "battleId": 1,
  "actionType": "move|attack|skill|item|wait",
  "unitId": 1,
  "targetTile": { "x": 2, "y": 5 },
  "skillId": null
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "actionId": "act_abc123",
  "message": "Action queued, results will be broadcast via WebSocket"
}
```

> **Note:** Action results including damage calculations, status effects, unit state changes, and battle outcome are delivered via WebSocket events (`battle:action_result`, `battle:state_update`, `battle:end`). See Section 7.6 and 7.8 for WebSocket event schemas.

**Battle Status Values (via WebSocket):**
- `active` - Battle continues
- `victory` - All enemies defeated
- `defeat` - All player units defeated

**Errors:**
| Code | Message |
|------|---------|
| 400 | Not this unit's turn |
| 404 | Battle not found or not active |

---

### 6.4 Get Battle Rewards

Get rewards from a completed battle.

```
GET /api/battle/rewards/:battleId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "rewards": {
    "gold": 75,
    "experience": 125,
    "items": [
      { "itemTemplateId": 1, "name": "Health Potion", "quantity": 1 }
    ]
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Battle not found or not a victory |

---

### 6.5 Rejoin Battle

Rejoin an active battle after disconnection.

```
GET /api/battle/:battleId/rejoin
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "battleId": 123,
  "canRejoin": true,
  "state": {
    "turn": 5,
    "activeUnitId": 3,
    "units": [...],
    "log": [...]
  },
  "yourUnits": [1, 2, 3],
  "currentTurnUnit": 5,
  "sequence": 47,
  "gracePeriodRemaining": 25000
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Battle not found |
| 400 | Battle has ended |
| 400 | Grace period expired |
| 403 | Not a participant in this battle |

---

## 7. WebSocket Events

### 7.1 Connection

```
WebSocket URL: ws://localhost:3000/ws
Production:    wss://modia.example.com/ws
```

### 7.2 Authentication

**Client → Server:**
```json
{
  "type": "auth",
  "payload": {
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Server → Client (Success):**
```json
{
  "type": "auth_success",
  "payload": {
    "userId": 1,
    "username": "player1"
  }
}
```

**Server → Client (Error):**
```json
{
  "type": "auth_error",
  "payload": {
    "message": "Invalid token"
  }
}
```

### 7.3 Room Management

**Join Room:**
```json
{
  "type": "join_room",
  "payload": {
    "room": "tavern:castle_1"
  }
}
```

**Response:**
```json
{
  "type": "room_joined",
  "payload": {
    "room": "tavern:castle_1",
    "users": [1, 5, 12]
  }
}
```

**Leave Room:**
```json
{
  "type": "leave_room",
  "payload": {
    "room": "tavern:castle_1"
  }
}
```

### 7.4 Chat Messages

**Send Message:**
```json
{
  "type": "chat_message",
  "payload": {
    "room": "tavern:castle_1",
    "message": "Hello everyone!"
  }
}
```

**Receive Message (broadcast):**
```json
{
  "type": "chat_message",
  "payload": {
    "room": "tavern:castle_1",
    "userId": 1,
    "username": "player1",
    "message": "Hello everyone!",
    "timestamp": 1704556800000
  }
}
```

### 7.5 Coliseum Events

**Join Queue:**
```json
{
  "type": "coliseum_queue_join",
  "payload": {
    "partyCharacterIds": [1, 2, 3]
  }
}
```

**Queue Update:**
```json
{
  "type": "coliseum_queue_update",
  "payload": {
    "position": 3,
    "estimatedWait": 120
  }
}
```

**Match Found:**
```json
{
  "type": "coliseum_match_found",
  "payload": {
    "battleId": 100,
    "opponent": {
      "userId": 5,
      "username": "rival"
    },
    "yourTeam": [...],
    "enemyTeam": [...],
    "mapSeed": 54321,
    "firstTurn": "you"
  }
}
```

### 7.6 Battle Events

**State Update (after each action):**
```json
{
  "type": "battle:state_update",
  "payload": {
    "turn": 3,
    "phase": "player_turn",
    "units": [...],
    "lastAction": {
      "type": "attack",
      "actor": "char_1",
      "target": "enemy_0",
      "damage": 45
    },
    "log": [...]
  }
}
```

**Turn Start:**
```json
{
  "type": "battle:turn_start",
  "payload": {
    "turn": 4,
    "activeUnit": "char_2",
    "timeRemaining": 60
  }
}
```

**Turn Timer:**
```json
{
  "type": "battle:turn_timer",
  "payload": {
    "secondsRemaining": 45
  }
}
```

**Action Result:**
```json
{
  "type": "battle:action_result",
  "payload": {
    "action": "skill",
    "skillId": "warrior_bash",
    "damage": 125,
    "effects": ["stun"],
    "unitStates": {
      "enemy_0": { "hp": 25, "statusEffects": ["stun"] }
    }
  }
}
```

**Battle End:**
```json
{
  "type": "battle:end",
  "payload": {
    "result": "victory",
    "rewards": {
      "xp": 200,
      "gold": 150,
      "items": [...]
    }
  }
}
```

### 7.7 PvP Events

**Queue Joined:**
```json
{
  "type": "pvp:queue_joined",
  "payload": {
    "queueId": "queue_123",
    "position": 5,
    "estimatedWait": 60
  }
}
```

**Match Found:**
```json
{
  "type": "pvp:match_found",
  "payload": {
    "matchId": "match_456",
    "opponent": {
      "name": "rival",
      "level": 25
    },
    "battleId": 100
  }
}
```

**Turn Sync:**
```json
{
  "type": "pvp:turn_sync",
  "payload": {
    "turn": 3,
    "activePlayer": "opponent",
    "timeRemaining": 55
  }
}
```

**Opponent Action:**
```json
{
  "type": "pvp:opponent_action",
  "payload": {
    "action": {
      "type": "move",
      "unitId": "opp_char_1",
      "from": [3, 4],
      "to": [4, 5]
    },
    "result": {
      "success": true
    }
  }
}
```

**Opponent Disconnect:**
```json
{
  "type": "pvp:disconnect",
  "payload": {
    "timeout": 120,
    "autoForfeitIn": 60
  }
}
```

### 7.8 Battle Turn Events

**Turn Start (Server → Client):**
```json
{
  "type": "battle:turn_start",
  "payload": {
    "battleId": 123,
    "unitId": 5,
    "unitType": "enemy",
    "unitName": "Forest Goblin",
    "turnPredictions": [5, 1, 3, 2]
  }
}
```

**Intent Highlight (Server → Client):**
```json
{
  "type": "battle:intent_highlight",
  "payload": {
    "battleId": 123,
    "unitId": 5,
    "highlightType": "movement_range",
    "tiles": [[2,3], [2,4], [3,3], [3,4]],
    "duration": 500
  }
}
```

**Your Turn (Server → Client, player only):**
```json
{
  "type": "battle:your_turn",
  "payload": {
    "battleId": 123,
    "unitId": 1,
    "state": {...},
    "availableActions": ["move", "attack", "skill", "item", "wait"],
    "timeout": 60000
  }
}
```

**Player Action (Client → Server):**
```json
{
  "type": "battle:player_action",
  "payload": {
    "battleId": 123,
    "actionType": "move",
    "unitId": 1,
    "targetTile": {"x": 3, "y": 4}
  }
}
```

**State Sync (Server → Client):**
```json
{
  "type": "battle:state_sync",
  "payload": {
    "battleId": 123,
    "state": {...},
    "sequence": 47,
    "reason": "reconnection"
  }
}
```

### 7.9 Battle Connection Events

**Player Disconnected:**
```json
{
  "type": "battle:player_disconnected",
  "payload": {
    "battleId": 123,
    "playerId": 5,
    "playerName": "Hero123",
    "gracePeriod": 30000
  }
}
```

**Player Reconnected:**
```json
{
  "type": "battle:player_reconnected",
  "payload": {
    "battleId": 123,
    "playerId": 5,
    "playerName": "Hero123"
  }
}
```

### 7.10 Garrison Events

**Room Pattern:** `garrison:{nodeId}`

**Join Garrison Room:**
```json
{
  "type": "join_garrison",
  "payload": {
    "nodeId": 1
  }
}
```

**Response:**
```json
{
  "type": "garrison_joined",
  "payload": {
    "nodeId": 1,
    "nodeName": "Heartlands Castle"
  }
}
```

**Leave Garrison Room:**
```json
{
  "type": "leave_garrison",
  "payload": {
    "nodeId": 1
  }
}
```

**Garrison Purchase (broadcast to room):**
```json
{
  "type": "garrison_purchase",
  "payload": {
    "nodeId": 1,
    "recruitId": 456,
    "recruitName": "Alaric",
    "purchasedBy": "player123"
  }
}
```

**Garrison Refresh (broadcast to room):**
```json
{
  "type": "garrison_refresh",
  "payload": {
    "nodeId": 1,
    "recruitCount": 6,
    "nextRefresh": "2026-01-11T12:00:00.000Z"
  }
}
```

### 7.11 Coliseum Match Result

**Match Result (Server → Both Players):**

Sent to both players when a PvP match completes. The `isWinner` field is player-specific (true for winner, false for loser).

```json
{
  "type": "coliseum:match_result",
  "payload": {
    "battleId": 123,
    "winnerId": 5,
    "loserId": 12,
    "reason": "victory",
    "winnerRatingChange": 25,
    "loserRatingChange": -20,
    "winnerNewRating": 1525,
    "loserNewRating": 1480,
    "isWinner": true,
    "unitStats": [
      {
        "id": 1,
        "name": "Hero",
        "class": "warrior",
        "race": "human",
        "level": 25,
        "teamId": 1,
        "ownerId": 5,
        "damageDealt": 1250,
        "damageTaken": 800,
        "healingDone": 0,
        "kills": 2,
        "deaths": 0,
        "survivedWith": 150
      },
      {
        "id": 2,
        "name": "Rival",
        "class": "wizard",
        "race": "elf",
        "level": 24,
        "teamId": 2,
        "ownerId": 12,
        "damageDealt": 800,
        "damageTaken": 1250,
        "healingDone": 100,
        "kills": 0,
        "deaths": 1,
        "survivedWith": 0
      }
    ],
    "battleSummary": {
      "totalTurns": 15,
      "durationSeconds": 180
    },
    "pvpResult": {
      "oldRating": 1500,
      "newRating": 1525,
      "ratingChange": 25,
      "oldTier": "Silver",
      "newTier": "Silver",
      "tierChanged": false,
      "oldRank": 45,
      "newRank": 42,
      "pointsToNextTier": 75,
      "surrenderPenalty": false
    }
  }
}
```

**Payload Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `battleId` | number | Battle identifier |
| `winnerId` | number | Winner's user ID |
| `loserId` | number | Loser's user ID |
| `reason` | string | Match end reason: `victory`, `surrender`, `timeout_forfeit`, `disconnect_forfeit` |
| `winnerRatingChange` | number | Rating points gained by winner |
| `loserRatingChange` | number | Rating points lost by loser (negative) |
| `winnerNewRating` | number | Winner's rating after match |
| `loserNewRating` | number | Loser's rating after match |
| `isWinner` | boolean | Player-specific: true for winner, false for loser |
| `unitStats` | array | Per-unit battle statistics |
| `battleSummary` | object | Match summary |
| `pvpResult` | object | Detailed rating/tier information |

**Unit Stats Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unit identifier |
| `name` | string | Display name |
| `class` | string | Character class |
| `race` | string | Race |
| `level` | number | Character level |
| `teamId` | number | Team identifier (1 or 2) |
| `ownerId` | number | Owner user ID |
| `damageDealt` | number | Total damage dealt |
| `damageTaken` | number | Total damage received |
| `healingDone` | number | Total healing performed |
| `kills` | number | Enemy units defeated |
| `deaths` | number | 0 or 1 (was unit defeated) |
| `survivedWith` | number | HP remaining (0 if dead) |

**PvP Result Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `oldRating` | number | Rating before match |
| `newRating` | number | Rating after match |
| `ratingChange` | number | +/- change |
| `oldTier` | string | Tier name before (e.g., "Bronze", "Silver") |
| `newTier` | string | Tier name after |
| `tierChanged` | boolean | Whether tier promotion/demotion occurred |
| `oldRank` | number | Leaderboard rank before match |
| `newRank` | number | Leaderboard rank after match |
| `pointsToNextTier` | number\|null | Points needed for next tier (null if max tier) |
| `surrenderPenalty` | boolean | Whether forfeit penalty was applied |

---

## 8. Skill Endpoints

### 8.1 Learn Skill

Spend XP to learn or level up a skill.

```
POST /api/skills/learn
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterId": 1,
  "skillId": "warrior_bash",
  "levels": 1
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "skill": {
    "id": "warrior_bash",
    "name": "Bash",
    "newLevel": 25,
    "xpSpent": 2750
  },
  "character": {
    "xpPool": 8430,
    "level": 15,
    "guildLevel": 12
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Insufficient XP in pool |
| 400 | Skill is at maximum level |
| 400 | Prerequisites not met |
| 400 | Skill is frozen (guild not active) |
| 404 | Character or skill not found |

---

### 8.2 Get Skill Tree

Get the skill tree for a guild.

```
GET /api/skills/tree/:guildId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "guildId": "warrior",
  "guildName": "Warrior",
  "branches": [
    {
      "branchId": "warrior_offense",
      "branchName": "Offense",
      "skills": [
        {
          "id": "warrior_bash",
          "name": "Bash",
          "tier": 1,
          "guildLevelRequired": 1,
          "baseXpCost": 100,
          "prerequisites": []
        }
      ]
    }
  ],
  "advancementOptions": [
    {
      "guildId": "berserker",
      "guildName": "Berserker",
      "guildLevelRequired": 50,
      "description": "Rage-fueled warrior"
    }
  ]
}
```

---

### 8.3 Get Character Skills

Get all skills learned by a character.

```
GET /api/characters/:id/skills
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "skills": [
    {
      "skillId": "warrior_bash",
      "name": "Bash",
      "level": 47,
      "xpInvested": 4670,
      "guildId": "warrior",
      "isFrozen": false
    }
  ],
  "guilds": [
    {
      "guildId": "warrior",
      "guildLevel": 18,
      "isActive": true,
      "isFrozen": false
    }
  ],
  "xpPool": 12450
}
```

---

## 9. Guild Endpoints

> **Note**: Guild advancement is deferred to post-MVP. MVP characters remain in their starting base guild.

### 9.1 List Guilds

Get all available guilds.

```
GET /api/guilds
```

**Response (200 OK):**
```json
{
  "guilds": [
    {
      "id": "warrior",
      "name": "Warrior",
      "description": "Masters of physical combat",
      "isBaseGuild": true,
      "branches": ["offense", "defense", "utility"]
    },
    {
      "id": "berserker",
      "name": "Berserker",
      "description": "Rage-fueled warrior",
      "isBaseGuild": false,
      "baseGuild": "warrior"
    }
  ]
}
```

---

### 9.2 Get Guild Details

Get detailed information for a specific guild.

```
GET /api/guilds/:guildId
```

**Response (200 OK):**
```json
{
  "guild": {
    "id": "warrior",
    "name": "Warrior",
    "description": "Masters of physical combat",
    "branches": [...],
    "advancementOptions": [...]
  }
}
```

---

### 9.3 Get Character Guilds

Get guild memberships for a character.

```
GET /api/characters/:id/guilds
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "activeGuild": "warrior",
  "guildMemberships": [
    {
      "guildId": "warrior",
      "guildLevel": 18,
      "xpSpent": 47500,
      "isActive": true,
      "isFrozen": false
    }
  ]
}
```

---

### 9.4 Get Guild Node Info

Get guild information and recruitment details for a node.

```
GET /api/guild/:nodeId/info
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "nodeId": 5,
  "nodeName": "Warriors Guild Hall",
  "guildClass": "warrior",
  "recruitRefreshHour": 12,
  "lastRefresh": "2026-01-09T12:00:00.000Z",
  "nextRefresh": "2026-01-10T12:00:00.000Z",
  "recruitCount": 8,
  "actionLabel": "Recruit Soldier"
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Node not found |
| 400 | This node is not a guild |
| 403 | You have not discovered this node |

---

### 9.5 Get Guild Recruits

Get available recruits for a guild node.

```
GET /api/guild/:nodeId/recruits
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "nodeId": 5,
  "recruits": [
    {
      "id": 123,
      "name": "Roland",
      "race": "human",
      "gender": "male",
      "class": "warrior",
      "level": 1,
      "hp_max": 115,
      "mp_max": 52,
      "strength": 12,
      "intelligence": 10,
      "agility": 11,
      "vitality": 11,
      "luck": 10,
      "stat_variance_percent": 8.5,
      "xp_pool": 87,
      "price": 543,
      "traits": [
        {
          "id": 5,
          "name": "Tough Skin",
          "description": "+5% HP",
          "category": "survival",
          "rarity": "common",
          "effect_type": "hp_bonus",
          "effect_value": 5.0
        }
      ],
      "skills": ["power_slash"]
    }
  ],
  "nextRefresh": "2026-01-10T12:00:00.000Z"
}
```

**Price Calculation:** Base price (400g) + trait cost (100g for common) + stat variance (8.5% × 5g = 43g) = 543g. See [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md#guild-recruitment-pricing) for full formula.

**Errors:**
| Code | Message |
|------|---------|
| 404 | Node not found |
| 400 | This node is not a guild |
| 403 | You have not discovered this node |

---

### 9.6 Purchase Recruit

Purchase a recruit from a guild node.

```
POST /api/guild/:nodeId/recruit/:recruitId/purchase
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Successfully recruited Roland",
  "character": {
    "id": 456,
    "name": "Roland",
    "race": "human",
    "class": "warrior",
    "level": 1,
    "hp_current": 115,
    "hp_max": 115,
    "mp_current": 52,
    "mp_max": 52,
    "strength": 12,
    "intelligence": 10,
    "agility": 11,
    "vitality": 11,
    "luck": 10,
    "traits": [...],
    "skills": [...]
  },
  "goldSpent": 543,
  "remainingGold": 9457
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Node not found |
| 400 | This node is not a guild |
| 403 | You have not discovered this node |
| 400 | Insufficient gold |
| 400 | Party is full (max 12 characters) |
| 404 | Recruit not found or already purchased |

---

## 10. Garrison Endpoints

Garrison recruitment at castle nodes for mixed-class party members with regional race/class bias.

### 10.1 Get Garrison Recruits

Get available recruits at a castle garrison.

```
GET /api/garrison/:nodeId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "nodeId": 1,
  "nodeName": "Heartlands Castle",
  "recruits": [
    {
      "id": 456,
      "name": "Alaric",
      "race": "human",
      "gender": "male",
      "class": "warrior",
      "level": 1,
      "hp_max": 115,
      "mp_max": 53,
      "strength": 13,
      "intelligence": 10,
      "agility": 10,
      "vitality": 12,
      "luck": 10,
      "stat_variance_percent": 5.2,
      "xp_pool": 50,
      "price": 526,
      "traits": [
        {
          "id": 3,
          "name": "Quick Learner",
          "description": "+5% XP gain",
          "category": "utility",
          "rarity": "common",
          "effect_type": "xp_bonus",
          "effect_value": 5.0
        }
      ],
      "skills": ["power_slash"]
    }
  ],
  "nextRefresh": "2026-01-10T12:00:00.000Z"
}
```

**Price Calculation:** Base price (400g) + trait cost (100g for common) + stat variance (5.2% × 5g = 26g) = 526g. See [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md#guild-recruitment-pricing) for full formula.

**Errors:**
| Code | Message |
|------|---------|
| 404 | Node not found |
| 400 | This node does not have a garrison |
| 403 | You have not discovered this node |

---

### 10.2 Purchase Garrison Recruit

Purchase a recruit from a castle garrison.

```
POST /api/garrison/:nodeId/purchase/:recruitId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Successfully recruited Alaric",
  "character": {
    "id": 789,
    "name": "Alaric",
    "race": "human",
    "class": "warrior",
    "level": 1,
    "hp_current": 115,
    "hp_max": 115,
    "mp_current": 53,
    "mp_max": 53,
    "strength": 13,
    "intelligence": 10,
    "agility": 10,
    "vitality": 12,
    "luck": 10,
    "traits": [...],
    "skills": [...]
  },
  "goldSpent": 526,
  "remainingGold": 9474
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Node not found |
| 400 | This node does not have a garrison |
| 403 | You have not discovered this node |
| 400 | Insufficient gold |
| 400 | Party is full (max 12 characters) |
| 404 | Recruit not found or already purchased |

---

### 10.3 Get Garrison Refresh Time

Get seconds until the garrison refreshes its recruit pool.

```
GET /api/garrison/:nodeId/refresh-time
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "nodeId": 1,
  "secondsUntilRefresh": 2847,
  "nextRefresh": "2026-01-10T12:00:00.000Z"
}
```

**Errors:**
| Code | Message |
|------|---------|
| 404 | Node not found |
| 400 | This node does not have a garrison |

---

## 11. Inventory Endpoints

### 11.1 Get Shared Inventory

Get user's shared inventory pool (unequipped items accessible by all characters).

```
GET /api/inventory/shared
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "inventory": [
    {
      "instanceId": 1,
      "templateId": 101,
      "name": "Iron Sword",
      "displayName": "Iron Sword",
      "templateName": "Iron Sword",
      "type": "weapon",
      "rarity": "common",
      "quantity": 1,
      "baseStats": { "strength": 5, "attack": 10 },
      "bonusStats": {},
      "augments": [],
      "material": null,
      "itemData": {},
      "description": "A sturdy iron blade",
      "level_requirement": 1,
      "class_restriction": [],
      "spriteId": "sword_iron"
    }
  ]
}
```

---

### 11.2 Get Character Equipment

Get equipped items for a specific character.

```
GET /api/inventory/:characterId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "equipped": {
    "main_hand": {
      "instanceId": 1,
      "templateId": 101,
      "name": "Iron Sword",
      "displayName": "Iron Sword",
      "type": "weapon",
      "rarity": "common",
      "quantity": 1,
      "baseStats": { "strength": 5 },
      "bonusStats": {},
      "description": "A sturdy iron blade",
      "level_requirement": 1,
      "class_restriction": [],
      "spriteId": "sword_iron"
    },
    "off_hand": null,
    "head": null,
    "body": null,
    "legs": null,
    "feet": null,
    "accessory": null
  }
}
```

---

### 11.3 Equip Item

Equip an item to a slot.

```
POST /api/inventory/equip
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterId": 1,
  "itemInstanceId": 5,
  "slot": "main_hand"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "equipped": {
    "slot": "main_hand",
    "item": { "instanceId": 5, "name": "Steel Sword" }
  },
  "statsChanged": {
    "strength": { "old": 40, "new": 45 },
    "attack": { "old": 156, "new": 172 }
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Item cannot be equipped in this slot |
| 400 | Character does not meet requirements |
| 404 | Item or character not found |

---

### 11.4 Unequip Item

Unequip an item from a slot.

```
POST /api/inventory/unequip
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterId": 1,
  "slot": "main_hand"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "item": { "instanceId": 5, "name": "Steel Sword" },
  "statsChanged": { ... }
}
```

---

### 11.5 Use Item

Use a consumable item.

```
POST /api/inventory/use
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterId": 1,
  "itemInstanceId": 10,
  "targetCharacterId": 2
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "effect": {
    "type": "heal",
    "amount": 100
  },
  "remainingQuantity": 4
}
```

---

### 11.6 Discard Item

Remove an item from inventory.

```
POST /api/inventory/discard
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterId": 1,
  "itemInstanceId": 15,
  "quantity": 1
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "discarded": {
    "name": "Health Potion",
    "quantity": 1
  }
}
```

---

## 12. Shop Endpoints

Shop types: `blacksmith` (weapons, armor), `apothecary` (consumables), `farm` (materials, consumables), `caravan` (exclusive items at merchant_caravan nodes).

### 12.1 Get Shop Inventory

Get items available in a shop at a node.

```
GET /api/shops/:nodeId/:shopType
```

**Headers:** `Authorization: Bearer <token>`

**Path Parameters:**
- `nodeId` - World node ID
- `shopType` - One of: `blacksmith`, `apothecary`, `farm`, `caravan`

**Response (200 OK) - Standard Shop:**
```json
{
  "nodeId": 5,
  "shopType": "blacksmith",
  "items": [
    {
      "inventoryId": 12,
      "templateId": 101,
      "name": "Iron Sword",
      "description": "A sturdy iron blade",
      "type": "weapon",
      "equipmentSlot": "main_hand",
      "statBonuses": { "strength": 5, "attack": 10 },
      "levelRequirement": 1,
      "rarity": "common",
      "basePrice": 150,
      "buyPrice": 128,
      "quantity": 8,
      "supplyLevel": "medium",
      "supplyLabel": "Medium",
      "priceModifier": 0.85,
      "spriteId": "sword_iron"
    }
  ]
}
```

**Response (200 OK) - Caravan Shop:**
```json
{
  "isCaravan": true,
  "shopType": "caravan",
  "nodeId": 42,
  "nodeName": "Wandering Merchant",
  "inventory": [
    {
      "itemId": "rare_elixir",
      "name": "Rare Elixir",
      "type": "consumable",
      "description": "Restores 50% HP and MP",
      "basePrice": 500,
      "price": 575,
      "stock": 3,
      "maxStock": 5,
      "regional": false,
      "caravanExclusive": true,
      "effect": { "hpRestore": 0.5, "mpRestore": 0.5 },
      "inStock": true
    }
  ],
  "refreshesIn": 172800000,
  "lastRefresh": "2026-01-24T00:00:00.000Z"
}
```

**Supply Level Pricing:**
| Level | Stock Range | Price Modifier |
|-------|-------------|----------------|
| Scarce | 0-2 | 120% |
| Low | 3-5 | 100% |
| Medium | 6-10 | 85% |
| High | 11-20 | 70% |
| Surplus | 21+ | 60% |

**Errors:**
| Code | Message |
|------|---------|
| 400 | Invalid node ID |
| 400 | Invalid shop type |
| 400 | This location does not have a {shopType} |
| 404 | Node not found |

---

### 12.2 Buy Item

Purchase an item from a shop.

```
POST /api/shops/:nodeId/:shopType/buy
```

**Headers:** `Authorization: Bearer <token>`

**Request Body (Standard Shop):**
```json
{
  "itemTemplateId": 101,
  "quantity": 1,
  "characterId": 5
}
```

**Request Body (Caravan Shop):**
```json
{
  "itemId": "rare_elixir",
  "quantity": 1
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Purchased 1x Iron Sword for 128 gold",
  "itemName": "Iron Sword",
  "quantity": 1,
  "unitPrice": 128,
  "totalPrice": 128,
  "remainingGold": 872
}
```

**Response (200 OK) - Caravan:**
```json
{
  "success": true,
  "message": "Purchased 1x Rare Elixir for 575 gold",
  "itemId": "rare_elixir",
  "itemName": "Rare Elixir",
  "quantity": 1,
  "totalPrice": 575,
  "remainingGold": 425,
  "remainingStock": 2
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Invalid quantity (1-99) |
| 400 | Insufficient gold |
| 400 | Only {n} available |
| 400 | Cannot use shop during battle |
| 400 | You must be at this location to use the shop |
| 404 | Item not available at this shop |
| 404 | Target character not found |

---

### 12.3 Sell Item

Sell an item to a shop. Sell price is always 50% of base price.

```
POST /api/shops/:nodeId/:shopType/sell
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "itemInstanceId": 45,
  "quantity": 1
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Sold 1x Iron Sword for 75 gold",
  "itemName": "Iron Sword",
  "quantity": 1,
  "unitPrice": 75,
  "totalPrice": 75,
  "newGold": 975
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Invalid quantity (1-9999) |
| 400 | Cannot sell equipped items. Unequip first. |
| 400 | Cannot sell items listed on the marketplace. Cancel the listing first. |
| 400 | This item cannot be sold |
| 400 | Insufficient items |
| 404 | Item not found |

---

### 12.4 Get Sellable Inventory

Get items from shared inventory that can be sold at a shop.

```
GET /api/shops/:nodeId/:shopType/sell-inventory
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "nodeId": 5,
  "shopType": "blacksmith",
  "items": [
    {
      "instanceId": 45,
      "templateId": 101,
      "name": "Iron Sword",
      "description": "A sturdy iron blade",
      "type": "weapon",
      "rarity": "common",
      "quantity": 1,
      "basePrice": 150,
      "sellPrice": 75,
      "spriteId": "sword_iron"
    }
  ]
}
```

**Notes:**
- Only shows unequipped items from shared inventory
- Excludes items currently listed on marketplace
- Excludes untradeable items

---

## 13. Marketplace Endpoints

The marketplace supports two trading systems:
1. **Order Book** - For stackable/fungible items (commodities). Uses limit/market orders.
2. **Item Listings** - For unique items with augments. Individual item listings with specific prices.

### 13.1 Get Order Book

Get current buy/sell orders for a stackable item.

```
GET /api/marketplace/orderbook/:itemTemplateId
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `depth` (optional) - Number of price levels to return (default: 20)

**Response (200 OK):**
```json
{
  "itemTemplateId": 101,
  "itemName": "Iron Sword",
  "bids": [
    { "price": 140, "quantity": 2 },
    { "price": 135, "quantity": 5 }
  ],
  "asks": [
    { "price": 155, "quantity": 1 },
    { "price": 160, "quantity": 3 }
  ],
  "lastPrice": 150,
  "spread": 15
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Invalid item template ID |
| 400 | This item cannot be traded |
| 404 | Item not found |

---

### 13.2 Get My Orders

Get the player's active orders.

```
GET /api/marketplace/orders/mine
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `status` (optional) - Filter by order status

**Response (200 OK):**
```json
{
  "orders": [
    {
      "id": 123,
      "itemTemplateId": 101,
      "itemName": "Iron Sword",
      "side": "sell",
      "price": 160,
      "quantity": 1,
      "quantityFilled": 0,
      "status": "open",
      "createdAt": "2026-01-06T12:00:00.000Z"
    }
  ]
}
```

---

### 13.3 Create Limit Order

Create a buy or sell limit order for stackable items.

```
POST /api/marketplace/orders/limit
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "itemTemplateId": 101,
  "side": "buy",
  "price": 145,
  "quantity": 2,
  "characterId": 5
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Buy order placed for Iron Sword",
  "order": {
    "id": 456,
    "side": "buy",
    "price": 145,
    "quantity": 2,
    "quantityFilled": 0,
    "status": "open",
    "itemName": "Iron Sword"
  },
  "trades": [],
  "immediatelyFilled": false,
  "partiallyFilled": false,
  "gold": 9710
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Price must be a valid integer |
| 400 | Quantity must be a valid integer |
| 400 | Item template ID required |
| 400 | Side must be "buy" or "sell" |
| 400 | Price must be at least 1 |
| 400 | Price cannot exceed 999999999 |
| 400 | Quantity must be between 1 and 9999 |
| 400 | Insufficient gold |
| 400 | Maximum 10 active orders allowed |
| 404 | Character not found |

---

### 13.4 Create Market Order

Execute immediately at best available price.

```
POST /api/marketplace/orders/market
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "itemTemplateId": 101,
  "side": "buy",
  "quantity": 1,
  "characterId": 5
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Market buy executed: 1x Iron Sword @ avg 155g",
  "trades": [
    { "price": 155, "quantity": 1, "sellerId": 12 }
  ],
  "totalQuantity": 1,
  "totalGold": 155,
  "averagePrice": 155,
  "gold": 9845
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Quantity must be a valid integer |
| 400 | Item template ID required |
| 400 | Side must be "buy" or "sell" |
| 400 | Quantity must be between 1 and 9999 |
| 400 | No matching orders available |
| 400 | Insufficient gold |
| 404 | Character not found |

---

### 13.5 Cancel Order

Cancel an active limit order.

```
DELETE /api/marketplace/orders/:orderId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Order cancelled. 290g returned",
  "side": "buy",
  "returnedGold": 290,
  "returnedQuantity": 0,
  "itemName": "Iron Sword",
  "gold": 10000
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Invalid order ID |
| 400 | Order already filled or cancelled |
| 403 | Not your order |
| 404 | Order not found |

---

### 13.6 Search Items

Search for tradeable items on the marketplace.

```
GET /api/marketplace/search
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `q` (optional) - Search query for item name
- `type` (optional) - Filter by item type (weapon, armor, consumable, etc.)
- `augment` (optional) - Filter by augment type
- `limit` (optional) - Max results (default: 50)

**Response (200 OK):**
```json
{
  "items": [
    {
      "templateId": 101,
      "name": "Iron Sword",
      "itemType": "weapon",
      "basePrice": 150,
      "lowestAsk": 155,
      "highestBid": 140,
      "volume24h": 23
    }
  ]
}
```

---

### 13.7 Get Item Listings

Get all individual listings for items with a specific template (for unique/augmented items).

```
GET /api/marketplace/items/:templateId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "templateId": 101,
  "templateName": "Iron Sword",
  "itemType": "weapon",
  "basePrice": 150,
  "isStackable": false,
  "listings": [
    {
      "listingId": 789,
      "price": 500,
      "itemName": "Blazing Iron Sword",
      "rarity": "rare",
      "augments": [
        { "type": "fire_damage", "value": 15 }
      ],
      "sellerName": "player123",
      "listedAt": "2026-01-06T10:00:00.000Z"
    }
  ]
}
```

---

### 13.8 Get My Listings

Get the player's active item listings.

```
GET /api/marketplace/listings/mine
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "listings": [
    {
      "listingId": 789,
      "itemName": "Blazing Iron Sword",
      "templateId": 101,
      "price": 500,
      "rarity": "rare",
      "augments": [...],
      "listedAt": "2026-01-06T10:00:00.000Z"
    }
  ]
}
```

---

### 13.9 Get Sellable Inventory

Get items from inventory that can be listed on the marketplace.

```
GET /api/marketplace/inventory/sellable
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "items": [
    {
      "characterItemId": 456,
      "templateId": 101,
      "name": "Blazing Iron Sword",
      "itemType": "weapon",
      "rarity": "rare",
      "quantity": 1,
      "augments": [...]
    }
  ]
}
```

**Notes:**
- Only shows unequipped items
- Excludes items already listed
- Excludes untradeable items

---

### 13.10 Create Item Listing

List an individual item for sale (for unique/augmented items).

```
POST /api/marketplace/listings
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterId": 5,
  "characterItemId": 456,
  "price": 500
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Listed Blazing Iron Sword for 500g",
  "listing": {
    "listingId": 789,
    "itemName": "Blazing Iron Sword",
    "price": 500,
    "rarity": "rare",
    "augments": [...]
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Character ID required |
| 400 | Character item ID required |
| 400 | Price must be a valid integer |
| 400 | Price must be at least 1 |
| 400 | Price cannot exceed 999999999 |
| 400 | Item is already listed |
| 400 | Cannot list equipped items |
| 400 | Item is not tradeable |
| 404 | Character not found |
| 404 | Item not found |

---

### 13.11 Buy Item Listing

Purchase a listed item.

```
POST /api/marketplace/listings/:listingId/buy
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "characterId": 5
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Purchased Blazing Iron Sword for 500g",
  "purchase": {
    "itemName": "Blazing Iron Sword",
    "price": 500,
    "sellerId": 12
  },
  "gold": 9500
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Invalid listing ID |
| 400 | Character ID required |
| 400 | Insufficient gold |
| 400 | Cannot buy your own listing |
| 404 | Character not found |
| 404 | Listing not found or already sold |

---

### 13.12 Cancel Item Listing

Cancel an active item listing.

```
DELETE /api/marketplace/listings/:listingId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Listing for Blazing Iron Sword cancelled",
  "cancelled": {
    "itemName": "Blazing Iron Sword",
    "price": 500
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Invalid listing ID |
| 403 | Not your listing |
| 404 | Listing not found |

---

### 13.13 Get Price Suggestion

Get suggested price for an item based on rarity and augments.

```
GET /api/marketplace/price-suggestion
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `characterItemId` - Item instance ID
- `characterId` - Owning character ID

**Response (200 OK):**
```json
{
  "itemName": "Blazing Iron Sword",
  "basePrice": 150,
  "suggestedPrice": 450,
  "priceRange": {
    "low": 350,
    "high": 550
  },
  "factors": {
    "rarity": "rare",
    "rarityMultiplier": 2.0,
    "augmentBonus": 100
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Character item ID and character ID required |
| 404 | Item not found or not owned |

---

### 13.14 Get Trade History

Get recent trades for an item.

```
GET /api/marketplace/history/:itemTemplateId
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `limit` (optional) - Max trades to return (default: 50)

**Response (200 OK):**
```json
{
  "itemTemplateId": 101,
  "itemName": "Iron Sword",
  "trades": [
    {
      "id": 567,
      "price": 150,
      "quantity": 1,
      "executedAt": "2026-01-06T11:30:00.000Z"
    }
  ]
}
```

---

### 13.15 Get My Trades

Get the player's trade history.

```
GET /api/marketplace/my-trades
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `limit` (optional) - Max trades to return (default: 50)

**Response (200 OK):**
```json
{
  "trades": [
    {
      "id": 567,
      "itemTemplateId": 101,
      "itemName": "Iron Sword",
      "side": "buy",
      "price": 150,
      "quantity": 1,
      "totalGold": 150,
      "executedAt": "2026-01-06T11:30:00.000Z"
    }
  ]
}
```

---

### 13.16 Get Item Stats

Get 24-hour market statistics for an item.

```
GET /api/marketplace/stats/:itemTemplateId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "itemTemplateId": 101,
  "itemName": "Iron Sword",
  "basePrice": 150,
  "stats24h": {
    "tradeCount": 15,
    "volume": 23,
    "goldVolume": 3450,
    "lowPrice": 140,
    "highPrice": 165,
    "avgPrice": 152
  },
  "lastTradePrice": 155
}
```

---

## 14. Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /api/auth/login | 10 per 15 minutes |
| POST /api/auth/register | 10 per 15 minutes |
| POST /api/auth/register-with-character | 10 per 15 minutes |
| All other endpoints | 100 per minute |

**Rate Limit Response (429):**
```json
{
  "error": "Too many requests, please try again later."
}
```

---

## 15. Settings Endpoints

### 15.1 Get User Settings

Get current user's settings.

```
GET /api/settings
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "settings": {
    "battle": {
      "actionMenuStyle": "radial"
    }
  }
}
```

**Notes:**
- Returns default settings if user has no saved settings
- Default `actionMenuStyle`: "radial"
- Valid styles: "radial", "context", "actionbar"

---

### 15.2 Update User Settings

Update user settings (deep merge with existing settings).

```
PUT /api/settings
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "battle": {
    "actionMenuStyle": "context"
  }
}
```

**Response (200 OK):**
```json
{
  "settings": {
    "battle": {
      "actionMenuStyle": "context"
    }
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Settings must be an object |
| 400 | Invalid actionMenuStyle value |

---

## 16. Fishing Endpoints

Activity node for auto-fishing with chance of rare catches.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fishing/:nodeId` | Get fishing spot state and current session |
| POST | `/api/fishing/:nodeId/start` | Start fishing session at node |
| POST | `/api/fishing/:nodeId/stop` | Stop current fishing session |
| POST | `/api/fishing/:nodeId/catch` | Attempt to catch during Big One event |
| GET | `/api/fishing/inventory` | Get player's fish inventory |

---

## 17. Ruins Endpoints

Activity node for sliding puzzle minigame with regional themes.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ruins/:nodeId` | Get ruins puzzle state |
| POST | `/api/ruins/:nodeId/start` | Start new puzzle attempt |
| POST | `/api/ruins/:nodeId/move` | Submit puzzle move |

---

## 18. Relics Endpoints

Collection system for permanent stat bonuses.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/relics` | Get all relics and completion status |
| GET | `/api/relics/:relicId` | Get specific relic details |
| POST | `/api/relics/:relicId/activate` | Activate a collected relic |

---

## 19. Friends Endpoints

Social system for friend management and invites.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/friends` | Get friend list with online status |
| GET | `/api/friends/requests` | Get pending friend requests |
| POST | `/api/friends/request` | Send friend request |
| POST | `/api/friends/accept/:userId` | Accept friend request |
| POST | `/api/friends/decline/:userId` | Decline friend request |
| DELETE | `/api/friends/:userId` | Remove friend |
| POST | `/api/friends/:userId/block` | Block user |
| DELETE | `/api/friends/:userId/block` | Unblock user |
| GET | `/api/friends/blocked` | Get blocked users list |

---

## 20. LFG Endpoints

Looking-for-group system for party formation.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lfg` | Get active LFG posts |
| POST | `/api/lfg` | Create LFG post |
| DELETE | `/api/lfg/:postId` | Delete own LFG post |
| POST | `/api/lfg/:postId/apply` | Apply to join LFG group |

---

## 21. Notifications Endpoints

In-game notification system.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Get user's notifications |
| GET | `/api/notifications/unread` | Get unread notification count |
| POST | `/api/notifications/:id/read` | Mark notification as read |
| POST | `/api/notifications/read-all` | Mark all notifications as read |
| DELETE | `/api/notifications/:id` | Delete notification |

---

## 22. Advancement Quest Endpoints

Guild advancement quest system for class progression.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/advancement-quest/available` | Get available advancement quests |
| GET | `/api/advancement-quest/:characterId` | Get character's quest progress |
| POST | `/api/advancement-quest/:characterId/start` | Start advancement quest |
| POST | `/api/advancement-quest/:characterId/progress` | Update quest progress |
| POST | `/api/advancement-quest/:characterId/complete` | Complete quest and advance class |
| POST | `/api/advancement-quest/:characterId/abandon` | Abandon current quest |
| GET | `/api/advancement-quest/guildmaster/:class` | Get guildmaster boss info |

---

## 23. Daily/Weekly Quests Endpoints

Repeatable quest system with daily and weekly resets.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/quests/daily` | Get available daily quests |
| GET | `/api/quests/weekly` | Get available weekly quests |
| GET | `/api/quests/progress` | Get quest completion progress |
| POST | `/api/quests/:questId/claim` | Claim quest reward |
| GET | `/api/quests/bonus` | Get active quest bonuses |
| GET | `/api/quests/elite` | Get elite quest challenges |
| POST | `/api/quests/elite/:questId/start` | Start elite quest |

---

## 24. Coliseum Endpoints

PvP arena with matchmaking and rankings.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/coliseum/status` | Get coliseum availability and player status |
| POST | `/api/coliseum/queue` | Join matchmaking queue |
| DELETE | `/api/coliseum/queue` | Leave matchmaking queue |
| GET | `/api/coliseum/match/:matchId` | Get match details |
| POST | `/api/coliseum/match/:matchId/ready` | Signal ready for match |
| GET | `/api/coliseum/rankings` | Get PvP rankings |
| GET | `/api/coliseum/history` | Get player's match history |
| GET | `/api/coliseum/rewards` | Get season rewards |

---

## 25. Clans Endpoints

Clan system for player organizations.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clans` | Search/list clans |
| POST | `/api/clans` | Create new clan |
| GET | `/api/clans/:clanId` | Get clan details |
| POST | `/api/clans/:clanId/join` | Request to join clan |
| POST | `/api/clans/:clanId/leave` | Leave current clan |
| POST | `/api/clans/:clanId/invite` | Invite player to clan (officer+) |

---

## 26. Chat Endpoints

Chat message history retrieval (real-time via WebSocket).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat/history/:room` | Get chat history for room |
| GET | `/api/chat/rooms` | Get available chat rooms |
| POST | `/api/chat/report` | Report chat message |
| DELETE | `/api/chat/:messageId` | Delete own message |

---

## 27. Feedback Endpoints

User feedback submission for enhancements, bug reports, and abuse reports.

### 27.1 Submit Feedback

Submit user feedback.

```
POST /api/feedback
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "feedbackType": "enhancement|bug|abuse",
  "title": "string (max 200 chars)",
  "description": "string (max 2000 chars)",
  "reportedCharacterName": "string (optional, for abuse reports)"
}
```

**Response (201 Created):**
```json
{
  "id": 1,
  "feedbackType": "bug",
  "title": "Battle freezes when using skill",
  "status": "pending",
  "createdAt": "2026-01-26T12:00:00.000Z"
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | feedbackType is required |
| 400 | title is required |
| 400 | description is required |
| 400 | Invalid feedback type |
| 400 | Title must be 200 characters or less |
| 400 | Description must be 2000 characters or less |
| 400 | reportedCharacterName is required for abuse reports |
| 404 | Reported character not found |

---

### 27.2 Get My Feedback

Get the authenticated user's feedback submissions.

```
GET /api/feedback/my
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `limit` (optional) - Max results (default: 50)
- `status` (optional) - Filter by status (pending, reviewing, resolved, declined)

**Response (200 OK):**
```json
{
  "feedback": [
    {
      "id": 1,
      "feedbackType": "bug",
      "title": "Battle freezes when using skill",
      "status": "pending",
      "createdAt": "2026-01-26T12:00:00.000Z"
    },
    {
      "id": 2,
      "feedbackType": "enhancement",
      "title": "Add more character customization",
      "status": "reviewing",
      "createdAt": "2026-01-25T10:30:00.000Z"
    }
  ]
}
```

---

## 28. Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| TOKEN_EXPIRED | 401 | Access token has expired |
| INVALID_TOKEN | 401 | Token is malformed or invalid |
| UNAUTHORIZED | 401 | No token provided |
| FORBIDDEN | 403 | Account banned or lacks permission |
| NOT_FOUND | 404 | Resource does not exist |
| CONFLICT | 409 | Resource already exists |
| VALIDATION_ERROR | 400 | Input validation failed |
| IN_BATTLE | 400 | Action not allowed during battle |
| RATE_LIMITED | 429 | Too many requests |

---

## 29. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | Removed flee endpoint; added skill, guild, inventory, shop, marketplace endpoints; added battle and PvP WebSocket events |
| 2.1 | Jan 2026 | - | Added battle rejoin endpoint (6.5); updated submit action to show async WebSocket delivery (6.3); added battle turn events (7.8) and battle connection events (7.9) |
| 2.2 | Jan 2026 | - | Added sections 15-25: Fishing, Ruins, Relics, Friends, LFG, Notifications, Advancement Quest, Daily/Weekly Quests, Coliseum, Clans, Chat endpoints |
| 2.3 | Jan 2026 | - | Documentation audit: Verified all 24 route files have corresponding API documentation sections |
| 2.4 | Jan 2026 | - | Shop/Marketplace sync: Fixed shop endpoints (11.1-11.4) to match implementation with supply-based pricing, caravan support, sell-inventory. Rewrote marketplace section (12.1-12.16) adding item listings system, search, price suggestions, my-trades, stats. Updated request/response schemas to match actual code. |
| 2.5 | Jan 2026 | - | Added feedback endpoints (Section 26) for user submissions (enhancement, bug, abuse reports). Updated error response format to include requestId field for exception correlation. |
| 2.6 | Jan 2026 | - | Added register-with-character endpoint (Section 2.2) for atomic user+character creation. Updated auth section numbering (2.3-2.6). Added rate limit entry for new endpoint. |
| 2.7 | Feb 2026 | - | Added garrison endpoints (Section 10) for castle recruit system with regional race/class bias. Added garrison WebSocket events (Section 7.10). Updated starting gold to 1000 (was 100). Renumbered sections 10-28 to accommodate new garrison section. |
| 2.8 | Feb 2026 | - | Updated guild and garrison recruit price examples to reflect new pricing formula: base 400g + trait rarity costs + skill costs + stat variance bonus. Added price calculation notes with cross-reference to ECONOMY_SYSTEM.md. |
| 2.9 | Feb 2026 | - | Added coliseum:match_result WebSocket event (Section 7.11) for PvP match completion with detailed payload schema including unit stats, battle summary, and rating information. |
