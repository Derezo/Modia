import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm
} from 'node:fs/promises';
import path from 'node:path';

import {
  CANDIDATE_SCHEMA,
  DESCRIPTOR_SCHEMA_V2,
  RENDER_PROFILE,
  TIER_BANDS,
  assertV2DescriptorsPlanned,
  atomicWrite,
  candidatePaths,
  exactKeys,
  hashFile,
  inspectImage,
  inspectImageContents,
  loadBattleArt,
  loadReadinessPlan,
  readPinnedRegularFile,
  readJson,
  resolveTracked,
  selectFamilies,
  sha256,
  stableJson
} from './lifecycle.mjs';
import {
  normalizeGeneratedRasterBytes,
  validateRasterBytes
} from './raster-contract.mjs';
import {
  withBattleArtCandidateLock
} from './candidate-lock.mjs';

export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const MAX_TIMEOUT_MS = 1_800_000;
export const MAX_WORKER_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_CANDIDATE_BYTES = 32 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 48 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8192;
const ACTIVE_WORKER_GROUPS = new Set();
let workerSignalHandlersInstalled = false;
let workerShutdownSignal = null;

function signalWorkerGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function signalActiveWorkerGroups(signal) {
  for (const pid of ACTIVE_WORKER_GROUPS) signalWorkerGroup(pid, signal);
}

function installWorkerSignalHandlers() {
  if (workerSignalHandlersInstalled || process.platform === 'win32') return;
  workerSignalHandlersInstalled = true;
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (workerShutdownSignal !== null) return;
      workerShutdownSignal = signal;
      signalActiveWorkerGroups('SIGTERM');
      const killTimer = setTimeout(() => {
        signalActiveWorkerGroups('SIGKILL');
        process.removeListener(signal, handler);
        process.kill(process.pid, signal);
      }, 1_000);
    };
    process.on(signal, handler);
  }
  process.on('exit', () => signalActiveWorkerGroups('SIGKILL'));
}

export const CODEX_WORKER_ENV_KEYS = Object.freeze([
  'PATH',
  'HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy'
]);
const TEXT_STYLE_SUMMARIES = Object.freeze({
  forest:
    'Crisp high-contrast 16-bit fantasy pixel art with compact orthographic '
    + 'isometric forms, cool deep evergreen and moss tones, warm dirt and bark, '
    + 'restrained leaf litter, clustered edge pixels, and soft upper-left light.',
  cave:
    'Crisp 16-bit orthographic isometric cave art with readable mineral strata, '
    + 'restrained reflected color, clustered rock pixels, deep crevice accents, '
    + 'and consistent soft upper-left illumination.',
  mountain:
    'Crisp 16-bit orthographic isometric alpine art with strongly readable rock '
    + 'planes, sparse hardy vegetation, weathered edges, atmospheric cool shadows, '
    + 'and clean upper-left light.',
  bridge:
    'Crisp 16-bit orthographic isometric bridge art with legible structural '
    + 'masonry or timber, worn travel surfaces, restrained metalwork, and coherent '
    + 'upper-left lighting.',
  castle:
    'Crisp 16-bit orthographic isometric fortress art with dressed masonry, '
    + 'weathered joints, heraldic restraint, clear walkable surfaces, and soft '
    + 'upper-left light.',
  dungeon:
    'Crisp 16-bit orthographic isometric dungeon art with damp masonry, worn '
    + 'flagstones, restrained grime, readable edges, and controlled warm-cool '
    + 'upper-left illumination.',
  swamp:
    'Crisp 16-bit orthographic isometric wetland art with layered peat, reeds, '
    + 'roots, humid moss, muted reflected color, and readable upper-left light.',
  volcano:
    'Crisp 16-bit orthographic isometric volcanic art with basalt planes, ash, '
    + 'restrained ember glow, high heat contrast, and consistent upper-left form light.',
  plains:
    'Crisp 16-bit orthographic isometric grassland art with varied turf clumps, '
    + 'warm soil, sparse field details, soft organic transitions, and upper-left light.',
  arena:
    'Crisp 16-bit orthographic isometric arena art with durable combat surfaces, '
    + 'formal boundaries, restrained ornament, clean readability, and upper-left light.',
  guild:
    'Crisp 16-bit orthographic isometric guild-ground art with practical timber, '
    + 'stone, banners, worn training surfaces, and consistent upper-left light.',
  elven_grove:
    'Crisp 16-bit orthographic isometric elven-grove art with elegant living wood, '
    + 'luminous foliage, carved stone restraint, organic seams, and upper-left light.',
  dwarven_mine:
    'Crisp 16-bit orthographic isometric dwarven-mine art with hewn geology, robust '
    + 'supports, metal accents, clear strata, and warm-cool upper-left illumination.',
  vampiric_crypt:
    'Crisp 16-bit orthographic isometric crypt art with dark dressed stone, aged '
    + 'funerary details, restrained crimson accents, and dramatic upper-left light.',
  orcish_warcamp:
    'Crisp 16-bit orthographic isometric warcamp art with rugged timber, hide, iron, '
    + 'trampled ground, forceful silhouettes, and coherent upper-left light.',
  human_ruins:
    'Crisp 16-bit orthographic isometric ruin art with broken regional masonry, '
    + 'weathering, reclaiming vegetation, readable debris, and soft upper-left light.'
});
const ROUTE_DIRECTION_LABELS = Object.freeze({
  n: 'N upper-right',
  e: 'E lower-right',
  s: 'S lower-left',
  w: 'W upper-left'
});
const CORNER_PHYSICAL_SHAPES = Object.freeze({
  'corner-ne':
    'a rounded right-side hairpin between the upper-right and lower-right targets',
  'corner-es':
    'a rounded bottom-side hairpin between the lower-right and lower-left targets',
  'corner-sw':
    'a rounded left-side hairpin between the lower-left and upper-left targets',
  'corner-wn':
    'a rounded top-side hairpin between the upper-left and upper-right targets'
});

