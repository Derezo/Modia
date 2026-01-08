# Modia - Battle Reconnection System

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.0 |
| Last Updated | January 2026 |
| System Type | WebSocket Reconnection with State Persistence |

---

## 1. Overview

### 1.1 Design Goals

The battle reconnection system ensures players can recover from network interruptions during combat without losing progress or unfairly impacting other participants.

- **Preserve Battle State**: Full battle state persisted across disconnections
- **Graceful Recovery**: Automatic reconnection with minimal disruption
- **Prevent Abuse**: Detect and penalize intentional disconnects
- **Fair Handling**: Consistent behavior regardless of game mode

### 1.2 System Components

```
+-----------------------------------------------------------------------------+
|                        Battle Reconnection System                            |
+-----------------------------------------------------------------------------+
|                                                                              |
|  +----------------+    +----------------+    +----------------+              |
|  | Disconnect     |    |   State        |    |  Reconnection  |              |
|  | Detector       |--->|   Persister    |--->|  Handler       |              |
|  +----------------+    +----------------+    +----------------+              |
|         |                     |                     |                        |
|         v                     v                     v                        |
|  +----------------+    +----------------+    +----------------+              |
|  | Grace Timer    |    |  PostgreSQL    |    |   State        |              |
|  | Manager        |    |   Database     |    |   Sync         |              |
|  +----------------+    +----------------+    +----------------+              |
|                                                                              |
+-----------------------------------------------------------------------------+
```

---

## 2. State Persistence Strategy

### 2.1 Persistence Timing

Battle state is persisted to the database after **every action** to ensure no progress is lost:

| Event | Persistence Action |
|-------|-------------------|
| Battle Start | Full state snapshot |
| Movement | Update unit positions, increment sequence |
| Attack/Skill | Update HP/MP, status effects, increment sequence |
| Item Use | Update inventory, effects, increment sequence |
| Turn End | Update CT values, active unit, increment sequence |
| Status Effect Tick | Update durations, remove expired |
| Unit Death | Update unit state, check battle end |

### 2.2 Persisted Fields

The `battle_state` JSONB column stores the complete battle snapshot:

```json
{
  "turn": 15,
  "sequence": 47,
  "phase": "awaiting_action",
  "activeUnitId": "char_1",
  "turnStartTime": 1704556800000,
  "turnTimeoutAt": 1704556860000,

  "units": [
    {
      "id": "char_1",
      "type": "player",
      "ownerId": 1,
      "name": "Hero",
      "class": "warrior",
      "hp": 180,
      "maxHp": 250,
      "mp": 45,
      "maxMp": 80,
      "ct": 72,
      "tileX": 3,
      "tileY": 5,
      "moveUsed": true,
      "actUsed": false,
      "statusEffects": [
        { "type": "attack_up", "duration": 2, "magnitude": 1.25 }
      ]
    }
  ],

  "terrain": {
    "seed": 123456,
    "width": 8,
    "height": 8
  },

  "actionLog": [
    {
      "sequence": 46,
      "turn": 15,
      "unitId": "char_1",
      "action": "move",
      "from": { "x": 2, "y": 5 },
      "to": { "x": 3, "y": 5 },
      "timestamp": 1704556795000
    }
  ],

  "playerStates": {
    "1": {
      "connected": true,
      "lastSeen": 1704556800000,
      "disconnectedAt": null,
      "consecutiveTimeouts": 0
    },
    "2": {
      "connected": false,
      "lastSeen": 1704556750000,
      "disconnectedAt": 1704556752000,
      "consecutiveTimeouts": 1
    }
  }
}
```

### 2.3 Database Update Pattern

```javascript
// Atomic state update after each action
async function persistBattleState(battleId, state) {
  await pool.query(`
    UPDATE battles
    SET
      battle_state = $1,
      updated_at = NOW()
    WHERE id = $2
  `, [JSON.stringify(state), battleId]);
}
```

### 2.4 Optional Redis Cache Layer

For reduced database load in high-traffic scenarios:

