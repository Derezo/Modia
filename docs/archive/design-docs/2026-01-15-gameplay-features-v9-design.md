# Gameplay Features v9.0 - Design Document

**Version:** 1.0
**Date:** January 15, 2026
**Status:** Implemented

---

## Overview

This document describes the design and implementation of 5 major gameplay features released in v9.0:

1. Settings Expansion (7 categories, ~44 settings)
2. Audio System (Web Audio API)
3. Elemental Damage System (8 elements)
4. Battle Log Panel (scrollable combat history)
5. Gold Sinks + Relic System

---

## 1. Settings Expansion

### Problem Statement

The existing settings system had only 4 categories with ~12 settings, lacking the granular control players expect from a tactical RPG. Key areas like battle behavior, accessibility, and social preferences were underserved.

### Solution Design

Expanded to 7 categories with ~44 settings organized by function:

#### Category Structure

| Category | Settings Count | Purpose |
|----------|---------------|---------|
| Battle | 13 | Combat UX, camera, previews |
| Audio | 6 | Volume controls, mutes |
| Display | 6 | Visual options |
| Accessibility | 8 | Colorblind, motion, text |
| Gameplay | 6 | Tutorials, auto-save, confirmations |
| Social | 6 | Privacy, chat preferences |
| Controls | 8 | Keybinds, input options |

#### Accessibility Features

- **Colorblind Modes:** Three filter types (protanopia, deuteranopia, tritanopia) applied via CSS filter matrix on canvas
- **High Contrast:** Enhanced text outlines and backgrounds
- **Reduced Motion:** Disable non-essential animations
- **Text Size:** 3 scaling options (normal, large, extra large)

#### Implementation

```
SettingsScene.js
  - 7-tab navigation
  - Dynamic form generation from settings schema
  - Real-time preview for visual settings

SettingsManager.js
  - Event-driven architecture
  - localStorage persistence
  - Database sync for authenticated users
  - Event: 'settings:changed' with { category, key, value }
```

---

## 2. Audio System

### Problem Statement

The game lacked any audio feedback, reducing immersion and missing accessibility cues for actions.

### Solution Design

Web Audio API integration with scene-based music and contextual SFX.

#### Architecture

```
AudioManager.js
├── Context Management
│   ├── Create AudioContext on first user interaction
│   └── Handle iOS/Safari autoplay restrictions
├── Music System
│   ├── Scene-based track selection
│   ├── Crossfade transitions (1 second)
│   └── Loop handling
├── SFX System
│   ├── Fire-and-forget playback
│   ├── Pooled audio nodes (performance)
│   └── Priority system for overlapping sounds
└── Volume Control
    ├── Master gain node
    ├── Music gain node
    └── SFX gain node
```

#### Music Tracks

| Scene | Track |
|-------|-------|
| Title | title-theme.ogg |
| WorldMap | overworld.ogg |
| Battle | combat.ogg |
| Victory | victory.ogg |
| Shop | peaceful.ogg |
| Tavern | tavern.ogg |

#### SFX Categories

- **UI:** click, hover, open, close, confirm, cancel
- **Battle:** attack-hit, attack-miss, critical, heal, buff, debuff, death
- **World:** travel, level-up, gold-gain, item-pickup

---

## 3. Elemental Damage System

### Problem Statement

Combat lacked tactical depth - all damage was the same regardless of attacker/defender combinations. No reason to consider enemy types when choosing skills.

### Solution Design

8-element system with resistances creating rock-paper-scissors dynamics.

#### Element Definitions

| Element | Strong Against | Weak Against |
|---------|---------------|--------------|
| Fire | Ice, Wind | Water, Earth |
| Ice | Wind, Lightning | Fire, Earth |
| Lightning | Water, Wind | Earth, Ice |
| Earth | Fire, Lightning | Wind, Water |
| Wind | Earth, Water | Fire, Ice |
| Water | Fire, Earth | Lightning, Wind |
| Light | Dark | Dark |
| Dark | Light | Light |

#### Damage Calculation

```javascript
function calculateElementalDamage(baseDamage, element, targetResistances) {
  if (!element || element === 'physical') {
    return baseDamage;
  }

  const resistance = targetResistances[element] || 0;
  // Resistance ranges: -100 (2x damage) to +100 (immune)
  const multiplier = 1 - (resistance / 100);

  return Math.floor(baseDamage * Math.max(0, multiplier));
}
```

#### Enemy Templates

Each enemy type has innate resistances:

```javascript
ENEMIES.fire_slime = {
  // ...
  resistances: {
    fire: 100,    // Immune
    ice: -50,     // 1.5x damage
    lightning: 0, // Normal
    water: 25     // 0.75x damage
  }
};
```

#### Racial Templates

Player races have subtle elemental affinities:

