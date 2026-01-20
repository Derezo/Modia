/**
 * RoomCarver - Rectangular and oval room/clearing generation
 *
 * Carves distinct chambers and clearings into terrain for battle maps.
 * Supports multiple room shapes: rectangular, oval, and irregular (organic).
 *
 * Room shapes:
 * - rectangle: Clean rectangular rooms with sharp corners
 * - oval: Elliptical rooms for natural cave chambers
 * - irregular: Rectangle base with random edge variations for organic feel
 *
 * CRITICAL: All methods must use the random function deterministically
 * to maintain server/client sync.
 */

/**
 * Room shape configuration presets
 */
export const ROOM_PRESETS = {
  dungeon: {
    minRoomSize: 5,
    maxRoomSize: 12,
    roomCount: 4,
    roomShape: 'rectangle',
    padding: 2
  },
  cave: {
    minRoomSize: 6,
    maxRoomSize: 14,
    roomCount: 3,
    roomShape: 'oval',
    padding: 3
  },
  ruins: {
    minRoomSize: 4,
    maxRoomSize: 10,
    roomCount: 5,
    roomShape: 'irregular',
    padding: 2
  },
  arena: {
    minRoomSize: 10,
    maxRoomSize: 16,
    roomCount: 1,
    roomShape: 'oval',
    padding: 4
  }
};

/**
 * Room Carver Algorithm for generating distinct chambers
 */
export class RoomCarverAlgorithm {
  /**
   * @param {Object} options - Algorithm options
   * @param {number} options.minRoomSize - Minimum room dimension (default 4)
   * @param {number} options.maxRoomSize - Maximum room dimension (default 10)
   * @param {number} options.roomCount - Number of rooms to attempt (default 3)
   * @param {string} options.roomShape - Shape type: 'rectangle', 'oval', 'irregular'
   * @param {string} options.floorTerrain - Terrain type for cleared areas (default 'grass')
   * @param {number} options.padding - Minimum distance between rooms (default 2)
   * @param {string} options.preset - Named preset to use (overrides other options)
   */
  constructor(options = {}) {
    const preset = options.preset ? ROOM_PRESETS[options.preset] : null;

    this.minRoomSize = options.minRoomSize ?? preset?.minRoomSize ?? 4;
    this.maxRoomSize = options.maxRoomSize ?? preset?.maxRoomSize ?? 10;
    this.roomCount = options.roomCount ?? preset?.roomCount ?? 3;
    this.roomShape = options.roomShape ?? preset?.roomShape ?? 'rectangle';
    this.floorTerrain = options.floorTerrain ?? 'grass';
    this.padding = options.padding ?? preset?.padding ?? 2;
  }

  /**
   * Apply room carving to terrain
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function
   * @param {Object} options - Runtime options
   * @param {number} options.intensity - Effect intensity (0-1), controls room count scaling
   * @param {Object} options.bounds - Optional bounded region {x, y, width, height}
   */
  apply(terrain, random, options = {}) {
    const intensity = options.intensity ?? 1.0;
    const bounds = options.bounds || {
      x: 0,
      y: 0,
      width: terrain[0].length,
      height: terrain.length
    };

    // Scale room count by intensity
    const targetRoomCount = Math.max(1, Math.round(this.roomCount * intensity));
    const placedRooms = [];
    let attempts = 0;
    const maxAttempts = targetRoomCount * 20; // Limit placement attempts

    // Attempt to place rooms
    while (placedRooms.length < targetRoomCount && attempts < maxAttempts) {
      attempts++;

      const room = this._generateRoom(random, bounds);

      if (this._canPlaceRoom(room, placedRooms, bounds)) {
        placedRooms.push(room);
        this._carveRoom(terrain, room, random);
      }
    }

    return placedRooms;
  }

