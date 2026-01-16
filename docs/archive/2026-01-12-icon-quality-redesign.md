# Icon Quality Redesign Plan

**Status: COMPLETED** (2026-01-12)

## Summary

Complete redesign of all 104 SVG icons from monochrome stroke-based outlines to full-color gradient-based icons with depth, highlights, and medieval aesthetic.

**Problem:** Current icons use `currentColor` with 15% opacity fills, resulting in thin black/brown outlines that look bland, lack visual weight, and don't match the parchment RPG theme.

**Solution:** Adopt the `gold.svg` pattern - explicit color gradients, layered fills for depth, highlights/shadows, and category-specific color palettes.

---

## Design Approach

### Icon Structure Pattern

Each icon follows a layered structure:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <!-- Drop shadow (optional, for grounded objects) -->
  <ellipse cx="13" cy="20" rx="6" ry="1.5" fill="#3d2a00" opacity="0.25"/>

  <!-- Base layer (darkest) -->
  <path d="..." fill="#8b5514"/>

  <!-- Mid layer (primary color) -->
  <path d="..." fill="#daa520"/>

  <!-- Highlight layer (brightest, offset toward light source) -->
  <path d="..." fill="#ffd700"/>

  <!-- Top highlight (small bright spot) -->
  <circle cx="8" cy="7" r="2" fill="#fff4a3" opacity="0.5"/>

  <!-- Detail strokes (engraved/embossed lines) -->
  <path d="..." fill="none" stroke="#8b5514" stroke-width="1"/>

  <!-- Edge stroke (crisp definition) -->
  <path d="..." fill="none" stroke="#5a3a0a" stroke-width="0.5"/>
</svg>
```

### Key Differences from Current Icons

| Current | New |
|---------|-----|
| `currentColor` everywhere | Explicit hex colors |
| 15% opacity metallic fill | 100% layered fills |
| Wire-frame outlines | Solid shapes with depth |
| Monochrome | Category-specific palettes |
| No shadows | Drop shadows for grounding |
| No highlights | Top-left light source highlights |

### Icon Type Treatments

**Metallic Objects (weapons, armor, shields):**
- 3 gradient layers for metal surface
- Dark edge → mid body → bright highlight
- Engraved detail lines at 1px stroke
- Rivets as small filled circles
- Materials: Steel (#a0a0a0), Bronze (#cd7f32), Gold (#daa520)

**Organic Objects (plants, creatures, fire):**
- 2-3 color zones with softer transitions
- Opacity blending for natural look
- Texture lines for leaves/fur/flames
- Subtle glow for magical elements

**Symbolic Objects (class emblems, notifications):**
- Container shape (shield/circle/banner) with metallic treatment
- Symbol inside uses accent color
- Clear silhouette for quick recognition
- Border stroke for definition

**UI Elements (menu, settings, navigation):**
- Parchment brown base palette
- Gold accents for interactivity hints
- Simple shapes, clear silhouettes
- Lighter visual weight than game objects

---

## Color Palettes

### Primary Palette (from DESIGN_SYSTEM.md)

| Token | Value | Usage |
|-------|-------|-------|
| Parchment Brown | `#8b7355` | UI icons base |
| Gold | `#c9a227` / `#daa520` / `#ffd700` | Accents, highlights |
| Burgundy | `#6b2d3d` | Action icons |
| Steel | `#5a5a5a` / `#a0a0a0` / `#d0d0d0` | Metal objects |
| Bronze/Copper | `#8b5514` / `#cd7f32` / `#e6a852` | Warm metal |

### Category Color Assignments

#### Menu Icons (12)
| Icon | Primary | Accent |
|------|---------|--------|
| formation | Brown | Gold |
| inventory | Bronze | Gold clasp |
| characters | Brown | Gold |
| settings | Brown | Gold center |
| friends | Brown | Green |
| party | Brown | Blue |
| logout | Brown | Red warning |
| notifications | Bronze | Gold clapper |
| menu | Brown | Gold dots |
| stats | Brown | Gold numbers |
| skills | Purple | Gold |
| leaderboard | Gold | Red banner |

