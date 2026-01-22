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
 * @param {boolean} options.verbose - If true, stream output to console
 * @param {boolean} options.local - If true, use local ComfyUI (default: true)
 * @param {boolean} options.huggingface - If true, use HuggingFace API (overrides local)
 * @returns {Promise<PythonResult>} Execution result
 */
async function runPythonScript(scriptName, args = [], options = {}) {
  const { dryRun = false, verbose = false, local = true, huggingface = false } = options;

  // HuggingFace flag overrides local
  const useLocal = huggingface ? false : local;

  const generatorRoot = getImageGeneratorRoot();
  const scriptPath = path.join(generatorRoot, scriptName);
  const modiaRoot = getProjectRoot();

  // Build environment
  const env = {
    ...process.env,
    MODIA_ROOT: modiaRoot,
    PYTHONUNBUFFERED: '1'  // Ensure Python output is not buffered
  };

  // Build full command for logging
  const fullArgs = ['--modia-root', modiaRoot, ...args];

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

  if (verbose) {
    log(`Executing: ${command}`, 'debug');
  }

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
      if (verbose) {
        text.split('\n').forEach(line => {
          if (line.trim()) console.log(`  ${line}`);
        });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (verbose) {
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
      reject(new Error(`Failed to spawn Python process: ${error.message}`));
    });
  });
}

/**
 * Generate a tile using the Python generator
 * @param {Object} tileConfig - Tile configuration
 * @param {string} tileConfig.prompt - Terrain description
 * @param {string} tileConfig.key - Asset key/filename
 * @param {string} tileConfig.biome - Biome modifier
 * @param {number} tileConfig.seed - Random seed
 * @param {number} tileConfig.variants - Number of variants to generate
 * @param {Object} options - Additional options
 * @param {boolean} options.local - Use local ComfyUI (default: true)
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @returns {Promise<PythonResult>}
 */
async function generateTile(tileConfig, options = {}) {
  const { prompt, key, biome = 'default', seed = 42, variants = 1 } = tileConfig;
  const { local = true, huggingface = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--biome', biome,
    '--seed', String(seed),
    '--variants', String(variants)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script
  if (huggingface) {
    args.push('--huggingface');
  } else if (local) {
    args.push('--local');
  }

  return runPythonScript('generate_tile.py', args, options);
}

/**
 * Generate a portrait using the Python generator
 * @param {Object} portraitConfig - Portrait configuration
 * @param {string} portraitConfig.race - Character race
 * @param {string} portraitConfig.gender - Character gender
 * @param {string} portraitConfig.characterClass - Character class
 * @param {number} portraitConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - Use local ComfyUI (default: true)
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @returns {Promise<PythonResult>}
 */
async function generatePortrait(portraitConfig, options = {}) {
  const { race, gender, characterClass, seed = 42 } = portraitConfig;
  const { local = true, huggingface = false } = options;

  const args = [
    '--race', race,
    '--gender', gender,
    '--class', characterClass,
    '--seed', String(seed)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script
  if (huggingface) {
    args.push('--huggingface');
  } else if (local) {
    args.push('--local');
  }

  return runPythonScript('generate_portrait.py', args, options);
}

/**
 * Generate an icon using the Python generator
 * @param {Object} iconConfig - Icon configuration
 * @param {string} iconConfig.prompt - Icon description
 * @param {string} iconConfig.key - Asset key/filename
 * @param {string} iconConfig.category - Icon category
 * @param {number} iconConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - Use local ComfyUI (default: true)
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @returns {Promise<PythonResult>}
 */
async function generateIcon(iconConfig, options = {}) {
  const { prompt, key, category = 'items', seed = 42 } = iconConfig;
  const { local = true, huggingface = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--category', category,
    '--seed', String(seed)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script
  if (huggingface) {
    args.push('--huggingface');
  } else if (local) {
    args.push('--local');
  }

  return runPythonScript('generate_icon.py', args, options);
}

/**
 * Generate an item sprite using the Python generator
 * @param {Object} itemConfig - Item configuration
 * @param {string} itemConfig.prompt - Item description
 * @param {string} itemConfig.key - Asset key/filename
 * @param {string} itemConfig.category - Item category
 * @param {number} itemConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - Use local ComfyUI (default: true)
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @returns {Promise<PythonResult>}
 */
async function generateItem(itemConfig, options = {}) {
  const { prompt, key, category = 'weapons', seed = 42 } = itemConfig;
  const { local = true, huggingface = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--category', category,
    '--seed', String(seed)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script
  if (huggingface) {
    args.push('--huggingface');
  } else if (local) {
    args.push('--local');
  }

  return runPythonScript('generate_item.py', args, options);
}

/**
 * Generate a world map node using the Python generator
 * @param {Object} nodeConfig - Node configuration
 * @param {string} nodeConfig.prompt - Node description
 * @param {string} nodeConfig.key - Asset key/filename
 * @param {number} nodeConfig.seed - Random seed
 * @param {Object} options - Additional options
 * @param {boolean} options.local - Use local ComfyUI (default: true)
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @returns {Promise<PythonResult>}
 */
async function generateNode(nodeConfig, options = {}) {
  const { prompt, key, seed = 42 } = nodeConfig;
  const { local = true, huggingface = false } = options;

  const args = [
    '--prompt', prompt,
    '--key', key,
    '--seed', String(seed)
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script
  if (huggingface) {
    args.push('--huggingface');
  } else if (local) {
    args.push('--local');
  }

  return runPythonScript('generate_node.py', args, options);
}

/**
 * Run batch generation from a YAML config
 * @param {string} scriptName - Script name (e.g., 'generate_tile.py')
 * @param {string} configPath - Path to YAML config file
 * @param {Object} options - Additional options
 * @param {boolean} options.local - Use local ComfyUI (default: true)
 * @param {boolean} options.huggingface - Use HuggingFace API instead
 * @returns {Promise<PythonResult>}
 */
async function runBatchGeneration(scriptName, configPath, options = {}) {
  const { local = true, huggingface = false } = options;
  const args = ['--batch', configPath];

  if (options.dryRun) {
    args.push('--dry-run');
  }

  // Pass generation mode to Python script
  if (huggingface) {
    args.push('--huggingface');
  } else if (local) {
    args.push('--local');
  }

  return runPythonScript(scriptName, args, { ...options, verbose: true });
}

module.exports = {
  runPythonScript,
  generateTile,
  generatePortrait,
  generateIcon,
  generateItem,
  generateNode,
  runBatchGeneration
};