function routeDirectionsForTopology(topology) {
  if (topology === 'isolated') return [];
  if (topology === 'cross') return ['n', 'e', 's', 'w'];
  const directions = topology?.split('-')[1]?.split('') ?? [];
  if (
    directions.length === 0
    || directions.some(direction => !Object.hasOwn(ROUTE_DIRECTION_LABELS, direction))
  ) {
    throw new Error(`unsupported route topology ${topology}`);
  }
  return directions;
}

function positiveInteger(value, flag, maximum) {
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error(`${flag} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw new Error(`${flag} must be between 1 and ${maximum}`);
  }
  return number;
}

export function parseGenerateArgs(argv) {
  const options = {
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    force: false,
    resume: false,
    keepGoing: false,
    textStyleFallback: false
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? null : argument.slice(equals + 1);
    const value = () => {
      const result = inline ?? argv[++index];
      if (!result || result.startsWith('--')) throw new Error(`${flag} requires a value`);
      return result;
    };
    const once = (key, next) => {
      if (seen.has(flag)) throw new Error(`${flag} may only be provided once`);
      seen.add(flag);
      options[key] = next;
    };
    const repeat = (key, next) => {
      options[key] = [...(options[key] ?? []), next];
    };
    if (flag === '--theme') once('theme', value());
    else if (flag === '--family') repeat('families', value());
    else if (flag === '--ecology-profile') once('ecologyProfile', value());
    else if (flag === '--tier') {
      once('tier', positiveInteger(value(), flag, TIER_BANDS.at(-1)));
    }
    else if (flag === '--category') once('category', value());
    else if (flag === '--surface-variant') {
      const variant = value();
      if (!/^[0-7]$/.test(variant)) {
        throw new Error(`${flag} must be an integer from 0 through 7`);
      }
      once('surfaceVariant', Number(variant));
    }
    else if (flag === '--concurrency') once('concurrency', positiveInteger(value(), flag, MAX_CONCURRENCY));
    else if (flag === '--timeout') once('timeoutMs', positiveInteger(value(), flag, MAX_TIMEOUT_MS / 1000) * 1000);
    else if (flag === '--project-root') once('projectRoot', path.resolve(value()));
    else if (flag === '--dry-run' && inline === null) options.dryRun = true;
    else if (flag === '--force' && inline === null) options.force = true;
    else if (flag === '--resume' && inline === null) options.resume = true;
    else if (flag === '--keep-going' && inline === null) {
      options.keepGoing = true;
    }
    else if (flag === '--text-style-fallback' && inline === null) {
      options.textStyleFallback = true;
    }
    else throw new Error(`unknown generate argument ${argument}`);
  }
  if (options.force && options.resume) throw new Error('--force and --resume are mutually exclusive');
  return options;
}

export function buildCodexArgs(workspace, lastMessagePath, imagePaths = []) {
  return [
    'exec',
    '--ephemeral',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'workspace-write',
    '-C',
    workspace,
    ...imagePaths.flatMap(imagePath => ['--image', imagePath]),
    '-c',
    'model_reasoning_effort="low"',
    '-o',
    lastMessagePath,
    '-'
  ];
}

export function buildCodexWorkerEnvironment(source = process.env) {
  const environment = {};
  for (const key of CODEX_WORKER_ENV_KEYS) {
    if (typeof source[key] === 'string' && source[key].length > 0) {
      environment[key] = source[key];
    }
  }
  return environment;
}

export function runCommand({
  command,
  args,
  cwd,
  input,
  timeoutMs,
  maxOutputBytes = MAX_WORKER_OUTPUT_BYTES,
  spawnImpl = spawn,
  environmentSource = process.env
}) {
  return new Promise((resolve, reject) => {
    if (workerShutdownSignal !== null) {
      reject(new Error(
        `Codex worker launch refused during ${workerShutdownSignal} shutdown`
      ));
      return;
    }
    const detached = process.platform !== 'win32';
    const child = spawnImpl(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildCodexWorkerEnvironment(environmentSource),
      detached
    });
    const trackedWorker = detached
      && spawnImpl === spawn
      && Number.isSafeInteger(child.pid)
      && child.pid > 0;
    if (trackedWorker) {
      installWorkerSignalHandlers();
      ACTIVE_WORKER_GROUPS.add(child.pid);
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let forcedError = null;
    let killTimer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (trackedWorker) ACTIVE_WORKER_GROUPS.delete(child.pid);
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      callback(value);
    };
    const signalWorker = signal => {
      if (detached && Number.isSafeInteger(child.pid) && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      child.kill(signal);
    };
    const stopWorker = error => {
      if (forcedError !== null) return;
      forcedError = error;
      signalWorker('SIGTERM');
      killTimer = setTimeout(() => signalWorker('SIGKILL'), 1_000);
      killTimer.unref();
    };
    const overLimit = stream => {
      stopWorker(new Error(`${stream} exceeded ${maxOutputBytes} bytes`));
    };
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) overLimit('worker stdout');
      else if (forcedError === null) stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutputBytes) overLimit('worker stderr');
      else if (forcedError === null) stderr.push(chunk);
    });
    child.once('error', error => {
      if (forcedError === null) finish(reject, error);
    });
    child.once('close', (code, signal) => {
      if (forcedError !== null) {
        finish(reject, forcedError);
      } else if (timedOut) {
        finish(reject, new Error(`Codex worker timed out after ${timeoutMs}ms`));
      } else if (code !== 0) {
        finish(reject, new Error(
          `Codex worker ${signal ? `terminated by ${signal}` : `exited with code ${code}`}`
        ));
      } else {
        finish(resolve, {
          code,
          signal,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr)
        });
      }
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stopWorker(new Error(`Codex worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdin.once('error', error => {
      if (error.code !== 'EPIPE') finish(reject, error);
    });
    child.stdin.end(`${input}\n`);
  });
}

