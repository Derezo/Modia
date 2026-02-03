# Established Patterns

This document defines the canonical code patterns for Modia. The `debt-detector` subagent uses this as a reference to identify pattern drift and architecture conformance violations.

**Last Updated:** 2026-02-03

---

## 1. API Patterns

### Route Handler Structure

Route handlers call services; never place direct database queries in route files.

```javascript
// GOOD: Route delegates to service
router.post('/battle/action', authMiddleware, async (req, res, next) => {
  try {
    const result = await battleService.executeAction(req.character.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// BAD: Direct database query in route
router.post('/battle/action', authMiddleware, async (req, res, next) => {
  const result = await pool.query('SELECT * FROM battles WHERE id = $1', [req.body.battleId]);
  // ...processing in route
});
```

### Query Parameterization

All database queries MUST use parameterized syntax (`$1, $2`). String concatenation is forbidden.

```javascript
// GOOD: Parameterized query
await pool.query('SELECT * FROM users WHERE id = $1 AND status = $2', [userId, 'active']);

// BAD: String concatenation (SQL injection vulnerability)
await pool.query(`SELECT * FROM users WHERE id = ${userId}`);
await pool.query('SELECT * FROM users WHERE id = ' + userId);
```

### Error Response Format

All API errors follow this structure:

```javascript
// Standard error response
res.status(400).json({
  error: 'Human-readable error message',
  code: 'ERROR_CODE'  // Optional: machine-readable code
});

// With additional context (optional)
res.status(422).json({
  error: 'Validation failed',
  code: 'VALIDATION_ERROR',
  details: { field: 'reason' }
});
```

### Auth Middleware

All protected routes use the `authMiddleware` from `api/src/middleware/auth.js`:

```javascript
import { authMiddleware } from '../middleware/auth.js';

// Protected route
router.get('/characters', authMiddleware, async (req, res, next) => {
  // req.user and req.character available
});
```

### Rate Limiting

Use rate limiter factory for endpoint-specific limits:

```javascript
import { createRateLimiter } from '../middleware/rateLimiterFactory.js';

const actionLimiter = createRateLimiter('battle/action', {
  max: 30,
  windowMs: 60000
});

router.post('/action', authMiddleware, actionLimiter, handler);
```

---

## 2. Service Patterns

### Service Size and Structure

Services exceeding 500 lines MUST use the re-export wrapper pattern:

```javascript
// battleService.js (wrapper - stays small, ~50 lines)
export * from './battle/damageCalculations.js';
export * from './battle/statusEffects.js';
export * from './battle/rewards.js';
export { BattleService } from './battle/BattleService.js';
```

Directory structure:
```
services/
  battleService.js          # Re-export wrapper
  battle/
    damageCalculations.js   # Damage formulas (~200 lines)
    statusEffects.js        # Status effect logic (~300 lines)
    rewards.js              # XP/loot calculations (~150 lines)
    BattleService.js        # Main orchestration class
```

### Async Error Handling

Services propagate errors with context:

```javascript
// GOOD: Error propagation with context
async function createCharacter(userId, data) {
  try {
    const result = await pool.query(/* ... */);
    return result.rows[0];
  } catch (error) {
    // Add context, then throw
    error.context = { userId, characterName: data.name };
    throw error;
  }
}

// BAD: Swallowing errors
async function createCharacter(userId, data) {
  try {
    return await pool.query(/* ... */);
  } catch (error) {
    console.error(error);  // Logged but lost
    return null;           // Caller doesn't know it failed
  }
}
```

### Transaction Integrity

Multi-step operations use database transactions:

```javascript
// GOOD: Transaction for multi-table operation
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE gold SET amount = amount - $1', [cost]);
  await client.query('INSERT INTO inventory ...', [itemId]);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### JSDoc for Public Functions

All exported service functions have JSDoc:

```javascript
/**
 * Calculate damage for a physical attack.
 * @param {Object} attacker - The attacking unit with stats
 * @param {Object} defender - The defending unit with stats
 * @param {Object} skill - The skill being used
 * @returns {Object} Damage result with amount, isCritical, effectiveness
 */
export function calculatePhysicalDamage(attacker, defender, skill) {
  // ...
}
```

---

## 3. Frontend Patterns

### Scene Lifecycle

All scenes extend the base `Scene` class and implement the full lifecycle:

```javascript
import { Scene } from '../core/Scene.js';

