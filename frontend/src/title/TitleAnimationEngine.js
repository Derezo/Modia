import { TITLE_COLORS } from './TitleColors.js';
import { CastleRenderer } from './components/CastleRenderer.js';
import { RiverRenderer } from './components/RiverRenderer.js';
import { ForestRenderer } from './components/ForestRenderer.js';
import { PathRenderer } from './components/PathRenderer.js';
import { DrawbridgeRenderer } from './components/DrawbridgeRenderer.js';
import { Soldier } from './entities/Soldier.js';
import { Goblin } from './entities/Goblin.js';
import { Bat } from './entities/Bat.js';
import { Slime } from './entities/Slime.js';
import { DustEmitter } from './effects/DustEmitter.js';
import { LightBurst } from './effects/LightBurst.js';
import { TransitionOverlay } from './effects/TransitionOverlay.js';

/**
 * Timeline markers for animation phases (in milliseconds).
 */
const TIMELINE = {
  fadeIn: 0,
  fadeInEnd: 800,
  castleReveal: 800,
  castleRevealEnd: 1400,
  drawbridgeDrop: 1400,
  drawbridgeEnd: 2400,
  soldiersEmerge: 2400,
  soldiersEnd: 3600,
  monstersEmerge: 3600,
  monstersEnd: 4600,
  collision: 4600,
  lightBurst: 5000,
  fadeToLogin: 5800,
  complete: 6500
};

/**
 * Orchestrates the entire title screen animation sequence.
 */
