import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquirePersistentExclusiveLock,
  acquirePersistentExclusiveLocks,
  releasePersistentExclusiveLock,
  releasePersistentExclusiveLocks
} from './persistent-exclusive-lock.mjs';

function tryNonblockingLock(lockPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'flock',
      ['--nonblock', '--exclusive', lockPath, 'true'],
      { stdio: 'ignore' }
    );
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

test('single persistent lock holds the requested lock file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-single-'));
  const lockPath = path.join(root, 'requested.lock');
  const lock = await acquirePersistentExclusiveLock({ lockPath });

  try {
    assert.deepEqual(
      await tryNonblockingLock(lockPath),
      { code: 1, signal: null }
    );
  } finally {
    await releasePersistentExclusiveLock(lock);
  }

  assert.deepEqual(
    await tryNonblockingLock(lockPath),
    { code: 0, signal: null }
  );
});

test('persistent lock group holds every requested lock file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-group-'));
  const firstPath = path.join(root, 'first.lock');
  const secondPath = path.join(root, 'second.lock');
  const lock = await acquirePersistentExclusiveLocks({
    locks: [
      { lockPath: firstPath },
      { lockPath: secondPath }
    ]
  });

  try {
    assert.deepEqual(
      await tryNonblockingLock(firstPath),
      { code: 1, signal: null }
    );
    assert.deepEqual(
      await tryNonblockingLock(secondPath),
      { code: 1, signal: null }
    );
  } finally {
    await releasePersistentExclusiveLocks(lock);
  }

  assert.deepEqual(
    await tryNonblockingLock(firstPath),
    { code: 0, signal: null }
  );
  assert.deepEqual(
    await tryNonblockingLock(secondPath),
    { code: 0, signal: null }
  );
});
