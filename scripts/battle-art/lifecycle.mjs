import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, readFileSync } from 'node:fs';
import {
  access,
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  computeTemplateMapAssetBundleManifestFullHash
} from '../../shared/battleMap/v3/compiler.js';
import {
  hashCanonicalV3Value
} from '../../shared/battleMap/v3/hashes.js';
import {
  measureDirectGeometryPrimeRaster,
  normalizeGeneratedRasterBytes,
  prepareRuntimeRaster,
  validateRasterBytes,
  validateRuntimeAlphaParity
} from './raster-contract.mjs';
import {
  finishRouteArtifact,
  validateFinishedRouteArtifact
} from './finish-route-artifact.mjs';
import {
  withBattleArtCandidateLock,
  withBattleArtManifestAndCandidateLock,
  withBattleArtManifestLock
} from './candidate-lock.mjs';
import {
  auditCodexWorkerJsonl,
  verifyCodexImagegenEvidence
} from '../battle-maps/codex-worker-boundary.mjs';
import {
  auditCanonicalParentRouteHandoffJsonl
} from './worker-contract.mjs';

export const THEMES = Object.freeze([
  'forest',
  'cave',
  'mountain',
  'bridge',
  'castle',
  'dungeon',
  'swamp',
  'volcano',
  'plains',
  'arena',
  'guild',
  'elven_grove',
  'dwarven_mine',
  'vampiric_crypt',
  'orcish_warcamp',
  'human_ruins'
]);
export const TIER_BANDS = Object.freeze([1, 2, 3, 4, 5]);

export const CATEGORIES = Object.freeze([
  'surface',
  'route-transition',
  'connection-stairs',
  'connection-slope',
  'exposed-face-boundary',
  'blocking-obstacle',
  'nonblocking-decoration'
]);
const LEGACY_CATEGORIES = Object.freeze(
  CATEGORIES.filter(category => category !== 'connection-slope')
);

export const MANIFEST_PATH = 'ai-image-metadata/battle-art/manifest.json';
export const BUNDLE_PATH = 'ai-image-metadata/battle-art/runtime-asset-bundle.json';
export const BUNDLE_REGISTRY_PATH =
  'ai-image-metadata/battle-art/runtime-asset-bundle-registry.json';
export const INVENTORY_PATH = 'ai-image-metadata/battle-art/inventory.json';
export const INVENTORY_REGISTRY_PATH =
  'ai-image-metadata/battle-art/runtime-asset-inventory-registry.json';
export const READINESS_PLAN_PATH =
  'ai-image-metadata/battle-art/readiness-plan.json';
export const FRONTEND_BUNDLE_PATH =
  'frontend/src/generated/battleMapV3RuntimeBundle.json';
export const FRONTEND_BUNDLE_REGISTRY_PATH =
  'frontend/src/generated/battleMapV3RuntimeBundles.json';
export const RUNTIME_ROOT = 'frontend/public/assets/battle-map-v3';
export const DESCRIPTOR_SCHEMA_V1 = 'battle-art-family-descriptor-v1';
export const DESCRIPTOR_SCHEMA_V2 = 'battle-art-family-descriptor-v2';
export const DESCRIPTOR_SCHEMA = DESCRIPTOR_SCHEMA_V2;
export const READINESS_PLAN_SCHEMA = 'battle-art-readiness-plan-v1';
const LEGACY_CANDIDATE_SCHEMA = 'battle-art-candidate-v1';
const LEGACY_REVIEW_SCHEMA = 'battle-art-candidate-review-v1';
export const CANDIDATE_SCHEMA = 'battle-art-candidate-v2';
export const REVIEW_SCHEMA = 'battle-art-candidate-review-v2';
export const REVALIDATED_CANDIDATE_SCHEMA = 'battle-art-candidate-v3';
export const REVALIDATED_REVIEW_SCHEMA = 'battle-art-candidate-review-v3';
export const FAILED_ATTEMPT_REVALIDATION_ORIGIN =
  'failed-attempt-revalidation-v1';
export const DIRECT_ROUTE_DERIVATION_SCHEMA =
  'battle-art-route-direct-preparation-v1';
export const COMPILED_SOURCE_ATTESTATION_SCHEMA =
  'battle-art-compiled-current-source-attestation-v1';
export const REVIEW_ROOT = 'ai-image-metadata/battle-art/reviews';
export const GENERATED_ARTIFACT_ROOT =
  'ai-image-metadata/battle-art/generated-artifacts';
export const BUNDLE_SCHEMA = 'battle-art-runtime-bundle-v1';
export const BUNDLE_REGISTRY_SCHEMA = 'battle-art-runtime-bundle-registry-v1';
export const RELEASE_SCHEMA = 'battle-art-release-v1';
export const INVENTORY_SCHEMA = 'battle-art-inventory-v1';
export const INVENTORY_REGISTRY_SCHEMA =
  'battle-art-runtime-inventory-registry-v1';
export const BATTLE_ART_RENDERER_MANIFEST_HASH_DOMAIN =
  'modia:battle-art:renderer-manifest:v1';
export const RENDER_PROFILE = Object.freeze({
  id: 'iso64-retina-v3',
  sourcePixelScale: 4,
  tileWidth: 64,
  tileHeight: 32,
  elevationStep: 16
});

let effectivePromptBuilder = null;
let failedGeneratedAttemptAuditor = null;

export function registerEffectivePromptBuilder(builder) {
  if (typeof builder !== 'function') {
    throw new Error('battle-art effective prompt builder must be a function');
  }
  if (effectivePromptBuilder !== null && effectivePromptBuilder !== builder) {
    throw new Error('battle-art effective prompt builder is already registered');
  }
  effectivePromptBuilder = builder;
}

export function registerFailedGeneratedAttemptAuditor(auditor) {
  if (typeof auditor !== 'function') {
    throw new Error('battle-art failed generated attempt auditor must be a function');
  }
  if (
    failedGeneratedAttemptAuditor !== null
    && failedGeneratedAttemptAuditor !== auditor
  ) {
    throw new Error(
      'battle-art failed generated attempt auditor is already registered'
    );
  }
  failedGeneratedAttemptAuditor = auditor;
}

function buildCurrentEffectivePrompt({
  descriptor,
  profile,
  styleFiles,
  textStyleFallback
}) {
  if (effectivePromptBuilder === null) {
    throw new Error(
      'battle-art effective prompt builder is unavailable; import generate.mjs '
      + 'before reviewing or approving draft candidates'
    );
  }
  const prompt = effectivePromptBuilder({
    descriptor,
    profile,
    styleFiles,
    textStyleFallback
  });
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('battle-art effective prompt builder returned invalid output');
  }
  return prompt;
}

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_STYLE_REFERENCES = 5;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const STATUS_VALUES = new Set(['draft', 'approved', 'compiled']);
const DIRECT_ROUTE_MISSING_DERIVATION_ATTESTATIONS = Object.freeze([
  Object.freeze({
    theme: 'forest',
    familyId: 'forest-heartlands-loam-path-corner-sw',
    contentVersion: 1,
    metadata: Object.freeze({
      path:
        'ai-image-metadata/battle-art/candidates/forest/'
        + 'forest-heartlands-loam-path-corner-sw/result.json',
      bytes: 3506,
      sha256:
        'sha256:eacb2abd3b732bc792dd84d960773518f0fae4b3b5ec0d23d11c3cab706cb41e'
    }),
    image: Object.freeze({
      path:
        'ai-image-metadata/battle-art/candidates/forest/'
        + 'forest-heartlands-loam-path-corner-sw/candidate.png',
      bytes: 16783,
      width: 256,
      height: 128,
      format: 'png',
      sha256:
        'sha256:5bfedfc289deee9f134593b725ad2c70cfbae3672625c755e1f30dbf35a3e7e1'
    }),
    source: Object.freeze({
      candidateMetadataPath:
        'ai-image-metadata/battle-art/candidates/forest/'
        + 'forest-heartlands-loam-path-corner-sw/result.json',
      imagePath:
        'ai-image-metadata/battle-art/sources/forest/'
        + 'forest-heartlands-loam-path-corner-sw/v1/'
        + '5bfedfc289deee9f134593b725ad2c70cfbae3672625c755e1f30dbf35a3e7e1.png',
      imageSha256:
        'sha256:5bfedfc289deee9f134593b725ad2c70cfbae3672625c755e1f30dbf35a3e7e1',
      width: 256,
      height: 128,
      format: 'png',
      reviewer: 'codex-full-game-battle-content-review',
      approvedAt: '2026-07-31T19:26:45.125Z'
    }),
    reviewFullHash:
      'sha256:97ed6ab5f760c8541535d7019a4f9905ef9cb7033823f0f5a641453227bb10ce'
  }),
  Object.freeze({
    theme: 'forest',
    familyId: 'forest-heartlands-loam-path-tee-nes',
    contentVersion: 1,
    metadata: Object.freeze({
      path:
        'ai-image-metadata/battle-art/candidates/forest/'
        + 'forest-heartlands-loam-path-tee-nes/result.json',
      bytes: 3478,
      sha256:
        'sha256:ee9bd5e81d3c25b48ba1176ef47393a3a8affdd0a110f39e0447afab29ac456a'
    }),
    image: Object.freeze({
      path:
        'ai-image-metadata/battle-art/candidates/forest/'
        + 'forest-heartlands-loam-path-tee-nes/candidate.png',
      bytes: 24788,
      width: 256,
      height: 128,
      format: 'png',
      sha256:
        'sha256:3c149484c1d8e32a84e785332b7691b2014b373058e04ce12192087241be2bd5'
    }),
    source: Object.freeze({
      candidateMetadataPath:
        'ai-image-metadata/battle-art/candidates/forest/'
        + 'forest-heartlands-loam-path-tee-nes/result.json',
      imagePath:
        'ai-image-metadata/battle-art/sources/forest/'
        + 'forest-heartlands-loam-path-tee-nes/v1/'
        + '3c149484c1d8e32a84e785332b7691b2014b373058e04ce12192087241be2bd5.png',
      imageSha256:
        'sha256:3c149484c1d8e32a84e785332b7691b2014b373058e04ce12192087241be2bd5',
      width: 256,
      height: 128,
      format: 'png',
      reviewer: 'codex-full-game-battle-content-review',
      approvedAt: '2026-07-31T18:28:49.428Z'
    }),
    reviewFullHash:
      'sha256:2d4fb53c9be6b8baf9bd79e5f9fb53e500e54e16c809e0c17013a2782fdba162'
  })
]);
const LEGACY_REVIEW_EXEMPT_RELEASES = Object.freeze({
  'battle-art-descriptors-2026-07-30': 6
});
// Frozen migration authority for the exact v1 evidence intentionally retained
// in this repository. This registry is module-owned rather than audit-root-owned,
// so evidence under validation cannot authorize itself merely by occupying a
// tracked pathname. Its readable contents and whole-file hash are reviewable.
export const LEGACY_EVIDENCE_REGISTRY_PATH =
  'ai-image-metadata/battle-art/legacy-evidence-registry.json';
const LEGACY_EVIDENCE_REGISTRY_SHA256 =
  'sha256:24ac46edc22bad5dc9372302bc6f64c0bb8e1990f0912a6f51c4b1cdfa7bda26';
export const CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH =
  'ai-image-metadata/battle-art/corrective-style-reference-registry.json';
const CORRECTIVE_STYLE_REFERENCE_REGISTRY_SHA256 =
  'sha256:88ec9829229a275d391e28944c4cd6b31f3ad966ed4af4b1b81e70bc704254b1';

function loadLegacyEvidenceRegistry() {
  const bytes = readFileSync(new URL(
    `../../${LEGACY_EVIDENCE_REGISTRY_PATH}`,
    import.meta.url
  ));
  if (sha256(bytes) !== LEGACY_EVIDENCE_REGISTRY_SHA256) {
    throw new Error('battle-art legacy evidence registry hash pin mismatch');
  }

  let registry;
  try {
    registry = JSON.parse(bytes);
  } catch {
    throw new Error('battle-art legacy evidence registry must be valid JSON');
  }
  exactKeys(registry, [
    'schemaVersion',
    'registryVersion',
    'candidateCanonicalJsonSha256',
    'reviewFullHash'
  ], 'battle-art legacy evidence registry');
  if (registry.schemaVersion !== 'battle-art-legacy-evidence-registry-v1') {
    throw new Error('battle-art legacy evidence registry schema is unsupported');
  }
  if (registry.registryVersion !== 'battle-art-legacy-evidence-2026-07-31') {
    throw new Error('battle-art legacy evidence registry version is unsupported');
  }

  const validateEntries = (entries, {
    count,
    pathPattern,
    label
  }) => {
    if (!plainObject(entries)) {
      throw new Error(`battle-art legacy evidence registry.${label} must be an object`);
    }
    const paths = Object.keys(entries);
    if (paths.length !== count
      || stableJson(paths) !== stableJson(paths.toSorted())) {
      throw new Error(
        `battle-art legacy evidence registry.${label} must contain `
        + `${count} sorted entries`
      );
    }
    for (const [relative, identity] of Object.entries(entries)) {
      const match = relative.match(pathPattern);
      if (!match || !THEMES.includes(match[1]) || !ID_PATTERN.test(match[2])) {
        throw new Error(
          `battle-art legacy evidence registry.${label} has a noncanonical path`
        );
      }
      assertHash(
        identity,
        `battle-art legacy evidence registry.${label}[${relative}]`
      );
    }
    return Object.freeze(entries);
  };

  const candidateCanonicalJsonSha256 = validateEntries(
    registry.candidateCanonicalJsonSha256,
    {
      count: 94,
      pathPattern:
        /^ai-image-metadata\/battle-art\/candidates\/([^/]+)\/([^/]+)\/result\.json$/,
      label: 'candidateCanonicalJsonSha256'
    }
  );
  const reviewFullHash = validateEntries(registry.reviewFullHash, {
    count: 79,
    pathPattern:
      /^ai-image-metadata\/battle-art\/reviews\/([^/]+)\/([^/]+)\/[0-9a-f]{64}\.json$/,
    label: 'reviewFullHash'
  });
  return Object.freeze({
    ...candidateCanonicalJsonSha256,
    ...reviewFullHash
  });
}

const LEGACY_EVIDENCE_ALLOWLIST = loadLegacyEvidenceRegistry();

function validateCorrectiveStyleReferenceRegistry(
  bytes,
  label = 'battle-art corrective style reference registry'
) {
  if (sha256(bytes) !== CORRECTIVE_STYLE_REFERENCE_REGISTRY_SHA256) {
    throw new Error(`${label} hash pin mismatch`);
  }
  let registry;
  try {
    registry = JSON.parse(bytes);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (stableJson(registry) !== bytes.toString('utf8')) {
    throw new Error(`${label} must use canonical JSON serialization`);
  }
  exactKeys(
    registry,
    ['schemaVersion', 'registryVersion', 'entries'],
    label
  );
  if (
    stableJson(Object.keys(registry))
    !== stableJson(['schemaVersion', 'registryVersion', 'entries'])
  ) {
    throw new Error(`${label} fields are not in canonical order`);
  }
  if (
    registry.schemaVersion
    !== 'battle-art-corrective-style-reference-registry-v1'
  ) {
    throw new Error(`${label}.schemaVersion is unsupported`);
  }
  if (
    registry.registryVersion
    !== 'battle-art-corrective-style-references-2026-07-31'
  ) {
    throw new Error(`${label}.registryVersion is unsupported`);
  }
  if (!Array.isArray(registry.entries) || registry.entries.length !== 1) {
    throw new Error(`${label}.entries must contain exactly one authorization`);
  }
  if (
    stableJson(registry.entries.map(entry => entry?.id))
    !== stableJson(
      registry.entries.map(entry => entry?.id).toSorted()
    )
  ) {
    throw new Error(`${label}.entries must be sorted by id`);
  }
  const entries = registry.entries.map((entry, index) => {
    const entryLabel = `${label}.entries[${index}]`;
    exactKeys(
      entry,
      ['id', 'consumer', 'raw', 'failureRecord'],
      entryLabel
    );
    if (
      stableJson(Object.keys(entry))
      !== stableJson(['id', 'consumer', 'raw', 'failureRecord'])
    ) {
      throw new Error(`${entryLabel} fields are not in canonical order`);
    }
    assertSafeId(entry.id, `${entryLabel}.id`);
    exactKeys(entry.consumer, ['theme', 'familyId'], `${entryLabel}.consumer`);
    if (
      stableJson(Object.keys(entry.consumer))
      !== stableJson(['theme', 'familyId'])
    ) {
      throw new Error(`${entryLabel}.consumer fields are not in canonical order`);
    }
    if (!THEMES.includes(entry.consumer.theme)) {
      throw new Error(`${entryLabel}.consumer.theme is unsupported`);
    }
    assertSafeId(entry.consumer.familyId, `${entryLabel}.consumer.familyId`);
    exactKeys(entry.raw, ['path', 'sha256'], `${entryLabel}.raw`);
    if (
      stableJson(Object.keys(entry.raw))
      !== stableJson(['path', 'sha256'])
    ) {
      throw new Error(`${entryLabel}.raw fields are not in canonical order`);
    }
    assertHash(entry.raw.sha256, `${entryLabel}.raw.sha256`);
    const raw = entry.raw.path.match(
      /^ai-image-metadata\/battle-art\/generated-artifacts\/([^/]+)\/([^/]+)\/([0-9a-f]{64})\.(png|webp)$/
    );
    if (
      !raw
      || raw[1] !== entry.consumer.theme
      || raw[2] !== entry.consumer.familyId
      || entry.raw.sha256 !== `sha256:${raw[3]}`
    ) {
      throw new Error(`${entryLabel}.raw is not a canonical consumer artifact`);
    }
    exactKeys(
      entry.failureRecord,
      ['path', 'fullHash', 'sha256'],
      `${entryLabel}.failureRecord`
    );
    if (
      stableJson(Object.keys(entry.failureRecord))
      !== stableJson(['path', 'fullHash', 'sha256'])
    ) {
      throw new Error(
        `${entryLabel}.failureRecord fields are not in canonical order`
      );
    }
    assertHash(
      entry.failureRecord.fullHash,
      `${entryLabel}.failureRecord.fullHash`
    );
    assertHash(
      entry.failureRecord.sha256,
      `${entryLabel}.failureRecord.sha256`
    );
    const failure = entry.failureRecord.path.match(
      /^ai-image-metadata\/battle-art\/generated-artifacts\/([^/]+)\/([^/]+)\/failures\/([0-9a-f]{64})\.json$/
    );
    if (
      !failure
      || failure[1] !== entry.consumer.theme
      || failure[2] !== entry.consumer.familyId
      || entry.failureRecord.fullHash !== `sha256:${failure[3]}`
    ) {
      throw new Error(
        `${entryLabel}.failureRecord is not canonical for its consumer`
      );
    }
    return Object.freeze({
      id: entry.id,
      consumer: Object.freeze({ ...entry.consumer }),
      raw: Object.freeze({ ...entry.raw }),
      failureRecord: Object.freeze({ ...entry.failureRecord })
    });
  });
  return Object.freeze({
    schemaVersion: registry.schemaVersion,
    registryVersion: registry.registryVersion,
    entries: Object.freeze(entries)
  });
}

const CORRECTIVE_STYLE_REFERENCE_REGISTRY =
  validateCorrectiveStyleReferenceRegistry(readFileSync(new URL(
    `../../${CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH}`,
    import.meta.url
  )));

async function loadCorrectiveStyleReferenceRegistry(root) {
  const bytes = await readPinnedRegularFile(
    root,
    CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH,
    CORRECTIVE_STYLE_REFERENCE_REGISTRY_SHA256,
    'battle-art corrective style reference registry'
  );
  return validateCorrectiveStyleReferenceRegistry(bytes);
}

export function correctiveStyleReferenceEntry(pin) {
  if (pin === null || typeof pin !== 'object' || Array.isArray(pin)) {
    return null;
  }
  return CORRECTIVE_STYLE_REFERENCE_REGISTRY.entries.find(entry => (
    pin.id === entry.id
    && pin.path === entry.raw.path
    && pin.sha256 === entry.raw.sha256
  )) ?? null;
}

export function correctiveStyleReferenceForConsumer(
  pin,
  {
    theme,
    familyId
  },
  label = pin?.id ?? 'corrective style reference'
) {
  const entry = correctiveStyleReferenceEntry(pin);
  if (entry === null) return null;
  if (
    entry.consumer.theme !== theme
    || entry.consumer.familyId !== familyId
  ) {
    throw new Error(`${label} is not authorized for this consumer`);
  }
  return entry;
}
const LEGACY_DUPLICATE_ARTIFACT_TUPLES = Object.freeze([
  Object.freeze({
    metadataSha256:
      'sha256:f2a5d1682247a8dc4bf66cf4151d802c8e9263b6f0c6d183ef39b96d5a0fdad5',
    stdoutSha256:
      'sha256:52813c81d608107613453c76ceecbbe4fc93d57473a3bba2990f646731afb1e0',
    imageSha256:
      'sha256:d58799394edf6ecb2c25a0e436ab0638fc7f781d25a1385ba05fed80ba4126c0',
    reviewFullHash:
      'sha256:39d018621d02089d2d7a069ff2b1700c93b049e2a9b77a43af8d50ab6a874d5f'
  }),
  Object.freeze({
    metadataSha256:
      'sha256:ab8452a0c406bf9aa28a7a9b2e1c1e2b415082adb384e90a2b8fad9e06413f7d',
    stdoutSha256:
      'sha256:dd581ecae907e23f5a3fae30edec4fefb93208db79d9b158c2426ab7ebc1080b',
    imageSha256:
      'sha256:120bf2cf9c742ed392682fca9ca8aae540e94f718a76d23bc78107bfa5301bf7',
    reviewFullHash:
      'sha256:93409621fad491d370fa40552dc5c522393fd106379cd5751138addb7cf95780'
  })
]);
const LEGACY_POSTPROCESSED_ARTIFACT_ATTESTATION_TUPLES = Object.freeze([
  Object.freeze({
    familyId: 'forest-borderwood-dirt-path-corner-es',
    metadataSha256:
      'sha256:32d08c028ab1d79b3539f5e0abc1cd1b71272440d03e267394b75b7de4007ad4',
    stdoutSha256:
      'sha256:e16992d5e1b03ec97d81c64578eb2de158e60f45d7373ed6ba8035894abf8f22',
    imageSha256:
      'sha256:c0277f2744dff9adb241a9ab5240b709d3d91ca2d0e78e2b83bf863263a358cd',
    sourceSha256:
      'sha256:c0277f2744dff9adb241a9ab5240b709d3d91ca2d0e78e2b83bf863263a358cd',
    attestationFullHash:
      'sha256:385d0b3c56f8ba3ef3275d0cfa3520d3a5dd98781b164acdcd7a80bda0a4ffdc'
  })
]);

function hasLegacyPostprocessedArtifactAttestationAuthority({
  familyId,
  metadataSha256,
  stdoutSha256,
  imageSha256,
  sourceSha256,
  attestationFullHash
}) {
  return LEGACY_POSTPROCESSED_ARTIFACT_ATTESTATION_TUPLES.some(tuple => (
    tuple.familyId === familyId
    && tuple.metadataSha256 === metadataSha256
    && tuple.stdoutSha256 === stdoutSha256
    && tuple.imageSha256 === imageSha256
    && tuple.sourceSha256 === sourceSha256
    && (
      attestationFullHash === undefined
      || tuple.attestationFullHash === attestationFullHash
    )
  ));
}
const COLLISION_KINDS = new Set(['none', 'solid', 'connection', 'boundary']);
const STRATA = new Set(['surface', 'route', 'connection', 'boundary', 'obstacle', 'decoration']);
const DIRECTIONS = new Set(['n', 'e', 's', 'w']);
const ROUTE_TOPOLOGIES = new Set([
  'end-n',
  'end-e',
  'end-s',
  'end-w',
  'straight-ns',
  'straight-ew',
  'corner-ne',
  'corner-es',
  'corner-sw',
  'corner-wn',
  'tee-nes',
  'tee-esw',
  'tee-nsw',
  'tee-wne',
  'cross',
  'isolated'
]);
const CATEGORY_CONTRACTS = Object.freeze({
  surface: { collision: 'none', stratum: 'surface' },
  'route-transition': { collision: 'none', stratum: 'route' },
  'connection-stairs': { collision: 'connection', stratum: 'connection' },
  'connection-slope': { collision: 'connection', stratum: 'connection' },
  'exposed-face-boundary': { collision: 'boundary', stratum: 'boundary' },
  'blocking-obstacle': { collision: 'solid', stratum: 'obstacle' },
  'nonblocking-decoration': { collision: 'none', stratum: 'decoration' }
});

export function projectRoot(value = SCRIPT_ROOT) {
  return path.resolve(value);
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function styleReferenceProvenance(styleReferences) {
  return styleReferences.map((pin, index) => ({
    id: pin.id,
    sha256: pin.sha256,
    stagedBasename:
      `style-reference-${String(index + 1).padStart(2, '0')}`
      + path.extname(pin.path).toLowerCase()
  }));
}

function imageArguments(args, label) {
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  const images = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--image') continue;
    if (index + 1 >= args.length || args[index + 1] === '--image') {
      throw new Error(`${label} has an invalid --image argument`);
    }
    images.push(args[index + 1]);
    index += 1;
  }
  return images;
}

export function assertStyleReferenceProvenance({
  styleReferences,
  provenance,
  mode,
  args,
  imageBasenames,
  label
}) {
  if (!['attachments', 'text-fallback'].includes(mode)) {
    throw new Error(`${label}.styleReferenceMode is unsupported`);
  }
  const expected = styleReferenceProvenance(styleReferences);
  if (stableJson(provenance) !== stableJson(expected)) {
    throw new Error(`${label} ordered style reference provenance mismatch`);
  }
  const cliImages = imageArguments(args, `${label}.worker.args`);
  const cliBasenames = cliImages.map(imagePath => path.basename(imagePath));
  const expectedBasenames = mode === 'attachments'
    ? expected.map(entry => entry.stagedBasename)
    : [];
  if (stableJson(cliBasenames) !== stableJson(expectedBasenames)) {
    throw new Error(`${label} CLI --image count/order mismatch`);
  }
  if (imageBasenames !== undefined
    && stableJson(imageBasenames) !== stableJson(expectedBasenames)) {
    throw new Error(`${label} persisted CLI --image count/order mismatch`);
  }
  if (new Set(cliImages).size !== cliImages.length) {
    throw new Error(`${label} CLI --image arguments must not contain duplicates`);
  }
  return expectedBasenames;
}

export async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

export async function readPinnedRegularFile(
  root,
  relative,
  expectedSha256,
  label = relative
) {
  const absolute = resolveTracked(root, relative, label);
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, segment);
    const details = await lstat(current);
    if (details.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links`);
    }
  }
  if (await realpath(absolute) !== absolute) {
    throw new Error(`${label} must resolve to its canonical tracked path`);
  }
  const handle = await open(
    absolute,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    const bytes = await handle.readFile();
    const after = await lstat(absolute);
    if (after.isSymbolicLink()
      || !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || bytes.length !== before.size) {
      throw new Error(`${label} changed while it was being pinned`);
    }
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`${label} hash pin mismatch`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readRegularFileSnapshot(
  root,
  relative,
  label = relative
) {
  const absolute = resolveTracked(root, relative, label);
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, segment);
    const details = await lstat(current);
    if (details.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links`);
    }
  }
  if (await realpath(absolute) !== absolute) {
    throw new Error(`${label} must resolve to its canonical tracked path`);
  }
  const handle = await open(
    absolute,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    const contents = await handle.readFile();
    const after = await lstat(absolute);
    if (after.isSymbolicLink()
      || !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || contents.length !== before.size) {
      throw new Error(`${label} changed while it was being pinned`);
    }
    return {
      contents,
      pin: {
        path: relative,
        bytes: contents.length,
        sha256: sha256(contents)
      }
    };
  } finally {
    await handle.close();
  }
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function plainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function exactKeys(value, keys, label) {
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  const expected = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label}.${key} is not allowed`);
  }
  return value;
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase safe identifier`);
  }
}

function assertArtDirection(value, label) {
  if (value === null) return;
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < 20
    || value.length > 1200
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(
      `${label} must be 20–1200 trimmed printable characters`
    );
  }
}

function assertHash(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a sha256 pin`);
  }
}

function assertInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
}

export function assertFailedAttemptRevalidationOrigin(
  origin,
  {
    theme,
    familyId,
    validationDescriptorSha256,
    derivationSource
  },
  label = 'failed-attempt revalidation origin'
) {
  exactKeys(origin, [
    'kind',
    'failureRecord',
    'raw',
    'originalDescriptor',
    'validationDescriptorSha256'
  ], label);
  if (origin.kind !== FAILED_ATTEMPT_REVALIDATION_ORIGIN) {
    throw new Error(`${label}.kind is unsupported`);
  }
  exactKeys(
    origin.failureRecord,
    ['path', 'sha256', 'fullHash'],
    `${label}.failureRecord`
  );
  if (typeof origin.failureRecord.path !== 'string') {
    throw new Error(`${label}.failureRecord.path must be a tracked path`);
  }
  assertHash(origin.failureRecord.sha256, `${label}.failureRecord.sha256`);
  assertHash(origin.failureRecord.fullHash, `${label}.failureRecord.fullHash`);
  exactKeys(origin.raw, [
    'path',
    'bytes',
    'width',
    'height',
    'format',
    'sha256'
  ], `${label}.raw`);
  if (typeof origin.raw.path !== 'string') {
    throw new Error(`${label}.raw.path must be a tracked path`);
  }
  for (const key of ['bytes', 'width', 'height']) {
    assertInteger(origin.raw[key], `${label}.raw.${key}`, 1);
  }
  if (!['png', 'webp'].includes(origin.raw.format)) {
    throw new Error(`${label}.raw.format is unsupported`);
  }
  assertHash(origin.raw.sha256, `${label}.raw.sha256`);
  exactKeys(
    origin.originalDescriptor,
    ['path', 'sha256', 'contentVersion'],
    `${label}.originalDescriptor`
  );
  const descriptorPath =
    `ai-image-metadata/battle-art/descriptors/${theme}/${familyId}.json`;
  if (origin.originalDescriptor.path !== descriptorPath) {
    throw new Error(`${label}.originalDescriptor.path is not canonical`);
  }
  assertHash(
    origin.originalDescriptor.sha256,
    `${label}.originalDescriptor.sha256`
  );
  assertInteger(
    origin.originalDescriptor.contentVersion,
    `${label}.originalDescriptor.contentVersion`,
    1
  );
  assertHash(
    origin.validationDescriptorSha256,
    `${label}.validationDescriptorSha256`
  );
  if (
    origin.validationDescriptorSha256 !== validationDescriptorSha256
  ) {
    throw new Error(`${label}.validationDescriptorSha256 is stale`);
  }
  if (
    derivationSource !== undefined
    && stableJson(origin.raw) !== stableJson(derivationSource)
  ) {
    throw new Error(`${label}.raw does not match the route derivation source`);
  }
  return origin;
}

function assertPoint(value, label, canvas) {
  exactKeys(value, ['x', 'y'], label);
  assertInteger(value.x, `${label}.x`);
  assertInteger(value.y, `${label}.y`);
  if (value.x > canvas.width || value.y > canvas.height) {
    throw new Error(`${label} must be inside the declared canvas`);
  }
}

function assertRect(value, label, limits = null, tileSpace = false) {
  exactKeys(value, ['x', 'y', 'width', 'height'], label);
  for (const key of ['x', 'y', 'width', 'height']) {
    assertInteger(value[key], `${label}.${key}`, key === 'width' || key === 'height' ? 0 : 0);
  }
  if (!tileSpace && limits && (
    value.x + value.width > limits.width || value.y + value.height > limits.height
  )) throw new Error(`${label} exceeds the declared canvas`);
}

function assertNullableEnum(value, allowed, label) {
  if (value !== null && !allowed.has(value)) {
    throw new Error(`${label} is unsupported`);
  }
}

function assertUniqueIntegerArray(value, label, {
  minimum,
  maximum
}) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  let previous = null;
  for (const [index, entry] of value.entries()) {
    if (!Number.isSafeInteger(entry) || entry < minimum || entry > maximum) {
      throw new Error(
        `${label}[${index}] must be an integer between ${minimum} and ${maximum}`
      );
    }
    if (previous !== null && entry <= previous) {
      throw new Error(`${label} must be sorted with unique values`);
    }
    previous = entry;
  }
}

export function assertVariantCapabilities(
  capabilities,
  label = 'descriptor.capabilities'
) {
  exactKeys(capabilities, [
    'direction',
    'routeTopology',
    'surfaceVariant',
    'ecologyProfile',
    'tierBands',
    'heightDeltas'
  ], label);
  assertNullableEnum(capabilities.direction, DIRECTIONS, `${label}.direction`);
  assertNullableEnum(
    capabilities.routeTopology,
    ROUTE_TOPOLOGIES,
    `${label}.routeTopology`
  );
  if (capabilities.surfaceVariant !== null
    && (!Number.isSafeInteger(capabilities.surfaceVariant)
      || capabilities.surfaceVariant < 0
      || capabilities.surfaceVariant > 7)) {
    throw new Error(`${label}.surfaceVariant must be null or an integer from 0 through 7`);
  }
  assertSafeId(capabilities.ecologyProfile, `${label}.ecologyProfile`);
  assertUniqueIntegerArray(capabilities.tierBands, `${label}.tierBands`, {
    minimum: 1,
    maximum: TIER_BANDS.at(-1)
  });
  assertUniqueIntegerArray(capabilities.heightDeltas, `${label}.heightDeltas`, {
    minimum: 0,
    maximum: 64
  });
  return capabilities;
}

function assertCategoryCapabilityClosure(category, capabilities, label) {
  const connection = ['connection-stairs', 'connection-slope'].includes(category);
  const boundary = category === 'exposed-face-boundary';
  const route = category === 'route-transition';
  const surface = category === 'surface';
  if (surface) {
    if (capabilities.surfaceVariant === null) {
      throw new Error(`${label} surface requires surfaceVariant`);
    }
  } else if (capabilities.surfaceVariant !== null) {
    throw new Error(`${label} surfaceVariant is only valid for surface`);
  }
  if (route) {
    if (capabilities.routeTopology === null) {
      throw new Error(`${label} route-transition requires routeTopology`);
    }
  } else if (capabilities.routeTopology !== null) {
    throw new Error(`${label} routeTopology is only valid for route-transition`);
  }
  if (connection || boundary) {
    if (capabilities.direction === null) {
      throw new Error(`${label} ${category} requires direction`);
    }
    if (capabilities.heightDeltas.length !== 1
      || capabilities.heightDeltas[0] < 1) {
      throw new Error(
        `${label} ${category} requires exactly one positive heightDelta`
      );
    }
  } else {
    if (capabilities.direction !== null) {
      throw new Error(`${label} direction must be null for ${category}`);
    }
    if (capabilities.heightDeltas.length !== 1
      || capabilities.heightDeltas[0] !== 0) {
      throw new Error(`${label} heightDelta must be 0 for ${category}`);
    }
  }
}

function assertRuntimeVariant(variant, label) {
  if (!plainObject(variant) || Object.keys(variant).length === 0) {
    throw new Error(`${label} must be a non-empty object`);
  }
  const allowed = new Set([
    'direction',
    'routeTopology',
    'surfaceVariant',
    'ecologyProfile',
    'tier',
    'heightDelta'
  ]);
  for (const key of Object.keys(variant)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
  }
  if (Object.hasOwn(variant, 'direction')) {
    assertNullableEnum(variant.direction, DIRECTIONS, `${label}.direction`);
    if (variant.direction === null) throw new Error(`${label}.direction cannot be null`);
  }
  if (Object.hasOwn(variant, 'routeTopology')) {
    assertNullableEnum(
      variant.routeTopology,
      ROUTE_TOPOLOGIES,
      `${label}.routeTopology`
    );
    if (variant.routeTopology === null) {
      throw new Error(`${label}.routeTopology cannot be null`);
    }
  }
  if (Object.hasOwn(variant, 'surfaceVariant')
    && (!Number.isSafeInteger(variant.surfaceVariant)
      || variant.surfaceVariant < 0
      || variant.surfaceVariant > 7)) {
    throw new Error(`${label}.surfaceVariant must be an integer from 0 through 7`);
  }
  if (Object.hasOwn(variant, 'ecologyProfile')) {
    assertSafeId(variant.ecologyProfile, `${label}.ecologyProfile`);
  }
  if (Object.hasOwn(variant, 'tier')) {
    assertInteger(variant.tier, `${label}.tier`, 1);
  }
  if (Object.hasOwn(variant, 'heightDelta')) {
    assertInteger(variant.heightDelta, `${label}.heightDelta`, 1);
    if (variant.heightDelta > 64) {
      throw new Error(`${label}.heightDelta must be <= 64`);
    }
  }
}

export function resolveTracked(root, relative, label = 'tracked path') {
  if (typeof relative !== 'string'
    || relative.length === 0
    || path.isAbsolute(relative)
    || relative.includes('\\')) {
    throw new Error(`${label} must be a project-relative POSIX path`);
  }
  const segments = relative.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} contains an unsafe segment`);
  }
  const absolute = path.resolve(root, ...segments);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the project root`);
  }
  return absolute;
}

export async function readJson(root, relative, label = relative) {
  const filePath = resolveTracked(root, relative, label);
  let parsed;
  let contents;
  try {
    const before = await lstat(filePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error('must be a regular non-symlink file');
    }
    contents = await readFile(filePath, 'utf8');
    const after = await lstat(filePath);
    if (after.isSymbolicLink()
      || !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || Buffer.byteLength(contents) !== before.size) {
      throw new Error('changed while being read');
    }
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid readable JSON: ${error.message}`);
  }
  return { value: parsed, filePath, contents };
}

