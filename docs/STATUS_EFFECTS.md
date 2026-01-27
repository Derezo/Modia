# Status Effects

| Document | Version | Last Updated |
|----------|---------|--------------|
| Status Effect Taxonomy | 1.0 | 2026-01-27 |

## Table of Contents

1. [Overview](#1-overview)
2. [Effect Categories](#2-effect-categories)
   - 2.1 Action-Blocking (Hard CC)
   - 2.2 Soft CC
   - 2.3 Damage Over Time (DoT)
   - 2.4 Healing Over Time (HoT)
   - 2.5 Stat Modifiers
   - 2.6 Zodiac Effects
3. [Action Restriction Matrix](#3-action-restriction-matrix)
4. [Cleansing and Removal](#4-cleansing-and-removal)
5. [Stacking and Duration Rules](#5-stacking-and-duration-rules)
6. [Movement and CT Modifiers](#6-movement-and-ct-modifiers)
7. [Status Resistance](#7-status-resistance)
8. [Turn Processing Order](#8-turn-processing-order)
9. [Shared Constants Reference](#9-shared-constants-reference)
10. [Code Locations](#10-code-locations)
11. [Related Documents](#11-related-documents)

---

## 1. Overview

Status effects are temporary conditions applied to units during battle. They modify behavior, deal periodic damage, restore health, or restrict actions. All status effect logic is server-authoritative and processed in `statusEffectManager.js`.

### 1.1 Lifecycle

1. **Application** -- A skill or ability calls `applyStatusEffect(unit, effectType, duration)`
2. **Active** -- The effect persists, modifying the unit each turn
3. **Turn Processing** -- At the start of each turn, DoT/HoT damage is applied and duration decrements by 1
4. **Expiration** -- When duration reaches 0, the effect is removed
5. **Early Removal** -- Cleansing skills or items can remove effects before expiration

### 1.2 Effect Summary

| Effect | Category | Damage/Modifier | Default Duration |
|--------|----------|-----------------|------------------|
| poison | DoT | 5% max HP/turn | 3 turns |
| burn | DoT | 3% max HP/turn | 2-3 turns |
| regen | HoT | 5% max HP/turn | 3 turns |
| stun | Hard CC | -- | 1 turn |
| freeze | Hard CC | -- | 1 turn |
| sleep | Hard CC | Broken by damage | 1 turn |
| root | Soft CC | -- | 2 turns |
| silence | Soft CC | -- | 2 turns |
| slow | Debuff | -1 movement, -50% CT gain | 2 turns |
| haste | Buff | +1 movement, +50% CT gain | 3 turns |
| blind | Debuff | -30% accuracy | 2 turns |

---

## 2. Effect Categories

### 2.1 Action-Blocking (Hard CC)

Hard CC effects prevent the affected unit from taking any action during their turn.

**Stun** -- The unit is incapacitated for 1 turn. Prevents all actions and movement.

**Freeze** -- The unit is encased in ice for 1 turn. Prevents all actions and movement. Functionally identical to stun but applied by ice-element skills.

**Sleep** -- The unit is asleep for 1 turn. Prevents all actions and movement. Unique property: receiving damage immediately removes the sleep effect.

### 2.2 Soft CC

Soft CC effects restrict specific actions without fully incapacitating the unit.

**Root** -- The unit cannot move but can still attack and use skills. Lasts 2 turns.

**Silence** -- The unit cannot use skills but can still move and perform basic attacks. Lasts 2 turns.

### 2.3 Damage Over Time (DoT)

DoT effects deal a percentage of the unit's max HP at the start of each turn.

**Poison** -- Deals 5% of max HP per turn for 3 turns (15% total). The most common DoT effect, applied by many skills across multiple guilds.

**Burn** -- Deals 3% of max HP per turn for 2-3 turns (6-9% total). Lower per-tick damage than poison but applied by fire-element skills.

### 2.4 Healing Over Time (HoT)

**Regen** -- Restores 5% of max HP per turn for 3 turns (15% total). Applied by healing skills and certain support abilities.

### 2.5 Stat Modifiers

**Slow** -- Reduces movement range by 1 (minimum 1) and halves CT gain rate. Lasts 2 turns. See [Section 6](#6-movement-and-ct-modifiers) for exact formulas.

**Haste** -- Increases movement range by 1 and multiplies CT gain rate by 1.5. Lasts 3 turns. See [Section 6](#6-movement-and-ct-modifiers) for exact formulas.

**Blind** -- Reduces accuracy by 30%. Lasts 2 turns. Affects both physical and magical attacks.

### 2.6 Zodiac Effects

Zodiac abilities are character-specific effects determined by the character's zodiac sign. These are activated via the zodiac ability system and have unique behaviors distinct from standard status effects.

| Sign | Ability | Effect |
|------|---------|--------|
| Aries | rams_charge | Next attack +25% crit chance |
| Taurus | unmovable | Immune to push/pull (battle-long) |
| Gemini | twin_strike | Next attack hits twice at 60% damage |
| Cancer | moonshield | Blocks next damage instance |
| Leo | roar | Adjacent enemies -30 CT |
| Virgo | purify | Remove 1 debuff from self |
| Libra | balance | Next attack heals for damage dealt |
| Scorpio | venom_sting | Target poisoned 3% HP/turn for 4 turns |
| Sagittarius | celestial_arrow | Next attack +2 range |
| Capricorn | mountains_endurance | +25% defense for 2 turns |
| Aquarius | cascade | Heal self 20% max HP |
| Pisces | dreamwave | 50% chance to sleep target for 1 turn |

---

## 3. Action Restriction Matrix

This matrix shows which actions each status effect blocks. Derived from the `PREVENT_*` constants in `shared/battleMath.js`.

| Effect | Move | Act | Skill | Shared Constant |
|--------|------|-----|-------|-----------------|
| stun | X | X | X | `PREVENT_ACTING`, `PREVENT_MOVEMENT`, `PREVENT_SKILLS` |
| freeze | X | X | X | `PREVENT_ACTING`, `PREVENT_MOVEMENT`, `PREVENT_SKILLS` |
| sleep | X | X | X | `PREVENT_ACTING`, `PREVENT_MOVEMENT`, `PREVENT_SKILLS` |
| root | X | -- | -- | `PREVENT_MOVEMENT` |
| silence | -- | -- | X | `PREVENT_SKILLS` |
| slow | reduced | -- | -- | Movement modifier (not in prevention arrays) |
| blind | -- | reduced | reduced | Accuracy modifier (not in prevention arrays) |

- **X** = fully blocked by corresponding `PREVENT_*` constant
- **reduced** = allowed but with modified values
- **--** = no restriction

> **Note:** "Act" covers attack, item use, and defend — all gated by `PREVENT_ACTING`. "Skill" is separately gated by `PREVENT_SKILLS` to allow silence to block skills without blocking basic attacks.

---

## 4. Cleansing and Removal

### 4.1 Cleansing Tiers

Three tiers of cleansing exist, each removing progressively more effects:

| Tier | Constant | Effects Removed |
|------|----------|-----------------|
| Cure Poison | `CURE_POISON_EFFECTS` | poison |
| Cure All | `CURE_ALL_EFFECTS` | poison, blind, silence, slow, burn |
| Purify | `PURIFY_EFFECTS` | poison, burn, blind, silence, slow, stun, freeze, root |

### 4.2 Removal Methods

- **Cleansing skills** -- Skills with a cleansing tier remove matching effects from the target
- **Consumable items** -- Battle consumables (antidote, smelling salts) remove specific effects
- **Zodiac: Virgo** -- The `purify` zodiac ability removes 1 debuff from self
- **Damage (sleep only)** -- Taking any damage removes the sleep effect immediately
- **Duration expiry** -- All effects are removed when their duration reaches 0

### 4.3 Effects Not Cleansable

The `haste` and `regen` buffs are not included in any cleansing list since they are beneficial effects. No enemy ability currently purges buffs from player units.

---

## 5. Stacking and Duration Rules

### 5.1 No Stacking

Status effects do not stack. Applying an effect that already exists on a unit does not add a second instance or increase the damage/modifier.

### 5.2 Duration Refresh

When a status effect is reapplied to a unit that already has it, the duration is set to the maximum of the existing and new durations:

```javascript
unit.duration = Math.max(existingDuration, newDuration);
```

This means reapplying a 3-turn poison when 1 turn remains resets it to 3 turns, but applying a 2-turn poison when 3 turns remain has no effect on duration.

### 5.3 Application Function

All status effects are applied through:

```javascript
applyStatusEffect(unit, effectType, duration = 3)
```

The default duration is 3 turns if not specified by the skill.

---

## 6. Movement and CT Modifiers

### 6.1 Slow

Slow reduces both movement range and CT accumulation rate:

```javascript
// Movement
effectiveRange = Math.max(1, baseRange - 1);

// CT gain
ctGain *= 0.5;
```

The `Math.max(1, ...)` floor ensures a unit can always move at least 1 tile even when slowed.

### 6.2 Haste

Haste increases both movement range and CT accumulation rate:

```javascript
// Movement
effectiveRange = baseRange + 1;

// CT gain
ctGain *= 1.5;
```

### 6.3 Interaction

If a unit has both slow and haste simultaneously (possible through multi-target skills), both modifiers apply. The movement becomes `Math.max(1, baseRange - 1) + 1` and CT gain becomes `ctGain * 0.5 * 1.5` (net 0.75x).

---

## 7. Status Resistance

Units have a chance to resist status effect application based on their LCK stat:

```
resistChance = 10% + (LCK / 200)
```

- **Base resistance:** 10% (all units)
- **Scaling:** +0.5% per point of LCK
- **Cap:** 50% maximum resistance

A unit with 80 LCK has a `10% + 80/200 = 50%` resistance chance (at the cap).

---

## 8. Turn Processing Order

Status effects are processed at the start of each unit's turn in this exact order:

1. **Trait-based HP regen** -- The Regeneration trait restores 2% max HP per turn (processed before status effects)
2. **DoT/HoT application** -- Poison, burn, and regen damage/healing is applied
3. **Duration decrement** -- All active effect durations are reduced by 1
4. **Expiration check** -- Effects with duration <= 0 are removed

This ordering means a newly applied 1-turn effect will tick once (dealing damage or healing) before being removed.

---

## 9. Shared Constants Reference

All status effect constants are defined in `shared/battleMath.js`:

```javascript
// Action prevention groups
const PREVENT_ACTING   = ['stun', 'freeze', 'sleep'];
const PREVENT_MOVEMENT = ['stun', 'freeze', 'sleep', 'root'];
const PREVENT_SKILLS   = ['stun', 'freeze', 'sleep', 'silence'];

// Cleansing tiers
const CURE_POISON_EFFECTS = ['poison'];
const CURE_ALL_EFFECTS    = ['poison', 'blind', 'silence', 'slow', 'burn'];
const PURIFY_EFFECTS      = ['poison', 'burn', 'blind', 'silence', 'slow', 'stun', 'freeze', 'root'];
```

These constants are shared between the API (server-side validation) and the frontend (client-side UI feedback) via the `shared/` workspace.

---

## 10. Code Locations

| File | Purpose |
|------|---------|
| `api/src/services/battle/statusEffectManager.js` | All status effect processing logic |
| `shared/battleMath.js` | Shared constants (`PREVENT_*`, `CURE_*`, `PURIFY_*`) |
| `api/src/services/battle/movementService.js` | Movement range modifiers (slow/haste) |
| `api/src/services/battle/actionProcessor.js` | Status effect application during actions |
| `api/src/config/skillTrees.js` | Skill definitions with effect types and durations |
| `frontend/src/battle/BattlePathfinding.js` | Client-side movement modifier sync |

---

## 11. Related Documents

- [GAME_DESIGN.md](GAME_DESIGN.md) -- Combat mechanics overview, class progression
- [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) -- CT-based turn order, two-action system
- [BATTLE_SYSTEM_INDEX.md](BATTLE_SYSTEM_INDEX.md) -- Battle system navigation and cross-reference
- [SKILL_TREES.md](SKILL_TREES.md) -- Skill definitions for all 8 guilds, including effect-applying skills
- [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) -- Enemy AI archetypes and status effect usage
- [AI_SYSTEM.md](AI_SYSTEM.md) -- AI utility scoring for status effect skills
- [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) -- Zodiac sign assignment and abilities
- [ITEM_SYSTEM.md](ITEM_SYSTEM.md) -- Battle consumables with cleansing effects

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-27 | Initial document: full status effect taxonomy from codebase audit |