```
+-------------------------------------------------------------------+
|                     State Persistence Flow                         |
+-------------------------------------------------------------------+
|                                                                    |
|   Action Received                                                  |
|        |                                                           |
|        v                                                           |
|   +-------------+                                                  |
|   | Validate    |                                                  |
|   | Action      |                                                  |
|   +-------------+                                                  |
|        |                                                           |
|        v                                                           |
|   +-------------+    +-------------+                               |
|   | Update      |--->| Write to    | (async, best-effort)          |
|   | In-Memory   |    | Redis       |                               |
|   | State       |    +-------------+                               |
|   +-------------+                                                  |
|        |                                                           |
|        v                                                           |
|   +-------------+                                                  |
|   | Write to    | (sync, required)                                 |
|   | PostgreSQL  |                                                  |
|   +-------------+                                                  |
|        |                                                           |
|        v                                                           |
|   Broadcast to clients                                             |
|                                                                    |
+-------------------------------------------------------------------+
```

**Note**: PostgreSQL remains the source of truth. Redis serves as a fast-access cache for reconnecting players.

---

## 3. Disconnect Detection

### 3.1 Detection Methods

| Method | Trigger | Response Time |
|--------|---------|---------------|
| WebSocket `close` event | Connection terminated | Immediate |
| Ping timeout | No pong response in 30s | 30 seconds |
| Server heartbeat | No client activity in 60s | 60 seconds |
| Action timeout | No action during turn | Per-mode timeout |

### 3.2 WebSocket Close Handler

```javascript
// Server-side disconnect detection
ws.on('close', async (code, reason) => {
  const userId = ws.userId;
  const battleId = ws.battleId;

  if (battleId) {
    await handlePlayerDisconnect(battleId, userId, {
      code,
      reason: reason.toString(),
      timestamp: Date.now()
    });
  }
});
```

### 3.3 Heartbeat Protocol

```
+-------------------------------------------------------------------+
|                      Heartbeat Protocol                            |
+-------------------------------------------------------------------+
|                                                                    |
|   Server                              Client                       |
|      |                                   |                         |
|      |-------- ping (every 15s) -------->|                         |
|      |                                   |                         |
|      |<------- pong (immediate) ---------|                         |
|      |                                   |                         |
|      |                                   |                         |
|      |-------- ping (15s later) -------->|                         |
|      |                                   |                         |
|      |          (no response)            |                         |
|      |                                   |                         |
|      |-------- ping (30s total) -------->|                         |
|      |                                   |                         |
|      |          (no response)            |                         |
|      |                                   |                         |
|   Mark as disconnected (30s timeout)     X                         |
|                                                                    |
+-------------------------------------------------------------------+
```

### 3.4 Disconnect Broadcast

When a player disconnects, other participants are immediately notified:

```json
{
  "type": "battle:player_disconnected",
  "payload": {
    "playerId": 2,
    "playerName": "Rival",
    "disconnectedAt": 1704556752000,
    "gracePeriodEnds": 1704556782000,
    "affectedUnits": ["char_4", "char_5", "char_6"]
  }
}
```

---

## 4. Reconnection Flow

### 4.1 Flow Diagram

```
+-------------------------------------------------------------+
|                    RECONNECTION FLOW                         |
+-------------------------------------------------------------+
|                                                              |
|  Client Disconnected                                         |
|        |                                                     |
|        v                                                     |
|  +-------------+                                             |
|  | Server      | Broadcast: battle:player_disconnected       |
|  | Detects     | Start grace timer                           |
|  +-------------+                                             |
|        |                                                     |
|        v                                                     |
|  +-------------+                                             |
|  | If player's | Yes: Auto-skip their turns                  |
|  | turn?       | Continue with AI forfeit actions            |
|  +-------------+                                             |
|        |                                                     |
|        v                                                     |
|  +-------------+     +-------------------------------+       |
|  | Grace timer | --->| No reconnect: Forfeit battle  |       |
|  | expires?    |     | (PvP) or pause (PvE solo)     |       |
|  +-------------+     +-------------------------------+       |
|        |                                                     |
|        | Reconnect within grace                              |
|        v                                                     |
|  +-------------+                                             |
|  | GET /api/   | Authenticate, get current battle ID         |
|  | battle/     |                                             |
|  | rejoin      |                                             |
|  +-------------+                                             |
|        |                                                     |
|        v                                                     |
|  +-------------+                                             |
|  | Server      | Send: battle:state_sync (full state)        |
|  | Responds    | Send: battle:player_reconnected             |
|  |             | Resume normal turn flow                     |
|  +-------------+                                             |
|                                                              |
+-------------------------------------------------------------+
```

