# Frontend Technical Patterns

## Document Information

| Field | Value |
|-------|-------|
| Last Updated | January 2026 |
| Purpose | Document critical frontend patterns, gotchas, and debugging lessons |

---

## 1. Game Loop and Delta Time

### 1.1 The Convention: Milliseconds

**CRITICAL:** The game loop in `Game.js` passes `deltaTime` in **milliseconds**, not seconds.

```javascript
// Game.js - gameLoop()
const deltaTime = currentTime - this.lastTime; // MILLISECONDS
this.scenes.update(deltaTime);
```

### 1.2 Component Patterns

Components that need physics/animation calculations must convert ms to seconds internally:

```javascript
// CORRECT pattern for physics calculations
update(deltaTime) {
  const dt = deltaTime / 1000; // Convert ms to seconds
  this.velocity += this.acceleration * dt;
  this.position += this.velocity * dt;
}

// CORRECT pattern for timers (comparing against ms values)
update(deltaTime) {
  this.timer += deltaTime; // Keep in ms
  if (this.timer >= 500) { // Compare against ms
    this.timer = 0;
    this.doSomething();
  }
}
```

### 1.3 Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Double division (`deltaTime / 1000` when already seconds) | Animation 1000x too slow | Check if already converted |
| Multiplying by 1000 when deltaTime is ms | Animation 1000x too fast | Remove multiplication |
| Mixing units in same calculation | Erratic behavior | Standardize to one unit |

### 1.4 Components and Their deltaTime Handling

| Component | Receives | Internal Conversion | Notes |
|-----------|----------|---------------------|-------|
| `WorldMapCharacter.js` | ms | `/1000` for physics | Walk speed, particle physics |
| `StaminaBar.js` | ms | `/1000` for animation | Smooth stamina animation |
| `BattleUnit.js` | ms | `/1000` for physics | Movement, idle bob |
| `BattleCamera.js` | ms | `/1000` for lerp | Smooth camera interpolation |
| `BattleAnimations.js` | ms | `/1000` for physics | Particle physics, timers |
| `AnimatedSprite.js` | **seconds** | None | Called with `dt` not `deltaTime` |
| `FormationTheme.js` | ms | `/1000` for physics | Particle systems |

---

## 2. Sprite Sheet Conventions

### 2.1 Character Sprite Sheets

Character sprites are **vertical strips** with 8 frames stacked:

```
┌────────┐
│ Frame 0│  ← Idle frame 1
├────────┤
│ Frame 1│  ← Idle frame 2
├────────┤
│ Frame 2│  ← Idle frame 3
├────────┤
│ Frame 3│  ← Idle frame 4
├────────┤
│ Frame 4│  ← Walk/Action frame 1
├────────┤
│ Frame 5│  ← Walk/Action frame 2
├────────┤
│ Frame 6│  ← Walk/Action frame 3
├────────┤
│ Frame 7│  ← Walk/Action frame 4
└────────┘

Dimensions: 64x512 (64px wide, 512px tall)
Frame size: 64x64 pixels
Frame count: 8 (vertical)
```

### 2.2 Correct Sprite Extraction

```javascript
// CORRECT - Vertical sprite sheet
const frameWidth = sprite.width;           // 64px (full width)
const frameCount = 8;
const frameHeight = sprite.height / frameCount; // 64px per frame

const sourceX = 0;                         // Always 0 for vertical
const sourceY = frameIndex * frameHeight;  // Offset down

ctx.drawImage(sprite,
  sourceX, sourceY, frameWidth, frameHeight,  // Source rect
  destX, destY, destWidth, destHeight         // Dest rect
);
```

### 2.3 Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Assuming horizontal layout | Blue/stretched artifacts | Use vertical extraction |
| Wrong frame count | Partial frames, artifacts | Check actual sprite dimensions |
| Dividing width instead of height | Corrupt image regions | Match sprite orientation |

### 2.4 Sprite Sheet Locations

```
frontend/public/assets/sprites/
├── characters/
│   ├── player/
│   │   ├── warrior/    # warrior_idle.png, warrior_walk.png, etc.
│   │   ├── wizard/     # wizard_idle.png, wizard_walk.png, etc.
│   │   ├── monk/       # monk_idle.png, monk_walk.png, etc.
│   │   └── chemist/    # chemist_idle.png, chemist_walk.png, etc.
│   └── enemies/
│       └── {biome}/{enemy_id}/  # Same vertical format
├── nodes/              # World map node icons (single images)
├── items/              # Item icons (single images)
└── portraits/          # Character portraits (single images)
```

