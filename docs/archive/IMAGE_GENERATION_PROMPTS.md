# Image Generation Prompts Archive

This document archives the creative prompt templates used for AI-generated pixel art sprites in the Modia MMORPG. These prompts are vendor-agnostic and can be adapted for any image generation service.

> **Note:** This is an archive document. The original integration has been removed from the codebase.

---

## Table of Contents

1. [Style Conventions](#style-conventions)
2. [Terrain Tiles](#terrain-tiles)
3. [Obstacles](#obstacles)
4. [Characters](#characters)
5. [Races](#races)
6. [Equipment](#equipment)
7. [Enemies](#enemies)
8. [World Map Nodes](#world-map-nodes)
9. [Items](#items)
10. [Materials & Modifiers](#materials--modifiers)
11. [Portraits](#portraits)
12. [Animation Actions](#animation-actions)
13. [Size Guidelines](#size-guidelines)
14. [Prompt Building Functions](#prompt-building-functions)

---

## Style Conventions

### Base Style Suffix
Append to all prompts for consistent visual style:
```
pixel art, 16-bit fantasy RPG, consistent lighting from top-left, cohesive color palette
```

### Isometric Suffix
For isometric tiles and terrain:
```
isometric diamond tile, 64x64 pixel canvas, seamless edges that blend with adjacent tiles, flat ground plane
```

### Terrain Style (Combined)
```
isometric diamond tile, 64x64 pixel canvas, seamless edges that blend with adjacent tiles, flat ground plane, pixel art, 16-bit fantasy RPG, consistent lighting from top-left, cohesive color palette
```

---

## Terrain Tiles

Terrain names match the game's biome system. Each terrain type has 4 variants.

### Forest Biome

**Grass (walkable, 60%):**
- Lush green grass, forest floor, SEAMLESS EDGES on all sides, tileable texture
- Green meadow grass, natural variation, EDGES MUST BLEND with adjacent tiles
- Vibrant grass with subtle details, CONTINUOUS PATTERN at borders, soft green
- Forest grass, earthy green, TILEABLE seamless texture, consistent coloring

**Stone (walkable, 10%):**
- Gray cobblestone path, SEAMLESS EDGES, tileable stone pattern
- Weathered stone tiles, EDGES BLEND seamlessly, gray-brown tones
- Flat stone floor, CONTINUOUS PATTERN at borders, natural walkway
- Old stone pavement, TILEABLE texture, consistent gray surface

**Dense Forest (impassable, 25%):**
- Dense undergrowth, ferns and brambles, SEAMLESS EDGES, dark green
- Thick forest floor, tangled vegetation, EDGES BLEND with adjacent
- Overgrown thicket, natural barrier, TILEABLE pattern, deep shadows
- Dense foliage, forest obstacle, SEAMLESS borders, consistent green

**Rock (impassable, 5%):**
- Rocky ground, mossy patches, SEAMLESS EDGES, forest rocks
- Stone debris, lichen covered, EDGES BLEND seamlessly, gray-green
- Rocky terrain, moss patches, TILEABLE texture, forest setting
- Boulder ground, ancient stones, SEAMLESS pattern, forest rock

### Cave Biome

**Stone (walkable, 50%):**
- Dark cave stone floor, SEAMLESS EDGES, tileable dungeon texture
- Gray cavern floor, EDGES BLEND seamlessly, worn rock surface
- Smooth cave stone, TILEABLE pattern, underground path
- Dungeon floor, SEAMLESS borders, dark gray stone texture

**Grass/Moss (walkable, 10%):**
- Cave moss patch, SEAMLESS EDGES, underground vegetation
- Subterranean moss, EDGES BLEND with adjacent, pale green growth
- Underground moss carpet, TILEABLE texture, soft green glow
- Cave flora, SEAMLESS pattern, fungal grass ground

**Rock (impassable, 20%):**
- Jagged cave rocks, SEAMLESS EDGES, rocky debris ground
- Broken stone debris, EDGES BLEND seamlessly, cave rubble
- Sharp rock ground, TILEABLE texture, cave obstacle
- Cave rock debris, SEAMLESS pattern, unstable ground

**Water (impassable, 15%):**
- Underground pool, SEAMLESS EDGES, dark cave water
- Subterranean water, EDGES BLEND seamlessly, deep blue-black
- Cave stream, TILEABLE pattern, dark flowing water
- Cave water pool, SEAMLESS borders, murky surface

**Lava (impassable, 5%):**
- Molten lava pool, SEAMLESS EDGES, glowing orange
- Lava flow, EDGES BLEND seamlessly, bright orange magma
- Volcanic fissure, TILEABLE pattern, glowing red lava
- Magma pool, SEAMLESS borders, fiery orange glow

### Mountain Biome

**Stone (walkable, 40%):**
- Mountain rock surface, SEAMLESS EDGES, gray alpine stone
- Weathered mountain path, EDGES BLEND seamlessly, highland walkway
- Rocky plateau, TILEABLE pattern, flat stone surface
- Mountain granite floor, SEAMLESS borders, cold gray stone

**Grass (walkable, 20%):**
- Alpine grass, SEAMLESS EDGES, sparse highland vegetation
- Mountain meadow, EDGES BLEND with adjacent, short tough grass
- Rocky grass ground, TILEABLE texture, sparse green growth
- Highland grass, SEAMLESS pattern, wind-swept vegetation

**Rock (impassable, 30%):**
- Mountain boulder ground, SEAMLESS EDGES, rocky debris
- Jagged rock terrain, EDGES BLEND seamlessly, alpine obstacle
- Rocky debris ground, TILEABLE texture, mountain stones
- Alpine rock formation, SEAMLESS pattern, stone debris

**Cliff (impassable, 10%):**
- Cliff edge terrain, SEAMLESS EDGES, dangerous precipice
- Steep cliff ground, EDGES BLEND seamlessly, rocky ledge
- Mountain cliff edge, TILEABLE pattern, sheer rock
- Precipice ground, SEAMLESS borders, crumbling cliff

### Bridge Biome

**Stone (walkable, 60%):**
- Bridge stone tiles, SEAMLESS EDGES, ancient masonry
- Cobblestone bridge, EDGES BLEND seamlessly, weathered gray stone
- Stone bridge deck, TILEABLE pattern, medieval construction
- Ancient bridge stones, SEAMLESS borders, worn smooth surface

**Grass (walkable, 10%):**
- Bridge edge grass, SEAMLESS EDGES, moss on stone
- Grass at bridge base, EDGES BLEND with adjacent, green vegetation
- Overgrown bridge section, TILEABLE texture, grass through cracks
- Riverbank grass, SEAMLESS pattern, bridge approach ground

**Water (impassable, 30%):**
- River water, SEAMLESS EDGES, flowing blue stream
- Deep river, EDGES BLEND seamlessly, rushing water
- Stream flow, TILEABLE pattern, blue-green water
- River current, SEAMLESS borders, flowing water surface

### Castle Biome

**Stone (walkable, 70%):**
- Castle floor tiles, SEAMLESS EDGES, polished stone
- Dungeon stone floor, EDGES BLEND seamlessly, gray brick surface
- Castle courtyard stone, TILEABLE pattern, formal pavement
- Throne room floor, SEAMLESS borders, ornate stone tiles

**Grass (walkable, 30%):**
- Castle garden grass, SEAMLESS EDGES, manicured lawn
- Courtyard grass, EDGES BLEND with adjacent, formal green
- Fortress lawn, TILEABLE texture, well-kept grass
- Royal garden ground, SEAMLESS pattern, lush castle grass

---

## Obstacles

### Rocks
| Key | Prompt |
|-----|--------|
| rock_small | Small gray boulder, mossy patches, fantasy RPG obstacle |
| rock_medium | Medium rock formation, weathered stone, natural obstacle |
| rock_large | Large imposing boulder, ancient moss-covered stone |
| stalagmite | Dark cave stalagmite, crystalline formation, underground |
| mountain_boulder | Snow-dusted mountain boulder, alpine rock |

### Trees
| Key | Prompt |
|-----|--------|
| oak_tree | Large oak tree, thick trunk, lush green canopy, fantasy forest |
| pine_tree | Tall pine tree, dark green needles, forest conifer |
| dead_tree | Gnarled dead tree, bare twisted branches, spooky |
| mushroom_large | Giant glowing mushroom, bioluminescent cap, cave flora |
| mountain_pine | Hardy mountain pine, snow on branches, alpine tree |

---

## Characters

### Base Class Prompts
| Class | Prompt |
|-------|--------|
| warrior | Medieval fantasy warrior, heavy plate armor, sword and shield, heroic stance |
| wizard | Fantasy wizard, flowing blue robes, pointed hat, magical staff with crystal |
| monk | Fantasy martial artist monk, simple brown gi, wrapped hands, fighting stance |
| chemist | Fantasy alchemist, leather apron, brass goggles, potion belt |

---

## Races

### Race Visual Traits
| Race | Base | Traits | Skin Tone |
|------|------|--------|-----------|
| human | human | average build, determined expression | natural skin tone |
| elf | elf | pointed ears, slender build, graceful features | fair pale skin, ethereal glow |
| dwarf | dwarf | short stocky build, thick beard, broad shoulders | ruddy complexion |
| vampire | vampire | pale undead, fangs visible, crimson eyes, dark elegant | deathly pale skin, dark veins |
| orc | orc | green skin, tusks, muscular brutish build | green-gray skin |

---

## Equipment

### Weapons
| Key | Description |
|-----|-------------|
| oak_staff | wooden oak staff, simple design |
| crystal_staff | crystalline staff, glowing blue crystal orb |
| enchanted_staff | enchanted staff, magical runes, pulsing energy |
| dark_staff | dark obsidian staff, shadowy wisps |
| rusty_sword | rusty iron sword, worn blade |
| iron_sword | iron sword, simple but sturdy |
| steel_sword | polished steel longsword |
| dagger | curved dagger, sharp blade |
| bow | longbow, polished wood |

### Armor
| Key | Description |
|-----|-------------|
| cloth_robe | simple cloth robe |
| apprentice_robe | apprentice wizard robes, basic arcane trim |
| wizard_robe | flowing blue wizard robes, arcane symbols |
| archmage_robe | ornate archmage robes, powerful enchantments glowing |
| leather_armor | brown leather armor, practical |
| chain_mail | chain mail armor, metal links |
| plate_armor | shining plate armor, full coverage |

---

## Enemies

### Forest Enemies
| Key | Prompt |
|-----|--------|
| gray_wolf | Fierce gray wolf, snarling stance, forest predator |
| alpha_wolf | Large alpha wolf, scarred, commanding presence, glowing eyes |
| goblin_warrior | Green goblin warrior, crude armor, jagged sword |
| goblin_archer | Goblin archer, leather scraps, shortbow, sneaky pose |
| treant | Ancient treant, bark armor, glowing green eyes, tree creature |
| forest_sprite | Ethereal forest sprite, glowing wings, nature magic, tiny fey |
| spider | Giant forest spider, dark chitin, venomous fangs, hairy legs |
| forest_slime | Green forest slime, gelatinous blob body, dripping ooze, transparent |

### Cave Enemies
| Key | Prompt |
|-----|--------|
| stone_golem | Massive stone golem, rocky body, glowing runes, construct |
| skeleton_warrior | Armored skeleton warrior, rusted sword and shield, undead |
| skeleton_mage | Skeleton mage, tattered robes, purple energy, skull staff |
| cave_bat | Giant cave bat, dark fur, red eyes, leathery wings |
| slime | Green dungeon slime, gelatinous body, acidic drip, blob |
| ghost | Translucent ghost, spectral pale form, haunting presence |

### Mountain Enemies
| Key | Prompt |
|-----|--------|
| mountain_troll | Massive mountain troll, gray warty skin, wooden club |
| troll_shaman | Troll shaman, bone decorations, tribal markings, totems |
| harpy | Fierce harpy, feathered wings, taloned feet, shrieking |
| ice_elemental | Frost elemental, crystalline ice body, cold blue aura |
| yeti | Massive yeti, white fur, icy breath, apex predator |
| gargoyle | Stone gargoyle, demonic features, bat wings, perched |

### Bridge Enemies
| Key | Prompt |
|-----|--------|
| bandit_captain | Human bandit captain, leather armor, dual swords, scarred |
| bandit_archer | Bandit archer, hooded cloak, longbow drawn |
| bandit_rogue | Bandit rogue, dark cloak, dual daggers, shadowy |
| mercenary | Armored mercenary, heavy shield, professional soldier |
| toll_troll | Bridge troll, greedy expression, coin bag, blocking |

### Bosses
| Key | Prompt |
|-----|--------|
| troll_king | Mighty troll king, bone crown, massive spiked club, boss |
| frost_wyvern | Frost wyvern, icy blue scales, frozen breath, wings |
| dragon | Ancient dragon, gold and red scales, fire breath, ultimate boss |

---

## World Map Nodes

| Key | Prompt |
|-----|--------|
| castle | Medieval stone castle, tall towers, red banners, imposing, top-down |
| city | Walled medieval city, market square, church spire, bustling, top-down |
| village | Small rustic village, thatched cottages, windmill, peaceful, top-down |
| forest | Dense enchanted forest, tall trees, mysterious paths, top-down |
| cave | Dark cave entrance, rocky formations, torches, crystals |
| mountain | Snow-capped mountain peak, rocky cliffs, dramatic |
| bridge | Ancient stone bridge, deep chasm, weathered ropes |
| palace | Grand royal palace, golden spires, ornate gates, gardens |
| guild_warrior | Warriors guild hall, crossed swords banner, training dummies |
| guild_wizard | Mages tower, glowing blue crystals, arcane symbols |
| guild_monk | Serene monastery, zen garden, martial arts grounds |
| guild_chemist | Alchemist workshop, bubbling cauldrons, potion bottles |

---

## Items

### Weapons
| Key | Prompt |
|-----|--------|
| sword | Medieval sword, steel blade, leather handle, weapon icon |
| axe | Battle axe, sharp steel head, wooden handle, viking |
| staff | Wizard staff, wooden shaft, glowing crystal orb, magical |
| dagger | Curved dagger, sharp blade, ornate handle, assassin |
| bow | Longbow, polished wood, tight string, elven style |

### Armor
| Key | Prompt |
|-----|--------|
| helmet | Steel helmet, medieval knight, visor, headgear icon |
| breastplate | Steel breastplate, medieval knight, chestpiece icon |
| boots | Armored boots, steel plated, leather straps, footwear icon |
| shield | Round shield, steel with wood, heraldic design |

### Accessories
| Key | Prompt |
|-----|--------|
| ring | Magical ring, gold band, glowing gemstone, enchanted |
| amulet | Mystical amulet, gold chain, glowing pendant |
| cloak | Flowing cloak, mysterious fabric, hood, magical |

### Consumables
| Key | Prompt |
|-----|--------|
| potion_red | Health potion, red liquid, cork stopper, healing |
| potion_blue | Mana potion, blue liquid, cork stopper, magic |
| potion_green | Stamina potion, green liquid, cork stopper, energy |
| scroll | Ancient scroll, rolled parchment, magical runes |

---

## Materials & Modifiers

### Material Modifiers
| Key | Description |
|-----|-------------|
| copper | copper colored, warm orange-brown metal |
| iron | dark iron, gray steel, sturdy |
| bronze | bronze metal, golden-brown, polished |
| steel | shining steel, silver-gray, fine quality |
| silver | gleaming silver, ethereal glow |
| gold | golden metal, ornate details, luxurious |
| platinum | platinum, pale silver-white, noble |
| mythril | mythril silver-blue, lightweight, magical shimmer |
| obsidian | obsidian black glass, sharp edges |
| adamantine | adamantine dark metal, indestructible |
| dragonbone | dragon bone white, scale patterns |
| celestial | celestial glowing, starlight sparkles, divine |

### Augment Modifiers (Elemental Effects)
| Key | Description |
|-----|-------------|
| fire | flames emanating, orange fire effects |
| ice | frost crystals, icy blue glow |
| lightning | electrical sparks, yellow-white lightning |
| life | green healing aura, nature energy |
| fortune | golden sparkles, lucky charms |
| power | red power aura, strength runes |
| wisdom | purple arcane glow, knowledge symbols |
| swift | motion blur, wind effects, speed lines |

### Rarity Modifiers
| Key | Description |
|-----|-------------|
| common | (no modifier) |
| uncommon | subtle green glow |
| rare | blue shimmer effect |
| epic | purple pulsing aura |
| legendary | golden particles, radiant glow |

---

## Portraits

### Gender Modifiers by Race

**Male:**
| Race | Prompt |
|------|--------|
| human | male human, strong jaw, short hair, determined expression |
| elf | male elf, pointed ears, angular features, long flowing hair, wise expression |
| dwarf | male dwarf, thick braided beard, broad nose, rugged features |
| vampire | male vampire, pale skin, fangs visible, crimson eyes, elegant aristocratic features |
| orc | male orc, green skin, prominent tusks, battle scars, fierce expression |

**Female:**
| Race | Prompt |
|------|--------|
| human | female human, soft features, flowing hair, determined expression |
| elf | female elf, pointed ears, delicate features, long graceful hair, serene expression |
| dwarf | female dwarf, braided hair with beads, strong features, practical look |
| vampire | female vampire, pale skin, fangs visible, crimson eyes, elegant beautiful features |
| orc | female orc, green skin, smaller tusks, fierce expression, braided warrior hair |

**Other/Androgynous:**
| Race | Prompt |
|------|--------|
| human | androgynous human, neutral features, determined expression |
| elf | androgynous elf, pointed ears, ethereal features, mysterious expression |
| dwarf | androgynous dwarf, strong features, practical hairstyle with runes |
| vampire | androgynous vampire, pale skin, fangs visible, crimson eyes, elegant haunting features |
| orc | androgynous orc, green skin, tusks, fierce expression |

### Class Modifiers
| Class | Modifier |
|-------|----------|
| warrior | wearing warrior helm glimpse, battle-hardened, confident |
| wizard | wearing wizard hat hint, arcane knowledge in eyes, thoughtful |
| monk | serene centered expression, inner strength, disciplined |
| chemist | brass goggles on forehead, curious intelligent expression, vials visible |
| berserker | war paint markings, wild fierce eyes, battle rage |
| sorcerer | glowing magical eyes, arcane energy visible, powerful |
| ninja | face mask pulled down, alert watchful expression, deadly calm |
| alchemist | multiple lenses on goggles, chemical stains, brilliant expression |

---

## Animation Actions

### Character Class Animations

**Warrior:**
| State | Action |
|-------|--------|
| idle | warrior standing alert, sword and shield ready, defensive stance |
| walk | warrior walking forward, heavy armor clanking, shield raised |
| attack | warrior powerful sword slash, shield forward, aggressive |
| hit | warrior recoiling, shield absorbing blow, staggered |
| death | warrior falling to knees, sword dropping, defeated |

**Wizard:**
| State | Action |
|-------|--------|
| idle | wizard standing calm, staff resting, robes flowing gently |
| walk | wizard walking steadily, robes billowing, staff in hand |
| attack | wizard casting spell, staff raised high, magical energy burst |
| hit | wizard stumbling back, magical shield flicker, stunned |
| death | wizard collapsing, robes settling, staff falling, defeated |

**Monk:**
| State | Action |
|-------|--------|
| idle | monk centered breathing, martial arts stance, focused |
| walk | monk light-footed movement, balanced stride, ready |
| attack | monk rapid punch combo, ki energy flowing, fierce |
| hit | monk nimble dodge attempt, taking hit, recovering |
| death | monk graceful collapse, peaceful expression, accepting |

**Chemist:**
| State | Action |
|-------|--------|
| idle | chemist examining potion flask, curious expression, analyzing |
| walk | chemist careful movement, protecting potions, cautious |
| attack | chemist throwing potion, arc motion, explosive |
| hit | chemist potion splash, chemical spill, stumbling |
| death | chemist flask shattering, collapsing, smoke rising |

### Enemy Animations

**Gray Wolf:**
- idle: wolf standing alert, ears perked, watching
- walk: wolf prowling forward, hunting stance
- attack: wolf lunging forward, jaws open, biting attack
- hit: wolf recoiling, pain reaction, yelping
- death: wolf collapsing, falling to ground

**Goblin Warrior:**
- idle: goblin warrior standing guard, sword ready
- walk: goblin warrior marching, aggressive stride
- attack: goblin warrior slashing sword overhead
- hit: goblin warrior staggering back, hit reaction
- death: goblin warrior falling defeated

**Treant:**
- idle: treant standing still, branches swaying
- walk: treant lumbering forward, roots moving
- attack: treant sweeping branches, crushing blow
- hit: treant shuddering, bark cracking
- death: treant toppling, falling timber

**Forest Sprite:**
- idle: sprite hovering, wings shimmering
- walk: sprite floating forward, trail of sparkles
- attack: sprite casting nature magic, leaves swirling
- hit: sprite flickering, magical shield breaking
- death: sprite fading, dissolving into light

**Spider:**
- idle: spider crouched, legs twitching
- walk: spider crawling forward, legs moving
- attack: spider lunging, fangs extended, venom dripping
- hit: spider recoiling, legs curling
- death: spider collapsing, legs curling inward

---

## Size Guidelines

### Sprite Sizes
| Entity Type | Size | Notes |
|-------------|------|-------|
| Player characters | 64x64 | Character occupies ~60% of canvas height |
| Small enemies (wolf, goblin) | 48x48 | Fits scale of encounters |
| Medium enemies (treant, golem) | 80x80 | Larger presence |
| Boss enemies | 112-144px | Imposing size |
| Equipment overlays | 64x64 | Same as character for alignment |
| Terrain tiles | 64x64 | Isometric diamond shape |
| Item icons | 32x32 | Inventory display |
| World map nodes | 48-72px | Visible on world map |
| Character portraits | 64x64 | Head and shoulders |

### 8-Directional Sprite Sheet Layout
```
Row 0: South (facing camera)        - Direction 0
Row 1: Southwest                    - Direction 1
Row 2: West                         - Direction 2
Row 3: Northwest                    - Direction 3
Row 4: North (facing away)          - Direction 4
Row 5: Northeast                    - Direction 5
Row 6: East                         - Direction 6
Row 7: Southeast                    - Direction 7
```

---

## Prompt Building Functions

### Build Equipped Character Prompt
```
function buildEquippedCharacterPrompt(race, charClass, weapon, armor):
  raceInfo = RACE_PROMPTS[race] or RACE_PROMPTS.human
  weaponDesc = EQUIPMENT.weapons[weapon] or 'magical staff'
  armorDesc = EQUIPMENT.armor[armor] or 'wizard robes'

  return "Fantasy {raceInfo.base} {charClass}, {raceInfo.traits}, " +
    "{raceInfo.skinTone}, wielding {weaponDesc}, wearing {armorDesc}, " +
    "heroic stance, {STYLE_SUFFIX}"
```

### Build Portrait Prompt
```
function buildPortraitPrompt(race, gender, charClass):
  genderPrompts = PORTRAIT_GENDER_MODIFIERS[gender] or PORTRAIT_GENDER_MODIFIERS.other
  basePrompt = genderPrompts[race] or genderPrompts.human
  classModifier = PORTRAIT_CLASS_MODIFIERS[charClass] or PORTRAIT_CLASS_MODIFIERS.warrior

  return "Close-up portrait, head and shoulders, {basePrompt}, {classModifier}, " +
    "facing forward, fantasy RPG character portrait, 64x64, {STYLE_SUFFIX}"
```

### Build Animation Prompt
```
function buildAnimationPrompt(entityType, name, animation):
  actions = ANIMATION_ACTIONS[entityType][name]
  if not actions:
    return null
  return actions[animation] or actions.idle
```

---

## Style Parameters Reference

### Outline Options
| Value | Description |
|-------|-------------|
| single color outline | Retro aesthetic, consistent black outline |
| selective outline | Smart outline based on contrast (recommended) |
| lineless | Modern appearance, no outlines |

### Shading Options
| Value | Description |
|-------|-------------|
| flat shading | Minimal shading, flat colors |
| basic shading | Simple light/dark |
| medium shading | Balanced shading (recommended) |
| detailed shading | More depth and volume |
| highly detailed shading | Maximum shading complexity |

### Detail Options
| Value | Description |
|-------|-------------|
| low detail | Simplified features |
| medium detail | Balanced detail (recommended for 64x64) |
| highly detailed | Maximum detail |

---

*Archived: 2026-01-11*