### 4.2 Reconnection Steps (Server)

1. **Authenticate**: Validate JWT token from reconnecting client
2. **Identify Battle**: Look up active battle for user
3. **Validate Grace Period**: Ensure reconnection is within allowed time
4. **Load State**: Retrieve current battle state from database
5. **Update Player State**: Mark player as connected
6. **Sync Client**: Send full state snapshot
7. **Notify Others**: Broadcast reconnection to other players
8. **Resume Flow**: Continue normal turn processing

### 4.3 Reconnection Steps (Client)

1. **Detect Disconnect**: WebSocket `close` event or timeout
2. **Show Reconnecting UI**: Display reconnection overlay
3. **Attempt Reconnect**: Use exponential backoff (see Section 10)
4. **Re-authenticate**: Send JWT on new WebSocket connection
5. **Request Rejoin**: Call `/api/battle/rejoin` endpoint
6. **Apply State**: Update local state from server response
7. **Resume Rendering**: Continue battle display

---

## 5. Rejoin Endpoint

### 5.1 Endpoint Specification

```
GET /api/battle/:battleId/rejoin
```

**Headers:** `Authorization: Bearer <token>`

### 5.2 Success Response (200 OK)

```json
{
  "battleId": 123,
  "canRejoin": true,
  "state": {
    "turn": 15,
    "sequence": 47,
    "phase": "awaiting_action",
    "activeUnitId": "char_1",
    "turnTimeRemaining": 45,
    "units": [...],
    "terrain": {...},
    "recentActions": [...]
  },
  "yourUnits": ["char_4", "char_5", "char_6"],
  "currentTurnUnit": "char_1",
  "isYourTurn": false,
  "gracePeriodRemaining": 15
}
```

### 5.3 Error Responses

| Status | Code | Message |
|--------|------|---------|
| 400 | `NOT_IN_BATTLE` | You are not in this battle |
| 400 | `GRACE_EXPIRED` | Reconnection grace period has expired |
| 400 | `BATTLE_ENDED` | This battle has already ended |
| 401 | `UNAUTHORIZED` | Invalid or expired token |
| 404 | `BATTLE_NOT_FOUND` | Battle does not exist |

### 5.4 Alternative: Auto-Rejoin on WebSocket Connect

For seamless reconnection, the server can auto-detect active battles:

```json
// Sent immediately after WebSocket auth_success
{
  "type": "battle:rejoin_available",
  "payload": {
    "battleId": 123,
    "gracePeriodRemaining": 15,
    "isYourTurn": false
  }
}

// Client responds
{
  "type": "battle:rejoin_accept",
  "payload": {
    "battleId": 123
  }
}

// Server sends full state sync
{
  "type": "battle:state_sync",
  "payload": { ... }
}
```

---

## 6. Turn Timeout Handling

### 6.1 Timeout Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Player Turn Timeout | 60 seconds | Time limit for player action |
| PvP Turn Timeout | 45 seconds | Shorter timeout for competitive play |
| Warning Threshold | 15 seconds | First warning broadcast |
| Urgent Warning | 5 seconds | Final warning broadcast |
| Disconnected Auto-Wait | Immediate | Skip turn instantly if disconnected |

### 6.2 Timeout Flow

```
+-------------------------------------------------------------------+
|                     Turn Timeout Flow                              |
+-------------------------------------------------------------------+
|                                                                    |
|   Turn Start (T=0)                                                 |
|        |                                                           |
|        v                                                           |
|   Player has 60 seconds                                            |
|        |                                                           |
|        |  T=50s: Warning broadcast                                 |
|        |  +--------------------------------+                       |
|        |->| battle:turn_warning            |                       |
|        |  | { secondsRemaining: 10 }       |                       |
|        |  +--------------------------------+                       |
|        |                                                           |
|        |  T=55s: Urgent warning                                    |
|        |  +--------------------------------+                       |
|        |->| battle:turn_warning            |                       |
|        |  | { secondsRemaining: 5, urgent }|                       |
|        |  +--------------------------------+                       |
|        |                                                           |
|        |  T=60s: Timeout                                           |
|        v                                                           |
|   +--------------------------------+                               |
|   | Auto-execute WAIT action       |                               |
|   | (forfeits remaining actions)   |                               |
|   +--------------------------------+                               |
|                                                                    |
+-------------------------------------------------------------------+
```

