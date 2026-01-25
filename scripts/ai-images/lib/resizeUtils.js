/**
 * Image Resize Utilities
 * Generate multiple size variants from source images using ImageMagick
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { log, fileExists, ensureDirectoryExists } = require('./imageUtils');

/**
 * Standard sizes for game assets
 * Generated from 128x128 source for maximum quality
 */
const STANDARD_SIZES = [16, 24, 32, 48, 64, 128];

/**
 * Size presets for different asset categories
 * These define the output sizes for each asset type after AI generation
 */
const SIZE_PRESETS = {
  tiles: [64],                        // 128x128 AI -> 64x64 with diamond mask
  portraits: [64, 128, 256],          // 256x256 AI -> 64, 128, 256 variants
  items: [32, 64, 128],               // 128x128 AI -> 32, 64, 128 variants
  icons: [16, 24, 32, 48, 64, 128],   // 128x128 AI -> 16, 24, 32, 48, 64, 128 variants
  nodes: [48, 96],                    // 256x256 AI -> 48, 96 variants
  walls: [64],                        // 128x32 AI -> 64x16
  slopes: [64],                       // 128x160 AI -> 64x80
  overlays: [32, 48, 64, 128]         // Match item sizes for compositing (legacy)
};

/**
 * AI generation resolution for each asset type
 */
const AI_RESOLUTIONS = {
  tiles: { width: 128, height: 128 },
  portraits: { width: 256, height: 256 },
  items: { width: 128, height: 128 },
  icons: { width: 128, height: 128 },
  nodes: { width: 256, height: 256 },
  walls: { width: 128, height: 32 },
  slopes: { width: 128, height: 160 }
};

/**
 * Check if ImageMagick is available
 * @returns {boolean} True if convert command is available
 */
