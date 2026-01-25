# Modia - Battle Messaging Protocol

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.1 |
| Last Updated | January 2026 |
| Last Validated | 2026-01-25 |
| Protocol Type | Hybrid HTTP/WebSocket |

---

## 1. Overview

### 1.1 Hybrid Architecture

The battle messaging protocol uses a hybrid HTTP/WebSocket architecture to balance reliability with real-time responsiveness. Player actions are submitted via HTTP for guaranteed delivery and response semantics, while state updates and broadcasts flow through WebSocket for low-latency real-time communication.

```
+-----------------------------------------------------------------------------+
|                    Battle Messaging Architecture                              |
+-----------------------------------------------------------------------------+
|                                                                               |
|   PLAYER ACTIONS (HTTP)                    BROADCASTS (WebSocket)            |
|   +------------------------+               +------------------------+         |
|   | POST /api/battle/action|               | battle:turn_start      |         |
|   | POST /api/battle/start |               | battle:action_executed |         |
|   |                        |               | battle:unit_moved      |         |
|   | - Request/Response     |               | battle:state_sync      |         |
|   | - Guaranteed delivery  |               | battle:your_turn       |         |
|   | - Validation feedback  |               | battle:end             |         |
|   +------------------------+               +------------------------+         |
|              |                                        |                       |
|              v                                        v                       |
|   +------------------------------------------------------------+             |
|   |                     Battle Server                           |             |
|   |                                                              |             |
|   |   +------------------+    +------------------+               |             |
|   |   | Action Processor |    | Broadcast Engine |               |             |
|   |   +------------------+    +------------------+               |             |
|   |            |                       |                        |             |
|   |            v                       v                        |             |
|   |   +--------------------------------------------+            |             |
|   |   |           Battle State Manager             |            |             |
|   |   +--------------------------------------------+            |             |
|   |                                                              |             |
|   +------------------------------------------------------------+             |
|                                                                               |
+-----------------------------------------------------------------------------+
```

### 1.2 Why Hybrid?

| Concern | HTTP | WebSocket | Chosen |
|---------|------|-----------|--------|
| Action reliability | Request/response guarantees | Fire-and-forget | HTTP |
| Validation feedback | Immediate response | Requires separate message | HTTP |
| Real-time updates | Polling required | Push-based | WebSocket |
| Multi-client sync | Not applicable | Room broadcasting | WebSocket |
| Connection state | Stateless | Persistent | Both |

### 1.3 Battle Room Subscription

All connected clients join a battle room for real-time updates:

```
Room format: battle:{battleId}

Example: battle:42
```

Upon joining a battle room, clients receive the current battle state and begin receiving all subsequent broadcasts.

---

## 2. WebSocket Message Types (Server to Client)

All server-to-client WebSocket messages follow this structure:

```json
{
  "type": "battle:{message_type}",
  "payload": {
    "battleId": 42,
    ... ,
    "timestamp": 1704556800000
  }
}
```

Note: The `timestamp` is included in the payload. Sequence numbers are not currently implemented but are planned for future message ordering guarantees.

### 2.1 Message Reference Table

| Message | Payload | Purpose |
|---------|---------|---------|
| `battle:turn_start` | `{ battleId, unitId, unitType, unitName, position, turnPredictions }` | Broadcast when any unit's turn begins |
| `battle:intent_highlight` | `{ battleId, unitId, highlightType, tiles[], duration }` | Show enemy movement/attack range preview |
| `battle:action_executed` | `{ battleId, actorId, actionType, result }` | Result of action for animation |
| `battle:turn_changed` | `{ battleId, activeUnitIndex, activeUnitId, turn, turnPredictions }` | Turn complete, announce next unit (legacy) |
| `battle:unit_moved` | `{ battleId, unitId, from, to }` | Unit movement event |
| `battle:your_turn` | `{ battleId, unitId, state, availableActions }` | Sent only to controlling player |
| `battle:player_disconnected` | `{ battleId, playerId, playerName }` | Player dropped from battle |
| `battle:player_reconnected` | `{ battleId, playerId, playerName }` | Player returned to battle |
| `battle:state_sync` | `{ battleId, state, reason }` | Full state synchronization |
| `battle:state_update` | `{ battleId, state, rejoined? }` | State update (for rejoins) |
| `battle:enemy_actions` | `{ battleId, actions[] }` | Batch of enemy actions |
| `battle:phase_transition` | `{ battleId, bossId, bossName, phaseName, ... }` | Boss phase change |
| `battle:end` | `{ battleId, status, rewards }` | Battle complete |

