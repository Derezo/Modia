import { responsive } from '../../core/Responsive.js';

/**
 * FormationGrid - Diorama-style grid for character placement
 *
 * Renders an isometric grid with biome-specific terrain tiles,
 * placement highlighting, and character sprites.
 */
export class FormationGrid {
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.assetLoader = options.assetLoader;
    this.theme = options.theme;
    this.nodeType = options.nodeType || 'forest';

    // Grid configuration
    this.gridWidth = options.gridWidth || 5;
    this.gridHeight = options.gridHeight || 4;
    this.tileWidth = options.tileWidth || 64;
    this.tileHeight = options.tileHeight || 32;

    // State
    this.placedCharacters = new Map(); // "x,y" -> character
    this.hoveredTile = null;
    this.pressedTile = null;

    // Animation
    this.animationFrame = 0;
    this.highlightPhase = 0;

    // Pre-calculate grid bounds
    this.calculateBounds();
  }

  calculateBounds() {
    if (!this.canvas) return;

    // Calculate the bounding box of the isometric grid
    const topLeft = this.gridToScreen(0, 0);
    const topRight = this.gridToScreen(this.gridWidth - 1, 0);
    const bottomLeft = this.gridToScreen(0, this.gridHeight - 1);
    const bottomRight = this.gridToScreen(this.gridWidth - 1, this.gridHeight - 1);

    this.gridBounds = {
      minX: Math.min(topLeft.x, bottomLeft.x) - this.tileWidth / 2,
      maxX: Math.max(topRight.x, bottomRight.x) + this.tileWidth / 2,
      minY: topLeft.y - this.tileHeight / 2,
      maxY: Math.max(bottomLeft.y, bottomRight.y) + this.tileHeight / 2
    };
  }

  setCanvas(canvas) {
    this.canvas = canvas;
    this.calculateBounds();
  }

  setTheme(theme) {
    this.theme = theme;
  }

  setNodeType(nodeType) {
    this.nodeType = nodeType;
  }

  // Coordinate conversion
  gridToScreen(gridX, gridY) {
    if (!this.canvas) return { x: 0, y: 0 };

    const centerX = this.canvas.width / 2;
    const startY = 40; // Offset from top

    const screenX = centerX + (gridX - gridY) * (this.tileWidth / 2);
    const screenY = startY + (gridX + gridY) * (this.tileHeight / 2);

    return { x: screenX, y: screenY };
  }

  screenToGrid(screenX, screenY) {
    if (!this.canvas) return null;

    const centerX = this.canvas.width / 2;
    const startY = 40;

    const worldX = screenX - centerX;
    const worldY = screenY - startY;

    // gridToScreen() places the origin at the *centre* of tile 0,0. Using
    // floor here incorrectly assigns the top and left halves of that tile to
    // negative cells. Invert the 2:1 projection, then select the nearest
    // diamond with an exact hit test so edge pixels remain deterministic.
    const projectedX = worldX / this.tileWidth + worldY / this.tileHeight;
    const projectedY = worldY / this.tileHeight - worldX / this.tileWidth;
    const originX = Math.round(projectedX);
    const originY = Math.round(projectedY);
    let best = null;

    for (let y = originY - 1; y <= originY + 1; y++) {
      for (let x = originX - 1; x <= originX + 1; x++) {
        if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) continue;

        const center = this.gridToScreen(x, y);
        const diamondDistance =
          Math.abs(screenX - center.x) / (this.tileWidth / 2) +
          Math.abs(screenY - center.y) / (this.tileHeight / 2);

        if (diamondDistance <= 1 + 1e-7 &&
            (!best || diamondDistance < best.distance)) {
          best = { x, y, distance: diamondDistance };
        }
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  /**
   * Return cells in a stable back-to-front order for the 2:1 projection.
   * Explicit tie-breakers make the draw order independent of loop shape and
   * JavaScript engine sort stability.
   */
  getCellsInRenderOrder() {
    const cells = [];
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        cells.push({ x, y, depth: x + y });
      }
    }
    return cells.sort((a, b) =>
      a.depth - b.depth ||
      a.y - b.y ||
      a.x - b.x
    );
  }

  // State management
  setPlacedCharacters(characters) {
    this.placedCharacters = characters;
  }

  setHoveredTile(tile) {
    this.hoveredTile = tile;
  }

  setPressedTile(key) {
    this.pressedTile = key;
  }

  setGridLocked(locked) {
    this.isLocked = locked;
  }

  // Animation update
  update(deltaTime) {
    this.animationFrame += deltaTime;
    // 2-second highlight pulse cycle
    this.highlightPhase = (this.animationFrame % 2000) / 2000;
  }

  // Rendering
  render() {
    if (!this.canvas) return;

    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render platform shadow (diorama effect)
    this.renderPlatformShadow(ctx);

    // Render platform edge (3D effect)
    this.renderPlatformEdge(ctx);

    const renderOrder = this.getCellsInRenderOrder();

    // Terrain and characters share the painter order, matching the battle
    // renderer. A foreground tile can therefore cover the feet of a unit in
    // the row behind instead of every character floating above the platform.
    for (const cell of renderOrder) {
      this.renderTile(ctx, cell.x, cell.y);
      const key = `${cell.x},${cell.y}`;
      if (this.placedCharacters.has(key)) {
        this.renderCharacter(ctx, cell.x, cell.y, this.placedCharacters.get(key));
      }
    }

    // Render front edge indicator (enemy direction)
    this.renderFrontEdgeIndicator(ctx);

    // Render particles if theme has them
    if (this.theme) {
      this.theme.renderParticles(ctx);
    }
  }

  renderPlatformShadow(ctx) {
    const centerX = this.canvas.width / 2;
    const bottomY = this.gridToScreen(this.gridWidth - 1, this.gridHeight - 1).y + 30;

    ctx.save();

    // Elliptical shadow beneath platform
    const gradient = ctx.createRadialGradient(
      centerX, bottomY, 0,
      centerX, bottomY, 150
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(centerX, bottomY, 150, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  renderPlatformEdge(ctx) {
    // Create a 3D raised platform effect
    const edgeHeight = 12;
    const darkColor = 'rgba(30, 25, 20, 0.8)';
    const midColor = 'rgba(50, 45, 40, 0.6)';

    ctx.save();

    // Get the four corners of the grid
    const corners = [
      this.gridToScreen(0, 0),
      this.gridToScreen(this.gridWidth - 1, 0),
      this.gridToScreen(this.gridWidth - 1, this.gridHeight - 1),
      this.gridToScreen(0, this.gridHeight - 1)
    ];

    // Right edge (SE face)
    ctx.beginPath();
    ctx.moveTo(corners[1].x + this.tileWidth / 2, corners[1].y);
    ctx.lineTo(corners[2].x + this.tileWidth / 2, corners[2].y);
    ctx.lineTo(corners[2].x + this.tileWidth / 2, corners[2].y + edgeHeight);
    ctx.lineTo(corners[1].x + this.tileWidth / 2, corners[1].y + edgeHeight);
    ctx.closePath();
    ctx.fillStyle = darkColor;
    ctx.fill();

    // Bottom edge (SW face)
    ctx.beginPath();
    ctx.moveTo(corners[2].x + this.tileWidth / 2, corners[2].y);
    ctx.lineTo(corners[3].x - this.tileWidth / 2, corners[3].y);
    ctx.lineTo(corners[3].x - this.tileWidth / 2, corners[3].y + edgeHeight);
    ctx.lineTo(corners[2].x + this.tileWidth / 2, corners[2].y + edgeHeight);
    ctx.closePath();
    ctx.fillStyle = midColor;
    ctx.fill();

    ctx.restore();
  }

  renderFrontEdgeIndicator(ctx) {
    // Draw a glowing red border on the front (right) edge to indicate enemy direction
    ctx.save();

    // Get corner positions for the front edge (rightmost column at x = gridWidth - 1)
    const topCorner = this.gridToScreen(this.gridWidth - 1, 0);
    const bottomCorner = this.gridToScreen(this.gridWidth - 1, this.gridHeight - 1);

    const hw = this.tileWidth / 2;

    // Pulsing glow effect
    const pulseOpacity = 0.4 + Math.sin(this.highlightPhase * Math.PI * 2) * 0.2;
    const glowColor = `rgba(255, 80, 80, ${pulseOpacity})`;
    const borderColor = `rgba(255, 60, 60, ${pulseOpacity + 0.3})`;

    // Draw glow shadow
    ctx.shadowColor = 'rgba(255, 50, 50, 0.8)';
    ctx.shadowBlur = 15;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    // Draw the front edge line (from top-right corner to bottom-right corner of grid)
    ctx.beginPath();
    ctx.moveTo(topCorner.x + hw, topCorner.y);
    ctx.lineTo(bottomCorner.x + hw, bottomCorner.y);
    ctx.stroke();

    // Reset shadow for label
    ctx.shadowBlur = 0;

    // Draw "ENEMY" label
    const labelX = bottomCorner.x + hw + 20;
    const labelY = (topCorner.y + bottomCorner.y) / 2;

    ctx.fillStyle = glowColor;
    ctx.font = `bold ${responsive.getCanvasFontSize('sm')}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Arrow pointing right
    ctx.fillText('→ ENEMY', labelX, labelY);

    ctx.restore();
  }

  renderTile(ctx, gridX, gridY) {
    const { x, y } = this.gridToScreen(gridX, gridY);
    const key = `${gridX},${gridY}`;
    const isOccupied = this.placedCharacters.has(key);
    const isHovered = this.hoveredTile?.x === gridX && this.hoveredTile?.y === gridY;
    const isPressed = this.pressedTile === key;

    ctx.save();

    // Draw tile base
    this.drawIsometricDiamond(ctx, x, y, isOccupied, isHovered, isPressed);

    // Draw placement highlight for empty tiles
    if (!isOccupied && !isPressed) {
      this.drawPlacementHighlight(ctx, x, y, isHovered);
    }

    ctx.restore();
  }

  drawIsometricDiamond(ctx, x, y, isOccupied, isHovered, isPressed) {
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;

    // Try to get terrain sprite from asset loader
    const terrainSprite = this.getTerrainSprite(this.nodeType);

    if (terrainSprite) {
      // Terrain art uses a square source canvas (64px legacy or 128px retina)
      // with a 2:1 diamond centred inside it. Always render to a 64x64 logical
      // box so retina sources retain detail without being squashed to 64x48.
      const logicalSpriteSize = this.tileWidth;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        terrainSprite,
        x - logicalSpriteSize / 2,
        y - logicalSpriteSize / 2,
        logicalSpriteSize,
        logicalSpriteSize
      );
    } else {
      // Fallback: colored diamond
      ctx.beginPath();
      ctx.moveTo(x, y - hh);       // Top
      ctx.lineTo(x + hw, y);       // Right
      ctx.lineTo(x, y + hh);       // Bottom
      ctx.lineTo(x - hw, y);       // Left
      ctx.closePath();

      // Get colors from theme
      const fillColor = this.theme
        ? this.theme.getTileColor(isOccupied, isHovered, isPressed)
        : this.getDefaultTileColor(isOccupied, isHovered, isPressed);

      ctx.fillStyle = fillColor;
      ctx.fill();

      // Border
      const borderColor = this.theme
        ? this.theme.getTileBorderColor(isOccupied, isHovered)
        : this.getDefaultBorderColor(isOccupied, isHovered);

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Overlay for states
    if (isOccupied || isPressed) {
      ctx.beginPath();
      ctx.moveTo(x, y - hh);
      ctx.lineTo(x + hw, y);
      ctx.lineTo(x, y + hh);
      ctx.lineTo(x - hw, y);
      ctx.closePath();

      if (isPressed) {
        ctx.fillStyle = 'rgba(139, 0, 0, 0.4)';
      } else if (isOccupied) {
        ctx.fillStyle = 'rgba(76, 175, 80, 0.2)';
      }
      ctx.fill();
    }
  }

  drawPlacementHighlight(ctx, x, y, isHovered) {
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;

    // Pulsing highlight for empty placement slots
    const pulseOpacity = 0.3 + Math.sin(this.highlightPhase * Math.PI * 2) * 0.15;
    const highlightColor = isHovered
      ? `rgba(255, 215, 0, ${pulseOpacity + 0.2})`
      : `rgba(255, 215, 0, ${pulseOpacity})`;

    // Draw highlight border
    ctx.beginPath();
    ctx.moveTo(x, y - hh + 2);
    ctx.lineTo(x + hw - 2, y);
    ctx.lineTo(x, y + hh - 2);
    ctx.lineTo(x - hw + 2, y);
    ctx.closePath();

    ctx.strokeStyle = highlightColor;
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.stroke();

    // Inner glow for hovered
    if (isHovered) {
      ctx.fillStyle = 'rgba(255, 215, 0, 0.1)';
      ctx.fill();
    }
  }

  getTerrainSprite(nodeType) {
    if (!this.assetLoader) return null;

    // Try to get a grass/base tile for the biome
    const terrainTypes = {
      forest: 'grass',
      cave: 'stone',
      mountain: 'stone',
      bridge: 'stone',
      castle: 'stone',
      arena: 'stone',
      ruins: 'stone'
    };

    const terrain = terrainTypes[nodeType] || 'grass';
    return this.assetLoader.getTile?.(terrain, nodeType, 0) || null;
  }

  getDefaultTileColor(isOccupied, isHovered, isPressed) {
    if (isPressed) return '#8b0000';
    if (isOccupied) return '#2a4a2a';
    if (isHovered) return '#3a4a5a';
    return '#252535';
  }

  getDefaultBorderColor(isOccupied, isHovered) {
    if (isOccupied) return '#4caf50';
    if (isHovered) return '#6ab0f3';
    return '#3a3a5a';
  }

  renderCharacter(ctx, gridX, gridY, char) {
    const { x, y } = this.gridToScreen(gridX, gridY);
    const isSelected = this.hoveredTile?.x === gridX && this.hoveredTile?.y === gridY;

    ctx.save();

    // Try to get character sprite
    const sprite = this.getCharacterSprite(char);

    if (sprite) {
      const spriteSize = 48;
      // Sprite sheets are 64x512 (8 temporal frames stacked vertically).
      const frameWidth = sprite.width;        // 64
      const frameHeight = sprite.height / 8;  // 64

      // Warn on unexpected sprite dimensions (helps catch asset issues)
      if (sprite.width !== 64 || sprite.height !== 512) {
        console.warn(`[FormationGrid] Unexpected sprite dimensions for ${char.class}: ${sprite.width}x${sprite.height}, expected 64x512`);
      }

      // Formation is a static preview, so render the first idle frame. Facing
      // for vertical strips is handled by mirroring at animated runtime.
      const sourceY = 0;

      ctx.drawImage(
        sprite,
        0, sourceY, frameWidth, frameHeight,  // Source: first frame of East direction
        x - spriteSize / 2,
        y - spriteSize - 8,                   // Offset up to stand on tile
        spriteSize,
        spriteSize
      );
    } else {
      // Fallback: colored circle with icon
      this.renderCharacterFallback(ctx, x, y, char, isSelected);
    }

    // Character name below
    ctx.fillStyle = '#fff';
    ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(char.name.substring(0, 8), x, y + 8);

    // Selection indicator
    if (isSelected) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y - 16, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  renderCharacterFallback(ctx, x, y, char, isSelected) {
    const color = this.getClassColor(char.class);
    const icon = this.getClassIcon(char.class);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Circle background
    ctx.beginPath();
    ctx.arc(x, y - 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Border
    ctx.strokeStyle = isSelected ? '#ffd700' : '#fff';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();

    // Icon
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x, y - 16);
  }

  getCharacterSprite(char) {
    if (!this.assetLoader) return null;

    // Try to get idle sprite
    return this.assetLoader.getCharacterSprite?.(char, 'idle') || null;
  }

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

  // Utility methods for external use
  getTileAtPoint(screenX, screenY) {
    return this.screenToGrid(screenX, screenY);
  }

  getGridDimensions() {
    return {
      width: this.gridWidth,
      height: this.gridHeight
    };
  }
}
