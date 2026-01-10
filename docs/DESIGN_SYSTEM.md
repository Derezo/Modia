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