async function assertNoSymlink(filePath, root) {
  let current = filePath;
  while (current !== root) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`refusing symbolic-link write path ${filePath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    current = path.dirname(current);
  }
}

export async function atomicWrite(
  root,
  relative,
  contents,
  { immutable = false } = {}
) {
  const destination = resolveTracked(root, relative, 'write path');
  await assertNoSymlink(destination, root);
  await mkdir(path.dirname(destination), { recursive: true });
  await assertNoSymlink(destination, root);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (immutable) {
      await link(temporary, destination);
      await unlink(temporary);
    } else {
      await rename(temporary, destination);
    }
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
  return destination;
}

function assertPin(pin, label) {
  exactKeys(pin, ['id', 'path', 'sha256'], label);
  assertSafeId(pin.id, `${label}.id`);
  resolveTracked('/project', pin.path, `${label}.path`);
  assertHash(pin.sha256, `${label}.sha256`);
}

function assertRolePath(relative, prefixes, extensions, label) {
  if (!prefixes.some(prefix => relative.startsWith(prefix))) {
    throw new Error(`${label} is outside its allowlisted directory`);
  }
  if (!extensions.some(extension => relative.endsWith(extension))) {
    throw new Error(`${label} has an unsupported extension`);
  }
}

export function assertDescriptor(descriptor, manifest, label = `descriptor ${descriptor?.id ?? ''}`) {
  const v2 = descriptor?.schemaVersion === DESCRIPTOR_SCHEMA_V2;
  if (!v2 && descriptor?.schemaVersion !== DESCRIPTOR_SCHEMA_V1) {
    throw new Error(`${label}.schemaVersion is unsupported`);
  }
  exactKeys(descriptor, [
    'schemaVersion',
    'id',
    'theme',
    'category',
    ...(v2 ? ['familyGroup', 'variantId', 'capabilities'] : []),
    ...(v2 && descriptor?.routeFinishing !== undefined
      ? ['routeFinishing']
      : []),
    ...(v2 && descriptor?.directGeometryPrime !== undefined
      ? ['directGeometryPrime']
      : []),
    'status',
    'promptProfile',
    'styleReferences',
    'generationPrompt',
    'rasterContract',
    'canvas',
    'placement',
    'content',
    'source'
  ], label);
  assertSafeId(descriptor.id, `${label}.id`);
  if (!THEMES.includes(descriptor.theme)) throw new Error(`${label}.theme is unsupported`);
  if (!CATEGORIES.includes(descriptor.category)) throw new Error(`${label}.category is unsupported`);
  if (!v2 && !LEGACY_CATEGORIES.includes(descriptor.category)) {
    throw new Error(`${label}.category requires descriptor v2`);
  }
  if (v2) {
    assertSafeId(descriptor.familyGroup, `${label}.familyGroup`);
    assertSafeId(descriptor.variantId, `${label}.variantId`);
    assertVariantCapabilities(descriptor.capabilities, `${label}.capabilities`);
    assertCategoryCapabilityClosure(
      descriptor.category,
      descriptor.capabilities,
      label
    );
  }
  if (!STATUS_VALUES.has(descriptor.status)) throw new Error(`${label}.status is unsupported`);
  assertPin(descriptor.promptProfile, `${label}.promptProfile`);
  if (stableJson(descriptor.promptProfile) !== stableJson(manifest.promptProfile)) {
    throw new Error(`${label}.promptProfile does not match the frozen manifest pin`);
  }
  if (!Array.isArray(descriptor.styleReferences) || descriptor.styleReferences.length === 0) {
    throw new Error(`${label}.styleReferences must be non-empty`);
  }
  if (descriptor.styleReferences.length > MAX_STYLE_REFERENCES) {
    throw new Error(
      `${label}.styleReferences must contain at most ${MAX_STYLE_REFERENCES} pins`
    );
  }
  descriptor.styleReferences.forEach((pin, index) => assertPin(pin, `${label}.styleReferences[${index}]`));
  if (typeof descriptor.generationPrompt !== 'string'
    || descriptor.generationPrompt.trim().length === 0) {
    throw new Error(`${label}.generationPrompt is required`);
  }
  exactKeys(descriptor.rasterContract, [
    'schemaVersion',
    'kind',
    ...(descriptor.rasterContract?.kind === 'opaque-tile-diamond'
      ? [
          'alphaThreshold',
          'minimumCoveredPermille',
          'maximumExteriorCoveredPermille'
        ]
      : ['minimumCoveredPermille', 'maximumCoveredPermille'])
  ], `${label}.rasterContract`);
  if (descriptor.rasterContract.schemaVersion !== 'battle-art-raster-contract-v1') {
    throw new Error(`${label}.rasterContract.schemaVersion is unsupported`);
  }
  if (descriptor.rasterContract.kind === 'opaque-tile-diamond') {
    if (!['surface', 'route-transition'].includes(descriptor.category)) {
      throw new Error(
        `${label} opaque tile diamond contract requires surface or route-transition category`
      );
    }
    assertInteger(
      descriptor.rasterContract.alphaThreshold,
      `${label}.rasterContract.alphaThreshold`,
      1
    );
    if (descriptor.rasterContract.alphaThreshold > 255) {
      throw new Error(`${label}.rasterContract.alphaThreshold must be <= 255`);
    }
    for (const key of [
      'minimumCoveredPermille',
      'maximumExteriorCoveredPermille'
    ]) {
      assertInteger(
        descriptor.rasterContract[key],
        `${label}.rasterContract.${key}`
      );
      if (descriptor.rasterContract[key] > 1000) {
        throw new Error(`${label}.rasterContract.${key} must be <= 1000`);
      }
    }
  } else if (descriptor.rasterContract.kind === 'transparent-cutout') {
    for (const key of ['minimumCoveredPermille', 'maximumCoveredPermille']) {
      assertInteger(
        descriptor.rasterContract[key],
        `${label}.rasterContract.${key}`
      );
      if (descriptor.rasterContract[key] > 1000) {
        throw new Error(`${label}.rasterContract.${key} must be <= 1000`);
      }
    }
    if (descriptor.rasterContract.minimumCoveredPermille
      > descriptor.rasterContract.maximumCoveredPermille) {
      throw new Error(`${label}.rasterContract coverage range is invalid`);
    }
  } else {
    throw new Error(`${label}.rasterContract.kind is unsupported`);
  }
  exactKeys(descriptor.canvas, ['width', 'height'], `${label}.canvas`);
  assertInteger(descriptor.canvas.width, `${label}.canvas.width`, 1);
  assertInteger(descriptor.canvas.height, `${label}.canvas.height`, 1);
  if (descriptor.canvas.width > 4096 || descriptor.canvas.height > 4096) {
    throw new Error(`${label}.canvas exceeds 4096 pixels`);
  }
  if (descriptor.canvas.width % RENDER_PROFILE.sourcePixelScale !== 0
    || descriptor.canvas.height % RENDER_PROFILE.sourcePixelScale !== 0) {
    throw new Error(
      `${label}.canvas dimensions must be divisible by `
      + `sourcePixelScale ${RENDER_PROFILE.sourcePixelScale}`
    );
  }
  if (descriptor.routeFinishing !== undefined) {
    if (!v2 || descriptor.category !== 'route-transition') {
      throw new Error(
        `${label}.routeFinishing requires a v2 route-transition descriptor`
      );
    }
    const routeFinishingStrategy = descriptor.routeFinishing.strategy;
    const anchorScaleFinishing =
      routeFinishingStrategy === 'anchor-scale-v1';
    const componentBoxFinishing =
      routeFinishingStrategy === 'largest-component-box-v1';
    const straightRouteBasisFinishing =
      routeFinishingStrategy === 'straight-route-basis-v1';
    const cornerArmLocalWarpFinishing =
      routeFinishingStrategy === 'corner-arm-local-warp-v1';
    const multiArmLocalWarpFinishing =
      routeFinishingStrategy === 'multi-arm-local-warp-v1';
    const isolatedRouteFinishing =
      descriptor.capabilities?.routeTopology === 'isolated';
    exactKeys(descriptor.routeFinishing, [
      'schemaVersion',
      'strategy',
      ...(componentBoxFinishing ? ['targetBox'] : []),
      ...(anchorScaleFinishing ? ['scalePermille'] : []),
      ...(straightRouteBasisFinishing ? [
        'sourceTerminalInsetPixels',
        'outputTerminalOverflowPixels',
        'outputPerpendicularSpanPixels',
        'maximumTrimmedCoveredPermille',
        'maximumScaleAnisotropyPermille'
      ] : []),
      ...(cornerArmLocalWarpFinishing ? [
        'arms',
        'maximumCoveragePermille',
        'maximumScaleAnisotropyPermille'
      ] : []),
      ...(multiArmLocalWarpFinishing ? [
        'arms',
        'maximumFinishedDetachedCoveredPermille',
        'maximumCoveragePermille',
        'maximumScaleAnisotropyPermille',
        'centerlineArmAlphaSpan'
      ] : []),
      'maximumDetachedCoveredPermille',
      'armAlphaSpan',
      ...(componentBoxFinishing
        && descriptor.routeFinishing.maximumScaleAnisotropyPermille
        !== undefined
        ? ['maximumScaleAnisotropyPermille']
        : []),
      ...(componentBoxFinishing
        && descriptor.routeFinishing.geometryPrime !== undefined
        ? ['geometryPrime']
        : []),
      ...(componentBoxFinishing
        && descriptor.routeFinishing.terminalClip !== undefined
        ? ['terminalClip']
        : [])
    ], `${label}.routeFinishing`);
    if (
      descriptor.routeFinishing.schemaVersion
        !== 'battle-art-route-finishing-v1'
      || (!componentBoxFinishing
        && !anchorScaleFinishing
        && !straightRouteBasisFinishing
        && !cornerArmLocalWarpFinishing
        && !multiArmLocalWarpFinishing)
    ) {
      throw new Error(`${label}.routeFinishing is unsupported`);
    }
    if (isolatedRouteFinishing && !componentBoxFinishing) {
      throw new Error(
        `${label}.routeFinishing for isolated topology requires `
        + 'largest-component-box-v1'
      );
    }
    if (componentBoxFinishing) {
      assertRect(
        descriptor.routeFinishing.targetBox,
        `${label}.routeFinishing.targetBox`,
        descriptor.canvas
      );
      if (isolatedRouteFinishing) {
        assertPoint(
          descriptor.placement?.anchor,
          `${label}.placement.anchor`,
          descriptor.canvas
        );
        const { anchor } = descriptor.placement;
        const { targetBox } = descriptor.routeFinishing;
        if (anchor.x < targetBox.x
          || anchor.x >= targetBox.x + targetBox.width
          || anchor.y < targetBox.y
          || anchor.y >= targetBox.y + targetBox.height) {
          throw new Error(
            `${label}.routeFinishing.targetBox must contain the declared `
            + 'anchor for isolated topology'
          );
        }
      }
    } else if (anchorScaleFinishing) {
      assertInteger(
        descriptor.routeFinishing.scalePermille,
        `${label}.routeFinishing.scalePermille`,
        1001
      );
      if (descriptor.routeFinishing.scalePermille > 1500) {
        throw new Error(
          `${label}.routeFinishing.scalePermille must be <= 1500`
        );
      }
    } else if (straightRouteBasisFinishing) {
      if (!['straight-ew', 'straight-ns'].includes(
        descriptor.capabilities?.routeTopology
      )) {
        throw new Error(
          `${label}.routeFinishing straight-route-basis-v1 requires `
          + 'straight-ew or straight-ns'
        );
      }
      assertPoint(
        descriptor.placement?.anchor,
        `${label}.placement.anchor`,
        descriptor.canvas
      );
      for (const [key, minimum, maximum] of [
        ['sourceTerminalInsetPixels', 1, 4096],
        ['outputTerminalOverflowPixels', 0, 8],
        [
          'outputPerpendicularSpanPixels',
          1,
          Math.max(descriptor.canvas.width, descriptor.canvas.height)
        ],
        ['maximumTrimmedCoveredPermille', 0, 300],
        ['maximumScaleAnisotropyPermille', 1000, 3250]
      ]) {
        assertInteger(
          descriptor.routeFinishing[key],
          `${label}.routeFinishing.${key}`,
          minimum
        );
        if (descriptor.routeFinishing[key] > maximum) {
          throw new Error(
            `${label}.routeFinishing.${key} must be <= ${maximum}`
          );
        }
      }
    } else if (cornerArmLocalWarpFinishing) {
      const topology = descriptor.capabilities?.routeTopology;
      if (!/^corner-[nesw]{2}$/.test(topology)) {
        throw new Error(
          `${label}.routeFinishing corner-arm-local-warp-v1 requires a `
          + 'corner topology'
        );
      }
      assertPoint(
        descriptor.placement?.anchor,
        `${label}.placement.anchor`,
        descriptor.canvas
      );
      if (descriptor.canvas.width % 4 !== 0
        || descriptor.canvas.height % 4 !== 0) {
        throw new Error(
          `${label}.routeFinishing corner-arm-local-warp-v1 requires canvas `
          + 'dimensions divisible by 4'
        );
      }
      exactKeys(
        descriptor.routeFinishing.arms,
        [...topology.slice('corner-'.length)],
        `${label}.routeFinishing.arms`
      );
      for (const direction of [...topology.slice('corner-'.length)]) {
        const arm = descriptor.routeFinishing.arms[direction];
        exactKeys(arm, [
          'perpendicularScalePermille',
          'perpendicularOffsetPixels',
          'transitionStartPermille',
          'transitionEndPermille'
        ], `${label}.routeFinishing.arms.${direction}`);
        assertInteger(
          arm.perpendicularScalePermille,
          `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularScalePermille',
          1000
        );
        if (arm.perpendicularScalePermille
          > descriptor.routeFinishing.maximumScaleAnisotropyPermille) {
          throw new Error(
            `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularScalePermille exceeds its hard anisotropy cap'
          );
        }
        assertInteger(
          arm.perpendicularOffsetPixels,
          `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularOffsetPixels',
          -32
        );
        if (arm.perpendicularOffsetPixels > 32) {
          throw new Error(
            `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularOffsetPixels must be <= 32'
          );
        }
        for (const key of [
          'transitionStartPermille',
          'transitionEndPermille'
        ]) {
          assertInteger(
            arm[key],
            `${label}.routeFinishing.arms.${direction}.${key}`
          );
          if (arm[key] > 1000) {
            throw new Error(
              `${label}.routeFinishing.arms.${direction}.${key} must be <= 1000`
            );
          }
        }
        if (arm.transitionStartPermille >= arm.transitionEndPermille) {
          throw new Error(
            `${label}.routeFinishing.arms.${direction} transition must have `
            + 'positive length'
          );
        }
      }
      assertInteger(
        descriptor.routeFinishing.maximumCoveragePermille,
        `${label}.routeFinishing.maximumCoveragePermille`,
        1
      );
      if (descriptor.routeFinishing.maximumCoveragePermille > 230) {
        throw new Error(
          `${label}.routeFinishing.maximumCoveragePermille must be <= 230`
        );
      }
      assertInteger(
        descriptor.routeFinishing.maximumScaleAnisotropyPermille,
        `${label}.routeFinishing.maximumScaleAnisotropyPermille`,
        1000
      );
      if (descriptor.routeFinishing.maximumScaleAnisotropyPermille > 1500) {
        throw new Error(
          `${label}.routeFinishing.maximumScaleAnisotropyPermille must be <= 1500`
        );
      }
    } else {
      const topology = descriptor.capabilities?.routeTopology;
      if (topology !== 'cross' && !/^tee-[nesw]{3}$/.test(topology)) {
        throw new Error(
          `${label}.routeFinishing multi-arm-local-warp-v1 requires a `
          + 'cross or tee topology'
        );
      }
      assertPoint(
        descriptor.placement?.anchor,
        `${label}.placement.anchor`,
        descriptor.canvas
      );
      if (descriptor.canvas.width % 4 !== 0
        || descriptor.canvas.height % 4 !== 0) {
        throw new Error(
          `${label}.routeFinishing multi-arm-local-warp-v1 requires canvas `
          + 'dimensions divisible by 4'
        );
      }
      const directions = topology === 'cross'
        ? ['n', 'e', 's', 'w']
        : [...topology.slice('tee-'.length)];
      exactKeys(
        descriptor.routeFinishing.arms,
        directions,
        `${label}.routeFinishing.arms`
      );
      for (const direction of directions) {
        const arm = descriptor.routeFinishing.arms[direction];
        exactKeys(arm, [
          'perpendicularStartScalePermille',
          'perpendicularScalePermille',
          'perpendicularOffsetPixels',
          'scaleTransitionStartPermille',
          'scaleTransitionEndPermille',
          'offsetTransitionStartPermille',
          'offsetTransitionEndPermille'
        ], `${label}.routeFinishing.arms.${direction}`);
        assertInteger(
          arm.perpendicularStartScalePermille,
          `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularStartScalePermille',
          1000
        );
        if (arm.perpendicularStartScalePermille
          > descriptor.routeFinishing.maximumScaleAnisotropyPermille) {
          throw new Error(
            `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularStartScalePermille exceeds its hard anisotropy cap'
          );
        }
        assertInteger(
          arm.perpendicularScalePermille,
          `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularScalePermille',
          1000
        );
        if (arm.perpendicularScalePermille
          > descriptor.routeFinishing.maximumScaleAnisotropyPermille) {
          throw new Error(
            `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularScalePermille exceeds its hard anisotropy cap'
          );
        }
        assertInteger(
          arm.perpendicularOffsetPixels,
          `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularOffsetPixels',
          -32
        );
        if (arm.perpendicularOffsetPixels > 32) {
          throw new Error(
            `${label}.routeFinishing.arms.${direction}`
            + '.perpendicularOffsetPixels must be <= 32'
          );
        }
        for (const prefix of ['scale', 'offset']) {
          const startKey = `${prefix}TransitionStartPermille`;
          const endKey = `${prefix}TransitionEndPermille`;
          assertInteger(
            arm[startKey],
            `${label}.routeFinishing.arms.${direction}.${startKey}`
          );
          assertInteger(
            arm[endKey],
            `${label}.routeFinishing.arms.${direction}.${endKey}`
          );
          if (arm[endKey] > 1000 || arm[startKey] >= arm[endKey]) {
            throw new Error(
              `${label}.routeFinishing.arms.${direction} ${prefix} `
              + 'transition must be an increasing range in 0..1000'
            );
          }
        }
      }
      for (const [key, maximum] of [
        ['maximumFinishedDetachedCoveredPermille', 150],
        ['maximumCoveragePermille', 500],
        ['maximumScaleAnisotropyPermille', 3500]
      ]) {
        assertInteger(
          descriptor.routeFinishing[key],
          `${label}.routeFinishing.${key}`,
          key === 'maximumFinishedDetachedCoveredPermille' ? 0 : 1
        );
        if (descriptor.routeFinishing[key] > maximum) {
          throw new Error(
            `${label}.routeFinishing.${key} must be <= ${maximum}`
          );
        }
      }
      exactKeys(descriptor.routeFinishing.centerlineArmAlphaSpan, [
        'alphaThreshold',
        'minimumPixels',
        'maximumPixels',
        'maximumSpreadPixels'
      ], `${label}.routeFinishing.centerlineArmAlphaSpan`);
      for (const [key, minimum, maximum] of [
        ['alphaThreshold', 1, 255],
        ['minimumPixels', 28, Number.MAX_SAFE_INTEGER],
        ['maximumPixels', 1, Number.MAX_SAFE_INTEGER],
        ['maximumSpreadPixels', 0, Number.MAX_SAFE_INTEGER]
      ]) {
        assertInteger(
          descriptor.routeFinishing.centerlineArmAlphaSpan[key],
          `${label}.routeFinishing.centerlineArmAlphaSpan.${key}`,
          minimum
        );
        if (descriptor.routeFinishing.centerlineArmAlphaSpan[key] > maximum) {
          throw new Error(
            `${label}.routeFinishing.centerlineArmAlphaSpan.${key} is invalid`
          );
        }
      }
      if (descriptor.routeFinishing.centerlineArmAlphaSpan.minimumPixels
        > descriptor.routeFinishing.centerlineArmAlphaSpan.maximumPixels) {
        throw new Error(
          `${label}.routeFinishing.centerlineArmAlphaSpan range is invalid`
        );
      }
    }
    assertInteger(
      descriptor.routeFinishing.maximumDetachedCoveredPermille,
      `${label}.routeFinishing.maximumDetachedCoveredPermille`
    );
    if (descriptor.routeFinishing.maximumDetachedCoveredPermille > 150) {
      throw new Error(
        `${label}.routeFinishing.maximumDetachedCoveredPermille must be <= 150`
      );
    }
    if (
      !straightRouteBasisFinishing
      && !cornerArmLocalWarpFinishing
      && !multiArmLocalWarpFinishing
      &&
      descriptor.routeFinishing.maximumScaleAnisotropyPermille !== undefined
    ) {
      assertInteger(
        descriptor.routeFinishing.maximumScaleAnisotropyPermille,
        `${label}.routeFinishing.maximumScaleAnisotropyPermille`,
        1250
      );
      if (
        descriptor.routeFinishing.maximumScaleAnisotropyPermille > 1500
      ) {
        throw new Error(
          `${label}.routeFinishing.maximumScaleAnisotropyPermille `
          + 'must be <= 1500'
        );
      }
    }
    if (descriptor.routeFinishing.geometryPrime !== undefined) {
      const prime = descriptor.routeFinishing.geometryPrime;
      exactKeys(prime, [
        'schemaVersion',
        'sourceReferenceId',
        'sourceSha256',
        'topology',
        'canvas',
        'anchor',
        'subjectBounds',
        'coveredPixels',
        'coveragePermille',
        'terminalOverflowPixels'
      ], `${label}.routeFinishing.geometryPrime`);
      if (
        prime.schemaVersion !== 'battle-art-route-geometry-prime-v1'
      ) {
        throw new Error(
          `${label}.routeFinishing.geometryPrime.schemaVersion is unsupported`
        );
      }
      assertSafeId(
        prime.sourceReferenceId,
        `${label}.routeFinishing.geometryPrime.sourceReferenceId`
      );
      assertHash(
        prime.sourceSha256,
        `${label}.routeFinishing.geometryPrime.sourceSha256`
      );
      const sourceReference = descriptor.styleReferences.find(reference => (
        reference.id === prime.sourceReferenceId
      ));
      if (sourceReference
        && sourceReference.sha256 !== prime.sourceSha256) {
        throw new Error(
          `${label}.routeFinishing.geometryPrime source-reference hash `
          + 'does not match the descriptor style reference'
        );
      }
      if (prime.topology !== descriptor.capabilities?.routeTopology) {
        throw new Error(
          `${label}.routeFinishing.geometryPrime.topology must match `
          + 'the descriptor route topology'
        );
      }
      exactKeys(
        prime.canvas,
        ['width', 'height'],
        `${label}.routeFinishing.geometryPrime.canvas`
      );
      assertInteger(
        prime.canvas.width,
        `${label}.routeFinishing.geometryPrime.canvas.width`,
        1
      );
      assertInteger(
        prime.canvas.height,
        `${label}.routeFinishing.geometryPrime.canvas.height`,
        1
      );
      assertPoint(
        prime.anchor,
        `${label}.routeFinishing.geometryPrime.anchor`,
        prime.canvas
      );
      assertRect(
        prime.subjectBounds,
        `${label}.routeFinishing.geometryPrime.subjectBounds`,
        prime.canvas
      );
      assertInteger(
        prime.coveredPixels,
        `${label}.routeFinishing.geometryPrime.coveredPixels`,
        1
      );
      assertInteger(
        prime.coveragePermille,
        `${label}.routeFinishing.geometryPrime.coveragePermille`,
        1
      );
      if (prime.coveragePermille > 1000) {
        throw new Error(
          `${label}.routeFinishing.geometryPrime.coveragePermille `
          + 'must be <= 1000'
        );
      }
      exactKeys(
        prime.terminalOverflowPixels,
        ['n', 's'],
        `${label}.routeFinishing.geometryPrime.terminalOverflowPixels`
      );
      for (const direction of ['n', 's']) {
        assertInteger(
          prime.terminalOverflowPixels[direction],
          `${label}.routeFinishing.geometryPrime.terminalOverflowPixels.${direction}`
        );
      }
    }
    if (descriptor.routeFinishing.terminalClip !== undefined) {
      const clip = descriptor.routeFinishing.terminalClip;
      exactKeys(
        clip,
        ['schemaVersion', 'maximumOverflowPixels'],
        `${label}.routeFinishing.terminalClip`
      );
      if (
        clip.schemaVersion !== 'battle-art-route-terminal-clip-v1'
        || !descriptor.capabilities?.routeTopology?.startsWith('straight-')
      ) {
        throw new Error(`${label}.routeFinishing.terminalClip is unsupported`);
      }
      assertInteger(
        clip.maximumOverflowPixels,
        `${label}.routeFinishing.terminalClip.maximumOverflowPixels`
      );
      if (clip.maximumOverflowPixels > 32) {
        throw new Error(
          `${label}.routeFinishing.terminalClip.maximumOverflowPixels `
          + 'must be <= 32'
        );
      }
    }
    exactKeys(descriptor.routeFinishing.armAlphaSpan, [
      'alphaThreshold',
      'minimumPixels',
      'maximumPixels',
      'maximumSpreadPixels'
    ], `${label}.routeFinishing.armAlphaSpan`);
    for (const key of [
      'alphaThreshold',
      'minimumPixels',
      'maximumPixels',
      'maximumSpreadPixels'
    ]) {
      assertInteger(
        descriptor.routeFinishing.armAlphaSpan[key],
        `${label}.routeFinishing.armAlphaSpan.${key}`,
        key === 'maximumSpreadPixels' ? 0 : 1
      );
    }
    if (descriptor.routeFinishing.armAlphaSpan.alphaThreshold > 255) {
      throw new Error(
        `${label}.routeFinishing.armAlphaSpan.alphaThreshold must be <= 255`
      );
    }
    if (
      descriptor.routeFinishing.armAlphaSpan.minimumPixels
        > descriptor.routeFinishing.armAlphaSpan.maximumPixels
    ) {
      throw new Error(
        `${label}.routeFinishing.armAlphaSpan range is invalid`
      );
    }
  }
  if (descriptor.directGeometryPrime !== undefined) {
    if (
      !v2
      || descriptor.category !== 'route-transition'
      || descriptor.capabilities?.routeTopology !== 'corner-es'
      || descriptor.routeFinishing !== undefined
    ) {
      throw new Error(
        `${label}.directGeometryPrime requires a direct v2 corner-es route`
      );
    }
    const prime = descriptor.directGeometryPrime;
    exactKeys(prime, [
      'schemaVersion',
      'sourceReferenceId',
      'sourceSha256',
      'topology',
      'canvas',
      'alphaThreshold',
      'anchor',
      'subjectBounds',
      'coveragePermille',
      'armSampleCenters',
      'apexTopProfile'
    ], `${label}.directGeometryPrime`);
    if (
      prime.schemaVersion !== 'battle-art-direct-geometry-prime-v1'
      || prime.topology !== descriptor.capabilities.routeTopology
      || prime.alphaThreshold !== 240
    ) {
      throw new Error(`${label}.directGeometryPrime is unsupported`);
    }
    assertSafeId(
      prime.sourceReferenceId,
      `${label}.directGeometryPrime.sourceReferenceId`
    );
    assertHash(
      prime.sourceSha256,
      `${label}.directGeometryPrime.sourceSha256`
    );
    const matchingReferences = descriptor.styleReferences.filter(
      reference => (
        reference.id === prime.sourceReferenceId
        && reference.sha256 === prime.sourceSha256
      )
    );
    if (matchingReferences.length !== 1) {
      throw new Error(
        `${label}.directGeometryPrime must bind one exact style reference`
      );
    }
    exactKeys(
      prime.canvas,
      ['width', 'height'],
      `${label}.directGeometryPrime.canvas`
    );
    if (stableJson(prime.canvas) !== stableJson(descriptor.canvas)) {
      throw new Error(
        `${label}.directGeometryPrime.canvas must match the descriptor`
      );
    }
    assertPoint(
      prime.anchor,
      `${label}.directGeometryPrime.anchor`,
      prime.canvas
    );
    if (stableJson(prime.anchor) !== stableJson(descriptor.placement.anchor)) {
      throw new Error(
        `${label}.directGeometryPrime.anchor must match the descriptor`
      );
    }
    assertRect(
      prime.subjectBounds,
      `${label}.directGeometryPrime.subjectBounds`,
      prime.canvas
    );
    assertInteger(
      prime.coveragePermille,
      `${label}.directGeometryPrime.coveragePermille`,
      1
    );
    if (prime.coveragePermille > 1000) {
      throw new Error(
        `${label}.directGeometryPrime.coveragePermille must be <= 1000`
      );
    }
    const vectors = {
      e: {
        x: descriptor.canvas.width / 4,
        y: descriptor.canvas.height / 4
      },
      s: {
        x: -descriptor.canvas.width / 4,
        y: descriptor.canvas.height / 4
      }
    };
    const expectedCenters = ['e', 's'].flatMap(direction => (
      [50, 75, 100].map(percent => ({
        direction,
        percent,
        x: descriptor.placement.anchor.x
          + (vectors[direction].x * percent / 100),
        y: descriptor.placement.anchor.y
          + (vectors[direction].y * percent / 100)
      }))
    ));
    if (stableJson(prime.armSampleCenters) !== stableJson(expectedCenters)) {
      throw new Error(
        `${label}.directGeometryPrime.armSampleCenters are not canonical`
      );
    }
    exactKeys(
      prime.apexTopProfile,
      ['xStart', 'xStep', 'alpha240Y'],
      `${label}.directGeometryPrime.apexTopProfile`
    );
    assertInteger(
      prime.apexTopProfile.xStart,
      `${label}.directGeometryPrime.apexTopProfile.xStart`
    );
    assertInteger(
      prime.apexTopProfile.xStep,
      `${label}.directGeometryPrime.apexTopProfile.xStep`,
      1
    );
    const canonicalApexStep = prime.canvas.width / 64;
    const canonicalApexStart = prime.anchor.x - (canonicalApexStep * 4);
    if (
      !Number.isSafeInteger(canonicalApexStep)
      || prime.apexTopProfile.xStep !== canonicalApexStep
      || prime.apexTopProfile.xStart !== canonicalApexStart
    ) {
      throw new Error(
        `${label}.directGeometryPrime.apexTopProfile sampling is not canonical`
      );
    }
    if (
      !Array.isArray(prime.apexTopProfile.alpha240Y)
      || prime.apexTopProfile.alpha240Y.length !== 9
    ) {
      throw new Error(
        `${label}.directGeometryPrime.apexTopProfile.alpha240Y `
        + 'must contain nine samples'
      );
    }
    for (let index = 0;
      index < prime.apexTopProfile.alpha240Y.length;
      index += 1) {
      assertInteger(
        prime.apexTopProfile.alpha240Y[index],
        `${label}.directGeometryPrime.apexTopProfile.alpha240Y[${index}]`
      );
      const x = prime.apexTopProfile.xStart
        + (prime.apexTopProfile.xStep * index);
      if (
        x >= prime.canvas.width
        || prime.apexTopProfile.alpha240Y[index] >= prime.canvas.height
      ) {
        throw new Error(
          `${label}.directGeometryPrime.apexTopProfile exceeds the canvas`
        );
      }
    }
  }
  exactKeys(descriptor.placement, [
    'pivot',
    'anchor',
    'footprint',
    'collision',
    'drawBounds',
    'occlusionBounds',
    'stratum'
  ], `${label}.placement`);
  assertPoint(descriptor.placement.pivot, `${label}.placement.pivot`, descriptor.canvas);
  assertPoint(descriptor.placement.anchor, `${label}.placement.anchor`, descriptor.canvas);
  assertRect(descriptor.placement.footprint, `${label}.placement.footprint`, null, true);
  if (descriptor.placement.footprint.width < 1 || descriptor.placement.footprint.height < 1) {
    throw new Error(`${label}.placement.footprint must cover at least one tile`);
  }
  exactKeys(descriptor.placement.collision, ['kind', 'cells'], `${label}.placement.collision`);
  if (!COLLISION_KINDS.has(descriptor.placement.collision.kind)) {
    throw new Error(`${label}.placement.collision.kind is unsupported`);
  }
  if (!Array.isArray(descriptor.placement.collision.cells)) {
    throw new Error(`${label}.placement.collision.cells must be an array`);
  }
  descriptor.placement.collision.cells.forEach((cell, index) => {
    assertPoint(cell, `${label}.placement.collision.cells[${index}]`, {
      width: descriptor.placement.footprint.width - 1,
      height: descriptor.placement.footprint.height - 1
    });
  });
  if (descriptor.placement.collision.kind === 'none' && descriptor.placement.collision.cells.length) {
    throw new Error(`${label}.placement.collision cannot have cells for kind none`);
  }
  if (descriptor.placement.collision.kind !== 'none'
    && descriptor.placement.collision.cells.length === 0) {
    throw new Error(`${label}.placement.collision cells are required for blocking geometry`);
  }
  const uniqueCells = new Set(
    descriptor.placement.collision.cells.map(cell => `${cell.x}:${cell.y}`)
  );
  if (uniqueCells.size !== descriptor.placement.collision.cells.length) {
    throw new Error(`${label}.placement.collision cells must be unique`);
  }
  assertRect(descriptor.placement.drawBounds, `${label}.placement.drawBounds`, descriptor.canvas);
  assertRect(descriptor.placement.occlusionBounds, `${label}.placement.occlusionBounds`, descriptor.canvas);
  if (!STRATA.has(descriptor.placement.stratum)) throw new Error(`${label}.placement.stratum is unsupported`);
  const categoryContract = CATEGORY_CONTRACTS[descriptor.category];
  if (descriptor.placement.collision.kind !== categoryContract.collision
    || descriptor.placement.stratum !== categoryContract.stratum) {
    throw new Error(`${label} placement does not match the ${descriptor.category} category contract`);
  }
  const occlusionBounds = descriptor.placement.occlusionBounds;
  const hasZeroOcclusionWidth = occlusionBounds.width === 0;
  const hasZeroOcclusionHeight = occlusionBounds.height === 0;
  if (hasZeroOcclusionWidth !== hasZeroOcclusionHeight) {
    throw new Error(
      `${label}.placement.occlusionBounds must have positive width and height `
      + 'or be the canonical empty rectangle'
    );
  }
  if (hasZeroOcclusionWidth) {
    if (occlusionBounds.x !== 0 || occlusionBounds.y !== 0) {
      throw new Error(
        `${label}.placement.occlusionBounds empty rectangle must be `
        + '{x:0,y:0,width:0,height:0}'
      );
    }
    if (categoryContract.collision !== 'none') {
      throw new Error(
        `${label}.placement.occlusionBounds must be positive for the `
        + `${descriptor.category} category contract`
      );
    }
  }
  exactKeys(descriptor.content, [
    'version',
    'sourceSha256',
    'runtimeSha256',
    'immutableUrl'
  ], `${label}.content`);
  assertInteger(descriptor.content.version, `${label}.content.version`, 1);
  assertHash(descriptor.content.sourceSha256, `${label}.content.sourceSha256`, true);
  assertHash(descriptor.content.runtimeSha256, `${label}.content.runtimeSha256`, true);
  if (descriptor.content.immutableUrl !== null
    && (typeof descriptor.content.immutableUrl !== 'string'
      || !descriptor.content.immutableUrl.startsWith('/assets/battle-map-v3/'))) {
    throw new Error(`${label}.content.immutableUrl is invalid`);
  }
  if (descriptor.status === 'draft') {
    if (descriptor.source !== null
      || descriptor.content.sourceSha256 !== null
      || descriptor.content.runtimeSha256 !== null
      || descriptor.content.immutableUrl !== null) {
      throw new Error(`${label} draft state must not pin reviewed or runtime content`);
    }
  } else {
    exactKeys(descriptor.source, [
      'candidateMetadataPath',
      'imagePath',
      'imageSha256',
      'width',
      'height',
      'format',
      'reviewer',
      'approvedAt'
    ], `${label}.source`);
    resolveTracked('/project', descriptor.source.candidateMetadataPath, `${label}.source.candidateMetadataPath`);
    resolveTracked('/project', descriptor.source.imagePath, `${label}.source.imagePath`);
    assertHash(descriptor.source.imageSha256, `${label}.source.imageSha256`);
    if (descriptor.content.sourceSha256 !== descriptor.source.imageSha256) {
      throw new Error(`${label} reviewed source hash is not mirrored in content`);
    }
    assertInteger(descriptor.source.width, `${label}.source.width`, 1);
    assertInteger(descriptor.source.height, `${label}.source.height`, 1);
    if (!['png', 'webp'].includes(descriptor.source.format)) throw new Error(`${label}.source.format is unsupported`);
    const expectedCandidateMetadata =
      `ai-image-metadata/battle-art/candidates/${descriptor.theme}/${descriptor.id}/result.json`;
    if (descriptor.source.candidateMetadataPath !== expectedCandidateMetadata) {
      throw new Error(`${label}.source.candidateMetadataPath is not canonical`);
    }
    const sourceHashToken = descriptor.source.imageSha256.slice('sha256:'.length);
    const expectedSourcePath = `ai-image-metadata/battle-art/sources/${descriptor.theme}/`
      + `${descriptor.id}/v${descriptor.content.version}/${sourceHashToken}.${descriptor.source.format}`;
    if (descriptor.source.imagePath !== expectedSourcePath) {
      throw new Error(`${label}.source.imagePath is not the content-addressed reviewed source`);
    }
    if (typeof descriptor.source.reviewer !== 'string' || descriptor.source.reviewer.trim().length === 0) {
      throw new Error(`${label}.source.reviewer is required`);
    }
    if (!Number.isFinite(Date.parse(descriptor.source.approvedAt))) {
      throw new Error(`${label}.source.approvedAt is invalid`);
    }
  }
  if (descriptor.status === 'approved'
    && (descriptor.content.runtimeSha256 !== null || descriptor.content.immutableUrl !== null)) {
    throw new Error(`${label} approved state cannot pin runtime output before compilation`);
  }
  if (descriptor.status === 'compiled'
    && (descriptor.content.runtimeSha256 === null || descriptor.content.immutableUrl === null)) {
    throw new Error(`${label} compiled state must pin runtime output`);
  }
  return descriptor;
}

