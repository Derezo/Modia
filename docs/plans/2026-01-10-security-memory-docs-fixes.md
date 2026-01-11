# Security, Memory Leak, and Documentation Fixes

## Overview

This design addresses three categories of issues identified in the code review:
1. Missing rate limiting on battle actions and WebSocket messages
2. Event listener memory leaks in Game.js and InputHandler.js
3. Documentation discrepancies between GAME_DESIGN.md and constants.js

## 1. Battle Rate Limiting

### New File: `api/src/middleware/battleRateLimiter.js`

Following the established pattern from `marketplaceRateLimiter.js`.

### Limits

| Endpoint | Limit | Rationale |
|----------|-------|-----------|
| `POST /action` | 20/min | Most critical - prevents action spam |
| `POST /start` | 10/min | Prevents battle creation spam |
| `GET /current` | 30/min | Read-only, more lenient |
| `GET /preview/:nodeId` | 30/min | Read-only, more lenient |
| `GET /:battleId/rejoin` | 10/min | Reconnection attempts |
| `GET /rewards/:battleId` | 20/min | Post-battle queries |

### Implementation

```javascript
import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV === 'development';

const createLimiter = (windowMs, maxRequests, message) => {
  return rateLimit({
    windowMs,
    max: isTest ? 0 : (isDev ? maxRequests * 5 : maxRequests),
    skip: () => isTest,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

export const actionLimiter = createLimiter(60000, 20, 'Too many battle actions.');
export const startLimiter = createLimiter(60000, 10, 'Too many battle starts.');
export const readLimiter = createLimiter(60000, 30, 'Too many requests.');
export const rejoinLimiter = createLimiter(60000, 10, 'Too many rejoin attempts.');
export const rewardsLimiter = createLimiter(60000, 20, 'Too many reward requests.');
```

### Route Integration

Apply limiters in `api/src/routes/battle.js`:
- `router.post('/action', authenticate, actionLimiter, ...)`
- `router.post('/start', authenticate, startLimiter, ...)`
- etc.

---

## 2. WebSocket Rate Limiting

### Approach

In-memory sliding window rate limiter directly in `websocket/index.js`.

### Limits

| Category | Message Types | Limit | Window |
|----------|---------------|-------|--------|
| **Global** | All messages | 100 | 5 min |
| **Chat** | `chat_message`, `private_message` | 30 | 1 min |
| **Reactions** | `add_reaction`, `remove_reaction` | 20 | 1 min |
| **Typing** | `typing_indicator` | 60 | 1 min |
| **Room joins** | `join_room`, `join_battle`, `join_node` | 30 | 1 min |

### Implementation

```javascript
// Rate limit configuration
const WS_RATE_LIMITS = {
  global: { limit: 100, windowMs: 5 * 60 * 1000 },
  chat: { limit: 30, windowMs: 60 * 1000 },
  reactions: { limit: 20, windowMs: 60 * 1000 },
  typing: { limit: 60, windowMs: 60 * 1000 },
  roomJoins: { limit: 30, windowMs: 60 * 1000 }
};

// Message type to category mapping
const MESSAGE_CATEGORIES = {
  chat_message: 'chat',
  private_message: 'chat',
  add_reaction: 'reactions',
  remove_reaction: 'reactions',
  typing_indicator: 'typing',
  join_room: 'roomJoins',
  join_battle: 'roomJoins',
  join_node: 'roomJoins'
};

// Per-user rate tracking: userId -> { global: [timestamps], chat: [timestamps], ... }
const userRateLimits = new Map();

function checkRateLimit(userId, messageType) {
  const now = Date.now();

  if (!userRateLimits.has(userId)) {
    userRateLimits.set(userId, { global: [], chat: [], reactions: [], typing: [], roomJoins: [] });
  }

  const userLimits = userRateLimits.get(userId);
  const category = MESSAGE_CATEGORIES[messageType];

  // Check global limit
  const globalConfig = WS_RATE_LIMITS.global;
  userLimits.global = userLimits.global.filter(t => now - t < globalConfig.windowMs);
  if (userLimits.global.length >= globalConfig.limit) {
    return { limited: true, category: 'global', retryAfter: /* calculate */ };
  }
  userLimits.global.push(now);

  // Check category limit if applicable
  if (category && WS_RATE_LIMITS[category]) {
    const catConfig = WS_RATE_LIMITS[category];
    userLimits[category] = userLimits[category].filter(t => now - t < catConfig.windowMs);
    if (userLimits[category].length >= catConfig.limit) {
      return { limited: true, category, retryAfter: /* calculate */ };
    }
    userLimits[category].push(now);
  }

  return { limited: false };
}

function cleanupUserRateLimits(userId) {
  userRateLimits.delete(userId);
}
```

