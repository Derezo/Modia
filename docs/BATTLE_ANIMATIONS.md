# Modia - Battle Animations and Visual Feedback System

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.0 |
| Last Updated | January 2026 |
| System Type | Canvas 2D Animation System |

---

## 1. Overview

### 1.1 Purpose

The battle animation system provides visual feedback that makes battle state and intentions clear to players. Through careful timing and visual cues, players can understand:

- Whose turn it is and what they are doing
- What enemies intend to do before they act
- The results of actions (damage, healing, effects)
- The overall flow of combat

### 1.2 Design Goals

- **Clarity**: Players should always understand what is happening
- **Responsiveness**: Animations feel snappy, not sluggish
- **Coordination**: Visual and server state stay synchronized
- **Accessibility**: Timing and colors work for all players

### 1.3 System Architecture

```
+-----------------------------------------------------------------------------+
|                        Battle Animation System                                |
+-----------------------------------------------------------------------------+
|                                                                              |
|  +------------------+    +------------------+    +------------------+        |
|  | WebSocket Events |---+| Animation Queue  |---+| Canvas Renderer  |        |
|  | (Server Intent)  |    | (Timing Control) |    | (Visual Output)  |        |
|  +------------------+    +------------------+    +------------------+        |
|          |                       |                       |                   |
|          v                       v                       v                   |
|  +------------------+    +------------------+    +------------------+        |
|  | BattleScene.js   |    | BattleAnimations |    | BattleCamera.js  |        |
|  | (Orchestration)  |    | (Effects System) |    | (View Control)   |        |
|  +------------------+    +------------------+    +------------------+        |
|                                                                              |
+-----------------------------------------------------------------------------+
```

### 1.4 Canvas Layer Order

Rendering occurs in strict layer order (bottom to top):

| Layer | Z-Index | Contents |
|-------|---------|----------|
| 1. Background | 0 | Sky gradient, backdrop |
| 2. Terrain | 10 | Grass, stone, water tiles |
| 3. Tile Highlights | 20 | Movement range, attack range overlays |
| 4. Obstacles | 30 | Trees, rocks (back rows first) |
| 5. Unit Shadows | 40 | Elliptical shadows under units |
| 6. Unit Sprites | 50 | Character and enemy sprites |
| 7. Status Icons | 60 | Buff/debuff indicators above units |
| 8. Floating Text | 70 | Damage numbers, heal numbers |
| 9. UI Overlays | 80 | HP bars, "thinking" indicator |
| 10. Turn Banner | 90 | "Enemy Turn" / "Your Turn" banner |

---

## 2. Enemy Intent Visualization

The intent system communicates enemy decisions before execution, giving players time to understand what is happening.

### 2.1 Movement Range Highlights (Blue Tiles)

Shows all tiles an enemy could potentially move to during their turn.

```
WebSocket Event: battle:intent_highlight
{
  "type": "battle:intent_highlight",
  "payload": {
    "unitId": "enemy_1",
    "highlightType": "movement_range",
    "tiles": [
      { "x": 3, "y": 4 },
      { "x": 3, "y": 5 },
      { "x": 4, "y": 4 }
    ],
    "duration": 500
  }
}
```