function checkImageMagick() {
  try {
    execSync('which convert', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the output path for a sized variant
 * @param {string} sourcePath - Original 128x128 image path
 * @param {number} size - Target size
 * @param {Object} options - Options
 * @param {string} options.sizeDir - Use subdirectory per size (e.g., /32x32/item.png)
 * @param {string} options.sizeSuffix - Use suffix (e.g., item_32.png)
 * @returns {string} Output path for the sized variant
 */
function getSizedPath(sourcePath, size, options = {}) {
  const { sizeDir = true, sizeSuffix = false } = options;
  const dir = path.dirname(sourcePath);
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);

  if (size === 128) {
    // Keep 128x128 in place as the source
    return sourcePath;
  }

  if (sizeDir) {
    // Put sized variants in subdirectories: /items/weapons/32x32/sword.png
    const sizeSubdir = `${size}x${size}`;
    return path.join(dir, sizeSubdir, `${base}${ext}`);
  } else if (sizeSuffix) {
    // Use suffix: /items/weapons/sword_32.png
    return path.join(dir, `${base}_${size}${ext}`);
  } else {
    // Default: subdirectory
    const sizeSubdir = `${size}x${size}`;
    return path.join(dir, sizeSubdir, `${base}${ext}`);
  }
}

/**
 * Resize a single image to a target size
 * @param {string} sourcePath - Source image path (128x128)
 * @param {string} outputPath - Output path for resized image
 * @param {number} size - Target size (width = height)
 * @param {Object} options - Resize options
 * @param {string} options.filter - ImageMagick filter (lanczos, mitchell, catrom)
 * @param {boolean} options.unsharp - Apply unsharp mask for sharpening
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function resizeImage(sourcePath, outputPath, size, options = {}) {
  const { filter = 'lanczos', unsharp = true } = options;

  if (!fileExists(sourcePath)) {
    return { success: false, outputPath, error: `Source not found: ${sourcePath}` };
  }

  // Ensure output directory exists
  ensureDirectoryExists(path.dirname(outputPath));

  // Build ImageMagick command
  // -filter lanczos: High-quality downscaling
  // -resize: Resize to target size
  // -unsharp: Sharpen to counteract blur from downscaling
  const args = [
    sourcePath,
    '-filter', filter,
    '-resize', `${size}x${size}`,
  ];

  // Add unsharp mask for smaller sizes (helps with clarity)
  if (unsharp && size <= 48) {
    args.push('-unsharp', '0x0.5+0.5+0.05');
  }

  args.push(outputPath);

  return new Promise((resolve) => {
    const proc = spawn('convert', args);
    let stderr = '';
    let resolved = false;

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      if (code === 0) {
        resolve({ success: true, outputPath });
      } else {
        resolve({ success: false, outputPath, error: stderr || `Exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      resolve({ success: false, outputPath, error: err.message });
    });
  });
}

/**
 * Generate all size variants for a source image
 * @param {string} sourcePath - Source image path (128x128)
 * @param {Object} options - Options
 * @param {number[]} options.sizes - Target sizes (default: STANDARD_SIZES)
 * @param {string} options.preset - Use a size preset (items, icons, overlays, nodes, portraits)
 * @param {boolean} options.sizeDir - Use subdirectory per size
 * @param {boolean} options.force - Overwrite existing files
 * @param {boolean} options.verbose - Log progress
 * @returns {Promise<{success: boolean, generated: string[], skipped: string[], failed: string[]}>}
 */
async function generateSizeVariants(sourcePath, options = {}) {
  const {
    sizes = null,
    preset = null,
    sizeDir = true,
    force = false,
    verbose = false
  } = options;

  // Determine which sizes to generate
  let targetSizes = sizes;
  if (!targetSizes && preset && SIZE_PRESETS[preset]) {
    targetSizes = SIZE_PRESETS[preset];
  }
  if (!targetSizes) {
    targetSizes = STANDARD_SIZES;
  }

  // Filter out 128 (source size) unless force is set
  const sizesToGenerate = targetSizes.filter(s => s !== 128);

  const results = {
    success: true,
    generated: [],
    skipped: [],
    failed: []
  };

  for (const size of sizesToGenerate) {
    const outputPath = getSizedPath(sourcePath, size, { sizeDir });

    // Skip if exists and not forcing
    if (!force && fileExists(outputPath)) {
      results.skipped.push(outputPath);
      if (verbose) {
        log(`Skipped (exists): ${outputPath}`, 'info');
      }
      continue;
    }

    const result = await resizeImage(sourcePath, outputPath, size);

    if (result.success) {
      results.generated.push(outputPath);
      if (verbose) {
        log(`Generated: ${outputPath}`, 'success');
      }
    } else {
      results.failed.push({ path: outputPath, error: result.error });
      results.success = false;
      if (verbose) {
        log(`Failed: ${outputPath} - ${result.error}`, 'error');
      }
    }
  }

  return results;
}

/**
 * Generate size variants for all images in a directory
 * @param {string} sourceDir - Directory containing 128x128 source images
 * @param {Object} options - Options (same as generateSizeVariants plus recursive)
 * @param {boolean} options.recursive - Process subdirectories
 * @param {string} options.pattern - Glob pattern for files (default: *.png)
 * @returns {Promise<{total: number, generated: number, skipped: number, failed: number}>}
 */
async function generateSizeVariantsForDirectory(sourceDir, options = {}) {
  const { recursive = false, verbose = false, ...resizeOptions } = options;

  const results = {
    total: 0,
    generated: 0,
    skipped: 0,
    failed: 0
  };

  // Find all PNG files in directory
  const files = [];

  function findFiles(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip size subdirectories (16x16, 32x32, etc.)
        if (/^\d+x\d+$/.test(entry.name)) continue;
        if (recursive) findFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.png')) {
        files.push(fullPath);
      }
    }
  }

  findFiles(sourceDir);
  results.total = files.length;

  if (verbose) {
    log(`Found ${files.length} source images in ${sourceDir}`, 'info');
  }

  for (const file of files) {
    const result = await generateSizeVariants(file, { ...resizeOptions, verbose });
    results.generated += result.generated.length;
    results.skipped += result.skipped.length;
    results.failed += result.failed.length;
  }

  return results;
}