export async function spawnCodexWorker({
  workspace,
  prompt,
  timeoutMs,
  styleFiles = []
}) {
  const lastMessagePath = path.join(workspace, 'last-message.txt');
  const args = buildCodexArgs(
    workspace,
    lastMessagePath,
    styleFiles.map(file => path.join(workspace, file))
  );
  const result = await runCommand({
    command: 'codex',
    args,
    cwd: workspace,
    input: prompt,
    timeoutMs
  });
  return { ...result, command: 'codex', args };
}

export function buildGenerationPrompt({
  descriptor,
  profile,
  styleFiles,
  textStyleFallback = false
}) {
  const rasterInstruction = descriptor.rasterContract.kind === 'opaque-tile-diamond'
    ? `For the opaque-tile-diamond contract, the final ${descriptor.canvas.width}x`
      + `${descriptor.canvas.height} alpha mask must set alpha 255 for every integer pixel `
      + 'satisfying abs(x-(W-1)/2)/(W/2) + abs(y-(H-1)/2)/(H/2) <= 1, '
      + 'and alpha 0 outside that diamond. Apply this deterministic mask locally after '
      + 'the single generation call.'
    : 'For the transparent-cutout contract, remove the uniform chroma completely, keep '
      + 'all subject pixels inside drawBounds, preserve transparent canvas corners, and '
      + 'place the finished subject on the declared canvas without adding background art.';
  const styleInstruction = textStyleFallback
    ? `The hash-pinned style binary remains staged for audit only. Do not open it and do not
pass any local image path to imagegen. Use this reviewed textual style authority instead:
${TEXT_STYLE_SUMMARIES[descriptor.theme] ?? `Distinct ${descriptor.theme} 16-bit fantasy isometric battle-map art.`}
Local image-view tools are unavailable in this restricted worker. Do not call them on the
candidate; verify dimensions, alpha, bounds, and topology with local metadata/raster code.`
    : `Inspect the following hash-verified style references before generation:
${styleFiles.map(file => `- ${file}`).join('\n')}`;
  const { anchor } = descriptor.placement;
  const sourceHalfTile = {
    x: RENDER_PROFILE.tileWidth * RENDER_PROFILE.sourcePixelScale / 2,
    y: RENDER_PROFILE.tileHeight * RENDER_PROFILE.sourcePixelScale / 2
  };
  const connectionVector = {
    n: { x: sourceHalfTile.x, y: -sourceHalfTile.y, edge: 'upper-right' },
    e: { x: sourceHalfTile.x, y: sourceHalfTile.y, edge: 'lower-right' },
    s: { x: -sourceHalfTile.x, y: sourceHalfTile.y, edge: 'lower-left' },
    w: { x: -sourceHalfTile.x, y: -sourceHalfTile.y, edge: 'upper-left' }
  }[descriptor.capabilities?.direction];
  const connectionTarget = connectionVector
    ? {
        x: Math.max(
          0,
          Math.min(descriptor.canvas.width - 1, anchor.x + connectionVector.x)
        ),
        y: Math.max(
          0,
          Math.min(descriptor.canvas.height - 1, anchor.y + connectionVector.y)
        )
      }
    : null;
  const routeTargets = {
    n: {
      x: anchor.x + (sourceHalfTile.x / 2),
      y: anchor.y - (sourceHalfTile.y / 2)
    },
    e: {
      x: anchor.x + (sourceHalfTile.x / 2),
      y: anchor.y + (sourceHalfTile.y / 2)
    },
    s: {
      x: anchor.x - (sourceHalfTile.x / 2),
      y: anchor.y + (sourceHalfTile.y / 2)
    },
    w: {
      x: anchor.x - (sourceHalfTile.x / 2),
      y: anchor.y - (sourceHalfTile.y / 2)
    }
  };
  const routeTopology = descriptor.capabilities?.routeTopology;
  const routeDirections = routeTopology
    ? routeDirectionsForTopology(routeTopology)
    : null;
  const routeEndpointInstruction = routeDirections
    ? (
        routeDirections.length === 0
          ? `This is the isolated topology: keep all four endpoint bands clear. `
            + `The path wear may occupy only the central anchor neighborhood around `
            + `${anchor.x},${anchor.y}.`
          : `Treat the topology letters literally. The only allowed route endpoint `
            + `bands for ${routeTopology} are `
            + `${routeDirections.map(direction => (
              `${ROUTE_DIRECTION_LABELS[direction]} at `
              + `${routeTargets[direction].x},${routeTargets[direction].y}`
            )).join(' and ')}. Keep these named bands visibly connected to the `
            + `${anchor.x},${anchor.y} center. Keep the forbidden `
            + `${['n', 'e', 's', 'w']
              .filter(direction => !routeDirections.includes(direction))
              .map(direction => (
                `${ROUTE_DIRECTION_LABELS[direction]} at `
                + `${routeTargets[direction].x},${routeTargets[direction].y}`
              )).join(', ') || 'none'} bands completely clear. Do not substitute a `
            + `different corner or rotate the declared topology during placement.`
      )
    : '';
  const boundaryPoint = (x, y) => ({
    x: Math.max(0, Math.min(descriptor.canvas.width - 1, x)),
    y: Math.max(0, Math.min(descriptor.canvas.height - 1, y))
  });
  const boundaryVertices = {
    top: boundaryPoint(anchor.x, anchor.y - sourceHalfTile.y),
    right: boundaryPoint(anchor.x + sourceHalfTile.x, anchor.y),
    bottom: boundaryPoint(anchor.x, anchor.y + sourceHalfTile.y),
    left: boundaryPoint(anchor.x - sourceHalfTile.x, anchor.y)
  };
  const boundarySegments = {
    n: [boundaryVertices.top, boundaryVertices.right],
    e: [boundaryVertices.right, boundaryVertices.bottom],
    s: [boundaryVertices.bottom, boundaryVertices.left],
    w: [boundaryVertices.left, boundaryVertices.top]
  };
  const boundaryPhysicalLabels = {
    n: 'upper-right diagonal, descending right from the top vertex',
    e: 'lower-right diagonal, descending left from the right vertex',
    s: 'lower-left diagonal, ascending left from the bottom vertex',
    w: 'upper-left diagonal, ascending right from the left vertex'
  };
  const boundarySegment =
    boundarySegments[descriptor.capabilities?.direction] ?? null;
  const boundarySubjectInstruction = descriptor.id.includes('canopy-edge')
    ? 'This is the canopy-edge subfamily: include a layered line of the regional '
      + 'tree species, roots, and understory above the grounded strip. The '
      + 'connected forest wall must span at least half the canvas width, rise '
      + 'through at least 40% of the canvas height, and carry dense overlapping '
      + 'crowns rather than one tiny tree clump.'
    : descriptor.id.includes('earth-face')
      ? 'This is the earth-face subfamily: depict only a low exposed soil-and-root '
        + 'profile with moss and small stones. Add no standing tree, trunk, tall '
        + 'shrub, or canopy; keep the silhouette below the anchor-to-canvas-top '
        + 'midpoint so it layers beneath separate canopy art. The connected face '
        + 'must span at least 45% of the canvas width, occupy at least 25% of its '
        + 'height, and contain a substantial blended soil profile rather than a '
        + 'single hairline fringe. Use only muted russet soil, olive moss, natural '
        + 'brown roots, and slate-gray stone; use no magenta, purple, or pink pixels.'
      : '';
  const directionalConnectionInstruction = connectionTarget
    ? `After chroma removal, keep the low end in contact with anchor `
      + `${anchor.x},${anchor.y} and extend one connected walkable subject toward `
      + `the declared ${descriptor.capabilities.direction} ${connectionVector.edge} `
      + `high endpoint at ${connectionTarget.x},${connectionTarget.y}. Make the alpha `
      + 'silhouette reach that terminal endpoint band and none of the other three '
      + 'directional endpoint bands.'
    : '';
  const routeShapeInstruction = descriptor.capabilities?.routeTopology?.startsWith(
    'corner-'
  )
    ? ` Physically draw ${CORNER_PHYSICAL_SHAPES[routeTopology]}. Form one `
      + 'asymmetric 48–64 pixel wide oval central wear basin, then curve both '
      + 'arms tangentially into different sides of that basin. The center must '
      + 'remain broad and round, never a point. Never use two straight arms '
      + 'forming a V, chevron, acute cusp, or ruler-clean angle.'
    : '';
  const finishingInstruction = {
    'blocking-obstacle':
      `After chroma removal, measure the alpha bounds and translate the subject so `
      + `its lowest visible pixel is within 16 pixels of y=${anchor.y} and visible `
      + `pixels contact the ${anchor.x},${anchor.y} anchor neighborhood. Keep an `
      + 'organic root, soil, or stone footprint with transparency between outward '
      + 'roots and tufts. Add no square or diamond ground tile, rectangular base, '
      + 'plinth, slab, platform, presentation card, or cutout panel.',
    'nonblocking-decoration':
      `After chroma removal, measure the alpha bounds and translate the subject so `
      + `its lowest visible pixel is within 16 pixels of y=${anchor.y} and visible `
      + `pixels contact the ${anchor.x},${anchor.y} anchor neighborhood.`,
    'exposed-face-boundary':
      boundarySegment
        ? `Pixel axes are authoritative: x increases right and y increases `
          + `downward. Ground the root/soil base only on the `
          + `${boundaryPhysicalLabels[descriptor.capabilities.direction]}: the `
          + `declared ${descriptor.capabilities.direction} edge from `
          + `${boundarySegment[0].x},${boundarySegment[0].y} to `
          + `${boundarySegment[1].x},${boundarySegment[1].y}. After chroma removal, `
          + `keep a continuous grounded strip along the first, middle, and last `
          + `thirds of that segment. ${boundarySubjectInstruction} The `
          + `${anchor.x},${anchor.y} pivot is placement metadata and need not be `
          + 'covered; do not bend the grounded strip away from its declared edge '
          + 'to reach it. No grounded base may follow any of the other three edges; '
          + 'never mirror or rotate the declared diagonal. '
          + 'Trunks, branches, and crown foliage may overhang other edge bands; '
          + 'do not crop or flatten tall canopy merely to keep its overhead alpha '
          + 'inside the grounded edge. Keep one unbroken natural silhouette with '
          + 'no vertical slice seam, rectangular panel, crop bar, repeated strip, '
          + 'or abrupt internal cut line.'
        : `After chroma removal, keep the low legacy face horizontally broad, `
          + `below the upper draw band, and connected to the ${anchor.x},`
          + `${anchor.y} anchor neighborhood.`,
    'connection-stairs': directionalConnectionInstruction,
    'connection-slope': directionalConnectionInstruction,
    'route-transition':
      `${routeEndpointInstruction} After chroma removal, keep one connected path `
      + `silhouette that reaches the `
      + `declared diamond edge bands and contacts the ${anchor.x},${anchor.y} `
      + `anchor neighborhood.${routeShapeInstruction}`
  }[descriptor.category] ?? '';
  return `${profile.prompt}

Frozen descriptor:
${stableJson(descriptor).trim()}

Frozen family art direction:
${descriptor.generationPrompt}

The descriptor rasterContract is a hard acceptance requirement. Use deterministic local
chroma removal, crop/scale, alpha masking, and canvas placement after the single imagegen
call as needed to satisfy it exactly; do not invent or repaint content during finishing.
${rasterInstruction}
${finishingInstruction}

Negative constraints:
${profile.negativeConstraints.map(value => `- ${value}`).join('\n')}

The descriptor and hash-verified style references are staged read-only by contract in this
disposable workspace:
- descriptor.json
- prompt-profile.json
${styleFiles.map(file => `- ${file}`).join('\n')}

${styleInstruction}

Use the imagegen skill and call the imagegen tool exactly once for this family. Write exactly
one candidate.png or candidate.webp in the
workspace root. Create no directory and no other file. Do not approve, pin, compile, publish,
or alter descriptor/style inputs. The one candidate must depict only family
"${descriptor.id}" for theme "${descriptor.theme}" and category "${descriptor.category}".
After the file is saved and deterministic metadata/raster checks pass, report the result and
end immediately. Do not reopen, visually inspect, revise, reprocess, or continue analyzing
the accepted candidate.`.trim();
}

