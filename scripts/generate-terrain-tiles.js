#!/usr/bin/env node
/**
 * Terrain Tile Generation Script
 * Generates 64x64 isometric diamond sprites for battle maps using Sharp
 *
 * Usage:
 *   node scripts/generate-terrain-tiles.js           # Generate all tiles
 *   node scripts/generate-terrain-tiles.js --force   # Regenerate all
 *   node scripts/generate-terrain-tiles.js --clean   # Remove all first
 *   node scripts/generate-terrain-tiles.js --biome cave  # Generate specific biome
 *
 * Output structure:
 *   frontend/public/assets/sprites/terrain/base/{terrain}_{variant}.png
 *   frontend/public/assets/sprites/terrain/cave/{terrain}_{variant}.png
 *   frontend/public/assets/sprites/terrain/mountain/{terrain}_{variant}.png
 *
 * Elevation sprites:
 *   frontend/public/assets/sprites/terrain/base/{terrain}_elev{1-3}.png
 *   frontend/public/assets/sprites/terrain/base/{terrain}_pit.png
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Configuration
const OUTPUT_DIR = path.join(__dirname, '../frontend/public/assets/sprites/terrain');
const TILE_SIZE = 64;           // Canvas size
const DIAMOND_WIDTH = 64;       // Diamond width
const DIAMOND_HEIGHT = 32;      // Diamond height
const BASE_HEIGHT = 0;          // No wall height - flat tiles for proper highlight alignment
const VARIANTS_PER_TERRAIN = 4; // Number of variants per terrain type

// Color palette for each terrain type
// Format: { top, left, right } - top is brightest, left is shadow, right is lit
const TERRAIN_COLORS = {
  grass: {
    top: '#6b8e23',
    left: '#2d4a2d',
    right: '#4a7c23',
    outline: '#1a2a1a'
  },
  stone: {
    top: '#8b8682',
    left: '#5a5a5a',
    right: '#a0a0a0',
    outline: '#3a3a3a'
  },
  rock: {
    top: '#8b4513',
    left: '#3d1f0d',
    right: '#a0522d',
    outline: '#2a1508'
  },
  forest: {
    top: '#228b22',
    left: '#0d3d0d',
    right: '#2e8b2e',
    outline: '#052005'
  },
  water: {
    top: '#4682b4',
    left: '#1e4a6e',
    right: '#5a9bd4',
    outline: '#143250'
  },
  lava: {
    top: '#ff4500',
    left: '#8b0000',
    right: '#ff6347',
    outline: '#5a0000'
  },
  cliff: {
    top: '#2f2f2f',
    left: '#1a1a1a',
    right: '#404040',
    outline: '#0a0a0a'
  },
  tree: {
    top: '#228b22',
    left: '#0d3d0d',
    right: '#2e8b2e',
    outline: '#052005'
  }
};

// Biome modifiers (multiply colors for darker/lighter variants)
const BIOME_MODIFIERS = {
  base: 1.0,
  cave: 0.7,     // Darker for caves
  mountain: 0.9  // Slightly darker for mountains
};

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Apply brightness modifier to hex color
 */
function modifyColor(hex, modifier) {
  const rgb = hexToRgb(hex);
  const r = Math.min(255, Math.round(rgb.r * modifier));
  const g = Math.min(255, Math.round(rgb.g * modifier));
  const b = Math.min(255, Math.round(rgb.b * modifier));
  return `rgb(${r},${g},${b})`;
}

/**
 * Add noise variation to color for texture
 */
function addNoise(rgb, intensity = 0.08) {
  const noise = (Math.random() - 0.5) * 2 * intensity * 255;
  return {
    r: Math.max(0, Math.min(255, rgb.r + noise)),
    g: Math.max(0, Math.min(255, rgb.g + noise)),
    b: Math.max(0, Math.min(255, rgb.b + noise))
  };
}

/**
 * Generate SVG for an isometric tile with 3D effect
 * @param {Object} colors - { top, left, right, outline }
 * @param {number} wallHeight - Height of the 3D walls
 * @param {number} variant - Variant index for slight color variations
 * @param {number} biomeModifier - Brightness modifier for biome
 */
