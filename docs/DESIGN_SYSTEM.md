# Modia Design System

This document defines the visual standards for Modia's UI components, based on a parchment/medieval RPG aesthetic.

## Color Palette

### Parchment Base (Primary UI)

| Token | Value | Usage |
|-------|-------|-------|
| `--parchment-light` | `#d4c4a8` | Gradient start |
| `--parchment-mid` | `#c9b899` | Gradient middle |
| `--parchment-dark` | `#bfae8a` | Gradient end |
| `--parchment-border` | `#8b7355` | Standard borders |
| `--parchment-border-dark` | `#6b5344` | Darker accents |

**Background Gradient:**
```css
background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
```

**Texture Overlays (optional depth):**
```css
background:
  linear-gradient(135deg, rgba(180, 160, 130, 0.1) 0%, transparent 50%),
  linear-gradient(225deg, rgba(100, 80, 60, 0.1) 0%, transparent 50%),
  linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
```

### Enemy/Hostile Variant

| Token | Value | Usage |
|-------|-------|-------|
| `--enemy-border` | `#8b5555` | Red-tinted border |
| `--enemy-overlay` | `rgba(150, 100, 100, 0.15)` | Red tint overlay |

### Text Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#2d2418` | Main text, headers |
| `--text-secondary` | `#5a4a3a` | Subtitles, descriptions |
| `--text-muted` | `#7a6a5a` | Disabled, hints |
| `--text-highlight` | `#8b7355` | Active/selected items |

### State Colors

| State | Gradient | Usage |
|-------|----------|-------|
| HP Normal | `#5a9e4a` → `#4a8c3a` → `#3d7530` | Full health |
| HP Warning | `#d4a840` → `#c49530` → `#a87d25` | < 50% health |
| HP Critical | `#c45a5a` → `#a84040` → `#8b3030` | < 25% health |
| MP | `#5080b0` → `#406a95` → `#355580` | Mana |

### Stat Colors (for quick visual identification)

| Stat | Color | Hex |
|------|-------|-----|
| STR | Red-brown | `#8b4444` |
| INT | Purple | `#6b4488` |
| AGI | Green | `#448844` |
| VIT | Orange-brown | `#aa7733` |
| LCK | Golden-brown | `#aa8833` |

---

## Typography

### Font Families

```css
/* Headers, labels, narrative text */
font-family: 'Georgia', 'Times New Roman', serif;

/* Numerical values, stats, monospace data */
font-family: 'Consolas', 'Monaco', monospace;
```

### Font Sizes

| Size | Value | Usage |
|------|-------|-------|
| `--font-xs` | `10px` | Subtitles, hints |
| `--font-sm` | `11px` | Secondary labels |
| `--font-md` | `13px` | Primary text |
| `--font-lg` | `15px` | Section headers |
| `--font-xl` | `18px` | Modal titles |

### Text Effects

```css
/* Embossed text on parchment */
text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);

/* Important/warning text */
text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
```

---

## Component Patterns

### Standard Panel

```css
.parchment-panel {
  background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
  border: 2px solid #8b7355;
  border-radius: 4px;
  box-shadow:
    0 3px 8px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    inset 0 -1px 0 rgba(0, 0, 0, 0.1);
  padding: 10px 12px;
  font-family: 'Georgia', 'Times New Roman', serif;
  color: #2d2418;
}
```

### Interactive Item (hover states)

```css
.parchment-item {
  padding: 8px 12px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.parchment-item:hover {
  background: rgba(139, 115, 85, 0.15);
}

.parchment-item.selected {
  background: rgba(139, 115, 85, 0.25);
  border-left: 3px solid #8b7355;
}

.parchment-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### Buttons

```css
.parchment-button {
  background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
  border: 2px solid #8b7355;
  border-radius: 4px;
  padding: 8px 16px;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 13px;
  font-weight: bold;
  color: #2d2418;
  cursor: pointer;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transition: all 0.15s ease;
}

.parchment-button:hover {
  background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
  box-shadow:
    0 3px 6px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.parchment-button:active {
  transform: translateY(1px);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.2),
    inset 0 1px 2px rgba(0, 0, 0, 0.1);
}

