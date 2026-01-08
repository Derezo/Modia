/**
 * BattleIntro - Dramatic battle introduction sequence
 *
 * Timeline:
 * 0-1.5s: Cards fade in (players on left, enemies on right)
 * 1.5-3.5s: Cards hold visible
 * 3.5-6.5s: Camera pans across battlefield (enemies -> players -> active unit)
 * 6.5-7s: Cards fade out
 * 7s+: Complete, battle begins
 */
export class BattleIntro {
  constructor(battleScene) {
    this.scene = battleScene;

    // Intro state
    this.phase = 'idle';  // 'idle' | 'cards_in' | 'cards_hold' | 'camera_pan' | 'cards_out' | 'complete'
    this.timer = 0;

    // Phase durations (milliseconds)
    this.cardsFadeInDuration = 1500;    // 0-1.5s
    this.cardsHoldDuration = 2000;      // 1.5-3.5s
    this.cameraPanDuration = 3000;      // 3.5-6.5s
    this.cardsFadeOutDuration = 500;    // 6.5-7s
    this.totalDuration = 7000;

    // Card data
    this.playerCards = [];
    this.enemyCards = [];
    this.cardAlpha = 0;

    // Camera waypoints for pan
    this.cameraWaypoints = [];
    this.cameraStartPos = null;
  }

  /**
   * Start the intro sequence
   */
  start() {
    this.phase = 'cards_in';
    this.timer = 0;
    this.cardAlpha = 0;

    // Build character cards from battle state
    this.buildCharacterCards();

    // Calculate camera waypoints
    this.calculateCameraWaypoints();

    // Store starting camera position
    this.cameraStartPos = {
      x: this.scene.camera.targetX,
      y: this.scene.camera.targetY
    };
  }

  /**
   * Build card data for players and enemies
   */
  buildCharacterCards() {
    const state = this.scene.battleState;
    if (!state || !state.units) return;

    const canvasWidth = this.scene.game.canvas.width;

    // Player cards on LEFT side (stacked vertically)
    const players = state.units.filter(u => u.type === 'player');
    this.playerCards = players.map((unit, i) => ({
      unit,
      x: 20,
      y: 80 + i * 100,
      width: 200,
      height: 90
    }));

    // Enemy cards on RIGHT side (stacked vertically)
    const enemies = state.units.filter(u => u.type === 'enemy');
    this.enemyCards = enemies.map((unit, i) => ({
      unit,
      x: canvasWidth - 220,
      y: 80 + i * 90,
      width: 200,
      height: 80
    }));
  }

  /**
   * Calculate camera waypoints for the pan sequence
   * Pans to each enemy individually, then player lead, then active unit
   */
  calculateCameraWaypoints() {
    const state = this.scene.battleState;
    if (!state || !state.units) return;

    const enemies = state.units.filter(u => u.type === 'enemy');
    const players = state.units.filter(u => u.type === 'player');
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    // Build waypoints: each enemy → player lead → active unit
    this.cameraWaypoints = [];

    // Add each enemy as a waypoint (pan to each one)
    for (const enemy of enemies) {
      this.cameraWaypoints.push(this.getUnitScreenPos(enemy));
    }

    // Add player lead character (first player in formation order)
    if (players.length > 0) {
      this.cameraWaypoints.push(this.getUnitScreenPos(players[0]));
    }

    // Add active unit if different from player lead
    if (activeUnit) {
      const activePos = this.getUnitScreenPos(activeUnit);
      const lastWaypoint = this.cameraWaypoints[this.cameraWaypoints.length - 1];
      // Only add if different position than last waypoint
      if (!lastWaypoint || activePos.x !== lastWaypoint.x || activePos.y !== lastWaypoint.y) {
        this.cameraWaypoints.push(activePos);
      }
    }

    // Adjust camera pan duration based on number of waypoints (~1s per waypoint)
    const waypointCount = this.cameraWaypoints.length;
    this.cameraPanDuration = Math.max(2000, waypointCount * 1000);
    // Update total duration accordingly
    this.totalDuration = this.cardsFadeInDuration + this.cardsHoldDuration +
                         this.cameraPanDuration + this.cardsFadeOutDuration;
  }