async function assertDirectGeometryPrimeEvidence(root, descriptor, label) {
  const prime = descriptor.directGeometryPrime;
  if (prime === undefined) return;
  const reference = descriptor.styleReferences.find(entry => (
    entry.id === prime.sourceReferenceId
    && entry.sha256 === prime.sourceSha256
  ));
  const bytes = await readPinnedRegularFile(
    root,
    reference.path,
    prime.sourceSha256,
    `${label}.directGeometryPrime source`
  );
  const measured = await measureDirectGeometryPrimeRaster({
    bytes,
    prime,
    label: `${label}.directGeometryPrime`
  });
  for (const field of [
    'subjectBounds',
    'coveragePermille',
    'armSampleCenters',
    'apexTopProfile'
  ]) {
    if (stableJson(prime[field]) !== stableJson(measured[field])) {
      throw new Error(
        `${label}.directGeometryPrime.${field} does not match the pinned `
        + 'source raster'
      );
    }
  }
}

async function assertReleaseRecord(release, root, label) {
  exactKeys(release, [
    'schemaVersion',
    'id',
    'version',
    'bundle',
    'sources'
  ], label);
  if (release.schemaVersion !== RELEASE_SCHEMA) {
    throw new Error(`${label}.schemaVersion is unsupported`);
  }
  assertSafeId(release.id, `${label}.id`);
  assertInteger(release.version, `${label}.version`, 1);
  const bundle = release.bundle;
  exactKeys(bundle, [
    'schemaVersion',
    'renderProfile',
    'id',
    'version',
    'manifestFullHash',
    'rendererManifestFullHash',
    'assets',
    'renderers'
  ], `${label}.bundle`);
  if (bundle.schemaVersion !== BUNDLE_SCHEMA
    || bundle.id !== release.id
    || bundle.version !== release.version) {
    throw new Error(`${label}.bundle identity is invalid`);
  }
  assertHash(bundle.manifestFullHash, `${label}.bundle.manifestFullHash`);
  assertHash(
    bundle.rendererManifestFullHash,
    `${label}.bundle.rendererManifestFullHash`
  );
  if (stableJson(bundle.renderProfile) !== stableJson(RENDER_PROFILE)) {
    throw new Error(`${label}.bundle render profile is unsupported`);
  }
  if (!Array.isArray(bundle.assets) || !Array.isArray(bundle.renderers)) {
    throw new Error(`${label}.bundle assets and renderers must be arrays`);
  }
  const assetKeys = new Set();
  for (const [index, asset] of bundle.assets.entries()) {
    exactKeys(asset, [
      'key',
      'contentVersion',
      'contentHash',
      'immutableUrl'
    ], `${label}.bundle.assets[${index}]`);
    assertSafeId(asset.key, `${label}.bundle.assets[${index}].key`);
    assertInteger(
      asset.contentVersion,
      `${label}.bundle.assets[${index}].contentVersion`,
      1
    );
    assertHash(asset.contentHash, `${label}.bundle.assets[${index}].contentHash`);
    if (typeof asset.immutableUrl !== 'string'
      || !asset.immutableUrl.startsWith('/assets/battle-map-v3/')
      || asset.immutableUrl.includes('\\')) {
      throw new Error(`${label}.bundle.assets[${index}].immutableUrl is invalid`);
    }
    resolveTracked(
      '/project',
      `frontend/public${asset.immutableUrl}`,
      `${label}.bundle.assets[${index}].immutableUrl`
    );
    if (assetKeys.has(asset.key)) {
      throw new Error(`${label}.bundle contains duplicate asset key ${asset.key}`);
    }
    assetKeys.add(asset.key);
  }
  const rendererKeys = new Set();
  for (const [index, renderer] of bundle.renderers.entries()) {
    const rendererLabel = `${label}.bundle.renderers[${index}]`;
    const variantRenderer = Object.hasOwn(renderer, 'variant');
    exactKeys(renderer, [
      'id',
      'theme',
      'category',
      ...(variantRenderer ? ['variant'] : []),
      'contentVersion',
      'sha256',
      'immutableUrl',
      'width',
      'height',
      'pivot',
      'anchor',
      'footprint',
      'collision',
      'drawBounds',
      'occlusionBounds',
      'stratum'
    ], rendererLabel);
    assertSafeId(renderer.id, `${rendererLabel}.id`);
    if (variantRenderer) {
      assertRuntimeVariant(renderer.variant, `${rendererLabel}.variant`);
    }
    if (rendererKeys.has(renderer.id)) {
      throw new Error(`${label}.bundle contains duplicate renderer ${renderer.id}`);
    }
    rendererKeys.add(renderer.id);
    const asset = bundle.assets.find(candidate => candidate.key === renderer.id);
    if (!asset
      || renderer.contentVersion !== asset.contentVersion
      || renderer.sha256 !== asset.contentHash
      || renderer.immutableUrl !== asset.immutableUrl) {
      throw new Error(`${rendererLabel} does not match its asset record`);
    }
  }
  if (rendererKeys.size !== assetKeys.size) {
    throw new Error(`${label}.bundle renderer membership is incomplete`);
  }
  const expectedRendererHash =
    await computeBattleArtRendererManifestFullHash(bundle);
  if (bundle.rendererManifestFullHash !== expectedRendererHash) {
    throw new Error(`${label}.bundle renderer manifest hash mismatch`);
  }
  const expectedManifestHash =
    await computeTemplateMapAssetBundleManifestFullHash(toCompilerAssetBundle(bundle));
  if (bundle.manifestFullHash !== expectedManifestHash) {
    throw new Error(`${label}.bundle manifest hash mismatch`);
  }
  if (!Array.isArray(release.sources)) {
    throw new Error(`${label}.sources must be an array`);
  }
  const sourcePaths = new Set();
  for (const [index, source] of release.sources.entries()) {
    const sourceLabel = `${label}.sources[${index}]`;
    exactKeys(source, [
      'familyId',
      'contentVersion',
      'path',
      'sha256',
      'width',
      'height',
      'format'
    ], sourceLabel);
    assertSafeId(source.familyId, `${sourceLabel}.familyId`);
    assertInteger(source.contentVersion, `${sourceLabel}.contentVersion`, 1);
    assertRolePath(
      source.path,
      ['ai-image-metadata/battle-art/sources/'],
      ['.png', '.webp'],
      `${sourceLabel}.path`
    );
    assertHash(source.sha256, `${sourceLabel}.sha256`);
    assertInteger(source.width, `${sourceLabel}.width`, 1);
    assertInteger(source.height, `${sourceLabel}.height`, 1);
    if (!['png', 'webp'].includes(source.format)) {
      throw new Error(`${sourceLabel}.format is unsupported`);
    }
    if (sourcePaths.has(source.path)) {
      throw new Error(`${label}.sources contains duplicate path ${source.path}`);
    }
    sourcePaths.add(source.path);
    const inspected = await inspectImage(root, source.path);
    if (inspected.sha256 !== source.sha256
      || inspected.width !== source.width
      || inspected.height !== source.height
      || inspected.format !== source.format) {
      throw new Error(`${sourceLabel} content pin mismatch`);
    }
  }
  for (const [index, asset] of bundle.assets.entries()) {
    const runtimePath = resolveTracked(
      root,
      `frontend/public${asset.immutableUrl}`,
      `${label}.bundle.assets[${index}] runtime path`
    );
    if (await hashFile(runtimePath) !== asset.contentHash) {
      throw new Error(`${label}.bundle.assets[${index}] runtime content pin mismatch`);
    }
  }
  return release;
}

async function validateCorrectiveStyleReferenceEvidence(root, entry) {
  const bytes = await readPinnedRegularFile(
    root,
    entry.failureRecord.path,
    entry.failureRecord.sha256,
    `${entry.id} corrective failure record`
  );
  let record;
  try {
    record = JSON.parse(bytes);
  } catch {
    throw new Error(`${entry.id} corrective failure record must be valid JSON`);
  }
  exactKeys(record, [
    'schemaVersion',
    'theme',
    'familyId',
    'raw',
    'descriptor',
    'prompt',
    'worker',
    'audit',
    'rejection',
    'fullHash'
  ], `${entry.id} corrective failure record`);
  if (record.schemaVersion !== 'battle-art-route-failed-attempt-v1') {
    throw new Error(`${entry.id} corrective failure record schema is unsupported`);
  }
  exactKeys(record.raw, [
    'path',
    'bytes',
    'width',
    'height',
    'format',
    'sha256'
  ], `${entry.id} corrective failure record.raw`);
  if (
    record.fullHash !== entry.failureRecord.fullHash
    || record.theme !== entry.consumer.theme
    || record.familyId !== entry.consumer.familyId
    || record.raw.path !== entry.raw.path
    || record.raw.sha256 !== entry.raw.sha256
  ) {
    throw new Error(
      `${entry.id} corrective failure record does not match its registry tuple`
    );
  }
  return record;
}

async function loadBattleArtManifest(rootValue) {
  const root = projectRoot(rootValue);
  const correctiveStyleReferenceRegistry =
    await loadCorrectiveStyleReferenceRegistry(root);
  const { value: manifest } = await readJson(root, MANIFEST_PATH, 'battle-art manifest');
  exactKeys(manifest, [
    'schemaVersion',
    'releaseId',
    'version',
    'frozen',
    'themes',
    'categories',
    'promptProfile',
    'styleReferences',
    'descriptors',
    'historicalReleases'
  ], 'battle-art manifest');
  if (manifest.schemaVersion !== 'battle-art-manifest-v1') throw new Error('battle-art manifest schema is unsupported');
  assertSafeId(manifest.releaseId, 'battle-art manifest.releaseId');
  assertInteger(manifest.version, 'battle-art manifest.version', 1);
  if (manifest.frozen !== true) throw new Error('battle-art manifest must be frozen');
  if (stableJson(manifest.themes) !== stableJson(THEMES)) throw new Error('battle-art manifest themes must list all 16 supported themes');
  const categoryProjection = stableJson(manifest.categories);
  if (categoryProjection !== stableJson(LEGACY_CATEGORIES)
    && categoryProjection !== stableJson(CATEGORIES)) {
    throw new Error(
      'battle-art manifest categories must be the complete v1 or v2 supported set'
    );
  }
  assertPin(manifest.promptProfile, 'battle-art manifest.promptProfile');
  assertRolePath(
    manifest.promptProfile.path,
    ['ai-image-metadata/battle-art/prompts/'],
    ['.json'],
    'battle-art manifest.promptProfile.path'
  );
  if (!Array.isArray(manifest.styleReferences) || manifest.styleReferences.length === 0) {
    throw new Error('battle-art manifest.styleReferences must be non-empty');
  }
  const styleReferenceIdentities = new Set();
  const correctiveReferences = [];
  manifest.styleReferences.forEach((pin, index) => {
    assertPin(pin, `battle-art manifest.styleReferences[${index}]`);
    const corrective = correctiveStyleReferenceEntry(pin);
    const correctiveIdentity =
      correctiveStyleReferenceRegistry.entries.find(entry => (
        entry.id === pin.id
      ));
    if (corrective === null && correctiveIdentity !== undefined) {
      throw new Error(`${pin.id} corrective registry identity mismatch`);
    }
    if (corrective === null) {
      assertRolePath(
        pin.path,
        [
          'ai-image-metadata/battle-art/style-references/',
          'ai-image-metadata/battle-art/sources/',
          'ai-image-metadata/battle-maps/sources/'
        ],
        ['.png', '.webp'],
        `battle-art manifest.styleReferences[${index}].path`
      );
    } else {
      const registered = correctiveStyleReferenceRegistry.entries.find(
        entry => entry.id === corrective.id
      );
      if (registered === undefined
        || stableJson(registered) !== stableJson(corrective)) {
        throw new Error(`${pin.id} corrective registry identity mismatch`);
      }
      correctiveReferences.push(corrective);
    }
    const identity = `${pin.id}\u0000${pin.path}\u0000${pin.sha256}`;
    if (styleReferenceIdentities.has(identity)) {
      throw new Error('battle-art manifest has duplicate style references');
    }
    styleReferenceIdentities.add(identity);
  });
  for (const corrective of correctiveReferences) {
    await validateCorrectiveStyleReferenceEvidence(root, corrective);
  }
  const pins = [manifest.promptProfile, ...manifest.styleReferences];
  for (const pin of pins) {
    await readPinnedRegularFile(root, pin.path, pin.sha256, pin.id);
  }
  const promptProfile = await promptProfileFor(root, manifest);
  if (!Array.isArray(manifest.descriptors)) throw new Error('battle-art manifest.descriptors must be an array');
  const descriptorPaths = [...manifest.descriptors].sort();
  if (new Set(descriptorPaths).size !== descriptorPaths.length) throw new Error('battle-art manifest has duplicate descriptor paths');
  descriptorPaths.forEach(descriptorPath => assertRolePath(
    descriptorPath,
    ['ai-image-metadata/battle-art/descriptors/'],
    ['.json'],
    'battle-art descriptor path'
  ));
  return {
    root,
    manifest,
    promptProfile,
    descriptorPaths,
    correctiveStyleReferenceRegistry
  };
}

async function assertDirectStyleReferenceProvenance({
  root,
  manifest,
  descriptors,
  historicalReleases
}) {
  const directReferences = manifest.styleReferences.filter(reference => (
    reference.path.startsWith('ai-image-metadata/battle-art/sources/')
  ));
  const currentOwnerByReference = new Map();
  for (const reference of directReferences) {
    const canonical = reference.path.match(
      /^ai-image-metadata\/battle-art\/sources\/([^/]+)\/([^/]+)\/v([1-9][0-9]*)\/([0-9a-f]{64})\.(png|webp)$/
    );
    if (!canonical
      || reference.sha256 !== `sha256:${canonical[4]}`) {
      throw new Error(`${reference.id} direct source path is not canonical`);
    }
    const [, sourceTheme, sourceFamily, sourceVersion, , sourceFormat] = canonical;
    const currentOwners = descriptors.filter(({ descriptor }) => (
      descriptor.source !== null
      && descriptor.source.imagePath === reference.path
      && descriptor.source.imageSha256 === reference.sha256
    ));
    if (currentOwners.length > 1) {
      throw new Error(`${reference.id} has ambiguous current descriptor ownership`);
    }
    if (currentOwners.length === 1) {
      const [owner] = currentOwners;
      if (!['approved', 'compiled'].includes(owner.descriptor.status)) {
        throw new Error(`${reference.id} current descriptor owner is not approved`);
      }
      if (owner.descriptor.theme !== sourceTheme
        || owner.descriptor.id !== sourceFamily
        || owner.descriptor.content.version !== Number(sourceVersion)
        || owner.descriptor.source.format !== sourceFormat) {
        throw new Error(`${reference.id} current descriptor ownership is not canonical`);
      }
      if (owner.descriptor.styleReferences.some(pin => (
        pin.path === reference.path && pin.sha256 === reference.sha256
      ))) {
        throw new Error(`${reference.id} is an unsafe current self-reference`);
      }
      const relative = reviewRecordPath(
        owner.descriptor.theme,
        owner.descriptor.id,
        reference.sha256
      );
      const review = await readExistingReview(root, relative);
      const expectedDescriptorPin = sha256(Buffer.from(stableJson(
        draftDescriptorProjection(owner.descriptor)
      )));
      const reviewSourceApproval =
        review?.schemaVersion === COMPILED_SOURCE_ATTESTATION_SCHEMA
          ? review.source
          : {
              reviewer: review?.reviewer,
              approvedAt: review?.reviewedAt
            };
      if (
        review === null
        || review.decision !== 'approved'
        || review.familyId !== owner.descriptor.id
        || review.theme !== owner.descriptor.theme
        || (
          review.schemaVersion === COMPILED_SOURCE_ATTESTATION_SCHEMA
          && stableJson(review.source) !== stableJson(owner.descriptor.source)
        )
        || reviewSourceApproval.reviewer !== owner.descriptor.source.reviewer
        || reviewSourceApproval.approvedAt !== owner.descriptor.source.approvedAt
        || review.descriptor.path !== owner.path
        || review.descriptor.contentVersion !== owner.descriptor.content.version
        || review.descriptor.sha256 !== expectedDescriptorPin
        || review.candidate.metadata.path
          !== owner.descriptor.source.candidateMetadataPath
        || review.candidate.image.sha256 !== reference.sha256
        || review.candidate.image.width !== owner.descriptor.source.width
        || review.candidate.image.height !== owner.descriptor.source.height
        || review.candidate.image.format !== owner.descriptor.source.format
        || stableJson(review.candidate.promptProfile)
          !== stableJson(owner.descriptor.promptProfile)
        || stableJson(review.candidate.styleReferences)
          !== stableJson(owner.descriptor.styleReferences)
      ) {
        throw new Error(
          `${reference.id} current source has no matching immutable approved review`
        );
      }
      currentOwnerByReference.set(reference.path, owner.descriptor.id);
      continue;
    }
    const historicalOwners = new Map();
    for (const { release } of historicalReleases) {
      for (const source of release.sources) {
        if (source.path === reference.path && source.sha256 === reference.sha256) {
          if (source.familyId !== sourceFamily
            || source.contentVersion !== Number(sourceVersion)
            || source.format !== sourceFormat) {
            throw new Error(
              `${reference.id} historical release ownership is not canonical`
            );
          }
          historicalOwners.set(
            `${source.familyId}:v${source.contentVersion}`,
            source
          );
        }
      }
    }
    if (historicalOwners.size === 0) {
      throw new Error(
        `${reference.id} has no approved descriptor or historical release ownership`
      );
    }
    if (historicalOwners.size > 1) {
      throw new Error(`${reference.id} has ambiguous historical release ownership`);
    }
    const [historicalSource] = historicalOwners.values();
    const relative = reviewRecordPath(
      sourceTheme,
      historicalSource.familyId,
      historicalSource.sha256
    );
    const review = await readExistingReview(root, relative);
    if (
      review === null
      || review.decision !== 'approved'
      || review.theme !== sourceTheme
      || review.familyId !== historicalSource.familyId
      || review.descriptor.contentVersion !== historicalSource.contentVersion
      || review.candidate.image.sha256 !== historicalSource.sha256
      || review.candidate.image.width !== historicalSource.width
      || review.candidate.image.height !== historicalSource.height
      || review.candidate.image.format !== historicalSource.format
    ) {
      throw new Error(
        `${reference.id} historical source has no matching immutable approved review`
      );
    }
  }

  const edges = new Map(descriptors.map(({ descriptor }) => [descriptor.id, new Set()]));
  for (const { descriptor } of descriptors) {
    for (const reference of descriptor.styleReferences) {
      const ownerId = currentOwnerByReference.get(reference.path);
      if (ownerId !== undefined) edges.get(descriptor.id).add(ownerId);
    }
  }
  const active = new Set();
  const complete = new Set();
  function visit(id) {
    if (active.has(id)) {
      throw new Error(`cyclic direct-source style provenance includes ${id}`);
    }
    if (complete.has(id)) return;
    active.add(id);
    for (const ownerId of edges.get(id) ?? []) visit(ownerId);
    active.delete(id);
    complete.add(id);
  }
  for (const id of edges.keys()) visit(id);
}

async function loadBattleArtState(rootValue, {
  allowedUnmanifestedDescriptor = null
} = {}) {
  const {
    root,
    manifest,
    promptProfile,
    descriptorPaths,
    correctiveStyleReferenceRegistry
  } = await loadBattleArtManifest(rootValue);
  if (allowedUnmanifestedDescriptor !== null) {
    assertRolePath(
      allowedUnmanifestedDescriptor,
      ['ai-image-metadata/battle-art/descriptors/'],
      ['.json'],
      'allowed unmanifested descriptor path'
    );
    if (descriptorPaths.includes(allowedUnmanifestedDescriptor)) {
      throw new Error('allowed unmanifested descriptor is already manifested');
    }
  }
  const descriptorRoot = resolveTracked(
    root,
    'ai-image-metadata/battle-art/descriptors',
    'descriptor root'
  );
  const discoveredDescriptorPaths = [];
  async function discoverDescriptors(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`descriptor tree contains symlink ${absolute}`);
      if (entry.isDirectory()) await discoverDescriptors(absolute);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        discoveredDescriptorPaths.push(path.relative(root, absolute).split(path.sep).join('/'));
      } else {
        throw new Error(`descriptor tree contains unsupported entry ${absolute}`);
      }
    }
  }
  await discoverDescriptors(descriptorRoot);
  discoveredDescriptorPaths.sort();
  const expectedDiscoveredDescriptorPaths = (
    allowedUnmanifestedDescriptor !== null
    && discoveredDescriptorPaths.includes(allowedUnmanifestedDescriptor)
  )
    ? [...descriptorPaths, allowedUnmanifestedDescriptor].sort()
    : descriptorPaths;
  if (
    stableJson(discoveredDescriptorPaths)
    !== stableJson(expectedDiscoveredDescriptorPaths)
  ) {
    throw new Error('battle-art descriptor manifest is incomplete');
  }
  if (!Array.isArray(manifest.historicalReleases)) {
    throw new Error('battle-art manifest.historicalReleases must be an array');
  }
  const historicalReleasePaths = [...manifest.historicalReleases].sort();
  if (new Set(historicalReleasePaths).size !== historicalReleasePaths.length) {
    throw new Error('battle-art manifest has duplicate historical release paths');
  }
  historicalReleasePaths.forEach(releasePath => assertRolePath(
    releasePath,
    ['ai-image-metadata/battle-art/releases/'],
    ['.json'],
    'battle-art historical release path'
  ));
  const historicalReleases = [];
  const releaseIdentities = new Set();
  for (const releasePath of historicalReleasePaths) {
    const { value: release } = await readJson(
      root,
      releasePath,
      `historical release ${releasePath}`
    );
    await assertReleaseRecord(release, root, `historical release ${releasePath}`);
    const canonicalPath =
      `ai-image-metadata/battle-art/releases/${release.id}.v${release.version}.json`;
    if (releasePath !== canonicalPath) {
      throw new Error(`historical release ${releasePath} path is not canonical`);
    }
    const identity = `${release.id}:v${release.version}`;
    if (releaseIdentities.has(identity)) {
      throw new Error(`duplicate historical battle-art release ${identity}`);
    }
    releaseIdentities.add(identity);
    historicalReleases.push({ path: releasePath, release });
  }
  const descriptors = [];
  const ids = new Set();
  for (const descriptorPath of descriptorPaths) {
    const { value } = await readJson(root, descriptorPath, `descriptor ${descriptorPath}`);
    assertDescriptor(value, manifest, `descriptor ${descriptorPath}`);
    await assertDirectGeometryPrimeEvidence(
      root,
      value,
      `descriptor ${descriptorPath}`
    );
    if (ids.has(value.id)) throw new Error(`duplicate battle-art family id ${value.id}`);
    ids.add(value.id);
    for (const pin of value.styleReferences) {
      const declared = manifest.styleReferences.find(reference => (
        reference.id === pin.id
        && reference.path === pin.path
        && reference.sha256 === pin.sha256
      ));
      if (!declared) throw new Error(`${value.id} uses an unmanifested style reference`);
      correctiveStyleReferenceForConsumer(pin, {
        theme: value.theme,
        familyId: value.id
      }, `${value.id} style reference ${pin.id}`);
    }
    descriptors.push({ path: descriptorPath, descriptor: value });
  }
  await assertDirectStyleReferenceProvenance({
    root,
    manifest,
    descriptors,
    historicalReleases
  });
  async function discoverOwnedFiles(relativeRoot, extensions) {
    const directoryRoot = resolveTracked(root, relativeRoot, 'owned asset root');
    const files = [];
    async function visit(directory) {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) throw new Error(`owned asset tree contains symlink ${absolute}`);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && extensions.some(extension => entry.name.endsWith(extension))) {
          files.push(path.relative(root, absolute).split(path.sep).join('/'));
        } else {
          throw new Error(`owned asset tree contains unsupported entry ${absolute}`);
        }
      }
    }
    await visit(directoryRoot);
    return files.sort();
  }
  const expectedSources = [
    ...descriptors
    .filter(entry => entry.descriptor.source !== null)
    .map(entry => entry.descriptor.source.imagePath),
    ...historicalReleases.flatMap(entry => entry.release.sources.map(source => source.path)),
    ...manifest.styleReferences
    .map(reference => reference.path)
    .filter(referencePath => (
      referencePath.startsWith('ai-image-metadata/battle-art/sources/')
    ))
  ].filter((value, index, values) => values.indexOf(value) === index).sort();
  const discoveredSources = await discoverOwnedFiles(
    'ai-image-metadata/battle-art/sources',
    ['.png', '.webp']
  );
  if (stableJson(discoveredSources) !== stableJson(expectedSources)) {
    throw new Error('battle-art reviewed source membership is incomplete');
  }
  const expectedRuntime = [
    ...descriptors
    .filter(entry => entry.descriptor.status === 'compiled')
    .map(entry => `frontend/public${entry.descriptor.content.immutableUrl}`),
    ...historicalReleases.flatMap(entry => (
      entry.release.bundle.assets.map(asset => `frontend/public${asset.immutableUrl}`)
    ))
  ].filter((value, index, values) => values.indexOf(value) === index).sort();
  const discoveredRuntime = await discoverOwnedFiles(RUNTIME_ROOT, ['.webp']);
  if (stableJson(discoveredRuntime) !== stableJson(expectedRuntime)) {
    throw new Error('battle-art runtime asset membership is incomplete');
  }
  return {
    root,
    manifest,
    promptProfile,
    descriptors,
    historicalReleases,
    correctiveStyleReferenceRegistry
  };
}

export async function loadBattleArt(rootValue) {
  return loadBattleArtState(rootValue);
}

function normalizeFamilySelection({ family = null, families = null }) {
  const values = families ?? (family === null ? [] : [family]);
  if (!Array.isArray(values)) throw new Error('--family selection must be an array');
  values.forEach(value => assertSafeId(value, '--family'));
  return new Set(values);
}

export function selectFamilies(loaded, {
  theme = null,
  family = null,
  families = null,
  category = null,
  ecologyProfile = null,
  tier = null,
  surfaceVariant = null
} = {}) {
  if (theme !== null && !THEMES.includes(theme)) throw new Error(`unsupported theme ${theme}`);
  if (category !== null && !CATEGORIES.includes(category)) {
    throw new Error(`unsupported category ${category}`);
  }
  if (ecologyProfile !== null) assertSafeId(ecologyProfile, '--ecology-profile');
  if (tier !== null) {
    assertInteger(tier, '--tier', 1);
    if (!TIER_BANDS.includes(tier)) {
      throw new Error(`--tier must be between 1 and ${TIER_BANDS.at(-1)}`);
    }
  }
  if (surfaceVariant !== null
    && (!Number.isSafeInteger(surfaceVariant)
      || surfaceVariant < 0
      || surfaceVariant > 7)) {
    throw new Error('--surface-variant must be an integer from 0 through 7');
  }
  const selectedFamilies = normalizeFamilySelection({ family, families });
  const selected = loaded.descriptors.filter(entry => (
    (theme === null || entry.descriptor.theme === theme)
    && (selectedFamilies.size === 0 || selectedFamilies.has(entry.descriptor.id))
    && (category === null || entry.descriptor.category === category)
    && (ecologyProfile === null || (
      entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
      && entry.descriptor.capabilities.ecologyProfile === ecologyProfile
    ))
    && (tier === null || (
      entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
      && entry.descriptor.capabilities.tierBands.includes(tier)
    ))
    && (surfaceVariant === null || (
      entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
      && entry.descriptor.capabilities.surfaceVariant === surfaceVariant
    ))
  ));
  if (selected.length === 0) throw new Error('no battle-art families matched the selection');
  return selected;
}

function assertReadinessRequirement(requirement, label) {
  exactKeys(requirement, [
    'descriptorId',
    'familyGroup',
    'variantId',
    'category',
    'direction',
    'routeTopology',
    'surfaceVariant',
    'heightDelta'
  ], label);
  if (requirement.descriptorId !== null) {
    assertSafeId(requirement.descriptorId, `${label}.descriptorId`);
  }
  assertSafeId(requirement.familyGroup, `${label}.familyGroup`);
  assertSafeId(requirement.variantId, `${label}.variantId`);
  if (!CATEGORIES.includes(requirement.category)) {
    throw new Error(`${label}.category is unsupported`);
  }
  assertNullableEnum(requirement.direction, DIRECTIONS, `${label}.direction`);
  assertNullableEnum(
    requirement.routeTopology,
    ROUTE_TOPOLOGIES,
    `${label}.routeTopology`
  );
  if (requirement.surfaceVariant !== null
    && (!Number.isSafeInteger(requirement.surfaceVariant)
      || requirement.surfaceVariant < 0
      || requirement.surfaceVariant > 7)) {
    throw new Error(
      `${label}.surfaceVariant must be null or an integer from 0 through 7`
    );
  }
  if (!Number.isSafeInteger(requirement.heightDelta)
    || requirement.heightDelta < 0
    || requirement.heightDelta > 64) {
    throw new Error(`${label}.heightDelta must be an integer between 0 and 64`);
  }
  assertCategoryCapabilityClosure(requirement.category, {
    direction: requirement.direction,
    routeTopology: requirement.routeTopology,
    surfaceVariant: requirement.surfaceVariant,
    heightDeltas: [requirement.heightDelta]
  }, label);
}

export function assertReadinessPlan(plan, label = 'battle-art readiness plan') {
  exactKeys(plan, ['schemaVersion', 'plans'], label);
  if (plan.schemaVersion !== READINESS_PLAN_SCHEMA) {
    throw new Error(`${label}.schemaVersion is unsupported`);
  }
  if (!Array.isArray(plan.plans) || plan.plans.length === 0) {
    throw new Error(`${label}.plans must be a non-empty array`);
  }
  const planKeys = new Set();
  const requirementKeys = new Set();
  const descriptorSignatures = new Map();
  for (const [planIndex, entry] of plan.plans.entries()) {
    const entryLabel = `${label}.plans[${planIndex}]`;
    exactKeys(entry, [
      'theme',
      'ecologyProfile',
      'tierBand',
      ...(Object.hasOwn(entry, 'artDirection') ? ['artDirection'] : []),
      'requirements'
    ], entryLabel);
    if (!THEMES.includes(entry.theme)) {
      throw new Error(`${entryLabel}.theme is unsupported`);
    }
    assertSafeId(entry.ecologyProfile, `${entryLabel}.ecologyProfile`);
    if (Object.hasOwn(entry, 'artDirection')) {
      assertArtDirection(entry.artDirection, `${entryLabel}.artDirection`);
    }
    assertInteger(entry.tierBand, `${entryLabel}.tierBand`, 1);
    if (entry.tierBand > TIER_BANDS.at(-1)) {
      throw new Error(
        `${entryLabel}.tierBand must be <= ${TIER_BANDS.at(-1)}`
      );
    }
    if (!Array.isArray(entry.requirements) || entry.requirements.length === 0) {
      throw new Error(`${entryLabel}.requirements must be a non-empty array`);
    }
    const planKey = `${entry.theme}:${entry.ecologyProfile}:${entry.tierBand}`;
    if (planKeys.has(planKey)) {
      throw new Error(`${label} has duplicate plan ${planKey}`);
    }
    planKeys.add(planKey);
    for (const [requirementIndex, requirement] of entry.requirements.entries()) {
      const requirementLabel =
        `${entryLabel}.requirements[${requirementIndex}]`;
      assertReadinessRequirement(requirement, requirementLabel);
      if (requirement.descriptorId !== null) {
        const signature = stableJson({
          theme: entry.theme,
          ecologyProfile: entry.ecologyProfile,
          artDirection: entry.artDirection ?? null,
          familyGroup: requirement.familyGroup,
          variantId: requirement.variantId,
          category: requirement.category,
          direction: requirement.direction,
          routeTopology: requirement.routeTopology,
          surfaceVariant: requirement.surfaceVariant,
          heightDelta: requirement.heightDelta
        });
        const existingSignature = descriptorSignatures.get(
          requirement.descriptorId
        );
        if (existingSignature !== undefined
          && existingSignature !== signature) {
          throw new Error(
            `${label} descriptorId ${requirement.descriptorId} has conflicting `
            + 'capabilities across plan rows'
          );
        }
        descriptorSignatures.set(requirement.descriptorId, signature);
      }
      const requirementKey = [
        planKey,
        requirement.descriptorId ?? '*',
        requirement.familyGroup,
        requirement.variantId,
        requirement.category,
        requirement.direction ?? '-',
        requirement.routeTopology ?? '-',
        requirement.surfaceVariant ?? '-',
        requirement.heightDelta
      ].join(':');
      if (requirementKeys.has(requirementKey)) {
        throw new Error(
          `${label} has ambiguous duplicate requirement ${requirementKey}`
        );
      }
      requirementKeys.add(requirementKey);
    }
  }
  return plan;
}