export class MyScene extends Scene {
  enter() {
    // Setup: fetch data, add event listeners
    this.canvas.addEventListener('click', this.handleClick);
  }

  update(deltaTime) {
    // deltaTime is in MILLISECONDS
    const dt = deltaTime / 1000;  // Convert to seconds for physics
    this.position += this.velocity * dt;
  }

  render(ctx) {
    // Drawing logic
    ctx.save();
    // ... transforms and draws
    ctx.restore();
  }

  exit() {
    // CRITICAL: Clean up event listeners
    this.canvas.removeEventListener('click', this.handleClick);
  }
}
```

### Canvas State Management

Always save/restore canvas state around transformations:

```javascript
// GOOD: Balanced save/restore
render(ctx) {
  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.angle);
  ctx.drawImage(this.sprite, -w/2, -h/2);
  ctx.restore();  // Always matches save()
}

// BAD: Missing restore
render(ctx) {
  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.drawImage(this.sprite, 0, 0);
  // No restore - transforms accumulate!
}
```

### Event Listener Cleanup

Event listeners added in `enter()` MUST be removed in `exit()`:

```javascript
enter() {
  // Bind handlers to preserve `this` reference
  this.boundHandleClick = this.handleClick.bind(this);
  this.boundHandleKeydown = this.handleKeydown.bind(this);

  canvas.addEventListener('click', this.boundHandleClick);
  window.addEventListener('keydown', this.boundHandleKeydown);
}

exit() {
  // Remove all listeners
  canvas.removeEventListener('click', this.boundHandleClick);
  window.removeEventListener('keydown', this.boundHandleKeydown);
}
```

### DeltaTime Convention

`deltaTime` from the game loop is in **milliseconds**. Convert to seconds for physics:

```javascript
update(deltaTime) {
  // deltaTime is milliseconds (e.g., 16.67 for 60fps)
  const dt = deltaTime / 1000;  // Now in seconds

  // Use dt for physics calculations
  this.position.x += this.velocity.x * dt;
  this.position.y += this.velocity.y * dt;
}
```

### Canvas-to-Viewport Coordinate Conversion

When positioning DOM elements over canvas content:

```javascript
// Convert canvas coords to viewport coords
const rect = this.game.canvas.getBoundingClientRect();
const scale = this.game.scale;
const viewportX = rect.left + (canvasX * scale);
const viewportY = rect.top + (canvasY * scale);

// Position DOM element
element.style.left = `${viewportX}px`;
element.style.top = `${viewportY}px`;
```

---

## 4. Import Patterns

### Frontend: @shared Alias

Frontend code uses the Vite alias for shared imports:

```javascript
// frontend/src/scenes/BattleScene.js
import { SeededRandom, calculateStats } from '@shared/constants.js';
import { calculateDamage } from '@shared/battleMath.js';
```

### API: Relative Paths Only

API code MUST use relative paths. The `@shared` alias does NOT work in Node.js:

```javascript
// api/src/services/battleService.js
// GOOD: Relative path
import { SeededRandom } from '../../../shared/constants.js';
import { calculateDamage } from '../../../shared/battleMath.js';

// BAD: @shared alias (will fail at runtime)
import { SeededRandom } from '@shared/constants.js';
```

### No Circular Dependencies

Modules must not have circular import chains:

```javascript
// BAD: Circular dependency
// fileA.js imports from fileB.js
// fileB.js imports from fileA.js

// GOOD: Extract shared code to a third module
// shared.js - common utilities
// fileA.js imports from shared.js
// fileB.js imports from shared.js
```

### No Cross-Workspace Imports

Never import directly between workspaces:

```javascript
// BAD: Frontend importing from API
import { battleService } from '../../api/src/services/battleService.js';

// BAD: API importing from frontend
import { BattleScene } from '../../../frontend/src/scenes/BattleScene.js';
```

---

## 5. Database Patterns

### Migration File Naming

Migrations use sequential numbering:

```
api/src/migrations/
  001_initial_schema.sql
  002_add_inventory_table.sql
  003_add_guild_system.sql
```

### Schema Column Naming

- Use `snake_case` for column names
- Foreign keys end with `_id`
- Timestamps use `created_at`, `updated_at`
- Boolean columns start with `is_` or `has_`

```sql
CREATE TABLE characters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Foreign Key Cascades

Use cascades for cleanup of dependent data:

