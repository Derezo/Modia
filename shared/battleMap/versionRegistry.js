const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function freezeHashRequirements(required, containerPath) {
  return Object.freeze({
    required,
    algorithm: required ? 'sha256' : null,
    format: required ? 'sha256:<64 lowercase hex characters>' : null,
    containerPath,
    fields: Object.freeze(required
      ? ['authoritativeHash', 'visualHash', 'fullHash']
      : [])
  });
}

function freezeDescriptor({
  battleMapSchemaVersion,
  terrainGenerationVersion,
  decoderId,
  hashRequirements
}) {
  return Object.freeze({
    battleMapSchemaVersion,
    terrainGenerationVersion,
    decoderId,
    hashRequirements
  });
}

/**
 * The supported persisted-map boundaries.
 *
 * Do not infer V1 from a missing or unknown version. Historical callers that
 * need to interpret an unversioned row must do so before entering this
 * registry, in the deliberately isolated V1 compatibility loader.
 */
export const BATTLE_MAP_VERSION_DESCRIPTORS = Object.freeze([
  freezeDescriptor({
    battleMapSchemaVersion: 1,
    terrainGenerationVersion: 1,
    decoderId: 'battle-map-v1',
    hashRequirements: freezeHashRequirements(false, null)
  }),
  freezeDescriptor({
    battleMapSchemaVersion: 2,
    terrainGenerationVersion: 2,
    decoderId: 'battle-map-v2',
    hashRequirements: freezeHashRequirements(true, 'diagnostics.hashes')
  }),
  freezeDescriptor({
    battleMapSchemaVersion: 3,
    terrainGenerationVersion: 3,
    decoderId: 'battle-map-v3',
    hashRequirements: freezeHashRequirements(true, 'hashes')
  })
]);

export const BATTLE_MAP_VERSION_REGISTRY = Object.freeze(
  Object.fromEntries(BATTLE_MAP_VERSION_DESCRIPTORS.map(descriptor => [
    `${descriptor.battleMapSchemaVersion}:${descriptor.terrainGenerationVersion}`,
    descriptor
  ]))
);

function versionPair(value, terrainGenerationVersion) {
  if (typeof value === 'number') {
    return {
      battleMapSchemaVersion: value,
      terrainGenerationVersion
    };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Battle map version must be an object or schema-version number');
  }
  return {
    battleMapSchemaVersion: value.battleMapSchemaVersion,
    terrainGenerationVersion: value.terrainGenerationVersion
  };
}

function assertVersionNumber(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

/**
 * Resolve an exact schema/generation pair. Missing, crossed, and future
 * versions fail closed instead of falling through to a legacy decoder.
 */
export function resolveBattleMapVersionDescriptor(
  value,
  terrainGenerationVersion
) {
  const pair = versionPair(value, terrainGenerationVersion);
  assertVersionNumber(pair.battleMapSchemaVersion, 'battleMapSchemaVersion');
  assertVersionNumber(pair.terrainGenerationVersion, 'terrainGenerationVersion');
  const descriptor = BATTLE_MAP_VERSION_REGISTRY[
    `${pair.battleMapSchemaVersion}:${pair.terrainGenerationVersion}`
  ];
  if (!descriptor) {
    throw new RangeError(
      `Unsupported battle map version pair `
      + `${pair.battleMapSchemaVersion}/${pair.terrainGenerationVersion}`
    );
  }
  return descriptor;
}

export function assertBattleMapVersion(value, terrainGenerationVersion) {
  resolveBattleMapVersionDescriptor(value, terrainGenerationVersion);
  return value;
}

function decoderFromRegistry(decoders, descriptor) {
  if (decoders instanceof Map) {
    return decoders.get(descriptor.decoderId);
  }
  if (decoders !== null && typeof decoders === 'object') {
    return decoders[descriptor.decoderId];
  }
  throw new TypeError('decoder registry must be an object or Map');
}

/**
 * Resolve the decoder registered for the exact persisted version pair.
 * Decoder registries are keyed by the descriptor's stable decoderId.
 */
export function resolveBattleMapDecoder(
  value,
  decoders,
  terrainGenerationVersion
) {
  const descriptor = resolveBattleMapVersionDescriptor(
    value,
    terrainGenerationVersion
  );
  const decoder = decoderFromRegistry(decoders, descriptor);
  if (typeof decoder !== 'function') {
    throw new TypeError(
      `Missing decoder for ${descriptor.decoderId} `
      + `(${descriptor.battleMapSchemaVersion}/${descriptor.terrainGenerationVersion})`
    );
  }
  return decoder;
}

export function resolveBattleMapHashRequirements(
  value,
  terrainGenerationVersion
) {
  return resolveBattleMapVersionDescriptor(
    value,
    terrainGenerationVersion
  ).hashRequirements;
}

function valueAtPath(value, path) {
  return path.split('.').reduce(
    (current, key) => current?.[key],
    value
  );
}

/**
 * Assert the required final-map hash set for the map's exact version.
 *
 * V1 intentionally has no final-map hash contract. V2 and V3 require all
 * three domain-separated map hashes in their versioned containers.
 */
export function assertBattleMapHashRequirements(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Battle map must be an object');
  }
  const descriptor = resolveBattleMapVersionDescriptor(value);
  const requirements = descriptor.hashRequirements;
  if (!requirements.required) return value;

  const hashes = valueAtPath(value, requirements.containerPath);
  if (hashes === null || typeof hashes !== 'object' || Array.isArray(hashes)) {
    throw new TypeError(
      `BattleMapV${descriptor.battleMapSchemaVersion}.`
      + `${requirements.containerPath} must be an object`
    );
  }
  for (const field of requirements.fields) {
    if (!HASH_PATTERN.test(hashes[field] ?? '')) {
      throw new TypeError(
        `BattleMapV${descriptor.battleMapSchemaVersion}.`
        + `${requirements.containerPath}.${field} must be a lowercase SHA-256 hash`
      );
    }
  }
  return value;
}