### 6.3 Disconnected Player Turn Handling

When a disconnected player's turn arrives:

```javascript
async function handleDisconnectedTurn(battle, unit) {
  const player = battle.state.playerStates[unit.ownerId];

  // Increment timeout counter
  player.consecutiveTimeouts++;

  // Log the auto-skip
  battle.state.actionLog.push({
    sequence: ++battle.state.sequence,
    turn: battle.state.turn,
    unitId: unit.id,
    action: 'auto_wait',
    reason: 'player_disconnected',
    timestamp: Date.now()
  });

  // Broadcast the skip
  broadcast(battle.id, {
    type: 'battle:action_result',
    payload: {
      unitId: unit.id,
      action: { type: 'wait', reason: 'disconnected' },
      result: { turnSkipped: true }
    }
  });

  // Check for forfeit threshold
  if (player.consecutiveTimeouts >= 3) {
    await handleForfeit(battle, unit.ownerId, 'consecutive_timeouts');
  }

  // End turn
  await endTurn(battle, unit);
}
```

### 6.4 Consecutive Timeout Forfeit

| Timeout Count | Consequence |
|---------------|-------------|
| 1 | Turn skipped, warning displayed |
| 2 | Turn skipped, final warning |
| 3+ | Automatic forfeit |

---

## 7. Player Notification System

### 7.1 Notification Messages

#### Player Disconnected

```json
{
  "type": "battle:player_disconnected",
  "payload": {
    "playerId": 2,
    "playerName": "Rival",
    "disconnectedAt": 1704556752000,
    "gracePeriodEnds": 1704556782000,
    "gracePeriodSeconds": 30,
    "affectedUnits": ["char_4", "char_5", "char_6"]
  }
}
```

#### Player Reconnected

```json
{
  "type": "battle:player_reconnected",
  "payload": {
    "playerId": 2,
    "playerName": "Rival",
    "reconnectedAt": 1704556770000,
    "disconnectionDuration": 18
  }
}
```

### 7.2 UI Indicators

| State | Visual Indicator |
|-------|------------------|
| Connected | Normal unit display |
| Disconnected | "(Disconnected)" label, grayed portrait |
| Reconnecting | Pulsing connection icon |
| Grace Expiring | Countdown timer overlay |

### 7.3 Battle Log Messages

Disconnection events appear in the battle log:

```
[Turn 15] Rival has disconnected. Grace period: 30 seconds.
[Turn 16] Rival's Archer skipped turn (disconnected).
[Turn 17] Rival has reconnected.
```

---

## 8. Mode-Specific Behavior

### 8.1 Behavior Matrix

| Mode | On Disconnect | Grace Period | On Timeout | Reconnect Behavior |
|------|---------------|--------------|------------|--------------------|
| PVE_SOLO | Pause battle | Unlimited | N/A | Resume immediately |
| PVE_COOP | Continue, skip turns | 60 seconds | Forfeit (player only) | Full state sync |
| PVP_DUEL | Continue, skip turns | 30 seconds | Forfeit | Full state sync |
| PVP_TEAM | Continue, skip turns | 30 seconds | Forfeit | Full state sync |
| PVP_FFA | Continue, skip turns | 30 seconds | Forfeit | Full state sync |

### 8.2 PVE Solo Mode

```
+-------------------------------------------------------------------+
|                    PVE Solo Disconnect                             |
+-------------------------------------------------------------------+
|                                                                    |
|   Player Disconnects                                               |
|        |                                                           |
|        v                                                           |
|   +-------------------+                                            |
|   | Pause Battle      | Battle timer stops                         |
|   | Update Status     | Set status = 'paused'                      |
|   | Persist State     | Save to database                           |
|   +-------------------+                                            |
|        |                                                           |
|        | (Unlimited time)                                          |
|        v                                                           |
|   +-------------------+                                            |
|   | Player Reconnects | At any time                                |
|   +-------------------+                                            |
|        |                                                           |
|        v                                                           |
|   +-------------------+                                            |
|   | Resume Battle     | Restore full state                         |
|   | Continue Turn     | From exact position                        |
|   +-------------------+                                            |
|                                                                    |
+-------------------------------------------------------------------+
```