```sql
CREATE TABLE inventory_items (
  id SERIAL PRIMARY KEY,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  item_template_id INTEGER NOT NULL,
  quantity INTEGER DEFAULT 1
);
```

---

## 6. WebSocket Patterns

### Room-Based Subscriptions

All real-time features use room-based pub/sub:

```javascript
// Server: Join room
ws.send(JSON.stringify({
  type: 'join_room',
  room: `battle:${battleId}`
}));

// Server: Broadcast to room
wss.broadcast(`battle:${battleId}`, {
  type: 'turn_update',
  data: turnState
});
```

### Message Type Convention

WebSocket messages use `type` field with `snake_case`:

```javascript
// Client -> Server
{ type: 'battle_action', data: { ... } }
{ type: 'chat_message', data: { ... } }
{ type: 'join_room', room: 'battle:123' }

// Server -> Client
{ type: 'battle_state_update', data: { ... } }
{ type: 'turn_started', data: { ... } }
```

### Authentication on Connect

WebSocket connections authenticate immediately:

```javascript
ws.on('message', (data) => {
  const msg = JSON.parse(data);

  if (msg.type === 'auth') {
    const user = verifyToken(msg.token);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    ws.userId = user.id;
    ws.authenticated = true;
  }

  // Reject unauthenticated messages
  if (!ws.authenticated) {
    ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
    return;
  }
});
```

---

## 7. Testing Patterns

### Test File Naming

```
api/src/tests/
  unit/
    battleMath.test.js      # Unit tests for shared/battleMath.js
    statCalculation.test.js # Unit tests for stat functions
  integration/
    battle.integration.test.js
    auth.integration.test.js
  balance/
    damageFormulas.test.js
    economyCurves.test.js
```

### Test Structure

Use Node's built-in test runner with describe/test blocks:

```javascript
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestUser, cleanupTestUser } from './testHelper.js';

describe('Character Creation', () => {
  let user;

  beforeEach(async () => {
    user = await createTestUser();
  });

  afterEach(async () => {
    await cleanupTestUser(user.id);
  });

  test('creates character with valid data', async () => {
    const response = await request('/characters', {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}` },
      body: { name: 'Hero', race: 'human', class: 'warrior' }
    });

    assert.strictEqual(response.status, 201);
    assert.ok(response.body.id);
  });
});
```

### Test Isolation

Tests clean up after themselves using `createTestContext()`:

```javascript
const ctx = createTestContext();
const user1 = await ctx.createUser();
const char1 = await ctx.createCharacter(user1.accessToken);
// ... test logic ...
await ctx.cleanup();  // Automatic cleanup
```

---

## 8. Error Handling Patterns

### HTTP Error Codes

| Code | Use Case |
|------|----------|
| 400 | Bad request - malformed input |
| 401 | Unauthorized - missing/invalid auth |
| 403 | Forbidden - authenticated but not allowed |
| 404 | Not found - resource doesn't exist |
| 409 | Conflict - duplicate or state conflict |
| 422 | Unprocessable - valid syntax but invalid semantics |
| 429 | Too many requests - rate limited |
| 500 | Internal error - unexpected server error |

### Centralized Error Handler

Express error handler in `api/src/index.js`:

```javascript
app.use((err, req, res, next) => {
  console.error(err.stack);

  // Known error types
  if (err.code === 'VALIDATION_ERROR') {
    return res.status(422).json({ error: err.message, code: err.code });
  }

  // Default to 500
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});
```

---

## 9. Security Patterns

### Authentication Middleware

All protected routes MUST use the `authenticate` middleware:

```javascript
import { authenticate } from '../middleware/auth.js';

// GOOD: Protected route
router.get('/characters', authenticate, async (req, res) => {
  // req.user available with { id, username }
});

// BAD: Unprotected sensitive route
router.get('/characters', async (req, res) => {
  // No auth check!
});
```

### Ownership Verification

**CRITICAL:** Every query accessing user-owned data MUST verify ownership:

```javascript
// GOOD: Ownership verified via user_id from JWT
const { rows } = await pool.query(
  'SELECT * FROM characters WHERE id = $1 AND user_id = $2',
  [characterId, req.user.id]
);

// BAD: No ownership check - allows accessing any character
const { rows } = await pool.query(
  'SELECT * FROM characters WHERE id = $1',
  [characterId]
);