export function countImagegenInvocations(stdout) {
  const eventCalls = new Set();
  const artifactCalls = new Set();
  const source = Buffer.from(stdout ?? '').toString('utf8');
  const lines = source.split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Codex worker stdout line ${index + 1} is not valid JSONL`);
    }
    const item = event?.item && typeof event.item === 'object' ? event.item : event;
    const recordType = String(item?.type ?? event?.type ?? '').toLowerCase();
    const toolIdentity = [
      item?.server,
      item?.tool,
      item?.name,
      item?.tool_name,
      item?.function?.name
    ].filter(Boolean).join(':').toLowerCase();
    if ((recordType.includes('tool') || recordType.includes('function'))
      && toolIdentity.includes('imagegen')) {
      eventCalls.add(String(item.id ?? item.call_id ?? event.call_id ?? `line:${index}`));
    }
  }
  // Current Codex JSONL can intentionally suppress built-in image-generation
  // tool events. Its project-save command still carries the immutable
  // per-call artifact path. Count distinct call identities from that evidence
  // only when no explicit tool events were emitted.
  for (const match of source.matchAll(
    /(?:^|[/\\])generated_images[/\\][^/\\\s"'`]+[/\\](call_[A-Za-z0-9_-]+)\.(?:png|webp|jpe?g)\b/g
  )) {
    artifactCalls.add(match[1]);
  }
  return eventCalls.size > 0 ? eventCalls.size : artifactCalls.size;
}