### 8.3 PVE Cooperative Mode

- Other players continue while disconnected player's units auto-skip
- Grace period of 60 seconds before forfeit
- Forfeited player's units become AI-controlled until battle end
- Rewards reduced for disconnected player

### 8.4 PVP Modes

- All PvP modes use 30-second grace period
- Disconnected player's turns are auto-skipped (immediate wait)
- No AI takeover (units simply skip turns)
- Forfeit results in loss and rating penalty

---

## 9. Anti-Abuse Measures

### 9.1 Disconnect Pattern Detection

```javascript
const ABUSE_THRESHOLDS = {
  disconnectsPerHour: 3,      // Max disconnects per hour
  disconnectsPerDay: 10,      // Max disconnects per day
  consecutiveInBattle: 2,     // Max disconnects in same battle
  averageDisconnectTiming: 0.3 // Suspiciously timed (losing) disconnects
};

async function detectAbusiveDisconnect(userId, battleContext) {
  const history = await getDisconnectHistory(userId, { hours: 24 });

  // Check frequency
  const lastHour = history.filter(d => d.timestamp > Date.now() - 3600000);
  if (lastHour.length >= ABUSE_THRESHOLDS.disconnectsPerHour) {
    return { abusive: true, reason: 'frequency_exceeded' };
  }

  // Check suspicious timing (disconnecting when losing)
  const losingDisconnects = history.filter(d => d.wasLosing);
  const ratio = losingDisconnects.length / history.length;
  if (ratio > ABUSE_THRESHOLDS.averageDisconnectTiming && history.length > 5) {
    return { abusive: true, reason: 'suspicious_timing' };
  }

  return { abusive: false };
}
```

### 9.2 Penalty System

| Offense Level | Consequence |
|---------------|-------------|
| Warning | Notification displayed |
| Soft Penalty | Matchmaking queue delay (5 min) |
| Hard Penalty | Rating reduction (-25 points) |
| Temporary Ban | Cannot queue for PvP (1 hour) |
| Severe | Account review for extended ban |

### 9.3 Rating Penalties

```javascript
function calculateDisconnectPenalty(player, battle) {
  const baseRatingLoss = 25;

  // First offense: warning only
  if (player.recentDisconnects === 1) {
    return { ratingLoss: 0, warning: true };
  }

  // Repeated offenses: escalating penalties
  const multiplier = Math.min(player.recentDisconnects - 1, 3);
  const ratingLoss = baseRatingLoss * multiplier;

  // Additional penalty if battle was nearly won by opponent
  if (battle.opponentAdvantage > 0.7) {
    ratingLoss *= 1.5;
  }

  return { ratingLoss, warning: false };
}
```

### 9.4 Rehabilitation

| Good Behavior | Benefit |
|---------------|---------|
| 5 completed PvP battles | Reduce offense level by 1 |
| 24 hours no disconnects | Clear soft penalties |
| 7 days no disconnects | Clear hard penalties |

### 9.5 Minimum Completion Requirements

For ranked PvP:

- Must complete 10 unranked battles first
- Completion rate must be above 90%
- Cannot have active penalty status

---

## 10. Client Auto-Reconnect Logic

### 10.1 Reconnection Algorithm

