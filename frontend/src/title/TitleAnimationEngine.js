import { TITLE_COLORS } from './TitleColors.js';
import { CastleRenderer } from './components/CastleRenderer.js';
import { RiverRenderer } from './components/RiverRenderer.js';
import { ForestRenderer } from './components/ForestRenderer.js';
import { BridgeRenderer } from './components/BridgeRenderer.js';
import { CastleGateRenderer } from './components/CastleGateRenderer.js';
import { StormyBackgroundRenderer } from './components/StormyBackgroundRenderer.js';
import { Soldier } from './entities/Soldier.js';
import { Goblin } from './entities/Goblin.js';
import { Bat } from './entities/Bat.js';
import { Slime } from './entities/Slime.js';
import { DustEmitter } from './effects/DustEmitter.js';
import { LightBurst } from './effects/LightBurst.js';
import { TransitionOverlay } from './effects/TransitionOverlay.js';

/**
 * Timeline markers for animation phases (in milliseconds).
 * Revised layout: castle left, vertical river center, forest right
 * Collision happens on the bridge spanning the river
 */
const TIMELINE = {
  fadeIn: 0,
  fadeInEnd: 800,
  sceneReveal: 800,
  sceneRevealEnd: 1400,
  gateOpen: 1400,
  gateOpenEnd: 2200,
  soldiersEmerge: 2200,
  soldiersEnd: 3400,
  monstersEmerge: 3400,
  monstersEnd: 4400,
  collision: 4400,
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
    this.background = null;
    this.castle = null;
    this.river = null;
    this.forest = null;
    this.bridge = null;
    this.gate = null;

    // Entities
    this.soldiers = [];
    this.goblins = [];
    this.bats = [];
    this.slimes = [];

    // Effects
    this.dustEmitter = null;
    this.lightBurst = null;
    this.transition = null;

    // Spawn tracking
    this.gateOpened = false;
    this.soldiersSpawned = false;
    this.monstersSpawned = false;
    this.lightBurstTriggered = false;
    this.transitionStarted = false;

    // Staggered soldier spawning
    this.soldierSpawnQueue = [];
    this.soldierSpawnTimer = 0;
    this.soldierSpawnIndex = 0;

    // Dust emission tracking
    this.lastDustTime = 0;
    this.dustInterval = 120;
  }

  /**
   * Initialize all scene components.
   */
  init() {
    const w = this.width;
    const h = this.height;

    // Scale calculations
    const scaleX = w / 800;
    const scaleY = h / 600;
    const scale = Math.min(scaleX, scaleY);

    // Layout positions (revised for vertical river)
    // Castle on left side
    const castleX = w * 0.12;
    const castleY = h * 0.50;

    // Vertical river in center
    const riverX = w * 0.48;
    const riverY = 0;
    const riverWidth = 40 * scale;
    const riverHeight = h;

    // Bridge spanning the river (horizontal)
    const bridgeY = h * 0.55;
    const bridgeWidth = 80 * scale;
    const bridgeHeight = 20 * scale;
    const bridgeX = riverX - bridgeWidth / 2 + riverWidth / 2;

    // Forest on right side
    const forestX = w * 0.75;
    const forestY = h * 0.35;

    // Gate position (in front of castle, aligned with bridge)
    const gateX = castleX + 70 * scale;
    const gateY = bridgeY + bridgeHeight / 2;

    // Collision point (center of bridge)
    this.collisionX = riverX + riverWidth / 2;
    this.collisionY = bridgeY + bridgeHeight / 2;

    // Store spawn positions (soldiers spawn inside the gate doorway)
    this.soldierSpawnX = gateX - 5 * scale;
    this.soldierSpawnY = gateY;
    this.soldierTargetX = this.collisionX - 15;
    this.soldierTargetY = this.collisionY;

    this.monsterSpawnX = forestX;
    this.monsterSpawnY = bridgeY + bridgeHeight / 2;
    this.monsterTargetX = this.collisionX + 15;
    this.monsterTargetY = this.collisionY;

    // Create components
    this.background = new StormyBackgroundRenderer(w, h);
    this.castle = new CastleRenderer(castleX, castleY, scale * 0.85);
    this.river = new RiverRenderer(riverX, riverY, riverWidth, riverHeight, true); // vertical
    this.forest = new ForestRenderer(forestX, forestY, 10, w, h);
    this.bridge = new BridgeRenderer(bridgeX, bridgeY, bridgeWidth, bridgeHeight);
    this.gate = new CastleGateRenderer(gateX, gateY, scale);

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
    this.background.update(deltaTime);
    this.castle.update(deltaTime);
    this.river.update(deltaTime);
    this.gate.update(deltaTime);

    // Update transition overlay
    this.transition.update(deltaTime);

    // Process timeline events
    this.processTimeline();

    // Process staggered soldier spawning
    this.processStaggeredSpawns(deltaTime);

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

    // Gate opens
    if (t >= TIMELINE.gateOpen && !this.gateOpened) {
      this.gate.open();
      this.gateOpened = true;
    }

    // Soldiers emerge (after gate starts opening)
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
   * Queue soldier entities to spawn from the gate with staggered timing.
   */
  spawnSoldiers() {
    // Soldiers emerge one by one with spread formation
    // Each soldier spawns from gate center and runs to their target position
    const formations = [
      { targetOffset: { x: -30, y: -16 } },   // Far left back
      { targetOffset: { x: 30, y: -16 } },    // Far right back
      { targetOffset: { x: -38, y: 4 } },     // Far left mid
      { targetOffset: { x: 38, y: 4 } },      // Far right mid
      { targetOffset: { x: -24, y: 18 } },    // Left front
      { targetOffset: { x: 24, y: 18 } }      // Right front
    ];

    // Queue all soldiers for staggered spawning
    this.soldierSpawnQueue = formations.map(f => ({
      targetOffset: f.targetOffset
    }));
    this.soldierSpawnTimer = 0;
  }

  /**
   * Process staggered soldier spawns over time.
   */
  processStaggeredSpawns(deltaTime) {
    if (this.soldierSpawnQueue.length === 0) return;

    this.soldierSpawnTimer += deltaTime;

    // Alternate delays: 250ms for even soldiers, 500ms for odd
    const currentDelay = this.soldierSpawnIndex % 2 === 0 ? 250 : 500;

    // Spawn next soldier when timer exceeds delay
    if (this.soldierSpawnTimer >= currentDelay) {
      this.soldierSpawnTimer = 0;

      const spawnData = this.soldierSpawnQueue.shift();
      this.soldierSpawnIndex++;

      // Spawn from gate center with slight random offset
      const soldier = new Soldier(
        this.soldierSpawnX + (Math.random() - 0.5) * 8,
        this.soldierSpawnY + (Math.random() - 0.5) * 6
      );

      // Run to spread formation position
      soldier.moveTo(
        this.soldierTargetX + spawnData.targetOffset.x,
        this.soldierTargetY + spawnData.targetOffset.y
      );

      this.soldiers.push(soldier);
    }
  }

  /**
   * Spawn monster entities from forest toward the bridge.
   */
  spawnMonsters() {
    // Goblins
    for (let i = 0; i < 5; i++) {
      const goblin = new Goblin(
        this.monsterSpawnX + Math.random() * 30,
        this.monsterSpawnY + 20 + Math.random() * 40 - 20
      );
      goblin.moveTo(
        this.monsterTargetX - (i % 3) * 14 + 14,
        this.monsterTargetY + Math.floor(i / 3) * 10 - 5
      );
      this.goblins.push(goblin);
    }

    // Bats
    for (let i = 0; i < 4; i++) {
      const bat = new Bat(
        this.monsterSpawnX + 20 + i * 20,
        this.monsterSpawnY - 40 + Math.random() * 20
      );
      this.bats.push(bat);
    }

    // Slimes
    for (let i = 0; i < 3; i++) {
      const slime = new Slime(
        this.monsterSpawnX + 10 + i * 25,
        this.monsterSpawnY + 50
      );
      slime.moveTo(
        this.monsterTargetX + 10 + i * 16,
        this.monsterTargetY + 15
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

      for (const soldier of this.soldiers) {
        if (soldier.isMoving) {
          this.dustEmitter.emit(soldier.x - soldier.direction * 8, soldier.y, soldier.direction, 0.5);
        }
      }

      for (const goblin of this.goblins) {
        if (goblin.isMoving) {
          this.dustEmitter.emit(goblin.x - goblin.direction * 6, goblin.y, goblin.direction, 0.4);
        }
      }

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
    // Render stormy background (sky, clouds, back rain)
    this.background.render(ctx);

    // Don't render scene elements if still in black fade
    if (!this.transition.isFadingIn() || this.timer > 400) {
      // Render layers back to front
      this.forest.renderBackLayer(ctx);  // Distant forest trees (behind everything)
      this.forest.renderMidLayer(ctx);   // Mid-layer forest trees
      this.river.render(ctx);            // Vertical river in center
      this.bridge.render(ctx);           // Bridge over river
      this.castle.render(ctx);           // Castle on left
      this.gate.render(ctx);             // Gate in front of castle

      // Render entities (sorted by Y for depth)
      this.renderEntities(ctx);

      // Render front forest layer (trees in front of entities for depth)
      this.forest.renderFrontLayer(ctx);

      // Render dust particles
      this.dustEmitter.render(ctx);

      // Render foreground rain
      this.background.renderRainForeground(ctx);
    }

    // Render light burst effect
    this.lightBurst.render(ctx);

    // Render transition overlays (on top of everything)
    this.transition.render(ctx);

    // Render skip hint
    this.renderSkipHint(ctx);
  }

  /**
   * Render all entities sorted by Y position for depth.
   */
  renderEntities(ctx) {
    const allEntities = [
      ...this.soldiers.map(e => ({ entity: e, y: e.y })),
      ...this.goblins.map(e => ({ entity: e, y: e.y })),
      ...this.slimes.map(e => ({ entity: e, y: e.groundY }))
    ];

    allEntities.sort((a, b) => a.y - b.y);

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
    if (this.timer < 2000) return;

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

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText('Press any key to skip', this.width / 2 + 1, this.height - 19);

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
    this.soldiers = [];
    this.goblins = [];
    this.bats = [];
    this.slimes = [];

    if (this.dustEmitter) {
      this.dustEmitter.clear();
    }
    this.lightBurst = null;
    this.transition = null;

    this.background = null;
    this.castle = null;
    this.river = null;
    this.forest = null;
    this.bridge = null;
    this.gate = null;

    this.phase = 'destroyed';
  }
}