async function workspaceSnapshot(directory) {
  const result = new Map();
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`workspace contains symlink ${entry.name}`);
    if (!entry.isFile()) throw new Error(`workspace contains non-file ${entry.name}`);
    result.set(entry.name, {
      bytes: stat.size,
      sha256: await hashFile(absolute)
    });
  }
  return result;
}

function auditWorkspace(before, after, inputFiles) {
  let totalBytes = 0;
  for (const [name, record] of after) {
    totalBytes += record.bytes;
    const original = before.get(name);
    if (original) {
      if (original.bytes !== record.bytes || original.sha256 !== record.sha256) {
        throw new Error(`worker modified frozen input ${name}`);
      }
    } else if (!['candidate.png', 'candidate.webp', 'last-message.txt'].includes(name)) {
      throw new Error(`worker created undeclared output ${name}`);
    }
  }
  for (const input of inputFiles) {
    if (!after.has(input)) throw new Error(`worker removed frozen input ${input}`);
  }
  if (totalBytes > MAX_WORKSPACE_BYTES) throw new Error('worker workspace exceeded byte limit');
  const candidates = ['candidate.png', 'candidate.webp'].filter(name => after.has(name));
  if (candidates.length !== 1) {
    throw new Error(`worker must create exactly one candidate image; found ${candidates.length}`);
  }
  return candidates[0];
}