.parchment-button.primary {
  background: linear-gradient(to bottom, #8b7355 0%, #7a6345 100%);
  color: #f0e8d8;
  border-color: #6b5344;
}

.parchment-button.danger {
  background: linear-gradient(to bottom, #8b5555 0%, #7a4545 100%);
  color: #f0e8d8;
  border-color: #6b3535;
}
```

### Inset Containers (for bars, inputs)

```css
.parchment-inset {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
}
```

### Tabs

```css
.parchment-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 2px solid #8b7355;
  margin-bottom: 12px;
}

.parchment-tab {
  padding: 8px 16px;
  background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
  border: 2px solid #8b7355;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 13px;
  color: #5a4a3a;
  cursor: pointer;
  margin-bottom: -2px;
}

.parchment-tab.active {
  background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
  color: #2d2418;
  font-weight: bold;
}

.parchment-tab:hover:not(.active) {
  background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
}
```

### Radio Buttons

```css
.parchment-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  cursor: pointer;
}

.parchment-radio-circle {
  width: 18px;
  height: 18px;
  border: 2px solid #8b7355;
  border-radius: 50%;
  background: #f0e8d8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.parchment-radio.selected .parchment-radio-circle::after {
  content: '';
  width: 10px;
  height: 10px;
  background: #8b7355;
  border-radius: 50%;
}

.parchment-radio-label {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 13px;
  color: #2d2418;
}

.parchment-radio-description {
  font-size: 11px;
  color: #5a4a3a;
  margin-left: 26px;
}
```

---

## CSS Utility Functions

The parchment theme provides JavaScript utility functions that generate complete CSS property blocks for consistent styling across scenes. Import from `frontend/src/ui/parchment/index.js`.

### Usage Pattern

```javascript
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentPanelCSS,
  getParchmentInputCSS,
  getParchmentButtonCSS
} from '../ui/parchment/index.js';

const P = PARCHMENT_COLORS;  // Alias for cleaner code

// In addStyles() method:
style.textContent = `
  .my-panel {
    ${getParchmentPanelCSS()}
  }
  .my-input {
    ${getParchmentInputCSS()}
  }
  .my-btn {
    ${getParchmentButtonCSS('primary')}
  }
`;
```

### Available Utilities

| Function | Description |
|----------|-------------|
| `getParchmentGradient(direction)` | Background gradient string |
| `getParchmentBorder(width)` | Border property string |
| `getParchmentShadow(elevated)` | Box-shadow with inset highlights |
| `getParchmentPanelCSS()` | Complete panel styles (bg, border, shadow, radius, color, font) |
| `getParchmentInputCSS(options)` | Complete input styles with focus states |
| `getParchmentButtonCSS(variant)` | Complete button styles (primary, secondary, danger, ghost) |
| `getParchmentCardCSS(options)` | Panel + padding with optional hover/selected states |
| `getParchmentHeaderCSS()` | Section header styles with border-bottom |
| `getParchmentMutedTextCSS()` | Muted text color and font |

### Color Reference (PARCHMENT_COLORS)

```javascript
// Background tones
P.light     // #d4c4a8
P.mid       // #c9b899
P.dark      // #bfae8a

// Borders
P.border      // #8b7355
P.borderDark  // #6b5344

// Text
P.text.primary    // #2d2418
P.text.secondary  // #5a4a3a
P.text.muted      // #7a6a5a

// State colors
P.state.success  // #4a7548
P.state.error    // #8b4444
P.state.warning  // #c9a227

// Accents
P.accent.gold    // #c9a227
P.accent.copper  // #b87333

// Effects
P.shadow     // rgba(0, 0, 0, 0.3)
P.overlay    // rgba(0, 0, 0, 0.5)
```

---

## Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` | Tight gaps |
| `--space-sm` | `8px` | Component internal |
| `--space-md` | `12px` | Section padding |
| `--space-lg` | `16px` | Between sections |
| `--space-xl` | `24px` | Major separations |

---

## Z-Index Layers

| Layer | Z-Index | Usage |
|-------|---------|-------|
| Base | 0 | Canvas, game world |
| HUD | 50 | Turn order, minimap |
| Panels | 100 | Action bar, character cards |
| Menus | 150 | Context menu, radial menu |
| Confirmation | 200 | Action confirmations |
| Modal | 300 | Settings, rewards |
| Tooltip | 400 | Hover tooltips |

---

## Shadows

```css
/* Subtle elevation */
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.2);

/* Standard panel */
--shadow-md: 0 3px 8px rgba(0, 0, 0, 0.3);

/* Floating/modal */
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);

/* Inset (for bars, inputs) */
--shadow-inset: inset 0 1px 3px rgba(0, 0, 0, 0.3);
```

