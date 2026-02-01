/**
 * Python Script Runner
 * Spawns Python scripts from the image-generator project
 */

const { spawn } = require('child_process');
const path = require('path');
const { log, getProjectRoot, getImageGeneratorRoot } = require('./imageUtils');

/**
 * Python script execution result
 * @typedef {Object} PythonResult
 * @property {boolean} success - Whether execution succeeded
 * @property {number} exitCode - Process exit code
 * @property {string} stdout - Standard output
 * @property {string} stderr - Standard error
 * @property {string} command - Full command that was run
 */

/**
 * Run a Python generator script
 * @param {string} scriptName - Script name (e.g., 'generate_tile.py')
 * @param {string[]} args - Command line arguments
 * @param {Object} options - Additional options
 * @param {boolean} options.dryRun - If true, skip actual execution
 * @param {boolean} options.verbose - If true, stream output to console and pass --verbose to Python
 * @param {boolean} options.quiet - If true, suppress all output except errors
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - If true, use HuggingFace API (overrides local)
 * @param {number} options.delay - Delay in ms between requests (for rate limiting)
 * @returns {Promise<PythonResult>} Execution result
 */
async function runPythonScript(scriptName, args = [], options = {}) {
  const { dryRun = false, verbose = false, quiet = false, local = true, huggingface = false, loraModel = null } = options;

  // HuggingFace flag overrides local
  const useLocal = huggingface ? false : local;

  const generatorRoot = getImageGeneratorRoot();
  const scriptPath = path.join(generatorRoot, scriptName);
  const modiaRoot = getProjectRoot();

  // Build extended PATH to ensure conda/python are discoverable
  // This fixes ENOENT errors when spawning from environments without conda in PATH
  const homeDir = process.env.HOME || '/home/wizard';
  const condaBase = process.env.CONDA_PREFIX || `${homeDir}/miniconda3`;
  const extendedPath = `${condaBase}/bin:${condaBase}/condabin:${process.env.PATH || ''}`;

  // Build environment
  const env = {
    ...process.env,
    MODIA_ROOT: modiaRoot,
    PYTHONUNBUFFERED: '1',  // Ensure Python output is not buffered
    PATH: extendedPath
  };

  // Build full command for logging
  const fullArgs = ['--modia-root', modiaRoot, ...args];

  // Pass --verbose flag to Python script for detailed prompt construction output
  if (verbose) {
    fullArgs.push('--verbose');
  }

  // Pass --lora flag to Python script for LoRA model override
  if (loraModel) {
    fullArgs.push('--lora', loraModel);
  }

  // Determine if we should use conda environment for local ComfyUI generation
  const useCondaEnv = useLocal && !process.env.AI_IMAGE_PYTHON;
  const command = useCondaEnv
    ? `conda run -n image-gen-comfyui python ${scriptPath} ${fullArgs.join(' ')}`
    : `python3 ${scriptPath} ${fullArgs.join(' ')}`;

  if (dryRun) {
    log(`[DRY RUN] Would execute: ${command}`, 'info');
    return {
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      command
    };
  }

  // Always log the command being executed for visibility
  log(`Executing: ${command}`, 'info');

  // Use conda environment for local ComfyUI generation, otherwise system python
  let pythonCommand;
  let pythonArgs;

  if (useCondaEnv) {
    // Use conda environment for local ComfyUI generation
    pythonCommand = 'conda';
    pythonArgs = ['run', '-n', 'image-gen-comfyui', '--no-capture-output', 'python', scriptPath, ...fullArgs];
  } else {
    pythonCommand = process.env.AI_IMAGE_PYTHON || 'python3';
    pythonArgs = [scriptPath, ...fullArgs];
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCommand, pythonArgs, {
      env,
      cwd: generatorRoot
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // Stream output unless in quiet mode
      if (!quiet) {
        text.split('\n').forEach(line => {
          if (line.trim()) console.log(`  ${line}`);
        });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      // Always show stderr (errors) unless it's verbose logging that should be suppressed
      if (!quiet || text.includes('Error') || text.includes('error')) {
        text.split('\n').forEach(line => {
          if (line.trim()) console.error(`  [stderr] ${line}`);
        });
      }
    });

    proc.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        command
      });
    });

    proc.on('error', (error) => {
      console.error(`[pythonRunner] Spawn error for ${pythonCommand}:`, {
        command: pythonCommand,
        args: pythonArgs.slice(0, 3),
        cwd: generatorRoot,
        PATH: env.PATH?.split(':').slice(0, 5).join(':') + '...',
        error: error.message
      });
      reject(new Error(`Failed to spawn Python process: ${error.message}. Check AI_IMAGE_PYTHON env var or conda installation.`));
    });
  });
}