export async function loadReadinessPlan(
  rootValue,
  relative = READINESS_PLAN_PATH,
  { required = true } = {}
) {
  const root = projectRoot(rootValue);
  if (!await exists(root, relative)) {
    if (!required) return null;
    throw new Error(`battle-art readiness plan is missing at ${relative}`);
  }
  const { value } = await readJson(root, relative, 'battle-art readiness plan');
  assertReadinessPlan(value);
  return { path: relative, plan: value };
}

function readinessSelectionMatches(
  entry,
  requirement,
  { theme, ecologyProfile, tier, category, families, surfaceVariant }
) {
  const familySelection = new Set(families ?? []);
  return (theme === null || entry.theme === theme)
    && (ecologyProfile === null || entry.ecologyProfile === ecologyProfile)
    && (tier === null || entry.tierBand === tier)
    && (category === null || requirement.category === category)
    && (surfaceVariant === null
      || requirement.surfaceVariant === surfaceVariant)
    && (familySelection.size === 0
      || (requirement.descriptorId !== null
        && familySelection.has(requirement.descriptorId)));
}

function descriptorMatchesRequirement(descriptor, planEntry, requirement) {
  if (descriptor.theme !== planEntry.theme
    || descriptor.category !== requirement.category) return false;
  if (descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V1) {
    return requirement.descriptorId !== null
      && descriptor.id === requirement.descriptorId;
  }
  return descriptor.familyGroup === requirement.familyGroup
    && descriptor.variantId === requirement.variantId
    && descriptor.capabilities.direction === requirement.direction
    && descriptor.capabilities.routeTopology === requirement.routeTopology
    && descriptor.capabilities.surfaceVariant === requirement.surfaceVariant
    && descriptor.capabilities.ecologyProfile === planEntry.ecologyProfile
    && descriptor.capabilities.tierBands.includes(planEntry.tierBand)
    && descriptor.capabilities.heightDeltas.includes(requirement.heightDelta);
}

export function assertV2DescriptorsPlanned(
  descriptors,
  plan,
  label = 'battle-art readiness plan'
) {
  assertReadinessPlan(plan, label);
  for (const entry of descriptors) {
    const descriptor = entry.descriptor ?? entry;
    if (descriptor.schemaVersion !== DESCRIPTOR_SCHEMA_V2) continue;
    const references = plan.plans.flatMap(planEntry => (
      planEntry.requirements
        .filter(requirement => requirement.descriptorId === descriptor.id)
        .map(requirement => ({ planEntry, requirement }))
    ));
    if (references.length === 0) {
      throw new Error(
        `${descriptor.id} is a v2 descriptor not declared by the reviewed `
        + 'readiness plan'
      );
    }
    if (references.some(({ planEntry, requirement }) => (
      !descriptorMatchesRequirement(descriptor, planEntry, requirement)
    ))) {
      throw new Error(
        `${descriptor.id} does not match its reviewed readiness requirement(s)`
      );
    }
    const plannedTiers = [...new Set(
      references.map(({ planEntry }) => planEntry.tierBand)
    )].sort((left, right) => left - right);
    if (stableJson(plannedTiers)
      !== stableJson(descriptor.capabilities.tierBands)) {
      throw new Error(
        `${descriptor.id} tier bands do not exactly match its reviewed `
        + 'readiness plan rows'
      );
    }
  }
}

export function buildReadinessMatrix(loaded, plan, {
  theme = null,
  ecologyProfile = null,
  tier = null,
  category = null,
  families = [],
  surfaceVariant = null
} = {}) {
  assertReadinessPlan(plan);
  if (theme !== null && !THEMES.includes(theme)) {
    throw new Error(`unsupported theme ${theme}`);
  }
  if (ecologyProfile !== null) {
    assertSafeId(ecologyProfile, '--ecology-profile');
  }
  if (tier !== null) assertInteger(tier, '--tier', 1);
  if (category !== null && !CATEGORIES.includes(category)) {
    throw new Error(`unsupported category ${category}`);
  }
  if (surfaceVariant !== null
    && (!Number.isSafeInteger(surfaceVariant)
      || surfaceVariant < 0
      || surfaceVariant > 7)) {
    throw new Error('--surface-variant must be an integer from 0 through 7');
  }
  families.forEach(family => assertSafeId(family, '--family'));
  const rows = [];
  for (const planEntry of plan.plans) {
    for (const requirement of planEntry.requirements) {
      if (!readinessSelectionMatches(planEntry, requirement, {
        theme,
        ecologyProfile,
        tier,
        category,
        families,
        surfaceVariant
      })) continue;
      const capabilityMatches = loaded.descriptors.filter(entry => (
        descriptorMatchesRequirement(
          entry.descriptor,
          planEntry,
          requirement
        )
      ));
      const matches = requirement.descriptorId === null
        ? capabilityMatches
        : capabilityMatches.filter(entry => (
            entry.descriptor.id === requirement.descriptorId
          ));
      const ambiguous = matches.length > 1
        || capabilityMatches.length > matches.length;
      rows.push({
        theme: planEntry.theme,
        ecologyProfile: planEntry.ecologyProfile,
        tierBand: planEntry.tierBand,
        requirement: structuredClone(requirement),
        status: ambiguous
          ? 'ambiguous'
          : matches.length === 0
          ? 'missing'
          : 'present',
        matches: capabilityMatches.map(entry => ({
          id: entry.descriptor.id,
          descriptorPath: entry.path,
          status: entry.descriptor.status,
          schemaVersion: entry.descriptor.schemaVersion
        }))
      });
    }
  }
  if (rows.length === 0) {
    throw new Error('no battle-art readiness requirements matched the selection');
  }
  return {
    schemaVersion: READINESS_PLAN_SCHEMA,
    plans: new Set(rows.map(row => (
      `${row.theme}:${row.ecologyProfile}:${row.tierBand}`
    ))).size,
    required: rows.length,
    present: rows.filter(row => row.status === 'present').length,
    missing: rows.filter(row => row.status === 'missing').length,
    ambiguous: rows.filter(row => row.status === 'ambiguous').length,
    rows
  };
}

export async function reportReadinessMatrix({
  root: rootValue,
  plan = READINESS_PLAN_PATH,
  metadataOnly = false,
  ...selection
} = {}) {
  const loaded = await loadBattleArt(rootValue);
  const readiness = await loadReadinessPlan(loaded.root, plan);
  const matrix = buildReadinessMatrix(loaded, readiness.plan, selection);
  if (matrix.ambiguous > 0) {
    throw new Error(
      `battle-art readiness has ${matrix.ambiguous} ambiguous requirement(s)`
    );
  }
  if (!metadataOnly && matrix.missing > 0) {
    throw new Error(
      `battle-art readiness is missing ${matrix.missing} concrete family requirement(s)`
    );
  }
  return {
    ok: matrix.ambiguous === 0 && (metadataOnly || matrix.missing === 0),
    metadataOnly,
    plan: readiness.path,
    ...matrix
  };
}

const CATEGORY_DEFAULTS = Object.freeze({
  surface: {
    canvas: { width: 256, height: 128 },
    anchorYRatio: [1, 2],
    stratum: 'surface',
    collision: 'none'
  },
  'route-transition': {
    canvas: { width: 256, height: 128 },
    anchorYRatio: [1, 2],
    stratum: 'route',
    collision: 'none'
  },
  'connection-stairs': {
    canvas: { width: 256, height: 192 },
    anchorYRatio: [2, 3],
    stratum: 'connection',
    collision: 'connection'
  },
  'connection-slope': {
    canvas: { width: 256, height: 192 },
    anchorYRatio: [2, 3],
    stratum: 'connection',
    collision: 'connection'
  },
  'exposed-face-boundary': {
    canvas: { width: 256, height: 256 },
    anchorYRatio: [3, 4],
    stratum: 'boundary',
    collision: 'boundary'
  },
  'blocking-obstacle': {
    canvas: { width: 192, height: 256 },
    anchorYRatio: [7, 8],
    stratum: 'obstacle',
    collision: 'solid'
  },
  'nonblocking-decoration': {
    canvas: { width: 128, height: 192 },
    anchorYRatio: [5, 6],
    stratum: 'decoration',
    collision: 'none'
  }
});

const BASELINE_TEMPLATE_ROOT =
  'ai-image-metadata/battle-maps/sources/';

function baselineStyleReference(manifest, theme) {
  const baselineId = `${theme.replaceAll('_', '-')}-source-template-01`;
  const themeRoot = `${BASELINE_TEMPLATE_ROOT}${theme}/`;
  const baseline = manifest.styleReferences.find(reference => (
    correctiveStyleReferenceEntry(reference) === null
    && reference.id === baselineId
    && reference.path.startsWith(themeRoot)
  ));
  if (!baseline) {
    throw new Error(
      `battle-art manifest has no baseline template style reference for theme ${theme}`
    );
  }
  return [structuredClone(baseline)];
}

function existingDraftStyleReferences(manifest, theme, existing) {
  const specialReferences = existing.filter(reference => (
    !(
      reference.path.startsWith(BASELINE_TEMPLATE_ROOT)
      && reference.id.endsWith('-source-template-01')
    )
  ));
  return [
    ...baselineStyleReference(manifest, theme),
    ...structuredClone(specialReferences)
  ];
}

function deterministicRouteFinishing({
  theme,
  category,
  id,
  familyGroup,
  variantId,
  capabilities
}) {
  if (theme !== 'cave'
    || category !== 'route-transition'
    || familyGroup !== 'cave-limestone-curved-passage'
    || capabilities.ecologyProfile !== 'cave-limestone') {
    return null;
  }
  const cornerContracts = {
    'cave-limestone-curved-passage-corner-sw': {
      variantId: 'corner-sw',
      topology: 'corner-sw',
      maximumDetachedCoveredPermille: 1,
      arms: {
        s: {
          perpendicularScalePermille: 1150,
          perpendicularOffsetPixels: -6,
          transitionStartPermille: 500,
          transitionEndPermille: 1000
        },
        w: {
          perpendicularScalePermille: 1450,
          perpendicularOffsetPixels: 0,
          transitionStartPermille: 350,
          transitionEndPermille: 750
        }
      }
    },
    'cave-limestone-curved-passage-corner-ne': {
      variantId: 'corner-ne',
      topology: 'corner-ne',
      maximumDetachedCoveredPermille: 11,
      arms: {
        n: {
          perpendicularScalePermille: 1400,
          perpendicularOffsetPixels: -16,
          transitionStartPermille: 200,
          transitionEndPermille: 650
        },
        e: {
          perpendicularScalePermille: 1500,
          perpendicularOffsetPixels: 3,
          transitionStartPermille: 150,
          transitionEndPermille: 500
        }
      }
    }
  };
  const corner = cornerContracts[id];
  if (corner !== undefined
    && variantId === corner.variantId
    && capabilities.routeTopology === corner.topology) {
    return {
      schemaVersion: 'battle-art-route-finishing-v1',
      strategy: 'corner-arm-local-warp-v1',
      arms: structuredClone(corner.arms),
      maximumDetachedCoveredPermille:
        corner.maximumDetachedCoveredPermille,
      maximumCoveragePermille: 230,
      maximumScaleAnisotropyPermille: 1500,
      armAlphaSpan: {
        alphaThreshold: 240,
        minimumPixels: 28,
        maximumPixels: 52,
        maximumSpreadPixels: 24
      }
    };
  }
  if (id !== 'cave-limestone-curved-passage-isolated'
    || variantId !== 'isolated'
    || capabilities.routeTopology !== 'isolated') {
    return null;
  }
  return {
    schemaVersion: 'battle-art-route-finishing-v1',
    strategy: 'largest-component-box-v1',
    targetBox: { x: 96, y: 48, width: 64, height: 32 },
    maximumDetachedCoveredPermille: 0,
    armAlphaSpan: {
      alphaThreshold: 240,
      minimumPixels: 28,
      maximumPixels: 52,
      maximumSpreadPixels: 12
    }
  };
}

export function draftDescriptor({
  manifest,
  theme,
  category,
  id,
  width,
  height,
  familyGroup = id,
  variantId = 'default',
  direction,
  routeTopology,
  surfaceVariant,
  ecologyProfile = 'generic',
  regionalArtDirection = null,
  tierBands = [1],
  heightDeltas
}) {
  if (!THEMES.includes(theme)) throw new Error(`unsupported theme ${theme}`);
  if (!CATEGORIES.includes(category)) throw new Error(`unsupported category ${category}`);
  assertSafeId(id, '--family');
  const defaults = CATEGORY_DEFAULTS[category];
  const canvas = {
    width: width ?? defaults.canvas.width,
    height: height ?? defaults.canvas.height
  };
  assertInteger(canvas.width, '--width', 1);
  assertInteger(canvas.height, '--height', 1);
  assertArtDirection(regionalArtDirection, 'regionalArtDirection');
  const blocks = defaults.collision !== 'none';
  const connection = ['connection-stairs', 'connection-slope'].includes(category);
  const directionalElevation =
    connection || category === 'exposed-face-boundary';
  const capabilities = {
    direction: direction ?? (directionalElevation ? 'n' : null),
    routeTopology: routeTopology ?? (
      category === 'route-transition' ? 'isolated' : null
    ),
    surfaceVariant: surfaceVariant ?? (category === 'surface' ? 0 : null),
    ecologyProfile,
    tierBands: [...tierBands].sort((left, right) => left - right),
    heightDeltas: [...(heightDeltas ?? (directionalElevation ? [1] : [0]))]
      .sort((left, right) => left - right)
  };
  const routeFinishing = deterministicRouteFinishing({
    theme,
    category,
    id,
    familyGroup,
    variantId,
    capabilities
  });
  const footprint = connection
    ? {
        x: 0,
        y: 0,
        width: ['e', 'w'].includes(capabilities.direction) ? 2 : 1,
        height: ['n', 's'].includes(capabilities.direction) ? 2 : 1
      }
    : { x: 0, y: 0, width: 1, height: 1 };
  const collisionCells = blocks
    ? Array.from({ length: footprint.height }, (_, y) => (
        Array.from({ length: footprint.width }, (__, x) => ({ x, y }))
      )).flat()
    : [];
  const anchor = {
    x: Math.floor(canvas.width / 2),
    y: Math.floor(
      canvas.height * defaults.anchorYRatio[0] / defaults.anchorYRatio[1]
    )
  };
  const capabilityFacts = [
    `ecology profile ${capabilities.ecologyProfile}`,
    `tier band${capabilities.tierBands.length === 1 ? '' : 's'} `
      + capabilities.tierBands.join(', '),
    ...(capabilities.surfaceVariant === null
      ? []
      : [`surface variant ${capabilities.surfaceVariant}`]),
    ...(capabilities.direction === null
      ? []
      : [`final authored direction ${capabilities.direction}`]),
    ...(capabilities.routeTopology === null
      ? []
      : [`exact route topology ${capabilities.routeTopology}`]),
    ...(capabilities.heightDeltas.every(value => value === 0)
      ? []
      : [`height magnitude${capabilities.heightDeltas.length === 1 ? '' : 's'} `
        + capabilities.heightDeltas.join(', ')])
  ];
  const subjectName = id.replaceAll('-', ' ');
  const pixel = point => (
    point === null || point === undefined
      ? '(not-applicable)'
      : `(${point.x},${point.y})`
  );
  const diamondCenter = {
    x: Math.floor(canvas.width / 2),
    y: Math.floor(canvas.height / 2)
  };
  const routeEdgeCenters = {
    n: {
      x: Math.floor(canvas.width * 3 / 4),
      y: Math.floor(canvas.height / 4)
    },
    e: {
      x: Math.floor(canvas.width * 3 / 4),
      y: Math.floor(canvas.height * 3 / 4)
    },
    s: {
      x: Math.floor(canvas.width / 4),
      y: Math.floor(canvas.height * 3 / 4)
    },
    w: {
      x: Math.floor(canvas.width / 4),
      y: Math.floor(canvas.height / 4)
    }
  };
  const sourceHalfTile = {
    x: RENDER_PROFILE.tileWidth * RENDER_PROFILE.sourcePixelScale / 2,
    y: RENDER_PROFILE.tileHeight * RENDER_PROFILE.sourcePixelScale / 2
  };
  const directionVectors = {
    n: { x: sourceHalfTile.x, y: -sourceHalfTile.y },
    e: { x: sourceHalfTile.x, y: sourceHalfTile.y },
    s: { x: -sourceHalfTile.x, y: sourceHalfTile.y },
    w: { x: -sourceHalfTile.x, y: -sourceHalfTile.y }
  };
  const connectionTarget = capabilities.direction === null
    ? null
    : {
        x: Math.max(0, Math.min(
          canvas.width - 1,
          anchor.x + directionVectors[capabilities.direction].x
        )),
        y: Math.max(0, Math.min(
          canvas.height - 1,
          anchor.y + directionVectors[capabilities.direction].y
        ))
      };
  const boundaryPoint = (x, y) => ({
    x: Math.max(0, Math.min(canvas.width - 1, x)),
    y: Math.max(0, Math.min(canvas.height - 1, y))
  });
  const boundaryVertices = {
    top: boundaryPoint(anchor.x, anchor.y - sourceHalfTile.y),
    right: boundaryPoint(anchor.x + sourceHalfTile.x, anchor.y),
    bottom: boundaryPoint(anchor.x, anchor.y + sourceHalfTile.y),
    left: boundaryPoint(anchor.x - sourceHalfTile.x, anchor.y)
  };
  const boundaryEdgeSegments = {
    n: [boundaryVertices.top, boundaryVertices.right],
    e: [boundaryVertices.right, boundaryVertices.bottom],
    s: [boundaryVertices.bottom, boundaryVertices.left],
    w: [boundaryVertices.left, boundaryVertices.top]
  };
  const boundaryEdgeCenters = Object.fromEntries(
    Object.entries(boundaryEdgeSegments).map(([direction, [start, end]]) => [
      direction,
      {
        x: Math.floor((start.x + end.x) / 2),
        y: Math.floor((start.y + end.y) / 2)
      }
    ])
  );
  const isometricSideLegend =
    'In the 2:1 isometric diamond, N meets the upper-right edge, E the '
    + 'lower-right edge, S the lower-left edge, and W the upper-left edge.';
  const surfaceComposition = {
    1: ' Give this variant one broad primary regional material sweep crossing '
      + 'the center from upper-left toward lower-right, opposed by one offset '
      + 'secondary regional material field; keep both shapes unbroken and '
      + 'naturally meandering.',
    2: ' Give this variant one large primary regional material pool across the '
      + 'left-center that wraps into two broad secondary-material peninsulas, '
      + 'plus one sparse tertiary accent fan; use no small repeated patches.',
    3: ' Give this variant a calm mostly-primary-material field with one short, '
      + 'narrow, low-contrast winding accent vein contained entirely inside the '
      + 'diamond. Taper both ends out well before the quiet rim; the vein must '
      + 'not divide the tile, connect or approach two edges, keep a constant '
      + 'width, gain a contrasting shoulder, or resemble a route. Add one '
      + 'off-center irregular secondary-material island as a flat diffuse '
      + 'material change, never raised rubble or discrete stones; leave '
      + 'generous quiet ground around both features.'
  }[capabilities.surfaceVariant] ?? '';
  const categoryDirection = {
    surface:
      `Depict ${subjectName} as a complete ground diamond with a quiet, shared `
      + 'seam perimeter and one continuous regional surface-material plane. Use '
      + 'large, irregular material fields that cross the diamond, then sparse '
      + 'unique small-detail clusters concentrated away from the rim. Draw all '
      + 'literal materials from the subject name and regional visual vocabulary. '
      + `Its source-raster center is ${pixel(diamondCenter)}. Never `
      + 'depict internal tile boundaries, square subcells, checkerboards, '
      + 'mosaics, quilts, paving, contour grids, repeated stamps, evenly spaced '
      + 'clusters, stripes, or uniform noise; keep the field quiet enough for '
      + `characters and route overlays.${surfaceComposition}`,
    'route-transition':
      'Depict only a naturally worn route overlay made from the declared regional '
      + 'surface materials with small attached edge details. Connect exactly the '
      + `sides named by ${capabilities.routeTopology}; ${isometricSideLegend} `
      + `Join the path at ${pixel(diamondCenter)}. The four precise edge-band `
      + `targets are N=${pixel(routeEdgeCenters.n)}, `
      + `E=${pixel(routeEdgeCenters.e)}, S=${pixel(routeEdgeCenters.s)}, and `
      + `W=${pixel(routeEdgeCenters.w)} on this ${canvas.width}x${canvas.height} `
      + 'source raster. Carry the path into a 20-pixel neighborhood of every '
      + 'named target and keep every unnamed target neighborhood free of route '
      + 'material. '
      + 'Use a 28–36 pixel worn core with a further 6–10 pixel irregular '
      + 'low transition band on each side. Join branches through one broad, '
      + 'rounded central wear area; corner roles need a continuous generous-radius '
      + 'bend with no pointed chevron, acute V, square elbow, or polygonal cusp. '
      + 'Keep every connection centered and equal width at the tile edge, with '
      + 'no opaque ground diamond and no hard polygonal border.',
    'connection-stairs':
      `Depict ${subjectName} as one coherent two-cell climb rising from the low `
      + `cell toward ${capabilities.direction}. ${isometricSideLegend} Use the `
      + 'literal subject and declared regional material vocabulary to form steps '
      + 'that meet both surfaces cleanly; '
      + `the low endpoint is ${pixel(anchor)} and the required high-end canvas `
      + `target is ${pixel(connectionTarget)}. The connected climb must visibly `
      + 'reach both 16-pixel endpoint neighborhoods and no other directional '
      + 'canvas endpoint. Do not add a dark vertical block, floating steps, or '
      + 'a second direction.',
    'connection-slope':
      `Depict ${subjectName} as one coherent walkable two-cell grade `
      + `rising from the low cell toward ${capabilities.direction}. `
      + `${isometricSideLegend} Blend the literal subject materials and declared `
      + 'regional surface vocabulary into both ends. The low endpoint is '
      + `${pixel(anchor)} and the required high-end `
      + `canvas target is ${pixel(connectionTarget)}. The grade must visibly `
      + 'reach both 16-pixel endpoint neighborhoods and no other directional '
      + 'canvas endpoint; do not depict stairs, a cliff wall, a dark underlay, '
      + 'or a second direction.',
    'exposed-face-boundary':
      capabilities.direction === null
        ? `Depict the literal subject ${subjectName} as a low, broad legacy `
          + 'boundary face connected to the anchor, using only the declared '
          + 'regional material vocabulary and no cuboid panel or dark void.'
        : `Depict the literal subject ${subjectName} along the declared `
          + `${capabilities.direction} tile edge. ${isometricSideLegend} Use the `
          + 'literal subject and declared regional visual vocabulary to form one '
          + 'low, broad grounded boundary or exposed face. The grounded base must '
          + `follow the declared edge from `
          + `${pixel(boundaryEdgeSegments[capabilities.direction][0])} to `
          + `${pixel(boundaryEdgeSegments[capabilities.direction][1])}, with `
          + `sustained contact centered at `
          + `${pixel(boundaryEdgeCenters[capabilities.direction])}, and connect `
          + 'naturally to the anchor. Do not ground the base on any other edge. '
          + 'Upper subject details may overhang other edge bands; overhang is not '
          + 'ground contact.',
    'blocking-obstacle':
      `Depict the literal regional subject ${subjectName}, making its material, `
      + 'silhouette, surface character, age or formation, and scale clearly '
      + 'distinct from other obstacle families. Use one grounded isometric '
      + 'cutout with a clean base.',
    'nonblocking-decoration':
      `Depict the literal regional subject ${subjectName} as a restrained, `
      + 'grounded isometric detail that adds ecological variety without reading '
      + 'as a wall or blocking object.'
  }[category];
  const descriptor = {
    schemaVersion: DESCRIPTOR_SCHEMA,
    id,
    theme,
    category,
    familyGroup,
    variantId,
    capabilities,
    ...(routeFinishing === null ? {} : { routeFinishing }),
    status: 'draft',
    promptProfile: structuredClone(manifest.promptProfile),
    styleReferences: baselineStyleReference(manifest, theme),
    generationPrompt:
      `Create exactly one seam-safe orthographic isometric ${theme} ${category} `
      + `asset named ${id} for ${capabilityFacts.join('; ')}. Author the declared `
      + 'orientation directly, preserve continuous neighboring materials and edge '
      + `alignment, and include only the declared family content. `
      + (regionalArtDirection === null
        ? ''
        : `Regional visual vocabulary: ${regionalArtDirection} `)
      + `${categoryDirection} `
      + 'Do not add a baked '
      + 'backdrop, black void, unrelated terrain wall, or presentation frame.',
    rasterContract: category === 'surface'
      ? {
          schemaVersion: 'battle-art-raster-contract-v1',
          kind: 'opaque-tile-diamond',
          alphaThreshold: 240,
          minimumCoveredPermille: 1000,
          maximumExteriorCoveredPermille: 5
        }
      : {
          schemaVersion: 'battle-art-raster-contract-v1',
          kind: 'transparent-cutout',
          minimumCoveredPermille: 10,
          maximumCoveredPermille: 850
        },
    canvas,
    placement: {
      pivot: structuredClone(anchor),
      anchor,
      footprint,
      collision: { kind: defaults.collision, cells: collisionCells },
      drawBounds: { x: 0, y: 0, width: canvas.width, height: canvas.height },
      occlusionBounds: blocks
        ? { x: 0, y: 0, width: canvas.width, height: Math.floor(canvas.height * 0.75) }
        : { x: 0, y: 0, width: 0, height: 0 },
      stratum: defaults.stratum
    },
    content: {
      version: 1,
      sourceSha256: null,
      runtimeSha256: null,
      immutableUrl: null
    },
    source: null
  };
  assertDescriptor(descriptor, manifest);
  return descriptor;
}

export function descriptorPath(theme, id) {
  return `ai-image-metadata/battle-art/descriptors/${theme}/${id}.json`;
}

async function manifestForNewDraftFamily(loaded) {
  if (
    loaded.descriptors.length > 0
    && loaded.descriptors.every(entry => entry.descriptor.status === 'compiled')
  ) {
    const currentBundle = await buildBundle(loaded.manifest, loaded.descriptors);
    const { value: registry } = await readJson(
      loaded.root,
      BUNDLE_REGISTRY_PATH,
      'runtime asset bundle registry'
    );
    resolveArchivedRuntimeBundle(
      loaded.historicalReleases,
      registry,
      {
        id: currentBundle.id,
        version: currentBundle.version,
        manifestFullHash: currentBundle.manifestFullHash
      }
    );
    return {
      ...loaded.manifest,
      version: loaded.manifest.version + 1
    };
  }
  return loaded.manifest;
}

async function rollbackExactDescriptor(root, relative, expected) {
  const destination = resolveTracked(root, relative, 'descriptor rollback path');
  const handle = await open(
    destination,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  let details;
  try {
    details = await handle.stat();
    if (!details.isFile()) {
      throw new Error(`${relative} rollback target is not a regular file`);
    }
    const contents = await handle.readFile('utf8');
    if (contents !== expected) {
      throw new Error(`${relative} changed before rollback`);
    }
  } finally {
    await handle.close();
  }
  const current = await lstat(destination);
  if (
    current.isSymbolicLink()
    || !current.isFile()
    || current.dev !== details.dev
    || current.ino !== details.ino
  ) {
    throw new Error(`${relative} changed before rollback`);
  }
  await unlink(destination);
}

async function writeExistingDraftUnlocked({
  root: rootValue,
  theme,
  category,
  id,
  width,
  height,
  familyGroup,
  variantId,
  direction,
  routeTopology,
  surfaceVariant,
  ecologyProfile,
  tierBands,
  heightDeltas,
  regionalArtDirection,
  check = false,
  force = false
}, {
  beforeDescriptorWrite = async () => {}
} = {}) {
  const loaded = await loadBattleArt(rootValue);
  const relative = descriptorPath(theme, id);
  if (!loaded.manifest.descriptors.includes(relative)) {
    throw new Error(`${relative} is not registered in the battle-art manifest`);
  }
  let current = null;
  try {
    current = await readFile(resolveTracked(loaded.root, relative), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let existing = null;
  if (current !== null) {
    try {
      existing = JSON.parse(current);
    } catch {
      throw new Error(`${relative} existing descriptor is not valid JSON`);
    }
  }
  const descriptor = draftDescriptor({
    manifest: loaded.manifest,
    theme,
    category,
    id,
    width,
    height,
    familyGroup,
    variantId,
    direction,
    routeTopology,
    surfaceVariant,
    ecologyProfile,
    tierBands,
    heightDeltas,
    regionalArtDirection
  });
  if (existing !== null) {
    descriptor.styleReferences = existingDraftStyleReferences(
      loaded.manifest,
      theme,
      existing.styleReferences
    );
    assertDescriptor(descriptor, loaded.manifest);
  }
  const expected = stableJson(descriptor);
  if (check) {
    if (current !== expected) throw new Error(`${relative} does not match the deterministic draft`);
    return { ok: true, check: true, descriptor: relative };
  }
  if (current !== null && !force) throw new Error(`${relative} already exists; use --force`);
  if (current !== null) {
    if (existing.status !== 'draft') {
      throw new Error(
        `${relative} is released and cannot be overwritten by draft --force; `
        + 'archive it and publish a new descriptor revision'
      );
    }
  }
  await beforeDescriptorWrite({
    root: loaded.root,
    descriptor: relative,
    addingFamily: false
  });
  await atomicWrite(loaded.root, relative, expected);
  return {
    ok: true,
    check: false,
    descriptor: relative,
    releaseVersion: loaded.manifest.version
  };
}

async function writeNewDraftFamilyUnlocked({
  root: rootValue,
  theme,
  category,
  id,
  width,
  height,
  familyGroup,
  variantId,
  direction,
  routeTopology,
  surfaceVariant,
  ecologyProfile,
  tierBands,
  heightDeltas,
  regionalArtDirection,
  check = false
}, {
  beforeDescriptorWrite = async () => {},
  beforeManifestWrite = async () => {},
  writeDescriptor = atomicWrite,
  writeManifest = atomicWrite,
  rollbackDescriptor = rollbackExactDescriptor
} = {}) {
  const relative = descriptorPath(theme, id);
  const loaded = await loadBattleArtState(rootValue, {
    allowedUnmanifestedDescriptor: relative
  });
  if (loaded.manifest.descriptors.includes(relative)) {
    throw new Error(`${relative} became registered during new-family publication`);
  }
  const manifest = await manifestForNewDraftFamily(loaded);
  const descriptor = draftDescriptor({
    manifest,
    theme,
    category,
    id,
    width,
    height,
    familyGroup,
    variantId,
    direction,
    routeTopology,
    surfaceVariant,
    ecologyProfile,
    tierBands,
    heightDeltas,
    regionalArtDirection
  });
  const expected = stableJson(descriptor);
  let current = null;
  try {
    current = await readFile(resolveTracked(loaded.root, relative), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (check) {
    throw new Error(`${relative} is not registered in the battle-art manifest`);
  }
  if (current !== null && current !== expected) {
    throw new Error(
      `${relative} unmanifested descriptor does not match the deterministic draft`
    );
  }
  await beforeDescriptorWrite({
    root: loaded.root,
    descriptor: relative,
    addingFamily: true
  });
  const descriptorCreated = current === null;
  if (descriptorCreated) {
    await writeDescriptor(loaded.root, relative, expected);
  }
  const nextManifest = {
    ...manifest,
    categories: CATEGORIES.filter(value => (
      manifest.categories.includes(value) || value === category
    )),
    descriptors: [...manifest.descriptors, relative].sort()
  };
  try {
    await beforeManifestWrite({
      root: loaded.root,
      descriptor: relative
    });
    await writeManifest(
      loaded.root,
      MANIFEST_PATH,
      stableJson(nextManifest)
    );
  } catch (error) {
    if (descriptorCreated) {
      try {
        await rollbackDescriptor(loaded.root, relative, expected);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `${relative} manifest publication and descriptor rollback failed`
        );
      }
    }
    throw error;
  }
  return {
    ok: true,
    check: false,
    descriptor: relative,
    releaseVersion: manifest.version
  };
}

export async function writeDraft(options, dependencies = {}) {
  const root = projectRoot(options.root);
  assertSafeId(options.theme, 'theme');
  assertSafeId(options.id, 'id');
  const relative = descriptorPath(options.theme, options.id);
  while (true) {
    const { manifest } = await loadBattleArtManifest(root);
    if (manifest.descriptors.includes(relative)) {
      return withBattleArtCandidateLock({
        root,
        theme: options.theme,
        family: options.id
      }, () => writeExistingDraftUnlocked({
        ...options,
        root
      }, dependencies));
    }
    const attempt = await withBattleArtManifestLock({ root }, async () => {
      const locked = await loadBattleArtManifest(root);
      if (locked.manifest.descriptors.includes(relative)) {
        return { retryAsExistingFamily: true };
      }
      return {
        retryAsExistingFamily: false,
        value: await writeNewDraftFamilyUnlocked({
          ...options,
          root
        }, dependencies)
      };
    });
    if (!attempt.retryAsExistingFamily) return attempt.value;
  }
}

export async function scaffoldReadinessDescriptors({
  root: rootValue,
  plan = READINESS_PLAN_PATH,
  theme,
  ecologyProfile,
  tier,
  category,
  families = [],
  surfaceVariant = null,
  check = false,
  force = false
} = {}) {
  const root = projectRoot(rootValue);
  const readiness = await loadReadinessPlan(root, plan);
  const selectedSeeds = [];
  for (const planEntry of readiness.plan.plans) {
    for (const requirement of planEntry.requirements) {
      if (!readinessSelectionMatches(planEntry, requirement, {
        theme: theme ?? null,
        ecologyProfile: ecologyProfile ?? null,
        tier: tier ?? null,
        category: category ?? null,
        families,
        surfaceVariant
      })) continue;
      if (requirement.descriptorId === null) {
        throw new Error(
          'scaffold requires descriptorId for every selected readiness requirement'
        );
      }
      selectedSeeds.push({ planEntry, requirement });
    }
  }
  if (selectedSeeds.length === 0) {
    throw new Error('no battle-art readiness requirements matched the scaffold selection');
  }
  const selectedIds = new Set(
    selectedSeeds.map(entry => entry.requirement.descriptorId)
  );
  const selected = readiness.plan.plans.flatMap(planEntry => (
    planEntry.requirements
      .filter(requirement => selectedIds.has(requirement.descriptorId))
      .map(requirement => ({ planEntry, requirement }))
  ));
  const groups = new Map();
  for (const { planEntry, requirement } of selected) {
    const existing = groups.get(requirement.descriptorId);
    const singular = {
      theme: planEntry.theme,
      category: requirement.category,
      familyGroup: requirement.familyGroup,
      variantId: requirement.variantId,
      direction: requirement.direction,
      routeTopology: requirement.routeTopology,
      surfaceVariant: requirement.surfaceVariant,
      ecologyProfile: planEntry.ecologyProfile,
      regionalArtDirection: planEntry.artDirection ?? null
    };
    if (existing && stableJson(existing.singular) !== stableJson(singular)) {
      throw new Error(
        `descriptorId ${requirement.descriptorId} has conflicting readiness metadata`
      );
    }
    const group = existing ?? {
      singular,
      tierBands: new Set(),
      heightDeltas: new Set()
    };
    group.tierBands.add(planEntry.tierBand);
    group.heightDeltas.add(requirement.heightDelta);
    groups.set(requirement.descriptorId, group);
  }
  const loaded = await loadBattleArt(root);
  const targets = [...groups.keys()].sort();
  for (const id of targets) {
    const relative = descriptorPath(groups.get(id).singular.theme, id);
    const entry = loaded.descriptors.find(candidate => candidate.path === relative);
    if (check && !entry) {
      throw new Error(`${relative} is not registered in the battle-art manifest`);
    }
    if (!check && !force && entry) {
      throw new Error(`${relative} already exists; use --force`);
    }
    if (force && entry && entry.descriptor.status !== 'draft') {
      throw new Error(
        `${relative} is released and cannot be overwritten by scaffold --force`
      );
    }
  }
  const draftOptions = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, group]) => ({
      root,
      id,
      ...group.singular,
      tierBands: [...group.tierBands].sort((left, right) => left - right),
      heightDeltas: [...group.heightDeltas].sort((left, right) => left - right),
      check,
      force
    }));
  for (const options of draftOptions) {
    draftDescriptor({
      manifest: loaded.manifest,
      ...options
    });
  }
  const results = [];
  for (const options of draftOptions) {
    results.push(await writeDraft(options));
  }
  return {
    ok: true,
    check,
    plan: readiness.path,
    descriptors: results
  };
}

export function candidatePaths(descriptor) {
  const directory = `ai-image-metadata/battle-art/candidates/${descriptor.theme}/${descriptor.id}`;
  return {
    directory,
    imagePng: `${directory}/candidate.png`,
    imageWebp: `${directory}/candidate.webp`,
    metadata: `${directory}/result.json`,
    prompt: `${directory}/prompt.txt`,
    stdout: `${directory}/worker.jsonl`,
    stderr: `${directory}/worker.stderr.log`,
    lastMessage: `${directory}/last-message.txt`
  };
}

export function generatedArtifactPath(descriptor, source) {
  if (!THEMES.includes(descriptor?.theme)) {
    throw new Error('generated artifact theme is unsupported');
  }
  assertSafeId(descriptor?.id, 'generated artifact family');
  assertHash(source?.sha256, 'generated artifact sha256');
  if (!['png', 'webp'].includes(source?.format)) {
    throw new Error('generated artifact format is unsupported');
  }
  return `${GENERATED_ARTIFACT_ROOT}/${descriptor.theme}/${descriptor.id}/`
    + `${source.sha256.slice('sha256:'.length)}.${source.format}`;
}

export async function inspectImageContents(relative, contents) {
  const metadata = await sharp(contents, { failOn: 'error' }).metadata();
  if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)) {
    throw new Error(`${relative} has invalid dimensions`);
  }
  if (!['png', 'webp'].includes(metadata.format)) throw new Error(`${relative} must be PNG or WebP`);
  return {
    path: relative,
    bytes: contents.length,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    sha256: sha256(contents)
  };
}