  /**
   * Generate a room definition with random position and size
   * @param {function} random - Seeded random function
   * @param {Object} bounds - Region bounds {x, y, width, height}
   * @returns {Object} Room definition {x, y, width, height, shape}
   */
  _generateRoom(random, bounds) {
    // Generate room dimensions
    const width = this._randomInRange(random, this.minRoomSize, this.maxRoomSize);
    const height = this._randomInRange(random, this.minRoomSize, this.maxRoomSize);

    // Calculate valid placement range (accounting for padding from edges)
    const minX = bounds.x + this.padding;
    const minY = bounds.y + this.padding;
    const maxX = bounds.x + bounds.width - width - this.padding;
    const maxY = bounds.y + bounds.height - height - this.padding;

    // Generate position (handle edge case where max < min)
    const x = maxX > minX ? this._randomInRange(random, minX, maxX) : minX;
    const y = maxY > minY ? this._randomInRange(random, minY, maxY) : minY;

    return {
      x,
      y,
      width,
      height,
      shape: this.roomShape
    };
  }

  /**
   * Check if a room can be placed without overlapping existing rooms
   * @param {Object} room - Room to place {x, y, width, height}
   * @param {Object[]} placedRooms - Array of already placed rooms
   * @param {Object} bounds - Region bounds {x, y, width, height}
   * @returns {boolean} True if room can be placed
   */
  _canPlaceRoom(room, placedRooms, bounds) {
    // Check if room fits within bounds (with padding from edges)
    if (room.x < bounds.x + this.padding ||
        room.y < bounds.y + this.padding ||
        room.x + room.width > bounds.x + bounds.width - this.padding ||
        room.y + room.height > bounds.y + bounds.height - this.padding) {
      return false;
    }

    // Check overlap with existing rooms (including padding)
    for (const placed of placedRooms) {
      // Expand both rooms by padding for collision check
      const r1 = {
        left: room.x - this.padding,
        right: room.x + room.width + this.padding,
        top: room.y - this.padding,
        bottom: room.y + room.height + this.padding
      };

      const r2 = {
        left: placed.x,
        right: placed.x + placed.width,
        top: placed.y,
        bottom: placed.y + placed.height
      };

      // AABB collision check
      if (r1.left < r2.right &&
          r1.right > r2.left &&
          r1.top < r2.bottom &&
          r1.bottom > r2.top) {
        return false;
      }
    }

    return true;
  }

  /**
   * Carve a room into the terrain grid
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {Object} room - Room definition {x, y, width, height, shape}
   * @param {function} random - Seeded random function
   */
  _carveRoom(terrain, room, random) {
    switch (room.shape) {
      case 'oval':
        this._carveOval(terrain, room);
        break;
      case 'irregular':
        this._carveIrregular(terrain, room, random);
        break;
      case 'rectangle':
      default:
        this._carveRectangle(terrain, room);
        break;
    }
  }