/**
 * Post-process a single generated image to create all size variants
 * Called automatically after image generation if enabled
 * @param {string} imagePath - Path to generated 128x128 image
 * @param {string} category - Asset category for preset selection
 * @param {Object} options - Additional options
 * @returns {Promise<{success: boolean, variants: string[]}>}
 */
async function postProcessGenerated(imagePath, category, options = {}) {
  const preset = SIZE_PRESETS[category] ? category : null;
  const result = await generateSizeVariants(imagePath, {
    preset,
    force: options.force || false,
    verbose: options.verbose || false
  });

  return {
    success: result.success,
    variants: result.generated
  };
}

/**
 * Apply a diamond mask to an image for isometric tile rendering
 * Creates a diamond-shaped transparent mask from a square image
 * @param {string} sourcePath - Source image path
 * @param {string} outputPath - Output path for masked image
 * @param {number} size - Target size (width = height for the diamond bounding box)
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function applyDiamondMask(sourcePath, outputPath, size) {
  if (!fileExists(sourcePath)) {
    return { success: false, outputPath, error: `Source not found: ${sourcePath}` };
  }

  ensureDirectoryExists(path.dirname(outputPath));

  // Create a diamond mask using ImageMagick
  // The diamond is inscribed in the square, with corners at midpoints of edges
  const halfSize = size / 2;
  const diamondPoints = `${halfSize},0 ${size},${halfSize} ${halfSize},${size} 0,${halfSize}`;

  const args = [
    sourcePath,
    '-resize', `${size}x${size}!`,
    '(',
      '-size', `${size}x${size}`,
      'xc:none',
      '-fill', 'white',
      '-draw', `polygon ${diamondPoints}`,
    ')',
    '-compose', 'DstIn',
    '-composite',
    outputPath
  ];

  return new Promise((resolve) => {
    const proc = spawn('convert', args);
    let stderr = '';
    let resolved = false;

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      if (code === 0) {
        resolve({ success: true, outputPath });
      } else {
        resolve({ success: false, outputPath, error: stderr || `Exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      resolve({ success: false, outputPath, error: err.message });
    });
  });
}

/**
 * Apply isometric transform to a flat texture
 * Converts a square flat texture to an isometric diamond shape
 *
 * The transform applies:
 * 1. Rotation by 45 degrees
 * 2. Vertical scale to 50% (creates 2:1 aspect ratio)
 * 3. Optional diamond mask
 * 4. Resize to target dimensions
 *
 * @param {string} sourcePath - Source flat texture (square, e.g., 128x128)
 * @param {string} outputPath - Output path for isometric tile
 * @param {number} size - Target size (width of the diamond bounding box)
 * @param {Object} options - Transform options
 * @param {boolean} options.applyMask - Apply diamond mask (default: true)
 * @param {boolean} options.addLighting - Add top-left lighting gradient (default: true)
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function applyIsometricTransform(sourcePath, outputPath, size, options = {}) {
  const { applyMask = true, addLighting = true } = options;

  if (!fileExists(sourcePath)) {
    return { success: false, outputPath, error: `Source not found: ${sourcePath}` };
  }

  ensureDirectoryExists(path.dirname(outputPath));

  // Calculate intermediate size (before rotation, need larger canvas)
  const intermediateSize = Math.ceil(size * Math.sqrt(2));
  const halfSize = size / 2;

  // Build ImageMagick command for isometric transform
  // Steps:
  // 1. Resize source to intermediate size
  // 2. Rotate 45 degrees
  // 3. Scale vertically to 50% (isometric projection)
  // 4. Crop to final size
  // 5. Apply diamond mask if requested
  // 6. Add lighting gradient if requested

  let args = [
    sourcePath,
    '-resize', `${intermediateSize}x${intermediateSize}`,
    '-background', 'transparent',
    '-rotate', '45',
    '-resize', `${size}x${size / 2}!`, // Scale to 2:1 aspect ratio
    '-gravity', 'center',
    '-extent', `${size}x${size / 2}` // Ensure exact dimensions
  ];

  // Apply diamond mask
  if (applyMask) {
    const diamondPoints = `${halfSize},0 ${size},${size / 4} ${halfSize},${size / 2} 0,${size / 4}`;
    args = args.concat([
      '(',
        '-size', `${size}x${size / 2}`,
        'xc:none',
        '-fill', 'white',
        '-draw', `polygon ${diamondPoints}`,
      ')',
      '-compose', 'DstIn',
      '-composite'
    ]);
  }

  // Add subtle lighting gradient (top-left light source)
  if (addLighting) {
    args = args.concat([
      '(',
        '-size', `${size}x${size / 2}`,
        '-define', 'gradient:direction=NorthWest',
        'gradient:rgba(255,255,255,0.1)-rgba(0,0,0,0.15)',
      ')',
      '-compose', 'Overlay',
      '-composite'
    ]);
  }

  args.push(outputPath);

  return new Promise((resolve) => {
    const proc = spawn('convert', args);
    let stderr = '';
    let resolved = false;

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      if (code === 0) {
        resolve({ success: true, outputPath });
      } else {
        resolve({ success: false, outputPath, error: stderr || `Exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      resolve({ success: false, outputPath, error: err.message });
    });
  });
}

/**
 * Post-process a flat texture tile: apply isometric transform and resize to 64x32
 * This is the new standard tile post-processing for the unified stacking system
 *
 * @param {string} imagePath - Path to generated flat texture (128x128)
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function postProcessFlatTile(imagePath, options = {}) {
  const { force = false, verbose = false } = options;

  // Output goes to same location but with _iso suffix before extension
  const dir = path.dirname(imagePath);
  const ext = path.extname(imagePath);
  const base = path.basename(imagePath, ext);
  const outputPath = path.join(dir, `${base}${ext}`); // Replace original with isometric version

  if (!force && fileExists(outputPath) && imagePath !== outputPath) {
    if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
    return { success: true, outputPath, skipped: true };
  }

  // Apply isometric transform: 128x128 flat -> 64x32 isometric diamond
  const result = await applyIsometricTransform(imagePath, outputPath, 64, {
    applyMask: true,
    addLighting: true
  });

  if (result.success && verbose) {
    log(`Generated isometric tile: ${outputPath}`, 'success');
  } else if (!result.success && verbose) {
    log(`Failed isometric tile: ${outputPath} - ${result.error}`, 'error');
  }

  return result;
}

/**
 * Resize an image with non-square dimensions
 * @param {string} sourcePath - Source image path
 * @param {string} outputPath - Output path for resized image
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @param {Object} options - Resize options
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function resizeImageNonSquare(sourcePath, outputPath, width, height, options = {}) {
  const { filter = 'lanczos', unsharp = true } = options;

  if (!fileExists(sourcePath)) {
    return { success: false, outputPath, error: `Source not found: ${sourcePath}` };
  }

  ensureDirectoryExists(path.dirname(outputPath));

  const args = [
    sourcePath,
    '-filter', filter,
    '-resize', `${width}x${height}!`,
  ];

  // Add unsharp mask for smaller sizes
  const minDim = Math.min(width, height);
  if (unsharp && minDim <= 48) {
    args.push('-unsharp', '0x0.5+0.5+0.05');
  }

  args.push(outputPath);

  return new Promise((resolve) => {
    const proc = spawn('convert', args);
    let stderr = '';
    let resolved = false;

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      if (code === 0) {
        resolve({ success: true, outputPath });
      } else {
        resolve({ success: false, outputPath, error: stderr || `Exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      resolve({ success: false, outputPath, error: err.message });
    });
  });
}

/**
 * Get the output path for a sized variant with custom dimensions
 * @param {string} sourcePath - Original image path
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @returns {string} Output path for the sized variant
 */