export class TitleAnimationEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;

    // Animation state
    this.phase = 'idle';
    this.timer = 0;
    this.complete = false;

    // Scene components
    this.castle = null;
    this.river = null;
    this.forest = null;
    this.path = null;
    this.drawbridge = null;

    // Entities
    this.soldiers = [];
    this.goblins = [];
    this.bats = [];
    this.slimes = [];

    // Effects
    this.dustEmitter = null;
    this.lightBurst = null;
    this.transition = null;

    // Entity spawn tracking
    this.soldiersSpawned = false;
    this.monstersSpawned = false;
    this.lightBurstTriggered = false;
    this.transitionStarted = false;

    // Dust emission tracking
    this.lastDustTime = 0;
    this.dustInterval = 120; // ms between dust emissions
  }

  /**
   * Initialize all scene components.
   */
  init() {
    const w = this.width;
    const h = this.height;

    // Position calculations (scaled to canvas size)
    const scaleX = w / 800;
    const scaleY = h / 600;
    const scale = Math.min(scaleX, scaleY);

    // Castle position (left-center)
    const castleX = w * 0.25;
    const castleY = h * 0.58;

    // Forest position (right side)
    const forestX = w * 0.62;
    const forestY = h * 0.42;

    // River position (below castle)
    const riverY = h * 0.68;

    // Collision point (middle of battlefield)
    this.collisionX = w * 0.48;
    this.collisionY = h * 0.60;

    // Create components
    this.castle = new CastleRenderer(castleX, castleY, scale * 0.9);
    this.river = new RiverRenderer(riverY, w, 50 * scale);
    this.forest = new ForestRenderer(forestX, forestY, 12);
    this.path = new PathRenderer([
      { x: castleX + 60 * scale, y: riverY - 8 },
      { x: w * 0.35, y: h * 0.64 },
      { x: this.collisionX, y: this.collisionY },
      { x: w * 0.58, y: h * 0.56 },
      { x: forestX - 20, y: forestY + 80 }
    ]);
    this.drawbridge = new DrawbridgeRenderer(castleX, riverY - 12);

    // Create effects
    this.dustEmitter = new DustEmitter();
    this.lightBurst = new LightBurst(this.collisionX, this.collisionY);
    this.transition = new TransitionOverlay();

    // Start the animation
    this.phase = 'running';
    this.timer = 0;
    this.transition.startFadeIn();
  }

  /**
   * Update animation state.
   * @param {number} deltaTime - Time since last frame in milliseconds
   */
  update(deltaTime) {
    if (this.phase !== 'running') return;

    this.timer += deltaTime;

    // Update components
    this.castle.update(deltaTime);
    this.river.update(deltaTime);
    this.drawbridge.update(deltaTime);

    // Update transition overlay
    this.transition.update(deltaTime);

    // Process timeline events
    this.processTimeline();

    // Update entities
    this.updateEntities(deltaTime);

    // Update effects
    this.dustEmitter.update(deltaTime);
    this.lightBurst.update(deltaTime);

    // Emit dust behind moving entities
    this.emitDust(deltaTime);

    // Check for completion
    if (this.timer >= TIMELINE.complete && this.transition.isComplete()) {
      this.complete = true;
      this.phase = 'complete';
    }
  }

  /**
   * Process timeline-based events.
   */
  processTimeline() {
    const t = this.timer;

    // Drawbridge drops
    if (t >= TIMELINE.drawbridgeDrop && this.drawbridge.isRaised()) {
      this.drawbridge.lower();
      // Open portcullis as drawbridge lowers
      this.castle.setPortcullisOpen(0.8);
    }

    // Soldiers emerge
    if (t >= TIMELINE.soldiersEmerge && !this.soldiersSpawned) {
      this.spawnSoldiers();
      this.soldiersSpawned = true;
    }

    // Monsters emerge from forest
    if (t >= TIMELINE.monstersEmerge && !this.monstersSpawned) {
      this.spawnMonsters();
      this.monstersSpawned = true;
    }

    // Light burst at collision
    if (t >= TIMELINE.lightBurst && !this.lightBurstTriggered) {
      this.lightBurst.trigger();
      this.dustEmitter.emitImpact(this.collisionX, this.collisionY);
      this.lightBurstTriggered = true;
    }

    // Start fade to login
    if (t >= TIMELINE.fadeToLogin && !this.transitionStarted) {
      this.transition.startFadeToLogin();
      this.transitionStarted = true;
    }
  }

  /**
   * Spawn soldier entities.
   */
  spawnSoldiers() {
    const spawnX = this.width * 0.28;
    const spawnY = this.height * 0.66;
    const targetX = this.collisionX - 30;
    const targetY = this.collisionY;

    for (let i = 0; i < 6; i++) {
      const soldier = new Soldier(
        spawnX + (i % 2) * 15,
        spawnY - Math.floor(i / 2) * 12
      );

      // Stagger target positions
      soldier.moveTo(
        targetX + (i % 3) * 18 - 18,
        targetY + Math.floor(i / 3) * 15 - 8
      );

      this.soldiers.push(soldier);
    }
  }

  /**
   * Spawn monster entities (goblins, bats, slimes).
   */
  spawnMonsters() {
    const forestX = this.width * 0.72;
    const forestY = this.height * 0.52;
    const targetX = this.collisionX + 30;
    const targetY = this.collisionY;

    // Spawn goblins
    for (let i = 0; i < 5; i++) {
      const goblin = new Goblin(
        forestX + Math.random() * 40,
        forestY + 60 + Math.random() * 40
      );
      goblin.moveTo(
        targetX - (i % 3) * 18 + 18,
        targetY + Math.floor(i / 3) * 12 - 6
      );
      this.goblins.push(goblin);
    }

    // Spawn bats (staggered)
    for (let i = 0; i < 4; i++) {
      const bat = new Bat(
        forestX + 30 + i * 25,
        forestY - 10 + Math.random() * 40
      );
      this.bats.push(bat);
    }

    // Spawn slimes
    for (let i = 0; i < 3; i++) {
      const slime = new Slime(
        forestX + 20 + i * 30,
        forestY + 100
      );
      slime.moveTo(
        targetX + 20 + i * 25,
        targetY + 15
      );
      this.slimes.push(slime);
    }
  }

  /**
   * Update all entity positions.
   */
  updateEntities(deltaTime) {
    for (const soldier of this.soldiers) {
      soldier.update(deltaTime);
    }

    for (const goblin of this.goblins) {
      goblin.update(deltaTime);
    }

    for (const bat of this.bats) {
      bat.update(deltaTime);
    }

    for (const slime of this.slimes) {
      slime.update(deltaTime);
    }

    // Remove off-screen bats
    this.bats = this.bats.filter(bat => !bat.isOffScreen(this.width));
  }

  /**
   * Emit dust particles behind moving entities.
   */
  emitDust(deltaTime) {
    this.lastDustTime += deltaTime;

    if (this.lastDustTime >= this.dustInterval) {
      this.lastDustTime = 0;

      // Dust behind soldiers
      for (const soldier of this.soldiers) {
        if (soldier.isMoving) {
          this.dustEmitter.emit(soldier.x - soldier.direction * 8, soldier.y, soldier.direction, 0.5);
        }
      }

      // Dust behind goblins
      for (const goblin of this.goblins) {
        if (goblin.isMoving) {
          this.dustEmitter.emit(goblin.x - goblin.direction * 6, goblin.y, goblin.direction, 0.4);
        }
      }

      // Dust behind slimes (when landing)
      for (const slime of this.slimes) {
        if (slime.isMoving && slime.hopHeight < 3) {
          this.dustEmitter.emit(slime.x, slime.groundY, slime.direction, 0.6);
        }
      }
    }
  }

  /**
   * Render the scene.
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  render(ctx) {
    // Clear with parchment background
    this.renderBackground(ctx);

    // Don't render scene if still in black fade
    if (!this.transition.isFadingIn() || this.timer > 400) {
      // Render layers back to front
      this.forest.render(ctx);
      this.path.render(ctx);
      this.castle.render(ctx);
      this.drawbridge.render(ctx);
      this.river.render(ctx);

      // Render entities (sorted by Y for depth)
      this.renderEntities(ctx);

      // Render dust particles
      this.dustEmitter.render(ctx);
    }

    // Render light burst effect
    this.lightBurst.render(ctx);

    // Render transition overlays (on top of everything)
    this.transition.render(ctx);

    // Render skip hint
    this.renderSkipHint(ctx);
  }

  /**
   * Render the background gradient.
   */
  renderBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, TITLE_COLORS.parchment.light);
    gradient.addColorStop(0.5, TITLE_COLORS.parchment.mid);
    gradient.addColorStop(1, TITLE_COLORS.parchment.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    // Subtle vignette
    const vignette = ctx.createRadialGradient(
      this.width / 2, this.height / 2, 0,
      this.width / 2, this.height / 2, this.width * 0.7
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Render all entities sorted by Y position for depth.
   */
  renderEntities(ctx) {
    // Collect all entities with their Y positions
    const allEntities = [
      ...this.soldiers.map(e => ({ entity: e, y: e.y })),
      ...this.goblins.map(e => ({ entity: e, y: e.y })),
      ...this.slimes.map(e => ({ entity: e, y: e.groundY }))
    ];

    // Sort by Y (entities further back rendered first)
    allEntities.sort((a, b) => a.y - b.y);

    // Render sorted entities
    for (const { entity } of allEntities) {
      entity.render(ctx);
    }

    // Bats render above everything (flying)
    for (const bat of this.bats) {
      bat.render(ctx);
    }
  }

  /**
   * Render the skip hint text.
   */
  renderSkipHint(ctx) {
    // Only show after 2 seconds
    if (this.timer < 2000) return;

    // Fade out during transition
    let alpha = 0.55;
    if (this.timer > TIMELINE.lightBurst) {
      alpha = Math.max(0, 0.55 - (this.timer - TIMELINE.lightBurst) / 800);
    }

    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '14px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Text shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText('Press any key to skip', this.width / 2 + 1, this.height - 19);

    // Main text
    ctx.fillStyle = TITLE_COLORS.ui.textLight;
    ctx.fillText('Press any key to skip', this.width / 2, this.height - 20);

    ctx.restore();
  }

  /**
   * Check if the animation is complete.
   */
  isComplete() {
    return this.complete;
  }

  /**
   * Get current timer value.
   */
  getTimer() {
    return this.timer;
  }

  /**
   * Clean up all resources.
   */
  destroy() {
    // Clear entity arrays
    this.soldiers = [];
    this.goblins = [];
    this.bats = [];
    this.slimes = [];

    // Clear effects
    if (this.dustEmitter) {
      this.dustEmitter.clear();
    }
    this.lightBurst = null;
    this.transition = null;

    // Clear component references
    this.castle = null;
    this.river = null;
    this.forest = null;
    this.path = null;
    this.drawbridge = null;

    this.phase = 'destroyed';
  }
}