/**
 * Generate a tile using the Python generator
 * @param {Object} tileConfig - Tile configuration
 * @param {string} tileConfig.prompt - Terrain description
 * @param {string} tileConfig.key - Asset key/filename
 * @param {string} tileConfig.biome - Biome modifier
 * @param {string} tileConfig.outputDir - Override output directory
 * @param {number} tileConfig.seed - Random seed
 * @param {number} tileConfig.variants - Number of variants to generate
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateTile(tileConfig, options = {}) {
  const { prompt, key, biome = 'default', outputDir, seed = 42, variants = 1, loraModel } = tileConfig;
  const { local = true, huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--biome', biome,
    '--seed', String(seed ?? 42),
    '--variants', String(variants)
  ];

  // Pass explicit output directory if specified (e.g., for "base" biome tiles)
  if (outputDir) {
    args.push('--output-dir', outputDir);
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  // Pass LoRA model override if specified (config takes precedence over options)
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_tile.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate a wall texture using the Python generator
 * Walls are 64x16 pixel strips for elevation stacking
 * @param {Object} wallConfig - Wall configuration
 * @param {string} wallConfig.prompt - Wall texture description
 * @param {string} wallConfig.key - Asset key/filename
 * @param {string} wallConfig.biome - Biome modifier
 * @param {string} wallConfig.terrain - Terrain type (default, stone, etc.)
 * @param {string} wallConfig.outputPath - Explicit output path
 * @param {number} wallConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateWall(wallConfig, options = {}) {
  const { prompt, key, biome = 'default', terrain = 'default', outputPath, seed = 42, loraModel } = wallConfig;
  const { huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--biome', biome,
    '--seed', String(seed ?? 42),
    '--wall'  // Signal to Python that this is a wall texture
  ];

  // Pass explicit output path if specified
  if (outputPath) {
    args.push('--output-path', outputPath);
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (huggingface) {
    args.push('--huggingface');
  }

  // Pass LoRA model override if specified
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_tile.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate a portrait using the Python generator
 * @param {Object} portraitConfig - Portrait configuration
 * @param {string} portraitConfig.race - Character race (player only)
 * @param {string} portraitConfig.gender - Character gender (player only)
 * @param {string} portraitConfig.characterClass - Character class (player only)
 * @param {boolean} portraitConfig.isAdvanced - Whether this is an advanced class (player only)
 * @param {string} portraitConfig.prompt - Direct prompt for enemy/custom portraits
 * @param {string} portraitConfig.key - Asset key for enemy/custom portraits
 * @param {boolean} portraitConfig.isEnemy - Whether this is an enemy portrait
 * @param {number} portraitConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generatePortrait(portraitConfig, options = {}) {
  const { seed = 42, isEnemy = false, isAdvanced = false, loraModel } = portraitConfig;
  const { local = true, huggingface = false, verbose = false, quiet = false } = options;

  let args;

  if (isEnemy) {
    // Enemy portrait - use prompt/key mode
    // No --output-dir; Python resolves via --modia-root
    const { prompt, key } = portraitConfig;
    args = [
      '--prompt', prompt,
      '--key', key,
      '--seed', String(seed ?? 42)
    ];
  } else if (isAdvanced) {
    // Advanced class portrait - use prompt/key mode
    // (Python script only validates base classes: warrior, wizard, monk, chemist)
    const { prompt, key } = portraitConfig;
    args = [
      '--prompt', prompt,
      '--key', key,
      '--seed', String(seed ?? 42)
    ];
  } else {
    // Base class player portrait - use race/gender/class mode
    const { race, gender, characterClass } = portraitConfig;
    args = [
      '--race', race,
      '--gender', gender,
      '--class', characterClass,
      '--seed', String(seed ?? 42)
    ];
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  // Pass LoRA model override if specified (config takes precedence over options)
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_portrait.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate an icon using the Python generator
 * @param {Object} iconConfig - Icon configuration
 * @param {string} iconConfig.prompt - Icon description
 * @param {string} iconConfig.key - Asset key/filename
 * @param {string} iconConfig.category - Icon category
 * @param {number} iconConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateIcon(iconConfig, options = {}) {
  const { prompt, key, category = 'items', seed = 42, loraModel } = iconConfig;
  const { local = true, huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--category', category,
    '--seed', String(seed ?? 42)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  // Pass LoRA model override if specified (config takes precedence over options)
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_icon.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate an item sprite using the Python generator
 * @param {Object} itemConfig - Item configuration
 * @param {string} itemConfig.prompt - Item description
 * @param {string} itemConfig.key - Asset key/filename
 * @param {string} itemConfig.category - Item category
 * @param {number} itemConfig.seed - Random seed
 * @param {string} itemConfig.outputPath - Explicit output path (bypasses internal path logic)
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateItem(itemConfig, options = {}) {
  const { prompt, key, category = 'weapons', seed = 42, loraModel, outputPath } = itemConfig;
  const { local = true, huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--category', category,
    '--seed', String(seed ?? 42)
  ];

  // Pass explicit output path if provided (canonical path control)
  if (outputPath) {
    args.push('--output-path', outputPath);
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  // Pass LoRA model override if specified (config takes precedence over options)
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_item.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate a world map node using the Python generator
 * @param {Object} nodeConfig - Node configuration
 * @param {string} nodeConfig.prompt - Node description
 * @param {string} nodeConfig.key - Asset key/filename
 * @param {number} nodeConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateNode(nodeConfig, options = {}) {
  const { prompt, key, seed = 42, loraModel } = nodeConfig;
  const { local = true, huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--seed', String(seed ?? 42)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  // Pass LoRA model override if specified (config takes precedence over options)
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_node.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate an obstacle sprite using the Python generator
 * @param {Object} obstacleConfig - Obstacle configuration
 * @param {string} obstacleConfig.prompt - Obstacle description
 * @param {string} obstacleConfig.key - Asset key/filename
 * @param {string} obstacleConfig.category - Obstacle category ('rocks', 'trees', etc.)
 * @param {string} obstacleConfig.biome - Biome modifier (optional, default: 'default')
 * @param {number} obstacleConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateObstacle(obstacleConfig, options = {}) {
  const { prompt, key, category = 'decorations', biome = 'default', seed = 42, loraModel } = obstacleConfig;
  const { local = true, huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--category', category,
    '--biome', biome,
    '--seed', String(seed ?? 42)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  // Pass LoRA model override if specified (config takes precedence over options)
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_obstacle.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate an overlay sprite using the Python generator
 * @param {Object} overlayConfig - Overlay configuration
 * @param {string} overlayConfig.prompt - Overlay description
 * @param {string} overlayConfig.key - Asset key/filename
 * @param {string} overlayConfig.subcategory - Overlay subcategory ('rarity' or 'augments')
 * @param {number} overlayConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateOverlay(overlayConfig, options = {}) {
  const { prompt, key, subcategory = 'rarity', seed = 42, loraModel } = overlayConfig;
  const { local = true, huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--subcategory', subcategory,
    '--seed', String(seed ?? 42)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  // Pass LoRA model override if specified (config takes precedence over options)
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_overlay.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Run batch generation from a YAML config
 * @param {string} scriptName - Script name (e.g., 'generate_tile.py')
 * @param {string} configPath - Path to YAML config file
 * @param {Object} options - Additional options
 * @param {boolean} options.local - [DEPRECATED] Local is now default, this option is ignored
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function runBatchGeneration(scriptName, configPath, options = {}) {
  const { local = true, huggingface = false, verbose = false, quiet = false, loraModel = null } = options;
  const args = ['--batch', configPath];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script (local is now default)
  if (huggingface) {
    args.push('--huggingface');
  }
  // Note: --local flag is no longer needed as local ComfyUI is now the default

  return runPythonScript(scriptName, args, { ...options, verbose, quiet, loraModel });
}

/**
 * Remove background from an image using the Python rembg helper
 * @param {string} inputPath - Path to input image
 * @param {string} outputPath - Path to save output image (can be same as input to overwrite)
 * @param {Object} options - Additional options
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @param {string} options.model - rembg model name (default: isnet-general-use)
 * @returns {Promise<PythonResult>}
 */