---

## Animation Guidelines

- Use `transition: all 0.15s ease` for hover states
- Use `transition: all 0.2s ease-out` for show/hide
- Avoid animations longer than 300ms for UI feedback
- Use `ease-out` for elements appearing, `ease-in` for disappearing

---

## Usage Examples

### Creating a Menu Panel

```javascript
const menuStyles = `
  background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
  border: 2px solid #8b7355;
  border-radius: 4px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.3),
              inset 0 -1px 0 rgba(0, 0, 0, 0.1);
  padding: 8px;
  font-family: 'Georgia', 'Times New Roman', serif;
  color: #2d2418;
`;
```

### Creating a Menu Item

```javascript
const itemStyles = `
  padding: 8px 12px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.15s ease;
`;

const itemHoverStyles = `
  background: rgba(139, 115, 85, 0.15);
`;
```

---

## Parchment Component Library

A complete set of DOM-based UI components with the medieval parchment theme. Located in `frontend/src/ui/parchment/`.

### Installation

```javascript
import {
  ParchmentPanel,
  ParchmentButton,
  ParchmentInput,
  ParchmentDropdown,
  ParchmentModal,
  parchmentToast,
  ProfileDropdown,
  injectParchmentTheme,
  PARCHMENT_COLORS
} from './ui/parchment/index.js';

// Inject CSS variables (call once at app startup)
injectParchmentTheme();
```

### Components

| Component | Description | Key Features |
|-----------|-------------|--------------|
| `ParchmentPanel` | Base container | Configurable header, close button, padding |
| `ParchmentButton` | Button variants | `primary`, `secondary`, `danger`, `ghost` |
| `ParchmentInput` | Text inputs | Label, placeholder, validation styling |
| `ParchmentDropdown` | Select menus | Options array, onChange callback |
| `ParchmentModal` | Modal dialogs | Title, content, backdrop, close on escape |
| `ParchmentToastManager` | Toast system | `success`, `error`, `info`, `warning` types |
| `ProfileDropdown` | HUD dropdown | Combines user info, notifications, settings |

### Usage Examples

```javascript
// Panel with header
const panel = new ParchmentPanel({
  title: 'Inventory',
  closeable: true,
  onClose: () => panel.hide()
});
document.body.appendChild(panel.render());

// Button variants
const primary = new ParchmentButton({
  label: 'Confirm',
  variant: 'primary',
  onClick: () => handleConfirm()
});

const danger = new ParchmentButton({
  label: 'Delete',
  variant: 'danger',
  onClick: () => handleDelete()
});

// Toast notifications
import { parchmentToast } from './ui/parchment/index.js';

parchmentToast.success('Item equipped successfully!');
parchmentToast.error('Not enough gold');
parchmentToast.info('New quest available');
parchmentToast.warning('Low health!');

// Modal dialog
const modal = new ParchmentModal({
  title: 'Confirm Purchase',
  content: 'Buy Iron Sword for 500g?',
  buttons: [
    { label: 'Cancel', variant: 'secondary', onClick: () => modal.hide() },
    { label: 'Buy', variant: 'primary', onClick: () => handleBuy() }
  ]
});
modal.show();
```

### Theme Utilities

```javascript
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from './ui/parchment/index.js';

// Color palette
PARCHMENT_COLORS.light      // #d4c4a8
PARCHMENT_COLORS.mid        // #c9b899
PARCHMENT_COLORS.dark       // #bfae8a
PARCHMENT_COLORS.border     // #8b7355
PARCHMENT_COLORS.text       // #2d2418
PARCHMENT_COLORS.textMuted  // #5a4a3a

// CSS helpers
element.style.background = getParchmentGradient();  // linear-gradient(...)
element.style.border = getParchmentBorder();        // 2px solid #8b7355
element.style.boxShadow = getParchmentShadow();     // 0 3px 8px rgba(...)
```

---

## Responsive System

Viewport-aware utilities for responsive game UI. Located in `frontend/src/core/Responsive.js`.

### Breakpoints

| Breakpoint | Width | Touch Target | Grid Columns |
|------------|-------|--------------|--------------|
| Mobile | < 600px | 44px | 3 |
| Tablet | 600-900px | 40px | 4 |
| Desktop | > 900px | 36px | 6 |

### Usage