function generateTileSvg(colors, wallHeight = BASE_HEIGHT, variant = 0, biomeModifier = 1.0) {
  const halfWidth = DIAMOND_WIDTH / 2;
  const halfHeight = DIAMOND_HEIGHT / 2;
  const cx = TILE_SIZE / 2;
  const cy = TILE_SIZE / 2;

  // Adjust colors for variant (slight random variation based on variant index)
  const variantMod = 1.0 + (variant - 1.5) * 0.05; // Ranges from 0.925 to 1.075

  const topColor = modifyColor(colors.top, biomeModifier * variantMod);
  const leftColor = modifyColor(colors.left, biomeModifier * variantMod);
  const rightColor = modifyColor(colors.right, biomeModifier * variantMod);
  const outlineColor = modifyColor(colors.outline, biomeModifier);

  // Top face points (diamond at vertical center minus wall height)
  const topY = cy - wallHeight;
  const topFace = `
    M ${cx} ${topY - halfHeight}
    L ${cx + halfWidth} ${topY}
    L ${cx} ${topY + halfHeight}
    L ${cx - halfWidth} ${topY}
    Z
  `;

  // Left wall (parallelogram from left edge down)
  const leftWall = `
    M ${cx - halfWidth} ${topY}
    L ${cx} ${topY + halfHeight}
    L ${cx} ${topY + halfHeight + wallHeight}
    L ${cx - halfWidth} ${topY + wallHeight}
    Z
  `;

  // Right wall (parallelogram from right edge down)
  const rightWall = `
    M ${cx + halfWidth} ${topY}
    L ${cx} ${topY + halfHeight}
    L ${cx} ${topY + halfHeight + wallHeight}
    L ${cx + halfWidth} ${topY + wallHeight}
    Z
  `;

  // Generate noise pattern filter for texture
  const noiseId = `noise-${variant}`;

  // Only include wall paths if there's actual wall height
  const wallPaths = wallHeight > 0 ? `
  <!-- Left wall -->
  <path d="${leftWall}" fill="${leftColor}" stroke="${outlineColor}" stroke-width="1"/>

  <!-- Right wall -->
  <path d="${rightWall}" fill="${rightColor}" stroke="${outlineColor}" stroke-width="1"/>
` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TILE_SIZE}" height="${TILE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="${noiseId}" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${variant * 100}" result="noise"/>
      <feColorMatrix type="saturate" values="0" result="desaturated"/>
      <feComponentTransfer result="adjusted">
        <feFuncR type="linear" slope="0.08" intercept="0"/>
        <feFuncG type="linear" slope="0.08" intercept="0"/>
        <feFuncB type="linear" slope="0.08" intercept="0"/>
        <feFuncA type="linear" slope="0.3" intercept="0"/>
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="adjusted" mode="overlay"/>
    </filter>
  </defs>
${wallPaths}
  <!-- Top face -->
  <path d="${topFace}" fill="${topColor}" stroke="${outlineColor}" stroke-width="1" filter="url(#${noiseId})"/>
</svg>`;
}

/**
 * Generate SVG for elevated tiles (higher walls)
 */
function generateElevatedTileSvg(colors, elevationLevel, biomeModifier = 1.0) {
  // Each elevation level adds 8px to wall height
  const wallHeight = BASE_HEIGHT + (elevationLevel * 8);
  return generateTileSvg(colors, wallHeight, 0, biomeModifier);
}

/**
 * Generate SVG for pit tiles (recessed, darker appearance)
 */
function generatePitTileSvg(colors, biomeModifier = 1.0) {
  // Pit is darker and has no wall height (flat, but darker)
  const pitModifier = biomeModifier * 0.6; // Much darker
  return generateTileSvg(colors, 0, 0, pitModifier);
}

/**
 * Generate all tiles for a terrain type in a specific biome
 */
async function generateTerrainTiles(terrainType, biome = 'base', options = {}) {
  const { force = false, verbose = false } = options;
  const outputDir = path.join(OUTPUT_DIR, biome);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const colors = TERRAIN_COLORS[terrainType];
  if (!colors) {
    console.warn(`Unknown terrain type: ${terrainType}`);
    return [];
  }

  const biomeModifier = BIOME_MODIFIERS[biome] || 1.0;
  const generated = [];

  // Generate base variants (0-3)
  for (let variant = 0; variant < VARIANTS_PER_TERRAIN; variant++) {
    const filename = `${terrainType}_${variant}.png`;
    const filepath = path.join(outputDir, filename);

    if (!force && fs.existsSync(filepath)) {
      if (verbose) console.log(`  Skipping ${filename} (exists)`);
      continue;
    }

    const svg = generateTileSvg(colors, BASE_HEIGHT, variant, biomeModifier);

    await sharp(Buffer.from(svg))
      .png()
      .toFile(filepath);

    generated.push(filename);
    if (verbose) console.log(`  Generated ${filename}`);
  }

  // Generate elevation variants (elev1, elev2, elev3)
  for (let elev = 1; elev <= 3; elev++) {
    const filename = `${terrainType}_elev${elev}.png`;
    const filepath = path.join(outputDir, filename);

    if (!force && fs.existsSync(filepath)) {
      if (verbose) console.log(`  Skipping ${filename} (exists)`);
      continue;
    }

    const svg = generateElevatedTileSvg(colors, elev, biomeModifier);

    await sharp(Buffer.from(svg))
      .png()
      .toFile(filepath);

    generated.push(filename);
    if (verbose) console.log(`  Generated ${filename}`);
  }

  // Generate pit variant
  const pitFilename = `${terrainType}_pit.png`;
  const pitFilepath = path.join(outputDir, pitFilename);

  if (force || !fs.existsSync(pitFilepath)) {
    const pitSvg = generatePitTileSvg(colors, biomeModifier);

    await sharp(Buffer.from(pitSvg))
      .png()
      .toFile(pitFilepath);

    generated.push(pitFilename);
    if (verbose) console.log(`  Generated ${pitFilename}`);
  }

  return generated;
}

/**
 * Generate transition/indicator sprites
 */
async function generateTransitionIndicators(biome = 'base', options = {}) {
  const { force = false, verbose = false } = options;
  const outputDir = path.join(OUTPUT_DIR, biome, 'indicators');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const generated = [];
  const halfWidth = DIAMOND_WIDTH / 2;
  const halfHeight = DIAMOND_HEIGHT / 2;
  const cx = TILE_SIZE / 2;
  const cy = TILE_SIZE / 2;

  // Ramp indicator (diagonal stripes)
  const rampSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TILE_SIZE}" height="${TILE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="ramp-stripes" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,200,0.5)" stroke-width="4"/>
    </pattern>
    <clipPath id="diamond-clip">
      <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"/>
    </clipPath>
  </defs>
  <rect width="100%" height="100%" fill="url(#ramp-stripes)" clip-path="url(#diamond-clip)"/>
  <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"
        fill="none" stroke="rgba(200,180,100,0.8)" stroke-width="2"/>
</svg>`;

  // Stairs indicator (step pattern)
  const stairsSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TILE_SIZE}" height="${TILE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="diamond-clip-stairs">
      <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"/>
    </clipPath>
  </defs>
  <g clip-path="url(#diamond-clip-stairs)">
    <rect x="${cx - 20}" y="${cy - 10}" width="40" height="3" fill="rgba(180,160,140,0.7)"/>
    <rect x="${cx - 15}" y="${cy - 3}" width="30" height="3" fill="rgba(160,140,120,0.7)"/>
    <rect x="${cx - 10}" y="${cy + 4}" width="20" height="3" fill="rgba(140,120,100,0.7)"/>
  </g>
  <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"
        fill="none" stroke="rgba(150,130,110,0.8)" stroke-width="2"/>
</svg>`;

  // Ledge indicator (one-way arrow pointing down)
  const ledgeSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TILE_SIZE}" height="${TILE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="diamond-clip-ledge">
      <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"/>
    </clipPath>
  </defs>
  <g clip-path="url(#diamond-clip-ledge)">
    <polygon points="${cx},${cy + 8} ${cx - 8},${cy - 4} ${cx + 8},${cy - 4}"
             fill="rgba(100,200,100,0.6)"/>
    <rect x="${cx - 3}" y="${cy - 10}" width="6" height="10" fill="rgba(100,200,100,0.6)"/>
  </g>
  <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"
        fill="none" stroke="rgba(80,180,80,0.8)" stroke-width="2"/>
</svg>`;

  // Cliff indicator (X pattern for blocked)
  const cliffSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TILE_SIZE}" height="${TILE_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="diamond-clip-cliff">
      <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"/>
    </clipPath>
  </defs>
  <g clip-path="url(#diamond-clip-cliff)">
    <line x1="${cx - 10}" y1="${cy - 8}" x2="${cx + 10}" y2="${cy + 8}"
          stroke="rgba(200,50,50,0.7)" stroke-width="4" stroke-linecap="round"/>
    <line x1="${cx + 10}" y1="${cy - 8}" x2="${cx - 10}" y2="${cy + 8}"
          stroke="rgba(200,50,50,0.7)" stroke-width="4" stroke-linecap="round"/>
  </g>
  <path d="M ${cx} ${cy - halfHeight} L ${cx + halfWidth} ${cy} L ${cx} ${cy + halfHeight} L ${cx - halfWidth} ${cy} Z"
        fill="none" stroke="rgba(180,40,40,0.8)" stroke-width="2"/>
</svg>`;

  const indicators = [
    { name: 'ramp_indicator', svg: rampSvg },
    { name: 'stairs_indicator', svg: stairsSvg },
    { name: 'ledge_indicator', svg: ledgeSvg },
    { name: 'cliff_indicator', svg: cliffSvg }
  ];

  for (const indicator of indicators) {
    const filename = `${indicator.name}.png`;
    const filepath = path.join(outputDir, filename);

    if (!force && fs.existsSync(filepath)) {
      if (verbose) console.log(`  Skipping ${filename} (exists)`);
      continue;
    }

    await sharp(Buffer.from(indicator.svg))
      .png()
      .toFile(filepath);

    generated.push(filename);
    if (verbose) console.log(`  Generated ${filename}`);
  }

  return generated;
}

/**
 * Clean output directory
 */
function cleanOutputDirectory(biome = null) {
  if (biome) {
    const dir = path.join(OUTPUT_DIR, biome);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      console.log(`Cleaned: ${dir}`);
    }
  } else {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
      console.log(`Cleaned: ${OUTPUT_DIR}`);
    }
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    force: args.includes('--force'),
    clean: args.includes('--clean'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    help: args.includes('--help') || args.includes('-h'),
    biome: null
  };

  const biomeIdx = args.indexOf('--biome');
  if (biomeIdx !== -1 && args[biomeIdx + 1]) {
    options.biome = args[biomeIdx + 1];
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Terrain Tile Generation Script
Generates 64x64 isometric diamond sprites for battle maps

Usage:
  node scripts/generate-terrain-tiles.js [options]

Options:
  --force         Regenerate all tiles, ignoring existing files
  --clean         Remove all existing tiles before generating
  --biome <name>  Generate only specific biome (base, cave, mountain)
  --verbose, -v   Show detailed progress
  --help, -h      Show this help message

Output:
  frontend/public/assets/sprites/terrain/{biome}/{terrain}_{variant}.png

Terrain Types:
  grass, stone, rock, forest, water, lava, cliff, tree

Biomes:
  base     - Standard lighting
  cave     - Darker variants
  mountain - Slightly darker variants

Examples:
  node scripts/generate-terrain-tiles.js              # Generate new/updated only
  node scripts/generate-terrain-tiles.js --force      # Regenerate everything
  node scripts/generate-terrain-tiles.js --biome cave # Generate cave tiles only
`);
}

/**
 * Main execution
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('Terrain Tile Generator');
  console.log('======================');

  // Clean if requested
  if (options.clean) {
    cleanOutputDirectory(options.biome);
  }

  // Determine which biomes to generate
  const biomes = options.biome ? [options.biome] : Object.keys(BIOME_MODIFIERS);
  const terrainTypes = Object.keys(TERRAIN_COLORS);

  let totalGenerated = 0;

  for (const biome of biomes) {
    console.log(`\nGenerating ${biome} biome...`);

    for (const terrainType of terrainTypes) {
      if (options.verbose) console.log(`  ${terrainType}:`);
      const generated = await generateTerrainTiles(terrainType, biome, options);
      totalGenerated += generated.length;
      if (!options.verbose && generated.length > 0) {
        console.log(`  ${terrainType}: ${generated.length} tiles generated`);
      }
    }

    // Generate transition indicators
    if (options.verbose) console.log('  indicators:');
    const indicators = await generateTransitionIndicators(biome, options);
    totalGenerated += indicators.length;
    if (!options.verbose && indicators.length > 0) {
      console.log(`  indicators: ${indicators.length} tiles generated`);
    }
  }

  console.log(`\nDone! Generated ${totalGenerated} tiles.`);
}

// Run
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
