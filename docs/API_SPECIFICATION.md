# Modia - API Specification

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| API Version | 2.0 |
| Base URL | `/api` |
| Last Updated | January 2026 |

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
  "details": { ... }
}
```

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
    "gold": 100
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

### 2.2 Login

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

### 2.3 Refresh Token

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

### 2.4 Logout

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

### 2.5 Get Current User

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
| 409 | Character name already exists |

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

Submit a battle action for the active unit.

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
  "state": { ... },
  "actionResult": {
    "moved": true,
    "damage": 0,
    "targetId": null
  },
  "battleStatus": "active"
}
```

**Battle Status Values:**
- `active` - Battle continues
- `victory` - All enemies defeated
- `defeat` - All player units defeated

**Response on Victory:**
```json
{
  "state": { ... },
  "actionResult": { ... },
  "battleStatus": "victory",
  "rewards": {
    "gold": 75,
    "experience": 125
  }
}
```

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

## 10. Inventory Endpoints

### 10.1 Get Inventory

Get character inventory.

```
GET /api/inventory/:characterId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "items": [
    {
      "instanceId": 1,
      "templateId": 101,
      "name": "Iron Sword",
      "itemType": "weapon",
      "rarity": "common",
      "quantity": 1,
      "isEquipped": true,
      "equippedSlot": "main_hand"
    }
  ],
  "capacity": 50,
  "equipped": {
    "main_hand": { "instanceId": 1, "name": "Iron Sword" },
    "off_hand": null,
    "head": null,
    "body": null,
    "feet": null,
    "accessory1": null,
    "accessory2": null
  }
}
```

---

### 10.2 Equip Item

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

### 10.3 Unequip Item

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

### 10.4 Use Item

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

### 10.5 Discard Item

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

## 11. Shop Endpoints

### 11.1 Get Node Shops

Get available shops at a node.

```
GET /api/shops/:nodeId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "shops": [
    {
      "type": "blacksmith",
      "name": "Castle Blacksmith",
      "itemCount": 15
    },
    {
      "type": "apothecary",
      "name": "Castle Apothecary",
      "itemCount": 12
    }
  ]
}
```

---

### 11.2 Get Shop Inventory

Get items available in a shop.

```
GET /api/shops/:nodeId/:shopType/inventory
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "shopType": "blacksmith",
  "items": [
    {
      "templateId": 101,
      "name": "Iron Sword",
      "itemType": "weapon",
      "price": 150,
      "quantity": 10,
      "supplyLevel": "normal"
    }
  ]
}
```

---

### 11.3 Buy Item

Purchase an item from a shop.

```
POST /api/shops/:nodeId/:shopType/buy
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "itemTemplateId": 101,
  "quantity": 1
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "items": [
    { "instanceId": 50, "name": "Iron Sword" }
  ],
  "totalCost": 150,
  "goldBalance": 850
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Insufficient gold |
| 400 | Item out of stock |
| 400 | Inventory full |

---

### 11.4 Sell Item

Sell an item to a shop.

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
  "goldReceived": 50,
  "goldBalance": 900
}
```

---

## 12. Marketplace Endpoints

### 12.1 Get Order Book

Get current buy/sell orders for an item.

```
GET /api/marketplace/orderbook/:itemTemplateId
```

**Headers:** `Authorization: Bearer <token>`

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

---

### 12.2 Get My Orders

Get the player's active orders.

```
GET /api/marketplace/orders/mine
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "orders": [
    {
      "orderId": "order_123",
      "itemTemplateId": 101,
      "itemName": "Iron Sword",
      "orderType": "sell",
      "quantity": 1,
      "pricePerUnit": 160,
      "createdAt": "2026-01-06T12:00:00Z"
    }
  ],
  "reservedGold": 0,
  "escrowedItems": 1,
  "maxOrders": 10,
  "remainingOrders": 9
}
```

---

### 12.3 Create Limit Order

Create a buy or sell limit order.

```
POST /api/marketplace/orders/limit
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "itemTemplateId": 101,
  "orderType": "buy",
  "quantity": 2,
  "pricePerUnit": 145
}
```

**Response (201 Created):**
```json
{
  "orderId": "order_456",
  "immediatelyFilled": 0,
  "remaining": 2,
  "reserved": {
    "gold": 290
  }
}
```

**Errors:**
| Code | Message |
|------|---------|
| 400 | Maximum 10 orders allowed |
| 400 | Insufficient gold for buy order |
| 400 | Item not found in inventory for sell order |

---

### 12.4 Create Market Order

Execute immediately at best available price.

```
POST /api/marketplace/orders/market
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "itemTemplateId": 101,
  "orderType": "buy",
  "quantity": 1
}
```

**Response (200 OK):**
```json
{
  "filled": 1,
  "unfilled": 0,
  "totalCost": 155,
  "trades": [
    { "price": 155, "quantity": 1 }
  ]
}
```

---

### 12.5 Cancel Order

Cancel an active order.

```
DELETE /api/marketplace/orders/:orderId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "released": {
    "gold": 290
  }
}
```

---

### 12.6 Get Trade History

Get recent trades for an item.

```
GET /api/marketplace/history/:itemTemplateId
```

**Headers:** `Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "trades": [
    {
      "price": 150,
      "quantity": 1,
      "timestamp": "2026-01-06T11:30:00Z"
    }
  ],
  "stats": {
    "high": 165,
    "low": 140,
    "volume": 23,
    "avg": 152
  }
}
```

---

## 13. Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /api/auth/login | 10 per 15 minutes |
| POST /api/auth/register | 10 per 15 minutes |
| All other endpoints | 100 per minute |

**Rate Limit Response (429):**
```json
{
  "error": "Too many requests, please try again later."
}
```

---

## 14. Error Codes

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

## 15. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | Removed flee endpoint; added skill, guild, inventory, shop, marketplace endpoints; added battle and PvP WebSocket events |
