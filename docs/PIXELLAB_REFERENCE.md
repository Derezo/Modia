# PixelLab API Reference

This document provides a comprehensive reference for using the PixelLab API in the Modia MMORPG project for generating pixel art sprites.

## Table of Contents

1. [API Endpoints](#api-endpoints)
2. [Animation Templates](#animation-templates)
3. [Style Parameters](#style-parameters)
4. [Size Guidelines](#size-guidelines)
5. [Sprite Sheet Layout](#sprite-sheet-layout)
6. [Prompt Best Practices](#prompt-best-practices)
7. [Race-Specific Prompts](#race-specific-prompts)
8. [Equipment Prompts](#equipment-prompts)
9. [Animation Prompts](#animation-prompts)
10. [Validation Workflow](#validation-workflow)

---

## API Endpoints

### Character Generation

| Endpoint | Purpose | Key Parameters |
|----------|---------|----------------|
| `/create-character-with-8-directions` | Base character sprite with 8 rotations | description, image_size, outline, shading, detail, isometric |
| `/create-character-with-4-directions` | Base character with 4 cardinal directions | description, image_size, outline, shading, detail, isometric |
| `/characters/animations` | Generate animations for existing character | character_id, animation_template, directions |
| `/characters/:id` | Get character details | - |
| `/characters/:id/zip` | Export character with animations as ZIP | - |

### Animation

| Endpoint | Purpose | Key Parameters |
|----------|---------|----------------|
| `/animate-with-text-v2` | Text-based animation generation | character_description, action_description, image_size |

### Image Generation

| Endpoint | Purpose | Key Parameters |
|----------|---------|----------------|
| `/generate-image-v2` | Synchronous image generation | description, image_size, seed, no_background |
| `/create-image-pixflux` | Flexible sizing with style options | description, width, height, outline, shading, detail, view, isometric |
| `/map-objects` | Transparent background objects | description, image_size, view, isometric |

### Tileset Generation

| Endpoint | Purpose | Key Parameters |
|----------|---------|----------------|
| `/create-isometric-tile` | Isometric tile generation | description, image_size, isometric_tile_shape |
| `/create-tileset` | Wang tileset with terrain transitions | description, tile_size, terrain_level, transition_size |

---

## Animation Templates

Available templates for the `animation_template` parameter in `/characters/animations`:

| Template | Frames | Description |
|----------|--------|-------------|
| `breathing-idle` | 4 | Character breathing in place, subtle movement |
| `walking` | 8 | Full walk cycle animation |
| `attack-forward` | 6 | Melee attack animation |
| `hit-react` | 4 | Taking damage reaction |
| `death-fall` | 8 | Death sequence animation |

### Animation State Mapping

```javascript
const ANIMATION_STATE_MAP = {
  idle: 'breathing-idle',
  walk: 'walking',
  attack: 'attack-forward',
  hit: 'hit-react',
  death: 'death-fall'
};
```

---

## Style Parameters

### Recommended Values for Consistent Style

```javascript
const STYLE_CONFIG = {
  outline: 'selective outline',  // Best balance of detail and clarity
  shading: 'medium shading',     // Good depth without being too busy
  detail: 'medium detail',       // Suitable for 64x64 sprites
  isometric: true                // For isometric game view
};
```

### Outline Options

| Value | Description |
|-------|-------------|
| `single color outline` | Retro aesthetic, consistent black outline |
| `selective outline` | Smart outline based on contrast (recommended) |
| `lineless` | Modern appearance, no outlines |

### Shading Options

| Value | Description |
|-------|-------------|
| `flat shading` | Minimal shading, flat colors |
| `basic shading` | Simple light/dark |
| `medium shading` | Balanced shading (recommended) |
| `detailed shading` | More depth and volume |
| `highly detailed shading` | Maximum shading complexity |

### Detail Options

| Value | Description |
|-------|-------------|
| `low detail` | Simplified features |
| `medium detail` | Balanced detail (recommended for 64x64) |
| `highly detailed` | Maximum detail |

---

## Size Guidelines

### Character Sprites

| Entity Type | Size | Notes |
|-------------|------|-------|
| Player characters | 64x64 | Character occupies ~60% of canvas height |
| Small enemies (wolf, goblin) | 48x48 | Fits scale of encounters |
| Medium enemies (treant, golem) | 80x80 | Larger presence |
| Boss enemies | 112-144px | Imposing size |
| Equipment overlays | 64x64 | Same as character for alignment |

### Terrain Tiles

| Type | Size |
|------|------|
| Isometric tiles | 64x64 |
| Wang tileset | 16x16 or 32x32 |

### Items and Icons

| Type | Size |
|------|------|
| Item icons | 32x32 |
| World map nodes | 48-72px |

---

## Sprite Sheet Layout

### 8-Directional Sprite Sheet Structure

```
Rows = Directions (0-7)
Columns = Animation Frames

Row 0: South (facing camera)        - Direction 0
Row 1: Southwest                    - Direction 1
Row 2: West                         - Direction 2
Row 3: Northwest                    - Direction 3
Row 4: North (facing away)          - Direction 4
Row 5: Northeast                    - Direction 5
Row 6: East                         - Direction 6
Row 7: Southeast                    - Direction 7
```

### Frame Selection Formula

```javascript
function getFrameRect(direction, frame, frameWidth, frameHeight) {
  return {
    x: frame * frameWidth,
    y: direction * frameHeight,
    width: frameWidth,
    height: frameHeight
  };
}
```

### Direction Constants

```javascript
const DIRECTIONS = {
  SOUTH: 0,
  SOUTHWEST: 1,
  WEST: 2,
  NORTHWEST: 3,
  NORTH: 4,
  NORTHEAST: 5,
  EAST: 6,
  SOUTHEAST: 7
};
```

---

## Prompt Best Practices

### Structure

A well-formed prompt follows this pattern:

```
[Race] [Class], [Physical Traits], [Skin/Coloring], [Equipment], [Pose/Action], [Style Suffix]
```

### Style Suffix

Always append the consistent style suffix:

```javascript
const STYLE_SUFFIX = 'pixel art, 16-bit fantasy RPG, consistent lighting from top-left, cohesive color palette';
```

### Do's and Don'ts

**Do:**
- Be specific about physical traits (pointed ears, fangs, tusks)
- Include equipment details (wielding, wearing)
- Describe pose or action clearly
- Use consistent terminology across related sprites

**Don't:**
- Use vague descriptions ("cool wizard")
- Mix conflicting styles
- Overcomplicate with too many details
- Forget the style suffix

---

## Race-Specific Prompts

### Race Visual Traits

```javascript
const RACE_PROMPTS = {
  human: {
    base: 'human',
    traits: 'average build, determined expression',
    skinTone: 'natural skin tone'
  },
  elf: {
    base: 'elf',
    traits: 'pointed ears, slender build, graceful features',
    skinTone: 'fair pale skin, ethereal glow'
  },
  dwarf: {
    base: 'dwarf',
    traits: 'short stocky build, thick beard, broad shoulders',
    skinTone: 'ruddy complexion'
  },
  vampire: {
    base: 'vampire',
    traits: 'pale undead, fangs visible, crimson eyes, dark elegant',
    skinTone: 'deathly pale skin, dark veins'
  },
  orc: {
    base: 'orc',
    traits: 'green skin, tusks, muscular brutish build',
    skinTone: 'green-gray skin'
  }
};
```

### Building Race+Class Prompts

```javascript
function buildCharacterPrompt(race, charClass, weapon, armor) {
  const raceInfo = RACE_PROMPTS[race];
  const weaponDesc = weapon || 'no weapon';
  const armorDesc = armor || 'simple clothes';

  return `Fantasy ${raceInfo.base} ${charClass}, ${raceInfo.traits}, ` +
    `${raceInfo.skinTone}, wielding ${weaponDesc}, wearing ${armorDesc}, ` +
    `heroic stance, ${STYLE_SUFFIX}`;
}
```

### Example Outputs

| Race | Class | Generated Prompt |
|------|-------|------------------|
| Human | Wizard | "Fantasy human wizard, average build, determined expression, natural skin tone, wielding crystal staff, wearing wizard robes, heroic stance, pixel art..." |
| Elf | Wizard | "Fantasy elf wizard, pointed ears, slender build, graceful features, fair pale skin, ethereal glow, wielding enchanted staff, wearing flowing robes, heroic stance, pixel art..." |
| Orc | Wizard | "Fantasy orc wizard, green skin, tusks, muscular brutish build, green-gray skin, wielding oak staff, wearing heavy robes, heroic stance, pixel art..." |

---

## Equipment Prompts

### Weapon Descriptions

```javascript
const WEAPON_PROMPTS = {
  // Staves
  oak_staff: 'wooden oak staff, simple design',
  crystal_staff: 'crystalline staff, glowing blue crystal orb',
  enchanted_staff: 'enchanted staff, magical runes, pulsing energy',
  dark_staff: 'dark obsidian staff, shadowy wisps',

  // Swords
  rusty_sword: 'rusty iron sword, worn blade',
  iron_sword: 'iron sword, simple but sturdy',
  steel_sword: 'polished steel longsword',

  // Other
  dagger: 'curved dagger, sharp blade',
  bow: 'longbow, polished wood'
};
```

### Armor Descriptions

```javascript
const ARMOR_PROMPTS = {
  // Robes
  cloth_robe: 'simple cloth robe',
  apprentice_robe: 'apprentice wizard robes, basic arcane trim',
  wizard_robe: 'flowing blue wizard robes, arcane symbols',
  archmage_robe: 'ornate archmage robes, powerful enchantments glowing',

  // Armor
  leather_armor: 'brown leather armor, practical',
  chain_mail: 'chain mail armor, metal links',
  plate_armor: 'shining plate armor, full coverage'
};
```

---

## Animation Prompts

### Forest Enemy Animations

```javascript
const ENEMY_ANIMATION_ACTIONS = {
  gray_wolf: {
    idle: 'wolf standing alert, ears perked, watching',
    walk: 'wolf prowling forward, hunting stance',
    attack: 'wolf lunging forward, jaws open, biting attack',
    hit: 'wolf recoiling, pain reaction, yelping',
    death: 'wolf collapsing, falling to ground'
  },
  goblin_warrior: {
    idle: 'goblin warrior standing guard, sword ready',
    walk: 'goblin warrior marching, aggressive stride',
    attack: 'goblin warrior slashing sword overhead',
    hit: 'goblin warrior staggering back, hit reaction',
    death: 'goblin warrior falling defeated'
  },
  treant: {
    idle: 'treant standing still, branches swaying',
    walk: 'treant lumbering forward, roots moving',
    attack: 'treant sweeping branches, crushing blow',
    hit: 'treant shuddering, bark cracking',
    death: 'treant toppling, falling timber'
  },
  forest_sprite: {
    idle: 'sprite hovering, wings shimmering',
    walk: 'sprite floating forward, trail of sparkles',
    attack: 'sprite casting nature magic, leaves swirling',
    hit: 'sprite flickering, magical shield breaking',
    death: 'sprite fading, dissolving into light'
  },
  spider: {
    idle: 'spider crouched, legs twitching',
    walk: 'spider crawling forward, legs moving',
    attack: 'spider lunging, fangs extended, venom dripping',
    hit: 'spider recoiling, legs curling',
    death: 'spider collapsing, legs curling inward'
  }
};
```

### Wizard Race Animations

```javascript
const WIZARD_ANIMATION_ACTIONS = {
  human: {
    idle: 'human wizard standing calm, staff resting, robes flowing gently, focused expression',
    walk: 'human wizard walking steadily, robes billowing, staff in hand, confident stride',
    attack: 'human wizard casting spell, staff raised high, magical energy burst, determined',
    hit: 'human wizard stumbling back, magical shield flicker, stunned expression',
    death: 'human wizard collapsing, robes settling, staff falling, defeated'
  },
  elf: {
    idle: 'elf wizard standing gracefully, staff glowing softly, ethereal presence, pointed ears visible',
    walk: 'elf wizard gliding elegantly, robes flowing, staff trailing magic, light-footed',
    attack: 'elf wizard casting spell, staff blazing, arcane runes orbiting, fierce elegance',
    hit: 'elf wizard recoiling gracefully, magical barrier shimmering, pained expression',
    death: 'elf wizard falling gracefully, robes spreading, staff dimming, serene'
  },
  dwarf: {
    idle: 'dwarf wizard standing sturdy, staff planted firmly, beard braided, runes on armor',
    walk: 'dwarf wizard marching steadily, heavy robes, staff thumping ground, determined',
    attack: 'dwarf wizard casting earth magic, staff erupting power, beard flapping, fierce',
    hit: 'dwarf wizard bracing impact, magical runes flashing, gritting teeth, stubborn',
    death: 'dwarf wizard falling heavily, staff clattering, beard spreading, stoic end'
  },
  vampire: {
    idle: 'vampire wizard standing menacingly, staff pulsing dark energy, crimson eyes glowing',
    walk: 'vampire wizard gliding forward, dark robes trailing, staff leaving shadow wisps',
    attack: 'vampire wizard casting dark magic, staff erupting crimson, fangs bared, sinister',
    hit: 'vampire wizard hissing in pain, dark shield shattering, recoiling dramatically',
    death: 'vampire wizard dissolving into shadows, staff crumbling, dramatic death pose'
  },
  orc: {
    idle: 'orc wizard standing powerfully, staff crackling energy, tusks prominent, intimidating',
    walk: 'orc wizard stomping forward, heavy robes, staff dragging sparks, aggressive',
    attack: 'orc wizard casting primal magic, staff exploding power, roaring, savage power',
    hit: 'orc wizard staggering back, magical barrier breaking, snarling in rage',
    death: 'orc wizard collapsing heavily, staff shattering, final defiant roar'
  }
};
```

---

## Validation Workflow

### Before Batch Generation

Always validate prompts with sample generation before running batch operations:

```bash
# Validate a single enemy prompt
npm run validate:sprites -- --type=enemy --name=gray_wolf

# Validate a character prompt
npm run validate:sprites -- --type=character --race=elf --class=wizard

# Validate with specific equipment
npm run validate:sprites -- --type=character --race=orc --class=wizard --weapon=oak_staff --armor=apprentice_robe
```

### Validation Output

Samples are saved to `.pixellab-cache/validation/` for review:
- `enemy_gray_wolf_sample.png`
- `character_elf_wizard_sample.png`
- `character_orc_wizard_oak_staff_apprentice_robe_sample.png`

### Iterative Refinement

1. Run validation for a prompt
2. Review the generated sample
3. Adjust prompt wording if needed
4. Re-validate until satisfied
5. Proceed with batch generation

---

## Cost Reference

| Size | Approximate Cost per Generation |
|------|--------------------------------|
| 32x32 | ~$0.008 |
| 64x64 | ~$0.013 |
| 128x128 | ~$0.016 |

### Batch Estimation

```javascript
function estimateBatchCost(count, size = 64) {
  const costPer = size <= 32 ? 0.008 : size <= 64 ? 0.013 : 0.016;
  return (count * costPer).toFixed(2);
}
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Rate limit (429) | Too many requests | Wait for `Retry-After` header duration |
| Server rate limit (529) | API overloaded | Exponential backoff |
| Job timeout | Generation took too long | Retry with simplified prompt |
| Invalid image size | Size out of range | Use 16-128 for characters |

### Retry Strategy

```javascript
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2
};
```

---

## References

- [PixelLab API Documentation](https://api.pixellab.ai/v1/docs)
- [PixelLab MCP Tools](https://api.pixellab.ai/mcp/docs)
- [Animation Tools Guide](https://www.pixellab.ai/docs/tools/animation)
- [Skeleton Animation](https://www.pixellab.ai/docs/tools/skeleton-animation)