#### Action Icons (11)
| Icon | Primary | Accent |
|------|---------|--------|
| battle | Steel blades | Bronze guards |
| shop | Brown | Gold coins |
| tavern | Copper | Tan foam |
| marketplace | Bronze | Gold |
| blacksmith | Steel | Orange glow |
| apothecary | Green glass | Purple liquid |
| back | Brown | Gold scroll |
| harvest | Gold wheat | Brown |
| recruit | Red | Gold herald |
| advance | Stone | Gold |
| social | Brown | Blue |

#### Class Icons (20)
| Class | Primary | Accent | Symbol |
|-------|---------|--------|--------|
| **Base 4:** | | | |
| warrior | Red/steel | Bronze | Sword & shield |
| wizard | Purple | Blue orb | Staff & orb |
| monk | Gold | White | Fist & beads |
| chemist | Green | Copper | Flask & mortar |
| **Warrior Line:** | | | |
| berserker | Dark red | Black | Dual axes |
| paladin | Gold | White radiance | Radiant sword |
| guardian | Steel | Blue | Tower shield |
| warlord | Red | Gold | Banner & crown |
| **Wizard Line:** | | | |
| sorcerer | Orange | Red flames | Flame hands |
| summoner | Purple | Void black | Portal ring |
| conjurer | Blue | Rune glow | Magic circle |
| oracle | White | Gold rays | Celestial eye |
| **Monk Line:** | | | |
| ninja | Black | Red | Shuriken |
| martial_artist | Gold | Tan | Open palm |
| brawler | Brown | Red | Raised fists |
| ascetic | White | Gold aura | Meditation |
| **Chemist Line:** | | | |
| alchemist | Gold | Green | Transmutation |
| medic | White | Red cross | Healing cross |
| plague_doctor | Black | Green smoke | Bird mask |
| artificer | Steel | Copper | Gear & wrench |

#### Stats Icons (5)
| Icon | Color | Symbol |
|------|-------|--------|
| str | Red-brown `#8b4444` | Sword/muscle |
| int | Purple `#6b4488` | Book/crystal |
| agi | Green `#448844` | Winged boot |
| vit | Orange `#aa7733` | Heart/shield |
| lck | Golden `#aa8833` | Clover/dice |

#### Resource Icons (4)
| Icon | Colors | Notes |
|------|--------|-------|
| gold | Gold gradient | KEEP CURRENT - already good |
| stamina | Green/lime | Lightning bolt |
| hp | Red gradient | Heart |
| mp | Blue gradient | Mana crystal |

#### Slots Icons (6)
| Icon | Primary | Accent |
|------|---------|--------|
| helmet | Steel | Bronze rivets |
| chest | Steel | Bronze |
| weapon | Steel | Bronze guard |
| shield | Steel | Bronze rim |
| boots | Brown leather | Bronze buckles |
| accessory | Gold | Gem |

#### Items Icons (11)
| Icon | Primary | Notes |
|------|---------|-------|
| weapon | Steel | Generic sword |
| shield | Steel/bronze | Shield shape |
| helmet | Steel | Helm |
| armor | Steel | Chest piece |
| boots | Brown | Leather |
| accessory | Gold | Decorative |
| ring | Gold | Band + gem |
| necklace | Gold | Chain + pendant |
| consumable | Red glass | Potion bottle |
| material | Copper/ore | Ingot |
| key | Bronze | Skeleton key |

#### Augments Icons (16)
| Icon | Colors | Object |
|------|--------|--------|
| **Elemental:** | | |
| fire | Orange/yellow | Brazier + flame |
| ice | Blue/white | Icicle cluster |
| lightning | Yellow/blue | Forked bolt |
| poison | Green/purple | Vial + skull |
| holy | Gold/white | Sun medallion |
| dark | Purple/black | Eclipse moon |
| **Stat Augments:** | | |
| strength | Red-brown | Gauntlet |
| intelligence | Purple | Open tome |
| agility | Green | Winged boot |
| vitality | Orange | Heart vine |
| luck | Gold | Four-leaf clover |
| critical | Red | Sword + target |
| defense | Steel | Tower shield |
| **Slayer:** | | |
| dragon-slayer | Red/gold | Dragon + lance |
| undead-slayer | White/gold | Skull + sunburst |
| demon-slayer | Purple/gold | Demon + blade |

