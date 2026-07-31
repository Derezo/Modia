import { lstat } from 'node:fs/promises';
import path from 'node:path';

import {
  withPersistentExclusiveLock,
  withPersistentExclusiveLocks
} from '../battle-maps/persistent-exclusive-lock.mjs';

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

async function assertSafeLockPath(root, lockPath, label) {
  const relative = path.relative(root, lockPath);
  if (
    relative === ''
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes the project root`);
  }
  let current = root;
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (details.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link component`);
    }
    if (
      index < segments.length - 1
      && !details.isDirectory()
    ) {
      throw new Error(`${label} contains a non-directory component`);
    }
    if (
      index === segments.length - 1
      && !details.isFile()
    ) {
      throw new Error(`${label} must be a regular non-symlink file`);
    }
  }
}

export function withBattleArtCandidateLock({
  root: rootValue,
  theme,
  family
}, callback) {
  if (!ID_PATTERN.test(theme) || !ID_PATTERN.test(family)) {
    throw new Error('battle-art candidate lock identity is invalid');
  }
  const root = path.resolve(rootValue);
  const lockPath = path.join(
    root,
    'ai-image-metadata',
    'battle-art',
    'candidates',
    theme,
    '.locks',
    `${family}.lock`
  );
  return withPersistentExclusiveLock({
    lockPath,
    label: `battle-art candidate lock ${theme}/${family}`,
    assertSafePath: () => (
      assertSafeLockPath(root, lockPath, 'battle-art candidate lock path')
    )
  }, callback);
}

export function withBattleArtManifestLock({
  root: rootValue
}, callback) {
  const root = path.resolve(rootValue);
  const lockPath = path.join(
    root,
    'ai-image-metadata',
    'battle-art',
    '.locks',
    'manifest.lock'
  );
  return withPersistentExclusiveLock({
    lockPath,
    label: 'battle-art manifest lock',
    assertSafePath: () => (
      assertSafeLockPath(root, lockPath, 'battle-art manifest lock path')
    )
  }, callback);
}

export function withBattleArtManifestAndCandidateLock({
  root: rootValue,
  theme,
  family
}, callback) {
  if (!ID_PATTERN.test(theme) || !ID_PATTERN.test(family)) {
    throw new Error('battle-art candidate lock identity is invalid');
  }
  const root = path.resolve(rootValue);
  const manifestLockPath = path.join(
    root,
    'ai-image-metadata',
    'battle-art',
    '.locks',
    'manifest.lock'
  );
  const candidateLockPath = path.join(
    root,
    'ai-image-metadata',
    'battle-art',
    'candidates',
    theme,
    '.locks',
    `${family}.lock`
  );
  return withPersistentExclusiveLocks({
    locks: [
      {
        lockPath: manifestLockPath,
        label: 'battle-art manifest lock',
        assertSafePath: () => (
          assertSafeLockPath(
            root,
            manifestLockPath,
            'battle-art manifest lock path'
          )
        )
      },
      {
        lockPath: candidateLockPath,
        label: `battle-art candidate lock ${theme}/${family}`,
        assertSafePath: () => (
          assertSafeLockPath(
            root,
            candidateLockPath,
            'battle-art candidate lock path'
          )
        )
      }
    ]
  }, callback);
}