async function removeBackground(inputPath, outputPath, options = {}) {
  const { verbose = false, quiet = false, model = null } = options;

  const generatorRoot = getImageGeneratorRoot();
  const scriptPath = path.join(generatorRoot, 'remove_bg.py');

  const fullArgs = ['--input', inputPath, '--output', outputPath];
  if (model) {
    fullArgs.push('--model', model);
  }
  if (verbose) {
    fullArgs.push('--verbose');
  }

  const useCondaEnv = !process.env.AI_IMAGE_PYTHON;
  const command = useCondaEnv
    ? `conda run -n image-gen-comfyui python ${scriptPath} ${fullArgs.join(' ')}`
    : `python3 ${scriptPath} ${fullArgs.join(' ')}`;

  // Always log the command being executed for visibility
  log(`Executing rembg: ${command}`, 'info');

  let pythonCommand;
  let pythonArgs;

  if (useCondaEnv) {
    pythonCommand = 'conda';
    pythonArgs = ['run', '-n', 'image-gen-comfyui', '--no-capture-output', 'python', scriptPath, ...fullArgs];
  } else {
    pythonCommand = process.env.AI_IMAGE_PYTHON || 'python3';
    pythonArgs = [scriptPath, ...fullArgs];
  }

  // Build extended PATH to ensure conda/python are discoverable
  const homeDir = process.env.HOME || '/home/wizard';
  const condaBase = process.env.CONDA_PREFIX || `${homeDir}/miniconda3`;
  const extendedPath = `${condaBase}/bin:${condaBase}/condabin:${process.env.PATH || ''}`;

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PATH: extendedPath
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCommand, pythonArgs, {
      env,
      cwd: generatorRoot
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (!quiet) {
        text.split('\n').forEach(line => {
          if (line.trim()) console.log(`  ${line}`);
        });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (!quiet || text.includes('Error') || text.includes('error')) {
        text.split('\n').forEach(line => {
          if (line.trim()) console.error(`  [stderr] ${line}`);
        });
      }
    });

    proc.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        command
      });
    });

    proc.on('error', (error) => {
      console.error(`[pythonRunner] Spawn error for rembg ${pythonCommand}:`, {
        command: pythonCommand,
        args: pythonArgs.slice(0, 3),
        cwd: generatorRoot,
        PATH: env.PATH?.split(':').slice(0, 5).join(':') + '...',
        error: error.message
      });
      reject(new Error(`Failed to spawn rembg process: ${error.message}. Check AI_IMAGE_PYTHON env var or conda installation.`));
    });
  });
}

