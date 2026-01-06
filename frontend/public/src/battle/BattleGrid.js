/**
 * BattleGrid - 8x8 isometric grid rendering for tactical combat
 */
export class BattleGrid {
  constructor(canvas, width = 8, height = 8) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.tileWidth = 64;
    this.tileHeight = 32;

    // Calculate offset to center grid
    this.offsetX = canvas.width / 2;
    this.offsetY = 120; // Top padding for HUD

    // Terrain data (generated from seed)
    this.terrain = [];
  }

  /**
   * Generate terrain from a seed value
   */
  generateTerrain(seed, nodeType = 'forest') {
    const random = this.seededRandom(seed);
    this.terrain = [];

    const terrainWeights = this.getTerrainWeights(nodeType);

    for (let y = 0; y < this.height; y++) {
      const row = [];
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
      }
      this.terrain.push(row);
    }

    // Ensure spawn areas are walkable
    this.clearSpawnAreas();
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
    // Player spawn area (left side, columns 0-1)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < 2; x++) {
        if (this.terrain[y] && this.isImpassable(this.terrain[y][x])) {
          this.terrain[y][x] = 'grass';
        }
      }
    }
    // Enemy spawn area (right side, columns 6-7)
    for (let y = 0; y < this.height; y++) {
      for (let x = this.width - 2; x < this.width; x++) {
        if (this.terrain[y] && this.isImpassable(this.terrain[y][x])) {
          this.terrain[y][x] = 'grass';
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
   * Convert grid coordinates to screen position
   */
  gridToScreen(gridX, gridY) {
    const screenX = this.offsetX + (gridX - gridY) * (this.tileWidth / 2);
    const screenY = this.offsetY + (gridX + gridY) * (this.tileHeight / 2);
    return { x: screenX, y: screenY };
  }

  /**
   * Convert screen position to grid coordinates
   */
  screenToGrid(screenX, screenY) {
    const relX = screenX - this.offsetX;
    const relY = screenY - this.offsetY;

    const gridX = Math.floor((relX / (this.tileWidth / 2) + relY / (this.tileHeight / 2)) / 2);
    const gridY = Math.floor((relY / (this.tileHeight / 2) - relX / (this.tileWidth / 2)) / 2);

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
   * Render a single isometric tile
   */
  renderTile(ctx, gridX, gridY, highlight = null) {
    const { x, y } = this.gridToScreen(gridX, gridY);
    const terrain = this.getTerrain(gridX, gridY);

    // Draw isometric diamond
    ctx.beginPath();
    ctx.moveTo(x, y - this.tileHeight / 2);           // Top
    ctx.lineTo(x + this.tileWidth / 2, y);            // Right
    ctx.lineTo(x, y + this.tileHeight / 2);           // Bottom
    ctx.lineTo(x - this.tileWidth / 2, y);            // Left
    ctx.closePath();

    // Fill with terrain color
    ctx.fillStyle = this.getTerrainColor(terrain);
    ctx.fill();

    // Apply highlight overlay
    if (highlight) {
      ctx.fillStyle = highlight;
      ctx.fill();
    }

    // Draw outline
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * Render the entire grid
   */
  render(ctx, highlights = {}) {
    // Render tiles from back to front for proper depth
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const key = `${x},${y}`;
        const highlight = highlights[key] || null;
        this.renderTile(ctx, x, y, highlight);
      }
    }
  }

  /**
   * Get tile at screen position (for click detection)
   */
  getTileAtScreen(screenX, screenY) {
    const { x, y } = this.screenToGrid(screenX, screenY);
    if (this.isInBounds(x, y)) {
      return { x, y };
    }
    return null;
  }
}
