# Activity Nodes - World Map Interactive Locations

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.1 |
| Last Updated | July 2026 |
| Status | Complete |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Fishing Spots](#2-fishing-spots)
3. [Ruins Puzzles](#3-ruins-puzzles)
4. [Merchant Caravan](#4-merchant-caravan)
5. [Watchtower](#5-watchtower)
6. [Terminator Nodes](#6-terminator-nodes)
   - 6.1 [Chest Nodes](#61-chest-nodes)
   - 6.2 [Shrine Nodes](#62-shrine-nodes)
   - 6.3 [Discovery Nodes](#63-discovery-nodes)
7. [Related Documents](#7-related-documents)

---

## 1. Overview

Activity nodes are special world map locations that provide non-combat gameplay activities. Each activity type offers unique mechanics, rewards, and progression systems.

### Node Type Summary

| Node Type | Activity | Rewards | Repeatable |
|-----------|----------|---------|------------|
| `fishing_spot` | Auto-fishing with Big One events | Gold (via fish sales) | Yes (per session) |
| `ruins` | Sliding tile puzzles | Gold (tier-based) | No (one-time) |
| `merchant_caravan` | Exclusive item shop | Rare items | Yes (48-hour refresh) |
| `watchtower` | Fog reveal | Map exploration | Yes (free) |
| `chest` | Treasure claim | Gold + items | No (one-time) |
| `shrine` | Temporary buff | Stat/combat buff | Yes (6-hour cooldown) |
| `discovery` | Lore unlock | Lore entries | No (one-time) |

---

## 2. Fishing Spots

Fishing provides an idle/passive gold-earning activity at `fishing_spot` nodes.

### 2.1 Session Mechanics

| Parameter | Value | Notes |
|-----------|-------|-------|
| Session Duration | 30 minutes max | Auto-expires |
| Catch Interval | 20-45 seconds | Random per catch |
| Catch Cooldown | 15 seconds | Minimum between catches |
| Big One Chance | 20% per catch | Triggers QTE event |
| Big One Window | 5 seconds | Time to react |
| Big One Bonus | 2x value | If successfully caught |

### 2.2 Fish Rarity Distribution

| Rarity | Catch Chance | Example Fish | Base Value |
|--------|--------------|--------------|------------|
| Common | 50% | Bass, Carp, Trout | 5-8 gold |
| Uncommon | 30% | Salmon, Pike, Eel | 20-28 gold |
| Rare | 15% | Golden Koi, Moonfish | 75-90 gold |
| Epic | 4% | Sea Dragon, Ancient Carp | 300-350 gold |
| Legendary | 1% | Leviathan Scale | 1,000 gold |

### 2.3 Fish Types (15 Total)

**Common (5 types):**
- Bass, Carp, Trout, Perch, Bream

**Uncommon (4 types):**
- Salmon, Pike, Catfish, Eel

**Rare (3 types):**
- Golden Koi, Electric Eel, Moonfish

**Epic (2 types):**
- Sea Dragon, Ancient Carp

**Legendary (1 type):**
- Leviathan Scale

### 2.4 Value Calculation

```
Fish Value = baseValue * sizeMultiplier * (isBigOne ? 2.0 : 1.0)
```

- `sizeMultiplier`: 0.8 to 1.5 (random per catch)
- Big One fish are guaranteed rare+ rarity with 1.3-1.7 size multiplier

### 2.5 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fishing/status` | GET | Restore the user's active session |
| `/api/fishing/:nodeId/start` | POST | Start fishing session |
| `/api/fishing/:nodeId/catch` | POST | Register a catch |
| `/api/fishing/:nodeId/big-one` | POST | Claim Big One |
| `/api/fishing/:nodeId/end` | POST | End session, collect rewards |
| `/api/fishing/:nodeId/status` | GET | Get session status |

---

## 3. Ruins Puzzles

Ruins nodes contain sliding tile puzzles that reward gold upon completion. Each ruins can only be solved once per player.

### 3.1 Puzzle Tiers

| Tier | Grid Size | Minimum Moves | Par Moves | Gold Range |
|------|-----------|---------------|-----------|------------|
| 1 | 3x3 | 8 | 15 | 50-100 |
| 2 | 4x4 | 15 | 30 | 150-300 |
| 3 | 5x5 | 30 | 50 | 400-800 |

### 3.2 Par Bonus

Completing a puzzle at or under par moves awards a **+25% gold bonus**.

Example: Tier 2 puzzle solved in 28 moves (under par of 30)
- Base reward: 225 gold
- With par bonus: 281 gold (225 * 1.25)

### 3.3 Regional Themes

Puzzle images are themed by the region's dominant race:

| Region Race | Theme Name | Description |
|-------------|------------|-------------|
| Human | Royal Crest | The ancient seal of the kingdom |
| Elf | Tree of Life | Sacred symbol of the forest realm |
| Dwarf | Forge Rune | Ancient dwarven crafting sigil |
| Orc | War Banner | Symbol of orcish might |
| Vampire | Blood Moon | Dark emblem of the night |

### 3.4 Puzzle Mechanics

- Classic 15-puzzle (sliding tiles) mechanics
- Puzzles are generated with guaranteed solvability
- Deterministic generation from the node's persisted `local_seed`, with separate
  versioned puzzle and reward streams
- World difficulty maps to ruins tier as 1 → 1, 2 → 2, and 3-5 → 3
- Preview and solve both require normal character authorization, progression
  access, and physical presence at the ruins
- No time limit; the server replays the submitted legal move sequence and
  calculates the move count

### 3.5 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ruins/:nodeId/puzzle` | GET | Get puzzle config and state |
| `/api/ruins/:nodeId/solve` | POST | Submit a replayable legal move sequence |
| `/api/ruins/completions` | GET | List all completed ruins |

---

## 4. Merchant Caravan

Traveling merchant shops offering exclusive items not found in regular shops.

### 4.1 Refresh Mechanics

| Parameter | Value |
|-----------|-------|
| Refresh Interval | 48 hours |
| Price Modifier | 1.15x base price (15% premium) |
| Stock per Item | 1-5 units (seeded random) |
| Item Selection | 70-90% of available items |

### 4.2 Item Categories (23 Items)

**Rare Consumables (5 items):**
- Mega-Potion (150 HP) - 150g
- Full Restore (Full HP + cure all) - 300g
- Mega-Ether (100 MP) - 200g
- Supreme Elixir (200 HP + 100 MP) - 400g
- Revival Herb (Revive 50% HP) - 350g

**Mystery Boxes (2 items):**
- Mystery Box (random rare) - 500g
- Premium Mystery Box (rare+ guaranteed) - 1,000g

**Crafting Materials (6 items):**
- Dragon Scale - 250g
- Moon Ore - 200g
- Phoenix Ash - 400g
- Void Crystal - 450g
- Ancient Wood - 180g
- Starlight Essence - 320g

**Regional Specialties (5 items, 1 per region):**
- Knight's Crest (Human) - Accessory, +3 STR/+2 VIT
- Sylvan Amulet (Elf) - Accessory, +4 INT/+2 AGI
- Runeforged Gauntlet (Dwarf) - Weapon, +5 STR
- Warchief's Trophy (Orc) - Accessory, +4 STR/+15% crit damage
- Bloodstone Pendant (Vampire) - Accessory, +3% lifesteal

### 4.3 Stock Tracking

- Stock is tracked per-caravan, per-item
- Purchases are recorded to prevent over-buying
- Stock resets on 48-hour refresh
- Advisory locks prevent race conditions on purchase

### 4.4 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/shop/caravan/:nodeId` | GET | Get caravan inventory |
| `/api/shop/caravan/:nodeId/buy` | POST | Purchase item |

---

## 5. Watchtower

Watchtowers provide extended vision to reveal undiscovered nodes on the world map.

### 5.1 Reveal Mechanics

| Parameter | Value | Notes |
|-----------|-------|-------|
| Base Reveal Radius | 1,500 pixels | ~50 worldgen units |
| Radius Multiplier | 2x (default) | Stored per-node |
| Total Reveal Diameter | 6,000 pixels | Standard watchtower |
| Cost | Free | No gold or stamina cost |
| Cooldown | None | Can view anytime |

### 5.2 Reveal Behavior

- Returns all nodes within circular radius from watchtower position
- Includes node names for all revealed nodes (even undiscovered)
- Shows connections between revealed nodes
- Does not permanently discover nodes (just reveals for viewing)
- Uses spatial query with bounding box optimization

### 5.3 Revealed Data

For each node in range:
- Node ID, position, type, name
- Region information
- Difficulty tier
- Distance from watchtower (in pixels)
- Whether already discovered by player

### 5.4 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/world/watchtower-view/:nodeId` | GET | Get revealed nodes |

---

## 6. Terminator Nodes

“Terminator” is the persistence-compatible name for chest, shrine, and discovery
reward sites on peripheral routes. Most are degree-2 sites that preserve route
flow; a configurable minority (targeting about 15%) are true degree-1 dead
ends. A degree-2 battle node is converted only when blocking-aware analysis
proves that the change does not reduce any required source-to-progression-anchor
combat-gate count or create an opening bypass.

### 6.1 Chest Nodes

One-time treasure locations with distance-scaled rewards.

#### Reward Scaling

```
Base Gold = 100 + (distance_from_center * 15)
Variance = baseGold * 0.2
Final Gold = baseGold +/- variance
```

| Distance | Base Gold | Range |
|----------|-----------|-------|
| 5 | 175 | 140-210 |
| 10 | 250 | 200-300 |
| 20 | 400 | 320-480 |
| 30 | 550 | 440-660 |

#### Mechanics
- One claim per user per chest
- User must be physically at the node
- Safe retries return the existing claim without awarding it again
- Gold awarded to user account
- Item drops based on distance tier (distance-scaled rewards including items)

#### API Endpoint
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/world/nodes/:id/claim-chest` | POST | Claim chest rewards |

### 6.2 Shrine Nodes

Provide temporary buffs with 6-hour cooldown between uses.

#### World Map Interaction

- The player must travel to the shrine before activating it.
- The current-node action menu presents **Receive Blessing** as the primary
  action.
- Activating the shrine immediately identifies the blessing and its effect.
  Zodiac activations also report any newly collected crystal.
- After activation, the action remains visible but disabled with a live
  cooldown countdown. It becomes available again when the 6-hour cooldown
  expires.
- Shrine activation, cooldown state, and active-buff timing are private to each
  user. Reloading the map restores the authoritative state from the server.

#### Standard Shrine Buffs

| Buff Type | Name | Effect | Duration |
|-----------|------|--------|----------|
| `stamina_regen` | Pilgrim's Rest | +50% stamina regen | 4 hours |
| `exp_bonus` | Scholar's Insight | +10% battle XP | 4 hours |
| `gold_bonus` | Merchant's Fortune | +15% battle gold | 4 hours |

These effects are applied by the server: stamina recovery accounts for the
portion of each regeneration window covered by Pilgrim's Rest, and completed
battle rewards include the active XP and gold modifiers.

#### Zodiac Shrine Buffs (12 Signs)

Zodiac shrines provide unique signature abilities and permanent crystal
collectibles. Active signature abilities are loaded into every battle during
the four-hour blessing window and can each trigger once per battle across the
owning party. A new battle receives a fresh use while the blessing remains
active. A signature is selected from the battle action controls on the
blessing owner's active-character turn. It is a free action, so it does not
consume that turn's movement or normal act allowance.

| Sign | Ability Name | Effect | Element |
|------|--------------|--------|---------|
| Aries | Ram's Charge | Next basic attack +25 percentage points crit chance | Fire |
| Taurus | Unmovable | Immune to push/pull effects | Earth |
| Gemini | Twin Strike | Next basic attack hits twice at 60% damage | Air |
| Cancer | Moonshield | Block next instance of damage | Water |
| Leo | Roar | Adjacent enemies lose 30 CT | Fire |
| Virgo | Purify | Remove 1 debuff from self | Earth |
| Libra | Balance | Next basic attack heals for actual damage dealt | Air |
| Scorpio | Venom Sting | Apply 3% HP poison for 4 turns | Water |
| Sagittarius | Celestial Arrow | +2 range on next basic attack | Fire |
| Capricorn | Mountain's Endurance | +25% defense for 2 turns | Earth |
| Aquarius | Cascade | Heal self for 20% of max HP | Air |
| Pisces | Dreamwave | 50% chance to sleep target 1 turn | Water |

#### Zodiac Crystal Collection

First visit to each zodiac shrine awards a permanent crystal:

| Signs | Bonus Type | Value per Crystal | Maximum |
|-------|------------|-------------------|---------|
| Aries, Leo, Sagittarius | Physical Damage | +1% | +3% |
| Taurus, Virgo, Capricorn | Physical and Magical Defense | +1% | +3% |
| Gemini, Libra, Aquarius | Critical Chance | +1 percentage point | +3 points |
| Cancer, Scorpio, Pisces | Healing Received | +1% | +3% |

Crystal bonuses are account-wide, cumulative, and automatically applied to
player units when PvE, advancement, or Coliseum battle state is created. They
never apply to enemy units.

**Collection Completion Bonus:**

- Character title: "Celestial Wanderer" (granted without replacing the
  currently displayed title)
- +5% HP, MP, core attributes, and equipment combat stats
- Two simultaneous active Zodiac blessings

Before completing the collection, a user can hold one active Zodiac blessing.
Activating a different Zodiac shrine at capacity expires the oldest Zodiac
blessing and reports which blessing faded. Completion raises the capacity to
two. Standard shrine buffs do not consume these slots.
Battle creation also enforces this entitlement newest-first, so legacy
over-cap visit records cannot grant extra signature abilities.

#### Shrine Cooldown

- 6 hours between visits to same shrine
- Cooldown is per-user, per-shrine
- Buff duration: 4 hours (can expire before cooldown ends)
- The API returns both the buff expiration and the later cooldown expiration so
  clients can present the two states independently.

#### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/world/nodes/:id/visit-shrine` | POST | Receive shrine buff |
| `/api/world/active-buffs` | GET | List active buffs |
| `/api/world/zodiac-collection` | GET | Get crystal collection progress |

### 6.3 Discovery Nodes

Lore unlock locations that reveal world history and secrets.

#### Mechanics
- One unlock per user per discovery
- Records lore_key for future lore system expansion
- Revisiting shows already-discovered message
- User must be physically at the node

#### Data Stored
- `lore_key`: Unique identifier for lore content
- `discovered_at`: Timestamp of first discovery
- `node_id`: Reference to discovery location

#### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/world/nodes/:id/discover` | POST | Unlock discovery |
| `/api/world/my-discoveries` | GET | List all discoveries |

---

## 7. Related Documents

- [GAME_DESIGN.md](GAME_DESIGN.md) - Core game mechanics overview
- [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) - Gold flow and shop systems
- [WORLDGEN_TECHNICAL_DEEP_DIVE.md](WORLDGEN_TECHNICAL_DEEP_DIVE.md) - Node generation algorithms
- [API_SPECIFICATION.md](API_SPECIFICATION.md) - Complete API reference
- [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) - Zodiac abilities in combat

---

## Implementation Notes

### Database Tables

| Table | Purpose |
|-------|---------|
| `user_fishing_sessions` | Resumable fishing state and exactly-once collection receipts |
| `user_fishing_catches` | Fish catch history |
| `user_ruins_completions` | Puzzle completion tracking |
| `user_caravan_transactions` | Caravan purchase records |
| `user_chest_claims` | Chest claim records |
| `user_shrine_visits` | Shrine buff tracking |
| `user_discoveries` | Lore discovery tracking |
| `user_zodiac_crystals` | Crystal collection progress |

### Rate Limiters

Activity nodes have specific rate limiters to prevent abuse:

| Activity | Limiter | Limit |
|----------|---------|-------|
| Ruins Solve | `ruinsSolveLimiter` | Economy tier |
| Chest Claim | `chestClaimLimiter` | Economy tier |
| Shrine Visit | `shrineLimiter` | Economy tier |
| Discovery | `discoveryLimiter` | Economy tier |
| Fishing | Standard | Per-session |
| Caravan | `shopBuyLimiter` | Economy tier |

### Daily Quest Integration

Activities track progress for daily/weekly quests:
- `puzzle_solves`: Ruins completions by tier
- `fish_catches`: Fish caught by rarity
- `gold_earned`: Gold from fishing, ruins, chests
- `visit_nodes`: Node travel (including activity nodes)