function assertGeneratedRouteSourceShape(source, descriptor, label) {
  exactKeys(source, [
    'path',
    'bytes',
    'width',
    'height',
    'format',
    'sha256'
  ], label);
  const expectedSourcePath = generatedArtifactPath(descriptor, source);
  if (source.path !== expectedSourcePath) {
    throw new Error(`${label}.path is not canonical`);
  }
  for (const key of ['bytes', 'width', 'height']) {
    assertInteger(source[key], `${label}.${key}`, 1);
  }
  if (!['png', 'webp'].includes(source.format)) {
    throw new Error(`${label}.format is unsupported`);
  }
  assertHash(source.sha256, `${label}.sha256`);
}

function assertDirectRouteDerivationShape(
  derivation,
  descriptor,
  label = 'candidate direct route derivation'
) {
  exactKeys(derivation, [
    'schemaVersion',
    'strategy',
    'source',
    'resize',
    'normalization',
    'finalSha256'
  ], label);
  if (
    derivation.schemaVersion !== DIRECT_ROUTE_DERIVATION_SCHEMA
    || derivation.strategy !== 'exact-aspect-whole-image-normalize-v1'
  ) {
    throw new Error(`${label} uses an unsupported direct preparation`);
  }
  assertGeneratedRouteSourceShape(
    derivation.source,
    descriptor,
    `${label}.source`
  );
  exactKeys(derivation.resize, [
    'mode',
    'applied',
    'kernel',
    'targetWidth',
    'targetHeight'
  ], `${label}.resize`);
  if (
    derivation.resize.mode !== 'exact-aspect-whole-image'
    || typeof derivation.resize.applied !== 'boolean'
    || derivation.resize.kernel !== 'lanczos3'
  ) {
    throw new Error(`${label}.resize is invalid`);
  }
  assertInteger(
    derivation.resize.targetWidth,
    `${label}.resize.targetWidth`,
    1
  );
  assertInteger(
    derivation.resize.targetHeight,
    `${label}.resize.targetHeight`,
    1
  );
  if (
    descriptor.canvas !== undefined
    && (
      derivation.resize.targetWidth !== descriptor.canvas.width
      || derivation.resize.targetHeight !== descriptor.canvas.height
    )
  ) {
    throw new Error(`${label}.resize target does not match the descriptor`);
  }
  const resizeRequired =
    derivation.source.width !== derivation.resize.targetWidth
    || derivation.source.height !== derivation.resize.targetHeight;
  if (derivation.resize.applied !== resizeRequired) {
    throw new Error(`${label}.resize.applied does not match the source canvas`);
  }
  exactKeys(
    derivation.normalization,
    ['operation', 'format'],
    `${label}.normalization`
  );
  if (
    derivation.normalization.operation
      !== 'normalize-generated-raster-v1'
    || derivation.normalization.format !== 'png'
  ) {
    throw new Error(`${label}.normalization is invalid`);
  }
  assertHash(derivation.finalSha256, `${label}.finalSha256`);
}

function assertFinishedRouteDerivationShape(
  derivation,
  descriptor,
  label = 'candidate route derivation'
) {
  if (derivation?.strategy === 'anchor-scale-v1') {
    exactKeys(derivation, [
      'schemaVersion',
      'strategy',
      'source',
      'scalePermille',
      'anchor',
      'borderClearPixels',
      'forbiddenBandClearPixels',
      'kernel',
      'finalSha256'
    ], label);
    if (
      derivation.schemaVersion !== 'battle-art-route-finishing-v1'
      || (
        descriptor.routeFinishing !== undefined
        && descriptor.routeFinishing.strategy !== 'anchor-scale-v1'
      )
      || derivation.kernel !== 'lanczos3'
    ) {
      throw new Error(`${label} uses an unsupported operation`);
    }
    assertGeneratedRouteSourceShape(
      derivation.source,
      descriptor,
      `${label}.source`
    );
    assertInteger(derivation.scalePermille, `${label}.scalePermille`, 1001);
    if (
      descriptor.routeFinishing !== undefined
      && derivation.scalePermille !== descriptor.routeFinishing.scalePermille
    ) {
      throw new Error(`${label}.scalePermille does not match the descriptor`);
    }
    exactKeys(derivation.anchor, ['x', 'y'], `${label}.anchor`);
    assertInteger(derivation.anchor.x, `${label}.anchor.x`);
    assertInteger(derivation.anchor.y, `${label}.anchor.y`);
    if (
      descriptor.placement?.anchor !== undefined
      && (
        derivation.anchor.x !== descriptor.placement.anchor.x
        || derivation.anchor.y !== descriptor.placement.anchor.y
      )
    ) {
      throw new Error(`${label}.anchor does not match the descriptor`);
    }
    assertInteger(
      derivation.borderClearPixels,
      `${label}.borderClearPixels`
    );
    if (derivation.borderClearPixels !== 4) {
      throw new Error(`${label}.borderClearPixels must be 4`);
    }
    assertInteger(
      derivation.forbiddenBandClearPixels,
      `${label}.forbiddenBandClearPixels`
    );
    assertHash(derivation.finalSha256, `${label}.finalSha256`);
    return;
  }
  if (['corner-arm-local-warp-v1', 'multi-arm-local-warp-v1'].includes(
    derivation?.strategy
  )) {
    const multiArm = derivation.strategy === 'multi-arm-local-warp-v1';
    const routeFinishing = descriptor.routeFinishing;
    exactKeys(derivation, [
      'schemaVersion',
      'strategy',
      'source',
      'sourceTopologySha256',
      'sourceBounds',
      'componentCount',
      'coveredPixels',
      'selectedCoveredPixels',
      ...(multiArm ? ['sourceSampling'] : []),
      'detachedCoveredPixels',
      'detachedCoveredPermille',
      'maximumDetachedCoveredPermille',
      'anchor',
      'terminals',
      'arms',
      'maximumCoveragePermille',
      'maximumScaleAnisotropyPermille',
      'maximumAppliedScalePermille',
      ...(multiArm ? [
        'maximumFinishedDetachedCoveredPermille',
        'finishedDetachedCoveredPixels',
        'finishedDetachedCoveredPermille'
      ] : []),
      'borderClearPixels',
      'armSelector',
      'transition',
      ...(multiArm ? ['armMeasurement'] : []),
      'kernel',
      'finalSha256'
    ], label);
    if (
      derivation.schemaVersion !== 'battle-art-route-finishing-v1'
      || (routeFinishing !== undefined
        && routeFinishing.strategy !== derivation.strategy)
      || derivation.armSelector
        !== 'greatest-longitudinal-projection-v1'
      || derivation.transition !== (multiArm
        ? 'independent-smoothstep-v1'
        : 'smoothstep-v1')
      || (multiArm
        && derivation.armMeasurement
          !== 'centerline-intersecting-run-v1')
      || (multiArm
        && derivation.sourceSampling !== 'all-visible-components-v1')
      || derivation.kernel !== 'bilinear-premultiplied-alpha-v1'
    ) {
      throw new Error(`${label} uses an unsupported operation`);
    }
    assertGeneratedRouteSourceShape(
      derivation.source,
      descriptor,
      `${label}.source`
    );
    assertHash(
      derivation.sourceTopologySha256,
      `${label}.sourceTopologySha256`
    );
    exactKeys(
      derivation.sourceBounds,
      ['x', 'y', 'width', 'height'],
      `${label}.sourceBounds`
    );
    for (const key of ['x', 'y']) {
      assertInteger(
        derivation.sourceBounds[key],
        `${label}.sourceBounds.${key}`
      );
    }
    for (const key of ['width', 'height']) {
      assertInteger(
        derivation.sourceBounds[key],
        `${label}.sourceBounds.${key}`,
        1
      );
    }
    for (const key of [
      'componentCount',
      'coveredPixels',
      'selectedCoveredPixels',
      'detachedCoveredPixels',
      'detachedCoveredPermille',
      'maximumDetachedCoveredPermille',
      'maximumCoveragePermille',
      'maximumScaleAnisotropyPermille',
      'maximumAppliedScalePermille',
      ...(multiArm ? [
        'maximumFinishedDetachedCoveredPermille',
        'finishedDetachedCoveredPixels',
        'finishedDetachedCoveredPermille'
      ] : []),
      'borderClearPixels'
    ]) {
      assertInteger(
        derivation[key],
        `${label}.${key}`,
        ['componentCount', 'coveredPixels', 'selectedCoveredPixels',
          'maximumCoveragePermille', 'maximumScaleAnisotropyPermille',
          'maximumAppliedScalePermille', 'borderClearPixels'].includes(key)
          ? 1
          : 0
      );
    }
    if (derivation.borderClearPixels !== 4) {
      throw new Error(`${label}.borderClearPixels must be 4`);
    }
    if (derivation.maximumAppliedScalePermille
      > derivation.maximumScaleAnisotropyPermille) {
      throw new Error(
        `${label}.maximumAppliedScalePermille exceeds its anisotropy cap`
      );
    }
    exactKeys(derivation.anchor, ['x', 'y'], `${label}.anchor`);
    for (const key of ['x', 'y']) {
      assertInteger(derivation.anchor[key], `${label}.anchor.${key}`);
      if (descriptor.placement?.anchor !== undefined
        && derivation.anchor[key] !== descriptor.placement.anchor[key]) {
        throw new Error(`${label}.anchor does not match the descriptor`);
      }
    }
    const directions = Object.keys(derivation.arms);
    if ((!multiArm && directions.length !== 2)
      || (multiArm && ![3, 4].includes(directions.length))
      || directions.some(direction => !'nesw'.includes(direction))) {
      throw new Error(`${label}.arms is not a closed local arm set`);
    }
    if (descriptor.capabilities?.routeTopology !== undefined) {
      const topology = descriptor.capabilities.routeTopology;
      const expectedDirections = multiArm
        ? topology === 'cross'
          ? ['n', 'e', 's', 'w']
          : [...topology.slice('tee-'.length)]
        : [...topology.slice('corner-'.length)];
      if (stableJson([...directions].sort())
        !== stableJson(expectedDirections.sort())) {
        throw new Error(`${label}.arms does not match the descriptor topology`);
      }
    }
    exactKeys(derivation.terminals, directions, `${label}.terminals`);
    for (const direction of directions) {
      const armLabel = `${label}.arms.${direction}`;
      const armKeys = multiArm ? [
        'perpendicularStartScalePermille',
        'perpendicularScalePermille',
        'perpendicularOffsetPixels',
        'scaleTransitionStartPermille',
        'scaleTransitionEndPermille',
        'offsetTransitionStartPermille',
        'offsetTransitionEndPermille'
      ] : [
        'perpendicularScalePermille',
        'perpendicularOffsetPixels',
        'transitionStartPermille',
        'transitionEndPermille'
      ];
      exactKeys(derivation.arms[direction], armKeys, armLabel);
      for (const key of armKeys) {
        assertInteger(
          derivation.arms[direction][key],
          `${armLabel}.${key}`,
          key === 'perpendicularOffsetPixels' ? -32 : 0
        );
      }
      if (derivation.arms[direction].perpendicularOffsetPixels > 32
        || (multiArm
          && derivation.arms[direction].perpendicularStartScalePermille
            > derivation.maximumScaleAnisotropyPermille)
        || derivation.arms[direction].perpendicularScalePermille
          > derivation.maximumScaleAnisotropyPermille
        || (multiArm
          ? ['scale', 'offset'].some(prefix => (
              derivation.arms[direction][
                `${prefix}TransitionStartPermille`
              ] >= derivation.arms[direction][
                `${prefix}TransitionEndPermille`
              ]
              || derivation.arms[direction][
                `${prefix}TransitionEndPermille`
              ] > 1000
            ))
          : derivation.arms[direction].transitionStartPermille
              >= derivation.arms[direction].transitionEndPermille
            || derivation.arms[direction].transitionEndPermille > 1000)) {
        throw new Error(`${armLabel} exceeds its closed local warp bounds`);
      }
      exactKeys(
        derivation.terminals[direction],
        ['x', 'y'],
        `${label}.terminals.${direction}`
      );
      for (const key of ['x', 'y']) {
        assertInteger(
          derivation.terminals[direction][key],
          `${label}.terminals.${direction}.${key}`
        );
      }
      if (descriptor.canvas !== undefined
        && descriptor.placement?.anchor !== undefined) {
        const vectors = {
          n: { x: descriptor.canvas.width / 4, y: -descriptor.canvas.height / 4 },
          e: { x: descriptor.canvas.width / 4, y: descriptor.canvas.height / 4 },
          s: { x: -descriptor.canvas.width / 4, y: descriptor.canvas.height / 4 },
          w: { x: -descriptor.canvas.width / 4, y: -descriptor.canvas.height / 4 }
        };
        if (derivation.terminals[direction].x
            !== derivation.anchor.x + vectors[direction].x
          || derivation.terminals[direction].y
            !== derivation.anchor.y + vectors[direction].y) {
          throw new Error(
            `${label}.terminals.${direction} does not preserve its exact endpoint`
          );
        }
      }
    }
    if (routeFinishing !== undefined) {
      for (const [key, value] of [
        ['maximumDetachedCoveredPermille',
          routeFinishing.maximumDetachedCoveredPermille],
        ['maximumCoveragePermille', routeFinishing.maximumCoveragePermille],
        ['maximumScaleAnisotropyPermille',
          routeFinishing.maximumScaleAnisotropyPermille],
        ...(multiArm ? [[
          'maximumFinishedDetachedCoveredPermille',
          routeFinishing.maximumFinishedDetachedCoveredPermille
        ]] : [])
      ]) {
        if (derivation[key] !== value) {
          throw new Error(`${label}.${key} does not match the descriptor`);
        }
      }
      if (stableJson(derivation.arms) !== stableJson(routeFinishing.arms)) {
        throw new Error(`${label}.arms does not match the descriptor`);
      }
    }
    assertHash(derivation.finalSha256, `${label}.finalSha256`);
    return;
  }
  if (derivation?.strategy === 'straight-route-basis-v1') {
    const routeFinishing = descriptor.routeFinishing;
    exactKeys(derivation, [
      'schemaVersion',
      'strategy',
      'source',
      'sourceTopologySha256',
      'sourceBounds',
      'componentCount',
      'coveredPixels',
      'selectedCoveredPixels',
      'detachedCoveredPixels',
      'detachedCoveredPermille',
      'maximumDetachedCoveredPermille',
      'basis',
      'sourceProjectionBounds',
      'sourceTerminalInsetPixels',
      'sourceTerminalInsetProjectionNumerator',
      'trimmedLongitudinalBounds',
      'trimmedCoveredPixels',
      'trimmedCoveredPermille',
      'maximumTrimmedCoveredPermille',
      'anchor',
      'outputTerminalOverflowPixels',
      'outputTerminalOverflowProjectionNumerator',
      'outputPerpendicularSpanPixels',
      'outputPerpendicularProjectionNumerator',
      'scaleLongitudinal',
      'scalePerpendicular',
      'scaleAnisotropyPermille',
      'maximumScaleAnisotropyPermille',
      'kernel',
      'finalSha256'
    ], label);
    if (
      derivation.schemaVersion !== 'battle-art-route-finishing-v1'
      || (
        routeFinishing !== undefined
        && routeFinishing.strategy !== 'straight-route-basis-v1'
      )
      || derivation.kernel !== 'bilinear-premultiplied-alpha-v1'
    ) {
      throw new Error(`${label} uses an unsupported operation`);
    }
    assertGeneratedRouteSourceShape(
      derivation.source,
      descriptor,
      `${label}.source`
    );
    assertHash(
      derivation.sourceTopologySha256,
      `${label}.sourceTopologySha256`
    );
    exactKeys(
      derivation.sourceBounds,
      ['x', 'y', 'width', 'height'],
      `${label}.sourceBounds`
    );
    for (const key of ['x', 'y']) {
      assertInteger(
        derivation.sourceBounds[key],
        `${label}.sourceBounds.${key}`
      );
    }
    for (const key of ['width', 'height']) {
      assertInteger(
        derivation.sourceBounds[key],
        `${label}.sourceBounds.${key}`,
        1
      );
    }
    for (const key of [
      'componentCount',
      'coveredPixels',
      'selectedCoveredPixels',
      'detachedCoveredPixels',
      'detachedCoveredPermille',
      'maximumDetachedCoveredPermille',
      'sourceTerminalInsetPixels',
      'sourceTerminalInsetProjectionNumerator',
      'trimmedCoveredPixels',
      'trimmedCoveredPermille',
      'maximumTrimmedCoveredPermille',
      'outputTerminalOverflowPixels',
      'outputTerminalOverflowProjectionNumerator',
      'outputPerpendicularSpanPixels',
      'outputPerpendicularProjectionNumerator',
      'scaleAnisotropyPermille',
      'maximumScaleAnisotropyPermille'
    ]) {
      assertInteger(
        derivation[key],
        `${label}.${key}`,
        ['componentCount', 'coveredPixels', 'selectedCoveredPixels',
          'sourceTerminalInsetPixels',
          'sourceTerminalInsetProjectionNumerator',
          'outputPerpendicularSpanPixels',
          'outputPerpendicularProjectionNumerator',
          'scaleAnisotropyPermille',
          'maximumScaleAnisotropyPermille'].includes(key) ? 1 : 0
      );
    }
    if (routeFinishing !== undefined) {
      for (const [key, value] of [
        ['maximumDetachedCoveredPermille',
          routeFinishing.maximumDetachedCoveredPermille],
        ['sourceTerminalInsetPixels',
          routeFinishing.sourceTerminalInsetPixels],
        ['maximumTrimmedCoveredPermille',
          routeFinishing.maximumTrimmedCoveredPermille],
        ['outputTerminalOverflowPixels',
          routeFinishing.outputTerminalOverflowPixels],
        ['outputPerpendicularSpanPixels',
          routeFinishing.outputPerpendicularSpanPixels],
        ['maximumScaleAnisotropyPermille',
          routeFinishing.maximumScaleAnisotropyPermille]
      ]) {
        if (derivation[key] !== value) {
          throw new Error(`${label}.${key} does not match the descriptor`);
        }
      }
    }
    exactKeys(
      derivation.anchor,
      ['x', 'y'],
      `${label}.anchor`
    );
    for (const key of ['x', 'y']) {
      assertInteger(derivation.anchor[key], `${label}.anchor.${key}`);
      if (
        descriptor.placement?.anchor !== undefined
        && derivation.anchor[key] !== descriptor.placement.anchor[key]
      ) {
        throw new Error(`${label}.anchor does not match the descriptor`);
      }
    }
    exactKeys(derivation.basis, [
      'longitudinal',
      'perpendicular',
      'lengthSquared',
      'terminalProjectionNumerator'
    ], `${label}.basis`);
    for (const vector of ['longitudinal', 'perpendicular']) {
      exactKeys(
        derivation.basis[vector],
        ['x', 'y'],
        `${label}.basis.${vector}`
      );
      for (const key of ['x', 'y']) {
        assertInteger(
          derivation.basis[vector][key],
          `${label}.basis.${vector}.${key}`,
          -4096
        );
      }
    }
    assertInteger(
      derivation.basis.lengthSquared,
      `${label}.basis.lengthSquared`,
      1
    );
    assertInteger(
      derivation.basis.terminalProjectionNumerator,
      `${label}.basis.terminalProjectionNumerator`,
      1
    );
    for (const [parent, childKeys] of [
      ['sourceProjectionBounds', ['longitudinal', 'perpendicular']],
      ['trimmedLongitudinalBounds', null]
    ]) {
      if (childKeys === null) {
        exactKeys(
          derivation[parent],
          ['minimumNumerator', 'maximumNumerator'],
          `${label}.${parent}`
        );
        for (const key of ['minimumNumerator', 'maximumNumerator']) {
          assertInteger(
            derivation[parent][key],
            `${label}.${parent}.${key}`,
            -Number.MAX_SAFE_INTEGER
          );
        }
        continue;
      }
      exactKeys(derivation[parent], childKeys, `${label}.${parent}`);
      for (const child of childKeys) {
        exactKeys(
          derivation[parent][child],
          ['minimumNumerator', 'maximumNumerator'],
          `${label}.${parent}.${child}`
        );
        for (const key of ['minimumNumerator', 'maximumNumerator']) {
          assertInteger(
            derivation[parent][child][key],
            `${label}.${parent}.${child}.${key}`,
            -Number.MAX_SAFE_INTEGER
          );
        }
      }
    }
    for (const scale of ['scaleLongitudinal', 'scalePerpendicular']) {
      exactKeys(
        derivation[scale],
        ['numerator', 'denominator'],
        `${label}.${scale}`
      );
      assertInteger(
        derivation[scale].numerator,
        `${label}.${scale}.numerator`,
        1
      );
      assertInteger(
        derivation[scale].denominator,
        `${label}.${scale}.denominator`,
        1
      );
    }
    assertHash(derivation.finalSha256, `${label}.finalSha256`);
    return;
  }
  exactKeys(derivation, [
    'schemaVersion',
    'strategy',
    'source',
    'sourceBounds',
    'componentCount',
    'coveredPixels',
    'selectedCoveredPixels',
    'detachedCoveredPixels',
    'detachedCoveredPermille',
    'maximumDetachedCoveredPermille',
    'targetBox',
    'scaleX',
    'scaleY',
    'kernel',
    ...(derivation.terminalClip !== undefined ? ['terminalClip'] : []),
    'finalSha256'
  ], label);
  if (
    derivation.schemaVersion !== 'battle-art-route-finishing-v1'
    || derivation.strategy !== 'largest-component-box-v1'
    || derivation.kernel !== 'lanczos3'
  ) {
    throw new Error(`${label} uses an unsupported operation`);
  }
  assertGeneratedRouteSourceShape(
    derivation.source,
    descriptor,
    `${label}.source`
  );
  for (const [key, value] of [
    ['sourceBounds', derivation.sourceBounds],
    ['targetBox', derivation.targetBox]
  ]) {
    exactKeys(value, ['x', 'y', 'width', 'height'], `${label}.${key}`);
    for (const coordinate of ['x', 'y']) {
      assertInteger(value[coordinate], `${label}.${key}.${coordinate}`);
    }
    for (const dimension of ['width', 'height']) {
      assertInteger(
        value[dimension],
        `${label}.${key}.${dimension}`,
        1
      );
    }
  }
  for (const key of [
    'componentCount',
    'coveredPixels',
    'selectedCoveredPixels',
    'detachedCoveredPixels',
    'detachedCoveredPermille',
    'maximumDetachedCoveredPermille'
  ]) {
    assertInteger(
      derivation[key],
      `${label}.${key}`,
      ['componentCount', 'coveredPixels', 'selectedCoveredPixels'].includes(key)
        ? 1
        : 0
    );
  }
  for (const key of ['scaleX', 'scaleY']) {
    exactKeys(
      derivation[key],
      ['numerator', 'denominator'],
      `${label}.${key}`
    );
    assertInteger(
      derivation[key].numerator,
      `${label}.${key}.numerator`,
      1
    );
    assertInteger(
      derivation[key].denominator,
      `${label}.${key}.denominator`,
      1
    );
  }
  if (derivation.terminalClip !== undefined) {
    exactKeys(
      derivation.terminalClip,
      ['schemaVersion', 'maximumOverflowPixels', 'clearedPixels'],
      `${label}.terminalClip`
    );
    if (
      derivation.terminalClip.schemaVersion
        !== 'battle-art-route-terminal-clip-v1'
    ) {
      throw new Error(`${label}.terminalClip is unsupported`);
    }
    if (
      descriptor.routeFinishing?.terminalClip !== undefined
      && (
        descriptor.routeFinishing.terminalClip.schemaVersion
          !== derivation.terminalClip.schemaVersion
        || descriptor.routeFinishing.terminalClip.maximumOverflowPixels
          !== derivation.terminalClip.maximumOverflowPixels
      )
    ) {
      throw new Error(`${label}.terminalClip does not match the descriptor`);
    }
    assertInteger(
      derivation.terminalClip.clearedPixels,
      `${label}.terminalClip.clearedPixels`
    );
  }
  assertHash(derivation.finalSha256, `${label}.finalSha256`);
}

function assertRouteDerivationShape(
  derivation,
  descriptor,
  label = 'candidate route derivation'
) {
  if (derivation?.schemaVersion === DIRECT_ROUTE_DERIVATION_SCHEMA) {
    assertDirectRouteDerivationShape(derivation, descriptor, label);
    return;
  }
  assertFinishedRouteDerivationShape(derivation, descriptor, label);
}

export async function prepareDirectRouteCandidate({
  sourceBytes,
  source,
  descriptor,
  profile,
  label = `${descriptor.id} direct route preparation`
}) {
  if (
    descriptor.category !== 'route-transition'
    || descriptor.routeFinishing !== undefined
  ) {
    throw new Error(`${label} requires a direct route-transition descriptor`);
  }
  if (!Buffer.isBuffer(sourceBytes)) {
    throw new Error(`${label} source bytes are unavailable`);
  }
  assertGeneratedRouteSourceShape(source, descriptor, `${label}.source`);
  const actualSource = await inspectImageContents(source.path, sourceBytes);
  if (stableJson(actualSource) !== stableJson(source)) {
    throw new Error(`${label} source artifact identity is stale`);
  }
  if (
    source.width * descriptor.canvas.height
      !== source.height * descriptor.canvas.width
  ) {
    throw new Error(
      `${descriptor.id} candidate aspect ratio ${source.width}:`
      + `${source.height} does not match declared route canvas `
      + `${descriptor.canvas.width}:${descriptor.canvas.height}`
    );
  }
  const resizeApplied = source.width !== descriptor.canvas.width
    || source.height !== descriptor.canvas.height;
  const normalizationInputBytes = resizeApplied
    ? await sharp(sourceBytes, { failOn: 'error' })
        .resize(descriptor.canvas.width, descriptor.canvas.height, {
          fit: 'fill',
          kernel: sharp.kernel.lanczos3
        })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer()
    : sourceBytes;
  const bytes = await normalizeGeneratedRasterBytes({
    bytes: normalizationInputBytes,
    descriptor,
    profile,
    format: 'png',
    label
  });
  await validateRasterBytes({
    bytes,
    descriptor,
    profile,
    label
  });
  return {
    bytes,
    format: 'png',
    derivation: {
      schemaVersion: DIRECT_ROUTE_DERIVATION_SCHEMA,
      strategy: 'exact-aspect-whole-image-normalize-v1',
      source: structuredClone(source),
      resize: {
        mode: 'exact-aspect-whole-image',
        applied: resizeApplied,
        kernel: 'lanczos3',
        targetWidth: descriptor.canvas.width,
        targetHeight: descriptor.canvas.height
      },
      normalization: {
        operation: 'normalize-generated-raster-v1',
        format: 'png'
      },
      finalSha256: sha256(bytes)
    }
  };
}

async function reproduceRouteDerivation({
  sourceBytes,
  source,
  descriptor,
  profile,
  label
}) {
  if (descriptor.routeFinishing === undefined) {
    return prepareDirectRouteCandidate({
      sourceBytes,
      source,
      descriptor,
      profile,
      label
    });
  }
  const reproduced = await finishRouteArtifact({
    bytes: sourceBytes,
    descriptor,
    profile
  });
  const derivation = {
    ...reproduced.derivation,
    source
  };
  await validateRasterBytes({
    bytes: reproduced.bytes,
    descriptor,
    profile,
    label
  });
  await validateFinishedRouteArtifact({
    bytes: reproduced.bytes,
    descriptor,
    label
  });
  return {
    bytes: reproduced.bytes,
    format: 'png',
    derivation
  };
}

function hasDirectRouteMissingDerivationAttestation({
  descriptor,
  candidate,
  paths,
  candidateMetadataPin,
  reviewFullHash
}) {
  if (
    candidate?.schemaVersion !== CANDIDATE_SCHEMA
    || descriptor.category !== 'route-transition'
    || descriptor.routeFinishing !== undefined
    || !['approved', 'compiled'].includes(descriptor.status)
  ) {
    return false;
  }
  const serializedCandidate = Buffer.from(stableJson(candidate));
  const metadata = {
    path: paths.metadata,
    bytes: serializedCandidate.length,
    sha256: sha256(serializedCandidate)
  };
  if (
    candidateMetadataPin !== undefined
    && stableJson(candidateMetadataPin) !== stableJson(metadata)
  ) {
    return false;
  }
  return DIRECT_ROUTE_MISSING_DERIVATION_ATTESTATIONS.some(attestation => (
    descriptor.theme === attestation.theme
    && descriptor.id === attestation.familyId
    && descriptor.content.version === attestation.contentVersion
    && descriptor.content.sourceSha256 === attestation.image.sha256
    && stableJson(descriptor.source) === stableJson(attestation.source)
    && stableJson(metadata) === stableJson(attestation.metadata)
    && stableJson(candidate.image) === stableJson(attestation.image)
    && (
      reviewFullHash === undefined
      || reviewFullHash === null
      || reviewFullHash === attestation.reviewFullHash
    )
  ));
}

export async function verifyCandidateRouteDerivation({
  root,
  descriptor,
  candidate,
  candidateBytes,
  profile,
  paths = candidatePaths(descriptor),
  candidateMetadataPin,
  reviewFullHash,
  label = `${descriptor.id} candidate route derivation`
}) {
  if (descriptor.category !== 'route-transition') {
    if (candidate.derivation !== undefined) {
      throw new Error(`${label} is not allowed for a non-route candidate`);
    }
    return null;
  }
  if (candidate.derivation === undefined) {
    if (hasDirectRouteMissingDerivationAttestation({
      descriptor,
      candidate,
      paths,
      candidateMetadataPin,
      reviewFullHash
    })) {
      return null;
    }
    throw new Error(
      `${label} is required; candidate is not exact allowlisted pre-fix evidence`
    );
  }
  assertRouteDerivationShape(candidate.derivation, descriptor, label);
  const revalidated =
    candidate.schemaVersion === REVALIDATED_CANDIDATE_SCHEMA;
  let replayValidation = null;
  if (revalidated) {
    replayValidation = await import('./generate.mjs');
    await replayValidation.auditRevalidatedCandidateOrigin({
      root,
      descriptor,
      candidate,
      label: `${label} origin`
    });
  }
  const sourceBytes = await readPinnedRegularFile(
    root,
    candidate.derivation.source.path,
    candidate.derivation.source.sha256,
    `${label} source artifact`
  );
  const source = await inspectImageContents(
    candidate.derivation.source.path,
    sourceBytes
  );
  if (stableJson(source) !== stableJson(candidate.derivation.source)) {
    throw new Error(`${label} source artifact identity is stale`);
  }
  const reproduced = await reproduceRouteDerivation({
    sourceBytes,
    source,
    descriptor,
    profile,
    label
  });
  if (
    !reproduced.bytes.equals(candidateBytes)
    || stableJson(reproduced.derivation) !== stableJson(candidate.derivation)
  ) {
    throw new Error(`${label} does not reproduce the candidate bytes`);
  }
  if (revalidated) {
    await replayValidation.validatePreparedRouteGeometry({
      bytes: reproduced.bytes,
      descriptor,
      finished: descriptor.routeFinishing !== undefined,
      label
    });
  }
  return {
    source,
    sourceBytes,
    derivation: reproduced.derivation
  };
}

export async function inspectImage(root, relative) {
  const filePath = resolveTracked(root, relative, 'image path');
  return inspectImageContents(relative, await readFile(filePath));
}

export function reviewRecordPath(theme, family, imageSha256) {
  if (!THEMES.includes(theme)) throw new Error(`unsupported theme ${theme}`);
  assertSafeId(family, 'review family');
  assertHash(imageSha256, 'review image sha256');
  return `${REVIEW_ROOT}/${theme}/${family}/`
    + `${imageSha256.slice('sha256:'.length)}.json`;
}