### 2.2 Detailed Message Specifications

#### battle:turn_start

Broadcast to all participants when a unit's turn begins. Triggers camera pan to the active unit.

```json
{
  "type": "battle:turn_start",
  "payload": {
    "battleId": 42,
    "unitId": "char_1",
    "unitType": "player_local",
    "unitName": "Hero",
    "position": { "x": 3, "y": 5 },
    "turnPredictions": [
      { "unitId": "enemy_2", "estimatedTicks": 3 },
      { "unitId": "char_3", "estimatedTicks": 5 },
      { "unitId": "char_1", "estimatedTicks": 8 }
    ],
    "timestamp": 1704556800000
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `battleId` | number | Battle identifier |
| `unitId` | string | Active unit identifier |
| `unitType` | string | `"player_local"`, `"player_remote"`, or `"enemy"` |
| `unitName` | string | Display name for UI |
| `position` | object | Unit position `{ x, y }` for camera panning |
| `turnPredictions` | array | Predicted upcoming turns based on CT |
| `timestamp` | number | Server timestamp |

---

#### battle:intent_highlight

Shows enemy intent before action execution, allowing players to anticipate moves.

```json
{
  "type": "battle:intent_highlight",
  "payload": {
    "battleId": 42,
    "unitId": "enemy_1",
    "highlightType": "attack_range",
    "tiles": [
      { "x": 3, "y": 4 },
      { "x": 3, "y": 5 },
      { "x": 4, "y": 4 }
    ],
    "duration": 500
  },
  "sequence": 146,
  "timestamp": 1704556800500
}
```

| Field | Type | Description |
|-------|------|-------------|
| `highlightType` | string | `"movement_range"`, `"attack_range"`, `"target_path"`, `"target_tile"`, `"aoe"` |
| `tiles` | array | Tiles to highlight |
| `duration` | number | Highlight duration in milliseconds |

---

#### battle:action_executed

Broadcast after an action is processed, containing results for animation.

```json
{
  "type": "battle:action_executed",
  "payload": {
    "battleId": 42,
    "actorId": "char_1",
    "actionType": "skill",
    "result": {
      "damage": 125,
      "isCritical": false,
      "targetId": "enemy_1",
      "skillId": "warrior_bash",
      "missed": false,
      "effectApplied": "stun"
    },
    "timestamp": 1704556801000
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `battleId` | number | Battle identifier |
| `actorId` | string | Unit that performed the action |
| `actionType` | string | `"move"`, `"attack"`, `"skill"`, `"item"`, `"wait"`, `"zodiac_ability"` |
| `result` | object | Action outcome details |
| `result.damage` | number? | Damage dealt (if applicable) |
| `result.isCritical` | boolean? | Whether the hit was critical |
| `result.targetId` | string? | Target unit identifier |
| `result.skillId` | string? | Skill used (if skill action) |
| `result.missed` | boolean? | Whether the attack missed |
| `result.effectApplied` | string? | Status effect that was applied |
| `timestamp` | number | Server timestamp |

---

#### battle:turn_changed (Legacy)

Broadcast when a unit's turn is complete. Note: This is being phased out in favor of `battle:turn_start` for the new protocol.

```json
{
  "type": "battle:turn_changed",
  "payload": {
    "battleId": 42,
    "activeUnitIndex": 2,
    "activeUnitId": "enemy_2",
    "turn": 15,
    "turnPredictions": [
      { "unitId": "char_3", "estimatedTicks": 5 },
      { "unitId": "char_1", "estimatedTicks": 8 }
    ],
    "timestamp": 1704556801500
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `activeUnitIndex` | number | Index of new active unit in units array |
| `activeUnitId` | string | ID of the new active unit |
| `turn` | number | Current turn count |
| `turnPredictions` | array | Predicted upcoming turns based on CT |

---

#### battle:unit_moved

Broadcast when a unit moves to a new position.

```json
{
  "type": "battle:unit_moved",
  "payload": {
    "battleId": 42,
    "unitId": "char_1",
    "from": { "x": 3, "y": 5 },
    "to": { "x": 4, "y": 5 },
    "timestamp": 1704556801000
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `unitId` | string | Unit that moved |
| `from` | object | Previous position `{ x, y }` |
| `to` | object | New position `{ x, y }` |

---

#### battle:your_turn

Sent only to the controlling player when their unit's turn begins. Enables player input.

```json
{
  "type": "battle:your_turn",
  "payload": {
    "battleId": 42,
    "unitId": "char_1",
    "state": {
      "turn": 15,
      "phase": "active",
      "activeUnitId": "char_1",
      "units": [ ... ]
    },
    "availableActions": ["move", "attack", "skill", "item", "wait"],
    "timestamp": 1704556800000
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `battleId` | number | Battle identifier |
| `unitId` | string | Active unit identifier |
| `state` | object | Full battle state |
| `availableActions` | array | List of available action types |
| `timestamp` | number | Server timestamp |

---

#### battle:player_disconnected

Broadcast when a player loses connection during battle.

```json
{
  "type": "battle:player_disconnected",
  "payload": {
    "battleId": 42,
    "playerId": 5,
    "playerName": "Hero",
    "timestamp": 1704556800000
  }
}
```

---

#### battle:player_reconnected

Broadcast when a disconnected player returns.

```json
{
  "type": "battle:player_reconnected",
  "payload": {
    "battleId": 42,
    "playerId": 5,
    "playerName": "Hero",
    "timestamp": 1704556815000
  }
}
```

---

#### battle:state_sync

Full state synchronization, sent on reconnection or desync detection.

```json
{
  "type": "battle:state_sync",
  "payload": {
    "battleId": 42,
    "reason": "reconnect",
    "state": {
      "turn": 15,
      "phase": "active",
      "activeUnitId": "char_1",
      "units": [
        {
          "id": "char_1",
          "type": "player",
          "name": "Hero",
          "hp": 180,
          "maxHp": 200,
          "mp": 45,
          "maxMp": 60,
          "tileX": 3,
          "tileY": 5,
          "ct": 0,
          "statusEffects": []
        }
      ],
      "terrain": [ ... ],
      "elevation": [ ... ]
    },
    "timestamp": 1704556815500
  }
}
```

| Reason | Description |
|--------|-------------|
| `"reconnect"` | Player reconnected after disconnect |
| `"resync"` | Client requested resync |
| `"initial"` | Initial state on battle join |

---

#### battle:state_update

State update broadcast, typically for rejoins or full sync scenarios.

```json
{
  "type": "battle:state_update",
  "payload": {
    "battleId": 42,
    "state": { ... },
    "rejoined": true,
    "timestamp": 1704556815500
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `state` | object | Full battle state |
| `rejoined` | boolean? | True if this is a rejoin sync |

---

#### battle:enemy_actions

Batch of enemy actions for animation sequencing (multiplayer scenarios).

```json
{
  "type": "battle:enemy_actions",
  "payload": {
    "battleId": 42,
    "actions": [
      { "actorId": "enemy_1", "actionType": "attack", "result": { ... } },
      { "actorId": "enemy_2", "actionType": "move", "to": { "x": 5, "y": 3 } }
    ],
    "timestamp": 1704556815500
  }
}
```

---

#### battle:phase_transition

Broadcast when a boss enters a new phase.

```json
{
  "type": "battle:phase_transition",
  "payload": {
    "battleId": 42,
    "bossId": "boss_1",
    "bossName": "Dragon Lord",
    "phaseName": "Enraged",
    "phaseNumber": 2,
    "maxPhases": 3,
    "timestamp": 1704556815500
  }
}

---

#### battle:end

Broadcast when the battle concludes.

```json
{
  "type": "battle:end",
  "payload": {
    "battleId": 42,
    "status": "victory",
    "rewards": {
      "gold": 175,
      "experience": 450,
      "items": [
        { "templateId": 101, "name": "Health Potion", "quantity": 1 }
      ],
      "advancementComplete": null
    },
    "timestamp": 1704557045000
  }
}
```

| Status | Description |
|--------|-------------|
| `"victory"` | Player team won |
| `"defeat"` | Player team lost |

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Battle outcome |
| `rewards` | object? | Rewards for victory (null for defeat) |
| `rewards.gold` | number | Gold earned |
| `rewards.experience` | number | XP earned |
| `rewards.items` | array | Dropped items |
| `rewards.advancementComplete` | object? | Guild advancement result if applicable |

---

## 3. WebSocket Message Types (Client to Server)

### 3.1 Room Management

The client uses WebSocket for room subscription only. All battle actions are submitted via HTTP.

| Message | Payload | Purpose |
|---------|---------|---------|
| `join_room` | `{ room: "battle:{battleId}" }` | Join battle room for real-time updates |
| `leave_room` | `{ room: "battle:{battleId}" }` | Leave battle room |

### 3.2 Action Submission

**All player actions are submitted via HTTP `POST /api/battle/action`**, not WebSocket. This provides:
- Request/response guarantees
- Validation feedback
- Idempotency support

The WebSocket channel is used exclusively for server-to-client broadcasts.

---

## 4. HTTP Endpoints for Battle

### 4.1 Endpoint Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/battle/preview/:nodeId` | Get encounter preview for formation |
| `POST` | `/api/battle/start` | Start PvE battle at current node |
| `GET` | `/api/battle/current` | Get current active battle state |
| `GET` | `/api/battle/:battleId/rejoin` | Rejoin battle after disconnect |
| `POST` | `/api/battle/action` | Submit battle action |
| `GET` | `/api/battle/rewards/:battleId` | Get rewards after victory |
| `POST` | `/api/battle/:battleId/zodiac-ability` | Use zodiac signature ability |
| `GET` | `/api/battle/:battleId/zodiac-abilities/:characterId` | Get available zodiac abilities |

### 4.2 POST /api/battle/start

Start a new PvE battle at the player's current node.

**Request Body:**
```json
{
  "formation": {
    "1": { "tileX": 2, "tileY": 1 },
    "2": { "tileX": 3, "tileY": 1 }
  }
}
```

**Response (201 Created):**
```json
{
  "battleId": 42,
  "mapSeed": 123456,
  "mapWidth": 32,
  "mapHeight": 32,
  "nodeType": "forest",
  "state": {
    "turn": 1,
    "phase": "active",
    "activeUnitId": "char_1",
    "units": [ ... ],
    "terrain": [ ... ],
    "elevation": [ ... ],
    "consumables": [ ... ],
    "turnPredictions": [ ... ]
  },
  "availableActions": { ... }
}
```

### 4.3 POST /api/battle/action

Submit a player action during battle.

**Request Body:**
```json
{
  "battleId": 42,
  "actionType": "move",
  "unitId": "char_1",
  "targetTile": { "x": 4, "y": 5 },
  "skillId": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `battleId` | number | Yes | Battle identifier |
| `actionType` | string | Yes | `"move"`, `"attack"`, `"skill"`, `"item"`, `"wait"` |
| `unitId` | string | Yes | Acting unit identifier |
| `targetTile` | object | For move/attack/skill | Target position `{ x, y }` |
| `skillId` | string | For skill action | Skill to use |

**Response (200 OK):**
```json
{
  "state": { ... },
  "actionResult": {
    "damage": 45,
    "isCritical": false,
    "targetId": "enemy_1",
    "turnEnded": false
  },
  "battleStatus": "active",
  "turnContinues": true,
  "availableActions": {
    "canMove": false,
    "canAct": true,
    "movementRange": [],
    "attackRange": [ ... ],
    "skills": [ ... ]
  }
}
```

The response includes the updated battle state. Results are also broadcast via WebSocket `battle:action_executed` to all participants.

**Error Response (400 Bad Request):**
```json
{
  "error": "Not this unit's turn",
  "state": { ... },
  "availableActions": { ... }
}
```

### 4.4 GET /api/battle/:battleId/rejoin

Rejoin an active battle after disconnect.

**Response (200 OK):**
```json
{
  "success": true,
  "battleId": 42,
  "battleType": "pve",
  "mapSeed": 123456,
  "mapWidth": 32,
  "mapHeight": 32,
  "nodeType": "forest",
  "nodeName": "Dark Forest",
  "state": { ... },
  "gracePeriod": 0,
  "disconnectedPlayers": [],
  "availableActions": { ... }
}
```

### 4.5 Action Error Codes

| Error | HTTP Status | Description |
|-------|-------------|-------------|
| Not this unit's turn | 400 | Not the specified unit's turn |
| Battle not found or not active | 404 | Battle does not exist or ended |
| You do not control this unit | 403 | Unit belongs to another player |
| Cannot battle at this location | 400 | Node type doesn't support battles |
| No battle party set | 400 | No characters in battle party |
| Cannot battle with incapacitated characters | 400 | Party member has 0 HP |

---

## 5. State Synchronization Protocol

### 5.1 Sequence Number System

Every server broadcast includes a monotonically increasing sequence number. Clients track received sequences to detect gaps and request resynchronization when needed.

```
+-----------------------------------------------------------------------------+
|                      Sequence Number Flow                                     |
+-----------------------------------------------------------------------------+
|                                                                               |
|   SERVER                              CLIENT                                 |
|      |                                   |                                    |
|      |-- battle:turn_start (seq: 145) -->|  lastReceived = 145               |
|      |                                   |                                    |
|      |-- battle:action_result (seq:146)->|  lastReceived = 146               |
|      |                                   |                                    |
|      |-- battle:turn_end (seq: 147) ---->|  lastReceived = 147               |
|      |                                   |                                    |
|      |-- battle:turn_start (seq: 148) -->|  lastReceived = 148               |
|      |                                   |                                    |
|      |    [message seq: 149 lost]        |                                    |
|      |                                   |                                    |
|      |-- battle:action_result (seq:150)->|  DETECTED GAP: 148 -> 150         |
|      |                                   |                                    |
|      |<-- battle:request_sync -----------|  Request sync from seq 148        |
|      |                                   |                                    |
|      |-- battle:state_sync (seq: 151) -->|  Full state restored              |
|      |                                   |  lastReceived = 151               |
|      |                                   |                                    |
+-----------------------------------------------------------------------------+
```

### 5.2 Client Sequence Tracking

```javascript
class BattleSequenceTracker {
  constructor() {
    this.lastReceived = 0;
    this.messageBuffer = new Map();
    this.maxBufferSize = 10;
  }

  processMessage(message) {
    const { sequence } = message;

    // Duplicate check
    if (sequence <= this.lastReceived) {
      console.log('Discarding duplicate:', sequence);
      return null;
    }

    // Gap detection
    if (sequence > this.lastReceived + 1) {
      console.log('Gap detected:', this.lastReceived, '->', sequence);
      this.bufferMessage(message);
      this.requestSync();
      return null;
    }

    // In order - process immediately
    this.lastReceived = sequence;
    return message;
  }

  bufferMessage(message) {
    this.messageBuffer.set(message.sequence, message);

    // Trim buffer if too large
    if (this.messageBuffer.size > this.maxBufferSize) {
      const oldest = Math.min(...this.messageBuffer.keys());
      this.messageBuffer.delete(oldest);
    }
  }

  processBufferedMessages() {
    const sorted = [...this.messageBuffer.entries()]
      .sort(([a], [b]) => a - b);

    for (const [seq, msg] of sorted) {
      if (seq === this.lastReceived + 1) {
        this.lastReceived = seq;
        this.messageBuffer.delete(seq);
        this.handleMessage(msg);
      }
    }
  }
}
```

### 5.3 State Sync Triggers

| Trigger | Action |
|---------|--------|
| Sequence gap detected | Buffer incoming, request sync |
| Client reconnection | Server sends full state sync |
| Explicit sync request | Server sends full state sync |
| Server detects stale client | Push state sync to client |

### 5.4 Reconnection Flow

```
+-----------------------------------------------------------------------------+
|                        Reconnection Protocol                                  |
+-----------------------------------------------------------------------------+
|                                                                               |
|   CLIENT                              SERVER                                 |
|      |                                   |                                    |
|      |  [Connection lost]                |                                    |
|      |                                   |                                    |
|      |         ...30 second grace...     |                                    |
|      |                                   |                                    |
|      |-- WebSocket connect ------------->|                                    |
|      |                                   |                                    |
|      |-- auth { token } --------------->|  Validate token                    |
|      |                                   |                                    |
|      |<-- auth_success -----------------| |                                    |
|      |                                   |                                    |
|      |-- join_room { battle:42 } ------>|  Detect active battle              |
|      |                                   |                                    |
|      |<-- room_joined ------------------| |                                    |
|      |                                   |                                    |
|      |<-- battle:state_sync ------------|  Full state with reason:           |
|      |    { reason: "reconnection" }    |  "reconnection"                    |
|      |                                   |                                    |
|      |<-- battle:player_reconnected ----|  Broadcast to all participants     |
|      |                                   |                                    |
+-----------------------------------------------------------------------------+
```

---

## 6. Message Ordering

### 6.1 Server Responsibilities

- Assign monotonically increasing sequence numbers to all broadcasts
- Never reuse or skip sequence numbers within a battle
- Include sequence in every battle broadcast
- Persist current sequence with battle state

### 6.2 Client Responsibilities

- Track last received sequence number
- Detect gaps when `received_seq > last_seq + 1`
- Buffer out-of-order messages
- Request sync when gap detected
- Discard duplicates (`received_seq <= last_seq`)
- Process buffered messages after sync

### 6.3 Ordering Rules

| Scenario | Behavior |
|----------|----------|
| In-order message | Process immediately, update lastReceived |
| Gap detected | Buffer message, request sync |
| Duplicate received | Discard silently |
| Sync received | Apply full state, clear buffer, process remaining |
| Buffer overflow | Discard oldest, request sync |

---

## 7. Error Handling

### 7.1 Action Errors

When an invalid action is submitted, the server responds with an error.

**Via HTTP:**
```json
{
  "success": false,
  "error": "Invalid move target - tile is blocked",
  "code": "INVALID_TARGET",
  "details": {
    "requestedTile": { "x": 5, "y": 3 },
    "blockedBy": "obstacle"
  }
}
```

**Via WebSocket (if using `battle:player_action`):**
```json
{
  "type": "battle:action_error",
  "payload": {
    "battleId": 42,
    "error": "Invalid move target - tile is blocked",
    "code": "INVALID_TARGET",
    "originalAction": {
      "actionType": "move",
      "targetTile": { "x": 5, "y": 3 }
    }
  },
  "sequence": 147,
  "timestamp": 1704556800000
}
```

### 7.2 Connection Loss Handling

```
+-----------------------------------------------------------------------------+
|                     Connection Loss Flow                                      |
+-----------------------------------------------------------------------------+
|                                                                               |
|   PvE Battle:                                                                |
|   +-----------------------------------------------------------------+        |
|   | 1. Connection lost                                               |        |
|   | 2. Turn timer continues on server                               |        |
|   | 3. If player's turn, auto-wait on timeout                       |        |
|   | 4. Battle continues with AI enemies                             |        |
|   | 5. On reconnect, receive state_sync                             |        |
|   +-----------------------------------------------------------------+        |
|                                                                               |
|   PvP Battle:                                                                |
|   +-----------------------------------------------------------------+        |
|   | 1. Connection lost                                               |        |
|   | 2. battle:player_disconnected broadcast                         |        |
|   | 3. 30 second grace period begins                                |        |
|   | 4. If not reconnected, auto-forfeit                             |        |
|   | 5. On reconnect within grace, resume normally                   |        |
|   +-----------------------------------------------------------------+        |
|                                                                               |
+-----------------------------------------------------------------------------+
```

### 7.3 Stale Sequence Handling

Messages with sequence numbers at or below the client's last received are considered stale and should be ignored:

```javascript
function handleBattleMessage(message) {
  if (message.sequence <= this.lastReceivedSequence) {
    // Stale or duplicate - ignore
    return;
  }

  // Process message...
}
```

---

## 8. Timing Constants

### 8.1 Configuration Table

| Constant | Value | Purpose |
|----------|-------|---------|
| `TURN_TIMEOUT` | 60000ms | Player turn time limit |
| `PVP_TURN_TIMEOUT` | 45000ms | Shorter timeout for PvP battles |
| `TURN_WARNING_TIME` | 10000ms | Time remaining when warning sent |
| `INTENT_HIGHLIGHT_DURATION` | 500ms | Enemy intent preview display time |
| `ACTION_ANIMATION_MIN` | 300ms | Minimum time for action animations |
| `ENEMY_ACTION_DELAY` | 300-800ms | AI action delay for readability |
| `RECONNECT_GRACE` | 30000ms | Time before forfeit on disconnect |
| `PING_INTERVAL` | 15000ms | Keep-alive ping frequency |
| `SYNC_REQUEST_COOLDOWN` | 5000ms | Minimum time between sync requests |
| `MESSAGE_BUFFER_TIMEOUT` | 10000ms | Max time to hold buffered messages |

### 8.2 Timing Diagram

```
+-----------------------------------------------------------------------------+
|                         Turn Timing Breakdown                                 |
+-----------------------------------------------------------------------------+
|                                                                               |
|   T=0                      T=50s                T=55s              T=60s     |
|    |                         |                    |                   |       |
|    |-- Turn Start            |-- Warning (10s)    |-- Urgent (5s)     |       |
|    |                         |   broadcast        |   broadcast       |       |
|    |                         |                    |                   |       |
|    |<---- Player Action Time (60 seconds) ------->|<-- Final warning->|       |
|    |                         |                    |                   |       |
|    v                         v                    v                   v       |
|    +-------------------------+--------------------+-------------------+       |
|    |     Normal input        |   UI warning       |  Urgent warning   | Timeout|
|    +-------------------------+--------------------+-------------------+       |
|                                                                               |
+-----------------------------------------------------------------------------+
```

### 8.3 Animation Timing

| Animation Type | Duration | Notes |
|----------------|----------|-------|
| Movement (per tile) | 150ms | Linear interpolation |
| Basic attack | 300ms | Swing + hit |
| Skill | 500-1000ms | Varies by skill |
| Damage number | 800ms | Float up and fade |
| Death | 500ms | Fade out |
| Status effect | 300ms | Icon pulse |

---

## 9. Message Flow Diagrams

### 9.1 Complete Player Turn Flow

```
+-----------------------------------------------------------------------------+
|                        Player Turn Message Flow                               |
+-----------------------------------------------------------------------------+
|                                                                               |
|   CLIENT                    SERVER                    OTHER CLIENTS          |
|      |                         |                            |                 |
|      |                         |-- battle:turn_start ------>|                 |
|      |<-- battle:turn_start ---|                            |                 |
|      |                         |                            |                 |
|      |<-- battle:your_turn ----|                            |                 |
|      |    (only to active)     |                            |                 |
|      |                         |                            |                 |
|      |-- POST /battle/action ->|                            |                 |
|      |   { move to (4,5) }     |                            |                 |
|      |                         |                            |                 |
|      |<-- { state, result }    |                            |                 |
|      |                         |                            |                 |
|      |                         |-- battle:unit_moved ------>|                 |
|      |<-- battle:unit_moved --|     (broadcast to all)      |                 |
|      |                         |                            |                 |
|      |    [animate movement]   |                            |                 |
|      |                         |                            |                 |
|      |-- POST /battle/action ->|                            |                 |
|      |   { attack enemy_1 }    |                            |                 |
|      |                         |                            |                 |
|      |<-- { state, result }    |                            |                 |
|      |                         |                            |                 |
|      |                         |-- battle:action_executed ->|                 |
|      |<-- battle:action_exec --|     (broadcast to all)     |                 |
|      |                         |                            |                 |
|      |    [next turn starts]   |                            |                 |
|      |                         |                            |                 |
+-----------------------------------------------------------------------------+
```

### 9.2 Enemy Turn Flow

```
+-----------------------------------------------------------------------------+
|                         Enemy Turn Message Flow                               |
+-----------------------------------------------------------------------------+
|                                                                               |
|   CLIENT                    SERVER                                           |
|      |                         |                                              |
|      |<-- battle:turn_start ---|  unitType: "enemy"                          |
|      |                         |                                              |
|      |                         |  [AI calculates action]                     |
|      |                         |                                              |
|      |<-- battle:intent_highlight  Show attack range                         |
|      |    { tiles, duration }  |                                              |
|      |                         |                                              |
|      |    [500ms delay]        |                                              |
|      |                         |                                              |
|      |<-- battle:action_executed  Action executed                            |
|      |    { damage, effects }  |                                              |
|      |                         |                                              |
|      |    [animate attack]     |                                              |
|      |                         |                                              |
|      |<-- battle:turn_start --|  Next unit's turn                            |
|      |                         |                                              |
+-----------------------------------------------------------------------------+
```

---

## 10. Implementation Notes

### 10.1 Server Implementation Checklist

- [x] Broadcast to all room members via `battleWebsocket.js`
- [x] Send `battle:your_turn` only to controlling player
- [x] Handle reconnection with state sync via `/api/battle/:battleId/rejoin`
- [x] Track player connection state via `battleReconnection.js`
- [ ] Assign unique sequence numbers per battle (planned)
- [ ] Implement turn timeout with warnings (planned)

### 10.2 Client Implementation Checklist

- [x] Join battle room on battle start via `socket.joinBattleRoom()`
- [x] Handle all message types with appropriate UI updates via `BattleWebSocketManager.js`
- [x] Queue turn events for sequential processing (turn event queue)
- [x] Auto-reconnect on disconnect with `/api/battle/:battleId/rejoin`
- [ ] Track last received sequence (planned - currently not implemented)
- [ ] Detect and handle sequence gaps (planned)
- [ ] Buffer out-of-order messages (planned)

### 10.3 Testing Considerations

| Scenario | Test Approach |
|----------|---------------|
| Message ordering | Simulate out-of-order delivery |
| Connection loss | Force disconnect during turn |
| Reconnection | Reconnect mid-battle |
| Timeout | Let turn timer expire |
| Concurrent actions | Race condition testing |

---

## 11. Related Documents

| Document | Description |
|----------|-------------|
| [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) | CT-based turn order, two-action system |
| [BATTLE_RECONNECTION.md](BATTLE_RECONNECTION.md) | Reconnection flow, grace periods, state sync |
| [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) | Visual feedback, animation timing |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle endpoints, WebSocket protocol |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas, battle_state structure |
| [GAME_DESIGN.md](GAME_DESIGN.md) | Combat formulas, damage calculation |

---

## 12. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document: Hybrid HTTP/WebSocket protocol, message specifications, state sync, timing constants |
| 1.1 | 2026-01-25 | - | Validated against implementation: Fixed event names (`battle:action_executed`, `battle:turn_changed`), added missing events (`battle:unit_moved`, `battle:state_update`, `battle:enemy_actions`, `battle:phase_transition`), updated payload schemas to match code, added all HTTP endpoints, removed unsupported client-to-server WebSocket messages |
