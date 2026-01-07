/**
 * BattleGrid - Isometric grid rendering for tactical combat (supports 32x32 with camera)
 */
export class BattleGrid {
  constructor(canvas, width = 32, height = 32) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.tileWidth = 64;   // Visual diamond width (for grid spacing)
    this.tileHeight = 32;  // Visual diamond height (for grid spacing)
    this.spriteSize = 64;  // Sprite canvas size (64×64 with diamond inscribed)

    // World-space origin offset (for centering the isometric diamond)
    this.offsetX = 0;
    this.offsetY = 0;

    // Terrain data (generated from seed)
    this.terrain = [];

    // Obstacle layer data
    this.obstacles = [];

    // Asset loader reference (set externally)
    this.assetLoader = null;

    // Current node type for biome-specific sprites
    this.nodeType = 'forest';

    // Tile variant mapping for visual variety (seeded per-tile)
    this.tileVariants = [];
  }

  /**
   * Set the asset loader for sprite rendering
   */
  setAssetLoader(assetLoader) {
    this.assetLoader = assetLoader;
  }

  /**
   * Generate terrain from a seed value
   */
  generateTerrain(seed, nodeType = 'forest') {
    const random = this.seededRandom(seed);
    this.terrain = [];
    this.tileVariants = [];
    this.obstacles = [];
    this.nodeType = nodeType;

    const terrainWeights = this.getTerrainWeights(nodeType);

    for (let y = 0; y < this.height; y++) {
      const row = [];
      const variantRow = [];
      const obstacleRow = [];

      for (let x = 0; x < this.width; x++) {
        const roll = random();
        let cumulative = 0;
        let selectedTerrain = 'grass';

        for (const [terrain, weight] of Object.entries(terrainWeights)) {
          cumulative += weight;
          if (roll < cumulative) {
            selectedTerrain = terrain;
            break;
          }
        }
        row.push(selectedTerrain);

        // Generate tile variant (0-3 for visual variety)
        variantRow.push(Math.floor(random() * 4));

        // Generate obstacles for impassable terrain
        obstacleRow.push(this.generateObstacleForTerrain(selectedTerrain, nodeType, random));
      }
      this.terrain.push(row);
      this.tileVariants.push(variantRow);
      this.obstacles.push(obstacleRow);
    }

    // Ensure spawn areas are walkable
    this.clearSpawnAreas();
  }

  /**
   * Generate obstacle type for terrain
   */
  generateObstacleForTerrain(terrain, nodeType, random) {
    if (!this.isImpassable(terrain)) {
      // In forest biome, add trees on grass tiles for a more forested look
      if (nodeType === 'forest' && terrain === 'grass') {
        // 15% chance for a tree on grass
        if (random() < 0.15) {
          const treeOptions = ['oak_tree', 'pine_tree'];
          return { type: 'trees', variant: treeOptions[Math.floor(random() * treeOptions.length)] };
        }
        // 5% chance for other decoratives
        if (random() < 0.05) {
          return { type: 'decorative', variant: this.getRandomDecorativeObstacle(nodeType, random) };
        }
      } else {
        // Other biomes: small chance for decorative obstacles on walkable terrain
        if (random() < 0.05) {
          return { type: 'decorative', variant: this.getRandomDecorativeObstacle(nodeType, random) };
        }
      }
      return null;
    }

    const obstacleMap = {
      rock: { category: 'rocks', options: ['rock_small', 'rock_medium', 'rock_large'] },
      tree: { category: 'trees', options: ['oak_tree', 'pine_tree', 'dead_tree'] },
      forest: { category: 'trees', options: ['oak_tree', 'pine_tree'] },
      cliff: { category: 'rocks', options: ['rock_large', 'mountain_boulder'] },
      lava: null, // No obstacle, just lava tile
      water: null  // No obstacle, just water tile
    };

    const config = obstacleMap[terrain];
    if (!config) return null;

    const variant = config.options[Math.floor(random() * config.options.length)];
    return { type: config.category, variant };
  }

  /**
   * Get random decorative obstacle for biome
   */
  getRandomDecorativeObstacle(nodeType, random) {
    const decoratives = {
      forest: ['grass_tufts', 'wildflowers', 'fallen_log'],
      cave: ['cave_crystals', 'stalagmite'],
      mountain: ['grass_tufts', 'stone_ruins'],
      bridge: ['grass_tufts'],
      castle: ['stone_ruins']
    };

    const options = decoratives[nodeType] || decoratives.forest;
    return options[Math.floor(random() * options.length)];
  }

  /**
   * Get terrain distribution weights by node type
   */
  getTerrainWeights(nodeType) {
    const weights = {
      forest: { grass: 0.6, forest: 0.25, stone: 0.1, rock: 0.05 },
      cave: { stone: 0.5, rock: 0.2, water: 0.15, lava: 0.05, grass: 0.1 },
      mountain: { stone: 0.4, rock: 0.3, grass: 0.2, cliff: 0.1 },
      bridge: { stone: 0.6, water: 0.3, grass: 0.1 },
      castle: { stone: 0.7, grass: 0.3 },
      default: { grass: 0.7, stone: 0.2, forest: 0.1 }
    };
    return weights[nodeType] || weights.default;
  }

  /**
   * Clear spawn areas for players (left) and enemies (right)
   */
  clearSpawnAreas() {
    // Player spawn area (left side, columns 0-4)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < 5; x++) {
        if (this.terrain[y] && this.isImpassable(this.terrain[y][x])) {
          this.terrain[y][x] = 'grass';
        }
        // Clear obstacles in spawn areas
        if (this.obstacles[y]) {
          this.obstacles[y][x] = null;
        }
      }
    }
    // Enemy spawn area (right side, last 5 columns)
    for (let y = 0; y < this.height; y++) {
      for (let x = this.width - 5; x < this.width; x++) {
        if (this.terrain[y] && this.isImpassable(this.terrain[y][x])) {
          this.terrain[y][x] = 'grass';
        }
        // Clear obstacles in spawn areas
        if (this.obstacles[y]) {
          this.obstacles[y][x] = null;
        }
      }
    }
  }

  /**
   * Seeded random number generator (Mulberry32)
   */
  seededRandom(seed) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Convert grid coordinates to world position (before camera transform)
   */
  gridToScreenWorld(gridX, gridY) {
    const worldX = (gridX - gridY) * (this.tileWidth / 2);
    const worldY = (gridX + gridY) * (this.tileHeight / 2);
    return { x: worldX, y: worldY };
  }

  /**
   * Convert grid coordinates to screen position
   * If camera is provided, applies camera transform
   */
  gridToScreen(gridX, gridY, camera = null) {
    const world = this.gridToScreenWorld(gridX, gridY);
    if (camera) {
      return camera.worldToScreen(world.x, world.y);
    }
    // Fallback for non-camera usage (legacy)
    return {
      x: world.x + this.canvas.width / 2,
      y: world.y + 120
    };
  }

  /**
   * Convert screen position to grid coordinates
   * If camera is provided, applies camera transform
   */
  screenToGrid(screenX, screenY, camera = null) {
    let worldX, worldY;
    if (camera) {
      const world = camera.screenToWorld(screenX, screenY);
      worldX = world.x;
      worldY = world.y;
    } else {
      // Fallback for non-camera usage (legacy)
      worldX = screenX - this.canvas.width / 2;
      worldY = screenY - 120;
    }

    const gridX = Math.floor((worldX / (this.tileWidth / 2) + worldY / (this.tileHeight / 2)) / 2);
    const gridY = Math.floor((worldY / (this.tileHeight / 2) - worldX / (this.tileWidth / 2)) / 2);

    return { x: gridX, y: gridY };
  }

  /**
   * Check if coordinates are within grid bounds
   */
  isInBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Get terrain at position
   */
  getTerrain(x, y) {
    if (!this.isInBounds(x, y)) return null;
    return this.terrain[y]?.[x] || 'grass';
  }

  /**
   * Check if terrain is impassable
   */
  isImpassable(terrain) {
    return ['rock', 'tree', 'lava', 'cliff', 'water'].includes(terrain);
  }

  /**
   * Check if a tile is walkable
   */
  isWalkable(x, y) {
    if (!this.isInBounds(x, y)) return false;
    const terrain = this.getTerrain(x, y);
    return !this.isImpassable(terrain);
  }

  /**
   * Get terrain movement cost
   */
  getMovementCost(x, y) {
    const terrain = this.getTerrain(x, y);
    const costs = {
      grass: 1,
      stone: 1,
      forest: 2,
      water: 3
    };
    return costs[terrain] || 1;
  }

  /**
   * Get terrain color for rendering
   */
  getTerrainColor(terrain) {
    const colors = {
      grass: '#3d5c3d',
      stone: '#5a5a5a',
      forest: '#2d4a2d',
      water: '#3d5c7a',
      rock: '#4a4a4a',
      lava: '#7a3d3d',
      cliff: '#3a3a3a'
    };
    return colors[terrain] || '#3d5c3d';
  }

  /**
   * Calculate the pixel dimensions of the entire map in world space
   */
  getMapPixelDimensions() {
    // For isometric grid, calculate bounding box
    // The isometric diamond has corners at:
    // - Top (north): grid (0, height-1) - negative X, mid Y
    // - Right (east): grid (width-1, 0) - positive X, mid Y
    // - Bottom (south): grid (width-1, height-1) - center X, max Y
    // - Left (west): grid (0, 0) - center X, min Y

    const north = this.gridToScreenWorld(0, this.height - 1);
    const east = this.gridToScreenWorld(this.width - 1, 0);
    const south = this.gridToScreenWorld(this.width - 1, this.height - 1);
    const west = this.gridToScreenWorld(0, 0);

    // Correctly calculate bounds considering all corners
    const minX = Math.min(north.x, west.x) - this.tileWidth / 2;
    const maxX = Math.max(east.x, south.x) + this.tileWidth / 2;
    const minY = Math.min(west.y, north.y, east.y) - this.tileHeight / 2;
    const maxY = Math.max(south.y, north.y, east.y) + this.tileHeight / 2;

    return {
      width: maxX - minX,
      height: maxY - minY,
      // World-space bounds
      worldMinX: minX,
      worldMinY: minY,
      worldMaxX: maxX,
      worldMaxY: maxY,
      // Legacy offset (for non-camera rendering)
      offsetX: -minX,
      offsetY: -minY
    };
  }

  /**
   * Get the center of the map in world coordinates
   */
  getMapCenter() {
    const centerX = Math.floor(this.width / 2);
    const centerY = Math.floor(this.height / 2);
    return this.gridToScreenWorld(centerX, centerY);
  }

  /**
   * Render a single isometric tile at screen position
   */
  renderTileAt(ctx, screenX, screenY, terrain, highlight = null, gridX = 0, gridY = 0) {
    // Try to render sprite if asset loader is available
    const sprite = this.assetLoader?.getTile(terrain, this.nodeType, this.getTileVariant(gridX, gridY));

    if (sprite) {
      // Draw 64×64 sprite centered on tile position
      // Diamond center is at canvas center, so offset by half sprite size
      ctx.drawImage(
        sprite,
        screenX - this.spriteSize / 2,
        screenY - this.spriteSize / 2,
        this.spriteSize,
        this.spriteSize
      );
    } else {
      // Fallback: Draw isometric diamond with color
      ctx.beginPath();
      ctx.moveTo(screenX, screenY - this.tileHeight / 2);           // Top
      ctx.lineTo(screenX + this.tileWidth / 2, screenY);            // Right
      ctx.lineTo(screenX, screenY + this.tileHeight / 2);           // Bottom
      ctx.lineTo(screenX - this.tileWidth / 2, screenY);            // Left
      ctx.closePath();

      // Fill with terrain color
      ctx.fillStyle = this.getTerrainColor(terrain);
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = '#2a2a4a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Apply highlight overlay (always on top)
    if (highlight) {
      ctx.beginPath();
      ctx.moveTo(screenX, screenY - this.tileHeight / 2);
      ctx.lineTo(screenX + this.tileWidth / 2, screenY);
      ctx.lineTo(screenX, screenY + this.tileHeight / 2);
      ctx.lineTo(screenX - this.tileWidth / 2, screenY);
      ctx.closePath();
      ctx.fillStyle = highlight;
      ctx.fill();
    }
  }

  /**
   * Get tile variant for visual variety
   */
  getTileVariant(gridX, gridY) {
    return this.tileVariants[gridY]?.[gridX] || 0;
  }

  /**
   * Render obstacle at screen position
   */
  renderObstacleAt(ctx, screenX, screenY, obstacle) {
    if (!obstacle) return;

    const sprite = this.assetLoader?.getObstacle(obstacle.variant, obstacle.type);

    if (sprite) {
      // Obstacles are drawn above the tile, offset upward
      const obstacleHeight = sprite.height || 64;
      ctx.drawImage(
        sprite,
        screenX - sprite.width / 2,
        screenY - obstacleHeight + this.tileHeight / 2,
        sprite.width,
        sprite.height
      );
    } else if (obstacle.type !== 'decorative') {
      // Fallback: Draw a simple shape for impassable obstacles
      ctx.fillStyle = obstacle.type === 'trees' ? '#2d4a2d' : '#4a4a4a';
      ctx.beginPath();
      if (obstacle.type === 'trees') {
        // Triangle for trees
        ctx.moveTo(screenX, screenY - 40);
        ctx.lineTo(screenX + 16, screenY);
        ctx.lineTo(screenX - 16, screenY);
      } else {
        // Rectangle for rocks
        ctx.rect(screenX - 12, screenY - 20, 24, 20);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * Render a single isometric tile (legacy method without camera)
   */
  renderTile(ctx, gridX, gridY, highlight = null) {
    const { x, y } = this.gridToScreen(gridX, gridY);
    const terrain = this.getTerrain(gridX, gridY);
    this.renderTileAt(ctx, x, y, terrain, highlight, gridX, gridY);
  }

  /**
   * Get obstacle at position
   */
  getObstacle(x, y) {
    if (!this.isInBounds(x, y)) return null;
    return this.obstacles[y]?.[x] || null;
  }

  /**
   * Render the entire grid with optional camera
   */
  render(ctx, highlights = {}, camera = null) {
    // If no camera, use simple full render
    if (!camera) {
      // First pass: render terrain
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const key = `${x},${y}`;
          const highlight = highlights[key] || null;
          this.renderTile(ctx, x, y, highlight);
        }
      }
      // Second pass: render obstacles (back to front for proper layering)
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const { x: screenX, y: screenY } = this.gridToScreen(x, y);
          const obstacle = this.getObstacle(x, y);
          this.renderObstacleAt(ctx, screenX, screenY, obstacle);
        }
      }
      return;
    }

    // With camera, render only visible tiles (with culling)
    // First pass: terrain tiles
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const screenPos = this.gridToScreen(x, y, camera);

        // Cull tiles that are off-screen
        if (screenPos.x < -this.tileWidth || screenPos.x > this.canvas.width + this.tileWidth ||
            screenPos.y < -this.tileHeight || screenPos.y > this.canvas.height + this.tileHeight) {
          continue;
        }

        const terrain = this.getTerrain(x, y);
        const key = `${x},${y}`;
        const highlight = highlights[key] || null;
        this.renderTileAt(ctx, screenPos.x, screenPos.y, terrain, highlight, x, y);
      }
    }

    // Second pass: obstacles (rendered after terrain for proper layering)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const screenPos = this.gridToScreen(x, y, camera);

        // Cull obstacles that are off-screen (with larger margin for tall obstacles)
        if (screenPos.x < -this.tileWidth * 2 || screenPos.x > this.canvas.width + this.tileWidth * 2 ||
            screenPos.y < -100 || screenPos.y > this.canvas.height + this.tileHeight) {
          continue;
        }

        const obstacle = this.getObstacle(x, y);
        this.renderObstacleAt(ctx, screenPos.x, screenPos.y, obstacle);
      }
    }
  }

  /**
   * Get tile at screen position (for click detection)
   */
  getTileAtScreen(screenX, screenY, camera = null) {
    const { x, y } = this.screenToGrid(screenX, screenY, camera);
    if (this.isInBounds(x, y)) {
      return { x, y };
    }
    return null;
  }
}