```javascript
import { responsive } from './core/Responsive.js';

// Check breakpoint
if (responsive.isMobile()) {
  // Mobile-specific layout
}

// Get responsive values
const columns = responsive.getGridColumns();  // 3, 4, or 6
const touchSize = responsive.getTouchTarget(); // 44, 40, or 36

// Check features
const showLabels = responsive.showLabels();  // false on mobile
const hasTouch = responsive.hasTouch();

// Subscribe to changes
const unsubscribe = responsive.onChange((breakpoint, info) => {
  console.log('Now:', breakpoint, info.isMobile, info.isTouchDevice);
});
```

### CSS Variables

The system injects CSS variables on `:root` that update with breakpoint:

```css
/* Available CSS variables */
var(--touch-target)      /* 44px / 40px / 36px */
var(--grid-columns)      /* 3 / 4 / 6 */
var(--grid-item-size)    /* 64px / 56px / 48px */
var(--icon-size-sm)      /* 20px / 18px / 16px */
var(--icon-size-md)      /* 24px / 22px / 20px */
var(--icon-size-lg)      /* 32px / 28px / 24px */
var(--space-xs)          /* 4px */
var(--space-sm)          /* 8px */
var(--space-md)          /* 12px */
var(--space-lg)          /* 16px */
var(--space-xl)          /* 24px */
var(--button-height)     /* 44px / 40px / 36px */
var(--input-height)      /* 44px / 40px / 36px */
var(--is-touch-device)   /* 1 or 0 */
```

---

## Icon System

Medieval woodcut-style SVG icons with responsive sizing. Build generates PNG variants at 16/24/32/48px.

### Directory Structure

```
frontend/public/assets/icons/
  svg/
    menu/           # formation, inventory, settings, stats, skills, leaderboard, ...
    nodes/          # castle, village, forest, cave, mountain, bridge, guild, throne, temple, stables, training
    actions/        # battle, blacksmith, marketplace, tavern, apothecary, shop, back, harvest, recruit, advance, social
    stats/          # str, agi, int, vit, lck
    resources/      # gold, stamina, hp, mp
    slots/          # weapon, armor, helmet, boots, shield, chest, accessory
    notifications/  # friend-request, friend-accepted, party-invite, match-found, match-result, lfg-application, system
    classes/        # Base: warrior, wizard, monk, chemist | Advanced: berserker, paladin, guardian, warlord, sorcerer, summoner, conjurer, oracle, ninja, martial_artist, brawler, ascetic, alchemist, medic, plague_doctor, artificer
    items/          # weapon, shield, helmet, armor, boots, accessory, ring, necklace, consumable, material, key
    augments/       # fire, ice, lightning, poison, holy, dark, strength, intelligence, agility, vitality, luck, critical, defense, dragon-slayer, undead-slayer, demon-slayer
  png/
    16/             # 16x16 PNG variants
    24/             # 24x24 PNG variants
    32/             # 32x32 PNG variants
    48/             # 48x48 PNG variants
```

### Icon Categories (104 total SVG icons)

| Category | Count | Purpose |
|----------|-------|---------|
| `actions` | 11 | Feature buttons (battle, blacksmith, tavern, etc.) |
| `menu` | 12 | Navigation menu items |
| `nodes` | 12 | World map location types |
| `notifications` | 7 | Notification type indicators |
| `classes` | 20 | Character class emblems (4 base + 16 advanced) |
| `items` | 11 | Inventory item type fallbacks |
| `augments` | 16 | Equipment enchantment types |
| `resources` | 4 | Currency and resource pools |
| `slots` | 6 | Equipment slot indicators |
| `stats` | 5 | Character stat icons |

### Icon Component

```javascript
import { Icon } from './components/Icon.js';

// As DOM element (responsive)
const icon = new Icon('menu', 'formation', {
  label: 'Formation',
  size: 'md'  // sm, md, lg, xl
});
container.appendChild(icon.render());

// Update state
icon.setActive(true);
icon.setDisabled(false);

// As HTML string (static)
button.innerHTML = Icon.html('actions', 'attack', { label: 'Attack' });

// Cleanup
icon.destroy();
```

### Size Mapping

| Size | Mobile | Tablet | Desktop |
|------|--------|--------|---------|
| sm | 20px | 18px | 16px |
| md | 24px | 22px | 20px |
| lg | 32px | 28px | 24px |
| xl | 48px | 40px | 32px |

### Build Script

```bash
# Generate PNG variants from SVG sources
node scripts/generate-icons.js

# Included in dev setup
npm run dev:setup
```