/**
 * Generate a single character animation frame using the Python generator
 * Used to generate individual 64x64 frames that will be concatenated into sprite sheets
 *
 * @param {Object} frameConfig - Frame configuration
 * @param {string} frameConfig.prompt - Frame description including pose/action
 * @param {string} frameConfig.key - Output filename (without extension)
 * @param {string} frameConfig.characterType - 'player' or 'enemy'
 * @param {string} frameConfig.characterClass - Class name (warrior, wizard, etc.) for players
 * @param {string} frameConfig.biome - Biome for enemies (forest, cave, etc.)
 * @param {string} frameConfig.characterId - Character ID for enemies
 * @param {string} frameConfig.animation - Animation name (idle, walk, attack, etc.)
 * @param {number} frameConfig.frameIndex - Frame number (0-7)
 * @param {number} frameConfig.seed - Random seed (same seed for all frames in animation)
 * @param {string} frameConfig.outputPath - Explicit output path for the frame
 * @param {Object} options - Additional options
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @param {boolean} options.verbose - Enable verbose output
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<PythonResult>}
 */
async function generateCharacterFrame(frameConfig, options = {}) {
  const {
    prompt,
    key,
    characterType = 'player',
    characterClass,
    biome,
    characterId,
    animation,
    frameIndex,
    seed = 42,
    outputPath,
    loraModel
  } = frameConfig;
  const { huggingface = false, verbose = false, quiet = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--character-type', characterType,
    '--animation', animation,
    '--frame', String(frameIndex),
    '--seed', String(seed ?? 42)
  ];

  // Add type-specific arguments
  if (characterType === 'player' && characterClass) {
    args.push('--class', characterClass);
  } else if (characterType === 'enemy') {
    if (biome) args.push('--biome', biome);
    if (characterId) args.push('--character-id', characterId);
  }

  // Pass explicit output path if provided
  if (outputPath) {
    args.push('--output-path', outputPath);
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (huggingface) {
    args.push('--huggingface');
  }

  // Pass LoRA model override if specified
  const effectiveLoraModel = loraModel || options.loraModel;

  return runPythonScript('generate_character_frame.py', args, { ...options, verbose, quiet, loraModel: effectiveLoraModel });
}

/**
 * Generate a character animation using SD1.5 with ControlNet pose guidance and IP-Adapter
 * This is an alternative to the Flux-based frame generation for consistent multi-frame animations
 *
 * @param {Object} animationConfig - Animation configuration
 * @param {string} animationConfig.characterId - Character identifier (e.g., 'warrior', 'goblin_scout')
 * @param {string} animationConfig.animation - Animation name (idle, walk, attack, etc.)
 * @param {number} animationConfig.controlnetWeight - ControlNet pose weight (0.0-1.0, default 0.7)
 * @param {number} animationConfig.ipadapterWeight - IP-Adapter reference weight (0.0-1.0, default 0.4)
 * @param {string} animationConfig.referenceImage - Path to reference image for style consistency
 * @param {string} animationConfig.loraModel - Optional LoRA model override
 * @param {number} animationConfig.seed - Random seed for reproducibility
 * @param {string} animationConfig.outputPath - Explicit output path for the animation sheet
 * @param {string[]} animationConfig.frameDescriptions - Per-frame prompt variations for animation motion
 * @param {boolean} animationConfig.autoReference - Auto-generate reference image if missing (default false)
 * @param {Object} options - Additional options
 * @param {boolean} options.dryRun - If true, skip actual execution
 * @param {boolean} options.verbose - If true, stream output to console
 * @param {boolean} options.quiet - If true, suppress all output except errors
 * @returns {Promise<PythonResult>} Execution result
 */
async function generateAnimation(animationConfig, options = {}) {
  const {
    characterId,
    animation,
    controlnetWeight = 0.7,
    ipadapterWeight = 0.4,  // Reduced from 0.6 to allow more motion variation
    referenceImage,
    loraModel,
    seed = 42,
    outputPath,
    frameDescriptions = null,  // Per-frame prompt variations for animation motion
    autoReference = false  // Auto-generate reference image if missing
  } = animationConfig;
  const { verbose = false, quiet = false } = options;

  const args = [
    '--character', characterId,
    '--animation', animation,
    '--controlnet-weight', String(controlnetWeight),
    '--ipadapter-weight', String(ipadapterWeight),
    '--seed', String(seed)
  ];

  if (referenceImage) {
    args.push('--reference', referenceImage);
  }

  if (loraModel) {
    args.push('--lora', loraModel);
  }

  if (outputPath) {
    args.push('--output-path', outputPath);
  }

  // Pass frame descriptions as JSON for per-frame prompt variation
  if (frameDescriptions && Array.isArray(frameDescriptions) && frameDescriptions.length > 0) {
    args.push('--frame-descriptions', JSON.stringify(frameDescriptions));
  }

  // Auto-generate reference image if missing
  if (autoReference) {
    args.push('--auto-reference');
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  return runPythonScript('generate_animation.py', args, { ...options, verbose, quiet });
}

/**
 * Generate a reference image for SD1.5 animation generation
 * Creates a high-quality single frame to use as IP-Adapter reference
 *
 * Uses generate_animation.py with --reference-only flag to generate a reference
 * image using SD1.5 with ControlNet pose guidance for consistent style.
 *
 * @param {Object} referenceConfig - Reference image configuration
 * @param {string} referenceConfig.characterId - Character identifier
 * @param {string} referenceConfig.characterType - 'player' or 'enemy'
 * @param {string} referenceConfig.biome - Biome name for enemies
 * @param {string} referenceConfig.prompt - Full character description prompt
 * @param {number} referenceConfig.seed - Random seed for reproducibility
 * @param {string} referenceConfig.outputPath - Output path for the reference image (optional)
 * @param {string} referenceConfig.referencePose - Pose template: 'idle' (default), 'tpose', or custom path
 * @param {string} referenceConfig.loraModel - Optional LoRA model override
 * @param {number} referenceConfig.controlnetWeight - ControlNet weight (0.0-1.0, optional)
 * @param {number} referenceConfig.ipadapterWeight - IP-Adapter weight (0.0-1.0, optional)
 * @param {Object} options - Additional options
 * @param {boolean} options.dryRun - If true, skip actual execution
 * @param {boolean} options.verbose - If true, enable verbose output
 * @param {boolean} options.quiet - If true, suppress output
 * @returns {Promise<PythonResult>} Execution result
 */
async function generateReferenceImage(referenceConfig, options = {}) {
  const {
    characterId,
    characterType = 'player',
    biome,
    prompt,
    seed = 42,
    outputPath,
    referencePose = 'idle',
    loraModel,
    controlnetWeight,
    ipadapterWeight
  } = referenceConfig;
  const { verbose = false, quiet = false } = options;

  // Use generate_animation.py with --reference-only flag
  // Reference images should preserve background for better IP-Adapter style transfer
  const args = [
    '--character', characterId,
    '--reference-only',
    '--no-background-removal',
    '--reference-pose', referencePose,
    '--prompt', prompt,
    '--seed', String(seed)
  ];

  // Add output path if specified
  if (outputPath) {
    args.push('--output-path', outputPath);
  }

  // Add LoRA model if specified
  if (loraModel) {
    args.push('--lora', loraModel);
  }

  // Add character type
  args.push('--character-type', characterType);

  // Add biome for enemy characters
  if (characterType === 'enemy' && biome) {
    args.push('--biome', biome);
  }

  // Add ControlNet weight if specified
  if (controlnetWeight !== undefined) {
    args.push('--controlnet-weight', String(controlnetWeight));
  }

  // Add IP-Adapter weight if specified
  if (ipadapterWeight !== undefined) {
    args.push('--ipadapter-weight', String(ipadapterWeight));
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  if (verbose) {
    args.push('--verbose');
  }

  // Reference images are generated with SD1.5 via generate_animation.py
  return runPythonScript('generate_animation.py', args, { ...options, verbose, quiet });
}

module.exports = {
  runPythonScript,
  generateTile,
  generateWall,
  generatePortrait,
  generateIcon,
  generateItem,
  generateNode,
  generateObstacle,
  generateOverlay,
  runBatchGeneration,
  removeBackground,
  generateCharacterFrame,
  generateAnimation,
  generateReferenceImage
};