// BAD: Using userId from request body (can be forged)
const { userId, characterId } = req.body;
const { rows } = await pool.query(
  'SELECT * FROM characters WHERE id = $1 AND user_id = $2',
  [characterId, userId]  // Never trust client-provided userId!
);
```

### Input Validation

All user inputs MUST be validated before use:

```javascript
// GOOD: Validate numeric inputs
const characterId = parseInt(req.params.id, 10);
if (isNaN(characterId) || characterId <= 0) {
  return res.status(400).json({ error: 'Invalid character ID' });
}

const amount = parseInt(req.body.amount, 10);
if (isNaN(amount) || amount <= 0 || amount > 99999) {
  return res.status(400).json({ error: 'Invalid amount' });
}

// GOOD: Validate string inputs
const message = req.body.message?.trim().substring(0, 500);
if (!message) {
  return res.status(400).json({ error: 'Message required' });
}

// BAD: Using inputs without validation
const { amount, characterId } = req.body;  // Could be anything!
```

### WebSocket Handler Security

Every WebSocket message handler MUST check authentication first:

```javascript
// GOOD: Auth check at start of handler
function handleBattleAction(ws, payload) {
  const userId = wsUserMap.get(ws);
  if (!userId) {
    return;  // Silently reject unauthenticated messages
  }

  // Validate payload
  const actionId = parseInt(payload.actionId, 10);
  if (isNaN(actionId)) return;

  // Process action...
}

// BAD: No auth check
function handleBattleAction(ws, payload) {
  processAction(payload);  // Who is this from?
}
```

### JWT Token Validation

Always use `jwt.verify()`, never `jwt.decode()` alone:

```javascript
// GOOD: Verify token signature
import jwt from 'jsonwebtoken';

try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  // Token is valid and signed by us
} catch (error) {
  // Token invalid, expired, or forged
  return res.status(401).json({ error: 'Invalid token' });
}

// BAD: Decode without verify (anyone can forge tokens!)
const decoded = jwt.decode(token);  // NEVER do this for auth!
```

### Sensitive Data Handling

Never log or expose sensitive information:

```javascript
// GOOD: Log non-sensitive context
console.log('Login attempt:', { username: user.username, ip: req.ip });

// BAD: Logging sensitive data
console.log('Login:', { password, token, refreshToken });

// GOOD: Generic error to client
res.status(500).json({ error: 'An error occurred' });

// BAD: Exposing internals
res.status(500).json({ error: err.message, stack: err.stack });
```

### XSS Prevention (Frontend)

Never use innerHTML or document.write with user content:

```javascript
// GOOD: textContent is safe
element.textContent = userMessage;

// GOOD: DOM API is safe
const div = document.createElement('div');
div.textContent = userInput;
parent.appendChild(div);

// BAD: XSS vulnerability
element.innerHTML = userMessage;
document.write(userInput);
```

### Rate Limiting on Sensitive Endpoints

Sensitive endpoints MUST have rate limiting:

```javascript
import { createRateLimiter } from '../middleware/rateLimiterFactory.js';

// GOOD: Login rate limited
const loginLimiter = createRateLimiter('auth/login', {
  max: 5,
  windowMs: 60000  // 5 attempts per minute
});
router.post('/login', loginLimiter, loginHandler);