  /**
   * Get centroid position of a group of units
   */
  getCentroid(units) {
    if (units.length === 0) return { x: 0, y: 0 };
    let sumX = 0, sumY = 0;
    for (const u of units) {
      const pos = this.getUnitScreenPos(u);
      sumX += pos.x;
      sumY += pos.y;
    }
    return { x: sumX / units.length, y: sumY / units.length };
  }

  /**
   * Get world position of a unit for camera targeting
   */
  getUnitScreenPos(unit) {
    if (this.scene.grid) {
      return this.scene.grid.gridToScreenWorld(unit.tileX, unit.tileY);
    }
    // Fallback
    return { x: unit.tileX * 64, y: unit.tileY * 32 };
  }

  /**
   * Update intro animation
   * @param {number} deltaTime - Time since last frame (seconds)
   */
  update(deltaTime) {
    if (this.phase === 'complete' || this.phase === 'idle') return;

    this.timer += deltaTime * 1000;  // Convert to ms

    const t = this.timer;

    if (t < this.cardsFadeInDuration) {
      // Phase: Cards fading in (0 - 1.5s)
      this.phase = 'cards_in';
      this.cardAlpha = this.easeOutCubic(t / this.cardsFadeInDuration);

    } else if (t < this.cardsFadeInDuration + this.cardsHoldDuration) {
      // Phase: Cards holding (1.5s - 3.5s)
      this.phase = 'cards_hold';
      this.cardAlpha = 1;

    } else if (t < this.cardsFadeInDuration + this.cardsHoldDuration + this.cameraPanDuration) {
      // Phase: Camera panning (3.5s - 6.5s)
      this.phase = 'camera_pan';
      this.cardAlpha = 1;
      this.updateCameraPan();

    } else if (t < this.totalDuration) {
      // Phase: Cards fading out (6.5s - 7s)
      this.phase = 'cards_out';
      const fadeOutStart = this.totalDuration - this.cardsFadeOutDuration;
      const fadeProgress = (t - fadeOutStart) / this.cardsFadeOutDuration;
      this.cardAlpha = 1 - this.easeInCubic(fadeProgress);

    } else {
      // Complete
      this.phase = 'complete';
      this.cardAlpha = 0;
    }
  }

  /**
   * Update camera position during pan phase
   */
  updateCameraPan() {
    const panStart = this.cardsFadeInDuration + this.cardsHoldDuration;
    const panElapsed = this.timer - panStart;
    const panProgress = Math.min(1, panElapsed / this.cameraPanDuration);

    if (this.cameraWaypoints.length === 0) return;

    // Handle single waypoint case - just hold on that position
    if (this.cameraWaypoints.length === 1) {
      const pos = this.cameraWaypoints[0];
      if (this.scene.camera) {
        this.scene.camera.targetX = pos.x;
        this.scene.camera.targetY = pos.y;
        this.scene.camera.x = pos.x;
        this.scene.camera.y = pos.y;
      }
      return;
    }

    // Ease in-out for smooth camera movement
    const easedProgress = this.easeInOutCubic(panProgress);

    // Interpolate through waypoints
    const waypointCount = this.cameraWaypoints.length;
    const segmentProgress = easedProgress * (waypointCount - 1);
    const segmentIndex = Math.min(Math.floor(segmentProgress), waypointCount - 2);
    const segmentT = segmentProgress - segmentIndex;

    const from = this.cameraWaypoints[segmentIndex];
    const to = this.cameraWaypoints[segmentIndex + 1];

    const targetX = from.x + (to.x - from.x) * segmentT;
    const targetY = from.y + (to.y - from.y) * segmentT;

    // Update camera - set both target and actual position directly
    // (BattleScene returns early during intro so camera.update() doesn't run)
    if (this.scene.camera) {
      this.scene.camera.targetX = targetX;
      this.scene.camera.targetY = targetY;
      this.scene.camera.x = targetX;
      this.scene.camera.y = targetY;
    }
  }