async function readAuditedWorkerFile(workspace, after, name) {
  const record = after.get(name);
  if (!record) return null;
  if (record.bytes > MAX_WORKER_OUTPUT_BYTES) {
    throw new Error(`${name} exceeds worker log limit`);
  }
  const contents = await readFile(path.join(workspace, name));
  if (
    contents.length !== record.bytes
    || sha256(contents) !== record.sha256
  ) {
    throw new Error(`${name} changed after workspace audit`);
  }
  return contents;
}

async function loadCandidate(root, descriptor, descriptorPath, paths) {
  let candidate;
  try {
    ({ value: candidate } = await readJson(root, paths.metadata, 'candidate metadata'));
  } catch (error) {
    if (error.message.includes('ENOENT')) return null;
    throw error;
  }
  exactKeys(candidate, [
    'schemaVersion',
    'familyId',
    'theme',
    'descriptorPath',
    'descriptorSha256',
    'promptProfile',
    'styleReferences',
    'image',
    'worker',
    'status'
  ], 'candidate metadata');
  if (candidate.schemaVersion !== CANDIDATE_SCHEMA
    || candidate.familyId !== descriptor.id
    || candidate.theme !== descriptor.theme
    || candidate.descriptorPath !== descriptorPath
    || candidate.descriptorSha256 !== sha256(Buffer.from(stableJson(descriptor)))
    || stableJson(candidate.promptProfile) !== stableJson(descriptor.promptProfile)
    || stableJson(candidate.styleReferences) !== stableJson(descriptor.styleReferences)
    || candidate.status !== 'candidate-awaiting-review') {
    throw new Error(`${descriptor.id} candidate frozen pins are stale`);
  }
  const candidateBytes = await readPinnedRegularFile(
    root,
    candidate.image.path,
    candidate.image.sha256,
    `${descriptor.id} existing candidate`
  );
  const image = await inspectImageContents(candidate.image.path, candidateBytes);
  if (stableJson(image) !== stableJson(candidate.image)) throw new Error(`${descriptor.id} candidate image pin mismatch`);
  return candidate;
}

async function cleanCandidateFiles(root, paths) {
  for (const relative of [
    paths.imagePng,
    paths.imageWebp,
    paths.metadata,
    paths.prompt,
    paths.stdout,
    paths.stderr,
    paths.lastMessage
  ]) {
    await rm(resolveTracked(root, relative), { force: true, recursive: false });
  }
}

async function cleanCandidatePublication(root, paths) {
  for (const relative of [
    paths.imagePng,
    paths.imageWebp,
    paths.metadata
  ]) {
    await rm(resolveTracked(root, relative), { force: true, recursive: false });
  }
}