function getSizedPathNonSquare(sourcePath, width, height) {
  const dir = path.dirname(sourcePath);
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);
  const sizeSubdir = `${width}x${height}`;
  return path.join(dir, sizeSubdir, `${base}${ext}`);
}

/**
 * Post-process a tile image: resize from 128x128 to 64x64 with diamond mask
 * @param {string} imagePath - Path to generated 128x128 tile image
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function postProcessTile(imagePath, options = {}) {
  const { force = false, verbose = false } = options;
  const outputPath = getSizedPath(imagePath, 64, { sizeDir: true });

  if (!force && fileExists(outputPath)) {
    if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
    return { success: true, outputPath, skipped: true };
  }

  // Apply diamond mask and resize in one operation
  const result = await applyDiamondMask(imagePath, outputPath, 64);

  if (result.success && verbose) {
    log(`Generated tile: ${outputPath}`, 'success');
  } else if (!result.success && verbose) {
    log(`Failed tile: ${outputPath} - ${result.error}`, 'error');
  }

  return result;
}

/**
 * Post-process a portrait image: generate 64, 128, 256 variants from 256x256
 * @param {string} imagePath - Path to generated 256x256 portrait image
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, variants: string[], failed: string[]}>}
 */
async function postProcessPortrait(imagePath, options = {}) {
  const { force = false, verbose = false } = options;
  const sizes = SIZE_PRESETS.portraits; // [64, 128, 256]
  const results = { success: true, variants: [], failed: [] };

  for (const size of sizes) {
    // For 256, keep the original in place
    if (size === 256) {
      results.variants.push(imagePath);
      continue;
    }

    const outputPath = getSizedPath(imagePath, size, { sizeDir: true });

    if (!force && fileExists(outputPath)) {
      if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
      results.variants.push(outputPath);
      continue;
    }

    const result = await resizeImage(imagePath, outputPath, size);

    if (result.success) {
      results.variants.push(outputPath);
      if (verbose) log(`Generated portrait: ${outputPath}`, 'success');
    } else {
      results.failed.push({ path: outputPath, error: result.error });
      results.success = false;
      if (verbose) log(`Failed portrait: ${outputPath} - ${result.error}`, 'error');
    }
  }

  return results;
}