#### Nodes Icons (12)
| Icon | Colors | Notes |
|------|--------|-------|
| castle | Gray stone | Red banner |
| village | Brown | Green fields |
| forest | Green | Brown trunks |
| cave | Gray | Dark entrance |
| mountain | White/gray | Snow peak |
| bridge | Brown/gray | Stone |
| guild | Bronze | Class color accent |
| throne | Gold | Red cushion |
| temple | White | Gold trim |
| stables | Brown | |
| training | Steel | Brown |
| question | Brown | Gold ? |

#### Notification Icons (7)
| Icon | Colors | Notes |
|------|--------|-------|
| friend-request | Green | Gold shield + ? |
| friend-accepted | Green | Gold linked shields |
| party-invite | Blue | Gold banner |
| match-found | Red | Gold arena gate |
| match-result | Gold | Laurel wreath |
| lfg-application | Brown | Gold scroll |
| system | Brown | Red wax seal |

---

## Implementation Plan

### Phase Order

| Phase | Category | Count | Rationale |
|-------|----------|-------|-----------|
| 1 | resources | 3 | Quick win, gold.svg as template |
| 2 | stats | 5 | Small, highly visible |
| 3 | menu | 12 | Core navigation |
| 4 | actions | 11 | World map interactions |
| 5 | slots | 6 | Equipment UI |
| 6 | items | 11 | Inventory visuals |
| 7 | classes | 20 | Character identity |
| 8 | augments | 16 | Marketplace/enchants |
| 9 | nodes | 12 | World map |
| 10 | notifications | 7 | Alerts |

**Total: 103 icons to rewrite** (gold.svg stays)

### Files Modified

```
frontend/public/assets/icons/svg/
├── menu/          # 12 icons - REWRITE
├── actions/       # 11 icons - REWRITE
├── classes/       # 20 icons - REWRITE
├── stats/         # 5 icons - REWRITE
├── resources/     # 3 icons - REWRITE (keep gold.svg)
├── slots/         # 6 icons - REWRITE
├── items/         # 11 icons - REWRITE
├── augments/      # 16 icons - REWRITE
├── nodes/         # 12 icons - REWRITE
└── notifications/ # 7 icons - REWRITE
```

### No Code Changes Required

Icons use existing file paths. The Icon.js component loads PNG versions generated from SVGs. As long as file names stay the same, no code changes needed.

**Verification:**
- `frontend/src/components/Icon.js` - path construction
- `frontend/src/core/IconLoader.js` - loading mechanism
- `scripts/generate-icons.js` - PNG generation

### Post-Implementation

1. Run `node scripts/generate-icons.js --clean --force` to regenerate PNGs
2. Visual verification in each UI context
3. Size check at 16/24/32/48px
4. Context check in light/dark panels, selected/disabled states

---

## Testing & Verification

### Visual Contexts to Check

| Screen | Icons Present |
|--------|---------------|
| Profile Dropdown | Menu icons, class icon, gold, notifications |
| World Map | Node icons, action icons |
| Formation | Back, stats, skills, slot icons |
| Inventory | Item icons, slot icons |
| Shop | Item icons, gold |
| Marketplace | Item icons, augment icons |
| Battle Rewards | Gold, item icons |

### Verification Checklist

- [ ] All icons render without 404 errors
- [ ] Icons are visually distinct at 16px (smallest size)
- [ ] Icons have visible depth (not flat outlines)
- [ ] Colors match category assignments
- [ ] Metallic surfaces have highlight/shadow
- [ ] Gold icon still matches new icons in quality
- [ ] Icons are recognizable in disabled/grayscale state
- [ ] No color clashing with parchment backgrounds

---

## Success Criteria

1. **Visual weight**: Icons look solid, not like wire sketches
2. **Color hierarchy**: Different categories are visually distinct
3. **Medieval aesthetic**: Icons feel like they belong in a fantasy RPG
4. **Consistency**: All icons follow the same gradient/highlight pattern
5. **Readability**: Icons are clear at all supported sizes
6. **Theme match**: Icons complement the parchment UI

---

## Reference

- **Gold standard**: `frontend/public/assets/icons/svg/resources/gold.svg`
- **Design system**: `docs/DESIGN_SYSTEM.md`
- **Previous icon work**: Commit `1556791` (icon system redesign with medieval aesthetic)
- **Previous plan**: `~/.claude/plans/quirky-jumping-ember.md` (Icon System Redesign Plan)