async function inspectCandidateDisposition({
  loaded,
  entry,
  paths,
  options
}) {
  if (entry.descriptor.status !== 'draft') {
    throw new Error(
      `${entry.descriptor.id} is ${entry.descriptor.status}; `
      + 'archive and publish a new descriptor revision before regeneration'
    );
  }
  let existing;
  try {
    existing = await loadCandidate(
      loaded.root,
      entry.descriptor,
      entry.path,
      paths
    );
  } catch (error) {
    if (!options.force) throw error;
    existing = null;
  }
  if (existing && options.resume) {
    return {
      result: {
        family: entry.descriptor.id,
        status: 'skipped-complete',
        image: existing.image
      },
      shouldGenerate: false
    };
  }
  if (existing && !options.force) {
    throw new Error(
      `${entry.descriptor.id} candidate exists; use --resume or --force`
    );
  }
  return { result: null, shouldGenerate: true };
}

async function stageInputs(root, workspace, descriptor, profile) {
  const inputs = ['descriptor.json', 'prompt-profile.json'];
  await atomicWrite(workspace, 'descriptor.json', stableJson(descriptor));
  await atomicWrite(workspace, 'prompt-profile.json', stableJson(profile));
  const styleFiles = [];
  for (let index = 0; index < descriptor.styleReferences.length; index += 1) {
    const pin = descriptor.styleReferences[index];
    const extension = path.extname(pin.path).toLowerCase();
    const name = `style-reference-${String(index + 1).padStart(2, '0')}${extension}`;
    const bytes = await readPinnedRegularFile(
      root,
      pin.path,
      pin.sha256,
      `${pin.id} style reference`
    );
    await atomicWrite(workspace, name, bytes);
    inputs.push(name);
    styleFiles.push(name);
  }
  return { inputs, styleFiles };
}