/**
 * Post-process an item image: generate 32, 64, 128 variants from 128x128
 * @param {string} imagePath - Path to generated 128x128 item image
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, variants: string[], failed: string[]}>}
 */
async function postProcessItem(imagePath, options = {}) {
  const { force = false, verbose = false } = options;
  const sizes = SIZE_PRESETS.items; // [32, 64, 128]
  const results = { success: true, variants: [], failed: [] };

  for (const size of sizes) {
    // For 128, keep the original in place
    if (size === 128) {
      results.variants.push(imagePath);
      continue;
    }

    const outputPath = getSizedPath(imagePath, size, { sizeDir: true });

    if (!force && fileExists(outputPath)) {
      if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
      results.variants.push(outputPath);
      continue;
    }

    const result = await resizeImage(imagePath, outputPath, size);

    if (result.success) {
      results.variants.push(outputPath);
      if (verbose) log(`Generated item: ${outputPath}`, 'success');
    } else {
      results.failed.push({ path: outputPath, error: result.error });
      results.success = false;
      if (verbose) log(`Failed item: ${outputPath} - ${result.error}`, 'error');
    }
  }

  return results;
}

/**
 * Post-process an icon image: generate 16, 24, 32, 48, 64, 128 variants from 128x128
 * @param {string} imagePath - Path to generated 128x128 icon image
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, variants: string[], failed: string[]}>}
 */