### Rejection Response

```json
{
  "type": "rate_limited",
  "payload": {
    "message": "Too many messages. Please slow down.",
    "category": "chat",
    "retryAfter": 5000
  }
}
```

---

## 3. Memory Leak Fixes

### Game.js

Store bound handler references and add cleanup:

```javascript
constructor() {
  // ... existing code ...
  this._boundResize = null;
  this._boundKeyHandler = null;
}

async init() {
  // ... existing code ...

  // Store bound references for cleanup
  this._boundResize = () => this.resize();
  this._boundKeyHandler = (e) => { /* ESC logic */ };

  window.addEventListener('resize', this._boundResize);
  // Move ESC handler setup here with stored reference
}

destroy() {
  this.running = false;

  if (this._boundResize) {
    window.removeEventListener('resize', this._boundResize);
  }
  if (this._boundKeyHandler) {
    window.removeEventListener('keydown', this._boundKeyHandler);
  }

  this.input?.destroy();
  this.destroyNotificationSystem();
}
```

### InputHandler.js

Store keyboard handler references (canvas listeners auto-cleanup with DOM):

```javascript
constructor(canvas) {
  // ... existing code ...
  this._boundKeyDown = null;
  this._boundKeyUp = null;

  this.setupMouseEvents();
  this.setupTouchEvents();
  this.setupKeyboardEvents();
}

setupKeyboardEvents() {
  this._boundKeyDown = (e) => {
    if (!this.keys.has(e.code)) {
      this.keysPressed.add(e.code);
    }
    this.keys.add(e.code);
  };

  this._boundKeyUp = (e) => {
    this.keys.delete(e.code);
  };

  window.addEventListener('keydown', this._boundKeyDown);
  window.addEventListener('keyup', this._boundKeyUp);
}

destroy() {
  if (this._boundKeyDown) {
    window.removeEventListener('keydown', this._boundKeyDown);
  }
  if (this._boundKeyUp) {
    window.removeEventListener('keyup', this._boundKeyUp);
  }
}
```

---

## 4. Documentation Sync

### GAME_DESIGN.md Updates

**Principle:** Code is source of truth.

| Section | Current (Wrong) | Corrected |
|---------|-----------------|-----------|
| Human Trait (2.1) | "+10 MDEF, +10 MATK, -10% Max MP" | "+10% XP bonus" |
| XP Formula (2.4) | `100 x N^2.2` | `100 x N^1.8` |
| Level thresholds table | Based on 2.2 exponent | Recalculate with 1.8 |
| Crit chance (2.3) | "max 50%" | Remove cap (no cap in code) |

### Recalculated Level Thresholds

Using `Math.floor(100 * Math.pow(level, 1.8))`:

| Level | Total XP Required |
|-------|-------------------|
| 1 | 100 |
| 5 | 1,493 |
| 10 | 6,310 |
| 25 | 53,183 |
| 50 | 189,148 |
| 100 | 398,107 |
| 150 | 718,561 |
| 200 | 1,096,478 |
| 256 | 1,584,893 |

### Roadmap Addition

Add to Post-Launch/Long-term Vision:
- Bot detection algorithm for WebSocket abuse patterns

---

## Implementation Order

1. Create `battleRateLimiter.js` and apply to routes
2. Add WebSocket rate limiting to `websocket/index.js`
3. Fix memory leaks in `Game.js` and `InputHandler.js`
4. Update `GAME_DESIGN.md` documentation
5. Update `DEVELOPMENT_ROADMAP.md` with completion status and future item

## Files Modified

- `api/src/middleware/battleRateLimiter.js` (new)
- `api/src/routes/battle.js`
- `api/src/websocket/index.js`
- `frontend/src/core/Game.js`
- `frontend/src/core/InputHandler.js`
- `docs/GAME_DESIGN.md`
- `docs/DEVELOPMENT_ROADMAP.md`
