# Audio Style Guide

This document provides comprehensive guidelines for writing audio prompts for Modia's SFX and music generation systems.

## Table of Contents

1. [SFX Prompt Guidelines](#sfx-prompt-guidelines)
2. [Music Prompt Guidelines](#music-prompt-guidelines)
3. [Regional Audio Profiles](#regional-audio-profiles)
4. [Quick Reference](#quick-reference)

---

## SFX Prompt Guidelines

### The 1-Comma Rule (Critical)

**Maximum 1 comma per prompt.** ElevenLabs interprets comma-separated prompts as multiple distinct sounds, generating each sequentially. This causes files to be much longer than the specified duration.

| Commas | Result |
|--------|--------|
| 0 | Best - single unified sound |
| 1 | Acceptable - primary + secondary quality |
| 2+ | **BLOCKED** - will fail validation |

### Prompt Pattern

```
"[Fantasy context] [adjective] [adjective] [core sound noun] with [secondary quality]"
```

Use "with" and "and" to join descriptors instead of commas.

### Examples by Category

#### Fire Magic (High Fantasy)

```
BAD (4 commas - blocked):
"Fantasy fire spell, magical flames whooshing, crackling sparks, heat sizzle"

GOOD (0 commas):
"Fantasy arcane fireball with roaring mystical flames and explosive impact"

GOOD (1 comma):
"Fantasy devastating inferno eruption with overwhelming conflagration, mystical fire consuming all"
```

#### Ice Magic (High Fantasy)

```
BAD:
"Fantasy ice spell, crystallizing frost, cold magical energy, freezing crackle"

GOOD:
"Fantasy crystalline ice shard with piercing frozen energy"
"Fantasy raging blizzard howl with shattering frost crystals and overwhelming cold"
```

#### Lightning Magic (High Fantasy)

```
BAD:
"Fantasy lightning spell, electrical crackling, thunder rumble, static discharge"

GOOD:
"Fantasy devastating thunderbolt with crackling electrical discharge and rumbling thunder"
"Fantasy chain lightning arc with cascading electrical strikes"
```

#### Physical Combat (High Fantasy)

```
BAD:
"Fantasy power strike, heavy weapon swing, powerful physical impact, forceful blow landing"

GOOD:
"Fantasy devastating power strike with heavy weapon impact and bone-crushing force"
"Fantasy sweeping cleave with thunderous blade arc through multiple targets"
```

#### Healing/Buff Magic (High Fantasy)

```
BAD:
"Fantasy healing spell, restorative magical energy, soothing light, life restoration"

GOOD:
"Fantasy restorative holy light with warm soothing energy"
"Fantasy empowering aura activation with rising mystical power"
```

#### Shadow/Ninja (High Fantasy)

```
BAD:
"Fantasy shadow step, dark teleportation, vanishing into shadows, reappearing behind target"

GOOD:
"Fantasy shadow step teleportation with vanishing darkness and sudden reappearance"
"Fantasy lethal backstab from shadows with precise assassin strike"
```

#### Status Effects

```
BAD:
"Fantasy burn status effect, flames igniting on target, crackling fire, sizzling damage"

GOOD:
"Fantasy burning affliction with crackling flames igniting on target"
"Fantasy freezing curse with crystallizing frost spreading rapidly"
```

#### UI Sounds

UI sounds should be brief and non-intrusive. These already follow good patterns:

```
GOOD:
"Clean soft tactile brief UI button click"
"Brief triumphant positive UI success chime"
"Soft gentle attention UI notification ping"
```

### Validation Command

Run the following to check all prompts before generation:

```bash
npm run audio:generate:sfx -- --dry-run
```

This will:
- List all prompts that would be generated
- Show character count and comma count for each
- **BLOCK** any prompt with more than 1 comma

---

## Music Prompt Guidelines

### Structure

Music prompts for Suno should include:
1. **Style/Genre** - The overall musical style
2. **Key Signature** - Explicit key (D major, B minor, etc.)
3. **Instruments** - 2-3 signature instruments
4. **Mood** - Emotional descriptors
5. **Setting** - Environmental/cultural context
6. **Tempo** - Energy level description

### Example Pattern

```
"[Style] theme in [Key] with [Instrument 1] and [Instrument 2] and [Mood descriptors] with [Setting/atmosphere] at [Tempo description]"
```

### Track Types

Each region has 5 track types with mood modifiers:

| Type | Energy | Mood Modifier |
|------|--------|---------------|
| Exploration | Moderate | Core regional identity |
| Tavern | Relaxed | Warmer, social, welcoming |
| Shop | Light | Commerce-friendly, pleasant |
| Fishing | Peaceful | Contemplative, serene |
| Ruins | Mysterious | Melancholic, ancient, puzzle-like |

### Battle Theme Modifiers

| Battle Type | Energy | Key Shift | Description |
|-------------|--------|-----------|-------------|
| Normal | Building | Stay in regional minor | Tension building |
| Boss | Epic | Add dramatic pauses | Climactic, intense |
| Victory | Triumphant | Shift to major | Celebratory fanfare |
| Defeat | Somber | Deep minor | Respectful, mournful |

---

## Regional Audio Profiles

Each region must have an immediately identifiable audio identity. A player should recognize the region within 3 seconds.

### Heartlands (Human) - Heroic JRPG Kingdom

| Property | Value |
|----------|-------|
| **Key Signatures** | D major (exploration), D minor (battle) |
| **Tempo** | Moderate, march-like |
| **Signature Instruments** | French horns, orchestral strings, folk guitar |
| **Mood** | Triumphant, hopeful, adventurous |
| **Cultural Markers** | Fanfares, village warmth, classic 16-bit JRPG nostalgia |

**Example Exploration Prompt:**
```
"Heroic orchestral JRPG exploration in D major with triumphant French horns and sweeping strings and adventurous medieval village atmosphere with classic 16-bit nostalgia feel at moderate march tempo"
```

**Example Tavern Prompt:**
```
"Cozy medieval tavern music in D major with warm acoustic guitar and jolly fiddle and welcoming inn atmosphere with crackling fireplace warmth at upbeat folk jig tempo"
```

### Sylvan Reaches (Elf) - Ethereal Ancient Forest

| Property | Value |
|----------|-------|
| **Key Signatures** | A major (exploration), A minor (battle) |
| **Tempo** | Flowing, gentle |
| **Signature Instruments** | Harps, flutes, celeste, ethereal pads |
| **Mood** | Mystical, serene, ancient wisdom |
| **Cultural Markers** | Crystalline arpeggios, moonlit serenity, nature whispers |

**Example Exploration Prompt:**
```
"Ethereal elven forest theme in A major with flowing harp arpeggios and celestial flute melody and mystical moonlit serenity with ancient timeless wisdom at gentle flowing tempo"
```

**Example Ruins Prompt:**
```
"Ancient elven ruins theme in A minor with haunting choir and ethereal strings and mystical melancholy of forgotten gods at slow contemplative tempo"
```

### Iron Depths (Dwarf) - Industrial Underground Kingdom

| Property | Value |
|----------|-------|
| **Key Signatures** | E minor (both) |
| **Tempo** | Steady, rhythmic pulse |
| **Signature Instruments** | Deep brass, anvil percussion, pipe organ |
| **Mood** | Proud, industrious, cavernous |
| **Cultural Markers** | Forge hammering, echoing caverns, mountain majesty |

**Example Exploration Prompt:**
```
"Deep dwarven forge theme in E minor with resonant brass and anvil percussion and proud industrial atmosphere with echoing cavernous depths at steady rhythmic pulse"
```

**Example Tavern Prompt:**
```
"Hearty dwarven drinking hall music in E minor with accordion and stomping rhythms and boisterous celebration with tankards slamming at robust merry tempo"
```

### Shadowmere (Vampire) - Gothic Aristocratic Darkness

| Property | Value |
|----------|-------|
| **Key Signatures** | B minor (both) |
| **Tempo** | Stately, with urgency |
| **Signature Instruments** | Harpsichord, pipe organ, minor strings, choir |
| **Mood** | Elegant, menacing, nocturnal |
| **Cultural Markers** | Gothic ornaments, aristocratic tension, eternal night |

**Example Exploration Prompt:**
```
"Gothic vampire theme in B minor with ornate harpsichord and haunting pipe organ and elegant nocturnal menace with aristocratic tension at stately tempo with dark urgency"
```

**Example Shop Prompt:**
```
"Mysterious vampire night market in B minor with soft harpsichord and minor strings and dangerous elegance with candlelit shadows at unhurried mysterious tempo"
```

### Bloodplains (Orc) - Primal Tribal Warland

| Property | Value |
|----------|-------|
| **Key Signatures** | G minor (both) |
| **Tempo** | Driving, aggressive |
| **Signature Instruments** | War drums, bone percussion, tribal chants, low brass |
| **Mood** | Savage, powerful, tribal |
| **Cultural Markers** | Pounding rhythm, battle fury, primal energy |

**Example Exploration Prompt:**
```
"Primal orc war theme in G minor with thunderous war drums and tribal bone percussion and savage battle fury with primal aggressive energy at driving relentless tempo"
```

**Example Fishing Prompt:**
```
"Primal orc fishing music in G minor with sparse tribal drums and bone flute and patient hunter atmosphere with volcanic steam rising at slow deliberate tempo"
```

---

## Quick Reference

### SFX Comma Limits

| Commas | Status |
|--------|--------|
| 0 | Best |
| 1 | OK |
| 2+ | BLOCKED |

### Regional Key Signatures

| Region | Exploration | Battle |
|--------|-------------|--------|
| Heartlands | D major | D minor |
| Sylvan Reaches | A major | A minor |
| Iron Depths | E minor | E minor |
| Shadowmere | B minor | B minor |
| Bloodplains | G minor | G minor |

### Regional Instrument Palette

| Region | Primary | Secondary | Accent |
|--------|---------|-----------|--------|
| Heartlands | French horns | Orchestral strings | Folk guitar |
| Sylvan Reaches | Harps | Flutes | Celeste |
| Iron Depths | Deep brass | Anvil percussion | Pipe organ |
| Shadowmere | Harpsichord | Pipe organ | Minor strings |
| Bloodplains | War drums | Bone percussion | Low brass |

### Validation Commands

```bash
# Check all SFX prompts (dry run)
npm run audio:generate:sfx -- --dry-run

# Check all music prompts
npm run audio:validate

# Full audio status check
npm run audio:status
```

---

*Last updated: 2026-01-21*
