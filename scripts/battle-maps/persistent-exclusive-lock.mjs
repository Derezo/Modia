import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open
} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_HOLDER_SOURCE = [
  'process.stdout.write("locked\\n");',
  'process.stdin.resume();',
  'process.stdin.on("end", () => process.exit(0));'
].join('');
const LOCK_HOLDER_SCRIPT_PREFIX = 'set -eu\n';

function lockHolderShellSource(descriptorCount) {
  const acquisitions = Array.from(
    { length: descriptorCount },
    (_, index) => `flock --exclusive ${index + 3}`
  ).join('\n');
  return `${LOCK_HOLDER_SCRIPT_PREFIX}${acquisitions}\nexec "$@"\n`;
}

function describeHolderResult(result) {
  return result?.error?.message ?? result?.signal ?? `code ${result?.code}`;
}

async function stableLockPath(lockPath, expected) {
  const current = await lstat(lockPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return Boolean(
    current
    && !current.isSymbolicLink()
    && current.isFile()
    && current.dev === expected.dev
    && current.ino === expected.ino
  );
}

export async function acquirePersistentExclusiveLock({
  lockPath,
  label = lockPath,
  assertSafePath = async () => {},
  holderSource = DEFAULT_HOLDER_SOURCE
}) {
  await assertSafePath(lockPath);
  await mkdir(path.dirname(lockPath), { recursive: true });
  await assertSafePath(lockPath);

  let handle;
  try {
    handle = await open(
      lockPath,
      fsConstants.O_RDWR
        | fsConstants.O_CREAT
        | (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
  } catch (error) {
    if (error.code === 'ELOOP') {
      throw new Error(`${label} must be a regular non-symlink file`);
    }
    throw error;
  }

  const details = await handle.stat();
  if (
    !details.isFile()
    || !(await stableLockPath(lockPath, details))
  ) {
    await handle.close();
    throw new Error(`${label} must be a stable regular non-symlink file`);
  }

  const child = spawn(
    '/bin/sh',
    [
      '-c',
      lockHolderShellSource(1),
      'persistent-lock-holder',
      process.execPath,
      '-e',
      holderSource
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe', handle.fd]
    }
  );
  let holderResult = null;
  let stderr = '';
  const holderCompletion = new Promise(resolve => {
    child.once('error', error => {
      holderResult = { error, code: null, signal: null };
      resolve(holderResult);
    });
    child.once('close', (code, signal) => {
      holderResult = { error: null, code, signal };
      resolve(holderResult);
    });
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 4096) stderr = stderr.slice(-4096);
  });

  try {
    const stdout = await new Promise((resolve, reject) => {
      let value = '';
      child.once('error', reject);
      child.stdout.on('data', chunk => {
        value += chunk.toString('utf8');
        if (value.includes('\n')) resolve(value);
      });
      holderCompletion.then(result => {
        reject(new Error(
          `${label} holder failed before acquisition: `
            + `${stderr.trim() || describeHolderResult(result)}`
        ));
      });
    });
    if (stdout !== 'locked\n') {
      throw new Error(`${label} holder emitted an invalid handshake`);
    }
    await assertSafePath(lockPath);
    if (!(await stableLockPath(lockPath, details))) {
      throw new Error(`${label} pathname changed during acquisition`);
    }
  } catch (error) {
    if (!child.stdin.destroyed) child.stdin.end();
    await holderCompletion;
    await handle.close();
    throw error;
  }

  return {
    child,
    details,
    getHolderResult() {
      return holderResult;
    },
    handle,
    holderCompletion,
    label,
    lockPath
  };
}

export async function releasePersistentExclusiveLock(lock) {
  try {
    if (lock.getHolderResult()) {
      throw new Error(`${lock.label} holder exited before release`);
    }
    if (!lock.child.stdin.destroyed) lock.child.stdin.end();
    const holderResult = await lock.holderCompletion;
    if (holderResult.error || holderResult.code !== 0) {
      throw new Error(
        `${lock.label} holder exited with ${describeHolderResult(holderResult)}`
      );
    }
    const opened = await lock.handle.stat();
    if (
      opened.dev !== lock.details.dev
      || opened.ino !== lock.details.ino
      || !(await stableLockPath(lock.lockPath, lock.details))
    ) {
      throw new Error(`${lock.label} pathname changed before release`);
    }
  } finally {
    await lock.handle.close();
  }
}

export async function withPersistentExclusiveLock(options, callback) {
  const lock = await acquirePersistentExclusiveLock(options);
  try {
    return await callback();
  } finally {
    await releasePersistentExclusiveLock(lock);
  }
}

export async function acquirePersistentExclusiveLocks({
  locks,
  holderSource = DEFAULT_HOLDER_SOURCE
}) {
  if (!Array.isArray(locks) || locks.length < 2) {
    throw new Error('persistent lock group requires at least two locks');
  }
  const uniquePaths = new Set(locks.map(lock => path.resolve(lock.lockPath)));
  if (uniquePaths.size !== locks.length) {
    throw new Error('persistent lock group paths must be unique');
  }

  const entries = [];
  try {
    for (const options of locks) {
      const {
        lockPath,
        label = lockPath,
        assertSafePath = async () => {}
      } = options;
      await assertSafePath(lockPath);
      await mkdir(path.dirname(lockPath), { recursive: true });
      await assertSafePath(lockPath);
      let handle;
      try {
        handle = await open(
          lockPath,
          fsConstants.O_RDWR
            | fsConstants.O_CREAT
            | (fsConstants.O_NOFOLLOW ?? 0),
          0o600
        );
      } catch (error) {
        if (error.code === 'ELOOP') {
          throw new Error(`${label} must be a regular non-symlink file`);
        }
        throw error;
      }
      const details = await handle.stat();
      if (
        !details.isFile()
        || !(await stableLockPath(lockPath, details))
      ) {
        await handle.close();
        throw new Error(`${label} must be a stable regular non-symlink file`);
      }
      if (entries.some(entry => (
        entry.details.dev === details.dev
        && entry.details.ino === details.ino
      ))) {
        await handle.close();
        throw new Error('persistent lock group paths must resolve to unique files');
      }
      entries.push({
        assertSafePath,
        details,
        handle,
        label,
        lockPath
      });
    }
  } catch (error) {
    await Promise.allSettled(entries.map(entry => entry.handle.close()));
    throw error;
  }

  const child = spawn(
    '/bin/sh',
    [
      '-c',
      lockHolderShellSource(entries.length),
      'persistent-lock-holder',
      process.execPath,
      '-e',
      holderSource
    ],
    {
      stdio: [
        'pipe',
        'pipe',
        'pipe',
        ...entries.map(entry => entry.handle.fd)
      ]
    }
  );
  let holderResult = null;
  let stderr = '';
  const label = entries.map(entry => entry.label).join(' then ');
  const holderCompletion = new Promise(resolve => {
    child.once('error', error => {
      holderResult = { error, code: null, signal: null };
      resolve(holderResult);
    });
    child.once('close', (code, signal) => {
      holderResult = { error: null, code, signal };
      resolve(holderResult);
    });
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 4096) stderr = stderr.slice(-4096);
  });

  try {
    const stdout = await new Promise((resolve, reject) => {
      let value = '';
      child.once('error', reject);
      child.stdout.on('data', chunk => {
        value += chunk.toString('utf8');
        if (value.includes('\n')) resolve(value);
      });
      holderCompletion.then(result => {
        reject(new Error(
          `${label} holder failed before acquisition: `
            + `${stderr.trim() || describeHolderResult(result)}`
        ));
      });
    });
    if (stdout !== 'locked\n') {
      throw new Error(`${label} holder emitted an invalid handshake`);
    }
    for (const entry of entries) {
      await entry.assertSafePath(entry.lockPath);
      if (!(await stableLockPath(entry.lockPath, entry.details))) {
        throw new Error(`${entry.label} pathname changed during acquisition`);
      }
    }
  } catch (error) {
    if (!child.stdin.destroyed) child.stdin.end();
    await holderCompletion;
    await Promise.allSettled(entries.map(entry => entry.handle.close()));
    throw error;
  }

  return {
    child,
    entries,
    getHolderResult() {
      return holderResult;
    },
    holderCompletion,
    label
  };
}

export async function releasePersistentExclusiveLocks(lock) {
  try {
    if (lock.getHolderResult()) {
      throw new Error(`${lock.label} holder exited before release`);
    }
    if (!lock.child.stdin.destroyed) lock.child.stdin.end();
    const holderResult = await lock.holderCompletion;
    if (holderResult.error || holderResult.code !== 0) {
      throw new Error(
        `${lock.label} holder exited with ${describeHolderResult(holderResult)}`
      );
    }
    for (const entry of lock.entries) {
      const opened = await entry.handle.stat();
      if (
        opened.dev !== entry.details.dev
        || opened.ino !== entry.details.ino
        || !(await stableLockPath(entry.lockPath, entry.details))
      ) {
        throw new Error(`${entry.label} pathname changed before release`);
      }
    }
  } finally {
    const closeResults = await Promise.allSettled(
      lock.entries.map(entry => entry.handle.close())
    );
    const failedClose = closeResults.find(result => result.status === 'rejected');
    if (failedClose) throw failedClose.reason;
  }
}

export async function withPersistentExclusiveLocks(options, callback) {
  const lock = await acquirePersistentExclusiveLocks(options);
  try {
    return await callback();
  } finally {
    await releasePersistentExclusiveLocks(lock);
  }
}