| Property | Value |
|----------|-------|
| Color | Blue (#3498db) |
| Opacity | 0.3 |
| Duration | 500ms display before enemy moves |
| Trigger | Start of enemy turn, before movement |

**Rendering Implementation:**

```javascript
// Add highlight to grid render highlights map
highlights[`${tile.x},${tile.y}`] = 'rgba(52, 152, 219, 0.3)';
```

### 2.2 Attack Range Highlights (Red Tiles)

Shows all tiles within the enemy's attack range after movement.

```
WebSocket Event: battle:intent_highlight
{
  "type": "battle:intent_highlight",
  "payload": {
    "unitId": "enemy_1",
    "highlightType": "attack_range",
    "tiles": [
      { "x": 4, "y": 3 },
      { "x": 4, "y": 4 },
      { "x": 5, "y": 3 }
    ],
    "duration": 500
  }
}
```

| Property | Value |
|----------|-------|
| Color | Red (#e74c3c) |
| Opacity | 0.3 |
| Duration | 500ms display before attack |
| Trigger | After enemy movement, before attack |

### 2.3 Target Path Highlight

Shows the actual path the enemy will take to reach their destination.

```
WebSocket Event: battle:intent_highlight
{
  "type": "battle:intent_highlight",
  "payload": {
    "unitId": "enemy_1",
    "highlightType": "target_path",
    "tiles": [
      { "x": 2, "y": 5 },
      { "x": 3, "y": 5 },
      { "x": 3, "y": 4 }
    ],
    "arrows": true,
    "duration": 300
  }
}
```

| Property | Value |
|----------|-------|
| Color | Yellow (#f1c40f) |
| Opacity | 0.5 |
| Duration | 300ms then movement begins |
| Arrows | Directional arrows on path tiles |

**Path Arrow Rendering:**

```javascript
// Draw arrow pointing to next tile in path
const angle = Math.atan2(nextTile.y - tile.y, nextTile.x - tile.x);
ctx.save();
ctx.translate(screenX, screenY);
ctx.rotate(angle);
// Draw arrow shape
ctx.fillStyle = '#f1c40f';
ctx.beginPath();
ctx.moveTo(8, 0);
ctx.lineTo(-4, -6);
ctx.lineTo(-4, 6);
ctx.closePath();
ctx.fill();
ctx.restore();
```

### 2.4 Target Tile Pulse

Indicates the specific tile that will be attacked, with a pulsing glow effect.

```
WebSocket Event: battle:intent_highlight
{
  "type": "battle:intent_highlight",
  "payload": {
    "unitId": "enemy_1",
    "highlightType": "target_tile",
    "tiles": [{ "x": 4, "y": 3 }],
    "aoe": [],
    "duration": 400
  }
}
```

| Property | Value |
|----------|-------|
| Color | Orange (#e67e22) |
| Opacity | 0.4 to 0.8 (pulsing) |
| Duration | 400ms before attack animation |
| Pulse Rate | 200ms per cycle |

**Pulsing Effect:**

```javascript
// Sinusoidal pulse between 0.4 and 0.8 opacity
const pulse = 0.6 + Math.sin(time * Math.PI * 5) * 0.2;
const color = `rgba(230, 126, 34, ${pulse})`;
```

### 2.5 AoE Preview

For area-of-effect skills, shows all tiles that will be affected.

| Property | Value |
|----------|-------|
| Color | Purple (#9b59b6) |
| Opacity | 0.4 |
| Duration | Same as target_tile |
| Pattern | Solid fill with subtle pulse |

---

## 3. Tile Highlight Reference

| Type | Color | Hex | Opacity | Use Case |
|------|-------|-----|---------|----------|
| movement_range | Blue | #3498db | 0.3 | Player/enemy movement options |
| attack_range | Red | #e74c3c | 0.3 | Attack/skill range |
| target_path | Yellow | #f1c40f | 0.5 | Movement path preview |
| target_tile | Orange | #e67e22 | 0.6 pulsing | Primary attack target |
| aoe_preview | Purple | #9b59b6 | 0.4 | Area of effect preview |
| heal_range | Green | #2ecc71 | 0.3 | Healing skill range |
| hover | White | #ffffff | 0.2 | Mouse hover feedback |
| selected | Gold | #ffd700 | 0.4 | Currently selected unit tile |

---

## 4. Enemy Turn Timeline

Complete timeline showing visual flow during an enemy turn:

```
+-----------------------------------------------------------------------------+
|                           Enemy Turn Timeline                                |
+-----------------------------------------------------------------------------+
|                                                                              |
|  0ms      battle:turn_start (enemy)                                         |
|           -> Camera pans to enemy unit                                       |
|           -> UI shows "Enemy Turn: [name]"                                   |
|           -> "Thinking" indicator appears above enemy                        |
|                                                                              |
|  300ms    battle:intent_highlight (movement_range)                          |
|           -> Blue tiles show movement options                                |
|           -> "Thinking" indicator continues                                  |
|                                                                              |
|  800ms    battle:intent_highlight (target_path)                             |
|           -> Path tiles highlight with arrows                                |
|           -> Movement range fades out                                        |
|                                                                              |
|  1100ms   battle:action_result (move)                                       |
|           -> Enemy moves along path (animated)                               |
|           -> Path highlights clear as unit passes                            |
|                                                                              |
|  1600ms   battle:intent_highlight (attack_range)                            |
|           -> Red tiles show attack options                                   |
|           -> "Thinking" indicator continues                                  |
|                                                                              |
|  2000ms   battle:intent_highlight (target_tile)                             |
|           -> Target pulses/glows                                             |
|           -> AoE preview if applicable                                       |
|           -> Attack range fades                                              |
|                                                                              |
|  2300ms   battle:action_result (attack/skill)                               |
|           -> Attack animation plays                                          |
|           -> Hit flash on target                                             |
|           -> Damage numbers appear                                           |
|           -> HP bars update (interpolated)                                   |
|                                                                              |
|  2800ms   battle:turn_end                                                   |
|           -> Clear all highlights                                            |
|           -> Remove "thinking" indicator                                     |
|           -> Prepare for next turn                                           |
|                                                                              |
+-----------------------------------------------------------------------------+
```

---

## 5. "Thinking" Indicator

An animated indicator shown above units while waiting for their action decision.

### 5.1 When Shown

| Context | Description |
|---------|-------------|
| Enemy AI | Shown during enemy turn while AI calculates action |
| Remote Player | Shown during opponent's turn in PvP/co-op |
| Long Calculation | Shown if server processing takes > 200ms |

### 5.2 Visual Design

```
     .  .  .     <- Three bouncing dots
       [E]       <- Enemy unit sprite
```

**Animation Style:**

| Property | Value |
|----------|-------|
| Type | Three bouncing dots |
| Position | Centered above unit sprite, 20px offset |
| Color | White (#ffffff) with 80% opacity |
| Dot Size | 4px radius |
| Dot Spacing | 8px between centers |
| Bounce Height | 6px |
| Bounce Cycle | 600ms total (200ms per dot, staggered) |

### 5.3 Implementation

```javascript
// Render thinking indicator
renderThinkingIndicator(ctx, screenX, screenY, time) {
  const dotCount = 3;
  const dotRadius = 4;
  const spacing = 8;
  const bounceHeight = 6;
  const cycleDuration = 0.6;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';

  for (let i = 0; i < dotCount; i++) {
    const phase = (time / cycleDuration + i / dotCount) % 1;
    const bounce = Math.sin(phase * Math.PI) * bounceHeight;
    const x = screenX + (i - 1) * spacing;
    const y = screenY - 20 - bounce;

    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

---

## 6. Animation Timing Constants

All timing values used by the animation system:

```javascript
const ANIMATION_TIMING = {
  // Camera
  CAMERA_PAN_DURATION: 300,      // ms to pan between units
  CAMERA_SETTLE_DELAY: 100,      // ms after pan before action

  // Intent highlights
  INTENT_FADE_IN: 200,           // ms to fade in highlight
  INTENT_DISPLAY: 500,           // ms to show before action
  INTENT_FADE_OUT: 150,          // ms to fade out

  // Movement
  MOVE_PER_TILE: 150,            // ms per tile moved
  MOVE_BOUNCE_HEIGHT: 4,         // pixels for hop animation

  // Attacks
  ATTACK_WINDUP: 200,            // ms before hit
  ATTACK_IMPACT: 100,            // ms at impact
  ATTACK_RECOVERY: 200,          // ms after hit

  // Damage numbers
  DAMAGE_POPUP_RISE: 30,         // pixels to rise
  DAMAGE_POPUP_DURATION: 1200,   // ms visible

  // Status effects
  STATUS_ICON_PULSE: 1000,       // ms per pulse cycle

  // Turn transitions
  TURN_BANNER_DISPLAY: 1000,     // ms for "Enemy Turn" banner
  TURN_TRANSITION_DELAY: 200,    // ms between turns

  // HP/MP bars
  BAR_TRANSITION_DURATION: 300,  // ms for smooth value change

  // Flash effects
  FLASH_DURATION: 300,           // ms for hit flash

  // Particles
  PARTICLE_DURATION: 600,        // ms for particle burst
  PARTICLE_GRAVITY: 100          // pixels/s^2 downward
};
```

---

## 7. Damage Number Display

Floating numbers that show damage dealt, healing received, or miss indicators.

### 7.1 Visual Properties

| Type | Color | Font Size | Text |
|------|-------|-----------|------|
| Normal Damage | Red (#ff4444) | 18px bold | -[value] |
| Critical Hit | Yellow (#ffcc00) | 24px bold | -[value] + "CRITICAL!" |
| Heal | Green (#44ff44) | 18px bold | +[value] |
| Miss | Gray (#aaaaaa) | 16px bold | MISS |
| Status Effect | Orange (#ffaa00) | 14px | [effect name] |

### 7.2 Animation Behavior

```
Start Position: Center of target unit
     |
     |  Rise 30-80px (type-dependent velocity)
     |  Fade from 100% to 0% opacity
     v
End Position: Above unit (then removed)
```

| Property | Value |
|----------|-------|
| Duration | 1000-1200ms |
| Velocity Y | -40 to -80 pixels/second (rises up) |
| Fade | Linear opacity reduction |
| Outline | 2px black shadow for readability |

### 7.3 Multiple Hits

When multiple damage instances occur simultaneously:

- Stagger display by 100ms each
- Offset horizontally by 20px alternating left/right
- Maximum 5 visible at once (oldest removed)

```javascript
// Add damage number to animation queue
addDamageNumber(x, y, damage, isCritical = false) {
  this.animations.push({
    type: 'damage',
    x,
    y,
    startY: y,
    value: damage,
    isCritical,
    timer: 0,
    duration: 1.2,
    velocityY: -80,
    scale: isCritical ? 1.5 : 1.0
  });
}
```

---

## 8. HP/MP Bar Updates

Smooth animated transitions for health and mana bar changes.

### 8.1 Interpolation

| Property | Value |
|----------|-------|
| Duration | 300ms transition |
| Easing | Ease-out |
| Update Rate | Every frame |

```javascript
// Smooth bar interpolation
updateBar(currentValue, targetValue, deltaTime) {
  const t = 1 - Math.exp(-10 * deltaTime); // ~300ms to reach target
  return currentValue + (targetValue - currentValue) * t;
}
```

### 8.2 Color Gradient

HP bar color changes based on percentage:

| HP % | Color |
|------|-------|
| 100-60% | Green (#4caf50) |
| 60-30% | Yellow (#ffc107) |
| 30-0% | Red (#f44336) |

```css
.stat-bar-fill.hp {
  background: linear-gradient(to right, #f44336, #4caf50);
  background-size: 200% 100%;
  /* Position based on HP percentage */
}
```

### 8.3 Delta Display

Show change amount briefly:

| Property | Value |
|----------|-------|
| Duration | 800ms |
| Position | Next to bar |
| Format | "+50" (green) or "-30" (red) |
| Fade | Starts fading at 400ms |

---

## 9. Status Effect Indicators

Visual icons showing active buffs and debuffs on units.

### 9.1 Icon Display

| Property | Value |
|----------|-------|
| Position | Row above unit sprite |
| Size | 16x16 pixels per icon |
| Max Icons | 4 visible (scroll if more) |
| Spacing | 2px between icons |

### 9.2 Status Icon Colors

| Effect Type | Icon Color |
|-------------|------------|
| Buff (Attack Up, etc.) | Green border |
| Debuff (Poison, etc.) | Red border |
| Neutral (Haste, etc.) | Blue border |
| Harmful DoT | Purple pulsing |

### 9.3 Pulse Animation

Active status effects pulse to draw attention:

```javascript
// Icon pulse animation
const pulse = 0.7 + Math.sin(time * Math.PI * 2) * 0.3;
ctx.globalAlpha = pulse;
```

| Property | Value |
|----------|-------|
| Pulse Cycle | 1000ms |
| Opacity Range | 0.4 to 1.0 |
| Scale | None (fixed 16x16) |

### 9.4 Tooltip (Desktop)

On mouse hover over status icon:

- Show effect name
- Show remaining duration
- Show effect description

---

## 10. Camera System

The battle camera provides smooth tracking and transitions between units.

### 10.1 Camera Modes

| Mode | Description | Trigger |
|------|-------------|---------|
| follow | Auto-tracks active unit | Turn start, spacebar |
| manual | Player-controlled pan | Mouse drag, WASD keys |

### 10.2 Turn Transition Pan

When a new turn starts, the camera smoothly pans to the active unit:

```javascript
startTurnTransition(targetX, targetY, onComplete, duration = 800) {
  this.turnTransitionActive = true;
  this.turnTransitionStart = { x: this.x, y: this.y };
  this.turnTransitionTarget = { x: targetX, y: targetY };
  this.turnTransitionDuration = duration;
  this.onTurnTransitionComplete = onComplete;
}
```

| Property | Value |
|----------|-------|
| Duration | 300ms (configurable up to 800ms) |
| Easing | Ease-out cubic |
| Settle Delay | 100ms after reaching target |

### 10.3 Easing Function

```javascript
easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
```

### 10.4 Follow Movement

During unit movement animations, camera follows with smooth interpolation:

| Property | Value |
|----------|-------|
| Lerp Speed | 5 (higher = faster) |
| Snap Threshold | 1px (distance to snap) |

---

## 11. Attack Animations

Visual effects for combat actions.

### 11.1 Slash Effect

Melee attack visual:

```javascript
addSlash(startX, startY, endX, endY) {
  this.animations.push({
    type: 'slash',
    startX, startY,
    endX, endY,
    timer: 0,
    duration: 0.2
  });
}
```

| Property | Value |
|----------|-------|
| Duration | 200ms |
| Color | White (#ffffff) |
| Line Width | 3px (fading to 0) |
| Cap Style | Round |

### 11.2 Hit Flash

Brief flash on damaged unit:

| Property | Value |
|----------|-------|
| Duration | 300ms |
| Color | White (radial gradient to transparent) |
| Radius | 30px (shrinking to 0) |

### 11.3 Particle Burst

Impact particles on hit:

```javascript
addParticleBurst(x, y, color = '#ff4444', count = 8) {
  const angleStep = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    // Create particle with velocity and gravity
  }
}
```

| Property | Value |
|----------|-------|
| Count | 8 particles |
| Speed | 60-100 pixels/second |
| Size | 3-5px radius |
| Duration | 600ms |
| Gravity | 100 pixels/s^2 |

---

## 12. Turn Banner Display

Large text overlay announcing turn changes.

### 12.1 Player Turn Banner

| Property | Value |
|----------|-------|
| Text | "Your Turn" |
| Color | Gold (#ffd700) |
| Position | Center of screen |
| Duration | 1000ms |
| Animation | Fade in (200ms), hold, fade out (200ms) |

### 12.2 Enemy Turn Banner

| Property | Value |
|----------|-------|
| Text | "Enemy Turn" |
| Color | Red (#e74c3c) |
| Position | Center of screen |
| Duration | 800ms |
| Animation | Same as player |

---

## 13. Accessibility Considerations

### 13.1 Timing

| Consideration | Implementation |
|---------------|----------------|
| Minimum display time | All intent highlights shown 500ms minimum |
| Animation speed | No animation faster than 150ms |
| Pause option | Future: ability to pause animations |

### 13.2 Color Choices

| Consideration | Implementation |
|---------------|----------------|
| Colorblind modes | Future: high contrast option |
| Contrast | All highlights include dark border |
| Text readability | All text has black outline/shadow |

### 13.3 Alternative Indicators

| Visual | Alternative |
|--------|-------------|
| Color highlights | Shape outlines (borders) |
| Pulsing effects | Steady state also visible |
| Damage numbers | HP bar changes |

---

## 14. WebSocket Integration

### 14.1 Battle Room Subscription

```javascript
// Join battle room for real-time updates
{
  "type": "join_room",
  "payload": {
    "room": "battle:123"
  }
}
```

### 14.2 Animation-Triggering Events

| Event | Triggers |
|-------|----------|
| `battle:turn_start` | Camera pan, turn banner, UI update |
| `battle:intent_highlight` | Tile highlights, thinking indicator |
| `battle:action_result` | Attack animation, damage numbers, HP update |
| `battle:turn_end` | Clear highlights, prepare next turn |
| `battle:unit_moved` | Movement animation along path |
| `battle:unit_died` | Death animation, unit removal |

### 14.3 Client-Side Event Handling

```javascript
websocket.on('battle:action_result', async (payload) => {
  const { unitId, action, result } = payload;
  const unit = findUnit(unitId);

  // 1. Play attack animation
  await battleAnimations.playAction(unit, action, result);

  // 2. Show damage numbers
  if (result.damage) {
    battleAnimations.addDamageNumber(
      targetScreenX, targetScreenY,
      result.damage, result.critical
    );
  }

  // 3. Update HP bars (smooth transition)
  battleUI.updateUnitBars(targetUnit);

  // 4. Handle status effects
  if (result.effectsApplied) {
    battleAnimations.addStatusEffect(
      targetScreenX, targetScreenY,
      result.effectsApplied[0]
    );
  }
});
```

---

## 15. Implementation Files

| File | Purpose |
|------|---------|
| `frontend/public/src/battle/BattleAnimations.js` | Core animation system |
| `frontend/public/src/battle/BattleCamera.js` | Camera movement and transitions |
| `frontend/public/src/battle/BattleUI.js` | HP bars, turn order, UI panels |
| `frontend/public/src/battle/BattleGrid.js` | Tile highlighting and rendering |
| `frontend/public/src/scenes/BattleScene.js` | Orchestrates all battle visuals |

---

## 16. Related Documents

| Document | Description |
|----------|-------------|
| [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) | CT system, turn state machine, WebSocket protocol |
| [GAME_DESIGN.md](GAME_DESIGN.md) | Combat formulas, status effects |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle endpoints and WebSocket messages |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Frontend architecture, canvas layers |

---

## 17. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document: animation system, intent visualization, timing constants, accessibility |