// GOOD: Password change rate limited
const passwordLimiter = createRateLimiter('auth/password', {
  max: 3,
  windowMs: 300000  // 3 attempts per 5 minutes
});
router.post('/password', authenticate, passwordLimiter, passwordHandler);
```

---

## Pattern Conformance Checklist

When reviewing code, verify:

**Architecture:**
- [ ] Routes delegate to services (no direct DB queries in routes)
- [ ] Services > 500 lines use re-export wrapper
- [ ] Frontend uses `@shared`, API uses relative paths
- [ ] No circular dependencies
- [ ] No cross-workspace imports

**Security (BLOCKING):**
- [ ] All queries parameterized (`$1, $2` syntax, no template literals)
- [ ] Protected routes use `authenticate` middleware
- [ ] Ownership verified via `user_id` from JWT (never from `req.body`)
- [ ] Numeric inputs validated with `parseInt()` + `isNaN()` check
- [ ] WebSocket handlers check `userId` before processing
- [ ] `jwt.verify()` used (never `jwt.decode()` alone)
- [ ] No `innerHTML` or `document.write` with user content
- [ ] Sensitive endpoints rate limited

**API:**
- [ ] Error responses follow `{ error, code? }` format
- [ ] WebSocket messages use `type` field
- [ ] Migrations numbered sequentially

**Frontend:**
- [ ] Scenes implement full lifecycle (`enter`, `update`, `render`, `exit`)
- [ ] Canvas `save()`/`restore()` balanced
- [ ] Event listeners cleaned in `exit()`
- [ ] `deltaTime` converted to seconds for physics

**Testing:**
- [ ] Tests clean up created data

**File Size:**
- [ ] Files under 3,500 lines (blocking threshold)
- [ ] Files over 1,500 lines have module summary comment
- [ ] Large services use re-export wrapper pattern

---

## 10. File Size Enforcement

File size limits prevent monolithic files that harm maintainability. Oversized files **block plan validation and commits**.

### Thresholds

| Lines | Level | Action |
|-------|-------|--------|
| 500 | Target | Ideal file size |
| 1000 | Notice | Note in review, continue |
| 1500 | Warning | Flag in report, requires module summary comment |
| 2500 | Warning | Strong warning, plan modularization |
| **3500** | **BLOCKING** | **Halt validation, require modularization** |

### Module Summary Requirements

Files exceeding 1500 lines MUST include a module summary comment at the top:

```javascript
/**
 * @module BattleScene
 * @description Orchestrates tactical turn-based combat with grid-based movement.
 *
 * Key responsibilities:
 * - Battle initialization and state management
 * - Turn order and action processing
 * - Unit rendering and animation coordination
 * - WebSocket event handling for multiplayer sync
 *
 * @see BattleGrid.js - Grid rendering and pathfinding
 * @see BattleUnit.js - Individual unit rendering
 * @see BattleUI.js - HUD and action menus
 */
```

### Reading Large Files

When working with files >2000 lines, use targeted reading:

1. **Read the module summary first** (first 50 lines)
2. **Use grep to find specific functions/sections**
3. **Read in chunks using offset/limit parameters**

### Exemptions

- `dist/`, `node_modules/`, `.min.js` files
- Test files (`*.test.js`, `*.spec.js`)
- Migration files (`*.sql`)
- Generated files (sprites, audio metadata)

### Modularization Patterns

**1. Re-export Wrapper Pattern**

Keep the main file as a thin coordinator that re-exports from modules:

```javascript
// battleService.js (wrapper - stays small)
export * from './battle/damageCalculations.js';
export * from './battle/statusEffects.js';
export * from './battle/rewards.js';
export { BattleService } from './battle/BattleService.js';
```

**2. Domain Module Directory**

Group related functionality into a directory with an index:

```
services/ai/
  index.js              # Public exports
  utilityAI.js          # Scoring logic
  lookahead.js          # Simulation
  actionGenerator.js    # Action enumeration
  stateEvaluator.js     # State analysis
```

**3. Scene Component Extraction** (frontend)

Extract rendering/logic into separate files:

```
scenes/
  BattleScene.js        # Orchestration only
battle/
  BattleGrid.js         # Grid rendering
  BattleUnit.js         # Unit rendering
  BattleUI.js           # HUD elements
  BattleAnimations.js   # Animation logic
```

**4. Data Manifest Pattern** (config/templates)

Split large data files by category:

```
audio-metadata/
  sfx/
    combat/
      weapons.json
      deaths.json
    manifest.json

ai-image-metadata/
  tiles/
  portraits/
  items/
  manifest.json
```

### Completed Modularizations

Notable refactorings (for reference):
- `BattleScene.js` → `BattleInputHandler.js`, `BattleAudioManager.js`
- `WorldMapScene.js` → `WorldMapPathSystem.js`, `WorldMapNodeRenderer.js`
- `marketplaceService.js` → `marketplace/` directory (6 modules)
- `coliseumService.js` → `coliseum/` directory (6 modules)
- `admin.js` → `admin/` directory (5 sub-routers)
- `websocket/index.js` → `rateLimiter.js`, `roomManager.js`, `messageRouter.js`, `messageHandlers.js`
- `SettingsScene.js` → `settings/` directory (3 modules)
- `world.js` → `world/` directory (4 sub-routers)
- `TavernScene.js` → `tavern/` directory (2 modules)
- `BattleUI.js` → `BattlePvPUI.js`, `BattleConfirmationUI.js`
