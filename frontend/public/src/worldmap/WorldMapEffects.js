/**
 * WorldMapEffects - Animated visual effects for the world map
 * Handles node glow effects, ambient particles, and backdrop rendering
 */
export class WorldMapEffects {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;

    // Particle system for ambient effects
    this.particles = [];
    this.maxParticles = 100;

    // Node glow animation state
    this.glowPhase = 0;
    this.glowSpeed = 0.003;

    // Backdrop tiles (cached)
    this.backdropTiles = {};
    this.backdropLoaded = false;

    // Path textures (cached)
    this.pathTextures = {};
    this.pathsLoaded = false;

    // Biome regions for backdrop rendering
    this.biomeRegions = [];

    // Animation timing
    this.time = 0;
  }

  /**
   * Initialize and preload assets
   */
  async init() {
    await Promise.all([
      this.loadBackdropTiles(),
      this.loadPathTextures()
    ]);
  }

  /**
   * Load backdrop tiles for world map regions
   */
  async loadBackdropTiles() {
    if (!this.assetLoader) {
      this.backdropLoaded = false;
      return;
    }

    const tileTypes = ['world_grass', 'world_water', 'world_forest', 'world_mountain', 'world_desert'];
    const basePath = '/assets/sprites/nodes/backdrop';

    for (const tileType of tileTypes) {
      try {
        const img = await this.assetLoader.loadImage(`${basePath}/${tileType}.png`);
        this.backdropTiles[tileType] = img;
      } catch (error) {
        console.warn(`Failed to load backdrop tile ${tileType}:`, error.message);
      }
    }

    this.backdropLoaded = Object.keys(this.backdropTiles).length > 0;
  }

  /**
   * Load path textures for roads
   */
  async loadPathTextures() {
    if (!this.assetLoader) {
      this.pathsLoaded = false;
      return;
    }

    const pathTypes = ['dirt_road', 'stone_path', 'bridge_planks'];
    const basePath = '/assets/sprites/nodes/paths';

    for (const pathType of pathTypes) {
      try {
        const img = await this.assetLoader.loadImage(`${basePath}/${pathType}.png`);
        this.pathTextures[pathType] = img;
      } catch (error) {
        console.warn(`Failed to load path texture ${pathType}:`, error.message);
      }
    }

    this.pathsLoaded = Object.keys(this.pathTextures).length > 0;
  }

  /**
   * Update effects each frame
   * @param {number} deltaTime - Time since last frame in ms
   */
  update(deltaTime) {
    this.time += deltaTime;

    // Update glow phase for node pulse effect
    this.glowPhase += this.glowSpeed * deltaTime;
    if (this.glowPhase > Math.PI * 2) {
      this.glowPhase -= Math.PI * 2;
    }

    // Update particles
    this.updateParticles(deltaTime);
  }

  /**
   * Update particle system
   */
  updateParticles(deltaTime) {
    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * deltaTime * 0.001;
      p.y += p.vy * deltaTime * 0.001;
      p.life -= deltaTime;
      p.alpha = Math.max(0, p.life / p.maxLife);

      // Add some drift
      p.x += Math.sin(this.time * 0.001 + p.phase) * 0.1;

      // Remove dead particles
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  /**
   * Spawn ambient particles around a node based on its type
   * @param {number} x - World X coordinate
   * @param {number} y - World Y coordinate
   * @param {string} nodeType - Type of node (forest, mountain, etc.)
   */
  spawnAmbientParticles(x, y, nodeType) {
    if (this.particles.length >= this.maxParticles) return;

    const particleConfig = this.getParticleConfig(nodeType);
    if (!particleConfig) return;

    // Spawn rate based on time
    if (Math.random() > 0.02) return;

    const particle = {
      x: x + (Math.random() - 0.5) * 60,
      y: y + (Math.random() - 0.5) * 60,
      vx: particleConfig.vx + (Math.random() - 0.5) * particleConfig.vxVariance,
      vy: particleConfig.vy + (Math.random() - 0.5) * particleConfig.vyVariance,
      size: particleConfig.size + Math.random() * particleConfig.sizeVariance,
      color: particleConfig.color,
      alpha: 1,
      life: particleConfig.life + Math.random() * particleConfig.lifeVariance,
      maxLife: particleConfig.life + Math.random() * particleConfig.lifeVariance,
      phase: Math.random() * Math.PI * 2,
      type: particleConfig.type
    };

    this.particles.push(particle);
  }

  /**
   * Get particle configuration for a node type
   */
  getParticleConfig(nodeType) {
    const configs = {
      forest: {
        type: 'leaf',
        color: '#4a7c4a',
        size: 3,
        sizeVariance: 2,
        vx: -5,
        vy: 10,
        vxVariance: 10,
        vyVariance: 5,
        life: 3000,
        lifeVariance: 2000
      },
      mountain: {
        type: 'snow',
        color: '#ffffff',
        size: 2,
        sizeVariance: 1,
        vx: -2,
        vy: 8,
        vxVariance: 4,
        vyVariance: 2,
        life: 4000,
        lifeVariance: 2000
      },
      cave: {
        type: 'dust',
        color: '#8b8b8b',
        size: 2,
        sizeVariance: 1,
        vx: 0,
        vy: -5,
        vxVariance: 3,
        vyVariance: 3,
        life: 2000,
        lifeVariance: 1000
      },
      palace: {
        type: 'sparkle',
        color: '#ffd700',
        size: 2,
        sizeVariance: 1,
        vx: 0,
        vy: -10,
        vxVariance: 5,
        vyVariance: 5,
        life: 2000,
        lifeVariance: 1000
      },
      castle: {
        type: 'sparkle',
        color: '#c0c0c0',
        size: 1,
        sizeVariance: 1,
        vx: 0,
        vy: -8,
        vxVariance: 4,
        vyVariance: 4,
        life: 2500,
        lifeVariance: 1500
      }
    };

    return configs[nodeType] || null;
  }

  /**
   * Render backdrop tiles based on camera position
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   * @param {number} cameraY
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   */
  renderBackdrop(ctx, cameraX, cameraY, canvasWidth, canvasHeight) {
    // Default dark background if no backdrop tiles
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (!this.backdropLoaded) return;

    const grassTile = this.backdropTiles['world_grass'];
    if (!grassTile) return;

    const tileSize = 64;

    // Calculate tile grid bounds based on camera
    const startX = Math.floor(-cameraX / tileSize) - 1;
    const startY = Math.floor(-cameraY / tileSize) - 1;
    const endX = startX + Math.ceil(canvasWidth / tileSize) + 2;
    const endY = startY + Math.ceil(canvasHeight / tileSize) + 2;

    // Render grass backdrop tiles
    ctx.globalAlpha = 0.3; // Subtle backdrop
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const screenX = x * tileSize + cameraX;
        const screenY = y * tileSize + cameraY;
        ctx.drawImage(grassTile, screenX, screenY, tileSize, tileSize);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Render textured path between two nodes
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x1 - Start X
   * @param {number} y1 - Start Y
   * @param {number} x2 - End X
   * @param {number} y2 - End Y
   * @param {string} pathType - Path type (road, trail, bridge, tunnel)
   * @param {Object} controlPoint - Bezier control point
   */
  renderTexturedPath(ctx, x1, y1, x2, y2, pathType, controlPoint) {
    const textureMap = {
      road: 'stone_path',
      trail: 'dirt_road',
      bridge: 'bridge_planks',
      tunnel: 'stone_path'
    };

    const textureName = textureMap[pathType] || 'dirt_road';
    const texture = this.pathTextures[textureName];

    if (!texture || !this.pathsLoaded) {
      // Fallback to simple line rendering
      this.renderSimplePath(ctx, x1, y1, x2, y2, pathType, controlPoint);
      return;
    }

    // Draw textured path along the curve
    ctx.save();

    // Create path
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, x2, y2);

    // Calculate path length for texture repetition
    const pathLength = this.estimateBezierLength(x1, y1, controlPoint.x, controlPoint.y, x2, y2);
    const segments = Math.max(1, Math.ceil(pathLength / 32));

    // Draw texture stamps along path
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = this.getQuadraticBezierPoint(x1, y1, controlPoint.x, controlPoint.y, x2, y2, t);

      // Calculate angle at this point for rotation
      const angle = this.getQuadraticBezierAngle(x1, y1, controlPoint.x, controlPoint.y, x2, y2, t);

      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.7;
      ctx.drawImage(texture, -16, -8, 32, 16);
      ctx.restore();
    }

    ctx.restore();

    // Draw path outline for better visibility
    this.renderSimplePath(ctx, x1, y1, x2, y2, pathType, controlPoint, true);
  }

  /**
   * Render simple path (fallback or outline)
   */
  renderSimplePath(ctx, x1, y1, x2, y2, pathType, controlPoint, outlineOnly = false) {
    const style = this.getPathStyle(pathType);

    if (!outlineOnly) {
      // Draw shadow
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, x2, y2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = style.width + 2;
      ctx.stroke();
    }

    // Draw main path
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, x2, y2);
    ctx.strokeStyle = outlineOnly ? 'rgba(0, 0, 0, 0.2)' : style.color;
    ctx.lineWidth = outlineOnly ? style.width + 1 : style.width;
    if (style.dashed) {
      ctx.setLineDash([5, 5]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Get path style
   */
  getPathStyle(pathType) {
    const styles = {
      road: { color: '#5a5a7a', width: 3 },
      trail: { color: '#3a5a3a', width: 2 },
      bridge: { color: '#8b7355', width: 4 },
      tunnel: { color: '#2a2a3a', width: 3, dashed: true }
    };
    return styles[pathType] || styles.road;
  }

  /**
   * Render node glow effect
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Node center X
   * @param {number} y - Node center Y
   * @param {number} radius - Base radius
   * @param {string} color - Glow color
   * @param {boolean} pulse - Whether to animate the glow
   */
  renderNodeGlow(ctx, x, y, radius, color, pulse = true) {
    const glowIntensity = pulse
      ? 0.4 + Math.sin(this.glowPhase) * 0.2
      : 0.5;

    const glowRadius = pulse
      ? radius + 5 + Math.sin(this.glowPhase) * 3
      : radius + 5;

    // Multiple glow layers for better effect
    const gradient = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowRadius);
    gradient.addColorStop(0, this.hexToRgba(color, glowIntensity));
    gradient.addColorStop(0.5, this.hexToRgba(color, glowIntensity * 0.5));
    gradient.addColorStop(1, this.hexToRgba(color, 0));

    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  /**
   * Render all ambient particles
   * @param {CanvasRenderingContext2D} ctx
   */
  renderParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;

      if (p.type === 'leaf') {
        // Leaf shape
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.6, this.time * 0.002 + p.phase, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'sparkle') {
        // Star sparkle
        this.drawStar(ctx, p.x, p.y, p.size, p.size * 0.5, 4);
        ctx.fill();
      } else {
        // Default circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  /**
   * Draw a star shape
   */
  drawStar(ctx, cx, cy, outerRadius, innerRadius, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }

  /**
   * Get point on quadratic bezier curve
   */
  getQuadraticBezierPoint(x1, y1, cx, cy, x2, y2, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
      y: mt * mt * y1 + 2 * mt * t * cy + t * t * y2
    };
  }

  /**
   * Get angle at point on quadratic bezier curve
   */
  getQuadraticBezierAngle(x1, y1, cx, cy, x2, y2, t) {
    const mt = 1 - t;
    const dx = 2 * mt * (cx - x1) + 2 * t * (x2 - cx);
    const dy = 2 * mt * (cy - y1) + 2 * t * (y2 - cy);
    return Math.atan2(dy, dx);
  }

  /**
   * Estimate bezier curve length
   */
  estimateBezierLength(x1, y1, cx, cy, x2, y2) {
    // Simple approximation using segments
    let length = 0;
    let prevX = x1;
    let prevY = y1;
    const segments = 10;

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const point = this.getQuadraticBezierPoint(x1, y1, cx, cy, x2, y2, t);
      length += Math.sqrt((point.x - prevX) ** 2 + (point.y - prevY) ** 2);
      prevX = point.x;
      prevY = point.y;
    }

    return length;
  }

  /**
   * Convert hex color to rgba string
   */
  hexToRgba(hex, alpha) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return `rgba(255, 255, 255, ${alpha})`;

    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Clear all particles
   */
  clearParticles() {
    this.particles = [];
  }
}