export function assertReviewReason(value, label = '--reason') {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > 1200
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be 1–1200 trimmed printable characters`);
  }
  return value;
}

function assertReviewFilePin(pin, expectedPath, label, minimumBytes = 0) {
  exactKeys(pin, ['path', 'bytes', 'sha256'], label);
  if (pin.path !== expectedPath) throw new Error(`${label}.path is not canonical`);
  resolveTracked('/project', pin.path, `${label}.path`);
  assertInteger(pin.bytes, `${label}.bytes`, minimumBytes);
  assertHash(pin.sha256, `${label}.sha256`);
}

function reviewRecordProjection(record) {
  const {
    fullHash: _fullHash,
    ...projection
  } = record;
  return projection;
}

function assertAllowlistedLegacyJson(relative, value, label) {
  const expectedIdentity = LEGACY_EVIDENCE_ALLOWLIST[relative];
  const actualIdentity = value.schemaVersion === LEGACY_REVIEW_SCHEMA
    ? value.fullHash
    : sha256(Buffer.from(stableJson(value)));
  if (expectedIdentity === undefined || actualIdentity !== expectedIdentity) {
    throw new Error(`${label} is not recognized tracked legacy evidence`);
  }
}

export function assertAllowlistedLegacyCandidate(
  relative,
  candidate,
  label = 'candidate metadata'
) {
  if (candidate?.schemaVersion !== LEGACY_CANDIDATE_SCHEMA) {
    throw new Error(`${label} is not legacy candidate evidence`);
  }
  if (!THEMES.includes(candidate.theme)) {
    throw new Error(`${label}.theme is unsupported`);
  }
  assertSafeId(candidate.familyId, `${label}.familyId`);
  const expectedPath = candidatePaths({
    theme: candidate.theme,
    id: candidate.familyId
  }).metadata;
  if (relative !== expectedPath) {
    throw new Error(`${label}.path is not canonical`);
  }
  assertAllowlistedLegacyJson(relative, candidate, label);
  return candidate;
}

export function assertReviewRecord(
  record,
  relativePath = reviewRecordPath(
    record?.theme,
    record?.familyId,
    record?.candidate?.image?.sha256
  ),
  label = `battle-art review ${relativePath}`
) {
  const legacy = record?.schemaVersion === LEGACY_REVIEW_SCHEMA;
  const revalidated =
    record?.schemaVersion === REVALIDATED_REVIEW_SCHEMA;
  const compiledSourceAttestation =
    record?.schemaVersion === COMPILED_SOURCE_ATTESTATION_SCHEMA;
  const legacyCandidateLayout = legacy || compiledSourceAttestation;
  exactKeys(record, [
    'schemaVersion',
    'theme',
    'familyId',
    'decision',
    'reviewer',
    'reason',
    'reviewedAt',
    'descriptor',
    'candidate',
    ...(compiledSourceAttestation ? ['source'] : []),
    'fullHash'
  ], label);
  if (
    !legacy
    && !revalidated
    && !compiledSourceAttestation
    && record.schemaVersion !== REVIEW_SCHEMA
  ) {
    throw new Error(`${label}.schemaVersion is unsupported`);
  }
  if (!THEMES.includes(record.theme)) throw new Error(`${label}.theme is unsupported`);
  assertSafeId(record.familyId, `${label}.familyId`);
  if (!['approved', 'rejected'].includes(record.decision)) {
    throw new Error(`${label}.decision is unsupported`);
  }
  if (compiledSourceAttestation && record.decision !== 'approved') {
    throw new Error(`${label}.decision must be approved for a compiled-source attestation`);
  }
  if (
    typeof record.reviewer !== 'string'
    || record.reviewer.trim() !== record.reviewer
    || record.reviewer.length === 0
  ) {
    throw new Error(`${label}.reviewer is required`);
  }
  assertReviewReason(record.reason, `${label}.reason`);
  if (
    typeof record.reviewedAt !== 'string'
    || !Number.isFinite(Date.parse(record.reviewedAt))
  ) {
    throw new Error(`${label}.reviewedAt is invalid`);
  }
  exactKeys(
    record.descriptor,
    ['path', 'sha256', 'contentVersion'],
    `${label}.descriptor`
  );
  const expectedDescriptorPath =
    `ai-image-metadata/battle-art/descriptors/${record.theme}/${record.familyId}.json`;
  if (record.descriptor.path !== expectedDescriptorPath) {
    throw new Error(`${label}.descriptor.path is not canonical`);
  }
  assertHash(record.descriptor.sha256, `${label}.descriptor.sha256`);
  assertInteger(
    record.descriptor.contentVersion,
    `${label}.descriptor.contentVersion`,
    1
  );

  exactKeys(record.candidate, [
    'metadata',
    'image',
    ...(record.candidate.derivation !== undefined ? ['derivation'] : []),
    ...(revalidated ? ['origin'] : []),
    'promptProfile',
    'styleReferences',
    ...(!legacyCandidateLayout && !revalidated
      ? ['styleReferenceMode', 'styleReferenceProvenance']
      : []),
    ...(!revalidated ? ['worker'] : [])
  ], `${label}.candidate`);
  const paths = candidatePaths({
    theme: record.theme,
    id: record.familyId
  });
  if (record.candidate.derivation !== undefined) {
    assertRouteDerivationShape(
      record.candidate.derivation,
      {
        theme: record.theme,
        id: record.familyId
      },
      `${label}.candidate.derivation`
    );
    if (
      record.candidate.derivation.finalSha256
        !== record.candidate.image.sha256
    ) {
      throw new Error(
        `${label}.candidate.derivation final hash does not match its image`
      );
    }
  }
  if (revalidated) {
    assertFailedAttemptRevalidationOrigin(record.candidate.origin, {
      theme: record.theme,
      familyId: record.familyId,
      validationDescriptorSha256: record.descriptor.sha256,
      derivationSource: record.candidate.derivation?.source
    }, `${label}.candidate.origin`);
  }
  assertReviewFilePin(
    record.candidate.metadata,
    paths.metadata,
    `${label}.candidate.metadata`,
    1
  );
  exactKeys(record.candidate.image, [
    'path',
    'bytes',
    'width',
    'height',
    'format',
    'sha256'
  ], `${label}.candidate.image`);
  if (![paths.imagePng, paths.imageWebp].includes(record.candidate.image.path)) {
    throw new Error(`${label}.candidate.image.path is not canonical`);
  }
  assertInteger(record.candidate.image.bytes, `${label}.candidate.image.bytes`, 1);
  assertInteger(record.candidate.image.width, `${label}.candidate.image.width`, 1);
  assertInteger(record.candidate.image.height, `${label}.candidate.image.height`, 1);
  if (!['png', 'webp'].includes(record.candidate.image.format)) {
    throw new Error(`${label}.candidate.image.format is unsupported`);
  }
  if (!record.candidate.image.path.endsWith(`.${record.candidate.image.format}`)) {
    throw new Error(`${label}.candidate.image path and format disagree`);
  }
  assertHash(record.candidate.image.sha256, `${label}.candidate.image.sha256`);
  assertPin(record.candidate.promptProfile, `${label}.candidate.promptProfile`);
  if (
    !Array.isArray(record.candidate.styleReferences)
    || record.candidate.styleReferences.length === 0
  ) {
    throw new Error(`${label}.candidate.styleReferences must be non-empty`);
  }
  record.candidate.styleReferences.forEach((pin, index) => {
    assertPin(pin, `${label}.candidate.styleReferences[${index}]`);
  });
  if (!revalidated) {
    exactKeys(record.candidate.worker, [
      'command',
      'ephemeral',
      'invocationCount',
      'timeoutMs',
      ...(!legacyCandidateLayout ? ['imageArguments'] : []),
      'prompt',
      'stdout',
      'stderr',
      'lastMessage'
    ], `${label}.candidate.worker`);
    if (
      record.candidate.worker.command !== 'codex'
      || record.candidate.worker.ephemeral !== true
      || record.candidate.worker.invocationCount !== 1
    ) {
      throw new Error(`${label}.candidate.worker is not isolated imagegen provenance`);
    }
    if (!legacyCandidateLayout) {
      if (!Array.isArray(record.candidate.worker.imageArguments)
        || record.candidate.worker.imageArguments.some(value => (
          typeof value !== 'string' || path.basename(value) !== value
        ))) {
        throw new Error(`${label}.candidate.worker.imageArguments is invalid`);
      }
      const syntheticArgs = record.candidate.worker.imageArguments.flatMap(
        basename => ['--image', `/review/${basename}`]
      );
      assertStyleReferenceProvenance({
        styleReferences: record.candidate.styleReferences,
        provenance: record.candidate.styleReferenceProvenance,
        mode: record.candidate.styleReferenceMode,
        args: syntheticArgs,
        imageBasenames: record.candidate.worker.imageArguments,
        label: `${label}.candidate`
      });
    }
    assertInteger(
      record.candidate.worker.timeoutMs,
      `${label}.candidate.worker.timeoutMs`,
      1
    );
    assertReviewFilePin(
      record.candidate.worker.prompt,
      paths.prompt,
      `${label}.candidate.worker.prompt`,
      1
    );
    assertReviewFilePin(
      record.candidate.worker.stdout,
      paths.stdout,
      `${label}.candidate.worker.stdout`,
      1
    );
    assertReviewFilePin(
      record.candidate.worker.stderr,
      paths.stderr,
      `${label}.candidate.worker.stderr`
    );
    if (record.candidate.worker.lastMessage !== null) {
      assertReviewFilePin(
        record.candidate.worker.lastMessage,
        paths.lastMessage,
        `${label}.candidate.worker.lastMessage`
      );
    }
  }
  if (compiledSourceAttestation) {
    exactKeys(record.source, [
      'candidateMetadataPath',
      'imagePath',
      'imageSha256',
      'width',
      'height',
      'format',
      'reviewer',
      'approvedAt'
    ], `${label}.source`);
    const expectedSourcePath =
      `ai-image-metadata/battle-art/sources/${record.theme}/${record.familyId}/`
      + `v${record.descriptor.contentVersion}/`
      + `${record.candidate.image.sha256.slice('sha256:'.length)}`
      + `.${record.candidate.image.format}`;
    if (
      record.source.candidateMetadataPath !== record.candidate.metadata.path
      || record.source.imagePath !== expectedSourcePath
      || record.source.imageSha256 !== record.candidate.image.sha256
      || record.source.width !== record.candidate.image.width
      || record.source.height !== record.candidate.image.height
      || record.source.format !== record.candidate.image.format
    ) {
      throw new Error(`${label}.source does not match the attested candidate identity`);
    }
    if (
      typeof record.source.reviewer !== 'string'
      || record.source.reviewer.trim() !== record.source.reviewer
      || record.source.reviewer.length === 0
      || typeof record.source.approvedAt !== 'string'
      || !Number.isFinite(Date.parse(record.source.approvedAt))
    ) {
      throw new Error(`${label}.source approval identity is invalid`);
    }
    if (!hasLegacyPostprocessedArtifactAttestationAuthority({
      familyId: record.familyId,
      metadataSha256: record.candidate.metadata.sha256,
      stdoutSha256: record.candidate.worker.stdout.sha256,
      imageSha256: record.candidate.image.sha256,
      sourceSha256: record.source.imageSha256,
      attestationFullHash: record.fullHash
    })) {
      throw new Error(
        `${label} is not an authorized compiled-source attestation identity`
      );
    }
  }
  const expectedPath = reviewRecordPath(
    record.theme,
    record.familyId,
    record.candidate.image.sha256
  );
  if (relativePath !== expectedPath) throw new Error(`${label} path is not canonical`);
  assertHash(record.fullHash, `${label}.fullHash`);
  const expectedFullHash = sha256(Buffer.from(stableJson(
    reviewRecordProjection(record)
  )));
  if (record.fullHash !== expectedFullHash) {
    throw new Error(`${label}.fullHash does not match its content`);
  }
  return record;
}

function parseSnapshotJson(snapshot, label) {
  try {
    return JSON.parse(snapshot.contents.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid readable JSON: ${error.message}`);
  }
}

function draftDescriptorProjection(descriptor) {
  return {
    ...descriptor,
    status: 'draft',
    content: {
      ...descriptor.content,
      sourceSha256: null,
      runtimeSha256: null,
      immutableUrl: null
    },
    source: null
  };
}

export function candidateValidationDescriptorSha256(descriptor) {
  return sha256(Buffer.from(stableJson(draftDescriptorProjection(descriptor))));
}

async function assertCompiledCurrentSourceCandidate(loaded, entry, evidence) {
  const { descriptor } = entry;
  if (descriptor.status !== 'compiled') {
    throw new Error(
      `${descriptor.id} is ${descriptor.status}; `
      + 'compiled-current-source attestation requires a compiled family'
    );
  }
  const expectedSourcePath =
    `ai-image-metadata/battle-art/sources/${descriptor.theme}/${descriptor.id}/`
    + `v${descriptor.content.version}/`
    + `${evidence.actual.sha256.slice('sha256:'.length)}`
    + `.${evidence.actual.format}`;
  if (
    descriptor.source.candidateMetadataPath !== evidence.paths.metadata
    || descriptor.source.imagePath !== expectedSourcePath
    || descriptor.source.imageSha256 !== evidence.actual.sha256
    || descriptor.content.sourceSha256 !== evidence.actual.sha256
    || descriptor.source.width !== evidence.actual.width
    || descriptor.source.height !== evidence.actual.height
    || descriptor.source.format !== evidence.actual.format
  ) {
    throw new Error(
      `${descriptor.id} compiled source does not match the preserved review candidate`
    );
  }
  const sourceBytes = await readPinnedRegularFile(
    loaded.root,
    descriptor.source.imagePath,
    descriptor.source.imageSha256,
    `${descriptor.id} compiled attestation source`
  );
  if (!sourceBytes.equals(evidence.candidateBytes)) {
    throw new Error(
      `${descriptor.id} compiled source is not byte-identical to the review candidate`
    );
  }
  const source = await inspectImageContents(
    descriptor.source.imagePath,
    sourceBytes
  );
  for (const key of ['bytes', 'width', 'height', 'format', 'sha256']) {
    if (source[key] !== evidence.actual[key]) {
      throw new Error(
        `${descriptor.id} compiled source image identity does not match the review candidate`
      );
    }
  }
}

async function loadReviewCandidate(loaded, entry, {
  reviewFullHash = null,
  allowCompiledCurrentSource = false,
  verifyGeneratedArtifact = false,
  allowHistoricalRejectedEffectivePrompt = false
} = {}) {
  if (typeof allowCompiledCurrentSource !== 'boolean') {
    throw new Error('compiled-current-source review policy must be boolean');
  }
  if (typeof verifyGeneratedArtifact !== 'boolean') {
    throw new Error('generated-artifact verification policy must be boolean');
  }
  if (typeof allowHistoricalRejectedEffectivePrompt !== 'boolean') {
    throw new Error('historical rejected effective-prompt policy must be boolean');
  }
  if (allowHistoricalRejectedEffectivePrompt && reviewFullHash === null) {
    throw new Error(
      'historical rejected effective-prompt replay requires an immutable review pin'
    );
  }
  const compiledCurrentSource =
    allowCompiledCurrentSource && entry.descriptor.status === 'compiled';
  if (
    !['draft', 'approved'].includes(entry.descriptor.status)
    && !compiledCurrentSource
  ) {
    throw new Error(
      `${entry.descriptor.id} is ${entry.descriptor.status}; `
      + 'only draft or just-approved families may be reviewed'
    );
  }
  const paths = candidatePaths(entry.descriptor);
  const metadataSnapshot = await readRegularFileSnapshot(
    loaded.root,
    paths.metadata,
    'candidate metadata'
  );
  const candidate = parseSnapshotJson(metadataSnapshot, 'candidate metadata');
  const legacy = candidate?.schemaVersion === LEGACY_CANDIDATE_SCHEMA;
  const revalidated =
    candidate?.schemaVersion === REVALIDATED_CANDIDATE_SCHEMA;
  exactKeys(candidate, [
    'schemaVersion',
    'familyId',
    'theme',
    'descriptorPath',
    'descriptorSha256',
    'promptProfile',
    'styleReferences',
    ...(!legacy && !revalidated
      ? ['styleReferenceMode', 'styleReferenceProvenance']
      : []),
    ...(!legacy && candidate.derivation !== undefined
      ? ['derivation']
      : []),
    ...(revalidated ? ['origin'] : []),
    'image',
    ...(!revalidated ? ['worker'] : []),
    'status'
  ], 'candidate metadata');
  if ((!legacy
      && candidate.schemaVersion !== CANDIDATE_SCHEMA
      && !revalidated)
    || candidate.familyId !== entry.descriptor.id
    || candidate.theme !== entry.descriptor.theme
    || candidate.descriptorPath !== entry.path
    || candidate.status !== 'candidate-awaiting-review') {
    throw new Error('candidate does not belong to the selected family');
  }
  if (legacy) {
    assertAllowlistedLegacyCandidate(
      paths.metadata,
      candidate,
      'candidate metadata'
    );
  }
  const draftPin = sha256(Buffer.from(stableJson(
    draftDescriptorProjection(entry.descriptor)
  )));
  if (candidate.descriptorSha256 !== draftPin) {
    throw new Error('candidate descriptor pin mismatch');
  }
  if (stableJson(candidate.promptProfile) !== stableJson(entry.descriptor.promptProfile)
    || stableJson(candidate.styleReferences) !== stableJson(entry.descriptor.styleReferences)) {
    throw new Error('candidate frozen input pins mismatch');
  }
  if (![paths.imagePng, paths.imageWebp].includes(candidate.image?.path)) {
    throw new Error('candidate image path is outside the canonical family outputs');
  }
  const candidateBytes = await readPinnedRegularFile(
    loaded.root,
    candidate.image.path,
    candidate.image.sha256,
    `${entry.descriptor.id} review candidate`
  );
  const actual = await inspectImageContents(candidate.image.path, candidateBytes);
  if (stableJson(actual) !== stableJson(candidate.image)) {
    throw new Error('candidate image pin mismatch');
  }
  await validateRasterBytes({
    bytes: candidateBytes,
    descriptor: entry.descriptor,
    profile: loaded.promptProfile,
    label: `${entry.descriptor.id} review candidate`
  });
  const derivationEvidence = legacy
    ? null
    : await verifyCandidateRouteDerivation({
        root: loaded.root,
        descriptor: entry.descriptor,
        candidate,
        candidateBytes,
        profile: loaded.promptProfile,
        paths,
        candidateMetadataPin: metadataSnapshot.pin,
        reviewFullHash,
        label: `${entry.descriptor.id} review candidate route derivation`
      });
  if (revalidated) {
    await readPinnedRegularFile(
      loaded.root,
      metadataSnapshot.pin.path,
      metadataSnapshot.pin.sha256,
      'candidate metadata'
    );
    if (derivationEvidence?.source !== undefined) {
      await readPinnedRegularFile(
        loaded.root,
        derivationEvidence.source.path,
        derivationEvidence.source.sha256,
        `${entry.descriptor.id} review raw generated artifact`
      );
    }
    if (entry.descriptor.status === 'approved') {
      if (
        entry.descriptor.source.candidateMetadataPath !== paths.metadata
        || entry.descriptor.source.imageSha256 !== actual.sha256
        || entry.descriptor.content.sourceSha256 !== actual.sha256
      ) {
        throw new Error('approved descriptor does not match the current candidate');
      }
    }
    const evidence = {
      paths,
      candidate,
      candidateBytes,
      actual,
      metadata: metadataSnapshot.pin,
      prompt: null,
      stdout: null,
      stderr: null,
      lastMessage: null,
      derivationSource: derivationEvidence?.source ?? null
    };
    if (compiledCurrentSource) {
      await assertCompiledCurrentSourceCandidate(loaded, entry, evidence);
    }
    return evidence;
  }
  exactKeys(candidate.worker, [
    'command',
    'args',
    'ephemeral',
    'invocationCount',
    'timeoutMs',
    'promptPath',
    'stdoutPath',
    'stderrPath',
    'lastMessagePath'
  ], 'candidate metadata.worker');
  if (
    candidate.worker.command !== 'codex'
    || !Array.isArray(candidate.worker.args)
    || candidate.worker.args.some(argument => typeof argument !== 'string')
    || candidate.worker.ephemeral !== true
    || candidate.worker.invocationCount !== 1
    || !Number.isSafeInteger(candidate.worker.timeoutMs)
    || candidate.worker.timeoutMs < 1
    || candidate.worker.promptPath !== paths.prompt
    || candidate.worker.stdoutPath !== paths.stdout
    || candidate.worker.stderrPath !== paths.stderr
    || ![null, paths.lastMessage].includes(candidate.worker.lastMessagePath)
  ) {
    throw new Error('candidate worker provenance is invalid');
  }
  if (!legacy) {
    assertStyleReferenceProvenance({
      styleReferences: candidate.styleReferences,
      provenance: candidate.styleReferenceProvenance,
      mode: candidate.styleReferenceMode,
      args: candidate.worker.args,
      label: 'candidate metadata'
    });
  }
  const [prompt, stdout, stderr, lastMessage] = await Promise.all([
    readRegularFileSnapshot(loaded.root, paths.prompt, 'candidate prompt'),
    readRegularFileSnapshot(loaded.root, paths.stdout, 'candidate worker stdout'),
    readRegularFileSnapshot(loaded.root, paths.stderr, 'candidate worker stderr'),
    candidate.worker.lastMessagePath === null
      ? Promise.resolve(null)
      : readRegularFileSnapshot(
          loaded.root,
          paths.lastMessage,
          'candidate worker last message'
        )
  ]);
  if (!legacy
    && entry.descriptor.status === 'draft'
    && !allowHistoricalRejectedEffectivePrompt) {
    const styleFiles = styleReferenceProvenance(
      entry.descriptor.styleReferences
    ).map(value => value.stagedBasename);
    const expectedPrompt = buildCurrentEffectivePrompt({
      descriptor: entry.descriptor,
      profile: loaded.promptProfile,
      styleFiles,
      textStyleFallback: candidate.styleReferenceMode === 'text-fallback'
    });
    const expectedPromptContents = Buffer.from(`${expectedPrompt}\n`);
    if (!prompt.contents.equals(expectedPromptContents)) {
      throw new Error(
        `${entry.descriptor.id} candidate effective prompt is stale; `
        + 'generate a fresh candidate under the current prompt contract'
      );
    }
  }
  const allowExactDuplicateArtifactEvidence = legacy
    && LEGACY_DUPLICATE_ARTIFACT_TUPLES.some(tuple => (
      tuple.metadataSha256 === metadataSnapshot.pin.sha256
      && tuple.stdoutSha256 === stdout.pin.sha256
      && tuple.imageSha256 === actual.sha256
      && tuple.reviewFullHash === reviewFullHash
    ));
  const allowPostprocessedArtifactEvidence = compiledCurrentSource
    && legacy
    && hasLegacyPostprocessedArtifactAttestationAuthority({
      familyId: entry.descriptor.id,
      metadataSha256: metadataSnapshot.pin.sha256,
      stdoutSha256: stdout.pin.sha256,
      imageSha256: actual.sha256,
      sourceSha256: entry.descriptor.source.imageSha256
    });
  const eligibleParentOwnedRouteHandoff =
    !legacy
    && !revalidated
    && entry.descriptor.category === 'route-transition'
    && entry.descriptor.theme !== 'forest';
  const workerAudit = auditCodexWorkerJsonl(stdout.contents, {
    allowExactDuplicateArtifactEvidence,
    allowPostprocessedArtifactEvidence,
    allowMixedExplicitArtifactEvidence:
      !legacy && entry.descriptor.category === 'route-transition'
  });
  const genericWorkerEvidence =
    workerAudit.imagegenInvocationCount === 1
    && workerAudit.imagegenInvocationCount === candidate.worker.invocationCount;
  let parentOwnedRouteHandoff = false;
  if (
    !genericWorkerEvidence
    && workerAudit.imagegenInvocationCount === 0
    && eligibleParentOwnedRouteHandoff
  ) {
    if (
      candidate.worker.invocationCount !== 1
      || derivationEvidence?.source === undefined
    ) {
      throw new Error(
        `${entry.descriptor.id} parent-owned route candidate requires one `
        + 'worker invocation and replayed raw derivation evidence'
      );
    }
    auditCanonicalParentRouteHandoffJsonl(stdout.contents);
    parentOwnedRouteHandoff = true;
  } else if (!genericWorkerEvidence) {
    throw new Error(
      `${entry.descriptor.id} candidate worker evidence must prove exactly `
      + 'one imagegen invocation'
    );
  }
  if (
    compiledCurrentSource
    && verifyGeneratedArtifact
    && !parentOwnedRouteHandoff
  ) {
    await verifyCodexImagegenEvidence(workerAudit);
  }
  await readPinnedRegularFile(
    loaded.root,
    metadataSnapshot.pin.path,
    metadataSnapshot.pin.sha256,
    'candidate metadata'
  );
  await readPinnedRegularFile(
    loaded.root,
    actual.path,
    actual.sha256,
    `${entry.descriptor.id} review candidate`
  );
  for (const evidence of [prompt, stdout, stderr, lastMessage].filter(Boolean)) {
    await readPinnedRegularFile(
      loaded.root,
      evidence.pin.path,
      evidence.pin.sha256,
      `candidate evidence ${evidence.pin.path}`
    );
  }
  if (derivationEvidence?.source !== undefined) {
    await readPinnedRegularFile(
      loaded.root,
      derivationEvidence.source.path,
      derivationEvidence.source.sha256,
      `${entry.descriptor.id} review raw generated artifact`
    );
  }
  if (entry.descriptor.status === 'approved') {
    if (
      entry.descriptor.source.candidateMetadataPath !== paths.metadata
      || entry.descriptor.source.imageSha256 !== actual.sha256
      || entry.descriptor.content.sourceSha256 !== actual.sha256
    ) {
      throw new Error('approved descriptor does not match the current candidate');
    }
  }
  const evidence = {
    paths,
    candidate,
    candidateBytes,
    actual,
    metadata: metadataSnapshot.pin,
    prompt: prompt.pin,
    stdout: stdout.pin,
    stderr: stderr.pin,
    lastMessage: lastMessage?.pin ?? null,
    derivationSource: derivationEvidence?.source ?? null
  };
  if (compiledCurrentSource) {
    await assertCompiledCurrentSourceCandidate(loaded, entry, evidence);
  }
  return evidence;
}

function buildReviewRecord(entry, evidence, {
  reviewer,
  decision,
  reason,
  reviewedAt,
  compiledCurrentSourceAttestation = false
}) {
  if (typeof compiledCurrentSourceAttestation !== 'boolean') {
    throw new Error('compiled-current-source attestation policy must be boolean');
  }
  const legacy = evidence.candidate.schemaVersion === LEGACY_CANDIDATE_SCHEMA;
  const revalidated =
    evidence.candidate.schemaVersion === REVALIDATED_CANDIDATE_SCHEMA;
  const attestation = compiledCurrentSourceAttestation && legacy;
  const persistedImageArguments = legacy || revalidated
    ? null
    : imageArguments(
        evidence.candidate.worker.args,
        'candidate metadata.worker.args'
      ).map(value => path.basename(value));
  const projection = {
    schemaVersion: attestation
      ? COMPILED_SOURCE_ATTESTATION_SCHEMA
      : legacy
        ? LEGACY_REVIEW_SCHEMA
        : revalidated
          ? REVALIDATED_REVIEW_SCHEMA
          : REVIEW_SCHEMA,
    theme: entry.descriptor.theme,
    familyId: entry.descriptor.id,
    decision,
    reviewer: reviewer.trim(),
    reason,
    reviewedAt,
    descriptor: {
      path: entry.path,
      sha256: evidence.candidate.descriptorSha256,
      contentVersion: entry.descriptor.content.version
    },
    candidate: {
      metadata: evidence.metadata,
      image: evidence.actual,
      ...(evidence.candidate.derivation
        ? {
            derivation: structuredClone(evidence.candidate.derivation)
          }
        : {}),
      ...(revalidated
        ? { origin: structuredClone(evidence.candidate.origin) }
        : {}),
      promptProfile: structuredClone(evidence.candidate.promptProfile),
      styleReferences: structuredClone(evidence.candidate.styleReferences),
      ...(!legacy && !revalidated
        ? {
            styleReferenceMode: evidence.candidate.styleReferenceMode,
            styleReferenceProvenance: structuredClone(
              evidence.candidate.styleReferenceProvenance
            )
          }
        : {}),
      ...(!revalidated
        ? {
            worker: {
              command: evidence.candidate.worker.command,
              ephemeral: evidence.candidate.worker.ephemeral,
              invocationCount: evidence.candidate.worker.invocationCount,
              timeoutMs: evidence.candidate.worker.timeoutMs,
              ...(!legacy
                ? { imageArguments: persistedImageArguments }
                : {}),
              prompt: evidence.prompt,
              stdout: evidence.stdout,
              stderr: evidence.stderr,
              lastMessage: evidence.lastMessage
            }
          }
        : {})
    },
    ...(attestation
      ? { source: structuredClone(entry.descriptor.source) }
      : {})
  };
  return {
    ...projection,
    fullHash: sha256(Buffer.from(stableJson(projection)))
  };
}

function sameReviewRequest(existing, proposed) {
  const withoutTime = value => {
    const {
      reviewedAt: _reviewedAt,
      fullHash: _fullHash,
      ...rest
    } = value;
    return rest;
  };
  return stableJson(withoutTime(existing)) === stableJson(withoutTime(proposed));
}

async function readExistingReview(root, relative) {
  try {
    const { value } = await readJson(root, relative, `battle-art review ${relative}`);
    const review = assertReviewRecord(value, relative);
    if (review.schemaVersion === LEGACY_REVIEW_SCHEMA) {
      assertAllowlistedLegacyJson(
        relative,
        review,
        `battle-art review ${relative}`
      );
    }
    return review;
  } catch (error) {
    if (error.message.includes('ENOENT')) return null;
    throw error;
  }
}