---

## 3. Camera and Travel System

### 3.1 Camera Following Pattern

The world map camera smoothly follows the character during travel:

```javascript
followCharacter() {
  const targetX = -this.character.x + canvas.width / 2;
  const targetY = -this.character.y + canvas.height / 2;

  const smoothing = 0.1; // Lower = smoother, higher = snappier
  this.cameraX += (targetX - this.cameraX) * smoothing;
  this.cameraY += (targetY - this.cameraY) * smoothing;
}
```

### 3.2 Camera Settling After Travel

**Problem:** Camera snaps when travel ends because smooth following stops abruptly.

**Solution:** Use a `cameraSettling` flag to continue smooth interpolation:

```javascript
// In update()
if (this.mapCharacter.isTraveling() || this.cameraSettling) {
  this.followCharacter();

  // Check if settled
  if (!this.mapCharacter.isTraveling()) {
    const dx = targetX - this.cameraX;
    const dy = targetY - this.cameraY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      this.cameraSettling = false;
    }
  }
}

// When starting travel
this.cameraSettling = true;
```

---

## 4. Stamina System

### 4.1 Client-Side Regeneration

The stamina bar predicts regeneration client-side for smooth UX:

```javascript
update(deltaTime) {
  // Check if regen time has passed
  if (this.nextRegenAt && this.current < this.max) {
    if (Date.now() >= this.nextRegenAt.getTime()) {
      this.current = Math.min(this.max, this.current + 1);
      // Calculate next regen time
      this.nextRegenAt = new Date(Date.now() + this.regenIntervalSeconds * 1000);
    }
  }
}
```

### 4.2 Visual Progress Indicator

Instead of showing countdown text, show partial fill of next segment:

```javascript
getRegenProgress() {
  if (!this.nextRegenAt || this.current >= this.max) return 0;
  const elapsed = Date.now() - (this.nextRegenAt.getTime() - this.regenIntervalSeconds * 1000);
  const total = this.regenIntervalSeconds * 1000;
  return Math.max(0, Math.min(1, elapsed / total));
}
```

---

## 5. Asset Loading Patterns

### 5.1 AssetLoader Path Structure

```javascript
// Base path for all sprites
this.basePath = '/assets/sprites';

// Character sprites
`${basePath}/characters/player/${charClass}/${charClass}_${animation}.png`
`${basePath}/characters/enemies/${biome}/${enemyId}/${enemyId}_${animation}.png`

// Node sprites
`${basePath}/nodes/${nodeType}.png`

// Item sprites
`${basePath}/items/${category}/${templateId}_${material}.png`
```

### 5.2 Graceful Fallbacks

Always provide fallback rendering when sprites fail to load:

```javascript
render(ctx, x, y) {
  if (this.sprite) {
    this.renderSprite(ctx, x, y);
  } else {
    this.renderFallback(ctx, x, y); // Colored circle with letter
  }
}
```

---

## 6. Debugging Checklist

When animations/timing seem wrong:

1. **Check deltaTime units** - Is the component receiving ms or seconds?
2. **Check for double conversion** - Is `/1000` applied twice?
3. **Check sprite orientation** - Are frames horizontal or vertical?
4. **Check frame dimensions** - Use `console.log(sprite.width, sprite.height)`
5. **Add throttled logging** - Log once per second to avoid spam:

```javascript
if (!this._lastLog || Date.now() - this._lastLog > 1000) {
  console.log('Debug:', { deltaTime, progress, position });
  this._lastLog = Date.now();
}
```

---

## 7. Known Gotchas

### 7.1 PostgreSQL TIMESTAMP Without Timezone

**Problem:** PostgreSQL `TIMESTAMP` (without timezone) stores times without timezone info. When Node.js parses these, it interprets them as local time, not UTC.

**Symptom:** Calculations involving elapsed time are wildly wrong (e.g., negative stamina).

**Solution:** Configure pg to treat TIMESTAMP as UTC:

```javascript
// In database.js
import pg from 'pg';
pg.types.setTypeParser(1114, (val) => {
  return val === null ? null : new Date(val + 'Z');
});
```

### 7.2 Canvas Context State

