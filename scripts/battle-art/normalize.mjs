import {
  open,
  rm
} from 'node:fs/promises';
import path from 'node:path';

import {
  CANDIDATE_SCHEMA,
  assertStyleReferenceProvenance,
  atomicWrite,
  candidatePaths,
  exactKeys,
  inspectImageContents,
  loadBattleArt,
  readJson,
  readPinnedRegularFile,
  resolveTracked,
  selectFamilies,
  sha256,
  stableJson,
  verifyCandidateRouteDerivation
} from './lifecycle.mjs';
import {
  normalizeGeneratedRasterBytes,
  validateRasterBytes
} from './raster-contract.mjs';
import {
  withBattleArtCandidateLock
} from './candidate-lock.mjs';

const NORMALIZE_TRANSACTION_SCHEMA =
  'battle-art-candidate-normalize-transaction-v1';

function transactionPaths(paths) {
  return {
    backup: `${paths.directory}/.normalize-backup`,
    journal: `${paths.directory}/.normalize-transaction.json`
  };
}

async function removeTransactionFile(loaded, relative) {
  const absolute = resolveTracked(
    loaded.root,
    relative,
    'normalization transaction path'
  );
  await rm(absolute, { force: true, recursive: false });
  await syncDirectory(path.dirname(absolute));
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableAtomicWrite(loaded, relative, contents) {
  const absolute = await atomicWrite(loaded.root, relative, contents);
  await syncDirectory(path.dirname(absolute));
  return absolute;
}

async function cleanupTransaction(loaded, transaction) {
  await removeTransactionFile(loaded, transaction.backupPath);
  await removeTransactionFile(loaded, transaction.journalPath);
}

async function recoverNormalizationTransaction({
  loaded,
  entry,
  paths,
  check
}) {
  const transactionFiles = transactionPaths(paths);
  let transaction;
  try {
    ({ value: transaction } = await readJson(
      loaded.root,
      transactionFiles.journal,
      `${entry.descriptor.id} normalization transaction`
    ));
  } catch (error) {
    if (!error.message.includes('ENOENT')) throw error;
    if (!check) {
      await removeTransactionFile(loaded, transactionFiles.backup);
    }
    return;
  }
  if (check) {
    throw new Error(
      `${entry.descriptor.id} has an unfinished normalization transaction; `
      + 'run battle-art:normalize without --check to recover it'
    );
  }
  exactKeys(transaction, [
    'schemaVersion',
    'familyId',
    'theme',
    'imagePath',
    'metadataPath',
    'backupPath',
    'journalPath',
    'beforeImage',
    'afterImage'
  ], 'normalization transaction');
  if (transaction.schemaVersion !== NORMALIZE_TRANSACTION_SCHEMA
    || transaction.familyId !== entry.descriptor.id
    || transaction.theme !== entry.descriptor.theme
    || transaction.metadataPath !== paths.metadata
    || transaction.backupPath !== transactionFiles.backup
    || transaction.journalPath !== transactionFiles.journal
    || ![paths.imagePng, paths.imageWebp].includes(transaction.imagePath)
    || transaction.beforeImage?.path !== transaction.imagePath
    || transaction.afterImage?.path !== transaction.imagePath) {
    throw new Error(`${entry.descriptor.id} normalization transaction is invalid`);
  }
  let candidate;
  try {
    ({ value: candidate } = await readJson(
      loaded.root,
      paths.metadata,
      `${entry.descriptor.id} recovery candidate metadata`
    ));
  } catch (error) {
    if (!error.message.includes('ENOENT')) throw error;
    await cleanupTransaction(loaded, transaction);
    return;
  }
  if (stableJson(candidate.image) === stableJson(transaction.afterImage)) {
    const committedBytes = await readPinnedRegularFile(
      loaded.root,
      transaction.imagePath,
      transaction.afterImage.sha256,
      `${entry.descriptor.id} committed normalization image`
    );
    const committedImage = await inspectImageContents(
      transaction.imagePath,
      committedBytes
    );
    if (stableJson(committedImage) !== stableJson(transaction.afterImage)) {
      throw new Error(`${entry.descriptor.id} committed normalization pin is invalid`);
    }
    await cleanupTransaction(loaded, transaction);
    return;
  }
  if (stableJson(candidate.image) === stableJson(transaction.beforeImage)) {
    let currentIsOriginal = false;
    try {
      const currentBytes = await readPinnedRegularFile(
        loaded.root,
        transaction.imagePath,
        transaction.beforeImage.sha256,
        `${entry.descriptor.id} original normalization image`
      );
      const currentImage = await inspectImageContents(
        transaction.imagePath,
        currentBytes
      );
      currentIsOriginal =
        stableJson(currentImage) === stableJson(transaction.beforeImage);
    } catch {
      currentIsOriginal = false;
    }
    if (!currentIsOriginal) {
      const backupBytes = await readPinnedRegularFile(
        loaded.root,
        transaction.backupPath,
        transaction.beforeImage.sha256,
        `${entry.descriptor.id} normalization backup`
      );
      const backupImage = await inspectImageContents(
        transaction.imagePath,
        backupBytes
      );
      if (stableJson(backupImage) !== stableJson(transaction.beforeImage)) {
        throw new Error(`${entry.descriptor.id} normalization backup pin is invalid`);
      }
      await durableAtomicWrite(loaded, transaction.imagePath, backupBytes);
    }
    await cleanupTransaction(loaded, transaction);
    return;
  }
  // A later forced generation superseded both sides of this old transaction.
  await cleanupTransaction(loaded, transaction);
}

function assertCurrentCandidate(entry, candidate, paths) {
  exactKeys(candidate, [
    'schemaVersion',
    'familyId',
    'theme',
    'descriptorPath',
    'descriptorSha256',
    'promptProfile',
    'styleReferences',
    'styleReferenceMode',
    'styleReferenceProvenance',
    ...(candidate.derivation !== undefined ? ['derivation'] : []),
    'image',
    'worker',
    'status'
  ], 'candidate metadata');
  if (candidate.schemaVersion !== CANDIDATE_SCHEMA
    || candidate.familyId !== entry.descriptor.id
    || candidate.theme !== entry.descriptor.theme
    || candidate.descriptorPath !== entry.path
    || candidate.status !== 'candidate-awaiting-review') {
    throw new Error(`${entry.descriptor.id} candidate does not belong to the selected family`);
  }
  const descriptorPin = sha256(Buffer.from(stableJson(entry.descriptor)));
  if (candidate.descriptorSha256 !== descriptorPin) {
    throw new Error(`${entry.descriptor.id} candidate descriptor pin is stale`);
  }
  if (stableJson(candidate.promptProfile) !== stableJson(entry.descriptor.promptProfile)
    || stableJson(candidate.styleReferences)
      !== stableJson(entry.descriptor.styleReferences)) {
    throw new Error(`${entry.descriptor.id} candidate frozen input pins are stale`);
  }
  assertStyleReferenceProvenance({
    styleReferences: candidate.styleReferences,
    provenance: candidate.styleReferenceProvenance,
    mode: candidate.styleReferenceMode,
    args: candidate.worker?.args,
    label: `${entry.descriptor.id} candidate metadata`
  });
  if (![paths.imagePng, paths.imageWebp].includes(candidate.image?.path)) {
    throw new Error(`${entry.descriptor.id} candidate image path is not canonical`);
  }
}

async function normalizeOne({
  loaded,
  entry,
  check,
  afterImageWrite
}) {
  if (entry.descriptor.status !== 'draft') {
    throw new Error(
      `${entry.descriptor.id} is ${entry.descriptor.status}; `
      + 'only draft review candidates may be normalized'
    );
  }
  const paths = candidatePaths(entry.descriptor);
  await recoverNormalizationTransaction({
    loaded,
    entry,
    paths,
    check
  });
  let candidate;
  try {
    ({ value: candidate } = await readJson(
      loaded.root,
      paths.metadata,
      `${entry.descriptor.id} candidate metadata`
    ));
  } catch (error) {
    if (error.message.includes('ENOENT')) {
      throw new Error(`${entry.descriptor.id} has no generated review candidate`);
    }
    throw error;
  }
  assertCurrentCandidate(entry, candidate, paths);
  const originalBytes = await readPinnedRegularFile(
    loaded.root,
    candidate.image.path,
    candidate.image.sha256,
    `${entry.descriptor.id} normalization candidate`
  );
  const originalImage = await inspectImageContents(
    candidate.image.path,
    originalBytes
  );
  if (stableJson(originalImage) !== stableJson(candidate.image)) {
    throw new Error(`${entry.descriptor.id} candidate image pin is stale`);
  }
  await verifyCandidateRouteDerivation({
    root: loaded.root,
    descriptor: entry.descriptor,
    candidate,
    candidateBytes: originalBytes,
    profile: loaded.promptProfile,
    paths,
    label: `${entry.descriptor.id} normalization route derivation`
  });
  const normalizedBytes = await normalizeGeneratedRasterBytes({
    bytes: originalBytes,
    descriptor: entry.descriptor,
    profile: loaded.promptProfile,
    format: originalImage.format,
    label: `${entry.descriptor.id} normalized candidate`
  });
  await validateRasterBytes({
    bytes: normalizedBytes,
    descriptor: entry.descriptor,
    profile: loaded.promptProfile,
    label: `${entry.descriptor.id} normalized candidate`
  });
  const image = await inspectImageContents(candidate.image.path, normalizedBytes);
  const drift = !normalizedBytes.equals(originalBytes);
  if (drift && candidate.derivation !== undefined) {
    throw new Error(
      `${entry.descriptor.id} route-finished candidate is not canonical; `
      + 'refusing to invalidate its immutable derivation'
    );
  }
  if (check || !drift) {
    return {
      family: entry.descriptor.id,
      status: drift ? 'drift' : 'current',
      image
    };
  }
  const updatedCandidate = {
    ...candidate,
    image
  };
  const transactionFiles = transactionPaths(paths);
  const transaction = {
    schemaVersion: NORMALIZE_TRANSACTION_SCHEMA,
    familyId: entry.descriptor.id,
    theme: entry.descriptor.theme,
    imagePath: candidate.image.path,
    metadataPath: paths.metadata,
    backupPath: transactionFiles.backup,
    journalPath: transactionFiles.journal,
    beforeImage: candidate.image,
    afterImage: image
  };
  await durableAtomicWrite(loaded, transaction.backupPath, originalBytes);
  await durableAtomicWrite(
    loaded,
    transaction.journalPath,
    stableJson(transaction)
  );
  await durableAtomicWrite(loaded, candidate.image.path, normalizedBytes);
  await afterImageWrite?.();
  try {
    await durableAtomicWrite(
      loaded,
      paths.metadata,
      stableJson(updatedCandidate)
    );
  } catch (error) {
    try {
      await recoverNormalizationTransaction({
        loaded,
        entry,
        paths,
        check: false
      });
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `${entry.descriptor.id} metadata update failed and image rollback failed`
      );
    }
    throw error;
  }
  await cleanupTransaction(loaded, transaction);
  return {
    family: entry.descriptor.id,
    status: 'normalized',
    image
  };
}

export async function normalizeCandidates({
  root: rootValue,
  check = false,
  ...selection
} = {}, {
  afterImageWrite = null
} = {}) {
  const loaded = await loadBattleArt(rootValue);
  const selected = selectFamilies(loaded, selection);
  const results = [];
  for (const entry of selected) {
    results.push(await withBattleArtCandidateLock({
      root: loaded.root,
      theme: entry.descriptor.theme,
      family: entry.descriptor.id
    }, async () => {
      const locked = await loadBattleArt(loaded.root);
      const [lockedEntry] = selectFamilies(locked, {
        ...selection,
        family: entry.descriptor.id,
        families: null
      });
      return normalizeOne({
        loaded: locked,
        entry: lockedEntry,
        check,
        afterImageWrite
      });
    }));
  }
  return {
    ok: !check || results.every(result => result.status === 'current'),
    check,
    results
  };
}