async function recordCandidateReviewUnlocked({
  root: rootValue,
  theme,
  family,
  reviewer,
  decision,
  reason,
  reviewedAt
}) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('--decision must be approved or rejected');
  }
  if (typeof reviewer !== 'string' || reviewer.trim().length === 0) {
    throw new Error('--reviewer is required');
  }
  assertReviewReason(reason);
  if (reviewedAt !== undefined && !Number.isFinite(Date.parse(reviewedAt))) {
    throw new Error('reviewedAt is invalid');
  }
  const loaded = await loadBattleArt(rootValue);
  const [entry] = selectFamilies(loaded, { theme, family });
  const approvedBackfill = entry.descriptor.status === 'approved';
  const compiledCurrentSource = entry.descriptor.status === 'compiled';
  if ((approvedBackfill || compiledCurrentSource) && decision !== 'approved') {
    throw new Error(
      'an approved or compiled family only accepts an approved backfill review'
    );
  }
  if (entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2) {
    const readiness = await loadReadinessPlan(loaded.root);
    assertV2DescriptorsPlanned([entry], readiness.plan);
  }
  const evidence = await loadReviewCandidate(loaded, entry, {
    allowCompiledCurrentSource: compiledCurrentSource,
    verifyGeneratedArtifact: compiledCurrentSource
  });
  const compiledLegacyAttestation = compiledCurrentSource
    && evidence.candidate.schemaVersion === LEGACY_CANDIDATE_SCHEMA;
  const sourceIdentityBackfill = approvedBackfill
    || (compiledCurrentSource && !compiledLegacyAttestation);
  if (sourceIdentityBackfill) {
    if (reviewer.trim() !== entry.descriptor.source.reviewer) {
      throw new Error(
        'current-source backfill reviewer must match the approved descriptor'
      );
    }
    if (
      reviewedAt !== undefined
      && reviewedAt !== entry.descriptor.source.approvedAt
    ) {
      throw new Error(
        'current-source backfill review time must match the approved descriptor'
      );
    }
  }
  const relative = reviewRecordPath(
    entry.descriptor.theme,
    entry.descriptor.id,
    evidence.actual.sha256
  );
  const existing = await readExistingReview(loaded.root, relative);
  const proposed = buildReviewRecord(entry, evidence, {
    reviewer,
    decision,
    reason,
    reviewedAt: reviewedAt
      ?? existing?.reviewedAt
      ?? (sourceIdentityBackfill
        ? entry.descriptor.source.approvedAt
        : new Date().toISOString()),
    compiledCurrentSourceAttestation: compiledCurrentSource
  });
  assertReviewRecord(proposed, relative);
  if (existing !== null) {
    if (!sameReviewRequest(existing, proposed)
      || (reviewedAt !== undefined && existing.reviewedAt !== reviewedAt)) {
      throw new Error(
        `immutable battle-art review already exists with a conflicting decision: ${relative}`
      );
    }
    return {
      ok: true,
      changed: false,
      path: relative,
      record: existing,
      candidateBytes: evidence.candidateBytes
    };
  }
  try {
    await atomicWrite(loaded.root, relative, stableJson(proposed), {
      immutable: true
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const raced = await readExistingReview(loaded.root, relative);
    if (raced === null || !sameReviewRequest(raced, proposed)) {
      throw new Error(
        `immutable battle-art review already exists with a conflicting decision: ${relative}`
      );
    }
    return {
      ok: true,
      changed: false,
      path: relative,
      record: raced,
      candidateBytes: evidence.candidateBytes
    };
  }
  return {
    ok: true,
    changed: true,
    path: relative,
    record: proposed,
    candidateBytes: evidence.candidateBytes
  };
}

export async function recordCandidateReview(options) {
  if (!['approved', 'rejected'].includes(options.decision)) {
    throw new Error('--decision must be approved or rejected');
  }
  if (
    typeof options.reviewer !== 'string'
    || options.reviewer.trim().length === 0
  ) {
    throw new Error('--reviewer is required');
  }
  assertReviewReason(options.reason);
  const root = projectRoot(options.root);
  const result = await withBattleArtCandidateLock({
    root,
    theme: options.theme,
    family: options.family
  }, () => recordCandidateReviewUnlocked({
    ...options,
    root
  }));
  const {
    candidateBytes: _candidateBytes,
    ...publicResult
  } = result;
  return publicResult;
}

async function approveCandidateUnlocked({
  root: rootValue,
  theme,
  family,
  reviewer,
  decision,
  reason,
  approvedAt
}) {
  if (decision !== 'approved') throw new Error('--decision approved is required');
  if (typeof reviewer !== 'string' || reviewer.trim().length === 0) throw new Error('--reviewer is required');
  assertReviewReason(reason);
  const loaded = await loadBattleArt(rootValue);
  const [entry] = selectFamilies(loaded, { theme, family });
  if (entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2) {
    const readiness = await loadReadinessPlan(loaded.root);
    assertV2DescriptorsPlanned([entry], readiness.plan);
  }
  if (entry.descriptor.status === 'approved') {
    const relative = reviewRecordPath(
      entry.descriptor.theme,
      entry.descriptor.id,
      entry.descriptor.source.imageSha256
    );
    let review = await readExistingReview(loaded.root, relative);
    if (review === null) {
      review = (await recordCandidateReviewUnlocked({
        root: loaded.root,
        theme,
        family,
        reviewer,
        decision,
        reason,
        reviewedAt: approvedAt
      })).record;
    }
    const draftPin = sha256(Buffer.from(stableJson(
      draftDescriptorProjection(entry.descriptor)
    )));
    if (
      review.decision !== 'approved'
      || review.reviewer !== reviewer.trim()
      || review.reason !== reason
      || (approvedAt !== undefined && review.reviewedAt !== approvedAt)
      || review.descriptor.path !== entry.path
      || review.descriptor.sha256 !== draftPin
      || review.candidate.image.sha256 !== entry.descriptor.source.imageSha256
      || review.reviewedAt !== entry.descriptor.source.approvedAt
    ) {
      throw new Error('approved family does not match the immutable review record');
    }
    return {
      ok: true,
      changed: false,
      family,
      descriptor: entry.path,
      sourcePath: entry.descriptor.source.imagePath,
      sourceSha256: entry.descriptor.source.imageSha256,
      reviewPath: relative
    };
  }
  if (entry.descriptor.status !== 'draft') {
    throw new Error(
      `${entry.descriptor.id} is ${entry.descriptor.status}; only draft families may be approved`
    );
  }
  const review = await recordCandidateReviewUnlocked({
    root: loaded.root,
    theme,
    family,
    reviewer,
    decision,
    reason,
    reviewedAt: approvedAt
  });
  const actual = review.record.candidate.image;
  const paths = candidatePaths(entry.descriptor);
  const candidateBytes = review.candidateBytes;
  const sourceHashToken = actual.sha256.slice('sha256:'.length);
  const reviewedSourcePath = `ai-image-metadata/battle-art/sources/${entry.descriptor.theme}/`
    + `${entry.descriptor.id}/v${entry.descriptor.content.version}/${sourceHashToken}.${actual.format}`;
  await atomicWrite(
    loaded.root,
    reviewedSourcePath,
    candidateBytes
  );
  if (await hashFile(resolveTracked(loaded.root, reviewedSourcePath)) !== actual.sha256) {
    throw new Error('reviewed source promotion hash mismatch');
  }
  const approved = {
    ...entry.descriptor,
    status: 'approved',
    content: {
      ...entry.descriptor.content,
      sourceSha256: actual.sha256,
      runtimeSha256: null,
      immutableUrl: null
    },
    source: {
      candidateMetadataPath: paths.metadata,
      imagePath: reviewedSourcePath,
      imageSha256: actual.sha256,
      width: actual.width,
      height: actual.height,
      format: actual.format,
      reviewer: review.record.reviewer,
      approvedAt: review.record.reviewedAt
    }
  };
  assertDescriptor(approved, loaded.manifest);
  await atomicWrite(loaded.root, entry.path, stableJson(approved));
  return {
    ok: true,
    changed: true,
    family,
    descriptor: entry.path,
    sourcePath: reviewedSourcePath,
    sourceSha256: actual.sha256,
    reviewPath: review.path
  };
}

export async function approveCandidate(options) {
  if (options.decision !== 'approved') {
    throw new Error('--decision approved is required');
  }
  if (
    typeof options.reviewer !== 'string'
    || options.reviewer.trim().length === 0
  ) {
    throw new Error('--reviewer is required');
  }
  assertReviewReason(options.reason);
  const root = projectRoot(options.root);
  return withBattleArtCandidateLock({
    root,
    theme: options.theme,
    family: options.family
  }, () => approveCandidateUnlocked({
    ...options,
    root
  }));
}

async function promptProfileFor(root, manifest) {
  const { value } = await readJson(root, manifest.promptProfile.path, 'battle-art prompt profile');
  exactKeys(value, [
    'schemaVersion',
    'id',
    'frozen',
    'background',
    'prompt',
    'negativeConstraints'
  ], 'battle-art prompt profile');
  exactKeys(value.background, ['mode', 'chroma', 'tolerance'], 'battle-art prompt profile.background');
  if (value.schemaVersion !== 'battle-art-prompt-profile-v1'
    || value.frozen !== true
    || value.id !== manifest.promptProfile.id) {
    throw new Error('battle-art prompt profile is not the frozen pinned profile');
  }
  if (value.background.mode !== 'chroma-or-transparent'
    || !COLOR_PATTERN.test(value.background.chroma)
    || !Number.isInteger(value.background.tolerance)
    || value.background.tolerance < 0
    || value.background.tolerance > 255) {
    throw new Error('battle-art prompt background contract is invalid');
  }
  if (typeof value.prompt !== 'string' || value.prompt.trim().length === 0) {
    throw new Error('battle-art prompt text is required');
  }
  if (!Array.isArray(value.negativeConstraints)
    || value.negativeConstraints.length === 0
    || value.negativeConstraints.some(constraint => (
      typeof constraint !== 'string' || constraint.trim().length === 0
    ))) {
    throw new Error('battle-art prompt negative constraints are invalid');
  }
  return value;
}

export async function compileSource(root, descriptor, promptProfile) {
  const input = resolveTracked(root, descriptor.source.imagePath, 'approved source path');
  if (await hashFile(input) !== descriptor.source.imageSha256) {
    throw new Error(`${descriptor.id} approved source hash mismatch`);
  }
  const sourceBytes = await readFile(input);
  const canonical = await validateRasterBytes({
    bytes: sourceBytes,
    descriptor,
    profile: promptProfile,
    label: `${descriptor.id} approved source`
  });
  const prepared = prepareRuntimeRaster(canonical, descriptor);
  return sharp(prepared.data, {
    raw: {
      width: prepared.width,
      height: prepared.height,
      channels: 4
    }
  })
    .webp({
      lossless: true,
      effort: 6,
      alphaQuality: 100,
      smartSubsample: false
    })
    .toBuffer();
}

function runtimeRecord(descriptor) {
  const variant = descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
    ? {
        ...(descriptor.capabilities.direction === null
          ? {}
          : { direction: descriptor.capabilities.direction }),
    ...(descriptor.capabilities.routeTopology === null
          ? {}
          : { routeTopology: descriptor.capabilities.routeTopology }),
        ...(descriptor.capabilities.surfaceVariant === null
          ? {}
          : { surfaceVariant: descriptor.capabilities.surfaceVariant }),
        ecologyProfile: descriptor.capabilities.ecologyProfile,
        ...(descriptor.capabilities.tierBands.length === 1
          ? { tier: descriptor.capabilities.tierBands[0] }
          : {}),
        ...(descriptor.capabilities.heightDeltas.length === 1
          && descriptor.capabilities.heightDeltas[0] > 0
          ? { heightDelta: descriptor.capabilities.heightDeltas[0] }
          : {})
      }
    : null;
  return {
    id: descriptor.id,
    theme: descriptor.theme,
    category: descriptor.category,
    ...(descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
      ? { variant }
      : {}),
    contentVersion: descriptor.content.version,
    sha256: descriptor.content.runtimeSha256,
    immutableUrl: descriptor.content.immutableUrl,
    width: descriptor.canvas.width,
    height: descriptor.canvas.height,
    pivot: descriptor.placement.pivot,
    anchor: descriptor.placement.anchor,
    footprint: descriptor.placement.footprint,
    collision: descriptor.placement.collision,
    drawBounds: descriptor.placement.drawBounds,
    occlusionBounds: descriptor.placement.occlusionBounds,
    stratum: descriptor.placement.stratum
  };
}

export async function buildBundle(manifest, descriptors) {
  const renderers = descriptors
    .filter(entry => entry.descriptor.status === 'compiled')
    .map(entry => runtimeRecord(entry.descriptor))
    .sort((left, right) => left.id.localeCompare(right.id));
  const assets = renderers.map(renderer => ({
    key: renderer.id,
    contentVersion: renderer.contentVersion,
    contentHash: renderer.sha256,
    immutableUrl: renderer.immutableUrl
  }));
  const compilerProjection = {
    id: manifest.releaseId,
    version: manifest.version,
    manifestFullHash: null,
    rendererManifestFullHash: null,
    assets
  };
  const rendererHashPayload = {
    id: manifest.releaseId,
    version: manifest.version,
    renderProfile: RENDER_PROFILE,
    renderers
  };
  compilerProjection.rendererManifestFullHash =
    await computeBattleArtRendererManifestFullHash(rendererHashPayload);
  compilerProjection.manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(compilerProjection);
  return {
    schemaVersion: BUNDLE_SCHEMA,
    renderProfile: RENDER_PROFILE,
    ...compilerProjection,
    renderers
  };
}

export async function computeBattleArtRendererManifestFullHash(bundle) {
  return hashCanonicalV3Value(BATTLE_ART_RENDERER_MANIFEST_HASH_DOMAIN, {
    id: bundle.id,
    version: bundle.version,
    renderProfile: bundle.renderProfile,
    renderers: bundle.renderers
  });
}

export function toCompilerAssetBundle(bundle) {
  return {
    id: bundle.id,
    version: bundle.version,
    manifestFullHash: bundle.manifestFullHash,
    rendererManifestFullHash: bundle.rendererManifestFullHash,
    assets: structuredClone(bundle.assets)
  };
}

export function buildInventory(manifest, descriptors) {
  return {
    schemaVersion: INVENTORY_SCHEMA,
    releaseId: manifest.releaseId,
    releaseVersion: manifest.version,
    historicalReleases: [...manifest.historicalReleases],
    themes: [...manifest.themes],
    categories: [...manifest.categories],
    families: descriptors
      .map(entry => ({
        id: entry.descriptor.id,
        theme: entry.descriptor.theme,
        category: entry.descriptor.category,
        ...(entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
          ? {
              familyGroup: entry.descriptor.familyGroup,
              variantId: entry.descriptor.variantId,
              capabilities: structuredClone(entry.descriptor.capabilities)
            }
          : {}),
        status: entry.descriptor.status,
        descriptorPath: entry.path,
        contentVersion: entry.descriptor.content.version,
        sourceSha256: entry.descriptor.content.sourceSha256,
        runtimeSha256: entry.descriptor.content.runtimeSha256,
        immutableUrl: entry.descriptor.content.immutableUrl
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}

function inventoryRegistryEntry(bundle, inventoryContents) {
  const bytes = Buffer.from(inventoryContents);
  return {
    releaseId: bundle.id,
    releaseVersion: bundle.version,
    bundleManifestFullHash: bundle.manifestFullHash,
    inventoryBytes: bytes.length,
    inventorySha256: sha256(bytes)
  };
}

export function assertInventoryRegistry(registry) {
  exactKeys(
    registry,
    ['schemaVersion', 'entries'],
    'battle-art runtime inventory registry'
  );
  if (registry.schemaVersion !== INVENTORY_REGISTRY_SCHEMA
    || !Array.isArray(registry.entries)) {
    throw new Error('battle-art runtime inventory registry is invalid');
  }
  const releases = new Set();
  for (const [index, entry] of registry.entries.entries()) {
    const label = `battle-art runtime inventory registry.entries[${index}]`;
    exactKeys(entry, [
      'releaseId',
      'releaseVersion',
      'bundleManifestFullHash',
      'inventoryBytes',
      'inventorySha256'
    ], label);
    assertSafeId(entry.releaseId, `${label}.releaseId`);
    assertInteger(entry.releaseVersion, `${label}.releaseVersion`, 1);
    assertHash(entry.bundleManifestFullHash, `${label}.bundleManifestFullHash`);
    assertInteger(entry.inventoryBytes, `${label}.inventoryBytes`, 1);
    assertHash(entry.inventorySha256, `${label}.inventorySha256`);
    const releaseIdentity = `${entry.releaseId}:v${entry.releaseVersion}`;
    if (releases.has(releaseIdentity)) {
      throw new Error(
        `battle-art runtime inventory registry has duplicate or conflicting `
        + `release ${releaseIdentity}`
      );
    }
    releases.add(releaseIdentity);
  }
  const sorted = registry.entries.toSorted((left, right) => (
    left.releaseId.localeCompare(right.releaseId)
    || left.releaseVersion - right.releaseVersion
    || left.bundleManifestFullHash.localeCompare(right.bundleManifestFullHash)
  ));
  if (stableJson(registry.entries) !== stableJson(sorted)) {
    throw new Error('battle-art runtime inventory registry entries are not sorted');
  }
  return registry;
}

export function appendInventoryRegistryEntry(
  registry,
  bundle,
  inventoryContents
) {
  assertInventoryRegistry(registry);
  const entry = inventoryRegistryEntry(bundle, inventoryContents);
  const existing = registry.entries.find(candidate => (
    candidate.releaseId === entry.releaseId
    && candidate.releaseVersion === entry.releaseVersion
  ));
  if (existing !== undefined) {
    if (stableJson(existing) !== stableJson(entry)) {
      throw new Error(
        `battle-art runtime inventory registry conflicts for `
        + `${entry.releaseId}:v${entry.releaseVersion}`
      );
    }
    return structuredClone(registry);
  }
  const revised = {
    schemaVersion: INVENTORY_REGISTRY_SCHEMA,
    entries: [...registry.entries, entry].sort((left, right) => (
      left.releaseId.localeCompare(right.releaseId)
      || left.releaseVersion - right.releaseVersion
      || left.bundleManifestFullHash.localeCompare(right.bundleManifestFullHash)
    ))
  };
  assertInventoryRegistry(revised);
  return revised;
}

function assertInventoryRegistryPin(registry, bundle, inventoryContents) {
  assertInventoryRegistry(registry);
  const expected = inventoryRegistryEntry(bundle, inventoryContents);
  const matching = registry.entries.filter(entry => (
    entry.releaseId === bundle.id
    && entry.releaseVersion === bundle.version
  ));
  if (matching.length !== 1) {
    throw new Error(
      `battle-art runtime inventory registry pin for ${bundle.id}:v`
      + `${bundle.version} is missing or ambiguous`
    );
  }
  if (stableJson(matching[0]) !== stableJson(expected)) {
    throw new Error(
      `battle-art runtime inventory registry pin for ${bundle.id}:v`
      + `${bundle.version} conflicts with the active inventory`
    );
  }
}

function assertInventoryRegistryLedger(
  inventoryRegistry,
  bundleRegistry,
  historicalReleases,
  activeBundle
) {
  assertInventoryRegistry(inventoryRegistry);
  for (const entry of inventoryRegistry.entries) {
    const matches = bundleRegistry?.bundles?.filter(bundle => (
      bundle.id === entry.releaseId
      && bundle.version === entry.releaseVersion
      && bundle.manifestFullHash === entry.bundleManifestFullHash
    )) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `battle-art runtime inventory registry release ${entry.releaseId}:v`
        + `${entry.releaseVersion} has no exact runtime bundle registry identity`
      );
    }
    const [registeredBundle] = matches;
    const active = activeBundle.id === registeredBundle.id
      && activeBundle.version === registeredBundle.version
      && activeBundle.manifestFullHash === registeredBundle.manifestFullHash
      && stableJson(activeBundle) === stableJson(registeredBundle);
    const archived = historicalReleases.some(candidate => (
      candidate.release.bundle.id === registeredBundle.id
      && candidate.release.bundle.version === registeredBundle.version
      && candidate.release.bundle.manifestFullHash
        === registeredBundle.manifestFullHash
      && stableJson(candidate.release.bundle) === stableJson(registeredBundle)
    ));
    if (!active && !archived) {
      throw new Error(
        `battle-art runtime inventory registry release ${entry.releaseId}:v`
        + `${entry.releaseVersion} is not backed by the active bundle or an archive`
      );
    }
  }
}

export function buildBundleRegistry(historicalReleases, currentBundle) {
  const byIdentity = new Map();
  for (const bundle of historicalReleases.map(entry => entry.release.bundle)) {
    const identity = `${bundle.id}:v${bundle.version}:${bundle.manifestFullHash}`;
    const existing = byIdentity.get(identity);
    if (existing && stableJson(existing) !== stableJson(bundle)) {
      throw new Error(`battle-art bundle registry identity conflict for ${identity}`);
    }
    byIdentity.set(identity, structuredClone(bundle));
  }
  const currentIdentity =
    `${currentBundle.id}:v${currentBundle.version}:${currentBundle.manifestFullHash}`;
  const archivedCurrent = byIdentity.get(currentIdentity);
  if (archivedCurrent
    && stableJson(archivedCurrent) !== stableJson(currentBundle)) {
    throw new Error(
      `battle-art bundle registry identity conflict for ${currentIdentity}`
    );
  }
  byIdentity.delete(currentIdentity);
  const historical = [...byIdentity.values()].sort((left, right) => (
    left.id.localeCompare(right.id)
    || left.version - right.version
    || left.manifestFullHash.localeCompare(right.manifestFullHash)
  ));
  return {
    schemaVersion: BUNDLE_REGISTRY_SCHEMA,
    bundles: [...historical, structuredClone(currentBundle)]
  };
}

export function resolveArchivedRuntimeBundle(
  historicalReleases,
  registry,
  { id, version, manifestFullHash }
) {
  assertSafeId(id, 'battle-art bundle pin.id');
  assertInteger(version, 'battle-art bundle pin.version', 1);
  assertHash(manifestFullHash, 'battle-art bundle pin.manifestFullHash');
  if (
    !registry
    || registry.schemaVersion !== BUNDLE_REGISTRY_SCHEMA
    || !Array.isArray(registry.bundles)
  ) {
    throw new Error('battle-art runtime bundle registry is invalid');
  }
  const matchesPin = bundle =>
    bundle?.id === id
    && bundle?.version === version
    && bundle?.manifestFullHash === manifestFullHash;
  const registryMatches = registry.bundles.filter(matchesPin);
  if (registryMatches.length !== 1) {
    throw new Error(
      `exact battle-art bundle ${id}@${version} ${manifestFullHash} `
      + 'is missing or ambiguous in the runtime bundle registry'
    );
  }
  if (!Array.isArray(historicalReleases)) {
    throw new Error('battle-art historical releases are invalid');
  }
  const archiveMatches = historicalReleases.filter(entry =>
    matchesPin(entry?.release?.bundle)
  );
  if (archiveMatches.length !== 1) {
    throw new Error(
      `exact battle-art bundle ${id}@${version} ${manifestFullHash} `
      + 'has no immutable release archive'
    );
  }
  const archived = archiveMatches[0];
  if (stableJson(archived.release.bundle) !== stableJson(registryMatches[0])) {
    throw new Error(
      `exact battle-art bundle ${id}@${version} ${manifestFullHash} `
      + 'differs between its registry and immutable release archive'
    );
  }
  return {
    path: archived.path,
    bundle: structuredClone(archived.release.bundle)
  };
}

function archivedSourceProjection(descriptors) {
  return descriptors.map(entry => ({
    familyId: entry.descriptor.id,
    contentVersion: entry.descriptor.content.version,
    path: entry.descriptor.source.imagePath,
    sha256: entry.descriptor.source.imageSha256,
    width: entry.descriptor.source.width,
    height: entry.descriptor.source.height,
    format: entry.descriptor.source.format
  })).sort((left, right) => left.familyId.localeCompare(right.familyId));
}

function archivedSourceForDescriptor(descriptor) {
  return archivedSourceProjection([{
    descriptor,
    path: descriptorPath(descriptor.theme, descriptor.id)
  }])[0];
}

async function readRuntimeArtifacts(loaded) {
  const [
    { value: bundle },
    { value: registry },
    { value: inventory, contents: inventoryContents },
    { value: inventoryRegistry },
    { value: frontendBundle },
    { value: frontendRegistry }
  ] = await Promise.all([
    readJson(loaded.root, BUNDLE_PATH, 'runtime asset bundle'),
    readJson(loaded.root, BUNDLE_REGISTRY_PATH, 'runtime asset bundle registry'),
    readJson(loaded.root, INVENTORY_PATH, 'battle-art inventory'),
    readJson(
      loaded.root,
      INVENTORY_REGISTRY_PATH,
      'runtime asset inventory registry'
    ),
    readJson(loaded.root, FRONTEND_BUNDLE_PATH, 'frontend runtime asset bundle'),
    readJson(
      loaded.root,
      FRONTEND_BUNDLE_REGISTRY_PATH,
      'frontend runtime asset bundle registry'
    )
  ]);
  if (inventoryContents !== stableJson(inventory)) {
    throw new Error('battle-art inventory is not canonical JSON');
  }
  return {
    bundle,
    registry,
    inventory,
    inventoryContents,
    inventoryRegistry,
    frontendBundle,
    frontendRegistry
  };
}

export async function assertRuntimeArtifactState(loaded, artifacts) {
  const {
    bundle,
    registry,
    inventory,
    inventoryContents = stableJson(inventory),
    inventoryRegistry,
    frontendBundle,
    frontendRegistry
  } = artifacts;
  assertInventoryRegistryLedger(
    inventoryRegistry,
    registry,
    loaded.historicalReleases,
    bundle
  );
  assertInventoryRegistryPin(
    inventoryRegistry,
    bundle,
    inventoryContents
  );
  const compiledDescriptors = loaded.descriptors.filter(entry => (
    entry.descriptor.status === 'compiled'
  ));
  const draftDescriptors = loaded.descriptors.filter(entry => (
    entry.descriptor.status === 'draft'
  ));
  const noncompiledDescriptors = loaded.descriptors.filter(entry => (
    entry.descriptor.status !== 'compiled'
  ));
  const currentProjection = (
    bundle?.version === loaded.manifest.version
    && noncompiledDescriptors.length === 0
  );
  const stagedDraftProjection = (
    bundle?.version === loaded.manifest.version - 1
    && noncompiledDescriptors.length > 0
    && loaded.descriptors.every(entry => (
      entry.descriptor.status === 'compiled'
      || entry.descriptor.status === 'draft'
      || entry.descriptor.status === 'approved'
    ))
  );
  if (!currentProjection && !stagedDraftProjection) {
    throw new Error(
      'runtime asset bundle version does not match the current release or '
      + 'one-version draft staging'
    );
  }

  let expectedBundle;
  let expectedInventory;
  if (currentProjection) {
    expectedBundle = await buildBundle(loaded.manifest, loaded.descriptors);
    const currentReleasePath =
      `ai-image-metadata/battle-art/releases/${bundle.id}.v${bundle.version}.json`;
    const inventoryCandidates = [
      buildInventory(loaded.manifest, loaded.descriptors),
      buildInventory({
        ...loaded.manifest,
        historicalReleases: loaded.manifest.historicalReleases.filter(
          relative => relative !== currentReleasePath
        )
      }, loaded.descriptors)
    ];
    if (!inventoryCandidates.some(candidate => (
      stableJson(candidate) === inventoryContents
    ))) {
      throw new Error('battle-art inventory is incomplete or stale');
    }
    expectedInventory = structuredClone(inventory);
  } else {
    const archived = resolveArchivedRuntimeBundle(
      loaded.historicalReleases,
      registry,
      {
        id: bundle.id,
        version: bundle.version,
        manifestFullHash: bundle.manifestFullHash
      }
    );
    const activeRelease = loaded.historicalReleases.find(entry => (
      entry.path === archived.path
    ));
    expectedBundle = archived.bundle;
    const rendererById = new Map(expectedBundle.renderers.map(renderer => (
      [renderer.id, renderer]
    )));
    const sourceById = new Map(activeRelease.release.sources.map(source => (
      [source.familyId, source]
    )));
    if (rendererById.size !== expectedBundle.renderers.length
      || sourceById.size !== activeRelease.release.sources.length
      || rendererById.size !== sourceById.size
      || [...rendererById.keys()].some(id => !sourceById.has(id))) {
      throw new Error('active archive renderer and source membership differs');
    }
    const currentById = new Map(loaded.descriptors.map(entry => (
      [entry.descriptor.id, entry]
    )));
    exactKeys(inventory, [
      'schemaVersion',
      'releaseId',
      'releaseVersion',
      'historicalReleases',
      'themes',
      'categories',
      'families'
    ], 'battle-art active inventory');
    const inventoryHistoricalMatches = (
      stableJson(inventory.historicalReleases)
        === stableJson(loaded.manifest.historicalReleases)
      || stableJson(inventory.historicalReleases) === stableJson(
        loaded.manifest.historicalReleases.filter(relative => (
          relative !== archived.path
        ))
      )
    );
    if (inventory.schemaVersion !== INVENTORY_SCHEMA
      || inventory.releaseId !== expectedBundle.id
      || inventory.releaseVersion !== expectedBundle.version
      || !inventoryHistoricalMatches
      || stableJson(inventory.themes) !== stableJson(loaded.manifest.themes)
      || stableJson(inventory.categories)
        !== stableJson(loaded.manifest.categories)
      || !Array.isArray(inventory.families)) {
      throw new Error('battle-art active inventory release metadata is stale');
    }
    const inventoryById = new Map(inventory.families.map(family => (
      [family.id, family]
    )));
    if (inventoryById.size !== inventory.families.length
      || inventoryById.size !== rendererById.size
      || [...rendererById.keys()].some(id => !inventoryById.has(id))) {
      throw new Error('battle-art active inventory family membership is stale');
    }
    for (const [id, renderer] of rendererById) {
      const entry = currentById.get(id);
      const source = sourceById.get(id);
      const activeFamily = inventoryById.get(id);
      if (!entry) {
        throw new Error(`${id} active archived family is absent from the current manifest`);
      }
      const descriptor = entry.descriptor;
      const variantFamily = renderer.variant !== undefined;
      exactKeys(activeFamily, [
        'id',
        'theme',
        'category',
        ...(variantFamily
          ? ['familyGroup', 'variantId', 'capabilities']
          : []),
        'status',
        'descriptorPath',
        'contentVersion',
        'sourceSha256',
        'runtimeSha256',
        'immutableUrl'
      ], `${id} active inventory family`);
      const canonicalSourcePath =
        `ai-image-metadata/battle-art/sources/${renderer.theme}/${id}/`
        + `v${source.contentVersion}/`
        + `${source.sha256.slice('sha256:'.length)}.${source.format}`;
      if (source.path !== canonicalSourcePath
        || source.contentVersion !== renderer.contentVersion
        || source.width !== renderer.width
        || source.height !== renderer.height) {
        throw new Error(`${id} active archive source record is stale`);
      }
      if (activeFamily.id !== renderer.id
        || activeFamily.theme !== renderer.theme
        || activeFamily.category !== renderer.category
        || activeFamily.status !== 'compiled'
        || activeFamily.descriptorPath
          !== descriptorPath(renderer.theme, renderer.id)
        || activeFamily.contentVersion !== renderer.contentVersion
        || activeFamily.sourceSha256 !== source.sha256
        || activeFamily.runtimeSha256 !== renderer.sha256
        || activeFamily.immutableUrl !== renderer.immutableUrl) {
        throw new Error(`${id} active inventory runtime pins are stale`);
      }
      if (descriptor.theme !== activeFamily.theme
        || descriptor.category !== activeFamily.category
        || entry.path !== activeFamily.descriptorPath
        || (variantFamily && (
          descriptor.familyGroup !== activeFamily.familyGroup
          || descriptor.variantId !== activeFamily.variantId
          || stableJson(descriptor.capabilities)
            !== stableJson(activeFamily.capabilities)
        ))) {
        throw new Error(`${id} staged descriptor identity or capabilities drifted`);
      }
      const archivedDescriptorProjection = {
        ...descriptor,
        status: 'compiled',
        content: {
          version: renderer.contentVersion,
          sourceSha256: source.sha256,
          runtimeSha256: renderer.sha256,
          immutableUrl: renderer.immutableUrl
        }
      };
      if (stableJson(runtimeRecord(archivedDescriptorProjection))
        !== stableJson(renderer)) {
        throw new Error(`${id} staged descriptor runtime geometry drifted`);
      }
      if (descriptor.status === 'compiled') {
        if (stableJson(archivedSourceForDescriptor(descriptor))
          !== stableJson(source)) {
          throw new Error(`${id} compiled descriptor source pins drifted`);
        }
        continue;
      }
      if (descriptor.content.version !== renderer.contentVersion + 1) {
        throw new Error(
          `${id} staged replacement content version must be exactly one after `
          + 'the active archive'
        );
      }
    }
    for (const entry of compiledDescriptors) {
      if (!rendererById.has(entry.descriptor.id)) {
        throw new Error(
          `${entry.descriptor.id} compiled family is absent from the active archive`
        );
      }
    }
    expectedInventory = structuredClone(inventory);
  }
  if (stableJson(bundle) !== stableJson(expectedBundle)) {
    throw new Error('runtime asset bundle is incomplete or stale');
  }

  const expectedRegistry = buildBundleRegistry(
    loaded.historicalReleases,
    expectedBundle
  );
  if (stableJson(registry) !== stableJson(expectedRegistry)) {
    throw new Error('runtime asset bundle registry is incomplete or stale');
  }
  if (stableJson(frontendBundle) !== stableJson(expectedBundle)) {
    throw new Error('frontend runtime asset bundle mirror is incomplete or stale');
  }
  if (stableJson(frontendRegistry) !== stableJson(expectedRegistry)) {
    throw new Error('frontend runtime asset bundle registry mirror is incomplete or stale');
  }
  if (stableJson(inventory) !== stableJson(expectedInventory)) {
    throw new Error('battle-art inventory is incomplete or stale');
  }
  return {
    activeVersion: bundle.version,
    manifestVersion: loaded.manifest.version,
    staged: stagedDraftProjection,
    compiled: compiledDescriptors.length,
    drafts: draftDescriptors.length,
    approved: loaded.descriptors.filter(entry => (
      entry.descriptor.status === 'approved'
    )).length
  };
}

async function archiveCurrentReleaseUnlocked({ root: rootValue } = {}) {
  const loaded = await loadBattleArt(rootValue);
  if (loaded.descriptors.some(entry => entry.descriptor.status !== 'compiled')) {
    throw new Error('battle-art release archive requires every descriptor to be compiled');
  }
  const bundle = await buildBundle(loaded.manifest, loaded.descriptors);
  const { value: trackedBundle } = await readJson(
    loaded.root,
    BUNDLE_PATH,
    'runtime asset bundle'
  );
  if (stableJson(trackedBundle) !== stableJson(bundle)) {
    throw new Error('runtime asset bundle is stale; compile before archiving');
  }
  await assertRuntimeArtifactState(
    loaded,
    await readRuntimeArtifacts(loaded)
  );
  const releasePath =
    `ai-image-metadata/battle-art/releases/${bundle.id}.v${bundle.version}.json`;
  if (loaded.manifest.historicalReleases.includes(releasePath)) {
    throw new Error(`${releasePath} is already archived`);
  }
  const release = {
    schemaVersion: RELEASE_SCHEMA,
    id: bundle.id,
    version: bundle.version,
    bundle,
    sources: loaded.descriptors.map(entry => ({
      familyId: entry.descriptor.id,
      contentVersion: entry.descriptor.content.version,
      path: entry.descriptor.source.imagePath,
      sha256: entry.descriptor.source.imageSha256,
      width: entry.descriptor.source.width,
      height: entry.descriptor.source.height,
      format: entry.descriptor.source.format
    })).sort((left, right) => left.familyId.localeCompare(right.familyId))
  };
  await assertReleaseRecord(release, loaded.root, 'battle-art release archive');
  await atomicWrite(
    loaded.root,
    releasePath,
    stableJson(release),
    { immutable: true }
  );
  const manifest = {
    ...loaded.manifest,
    historicalReleases: [...loaded.manifest.historicalReleases, releasePath].sort()
  };
  await atomicWrite(loaded.root, MANIFEST_PATH, stableJson(manifest));
  const historicalReleases = [
    ...loaded.historicalReleases,
    { path: releasePath, release }
  ];
  const registry = buildBundleRegistry(historicalReleases, bundle);
  await atomicWrite(loaded.root, BUNDLE_REGISTRY_PATH, stableJson(registry));
  await atomicWrite(
    loaded.root,
    FRONTEND_BUNDLE_REGISTRY_PATH,
    stableJson(registry)
  );
  return {
    ok: true,
    release: releasePath,
    id: bundle.id,
    version: bundle.version,
    sources: release.sources.length,
    assets: bundle.assets.length
  };
}

export async function archiveCurrentRelease(options = {}) {
  const root = projectRoot(options.root);
  return withBattleArtManifestLock({ root }, () => (
    archiveCurrentReleaseUnlocked({
      ...options,
      root
    })
  ));
}

async function reviseFamilyUnlocked({
  root: rootValue,
  theme,
  family
} = {}, {
  beforeCommit = async () => {}
} = {}) {
  const loaded = await loadBattleArt(rootValue);
  const [entry] = selectFamilies(loaded, { theme, family });
  if (entry.descriptor.status !== 'compiled') {
    throw new Error(
      `${entry.descriptor.id} must be compiled before publishing a revision`
    );
  }
  const archivedCurrent = [...loaded.historicalReleases]
    .sort((left, right) => right.release.version - left.release.version)
    .find(candidate => {
      if (candidate.release.id !== loaded.manifest.releaseId
        || candidate.release.version > loaded.manifest.version
        || candidate.release.version < loaded.manifest.version - 1) {
        return false;
      }
      const renderer = candidate.release.bundle.renderers.find(
        value => value.id === entry.descriptor.id
      );
      const source = candidate.release.sources.find(
        value => value.familyId === entry.descriptor.id
      );
      return renderer?.contentVersion === entry.descriptor.content.version
        && renderer.sha256 === entry.descriptor.content.runtimeSha256
        && renderer.immutableUrl === entry.descriptor.content.immutableUrl
        && source?.sha256 === entry.descriptor.source.imageSha256;
    });
  const archivedRenderer = archivedCurrent?.release.bundle.renderers.find(
    renderer => renderer.id === entry.descriptor.id
  );
  const archivedSource = archivedCurrent?.release.sources.find(
    source => source.familyId === entry.descriptor.id
  );
  if (!archivedRenderer
    || !archivedSource
    || archivedRenderer.contentVersion !== entry.descriptor.content.version
    || archivedRenderer.sha256 !== entry.descriptor.content.runtimeSha256
    || archivedRenderer.immutableUrl !== entry.descriptor.content.immutableUrl
    || archivedSource.sha256 !== entry.descriptor.source.imageSha256) {
    throw new Error(
      `${entry.descriptor.id} current release must be archived before revision`
    );
  }
  const nextManifest = {
    ...loaded.manifest,
    version: archivedCurrent.release.version === loaded.manifest.version
      ? loaded.manifest.version + 1
      : loaded.manifest.version
  };
  const revised = {
    ...entry.descriptor,
    status: 'draft',
    promptProfile: structuredClone(nextManifest.promptProfile),
    styleReferences: structuredClone(entry.descriptor.styleReferences),
    content: {
      version: entry.descriptor.content.version + 1,
      sourceSha256: null,
      runtimeSha256: null,
      immutableUrl: null
    },
    source: null
  };
  assertDescriptor(revised, nextManifest);
  await beforeCommit({
    root: loaded.root,
    descriptor: entry.path
  });
  await atomicWrite(loaded.root, MANIFEST_PATH, stableJson(nextManifest));
  await atomicWrite(loaded.root, entry.path, stableJson(revised));
  return {
    ok: true,
    family: entry.descriptor.id,
    descriptor: entry.path,
    releaseVersion: nextManifest.version,
    contentVersion: revised.content.version
  };
}

export async function reviseFamily(options = {}, dependencies = {}) {
  const root = projectRoot(options.root);
  assertSafeId(options.theme, 'theme');
  assertSafeId(options.family, 'family');
  return withBattleArtManifestAndCandidateLock({
    root,
    theme: options.theme,
    family: options.family
  }, () => reviseFamilyUnlocked({
    ...options,
    root
  }, dependencies));
}

export async function compileApproved({ root: rootValue, check = false } = {}) {
  const loaded = await loadBattleArt(rootValue);
  if (loaded.descriptors.some(entry => (
    entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
  ))) {
    const readiness = await loadReadinessPlan(loaded.root);
    assertV2DescriptorsPlanned(loaded.descriptors, readiness.plan);
  }
  if (!check && loaded.descriptors.some(entry => (
    entry.descriptor.status === 'draft'
  ))) {
    throw new Error(
      'battle-art compilation refuses a partial release while draft descriptors remain'
    );
  }
  const publicationArtifacts = check
    ? null
    : await readRuntimeArtifacts(loaded);
  if (publicationArtifacts !== null) {
    const expectedPublicationRegistry = buildBundleRegistry(
      loaded.historicalReleases,
      publicationArtifacts.bundle
    );
    if (stableJson(publicationArtifacts.registry)
      !== stableJson(expectedPublicationRegistry)) {
      throw new Error(
        'runtime asset bundle registry is incomplete or stale before publication'
      );
    }
    if (stableJson(publicationArtifacts.frontendBundle)
      !== stableJson(publicationArtifacts.bundle)
      || stableJson(publicationArtifacts.frontendRegistry)
        !== stableJson(publicationArtifacts.registry)) {
      throw new Error(
        'frontend runtime asset bundle registry mirrors are stale before publication'
      );
    }
    assertInventoryRegistryLedger(
      publicationArtifacts.inventoryRegistry,
      publicationArtifacts.registry,
      loaded.historicalReleases,
      publicationArtifacts.bundle
    );
  }
  const checkArtifacts = check
    ? await readRuntimeArtifacts(loaded)
    : null;
  const checkRuntimeState = check
    ? await assertRuntimeArtifactState(loaded, checkArtifacts)
    : null;
  const profile = loaded.promptProfile;
  const nextEntries = [];
  const outputs = [];
  const pendingRuntimeWrites = [];
  const pendingDescriptorWrites = [];
  for (const entry of loaded.descriptors) {
    const descriptor = structuredClone(entry.descriptor);
    if (checkRuntimeState?.staged && descriptor.status === 'approved') {
      nextEntries.push(entry);
      continue;
    }
    if (descriptor.status === 'approved' || descriptor.status === 'compiled') {
      const buffer = await compileSource(loaded.root, descriptor, profile);
      const sourceBytes = await readFile(resolveTracked(
        loaded.root,
        descriptor.source.imagePath,
        `${descriptor.id} approved source`
      ));
      await validateRuntimeAlphaParity({
        sourceBytes,
        runtimeBytes: buffer,
        descriptor,
        profile,
        label: descriptor.id
      });
      const outputHash = sha256(buffer);
      const hashToken = outputHash.slice('sha256:'.length);
      const outputRelative = checkRuntimeState?.staged
        ? `frontend/public${descriptor.content.immutableUrl}`
        : `${RUNTIME_ROOT}/${loaded.manifest.releaseId}/v${loaded.manifest.version}/`
          + `${descriptor.theme}/${descriptor.category}/`
          + `${descriptor.id}/v${descriptor.content.version}/${hashToken}.webp`;
      const immutableUrl = checkRuntimeState?.staged
        ? descriptor.content.immutableUrl
        : `/${outputRelative.slice('frontend/public/'.length)}`;
      const compiled = {
        ...descriptor,
        status: 'compiled',
        content: {
          ...descriptor.content,
          runtimeSha256: outputHash,
          immutableUrl
        }
      };
      assertDescriptor(compiled, loaded.manifest);
      if (check) {
        if (stableJson(compiled) !== stableJson(entry.descriptor)) {
          throw new Error(`${descriptor.id} descriptor runtime pins are stale`);
        }
        const outputPath = resolveTracked(loaded.root, outputRelative, 'runtime output path');
        if (await hashFile(outputPath) !== outputHash) throw new Error(`${descriptor.id} runtime output hash mismatch`);
        const metadata = await sharp(outputPath, { failOn: 'error' }).metadata();
        if (metadata.format !== 'webp'
          || metadata.width !== descriptor.canvas.width
          || metadata.height !== descriptor.canvas.height) {
          throw new Error(`${descriptor.id} runtime output dimensions or format mismatch`);
        }
      } else {
        pendingRuntimeWrites.push({
          relative: outputRelative,
          contents: buffer
        });
        pendingDescriptorWrites.push({
          relative: entry.path,
          contents: stableJson(compiled)
        });
      }
      nextEntries.push({ path: entry.path, descriptor: compiled });
      outputs.push(outputRelative);
    } else {
      nextEntries.push(entry);
    }
  }
  const bundle = await buildBundle(loaded.manifest, nextEntries);
  const registry = buildBundleRegistry(loaded.historicalReleases, bundle);
  const inventory = buildInventory(loaded.manifest, nextEntries);
  const inventoryContents = stableJson(inventory);
  if (check) {
    await assertRuntimeArtifactState(loaded, checkArtifacts);
  } else {
    const inventoryRegistry = appendInventoryRegistryEntry(
      publicationArtifacts.inventoryRegistry,
      bundle,
      inventoryContents
    );
    const existingTargetPin = publicationArtifacts.inventoryRegistry.entries.find(
      entry => entry.releaseId === bundle.id
        && entry.releaseVersion === bundle.version
    );
    if (existingTargetPin !== undefined) {
      const byteIdenticalPublication = (
        stableJson(publicationArtifacts.bundle) === stableJson(bundle)
        && stableJson(publicationArtifacts.registry) === stableJson(registry)
        && stableJson(publicationArtifacts.frontendBundle) === stableJson(bundle)
        && stableJson(publicationArtifacts.frontendRegistry) === stableJson(registry)
        && publicationArtifacts.inventoryContents === inventoryContents
        && stableJson(publicationArtifacts.inventoryRegistry)
          === stableJson(inventoryRegistry)
      );
      if (!byteIdenticalPublication) {
        throw new Error(
          `battle-art publication retry for ${bundle.id}:v${bundle.version} `
          + 'is not byte-identical'
        );
      }
      for (const pending of pendingRuntimeWrites) {
        const current = await readFile(resolveTracked(
          loaded.root,
          pending.relative,
          'runtime publication retry output'
        ));
        if (!current.equals(pending.contents)) {
          throw new Error(
            `battle-art publication retry runtime ${pending.relative} `
            + 'is not byte-identical'
          );
        }
      }
      for (const pending of pendingDescriptorWrites) {
        const current = await readFile(resolveTracked(
          loaded.root,
          pending.relative,
          'descriptor publication retry output'
        ), 'utf8');
        if (current !== pending.contents) {
          throw new Error(
            `battle-art publication retry descriptor ${pending.relative} `
            + 'is not byte-identical'
          );
        }
      }
    } else {
      for (const pending of pendingRuntimeWrites) {
        await atomicWrite(loaded.root, pending.relative, pending.contents);
      }
      for (const pending of pendingDescriptorWrites) {
        await atomicWrite(loaded.root, pending.relative, pending.contents);
      }
      await atomicWrite(loaded.root, BUNDLE_PATH, stableJson(bundle));
      await atomicWrite(loaded.root, BUNDLE_REGISTRY_PATH, stableJson(registry));
      await atomicWrite(loaded.root, FRONTEND_BUNDLE_PATH, stableJson(bundle));
      await atomicWrite(
        loaded.root,
        FRONTEND_BUNDLE_REGISTRY_PATH,
        stableJson(registry)
      );
      await atomicWrite(loaded.root, INVENTORY_PATH, inventoryContents);
      await atomicWrite(
        loaded.root,
        INVENTORY_REGISTRY_PATH,
        stableJson(inventoryRegistry)
      );
    }
  }
  return {
    ok: true,
    check,
    compiled: outputs.length,
    outputs,
    bundle: BUNDLE_PATH,
    bundleRegistry: BUNDLE_REGISTRY_PATH,
    frontendBundle: FRONTEND_BUNDLE_PATH,
    frontendBundleRegistry: FRONTEND_BUNDLE_REGISTRY_PATH,
    inventory: INVENTORY_PATH,
    inventoryRegistry: INVENTORY_REGISTRY_PATH
  };
}

export async function writeInventory({
  root: rootValue,
  check = false,
  theme = null,
  families = [],
  category = null,
  ecologyProfile = null,
  tier = null,
  surfaceVariant = null
} = {}) {
  const loaded = await loadBattleArt(rootValue);
  const hasSelection = theme !== null
    || families.length > 0
    || category !== null
    || ecologyProfile !== null
    || tier !== null
    || surfaceVariant !== null;
  if (!check && !hasSelection && loaded.descriptors.some(entry => (
    entry.descriptor.status !== 'compiled'
  ))) {
    throw new Error(
      'battle-art inventory write refuses to replace the active release '
      + 'while staged descriptors remain'
    );
  }
  const inventory = buildInventory(loaded.manifest, loaded.descriptors);
  const selected = hasSelection
    ? selectFamilies(loaded, {
        theme,
        families,
        category,
        ecologyProfile,
        tier,
        surfaceVariant
      })
    : loaded.descriptors;
  if (check) {
    await assertRuntimeArtifactState(
      loaded,
      await readRuntimeArtifacts(loaded)
    );
  } else if (!hasSelection) {
    const artifacts = await readRuntimeArtifacts(loaded);
    await assertRuntimeArtifactState(loaded, artifacts);
    const inventoryContents = stableJson(inventory);
    if (inventoryContents !== artifacts.inventoryContents) {
      throw new Error(
        'battle-art inventory write refuses to replace a pinned active inventory'
      );
    }
    await atomicWrite(loaded.root, INVENTORY_PATH, inventoryContents);
  }
  return {
    ok: true,
    check,
    selected: hasSelection,
    families: selected.length,
    path: hasSelection ? null : INVENTORY_PATH,
    selection: hasSelection
      ? buildInventory(loaded.manifest, selected).families
      : undefined
  };
}

const FAILED_GENERATED_ATTEMPT_SCHEMA =
  'battle-art-generated-failed-attempt-v1';

async function auditTrackedGeneratedFailures(loaded) {
  const generatedRoot = resolveTracked(
    loaded.root,
    GENERATED_ARTIFACT_ROOT,
    'battle-art generated artifact root'
  );
  let rootDetails;
  try {
    rootDetails = await lstat(generatedRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return { records: 0 };
    throw error;
  }
  if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
    throw new Error('battle-art generated artifact root must be a directory');
  }
  if (await realpath(generatedRoot) !== generatedRoot) {
    throw new Error('battle-art generated artifact root is not canonical');
  }

  const descriptorByConsumer = new Map(loaded.descriptors.map(entry => [
    `${entry.descriptor.theme}/${entry.descriptor.id}`,
    entry.descriptor
  ]));
  const genericPaths = [];
  const nonRouteArtifacts = new Set();
  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) {
        throw new Error(
          `battle-art generated artifact tree contains symlink ${absolute}`
        );
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `battle-art generated artifact tree contains unsupported entry ${absolute}`
        );
      }
      const relative = path.relative(loaded.root, absolute)
        .split(path.sep)
        .join('/');
      const location = relative.match(
        /^ai-image-metadata\/battle-art\/generated-artifacts\/([^/]+)\/([^/]+)\//
      );
      const locatedDescriptor = location === null
        ? null
        : descriptorByConsumer.get(`${location[1]}/${location[2]}`) ?? null;
      const locatedNonRoute = locatedDescriptor !== null
        && locatedDescriptor.category !== 'route-transition';
      if (!entry.name.endsWith('.json')) {
        if (!locatedNonRoute) continue;
        if (!new RegExp(
          `^${GENERATED_ARTIFACT_ROOT.replaceAll('/', '\\/')}/`
          + `${locatedDescriptor.theme}/${locatedDescriptor.id}/`
          + '[0-9a-f]{64}\\.(?:png|webp)$'
        ).test(relative)) {
          throw new Error(
            `battle-art generated artifact is misplaced or unsupported: ${relative}`
          );
        }
        nonRouteArtifacts.add(relative);
        continue;
      }

      let record;
      try {
        record = JSON.parse(await readFile(absolute, 'utf8'));
      } catch (error) {
        if (locatedDescriptor?.category === 'route-transition') continue;
        throw new Error(
          `battle-art generated failure record ${relative} is invalid JSON: `
          + error.message
        );
      }
      const appearsGeneric = locatedNonRoute
        || record?.schemaVersion === FAILED_GENERATED_ATTEMPT_SCHEMA
        || Object.hasOwn(record ?? {}, 'artifact')
        || Object.hasOwn(record ?? {}, 'failureStage');
      if (appearsGeneric) genericPaths.push(relative);
    }
  }
  await visit(generatedRoot);

  if (genericPaths.length > 0 && failedGeneratedAttemptAuditor === null) {
    // lifecycle.mjs cannot statically import generate.mjs because generation
    // already imports lifecycle. The bounded registration keeps normal audit
    // self-contained without creating a circular static dependency.
    await import('./generate.mjs');
  }
  if (genericPaths.length > 0 && failedGeneratedAttemptAuditor === null) {
    throw new Error('battle-art failed generated attempt auditor is unavailable');
  }

  const referencedArtifacts = new Set();
  for (const relativePath of genericPaths.sort()) {
    const audited = await failedGeneratedAttemptAuditor({
      root: loaded.root,
      relativePath
    });
    const descriptor = descriptorByConsumer.get(
      `${audited.record.theme}/${audited.record.familyId}`
    );
    if (descriptor === undefined || descriptor.category === 'route-transition') {
      throw new Error(
        `failed generated attempt ${relativePath} has no canonical non-route family`
      );
    }
    referencedArtifacts.add(audited.record.artifact.path);
  }
  for (const artifactPath of nonRouteArtifacts) {
    if (!referencedArtifacts.has(artifactPath)) {
      throw new Error(
        `battle-art generated artifact ${artifactPath} has no failed-attempt record`
      );
    }
  }
  return { records: genericPaths.length };
}

