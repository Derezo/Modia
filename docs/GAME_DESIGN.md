# Modia - Game Design Document

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 4.1 |
| Last Updated | January 2026 |
| Genre | Tactical RPG / MMORPG |

---

## Document Index

This document provides a high-level overview of Modia's game design. For detailed specifications, see the specialized documents below:

| Category | Document | Description |
|----------|----------|-------------|
| **Battle System** | [BATTLE_SYSTEM_INDEX.md](BATTLE_SYSTEM_INDEX.md) | Index of all battle documentation |
| | [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) | CT-based turn order, two-action system |
| | [BATTLE_MODES.md](BATTLE_MODES.md) | PvE/PvP mode configurations |
| | [BATTLE_MESSAGING_PROTOCOL.md](BATTLE_MESSAGING_PROTOCOL.md) | Hybrid HTTP/WebSocket protocol |
| | [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) | Visual feedback, animation timing |
| | [BATTLE_RECONNECTION.md](BATTLE_RECONNECTION.md) | State persistence, reconnection handling |
| **Character** | [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) | Formation, skills, guild advancement |
| | [SKILL_TREES.md](SKILL_TREES.md) | Skill definitions for 8 guilds |
| **Items & Economy** | [ITEM_SYSTEM.md](ITEM_SYSTEM.md) | Equipment, rarity, drop tables |
| | [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) | Shops, marketplace, gold flow |
| **Enemies** | [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) | Templates, AI archetypes, scaling |
| | [AI_SYSTEM.md](AI_SYSTEM.md) | Enemy AI behavior trees |
| **World** | [WORLDGEN_TECHNICAL_DEEP_DIVE.md](WORLDGEN_TECHNICAL_DEEP_DIVE.md) | 6-phase world generation algorithms |
| **Technical** | [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | System design, database schemas |
| | [API_SPECIFICATION.md](API_SPECIFICATION.md) | REST and WebSocket endpoints |

---

## 1. Game Overview

### 1.1 Concept Statement

Modia is a browser-based tactical RPG where players build a party of up to 12 characters, explore a procedurally generated world, and engage in chess-style turn-based combat. The game combines single-player progression with real-time multiplayer features including PvP battles, trading, and social interaction.

### 1.2 Core Pillars

1. **Tactical Depth** - Chess-style combat with positioning, classes, and abilities
2. **Character Progression** - Build and level a diverse party of characters
3. **Exploration** - Discover a shared procedural world from a central hub
4. **Social Interaction** - Trade, chat, compete on leaderboards, PvP in Coliseum

### 1.3 Target Experience

Players should feel:
- **Strategic** when positioning units in battle
- **Accomplished** when leveling characters and discovering new areas
- **Connected** when interacting with other players
- **Invested** in their party of characters

---

## 2. Character System

### 2.1 Races

Each race provides unique base statistics and a racial trait.

#### Human
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 100 | | VIT | 10 |
| MP | 50 | | LUK | 10 |
| STR | 10 | | | |
| INT | 10 | | **Trait** | +10% XP bonus |
| AGI | 10 | | | |

**Lore**: Versatile and adaptable, humans learn quickly from every encounter, gaining bonus experience from battles.

#### Elf
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 80 | | VIT | 6 |
| MP | 80 | | LUK | 10 |
| STR | 8 | | | |
| INT | 14 | | **Trait** | +5% MP Regen per turn |
| AGI | 12 | | | |

**Lore**: Ancient and wise, elves possess natural magical affinity and can regenerate mana during battle.

#### Dwarf
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 120 | | VIT | 16 |
| MP | 30 | | LUK | 8 |
| STR | 14 | | | |
| INT | 6 | | **Trait** | +15% Two-Handed Weapon Damage |
| AGI | 6 | | | |

**Lore**: Stout and resilient, dwarves are master craftsmen who excel with heavy two-handed weapons.

#### Vampire
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 90 | | VIT | 8 |
| MP | 60 | | LUK | 4 |
| STR | 12 | | | |
| INT | 12 | | **Trait** | 10% Lifesteal (no overkill) |
| AGI | 14 | | | |

**Lore**: Cursed immortals who sustain themselves by draining life from their foes. Heals for 10% of damage dealt, but cannot heal from overkill damage.

#### Orc
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 130 | | VIT | 14 |
| MP | 20 | | LUK | 8 |
| STR | 16 | | | |
| INT | 4 | | **Trait** | +25% Crit Damage (additive) |
| AGI | 8 | | | |

**Lore**: Brutal warriors who live for battle, orcs devastate foes with savage strikes. Critical hits deal 175% damage instead of 150%.

### 2.2 Classes

Each class determines stat growth per level, combat role, and available skills. All classes have base movement of 3 tiles, with bonuses available from equipment and passive abilities.

> **Note**: All skills must be unlocked by spending XP. Characters begin with access to Tier 1 skills in their base guild. See [SKILL_TREES.md](SKILL_TREES.md) for complete skill definitions.

#### Warrior
| Growth/Level | Value |
|--------------|-------|
| HP | +15 |
| MP | +3 |
| STR | +3 |
| INT | +1 |
| AGI | +1 |
| VIT | +2 |

| Attribute | Value |
|-----------|-------|
| Role | Tank / Melee DPS |
| Attack Range | 1 tile (melee) |

**Playstyle**: Warriors charge into the front lines, absorbing damage and dealing heavy physical attacks. Best paired with support characters.

**Skill Branches**: Offense, Defense, Utility (see [SKILL_TREES.md](SKILL_TREES.md))

#### Wizard
| Growth/Level | Value |
|--------------|-------|
| HP | +8 |
| MP | +12 |
| STR | +1 |
| INT | +4 |
| AGI | +1 |
| VIT | +1 |

| Attribute | Value |
|-----------|-------|
| Role | Ranged Magic DPS |
| Attack Range | 4 tiles |

**Playstyle**: Wizards stay in the back, unleashing powerful spells from a distance. Vulnerable if enemies get close.

**Skill Branches**: Fire Magic, Ice Magic, Lightning Magic (see [SKILL_TREES.md](SKILL_TREES.md))

#### Monk
| Growth/Level | Value |
|--------------|-------|
| HP | +10 |
| MP | +6 |
| STR | +2 |
| INT | +2 |
| AGI | +3 |
| VIT | +1 |

| Attribute | Value |
|-----------|-------|
| Role | Mobile Melee DPS |
| Attack Range | 1-2 tiles |

**Playstyle**: Monks are highly mobile strikers who can reach vulnerable targets quickly. Balance of physical and ki-based attacks.

**Skill Branches**: Martial Arts, Ki Mastery, Body Techniques (see [SKILL_TREES.md](SKILL_TREES.md))

#### Chemist
| Growth/Level | Value |
|--------------|-------|
| HP | +10 |
| MP | +8 |
| STR | +1 |
| INT | +2 |
| AGI | +2 |
| VIT | +2 |

| Attribute | Value |
|-----------|-------|
| Role | Support / Healer |
| Attack Range | 3 tiles (thrown) |

**Playstyle**: Chemists support the party with healing, buffs, and debuffs. Can also deal damage with thrown concoctions.

**Skill Branches**: Potion Craft, Acid Craft, Bomb Craft (see [SKILL_TREES.md](SKILL_TREES.md))

### 2.3 Stat Calculations

#### Derived Stats

| Stat | Formula |
|------|---------|
| Physical Attack | STR + (weapon bonus) |
| Magic Attack | INT + (weapon bonus) |
| Physical Defense | VIT x 0.5 |
| Magic Defense | INT x 0.25 |
| Critical Chance | LUK / 200 |
| Critical Damage | 150% (+ racial bonuses) |
| Evasion | AGI / 200 (max 25%) |
| Initiative | AGI + random(0-9) |

#### HP/MP at Level N

```
HP = base_HP + (class_HP_growth x (level - 1))
MP = base_MP + (class_MP_growth x (level - 1))
```

#### Example: Level 50 Human Warrior

| Stat | Calculation | Value |
|------|-------------|-------|
| HP | 100 + (15 x 49) | 835 |
| MP | 50 + (3 x 49) | 197 |
| STR | 10 + (3 x 49) | 157 |
| INT | 10 + (1 x 49) | 59 |
| AGI | 10 + (1 x 49) | 59 |
| VIT | 10 + (2 x 49) | 108 |
| LUK | 10 | 10 |

### 2.4 Experience and Leveling

#### XP Pool System

Characters earn XP from battles which is added to their **XP Pool**. This XP is then **spent** to learn and level up skills. As XP is spent, the character's level increases.

```
+-------------+     +-------------+     +-------------+
|   Battle    |---->|   XP Pool   |---->|   Skills    |
|   Victory   |     |  (Unspent)  |     |  (Learned)  |
+-------------+     +-------------+     +-------------+
                           |
                           v
                    +-------------+
                    |   Level Up  |
                    | (Based on   |
                    |  XP Spent)  |
                    +-------------+
```

#### Level Formula

Character level is determined by total XP spent:
```
XP Required for Level N = 100 x N^2.8
```

*Note: See [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) for detailed level thresholds and skill cost formulas.*

#### Level Thresholds

| Level | XP for Level | Approx. Cumulative |
|-------|--------------|-------------------|
| 1 | 100 | 100 |
| 5 | 1,493 | ~3,500 |
| 10 | 6,310 | ~25,000 |
| 25 | 31,623 | ~250,000 |
| 50 | 125,893 | ~1,700,000 |
| 100 | 398,107 | ~11,000,000 |
| 150 | 718,105 | ~31,000,000 |
| 200 | 1,096,478 | ~64,000,000 |
| 256 | 1,584,893 | MAX |

#### Level Up Effects

When a character's total XP spent crosses a level threshold:
1. All stats increase based on class growth rates
2. New skill tiers may become available in the skill tree
3. Higher-level skills can be unlocked

> **Note**: HP and MP are fully restored at the start of each battle, not on level up. See Section 4 for battle rules.

### 2.5 Party System

- Maximum **12 characters** per account
- **Battle Party**: Up to 5 characters for combat
- **Formation Screen**: Manage all 12 characters, select battle party
- Characters not in battle still exist at current node
- All party members travel together

#### Battle Deployment

When battle begins:
1. Player selects up to 5 characters from formation
2. Battle map generated (8x8 grid)
3. Player places characters freely within 5x5 deployment zone (one corner)
4. PvP: Each player gets opposite corners
5. All characters start at 100% HP/MP, no status effects

---

## 3. World Design

### 3.1 World Structure

The world is a **node-based graph** procedurally generated from a global seed. All players share the same world layout.

```
                        [Palace]
                           |
            [Mountain]-----+-----[Cave]
                |          |          |
    [Village]---+---[City]-+-[Forest]-+---[Guild]
                |          |          |
            [Bridge]-------+-----[Village]
                           |
                      [CASTLE]  <-- Starting Point
                           |
            [Forest]-------+-----[City]
                |          |          |
            [Cave]----[Village]---[Mountain]
                           |
                       [Guild]
```

### 3.2 Node Types

#### Castle (Central Hub)
- **Spawn Point**: All new characters start here
- **Features**: Coliseum, Tavern, Courtyard, Throne, Blacksmith, Apothecary, Temple, Stables, Marketplace, Garrison
- **Count**: Exactly 1 (at origin)
- **Garrison**: Hire mixed-class recruits with regional race/class bias, refreshed hourly

#### City
- **Features**: Tavern + 2 random from (Blacksmith, Apothecary, Temple, Stables)
- **Distribution**: Multiple throughout world
- **Difficulty**: Varies by distance from center

#### Village
- **Features**: Farm + optional Apothecary (50% chance)
- **Distribution**: Common, especially in inner rings
- **Difficulty**: Low

#### Forest (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Goblins, Wolves, Slimes
- **Difficulty**: Low to Medium

#### Cave (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Bats, Golems, Skeletons
- **Difficulty**: Medium

#### Mountain (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Trolls, Rock creatures
- **Difficulty**: Medium to High

#### Bridge (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Bandits, mixed types
- **Difficulty**: Variable

#### Guild
- **Features**: Class-specific training, recruitment, quests (future)
- **Types**: Warriors' Guild, Wizards' Guild, Monks' Guild, Chemists' Guild
- **Count**: 4 total (one per class)
- **Distance**: 5-8 nodes from center
- **Recruitment**: Recruit permanent party members with randomized stats, traits, and skills (see [GUILD_RECRUITMENT_SYSTEM.md](GUILD_RECRUITMENT_SYSTEM.md))

#### Palace
- **Features**: End-game content (TBD)
- **Count**: Exactly 1
- **Distance**: Minimum 13 nodes from center
- **Special**: Rare encounters, unique rewards

### 3.3 Node Features

| Feature | Locations | Description |
|---------|-----------|-------------|
| Coliseum | Castle | PvP matchmaking and leaderboards |
| Tavern | Castle, City | Real-time chat, see other players |
| Blacksmith | Castle, City | Buy/sell weapons and armor |
| Apothecary | Castle, City, Village | Buy consumables, sell materials |
| Temple | Castle, City | Remove curses/debuffs (future) |
| Stables | Castle, City | Fast travel (future) |
| Marketplace | Castle | Player-to-player trading |
| Garrison | Castle | Hire mixed-class recruits with regional bias |
| Farm | Village | Buy food items |

### 3.4 World Generation Rules

1. **Central Castle**: Always at coordinates (0, 0)
2. **Ring Distribution**:
   - Ring 1 (distance 3-4): Cities, Villages, Forests
   - Ring 2 (distance 5-7): Cities, Villages, Forests, Caves
   - Ring 3 (distance 8-11): Villages, Forests, Caves, Mountains, Bridges
   - Ring 4+ (distance 12+): Forests, Caves, Mountains, Bridges
3. **Guild Placement**: 4 guilds at distance 5-8, one per class
4. **Palace Placement**: Exactly 1, minimum distance 13
5. **Connectivity**: All nodes connected (no isolated nodes)
6. **Node Names**: Procedurally generated from prefix/suffix lists

> **Detailed Documentation**: See [WORLDGEN_TECHNICAL_DEEP_DIVE.md](WORLDGEN_TECHNICAL_DEEP_DIVE.md) for the complete 6-phase world generation algorithm including Voronoi partitioning, MST connections, and region theming.

---

## 4. Combat System

Combat is **turn-based tactical** on an **8x8 isometric grid**. Each unit accumulates Charge Time (CT) based on their AGI stat and acts when CT reaches 100.

### Key Concepts

- **Two-Action System**: Each turn allows 1 MOVE + 1 ACT (in any order)
- **CT Turn Order**: Higher AGI = faster CT accumulation = more frequent turns
- **Terrain Effects**: Different terrain types affect movement cost and provide combat bonuses
- **Status Effects**: 11 status types with stacking and duration rules (see [STATUS_EFFECTS.md](STATUS_EFFECTS.md))

### Battle Modes

| Mode | Players | Description |
|------|---------|-------------|
| PVE_SOLO | 1 | Single player vs AI enemies |
| PVE_COOP | 2-4 | Multiple players vs enemies |
| PVP_DUEL | 2 | 1v1 competitive PvP |
| PVP_TEAM | 4-8 | Team-based PvP |
| PVP_FFA | 3-8 | Free-for-all |

### Battle Rewards

| Reward | Description |
|--------|-------------|
| Gold | Scales with enemy difficulty tier |
| Experience | Added to each character's XP Pool |
| Items | Random drops from enemy loot tables |

**Defeat**: No rewards, party returned to last safe node (no permadeath).

> **Detailed Documentation**: See [BATTLE_SYSTEM_INDEX.md](BATTLE_SYSTEM_INDEX.md) for links to all battle specifications including turn system, messaging protocol, animations, modes, and reconnection handling.

---

## 5. Economy

**Gold** is the primary currency, used for purchasing items from NPC shops and trading via the player marketplace.

### Gold Flow Summary

| Sources | Sinks |
|---------|-------|
| Battle victories (30-250g by tier) | NPC shop purchases |
| PvP victories (50-100g) | Equipment upgrades |
| Selling to NPCs (50% of base) | Consumables |

### Item Rarity

| Rarity | Drop Rate | Price Multiplier | Color |
|--------|-----------|------------------|-------|
| Common | 70% | 1x | White |
| Uncommon | 20% | 2x | Green |
| Rare | 8% | 5x | Blue |
| Epic | 1.8% | 15x | Purple |
| Legendary | 0.2% | 50x | Gold |

> **Detailed Documentation**: See [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) for complete NPC shop mechanics, dynamic pricing, and marketplace order book system. See [ITEM_SYSTEM.md](ITEM_SYSTEM.md) for equipment slots, rarity generation, and drop tables.

---

## 6. Multiplayer Features

### 6.1 Coliseum PvP

The Coliseum uses PVP_DUEL mode for 1v1 battles. Players queue with their battle party (1-5 characters) and are matched based on average party level.

| Feature | Details |
|---------|---------|
| Matchmaking | Average party level +/- 10 |
| Turn Timer | 60 seconds |
| Item Use | Disabled (balanced play) |
| Rewards | Victory: 100g + 500 XP x avg_level |

### 6.2 Marketplace

An open exchange system at Castle nodes with order book trading.

| Feature | Details |
|---------|---------|
| Order Types | Limit orders, Market orders |
| Partial Fills | Supported |
| Transaction Fees | None |
| Order Limit | 10 open orders per player |

### 6.3 Tavern Chat

Real-time chat in Tavern nodes with 160 character limit and 100 message scroll-back.

### 6.4 Leaderboards

| Category | Ranking Criteria |
|----------|------------------|
| Level | Highest character level |
| PvP Wins | Total Coliseum victories |
| Gold | Current gold balance |

---

## 7. Progression Loop

### 7.1 Core Loop

```
+-------------+     +-------------+     +-------------+     +-------------+
|   Explore   |---->|   Battle    |---->|   Rewards   |---->|   Upgrade   |
|   World     |     |   Enemies   |     |   Gold/XP   |     |   Party     |
+-------------+     +-------------+     +-------------+     +-------------+
      ^                                                            |
      |                                                            |
      +------------------------------------------------------------+
```

### 7.2 Session Goals

| Session Length | Goals |
|----------------|-------|
| Short (15-30 min) | 2-3 battles, level up a character, discover 1-2 nodes |
| Medium (1-2 hours) | Clear a dungeon area, upgrade equipment, try PvP |
| Long (2+ hours) | Reach new world tier, level multiple characters, trading |

### 7.3 Long-term Goals

1. **Max Level Character** (Level 256)
2. **Complete Party** (12 characters)
3. **All Classes Mastered** (One of each at high level)
4. **World Exploration** (Discover Palace, all Guilds)
5. **PvP Ranking** (Top 100 leaderboard)
6. **Wealth Accumulation** (Gold milestones)

---

## 8. Future Features (Post-MVP)

### 8.1 Planned Additions

| Feature | Description | Priority |
|---------|-------------|----------|
| Advanced Classes | Class upgrades at level 50 | High |
| Equipment Crafting | Combine materials for items | High |
| Guild System | Player guilds with perks | Medium |
| Cooperative Battles | Team up vs bosses | Medium |
| Daily Quests | Repeatable objectives | Medium |
| Achievement System | Unlock rewards for milestones | Low |
| Mounts | Faster world travel | Low |
| Housing | Personal player space | Low |

### 8.2 Advanced Classes (Concept)

| Base Class | Advanced Options |
|------------|------------------|
| Warrior | Paladin (tank), Berserker (damage) |
| Wizard | Archmage (power), Enchanter (support) |
| Monk | Ninja (speed), Martial Artist (combo) |
| Chemist | Alchemist (offense), Medic (healing) |

### 8.3 Boss Encounters

- Special enemies at Palace and deep nodes
- Unique mechanics and phases
- Guaranteed rare drops
- Weekly reset

---

## 9. Audio and Visual Style

### 9.1 Art Direction

| Aspect | Specification |
|--------|---------------|
| Perspective | Isometric (2:1 ratio) |
| Style | Clean pixel art / low-poly hybrid |
| Resolution | 32x32 tiles, 64x64 characters |
| Color Palette | Fantasy medieval with vibrant accents |

### 9.2 UI Design

| Aspect | Specification |
|--------|---------------|
| Theme | Dark fantasy with gold accents |
| Fonts | Clean sans-serif for readability |
| Panels | Semi-transparent with subtle borders |
| Feedback | Clear visual indicators for actions |

### 9.3 Audio

| Category | Style |
|----------|-------|
| Music | Orchestral fantasy themes |
| Battle | Upbeat, tense combat tracks |
| UI | Subtle feedback sounds |
| Effects | Spell, attack, and impact sounds |

---

## 10. Accessibility

### 10.1 Planned Features

- Colorblind-friendly indicators
- Scalable UI elements
- Keyboard navigation support
- Screen reader text (where possible)
- Adjustable game speed

### 10.2 Mobile Considerations

- Touch-friendly button sizes (minimum 44x44 px)
- No hover-only interactions
- Pinch-zoom for world map
- Portrait and landscape support

---

## Related Documents

### Battle System
- [BATTLE_SYSTEM_INDEX.md](BATTLE_SYSTEM_INDEX.md) - Index of all battle documentation
- [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) - CT-based turn order, two-action system, turn state machine
- [BATTLE_MESSAGING_PROTOCOL.md](BATTLE_MESSAGING_PROTOCOL.md) - Hybrid HTTP/WebSocket protocol, message specs
- [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) - Visual feedback system, intent visualization
- [BATTLE_MODES.md](BATTLE_MODES.md) - PvE/PvP mode configurations, matchmaking
- [BATTLE_RECONNECTION.md](BATTLE_RECONNECTION.md) - State persistence, reconnection handling

### Characters and Progression
- [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) - Advanced classes, guild advancement, formation screen
- [SKILL_TREES.md](SKILL_TREES.md) - Complete skill definitions for all guilds

### Items and Economy
- [ITEM_SYSTEM.md](ITEM_SYSTEM.md) - Item generation, equipment slots, rarity system
- [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) - NPC shops, dynamic pricing, marketplace

### Enemies and AI
- [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) - Enemy templates, AI behaviors, drop tables
- [AI_SYSTEM.md](AI_SYSTEM.md) - Enemy AI behavior trees and utility functions

### World and Technical
- [WORLDGEN_TECHNICAL_DEEP_DIVE.md](WORLDGEN_TECHNICAL_DEEP_DIVE.md) - 6-phase world generation algorithms
- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) - Database schemas, API infrastructure
- [API_SPECIFICATION.md](API_SPECIFICATION.md) - REST and WebSocket endpoint documentation

### Planning
- [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) - Development phases and task tracking

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | Major update: XP-spending system, racial traits, status effects, removed flee/temple revival, HP/MP regeneration rules, movement standardization |
| 2.1 | Jan 2026 | - | Added battle modes overview, CT-based turn system references |
| 3.0 | Jan 2026 | - | Added Related Documents section with battle system docs |
| 4.0 | Jan 2026 | - | Refactored to index document: condensed combat/economy/multiplayer sections, added Document Index, links to specialized docs |
| 4.1 | Feb 2026 | - | Added Garrison feature to castle: hire mixed-class recruits with regional race/class bias, refreshed hourly |