```javascript
class BattleReconnector {
  constructor(websocket, battleId) {
    this.ws = websocket;
    this.battleId = battleId;
    this.reconnectAttempts = 0;
    this.maxAttempts = 5;
    this.backoffMs = [1000, 2000, 4000, 8000, 16000];
    this.isReconnecting = false;
  }

  async onDisconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;

    this.showReconnectingUI();

    while (this.reconnectAttempts < this.maxAttempts) {
      const delay = this.backoffMs[this.reconnectAttempts];

      this.updateUI({
        attempt: this.reconnectAttempts + 1,
        maxAttempts: this.maxAttempts,
        nextRetryIn: delay / 1000
      });

      await this.sleep(delay);

      try {
        await this.attemptReconnect();
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.hideReconnectingUI();
        return; // Success
      } catch (error) {
        this.reconnectAttempts++;
        console.warn(`Reconnect attempt ${this.reconnectAttempts} failed:`, error);
      }
    }

    // All attempts failed
    this.isReconnecting = false;
    this.showConnectionLostDialog();
  }

  async attemptReconnect() {
    // 1. Create new WebSocket connection
    const newWs = await this.createConnection();

    // 2. Authenticate
    await this.authenticate(newWs);

    // 3. Rejoin battle
    const response = await fetch(`/api/battle/${this.battleId}/rejoin`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });

    if (!response.ok) {
      throw new Error(`Rejoin failed: ${response.status}`);
    }

    const data = await response.json();

    // 4. Apply state
    this.applyBattleState(data.state);

    // 5. Update WebSocket reference
    this.ws = newWs;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 10.2 Reconnection UI States

```
+-------------------------------------------------------------------+
|                    Reconnection UI Flow                            |
+-------------------------------------------------------------------+
|                                                                    |
|   Disconnected                                                     |
|   +-----------------------------------------------------------+   |
|   |                    Connection Lost                         |   |
|   |                                                            |   |
|   |            [Spinner] Reconnecting...                       |   |
|   |            Attempt 1 of 5                                  |   |
|   |                                                            |   |
|   +-----------------------------------------------------------+   |
|                                                                    |
|   Retrying (with backoff)                                          |
|   +-----------------------------------------------------------+   |
|   |                    Connection Lost                         |   |
|   |                                                            |   |
|   |            [Spinner] Reconnecting...                       |   |
|   |            Attempt 3 of 5                                  |   |
|   |            Retrying in 4 seconds...                        |   |
|   |                                                            |   |
|   +-----------------------------------------------------------+   |
|                                                                    |
|   All Attempts Failed                                              |
|   +-----------------------------------------------------------+   |
|   |                    Connection Lost                         |   |
|   |                                                            |   |
|   |   Unable to reconnect to the battle.                       |   |
|   |   Your progress has been saved.                            |   |
|   |                                                            |   |
|   |   [Return to World Map]    [Try Again]                     |   |
|   |                                                            |   |
|   +-----------------------------------------------------------+   |
|                                                                    |
+-------------------------------------------------------------------+
```

### 10.3 Graceful Degradation

If reconnection fails but battle is still active:

1. Player can return to world map
2. PvE Solo: Battle remains paused, can resume later
3. PvE Coop: Units become AI-controlled
4. PvP: Automatic forfeit after grace period

---

## 11. Integration Points

### 11.1 Related Systems

| System | Integration |
|--------|-------------|
| BattleService | State persistence, turn handling |
| BattleWebsocket | Connection management, broadcasts |
| AuthService | Token validation for rejoin |
| PlayerService | Disconnect history, penalties |
| RatingService | PvP rating adjustments |

### 11.2 Database Tables

| Table | Usage |
|-------|-------|
| `battles` | Battle state storage |
| `user_disconnect_history` | Abuse detection |
| `user_penalties` | Active penalties tracking |
| `pvp_ratings` | Rating adjustments |

### 11.3 WebSocket Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `battle:player_disconnected` | Server -> Client | Notify of disconnect |
| `battle:player_reconnected` | Server -> Client | Notify of reconnect |
| `battle:state_sync` | Server -> Client | Full state for rejoin |
| `battle:rejoin_available` | Server -> Client | Auto-detect active battle |
| `battle:rejoin_accept` | Client -> Server | Accept rejoin offer |
| `battle:grace_warning` | Server -> Client | Grace period ending |

---

## 12. Related Documents

| Document | Description |
|----------|-------------|
| [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) | CT system, turn state machine |
| [BATTLE_MODES.md](BATTLE_MODES.md) | PvE/PvP mode configurations, grace periods |
| [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) | Visual feedback, animation timing |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle endpoints, WebSocket protocol |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas, battle_state structure |
| [GAME_DESIGN.md](GAME_DESIGN.md) | Combat formulas, battle modes |

---

## 13. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document: reconnection flow, state persistence, anti-abuse measures |