export async function auditBattleArt({
  root: rootValue,
  plan = READINESS_PLAN_PATH,
  theme = null,
  families = [],
  category = null,
  ecologyProfile = null,
  tier = null,
  surfaceVariant = null
} = {}) {
  const loaded = await loadBattleArt(rootValue);
  const selection = {
    theme,
    families,
    category,
    ecologyProfile,
    tier,
    surfaceVariant
  };
  const entries = theme !== null
    || families.length > 0
    || category !== null
    || ecologyProfile !== null
    || tier !== null
    || surfaceVariant !== null
    ? selectFamilies(loaded, selection)
    : loaded.descriptors;
  const v2Release = loaded.descriptors.some(entry => (
    entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
  )) || loaded.manifest.categories.includes('connection-slope');
  const readiness = await loadReadinessPlan(loaded.root, plan, {
    required: v2Release
  });
  let matrix = null;
  if (readiness !== null) {
    assertV2DescriptorsPlanned(loaded.descriptors, readiness.plan);
    matrix = buildReadinessMatrix(loaded, readiness.plan, selection);
    if (matrix.ambiguous > 0 || matrix.missing > 0) {
      throw new Error(
        `battle-art readiness failed with ${matrix.missing} missing and `
        + `${matrix.ambiguous} ambiguous requirement(s)`
      );
    }
  }
  for (const entry of entries) {
    const descriptor = entry.descriptor;
    if (descriptor.status === 'approved' || descriptor.status === 'compiled') {
      const source = await inspectImage(loaded.root, descriptor.source.imagePath);
      if (source.sha256 !== descriptor.source.imageSha256
        || source.width !== descriptor.source.width
        || source.height !== descriptor.source.height
        || source.format !== descriptor.source.format) {
        throw new Error(`${descriptor.id} approved source pin mismatch`);
      }
      const sourceBytes = await readFile(resolveTracked(
        loaded.root,
        descriptor.source.imagePath,
        `${descriptor.id} approved source`
      ));
      await validateRasterBytes({
        bytes: sourceBytes,
        descriptor,
        profile: loaded.promptProfile,
        label: `${descriptor.id} approved source`
      });
    }
    if (descriptor.status === 'compiled') {
      const relative = `frontend/public${descriptor.content.immutableUrl}`;
      const runtimePath = resolveTracked(loaded.root, relative);
      if (await hashFile(runtimePath) !== descriptor.content.runtimeSha256) {
        throw new Error(`${descriptor.id} runtime content pin mismatch`);
      }
      await validateRuntimeAlphaParity({
        sourceBytes: await readFile(resolveTracked(
          loaded.root,
          descriptor.source.imagePath,
          `${descriptor.id} approved source`
        )),
        runtimeBytes: await readFile(runtimePath),
        descriptor,
        profile: loaded.promptProfile,
        label: descriptor.id
      });
    }
  }
  const generatedFailures = await auditTrackedGeneratedFailures(loaded);
  await assertRuntimeArtifactState(
    loaded,
    await readRuntimeArtifacts(loaded)
  );
  return {
    ok: true,
    themes: loaded.manifest.themes.length,
    categories: loaded.manifest.categories.length,
    families: loaded.descriptors.length,
    approved: loaded.descriptors.filter(entry => entry.descriptor.status !== 'draft').length,
    compiled: loaded.descriptors.filter(entry => entry.descriptor.status === 'compiled').length,
    generatedFailures: generatedFailures.records,
    ...(matrix === null
      ? {}
      : { readiness: {
          plan: readiness.path,
          plans: matrix.plans,
          required: matrix.required,
          present: matrix.present
        } })
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function writePreview({
  root: rootValue,
  theme = null,
  family = null,
  families = null,
  category = null,
  ecologyProfile = null,
  tier = null,
  surfaceVariant = null,
  output = 'ai-image-metadata/battle-art/preview/index.html'
} = {}) {
  assertRolePath(
    output,
    ['ai-image-metadata/battle-art/preview/'],
    ['.html'],
    'battle-art preview output'
  );
  const loaded = await loadBattleArt(rootValue);
  const entries = selectFamilies(loaded, {
    theme,
    family,
    families,
    category,
    ecologyProfile,
    tier,
    surfaceVariant
  });
  const cards = [];
  for (const entry of entries) {
    const paths = candidatePaths(entry.descriptor);
    let candidate = null;
    try {
      ({ value: candidate } = await readJson(loaded.root, paths.metadata, 'candidate metadata'));
    } catch (error) {
      if (!error.message.includes('ENOENT')) throw error;
    }
    const candidateHref = candidate
      ? path.posix.relative(path.posix.dirname(output), candidate.image.path)
      : null;
    let candidateCompilerHref = null;
    if (candidate) {
      if (candidate.descriptorSha256
        !== sha256(Buffer.from(stableJson(entry.descriptor)))) {
        throw new Error(`${entry.descriptor.id} preview candidate descriptor pin is stale`);
      }
      const candidateBytes = await readPinnedRegularFile(
        loaded.root,
        candidate.image.path,
        candidate.image.sha256,
        `${entry.descriptor.id} preview candidate`
      );
      await verifyCandidateRouteDerivation({
        root: loaded.root,
        descriptor: entry.descriptor,
        candidate,
        candidateBytes,
        profile: loaded.promptProfile,
        paths,
        label: `${entry.descriptor.id} preview candidate route derivation`
      });
      const canonical = await validateRasterBytes({
        bytes: candidateBytes,
        descriptor: entry.descriptor,
        profile: loaded.promptProfile,
        label: `${entry.descriptor.id} preview candidate`
      });
      const prepared = prepareRuntimeRaster(canonical, entry.descriptor);
      const previewRelative =
        `${path.posix.dirname(output)}/assets/${entry.descriptor.id}.compiler-preview.png`;
      const previewBytes = await sharp(prepared.data, {
        raw: {
          width: prepared.width,
          height: prepared.height,
          channels: 4
        }
      }).png().toBuffer();
      await atomicWrite(loaded.root, previewRelative, previewBytes);
      candidateCompilerHref =
        path.posix.relative(path.posix.dirname(output), previewRelative);
    }
    const runtimeHref = entry.descriptor.status === 'compiled'
      ? path.posix.relative(
          path.posix.dirname(output),
          `frontend/public${entry.descriptor.content.immutableUrl}`
        )
      : null;
    const { width, height } = entry.descriptor.canvas;
    const drawBounds = entry.descriptor.placement.drawBounds;
    const anchor = entry.descriptor.placement.anchor;
    const inspectionImage = candidateCompilerHref ?? runtimeHref;
    const inspection = inspectionImage
      ? `<div class="inspection" style="width:${width}px;height:${height}px">`
        + `<img src="${escapeHtml(inspectionImage)}" `
        + `alt="${escapeHtml(entry.descriptor.id)} alpha inspection">`
        + `<span class="draw-bounds" style="left:${drawBounds.x}px;top:${drawBounds.y}px;`
        + `width:${drawBounds.width}px;height:${drawBounds.height}px"></span>`
        + `<span class="anchor" style="left:${anchor.x}px;top:${anchor.y}px"></span>`
        + '</div>'
      : '<p>No candidate generated.</p>';
    const seamSheet = ['surface', 'route-transition'].includes(
      entry.descriptor.category
    ) && inspectionImage
      ? '<h3>4-neighbor seam sheet</h3>'
        + `<div class="seams" style="width:${width * 2}px;height:${height * 2}px">`
        + [
            [width / 2, 0],
            [0, height / 2],
            [width, height / 2],
            [width / 2, height]
          ].map(([left, top]) => (
            `<img src="${escapeHtml(inspectionImage)}" `
            + `style="left:${left}px;top:${top}px;width:${width}px;height:${height}px" `
            + `alt="${escapeHtml(entry.descriptor.id)} seam neighbor">`
          )).join('')
        + '</div>'
      : '';
    cards.push(`<article><h2>${escapeHtml(entry.descriptor.id)}</h2>`
      + `<p>${escapeHtml(entry.descriptor.theme)} / ${escapeHtml(entry.descriptor.category)} / `
      + `${escapeHtml(entry.descriptor.status)}</p>`
      + `<p>Raster contract: ${escapeHtml(entry.descriptor.rasterContract.kind)}</p>`
      + inspection
      + (candidateHref
        ? `<p><a href="${escapeHtml(candidateHref)}">Raw generated candidate</a>`
          + (runtimeHref
            ? `; <a href="${escapeHtml(runtimeHref)}">compiled runtime asset</a>`
            : '')
          + '.</p>'
        : '')
      + seamSheet
      + '</article>');
  }
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Battle art review</title>'
    + '<style>body{font-family:sans-serif;background:#20242a;color:#fff}main{display:grid;'
    + 'grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}article{background:#303640;'
    + 'padding:16px;overflow:auto}a{color:#9fd7ff}.inspection,.seams{position:relative;'
    + 'background-color:#59606a;background-image:linear-gradient(45deg,#3d434b 25%,transparent 25%),'
    + 'linear-gradient(-45deg,#3d434b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,'
    + '#3d434b 75%),linear-gradient(-45deg,transparent 75%,#3d434b 75%);background-size:24px 24px;'
    + 'background-position:0 0,0 12px,12px -12px,-12px 0}.inspection>img{position:absolute;inset:0;'
    + 'width:100%;height:100%;image-rendering:pixelated}.draw-bounds{position:absolute;box-sizing:border-box;'
    + 'border:1px solid #47d7ff;pointer-events:none}.anchor{position:absolute;width:9px;height:9px;'
    + 'margin:-4px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 0 1px #fff;pointer-events:none}'
    + '.seams>img{position:absolute;image-rendering:pixelated}</style></head>'
    + '<body><h1>Battle art review candidates</h1>'
    + `<main>${cards.join('')}</main></body></html>\n`;
  await atomicWrite(loaded.root, output, html);
  return { ok: true, output, families: entries.length };
}

async function discoverReviewPaths(root) {
  const reviewRoot = resolveTracked(root, REVIEW_ROOT, 'battle-art review root');
  let current = root;
  for (const segment of path.relative(root, reviewRoot).split(path.sep)) {
    current = path.join(current, segment);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    if (details.isSymbolicLink()) {
      throw new Error(`battle-art review root contains symlink ${current}`);
    }
  }
  if (await realpath(reviewRoot) !== reviewRoot) {
    throw new Error('battle-art review root is not canonical');
  }
  const paths = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) {
        throw new Error(`battle-art review tree contains symlink ${absolute}`);
      }
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        paths.push(path.relative(root, absolute).split(path.sep).join('/'));
      } else {
        throw new Error(`battle-art review tree contains unsupported entry ${absolute}`);
      }
    }
  }
  await visit(reviewRoot);
  return paths.sort();
}

function descriptorHasArchivedLegacySource(loaded, descriptor) {
  return loaded.historicalReleases.some(({ release }) => (
    release.version <= (
      LEGACY_REVIEW_EXEMPT_RELEASES[release.id] ?? 0
    )
    && release.sources.some(source => (
        source.familyId === descriptor.id
        && source.path === descriptor.source.imagePath
        && source.sha256 === descriptor.source.imageSha256
      ))
  ));
}

function archivedSourceForReview(loaded, record) {
  const expectedSourcePath =
    `ai-image-metadata/battle-art/sources/${record.theme}/${record.familyId}/`
    + `v${record.descriptor.contentVersion}/`
    + `${record.candidate.image.sha256.slice('sha256:'.length)}`
    + `.${record.candidate.image.format}`;
  return loaded.historicalReleases
    .flatMap(({ release }) => release.sources)
    .find(source => (
      source.familyId === record.familyId
      && source.contentVersion === record.descriptor.contentVersion
      && source.path === expectedSourcePath
      && source.sha256 === record.candidate.image.sha256
      && source.width === record.candidate.image.width
      && source.height === record.candidate.image.height
      && source.format === record.candidate.image.format
    )) ?? null;
}

function archivedSourceExactlyMatchesReviewedSource(archivedSource, record) {
  return archivedSource !== null && stableJson(archivedSource) === stableJson({
    familyId: record.familyId,
    contentVersion: record.descriptor.contentVersion,
    path: record.source.imagePath,
    sha256: record.source.imageSha256,
    width: record.source.width,
    height: record.source.height,
    format: record.source.format
  });
}

export async function auditBattleArtReviews({
  root: rootValue,
  loaded: loadedValue
} = {}) {
  const loaded = loadedValue ?? await loadBattleArt(rootValue);
  const reviewPaths = await discoverReviewPaths(loaded.root);
  const reviews = [];
  const descriptors = new Map(
    loaded.descriptors.map(entry => [entry.descriptor.id, entry])
  );
  for (const relative of reviewPaths) {
    const { value } = await readJson(
      loaded.root,
      relative,
      `battle-art review ${relative}`
    );
    const record = assertReviewRecord(value, relative);
    if (record.schemaVersion === LEGACY_REVIEW_SCHEMA) {
      assertAllowlistedLegacyJson(
        relative,
        record,
        `battle-art review ${relative}`
      );
    }
    const compiledSourceAttestation =
      record.schemaVersion === COMPILED_SOURCE_ATTESTATION_SCHEMA;
    const entry = descriptors.get(record.familyId);
    if (!entry || entry.descriptor.theme !== record.theme) {
      throw new Error(`battle-art review ${relative} has no matching family`);
    }
    const descriptor = entry.descriptor;
    if (record.descriptor.path !== entry.path) {
      throw new Error(
        `battle-art review ${relative} descriptor path is stale`
      );
    }
    const currentVersion =
      record.descriptor.contentVersion === descriptor.content.version;
    if (record.descriptor.contentVersion > descriptor.content.version) {
      throw new Error(
        `battle-art review ${relative} descriptor version is newer than the current family`
      );
    }
    const expectedDescriptorPin = sha256(Buffer.from(stableJson(
      draftDescriptorProjection(descriptor)
    )));
    const matchesCurrentInputs = currentVersion
      && record.descriptor.sha256 === expectedDescriptorPin
      && stableJson(record.candidate.promptProfile)
        === stableJson(descriptor.promptProfile)
      && stableJson(record.candidate.styleReferences)
        === stableJson(descriptor.styleReferences);
    const revalidated =
      record.schemaVersion === REVALIDATED_REVIEW_SCHEMA;
    let replayValidation = null;
    if (revalidated) {
      replayValidation = await import('./generate.mjs');
      const audited = await replayValidation.auditFailedRouteAttempt({
        root: loaded.root,
        relativePath: record.candidate.origin.failureRecord.path
      });
      const originalDescriptor = {
        path: audited.record.descriptor.path,
        sha256: audited.record.descriptor.sha256,
        contentVersion: audited.record.descriptor.contentVersion
      };
      if (
        audited.file.sha256
          !== record.candidate.origin.failureRecord.sha256
        || audited.record.fullHash
          !== record.candidate.origin.failureRecord.fullHash
        || stableJson(audited.record.raw)
          !== stableJson(record.candidate.origin.raw)
        || stableJson(originalDescriptor)
          !== stableJson(record.candidate.origin.originalDescriptor)
        || audited.record.theme !== record.theme
        || audited.record.familyId !== record.familyId
      ) {
        throw new Error(
          `battle-art review ${relative} revalidation origin is stale`
        );
      }
    }
    if (record.candidate.derivation !== undefined) {
      const rawArtifactBytes = await readPinnedRegularFile(
        loaded.root,
        record.candidate.derivation.source.path,
        record.candidate.derivation.source.sha256,
        `${record.familyId} reviewed raw generated artifact`
      );
      const rawArtifact = await inspectImageContents(
        record.candidate.derivation.source.path,
        rawArtifactBytes
      );
      if (
        stableJson(rawArtifact)
          !== stableJson(record.candidate.derivation.source)
      ) {
        throw new Error(
          `battle-art review ${relative} raw generated artifact pin mismatch`
        );
      }
      if (matchesCurrentInputs) {
        const reproduced = await reproduceRouteDerivation({
          sourceBytes: rawArtifactBytes,
          source: rawArtifact,
          descriptor,
          profile: loaded.promptProfile,
          label: `battle-art review ${relative} reproduced route`
        });
        const reproducedImage = await inspectImageContents(
          record.candidate.image.path,
          reproduced.bytes
        );
        if (
          stableJson(reproducedImage) !== stableJson(record.candidate.image)
          || stableJson(reproduced.derivation)
            !== stableJson(record.candidate.derivation)
        ) {
          throw new Error(
            `battle-art review ${relative} route derivation does not reproduce`
          );
        }
        if (revalidated) {
          await replayValidation.validatePreparedRouteGeometry({
            bytes: reproduced.bytes,
            descriptor,
            finished: descriptor.routeFinishing !== undefined,
            label: `battle-art review ${relative} reproduced route`
          });
        }
      }
    }
    const archivedSource = record.decision === 'approved'
      ? archivedSourceForReview(loaded, record)
      : null;
    const matchesCurrentCompiledAttestation = compiledSourceAttestation
      && descriptor.status === 'compiled'
      && matchesCurrentInputs
      && stableJson(record.source) === stableJson(descriptor.source);
    const matchesHistoricalCompiledAttestation = compiledSourceAttestation
      && record.descriptor.contentVersion < descriptor.content.version
      && archivedSourceExactlyMatchesReviewedSource(archivedSource, record);
    if (
      compiledSourceAttestation
      && !matchesCurrentCompiledAttestation
      && !matchesHistoricalCompiledAttestation
    ) {
      throw new Error(
        `battle-art review ${relative} compiled-source attestation `
        + 'does not match the current compiled descriptor or its exact '
        + 'archived reviewed source'
      );
    }
    // A rejection is historical evidence about one exact candidate, not an
    // authorization for the current draft. Keep that content-addressed record
    // auditable when an operator refines the descriptor and generates a new
    // candidate, including after that replacement is approved. Approved
    // evidence remains bound to current inputs or an exact archived source
    // below.
    const historicalRejection =
      record.decision === 'rejected' && currentVersion;
    if (currentVersion && !matchesCurrentInputs && !historicalRejection) {
      if (record.schemaVersion !== LEGACY_REVIEW_SCHEMA) {
        throw new Error(
          `battle-art review ${relative} does not match its reviewed descriptor inputs`
        );
      }
    }
    if (
      !matchesCurrentInputs
      && record.decision === 'approved'
      && archivedSource === null
    ) {
      throw new Error(
        `battle-art review ${relative} has no matching archived source identity`
      );
    }
    let matchesCurrentSourceIdentity = false;
    if (
      matchesCurrentInputs
      && record.decision === 'approved'
      && descriptor.status !== 'draft'
      && descriptor.source.imageSha256 === record.candidate.image.sha256
    ) {
      const reviewedSourceApproval = compiledSourceAttestation
        ? record.source
        : {
            reviewer: record.reviewer,
            approvedAt: record.reviewedAt
          };
      if (
        descriptor.source.reviewer !== reviewedSourceApproval.reviewer
        || descriptor.source.approvedAt !== reviewedSourceApproval.approvedAt
      ) {
        throw new Error(
          `battle-art review ${relative} does not match its approved descriptor`
        );
      }
      const expectedSourcePath =
        `ai-image-metadata/battle-art/sources/${record.theme}/`
        + `${record.familyId}/v${record.descriptor.contentVersion}/`
        + `${record.candidate.image.sha256.slice('sha256:'.length)}`
        + `.${record.candidate.image.format}`;
      if (
        descriptor.source.imagePath !== expectedSourcePath
        || descriptor.source.width !== record.candidate.image.width
        || descriptor.source.height !== record.candidate.image.height
        || descriptor.source.format !== record.candidate.image.format
      ) {
        throw new Error(
          `battle-art review ${relative} does not match its approved source identity`
        );
      }
      const sourceBytes = await readPinnedRegularFile(
        loaded.root,
        descriptor.source.imagePath,
        record.candidate.image.sha256,
        `${record.familyId} reviewed source`
      );
      const source = await inspectImageContents(
        descriptor.source.imagePath,
        sourceBytes
      );
      for (const key of ['bytes', 'width', 'height', 'format', 'sha256']) {
        if (source[key] !== record.candidate.image[key]) {
          throw new Error(
            `battle-art review ${relative} approved image pin mismatch`
          );
        }
      }
      matchesCurrentSourceIdentity = true;
    }

    let currentCandidate = null;
    let matchesCurrentStagedCandidateIdentity = false;
    const currentApproved = matchesCurrentSourceIdentity
      && descriptor.status === 'approved';
    const currentCompiledAttestation = compiledSourceAttestation
      && matchesCurrentSourceIdentity
      && descriptor.status === 'compiled';
    if (currentApproved || currentCompiledAttestation) {
      currentCandidate = await loadReviewCandidate(loaded, entry, {
        reviewFullHash: record.fullHash,
        allowCompiledCurrentSource: currentCompiledAttestation
      });
    } else if (matchesCurrentInputs && descriptor.status === 'draft') {
      try {
        const { value: candidate } = await readJson(
          loaded.root,
          record.candidate.metadata.path,
          `${record.familyId} current candidate metadata`
        );
        if (candidate?.image?.sha256 === record.candidate.image.sha256) {
          currentCandidate = await loadReviewCandidate(loaded, entry, {
            reviewFullHash: record.fullHash,
            allowHistoricalRejectedEffectivePrompt:
              record.decision === 'rejected'
          });
        }
      } catch (error) {
        if (!error.message.includes('ENOENT')) throw error;
      }
    }
    if (currentCandidate !== null) {
      const currentProjection = buildReviewRecord(entry, currentCandidate, {
        reviewer: record.reviewer,
        decision: record.decision,
        reason: record.reason,
        reviewedAt: record.reviewedAt,
        compiledCurrentSourceAttestation: currentCompiledAttestation
      });
      if (stableJson(currentProjection) !== stableJson(record)) {
        throw new Error(
          `battle-art review ${relative} candidate evidence has drifted`
        );
      }
      if (descriptor.status === 'draft') {
        matchesCurrentStagedCandidateIdentity = true;
      }
    }
    if (
      record.decision === 'approved'
      && !matchesCurrentSourceIdentity
      && !matchesCurrentStagedCandidateIdentity
      && archivedSource === null
    ) {
      throw new Error(
        `battle-art review ${relative} has no matching current source, `
        + 'staged candidate, or archived source identity'
      );
    }
    reviews.push({ path: relative, record, matchesCurrentInputs });
  }

  for (const entry of loaded.descriptors) {
    const descriptor = entry.descriptor;
    if (descriptor.status === 'draft') continue;
    const matching = reviews.find(({ record, matchesCurrentInputs }) => (
      matchesCurrentInputs
      && record.familyId === descriptor.id
      && record.theme === descriptor.theme
      && record.decision === 'approved'
      && record.descriptor.contentVersion === descriptor.content.version
      && record.candidate.image.sha256 === descriptor.source.imageSha256
    ));
    if (matching) continue;
    if (
      descriptor.status === 'compiled'
      && descriptorHasArchivedLegacySource(loaded, descriptor)
    ) {
      continue;
    }
    throw new Error(
      `${descriptor.id} has no matching immutable approved review record`
    );
  }
  return {
    ok: true,
    records: reviews.length,
    approved: reviews.filter(({ record }) => (
      record.decision === 'approved'
    )).length,
    rejected: reviews.filter(({ record }) => (
      record.decision === 'rejected'
    )).length
  };
}

export async function checkBattleArt({ root: rootValue } = {}) {
  const audit = await auditBattleArt({ root: rootValue });
  const reviews = await auditBattleArtReviews({ root: rootValue });
  const compile = await compileApproved({ root: rootValue, check: true });
  return { ok: true, audit, reviews, compile };
}

export async function exists(root, relative) {
  try {
    await access(resolveTracked(root, relative));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