async function generateOne({ loaded, entry, profile, options, worker }) {
  const descriptor = entry.descriptor;
  const paths = candidatePaths(descriptor);
  const candidateDirectory = resolveTracked(loaded.root, paths.directory, 'candidate directory');
  await mkdir(candidateDirectory, { recursive: true });
  const workspace = await mkdtemp(path.join(candidateDirectory, '.workspace-'));
  try {
    const staged = await stageInputs(loaded.root, workspace, descriptor, profile);
    const before = await workspaceSnapshot(workspace);
    const prompt = buildGenerationPrompt({
      descriptor,
      profile,
      styleFiles: staged.styleFiles,
      textStyleFallback: options.textStyleFallback
    });
    const result = await worker({
      workspace,
      prompt,
      timeoutMs: options.timeoutMs,
      descriptor,
      styleFiles: options.textStyleFallback ? [] : staged.styleFiles
    });
    if (Buffer.byteLength(result.stdout ?? Buffer.alloc(0)) > MAX_WORKER_OUTPUT_BYTES
      || Buffer.byteLength(result.stderr ?? Buffer.alloc(0)) > MAX_WORKER_OUTPUT_BYTES) {
      throw new Error('worker output exceeded the bounded log limit');
    }
    const after = await workspaceSnapshot(workspace);
    const candidateName = auditWorkspace(before, after, staged.inputs);
    const lastMessage = await readAuditedWorkerFile(
      workspace,
      after,
      'last-message.txt'
    );
    // Preserve bounded diagnostic evidence only after the disposable workspace
    // has passed symlink, mutation, membership, and byte-limit auditing.
    const logEntries = [
      [paths.prompt, `${prompt}\n`],
      [paths.stdout, result.stdout ?? Buffer.alloc(0)],
      [paths.stderr, result.stderr ?? Buffer.alloc(0)],
      ...(lastMessage === null ? [] : [[paths.lastMessage, lastMessage]])
    ];
    for (const [relative, contents] of logEntries) {
      if (Buffer.byteLength(contents) > MAX_WORKER_OUTPUT_BYTES) {
        throw new Error(`${relative} exceeds worker log limit`);
      }
      await atomicWrite(loaded.root, relative, contents);
    }
    const invocationCount = countImagegenInvocations(result.stdout);
    if (invocationCount !== 1) {
      throw new Error(`worker must call imagegen exactly once; observed ${invocationCount}`);
    }
    const workspaceCandidate = path.join(workspace, candidateName);
    const generatedBytes = await readFile(workspaceCandidate);
    if (generatedBytes.length > MAX_CANDIDATE_BYTES) {
      throw new Error(`${descriptor.id} candidate exceeds byte limit`);
    }
    const imageMetadata = await import('sharp').then(({ default: sharp }) =>
      sharp(generatedBytes, { failOn: 'error' }).metadata()
    );
    if (!['png', 'webp'].includes(imageMetadata.format)
      || !Number.isSafeInteger(imageMetadata.width)
      || !Number.isSafeInteger(imageMetadata.height)
      || imageMetadata.width > MAX_IMAGE_DIMENSION
      || imageMetadata.height > MAX_IMAGE_DIMENSION) {
      throw new Error(`${descriptor.id} candidate image contract is invalid`);
    }
    const candidateBytes = await normalizeGeneratedRasterBytes({
      bytes: generatedBytes,
      descriptor,
      profile,
      format: imageMetadata.format,
      label: `${descriptor.id} generated candidate`
    });
    if (candidateBytes.length > MAX_CANDIDATE_BYTES) {
      throw new Error(`${descriptor.id} normalized candidate exceeds byte limit`);
    }
    await validateRasterBytes({
      bytes: candidateBytes,
      descriptor,
      profile,
      label: `${descriptor.id} generated candidate`
    });
    const imageRelative = candidateName.endsWith('.png') ? paths.imagePng : paths.imageWebp;
    await atomicWrite(loaded.root, imageRelative, candidateBytes);
    const image = await inspectImage(loaded.root, imageRelative);
    const candidate = {
      schemaVersion: CANDIDATE_SCHEMA,
      familyId: descriptor.id,
      theme: descriptor.theme,
      descriptorPath: entry.path,
      descriptorSha256: sha256(Buffer.from(stableJson(descriptor))),
      promptProfile: structuredClone(descriptor.promptProfile),
      styleReferences: structuredClone(descriptor.styleReferences),
      image,
      worker: {
        command: 'codex',
        args: result.args ?? [],
        ephemeral: true,
        invocationCount,
        timeoutMs: options.timeoutMs,
        promptPath: paths.prompt,
        stdoutPath: paths.stdout,
        stderrPath: paths.stderr,
        lastMessagePath: logEntries.some(([relative]) => relative === paths.lastMessage)
          ? paths.lastMessage
          : null
      },
      status: 'candidate-awaiting-review'
    };
    await atomicWrite(loaded.root, paths.metadata, stableJson(candidate));
    return { family: descriptor.id, status: 'generated', image };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runPool(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  return results;
}

export async function generateBattleArt(options, { worker = spawnCodexWorker } = {}) {
  const loaded = await loadBattleArt(options.projectRoot);
  const selected = selectFamilies(loaded, options);
  if (selected.some(entry => (
    entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
  ))) {
    const readiness = await loadReadinessPlan(loaded.root);
    assertV2DescriptorsPlanned(selected, readiness.plan);
  }
  const jobs = [];
  const results = [];
  if (options.dryRun) {
    for (const entry of selected) {
      const paths = candidatePaths(entry.descriptor);
      const disposition = await inspectCandidateDisposition({
        loaded,
        entry,
        paths,
        options
      });
      if (disposition.shouldGenerate) jobs.push({ entry, paths });
      else results.push(disposition.result);
    }
  }
  const plan = {
    ok: true,
    dryRun: options.dryRun,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    jobs: jobs.map(job => ({
      family: job.entry.descriptor.id,
      theme: job.entry.descriptor.theme,
      outputDirectory: job.paths.directory
    })),
    results
  };
  if (options.dryRun) return plan;
  const requestedJobs = selected.map(entry => ({
    entry,
    paths: candidatePaths(entry.descriptor)
  }));
  const generated = await runPool(
    requestedJobs,
    options.concurrency,
    async job => {
      try {
        return await withBattleArtCandidateLock({
          root: loaded.root,
          theme: job.entry.descriptor.theme,
          family: job.entry.descriptor.id
        }, async () => {
          const lockedLoaded = await loadBattleArt(loaded.root);
          const [lockedEntry] = selectFamilies(lockedLoaded, {
            theme: job.entry.descriptor.theme,
            family: job.entry.descriptor.id
          });
          const lockedPaths = candidatePaths(lockedEntry.descriptor);
          const disposition = await inspectCandidateDisposition({
            loaded: lockedLoaded,
            entry: lockedEntry,
            paths: lockedPaths,
            options
          });
          if (!disposition.shouldGenerate) return disposition.result;
          if (options.force || options.resume) {
            await cleanCandidateFiles(lockedLoaded.root, lockedPaths);
          }
          try {
            return await generateOne({
              loaded: lockedLoaded,
              entry: lockedEntry,
              profile: lockedLoaded.promptProfile,
              options,
              worker
            });
          } catch (error) {
            await cleanCandidatePublication(lockedLoaded.root, lockedPaths);
            throw error;
          }
        });
      } catch (error) {
        if (!options.keepGoing) throw error;
        return {
          family: job.entry.descriptor.id,
          status: 'failed',
          error: error.message
        };
      }
    }
  );
  return {
    ...plan,
    ok: generated.every(entry => entry.status !== 'failed'),
    jobs: generated
      .filter(entry => entry.status === 'generated')
      .map(entry => {
        const requested = requestedJobs.find(
          job => job.entry.descriptor.id === entry.family
        );
        return {
          family: entry.family,
          theme: requested.entry.descriptor.theme,
          outputDirectory: requested.paths.directory
        };
      }),
    results: generated
  };
}