async function postProcessIcon(imagePath, options = {}) {
  const { force = false, verbose = false } = options;
  const sizes = SIZE_PRESETS.icons; // [16, 24, 32, 48, 64, 128]
  const results = { success: true, variants: [], failed: [] };

  for (const size of sizes) {
    // For 128, keep the original in place
    if (size === 128) {
      results.variants.push(imagePath);
      continue;
    }

    const outputPath = getSizedPath(imagePath, size, { sizeDir: true });

    if (!force && fileExists(outputPath)) {
      if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
      results.variants.push(outputPath);
      continue;
    }

    const result = await resizeImage(imagePath, outputPath, size);

    if (result.success) {
      results.variants.push(outputPath);
      if (verbose) log(`Generated icon: ${outputPath}`, 'success');
    } else {
      results.failed.push({ path: outputPath, error: result.error });
      results.success = false;
      if (verbose) log(`Failed icon: ${outputPath} - ${result.error}`, 'error');
    }
  }

  return results;
}

/**
 * Post-process a node image: generate 48, 96 variants from 256x256
 * @param {string} imagePath - Path to generated 256x256 node image
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, variants: string[], failed: string[]}>}
 */
async function postProcessNode(imagePath, options = {}) {
  const { force = false, verbose = false } = options;
  const sizes = SIZE_PRESETS.nodes; // [48, 96]
  const results = { success: true, variants: [], failed: [] };

  for (const size of sizes) {
    const outputPath = getSizedPath(imagePath, size, { sizeDir: true });

    if (!force && fileExists(outputPath)) {
      if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
      results.variants.push(outputPath);
      continue;
    }

    const result = await resizeImage(imagePath, outputPath, size);

    if (result.success) {
      results.variants.push(outputPath);
      if (verbose) log(`Generated node: ${outputPath}`, 'success');
    } else {
      results.failed.push({ path: outputPath, error: result.error });
      results.success = false;
      if (verbose) log(`Failed node: ${outputPath} - ${result.error}`, 'error');
    }
  }

  return results;
}

/**
 * Post-process a wall image: resize from 128x32 to 64x16
 * @param {string} imagePath - Path to generated 128x32 wall image
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function postProcessWall(imagePath, options = {}) {
  const { force = false, verbose = false } = options;
  const outputPath = getSizedPathNonSquare(imagePath, 64, 16);

  if (!force && fileExists(outputPath)) {
    if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
    return { success: true, outputPath, skipped: true };
  }

  const result = await resizeImageNonSquare(imagePath, outputPath, 64, 16);

  if (result.success && verbose) {
    log(`Generated wall: ${outputPath}`, 'success');
  } else if (!result.success && verbose) {
    log(`Failed wall: ${outputPath} - ${result.error}`, 'error');
  }

  return result;
}

/**
 * Post-process a slope image: resize from 128x160 to 64x80
 * @param {string} imagePath - Path to generated 128x160 slope image
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, outputPath: string, error?: string}>}
 */
async function postProcessSlope(imagePath, options = {}) {
  const { force = false, verbose = false } = options;
  const outputPath = getSizedPathNonSquare(imagePath, 64, 80);

  if (!force && fileExists(outputPath)) {
    if (verbose) log(`Skipped (exists): ${outputPath}`, 'info');
    return { success: true, outputPath, skipped: true };
  }

  const result = await resizeImageNonSquare(imagePath, outputPath, 64, 80);

  if (result.success && verbose) {
    log(`Generated slope: ${outputPath}`, 'success');
  } else if (!result.success && verbose) {
    log(`Failed slope: ${outputPath} - ${result.error}`, 'error');
  }

  return result;
}

/**
 * Post-process an image based on its asset type
 * Dispatcher function that calls the appropriate post-processor
 * @param {string} imagePath - Path to generated image
 * @param {string} assetType - Asset type (tiles, flatTiles, portraits, items, icons, nodes, walls, slopes)
 * @param {Object} options - Options (force, verbose)
 * @returns {Promise<{success: boolean, variants?: string[], outputPath?: string, error?: string}>}
 */