  /**
   * Carve a rectangular room
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {Object} room - Room definition {x, y, width, height}
   */
  _carveRectangle(terrain, room) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (this._isInBounds(terrain, x, y)) {
          terrain[y][x] = this.floorTerrain;
        }
      }
    }
  }

  /**
   * Carve an oval/elliptical room using midpoint ellipse algorithm
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {Object} room - Room definition {x, y, width, height}
   */
  _carveOval(terrain, room) {
    // Calculate ellipse parameters
    const centerX = room.x + room.width / 2;
    const centerY = room.y + room.height / 2;
    const radiusX = room.width / 2;
    const radiusY = room.height / 2;

    // Fill ellipse using distance check
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        // Normalized distance from center (ellipse equation)
        const dx = (x + 0.5 - centerX) / radiusX;
        const dy = (y + 0.5 - centerY) / radiusY;
        const distSquared = dx * dx + dy * dy;

        // Point is inside ellipse if distance <= 1
        if (distSquared <= 1.0 && this._isInBounds(terrain, x, y)) {
          terrain[y][x] = this.floorTerrain;
        }
      }
    }
  }

  /**
   * Carve an irregular room (rectangle with organic edge variations)
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {Object} room - Room definition {x, y, width, height}
   * @param {function} random - Seeded random function
   */
  _carveIrregular(terrain, room, random) {
    // Generate edge variations (inward/outward by 0-1 cells)
    // Pre-generate all random values for determinism
    const edgeVariations = {
      top: [],
      bottom: [],
      left: [],
      right: []
    };

    // Generate variations for each edge cell
    for (let x = 0; x < room.width; x++) {
      edgeVariations.top.push(Math.floor(random() * 2)); // 0 or 1 inward
      edgeVariations.bottom.push(Math.floor(random() * 2));
    }
    for (let y = 0; y < room.height; y++) {
      edgeVariations.left.push(Math.floor(random() * 2));
      edgeVariations.right.push(Math.floor(random() * 2));
    }

    // Carve with edge variations
    for (let localY = 0; localY < room.height; localY++) {
      for (let localX = 0; localX < room.width; localX++) {
        const worldX = room.x + localX;
        const worldY = room.y + localY;

        if (!this._isInBounds(terrain, worldX, worldY)) continue;

        // Check if this cell should be carved (accounting for edge variations)
        let shouldCarve = true;

        // Top edge variation
        if (localY < edgeVariations.top[localX]) {
          shouldCarve = false;
        }
        // Bottom edge variation
        if (localY >= room.height - edgeVariations.bottom[localX]) {
          shouldCarve = false;
        }
        // Left edge variation
        if (localX < edgeVariations.left[localY]) {
          shouldCarve = false;
        }
        // Right edge variation
        if (localX >= room.width - edgeVariations.right[localY]) {
          shouldCarve = false;
        }

        if (shouldCarve) {
          terrain[worldY][worldX] = this.floorTerrain;
        }
      }
    }
  }

  /**
   * Check if coordinates are within terrain bounds
   * @param {string[][]} terrain - Terrain grid
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean} True if coordinates are valid
   */
  _isInBounds(terrain, x, y) {
    return y >= 0 && y < terrain.length && x >= 0 && x < terrain[0].length;
  }

  /**
   * Generate a random integer in range [min, max] (inclusive)
   * @param {function} random - Seeded random function
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number} Random integer in range
   */
  _randomInRange(random, min, max) {
    return Math.floor(random() * (max - min + 1)) + min;
  }

  /**
   * Generate rooms without applying to terrain (for analysis/preview)
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {function} random - Seeded random function
   * @param {Object} options - Generation options
   * @returns {Object[]} Array of room definitions
   */
  generateRooms(width, height, random, options = {}) {
    const intensity = options.intensity ?? 1.0;
    const bounds = options.bounds || { x: 0, y: 0, width, height };

    const targetRoomCount = Math.max(1, Math.round(this.roomCount * intensity));
    const placedRooms = [];
    let attempts = 0;
    const maxAttempts = targetRoomCount * 20;

    while (placedRooms.length < targetRoomCount && attempts < maxAttempts) {
      attempts++;
      const room = this._generateRoom(random, bounds);

      if (this._canPlaceRoom(room, placedRooms, bounds)) {
        placedRooms.push(room);
      }
    }

    return placedRooms;
  }

  /**
   * Get the center point of a room
   * @param {Object} room - Room definition
   * @returns {Object} Center coordinates {x, y}
   */
  static getRoomCenter(room) {
    return {
      x: Math.floor(room.x + room.width / 2),
      y: Math.floor(room.y + room.height / 2)
    };
  }

  /**
   * Calculate the area of a room (approximate for non-rectangular shapes)
   * @param {Object} room - Room definition
   * @returns {number} Approximate area in cells
   */
  static getRoomArea(room) {
    const baseArea = room.width * room.height;

    switch (room.shape) {
      case 'oval':
        // Ellipse area = pi * a * b (approximately 0.785 of bounding rectangle)
        return Math.floor(baseArea * Math.PI / 4);
      case 'irregular':
        // Rough estimate: 70-90% of base area due to edge variations
        return Math.floor(baseArea * 0.8);
      case 'rectangle':
      default:
        return baseArea;
    }
  }
}

export default RoomCarverAlgorithm;