Always save/restore canvas state when making transformations:

```javascript
ctx.save();
ctx.translate(x, y);
ctx.scale(-1, 1); // Flip horizontal
ctx.drawImage(sprite, ...);
ctx.restore(); // CRITICAL - restore state
```

### 7.3 Off-Screen Rendering Optimization

Skip rendering for off-screen elements:

```javascript
if (screenX < -margin || screenX > canvas.width + margin ||
    screenY < -margin || screenY > canvas.height + margin) {
  return; // Skip rendering
}
```

---

## 8. Responsive Design Pattern

### 8.1 The Responsive Singleton

The game uses a centralized responsive utility in `frontend/src/core/Responsive.js`:

```javascript
import { responsive } from './core/Responsive.js';

// Check breakpoints
responsive.isMobile()   // < 600px
responsive.isTablet()   // 600-900px
responsive.isDesktop()  // > 900px

// Get responsive values
responsive.getGridColumns()   // 3, 4, or 6
responsive.getTouchTarget()   // 44, 40, or 36 px
responsive.showLabels()       // false on mobile
```

### 8.2 Scene Lifecycle: onBreakpointChange()

Scenes can override `onBreakpointChange()` to respond to viewport changes:

```javascript
class MyScene extends Scene {
  enter() {
    // Subscribe to responsive changes
    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());
    this.buildUI();
  }

  onBreakpointChange() {
    // Rebuild UI for new breakpoint
    this.destroyUI();
    this.buildUI();
  }

  exit() {
    // Clean up subscription
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }
  }
}
```

### 8.3 CSS Variable Integration

The responsive system injects CSS variables that update automatically:

```css
/* Use in inline styles or CSS */
.panel {
  padding: var(--space-md);           /* 12px */
  min-height: var(--touch-target);    /* 44/40/36px based on breakpoint */
}

.grid {
  grid-template-columns: repeat(var(--grid-columns), 1fr);
}
```

### 8.4 Scenes Using Responsive Pattern

| Scene | Pattern | Notes |
|-------|---------|-------|
| `FormationScene` | Full rebuild | Destroys and recreates DOM on breakpoint change |
| `InventoryScene` | Full rebuild | Grid columns adjust to breakpoint |
| `ShopScene` | Full rebuild | Tab layout changes for mobile |
| `TavernScene` | Layout swap | Switches between mobile and desktop layouts |
| `WorldMapScene` | Partial update | Updates HUD elements only |

---

## 9. Parchment Component Pattern

### 9.1 Component Structure

All parchment components follow this pattern:

```javascript
import { ParchmentPanel } from '../ui/parchment/index.js';

class MyScene extends Scene {
  enter() {
    // Create component
    this.panel = new ParchmentPanel({
      title: 'My Panel',
      closeable: true,
      onClose: () => this.panel.hide()
    });

    // Append to DOM
    this.game.uiContainer.appendChild(this.panel.render());
  }

  exit() {
    // Remove from DOM
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
  }
}
```

### 9.2 Toast Notifications

Use the singleton toast manager for notifications:

```javascript
import { parchmentToast } from '../ui/parchment/index.js';

// Success (green)
parchmentToast.success('Item equipped!');

// Error (red)
parchmentToast.error('Not enough gold');

// Info (blue)
parchmentToast.info('New quest available');

// Warning (yellow)
parchmentToast.warning('Low health!');

// Custom duration (ms)
parchmentToast.success('Done!', 5000);
```

### 9.3 Modal Dialogs

For confirmations and complex dialogs:

```javascript
import { ParchmentModal } from '../ui/parchment/index.js';

const modal = new ParchmentModal({
  title: 'Confirm Action',
  content: 'Are you sure?',
  buttons: [
    { label: 'Cancel', variant: 'secondary', onClick: () => modal.hide() },
    { label: 'Confirm', variant: 'primary', onClick: () => {
      handleConfirm();
      modal.hide();
    }}
  ]
});

document.body.appendChild(modal.render());
modal.show();

// Cleanup
modal.destroy();
```

### 9.4 Button Variants

| Variant | Use Case | Appearance |
|---------|----------|------------|
| `primary` | Main actions | Dark brown fill |
| `secondary` | Cancel, back | Light parchment fill |
| `danger` | Delete, remove | Red-tinted fill |
| `ghost` | Minimal emphasis | Transparent, text only |