| Race | Bonuses | Penalties |
|------|---------|-----------|
| Human | None | None |
| Elf | Light +15, Wind +10 | Dark -10 |
| Dwarf | Earth +20, Fire +10 | Lightning -15 |
| Vampire | Dark +25 | Light -50 |
| Orc | Fire +15 | Ice -20 |

---

## 4. Battle Log Panel

### Problem Statement

Players lost track of what happened during longer battles. No way to review damage numbers, status effect applications, or turn order changes.

### Solution Design

Scrollable panel showing all combat events with color-coded categories.

#### UI Specification

```
┌─────────────────────────────┐
│ Battle Log                  │
├─────────────────────────────┤
│ [14:32] Knight attacks Slime│ <- Red (damage)
│   12 physical damage        │
│ [14:33] Slime is poisoned   │ <- Yellow (status)
│ [14:34] Healer heals Knight │ <- Green (healing)
│   +15 HP                    │
│ [14:35] Mage moves to (3,4) │ <- Blue (movement)
│ ▼ Auto-scroll enabled       │
└─────────────────────────────┘
```

#### Event Types

| Type | Color | Examples |
|------|-------|----------|
| damage | #c62828 | Attack hits, skill damage |
| healing | #2e7d32 | HP restore, regen ticks |
| status | #f9a825 | Buff/debuff applied/removed |
| movement | #1565c0 | Unit moves, pushed |
| turn | #6a1b9a | Turn start, CT changes |
| system | #616161 | Battle start/end, phase changes |

#### Verbosity Levels

- **Minimal:** Damage, healing, deaths only
- **Normal:** + Status effects, turn changes
- **Detailed:** + Movement, CT values, resistance checks

---

## 5. Gold Sinks + Relic System

### Problem Statement

Late-game gold accumulation with nothing to spend it on. Need economy balancing and aspirational items.

### Solution Design

Implement core gold sinks plus rare collectible relics.

#### Gold Sinks

| Sink | Cost | Implementation |
|------|------|----------------|
| Marketplace Fee | 5% of sale price | Deducted on order fulfillment |
| Fast Travel | 50-500g | Based on node distance formula |
| Stamina Restore | 100g per point | Max 10 points per day |

##### Fast Travel Cost Formula

```javascript
function calculateTravelCost(fromNode, toNode) {
  const distance = calculatePathDistance(fromNode, toNode);
  const baseCost = 50;
  const costPerUnit = 15;
  return Math.min(500, baseCost + (distance * costPerUnit));
}
```

#### Relic System

Relics are rare items providing permanent bonuses.

##### Relic Categories

| Category | Effect Type | Example |
|----------|------------|---------|
| Combat | Stat boost | +5% critical damage |
| Utility | Resource bonus | +10% gold from battles |
| Exploration | Map benefit | +1 fog reveal distance |
| Legacy | Unique effect | Undead take +10% damage |

##### Relic Sources

- **Ruins Puzzles:** Rare reward from completing puzzles
- **Boss Drops:** 5% chance from boss encounters
- **Special Events:** Quest chain rewards
- **Discovery Nodes:** One-time terminator rewards

##### Relic Database Schema

```sql
CREATE TABLE relics (
  id SERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  category VARCHAR(32),
  effect_type VARCHAR(32),
  effect_value JSONB,
  rarity VARCHAR(16) DEFAULT 'rare'
);

CREATE TABLE character_relics (
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  relic_id INTEGER REFERENCES relics(id),
  acquired_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (character_id, relic_id)
);
```

---

## Testing Considerations

### Settings

- Verify each setting persists correctly
- Test colorblind filters apply to canvas
- Confirm settings sync between localStorage and database

### Audio

- Test Web Audio context creation across browsers
- Verify iOS autoplay restrictions handled
- Check volume sliders affect correct channels

### Elemental Damage

- Balance testing for all element matchups
- Verify resistance calculations at edge cases (100, -100)
- Test racial modifiers apply correctly

### Battle Log

- Scroll performance with 100+ entries
- Color contrast for accessibility
- Auto-scroll disable on manual scroll

### Gold Sinks

- Verify marketplace fee applied to seller, not buyer
- Test fast travel cost calculation edge cases
- Confirm stamina purchase daily limit enforced

---

## Migration Notes

No database migrations required for audio or battle log (frontend-only).

Settings expansion uses existing `user_settings` JSONB column.

Gold sinks modify existing transaction flows in marketplace.js and world.js.

Relic system adds 2 new tables via migration `032_relics.sql`.

---

## Future Enhancements

### Settings
- Screen reader optimization
- Dyslexia font (OpenDyslexic)
- Haptic feedback for mobile

### Audio
- Dynamic music based on battle tension
- Spatial audio for unit positions
- Voice lines for characters

### Elements
- Combo elements (Fire + Wind = Explosion)
- Environmental element effects
- Seasonal element modifiers

### Battle Log
- Export battle log as text
- Replay system using log events
- Statistics summary at battle end

### Economy
- Skill respec fees
- Storage expansion
- Guild upgrade costs