async function postProcessByType(imagePath, assetType, options = {}) {
  switch (assetType) {
    case 'tiles':
      return postProcessTile(imagePath, options);
    case 'flatTiles':
      // NEW: Flat texture -> isometric diamond transform
      return postProcessFlatTile(imagePath, options);
    case 'portraits':
      return postProcessPortrait(imagePath, options);
    case 'items':
      return postProcessItem(imagePath, options);
    case 'icons':
      return postProcessIcon(imagePath, options);
    case 'nodes':
      return postProcessNode(imagePath, options);
    case 'walls':
      return postProcessWall(imagePath, options);
    case 'slopes':
      return postProcessSlope(imagePath, options);
    default:
      // Fall back to legacy behavior
      return postProcessGenerated(imagePath, assetType, options);
  }
}

/**
 * Post-process a generated image with dual-write support
 * Generates assets at both legacy locations and new standardized locations
 * @param {string} imagePath - Path to generated source image
 * @param {string} category - Asset category (icons, items, nodes, portraits, etc.)
 * @param {Object} options - Options
 * @param {string} options.id - Asset identifier
 * @param {string} [options.subcategory] - Subcategory for organization
 * @param {boolean} [options.dualWrite=true] - Whether to also write to standardized paths
 * @param {boolean} [options.force=false] - Overwrite existing files
 * @param {boolean} [options.verbose=false] - Log progress
 * @returns {Promise<{legacy: Object, standardized: Object}>}
 */
async function postProcessWithDualWrite(imagePath, category, options = {}) {
  const { id, subcategory, dualWrite = true, force = false, verbose = false } = options;

  // 1. Generate legacy paths (existing behavior)
  const legacyResults = await postProcessByType(imagePath, category, { force, verbose });

  if (!dualWrite) {
    return { legacy: legacyResults, standardized: null };
  }

  // 2. Generate standardized paths
  const sizes = SIZE_PRESETS[category] || [64];
  const standardizedResults = { success: true, variants: [], failed: [] };

  for (const size of sizes) {
    // Standardized pattern: /assets/{category}/png/{size}/{subcategory}-{id}.png
    const subPart = subcategory ? `${subcategory}-` : '';
    const standardizedPath = path.join(
      'frontend/public/assets',
      category,
      'png',
      String(size),
      `${subPart}${id}.png`
    );

    if (!force && fileExists(standardizedPath)) {
      standardizedResults.variants.push(standardizedPath);
      if (verbose) log(`Skipped (exists): ${standardizedPath}`, 'info');
      continue;
    }

    const result = await resizeImage(imagePath, standardizedPath, size);
    if (result.success) {
      standardizedResults.variants.push(standardizedPath);
      if (verbose) log(`Generated standardized: ${standardizedPath}`, 'success');
    } else {
      standardizedResults.failed.push({ path: standardizedPath, error: result.error });
      standardizedResults.success = false;
      if (verbose) log(`Failed standardized: ${standardizedPath} - ${result.error}`, 'error');
    }
  }

  return { legacy: legacyResults, standardized: standardizedResults };
}

module.exports = {
  STANDARD_SIZES,
  SIZE_PRESETS,
  AI_RESOLUTIONS,
  checkImageMagick,
  getSizedPath,
  getSizedPathNonSquare,
  resizeImage,
  resizeImageNonSquare,
  applyDiamondMask,
  applyIsometricTransform,
  generateSizeVariants,
  generateSizeVariantsForDirectory,
  postProcessGenerated,
  postProcessTile,
  postProcessFlatTile,  // NEW: for flat texture -> isometric diamond
  postProcessPortrait,
  postProcessItem,
  postProcessIcon,
  postProcessNode,
  postProcessWall,
  postProcessSlope,
  postProcessByType,
  postProcessWithDualWrite
};