  /**
   * Render intro cards overlay
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.phase === 'complete' || this.phase === 'idle') return;
    if (this.cardAlpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.cardAlpha;

    // Semi-transparent overlay during intro
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Render player cards (left side, blue theme)
    for (const card of this.playerCards) {
      this.renderCard(ctx, card, 'player');
    }

    // Render enemy cards (right side, red theme)
    for (const card of this.enemyCards) {
      this.renderCard(ctx, card, 'enemy');
    }

    // Title
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('BATTLE START', ctx.canvas.width / 2, 40);

    ctx.restore();
  }

  /**
   * Render a single character card
   */
  renderCard(ctx, card, type) {
    const { unit, x, y, width, height } = card;

    // Card background
    const bgColor = type === 'player' ? 'rgba(74, 144, 217, 0.9)' : 'rgba(180, 60, 60, 0.9)';
    ctx.fillStyle = bgColor;
    this.roundRect(ctx, x, y, width, height, 8);
    ctx.fill();

    // Border
    const borderColor = type === 'player' ? '#6ab0f3' : '#e05050';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    this.roundRect(ctx, x, y, width, height, 8);
    ctx.stroke();

    // Portrait placeholder (left side of card)
    ctx.fillStyle = '#222';
    this.roundRect(ctx, x + 8, y + 8, 48, 48, 4);
    ctx.fill();

    // Class icon in portrait area
    ctx.fillStyle = this.getClassColor(unit.class);
    ctx.beginPath();
    ctx.arc(x + 32, y + 32, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.getClassIcon(unit.class), x + 32, y + 32);

    // Unit name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(unit.name, x + 64, y + 10);

    // Level and class
    ctx.font = '11px Arial';
    ctx.fillStyle = '#ccc';
    const classText = unit.class ? `${this.capitalize(unit.class)}` : 'Unknown';
    ctx.fillText(`Lv.${unit.level} ${classText}`, x + 64, y + 28);

    // HP bar
    const barWidth = 100;
    const barHeight = 8;
    const hpPercent = Math.max(0, Math.min(1, unit.hp / unit.maxHp));

    ctx.fillStyle = '#333';
    this.roundRect(ctx, x + 64, y + 46, barWidth, barHeight, 3);
    ctx.fill();

    const hpColor = hpPercent > 0.5 ? '#4caf50' : hpPercent > 0.25 ? '#ff9800' : '#f44336';
    ctx.fillStyle = hpColor;
    this.roundRect(ctx, x + 64, y + 46, barWidth * hpPercent, barHeight, 3);
    ctx.fill();

    // MP bar
    const mpPercent = Math.max(0, Math.min(1, unit.mp / unit.maxMp));
    ctx.fillStyle = '#333';
    this.roundRect(ctx, x + 64, y + 58, barWidth, barHeight, 3);
    ctx.fill();

    ctx.fillStyle = '#2196f3';
    this.roundRect(ctx, x + 64, y + 58, barWidth * mpPercent, barHeight, 3);
    ctx.fill();

    // HP/MP labels
    ctx.font = '9px Arial';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(`HP ${unit.hp}/${unit.maxHp}`, x + width - 8, y + 52);
    ctx.fillText(`MP ${unit.mp}/${unit.maxMp}`, x + width - 8, y + 64);
  }

  /**
   * Draw a rounded rectangle path
   */
  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Check if intro is complete
   */
  isComplete() {
    return this.phase === 'complete';
  }

  /**
   * Skip the intro (for testing or user preference)
   */
  skip() {
    this.phase = 'complete';
    this.cardAlpha = 0;
    this.timer = this.totalDuration;
  }

  // Easing functions
  easeInCubic(t) {
    return t * t * t;
  }

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Helper methods
  getClassColor(className) {
    const colors = {
      warrior: '#c62828',
      wizard: '#1565c0',
      monk: '#f9a825',
      chemist: '#2e7d32',
      berserker: '#b71c1c',
      sorcerer: '#0d47a1',
      ninja: '#4a148c',
      alchemist: '#1b5e20'
    };
    return colors[className] || '#666';
  }

  getClassIcon(className) {
    const icons = {
      warrior: 'W',
      wizard: 'M',
      monk: 'K',
      chemist: 'C',
      berserker: 'B',
      sorcerer: 'S',
      ninja: 'N',
      alchemist: 'A'
    };
    return icons[className] || '?';
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }
}
