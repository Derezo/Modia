# Modia - Battle Messaging Protocol

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.0 |
| Last Updated | January 2026 |
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
|   |                        |               | battle:action_result   |         |
|   | - Request/Response     |               | battle:turn_end        |         |
|   | - Guaranteed delivery  |               | battle:state_sync      |         |
|   | - Validation feedback  |               | battle:end             |         |
|   | - Idempotency support  |               |                        |         |
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
  "payload": { ... },
  "sequence": 123,
  "timestamp": 1704556800000
}
```

### 2.1 Message Reference Table

| Message | Payload | Purpose |
|---------|---------|---------|
| `battle:turn_start` | `{ battleId, unitId, unitType, unitName, turnPredictions }` | Broadcast when any unit's turn begins |
| `battle:intent_highlight` | `{ battleId, unitId, highlightType, tiles[], duration }` | Show enemy movement/attack range preview |
| `battle:action_result` | `{ battleId, unitId, actionType, result, targetTile, damage?, effects? }` | Result of action for animation |
| `battle:turn_end` | `{ battleId, unitId, nextUnitId, nextUnitType }` | Turn complete, announce next unit |
| `battle:your_turn` | `{ battleId, unitId, state, availableActions }` | Sent only to controlling player |
| `battle:player_disconnected` | `{ battleId, playerId, playerName }` | Player dropped from battle |
| `battle:player_reconnected` | `{ battleId, playerId, playerName }` | Player returned to battle |
| `battle:state_sync` | `{ battleId, state, reason }` | Full state synchronization |
| `battle:end` | `{ battleId, status, winners, rewards }` | Battle complete |

### 2.2 Detailed Message Specifications

#### battle:turn_start

Broadcast to all participants when a unit's turn begins.

```json
{
  "type": "battle:turn_start",
  "payload": {
    "battleId": 42,
    "unitId": "char_1",
    "unitType": "player_local",
    "unitName": "Hero",
    "turnNumber": 15,
    "turnPredictions": [
      { "unitId": "enemy_2", "estimatedTicks": 3 },
      { "unitId": "char_3", "estimatedTicks": 5 },
      { "unitId": "char_1", "estimatedTicks": 8 }
    ]
  },
  "sequence": 145,
  "timestamp": 1704556800000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `battleId` | number | Battle identifier |
| `unitId` | string | Active unit identifier |
| `unitType` | string | `"player_local"`, `"player_remote"`, or `"enemy"` |
| `unitName` | string | Display name for UI |
| `turnNumber` | number | Current turn count |
| `turnPredictions` | array | Predicted upcoming turns based on CT |

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
| `highlightType` | string | `"movement"`, `"attack_range"`, `"skill_area"` |
| `tiles` | array | Tiles to highlight |
| `duration` | number | Highlight duration in milliseconds |

---

#### battle:action_result

Broadcast after an action is processed, containing results for animation.

```json
{
  "type": "battle:action_result",
  "payload": {
    "battleId": 42,
    "unitId": "char_1",
    "actionType": "skill",
    "skillId": "warrior_bash",
    "targetTile": { "x": 5, "y": 3 },
    "result": {
      "success": true,
      "damage": 125,
      "critical": false,
      "targetId": "enemy_1"
    },
    "effects": [
      { "type": "stun", "targetId": "enemy_1", "duration": 1 }
    ],
    "unitStates": {
      "enemy_1": {
        "hp": 25,
        "maxHp": 150,
        "mp": 30,
        "maxMp": 30,
        "statusEffects": [
          { "type": "stun", "duration": 1 }
        ]
      }
    },
    "turnState": {
      "moveUsed": true,
      "actUsed": true,
      "turnComplete": true
    }
  },
  "sequence": 147,
  "timestamp": 1704556801000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `actionType` | string | `"move"`, `"attack"`, `"skill"`, `"item"`, `"wait"` |
| `skillId` | string? | Skill identifier if action was skill |
| `targetTile` | object | Target position `{ x, y }` |
| `result` | object | Action outcome details |
| `effects` | array? | Status effects applied |
| `unitStates` | object | Updated states for affected units |
| `turnState` | object | Current turn action state |

---

#### battle:turn_end

Broadcast when a unit's turn is complete.

```json
{
  "type": "battle:turn_end",
  "payload": {
    "battleId": 42,
    "unitId": "char_1",
    "turnNumber": 15,
    "nextUnitId": "enemy_2",
    "nextUnitType": "enemy"
  },
  "sequence": 148,
  "timestamp": 1704556801500
}
```

| Field | Type | Description |
|-------|------|-------------|
| `nextUnitType` | string | `"player_local"`, `"player_remote"`, or `"enemy"` |

---

#### battle:your_turn

Sent only to the controlling player when their unit's turn begins.

```json
{
  "type": "battle:your_turn",
  "payload": {
    "battleId": 42,
    "unitId": "char_1",
    "state": {
      "hp": 180,
      "maxHp": 200,
      "mp": 45,
      "maxMp": 60,
      "tileX": 3,
      "tileY": 5,
      "statusEffects": []
    },
    "availableActions": {
      "canMove": true,
      "canAct": true,
      "canWait": true,
      "movementRange": [
        { "x": 2, "y": 5 },
        { "x": 4, "y": 5 },
        { "x": 3, "y": 4 },
        { "x": 3, "y": 6 }
      ],
      "attackRange": [
        { "x": 2, "y": 5 },
        { "x": 4, "y": 5 }
      ],
      "skills": [
        { "id": "warrior_bash", "mpCost": 15, "available": true },
        { "id": "warrior_shield", "mpCost": 10, "available": true }
      ]
    },
    "timeRemaining": 60000
  },
  "sequence": 145,
  "timestamp": 1704556800000
}
```

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
    "gracePeriod": 30000,
    "forfeitAt": 1704556830000
  },
  "sequence": 150,
  "timestamp": 1704556800000
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
    "playerName": "Hero"
  },
  "sequence": 155,
  "timestamp": 1704556815000
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
    "reason": "reconnection",
    "state": {
      "turn": 15,
      "phase": "player_turn",
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
      "terrain": { ... },
      "turnState": {
        "moveUsed": false,
        "actUsed": false
      }
    },
    "lastSequence": 144
  },
  "sequence": 156,
  "timestamp": 1704556815500
}
```

| Reason | Description |
|--------|-------------|
| `"reconnection"` | Player reconnected after disconnect |
| `"desync_detected"` | Client reported sequence gap |
| `"admin_request"` | Manual sync request |

---

#### battle:end

Broadcast when the battle concludes.

```json
{
  "type": "battle:end",
  "payload": {
    "battleId": 42,
    "status": "victory",
    "winners": [1],
    "turnCount": 23,
    "duration": 245000,
    "rewards": {
      "xp": 450,
      "gold": 175,
      "items": [
        { "templateId": 101, "name": "Health Potion", "quantity": 1 }
      ]
    },
    "characterUpdates": [
      {
        "characterId": 1,
        "xpGained": 450,
        "newLevel": 16,
        "leveledUp": true
      }
    ]
  },
  "sequence": 200,
  "timestamp": 1704557045000
}
```

| Status | Description |
|--------|-------------|
| `"victory"` | Player team won |
| `"defeat"` | Player team lost |
| `"draw"` | Battle ended in draw |
| `"forfeit"` | Opponent forfeited (PvP) |

---

## 3. WebSocket Message Types (Client to Server)

### 3.1 Message Reference Table

| Message | Payload | Purpose |
|---------|---------|---------|
| `battle:player_action` | `{ battleId, actionType, unitId, targetTile, skillId? }` | Alternative to HTTP POST for real-time |
| `battle:ping` | `{ battleId, timestamp }` | Keep-alive and latency measurement |
| `battle:request_sync` | `{ battleId, lastSequence }` | Request state synchronization |

### 3.2 Detailed Message Specifications

#### battle:player_action

Alternative to HTTP endpoint for submitting actions. Use HTTP for better reliability guarantees.

```json
{
  "type": "battle:player_action",
  "payload": {
    "battleId": 42,
    "actionType": "move",
    "unitId": "char_1",
    "targetTile": { "x": 4, "y": 5 }
  }
}
```

---

#### battle:ping

Keep-alive message to maintain connection and measure latency.

```json
{
  "type": "battle:ping",
  "payload": {
    "battleId": 42,
    "timestamp": 1704556800000
  }
}
```

Server responds with:

```json
{
  "type": "battle:pong",
  "payload": {
    "battleId": 42,
    "clientTimestamp": 1704556800000,
    "serverTimestamp": 1704556800015
  }
}
```

---

#### battle:request_sync

Request full state sync when client detects message gap.

```json
{
  "type": "battle:request_sync",
  "payload": {
    "battleId": 42,
    "lastSequence": 140,
    "reason": "sequence_gap"
  }
}
```

---

## 4. HTTP Endpoints for Player Actions

### 4.1 Submit Player Action

The primary method for submitting player actions during battle.

```
POST /api/battle/action
```

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

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
| `itemId` | string | For item action | Item to use |

**Response (200 OK):**
```json
{
  "success": true,
  "actionId": "action_42_147",
  "sequence": 147
}
```

The immediate response confirms action receipt. Full results are delivered via WebSocket `battle:action_result` to all participants.

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Not this unit's turn",
  "code": "INVALID_TURN"
}
```

### 4.2 Action Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_TURN` | 400 | Not the specified unit's turn |
| `INVALID_ACTION` | 400 | Action type not recognized |
| `INVALID_TARGET` | 400 | Target tile is invalid |
| `OUT_OF_RANGE` | 400 | Target outside action range |
| `INSUFFICIENT_MP` | 400 | Not enough MP for skill |
| `ALREADY_ACTED` | 400 | Unit already performed this action type |
| `BATTLE_NOT_FOUND` | 404 | Battle does not exist |
| `BATTLE_ENDED` | 400 | Battle has already concluded |
| `STATUS_BLOCKED` | 400 | Status effect prevents action |

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
|      |<-- { success, seq:147 } |                            |                 |
|      |                         |                            |                 |
|      |                         |-- battle:action_result --->|                 |
|      |<-- battle:action_result-|    (broadcast to all)      |                 |
|      |                         |                            |                 |
|      |    [animate movement]   |                            |                 |
|      |                         |                            |                 |
|      |-- POST /battle/action ->|                            |                 |
|      |   { attack enemy_1 }    |                            |                 |
|      |                         |                            |                 |
|      |<-- { success, seq:148 } |                            |                 |
|      |                         |                            |                 |
|      |                         |-- battle:action_result --->|                 |
|      |<-- battle:action_result-|    (broadcast to all)      |                 |
|      |   { turnComplete: true }|                            |                 |
|      |                         |                            |                 |
|      |                         |-- battle:turn_end -------->|                 |
|      |<-- battle:turn_end -----|                            |                 |
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
|      |<-- battle:action_result-|  Action executed                            |
|      |    { damage, effects }  |                                              |
|      |                         |                                              |
|      |    [animate attack]     |                                              |
|      |                         |                                              |
|      |<-- battle:turn_end -----|                                              |
|      |                         |                                              |
+-----------------------------------------------------------------------------+
```

---

## 10. Implementation Notes

### 10.1 Server Implementation Checklist

- [ ] Assign unique sequence numbers per battle
- [ ] Persist sequence with battle state
- [ ] Broadcast to all room members
- [ ] Send `battle:your_turn` only to controlling player
- [ ] Implement turn timeout with warnings
- [ ] Handle reconnection with state sync
- [ ] Track player connection state

### 10.2 Client Implementation Checklist

- [ ] Join battle room on battle start
- [ ] Track last received sequence
- [ ] Detect and handle sequence gaps
- [ ] Buffer out-of-order messages
- [ ] Request sync when needed
- [ ] Discard duplicate messages
- [ ] Implement ping/pong for keep-alive
- [ ] Handle all message types with appropriate UI updates

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
