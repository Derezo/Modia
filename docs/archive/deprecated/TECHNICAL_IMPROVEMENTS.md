# Modia Technical Improvements Document

> **ARCHIVED:** January 2026 - Roadmap Audit v8.0
>
> This document has been consolidated into `docs/ROADMAP_TECHNICAL.md`:
> - Critical security issues → Section 6.1 Known Issues (trust proxy, rate limiting)
> - Code quality items → Section 6.2 Refactoring Opportunities
> - Most security fixes marked as COMPLETE in this document
>
> The implementation status section (Section 6) shows Phases 1-4 as COMPLETE.
> Remaining items are tracked in the technical roadmap.
> Retained for historical reference and security audit trail.

---

This document contains comprehensive findings from a security audit and code quality analysis of the Modia codebase, along with implemented fixes and remaining recommendations.

## Table of Contents

1. [Security Vulnerabilities](#1-security-vulnerabilities)
2. [Server/Client Trust Boundaries](#2-serverclient-trust-boundaries)
3. [Economy & Marketplace Security](#3-economy--marketplace-security)
4. [WebSocket & Networking](#4-websocket--networking)
5. [Code Quality & Conventions](#5-code-quality--conventions)
6. [Implementation Status](#6-implementation-status)

---

## 1. Security Vulnerabilities

### 1.1 Critical Issues (FIXED)

#### JWT Secret Hardcoding
- **File:** `api/src/config/jwt.js:3-4`
- **Issue:** JWT secrets fell back to hardcoded defaults when env vars not set
- **Risk:** Authentication bypass if deployed without proper secrets
- **Fix:** Server now fails startup in production if JWT secrets are not set
- **Status:** FIXED

#### Rate Limiting Disabled by Default
- **File:** `api/src/middleware/rateLimiter.js:4-6`
- **Issue:** Rate limiting disabled when `NODE_ENV` not set
- **Risk:** DoS vulnerability, brute-force attacks
- **Fix:** Rate limiting now enabled by default, only disabled explicitly in test
- **Status:** FIXED

#### Battle Range Validation Missing
- **File:** `api/src/routes/battle.js`
- **Issue:** Client-provided movement, attack, and skill targets not validated
- **Risk:** Teleportation hacks, range exploits, wallhacks
- **Fix:** Added server-side validation for all action ranges
- **Status:** FIXED

### 1.2 High Priority Issues (FIXED)

#### Security Headers Missing
- **File:** `api/src/index.js`
- **Issue:** No helmet middleware for security headers
- **Risk:** XSS, clickjacking vulnerabilities
- **Fix:** Added helmet middleware with API-appropriate configuration
- **Status:** FIXED

#### WebSocket Room Authorization
- **File:** `api/src/websocket/index.js`
- **Issue:** Any authenticated user could join any room
- **Risk:** Data leakage, unauthorized access to battle/party data
- **Fix:** Added `validateRoomAccess()` function to verify room authorization
- **Status:** FIXED

### 1.3 Medium Priority Issues (Remaining)

#### Weak Password Policy
- **File:** `api/src/routes/auth.js:27-28`
- **Issue:** Only minimum length enforced (8 characters)
- **Risk:** Allows weak passwords like "12345678"
- **Recommendation:** Add complexity requirements:
```javascript
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
if (!passwordRegex.test(password)) {
  throw new AppError('Password must include uppercase, lowercase, number, and special character', 400);
}
```

#### Account Lockout Missing
- **Issue:** No account-specific lockout after failed login attempts
- **Risk:** Distributed brute-force attacks can bypass IP-based rate limiting
- **Recommendation:** Track failed attempts per account, implement temporary lockouts

#### CSRF Protection
- **Issue:** No CSRF tokens for state-changing operations
- **Risk:** Cross-site request forgery for logged-in users
- **Recommendation:** Implement CSRF tokens for POST/PUT/DELETE operations

### 1.4 Low Priority Issues

#### World Seed Exposed
- **File:** `api/src/routes/world.js:10-13`
- **Issue:** World seed publicly accessible without auth
- **Impact:** Minor information disclosure
- **Recommendation:** Require authentication or remove endpoint

---

## 2. Server/Client Trust Boundaries

### 2.1 Battle System (FIXED)

#### Movement Range Validation
- **Issue:** Client determined movement range, server just accepted target tile
- **Fix:** Server now validates against `CLASS_MOVEMENT` constants
- **Location:** `api/src/routes/battle.js:108-131`

#### Attack Range Validation
- **Issue:** No server-side attack range check
- **Fix:** Server now validates attack distance (default range: 1)
- **Location:** `api/src/routes/battle.js:153-165`

#### Skill Range Validation
- **Issue:** Skills could target any tile regardless of skill range
- **Fix:** Server validates against `skill.range` property
- **Location:** `api/src/routes/battle.js:215-226`

### 2.2 Formation Position Validation (Recommended)

- **File:** `api/src/routes/battle.js:738-741`
- **Issue:** Client-provided formation positions not bounds-checked
- **Recommendation:** Add validation:
```javascript
const isValidPosition = (pos, mapWidth, mapHeight) => {
  return pos.tileX >= 0 && pos.tileX < mapWidth &&
         pos.tileY >= 0 && pos.tileY < mapHeight &&
         pos.tileY >= 12; // Player starting zone
};
```

### 2.3 Properly Server-Authoritative Systems

The following systems correctly use server as source of truth:
- Damage calculations (`battleService.js`)
- Gold/item transactions (shop, marketplace)
- Character stats calculation
- Turn order (CT system)
- XP and leveling

---

## 3. Economy & Marketplace Security

### 3.1 Critical Issues (FIXED)

#### Negative Quantity Exploit
- **Files:** `shop.js`, `marketplace.js`, `inventory.js`
- **Issue:** Math.min with negative quantities could add items/gold
- **Fix:** Added strict integer validation with `parseInt(..., 10)` and bounds checks
- **Status:** FIXED

#### Maximum Price Limit
- **File:** `api/src/routes/marketplace.js`
- **Issue:** No max price allowed extreme economic manipulation
- **Fix:** Added `MAX_PRICE = 999999999` constant and validation
- **Status:** FIXED

### 3.2 High Priority Issues (Partial Fix)

#### Race Conditions in Transactions
- **Shop buy/sell:** Verification outside transaction - NEEDS FULL FIX
- **Inventory discard:** Was missing transaction - FIXED with FOR UPDATE
- **Battle item consumption:** Needs FOR UPDATE lock

#### Gold Overflow Protection
- **Issue:** Integer overflow possible when adding gold near max value
- **Recommendation:**
```javascript
const MAX_GOLD = 2147483647; // INT max
const newGold = Math.min(user.gold + goldToAdd, MAX_GOLD);
```

### 3.3 Marketplace Best Practices (Implemented)

- Price validation (1 to MAX_PRICE)
- Quantity validation (1 to 9999)
- Total value overflow check
- Transaction wrapping with FOR UPDATE locks

---

## 4. WebSocket & Networking

### 4.1 Security Issues (FIXED)

#### Room Authorization
- **Issue:** Any user could join any room
- **Fix:** Added `validateRoomAccess()` function with database checks
- **Status:** FIXED

#### Rooms Verified:
- `battle:{id}` - User must be participant
- `party:{id}` - User must be member
- `node:{id}`, `tavern:{id}` - Character must be at location
- `global`, `marketplace`, `coliseum:*` - Allowed for all authenticated users

### 4.2 Remaining Issues

#### WebSocket Rate Limiting
- **Issue:** No per-connection message throttling
- **Risk:** Message flood DoS
- **Recommendation:** Implement per-connection rate limiting

#### Authentication Timeout
- **Issue:** Unauthenticated connections can exist indefinitely
- **Recommendation:** Add 10-second timeout, disconnect if no auth message

#### Connection Limits
- **Issue:** User can open multiple WebSocket connections
- **Recommendation:** Limit to 1 connection per user, close old on new auth

#### Reference Error in partyWebsocket.js
- **File:** `api/src/services/partyWebsocket.js:247-249`
- **Issue:** `rooms` variable used but not imported
- **Fix Required:** Import from websocket/index.js or restructure

### 4.3 Protocol Improvements (Recommended)

- Add message acknowledgments for critical actions
- Add reconnection state recovery
- Add reconnection jitter to prevent thundering herd
- Implement delta updates for battle state (reduce bandwidth)

---

## 5. Code Quality & Conventions

### 5.1 Architecture Issues

#### Large Files Need Splitting
- `api/src/routes/battle.js` - 400+ lines of business logic in routes
- `api/src/websocket/index.js` - 785 lines, single switch statement
- `api/src/routes/skills.js` - 268 lines of SKILL_TREES data in routes

**Recommendation:**
- Move `processAction()` to `battleService.js`
- Split websocket into handler modules
- Extract `SKILL_TREES` to `config/skillTrees.js`

#### Code Duplication
- Equipment stat calculation duplicated in `characters.js` and `battle.js`
- Inventory formatting duplicated in `inventory.js`

**Recommendation:** Create `characterService.js` for shared queries

### 5.2 Constants Consolidation

Two constants files have diverged:
- `shared/constants.js` (ES modules)
- `api/src/config/constants.js` (CommonJS)

**Recommendation:** Consolidate to single source in `shared/`

### 5.3 parseInt Radix

Many `parseInt()` calls missing radix parameter:
```javascript
// Bad
parseInt(value)

// Good
parseInt(value, 10)
```

**Files Affected:**
- `marketplaceService.js` - Multiple occurrences
- Various route files

### 5.4 Logging

- Inconsistent logging (mix of console.log/error)
- No structured logging for production

**Recommendation:** Implement winston or pino logger

### 5.5 Technical Debt TODOs

Found in codebase:
1. `BattleScene.js:1198` - "TODO: Implement audio system"
2. `WorldMapScene.js:374` - "TODO: Show invite modal"
3. `ColiseumScene.js:634` - "TODO: Transition to BattleScene with PvP battle data"
4. `coliseumService.js:180` - "TODO: Add skill-based matchmaking"

---

## 6. Implementation Status

### Phase 1: Critical Security (COMPLETE)
- [x] JWT secret handling
- [x] Rate limiting defaults
- [x] Battle range validation
- [x] Negative quantity validation
- [x] Maximum price limits
- [x] WebSocket room authorization

### Phase 2: High Priority (COMPLETE)
- [x] Security headers (helmet)
- [x] Inventory discard race condition
- [x] Shop race condition (verification in transaction)
- [x] Battle item consumption race condition
- [x] Gold overflow protection (MAX_GOLD = 2147483647, uses SQL LEAST())
- [x] WebSocket auth timeout (10 seconds)
- [x] WebSocket connection limits (1 per user)
- [x] partyWebsocket.js reference error

### Phase 3: Code Quality (COMPLETE)
- [x] Extract battle logic to service (battle.js reduced 54%, from 1233 to 561 lines)
- [x] Extract SKILL_TREES to config/skillTrees.js
- [x] Consolidate constants (shared/constants.js is now single source of truth)
- [x] Fix parseInt radix calls (100+ occurrences across 18 files)

### Phase 4: Game Mechanics (COMPLETE)
- [x] PvP battle creation bug (creates actual battle in database, joins WebSocket rooms)
- [x] Skill cooldown enforcement (server-side validation with per-unit tracking)

---

## Quick Reference: Security Checklist

When adding new features, verify:

- [ ] All user input validated server-side
- [ ] Quantities validated as positive integers
- [ ] Prices have upper bounds
- [ ] Ranges/distances validated server-side
- [ ] Database operations use FOR UPDATE where needed
- [ ] WebSocket rooms have authorization checks
- [ ] Rate limiting applied appropriately
- [ ] Error messages don't leak sensitive info
