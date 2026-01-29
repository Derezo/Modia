/**
 * Unit tests for fileLock.js (CommonJS)
 * Tests the cross-process file locking utility used by CLI scripts.
 *
 * Run with: node --test scripts/lib/fileLock.test.js
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const {
  acquireLockSync,
  releaseLockSync,
  withFileLockSync,
  acquireLockAsync,
  releaseLockAsync,
  withFileLockAsync,
  getLockPath,
  DEFAULT_CONFIG
} = require('./fileLock.js');

// Test-specific directory to isolate from production locks
const testDir = path.join(os.tmpdir(), `filelock-test-${process.pid}-${Date.now()}`);
const testLockDir = path.join(testDir, '.locks');
const testFile = path.join(testDir, 'test.json');

describe('fileLock (CommonJS)', () => {
  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, '{}');
  });

  after(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean up any existing lock files before each test
    if (fs.existsSync(testLockDir)) {
      fs.readdirSync(testLockDir).forEach(f => {
        try {
          fs.unlinkSync(path.join(testLockDir, f));
        } catch {
          // Ignore errors
        }
      });
    }
  });

  // ============================================================================
  // getLockPath Tests
  // ============================================================================

  describe('getLockPath', () => {
    it('should generate a lock path from file path', () => {
      const lockPath = getLockPath('/some/path/file.json', testLockDir);
      assert.ok(lockPath.endsWith('.lock'), 'Lock path should end with .lock');
      assert.ok(lockPath.startsWith(testLockDir), 'Lock path should be in lock directory');
    });

    it('should sanitize special characters in file path', () => {
      const lockPath = getLockPath('/path/with spaces/and$pecial!chars.json', testLockDir);
      const fileName = path.basename(lockPath);
      // Should only contain alphanumeric and underscores (plus .lock extension)
      assert.ok(/^[a-zA-Z0-9_]+\.lock$/.test(fileName), `Filename should be sanitized: ${fileName}`);
    });

    it('should truncate very long paths', () => {
      const longPath = '/very/' + 'long/'.repeat(100) + 'path.json';
      const lockPath = getLockPath(longPath, testLockDir);
      const fileName = path.basename(lockPath);
      // Filename should be limited (200 char base + .lock)
      assert.ok(fileName.length <= 210, `Filename should be truncated: ${fileName.length} chars`);
    });

    it('should use default lock directory when not specified', () => {
      const lockPath = getLockPath('/some/file.json');
      assert.ok(lockPath.includes(DEFAULT_CONFIG.lockDir), 'Should use default lock directory');
    });
  });

  // ============================================================================
  // acquireLockSync Tests
  // ============================================================================

  describe('acquireLockSync', () => {
    it('should create lock file with correct content', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });

      try {
        assert.strictEqual(result.acquired, true, 'Lock should be acquired');
        assert.ok(fs.existsSync(result.lockPath), 'Lock file should exist');

        const content = JSON.parse(fs.readFileSync(result.lockPath, 'utf8'));
        assert.strictEqual(content.pid, process.pid, 'Lock should contain current PID');
        assert.ok(content.timestamp > 0, 'Lock should contain timestamp');
        assert.strictEqual(content.file, testFile, 'Lock should contain file path');
      } finally {
        releaseLockSync(result.lockPath);
      }
    });

    it('should set secure file permissions (0o600)', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });

      try {
        const stat = fs.statSync(result.lockPath);
        const permissions = stat.mode & 0o777;
        assert.strictEqual(permissions, 0o600, `Lock file should have 0600 permissions, got: ${permissions.toString(8)}`);
      } finally {
        releaseLockSync(result.lockPath);
      }
    });

    it('should create lock directory with secure permissions (0o700)', () => {
      const customLockDir = path.join(testDir, 'new-lock-dir');

      // Ensure directory doesn't exist
      if (fs.existsSync(customLockDir)) {
        fs.rmSync(customLockDir, { recursive: true });
      }

      const result = acquireLockSync(testFile, { lockDir: customLockDir });

      try {
        assert.ok(fs.existsSync(customLockDir), 'Lock directory should be created');
        const stat = fs.statSync(customLockDir);
        const permissions = stat.mode & 0o777;
        assert.strictEqual(permissions, 0o700, `Lock directory should have 0700 permissions, got: ${permissions.toString(8)}`);
      } finally {
        releaseLockSync(result.lockPath);
        fs.rmSync(customLockDir, { recursive: true, force: true });
      }
    });

    it('should fail after max retries when lock is held by another process', async () => {
      // First, acquire the lock
      const first = acquireLockSync(testFile, { lockDir: testLockDir });
      assert.strictEqual(first.acquired, true);

      try {
        // Try to acquire again with minimal retries
        const second = acquireLockSync(testFile, {
          lockDir: testLockDir,
          maxRetries: 2,
          retryDelayMs: 10
        });

        assert.strictEqual(second.acquired, false, 'Second lock attempt should fail');
        assert.strictEqual(second.lockPath, first.lockPath, 'Should return same lock path');
      } finally {
        releaseLockSync(first.lockPath);
      }
    });

    it('should return same lock path for same file', () => {
      const result1 = acquireLockSync(testFile, { lockDir: testLockDir });

      try {
        const expectedPath = getLockPath(testFile, testLockDir);
        assert.strictEqual(result1.lockPath, expectedPath, 'Lock path should match getLockPath result');
      } finally {
        releaseLockSync(result1.lockPath);
      }
    });
  });

  // ============================================================================
  // releaseLockSync Tests
  // ============================================================================

  describe('releaseLockSync', () => {
    it('should remove lock file', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });
      assert.ok(fs.existsSync(result.lockPath), 'Lock file should exist after acquire');

      releaseLockSync(result.lockPath);
      assert.ok(!fs.existsSync(result.lockPath), 'Lock file should be removed after release');
    });

    it('should be idempotent (multiple releases do not throw)', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });
      const lockPath = result.lockPath;

      releaseLockSync(lockPath);
      assert.doesNotThrow(() => {
        releaseLockSync(lockPath);
      }, 'Second release should not throw');

      assert.doesNotThrow(() => {
        releaseLockSync(lockPath);
      }, 'Third release should not throw');
    });

    it('should only allow owner to release lock', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });
      const lockPath = result.lockPath;

      // Manually modify the lock file to have a different PID
      const content = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      content.pid = 999999; // Fake PID
      fs.writeFileSync(lockPath, JSON.stringify(content));

      // Try to release - should not delete since we don't own it
      releaseLockSync(lockPath);

      assert.ok(fs.existsSync(lockPath), 'Lock file should still exist (not owned by us)');

      // Clean up manually
      fs.unlinkSync(lockPath);
    });
  });

  // ============================================================================
  // withFileLockSync Tests
  // ============================================================================

  describe('withFileLockSync', () => {
    it('should execute function with lock held', () => {
      let wasLockHeld = false;
      const lockPath = getLockPath(testFile, testLockDir);

      const result = withFileLockSync(testFile, () => {
        wasLockHeld = fs.existsSync(lockPath);
        return 'test-result';
      }, { lockDir: testLockDir });

      assert.strictEqual(result, 'test-result', 'Should return function result');
      assert.ok(wasLockHeld, 'Lock should be held during function execution');
    });

    it('should release lock after function completes', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      withFileLockSync(testFile, () => {
        // Do nothing
      }, { lockDir: testLockDir });

      assert.ok(!fs.existsSync(lockPath), 'Lock should be released after function');
    });

    it('should release lock even if function throws', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      assert.throws(() => {
        withFileLockSync(testFile, () => {
          throw new Error('Test error');
        }, { lockDir: testLockDir });
      }, /Test error/);

      assert.ok(!fs.existsSync(lockPath), 'Lock should be released even after error');
    });

    it('should throw when lock acquisition fails', () => {
      // First, acquire the lock
      const first = acquireLockSync(testFile, { lockDir: testLockDir });

      try {
        assert.throws(() => {
          withFileLockSync(testFile, () => {
            return 'should not reach here';
          }, {
            lockDir: testLockDir,
            maxRetries: 2,
            retryDelayMs: 10
          });
        }, /Failed to acquire lock/);
      } finally {
        releaseLockSync(first.lockPath);
      }
    });

    it('should support nested function calls (different files)', () => {
      const file1 = path.join(testDir, 'file1.json');
      const file2 = path.join(testDir, 'file2.json');

      fs.writeFileSync(file1, '{}');
      fs.writeFileSync(file2, '{}');

      const result = withFileLockSync(file1, () => {
        return withFileLockSync(file2, () => {
          return 'nested-result';
        }, { lockDir: testLockDir });
      }, { lockDir: testLockDir });

      assert.strictEqual(result, 'nested-result', 'Nested locks on different files should work');
    });
  });

  // ============================================================================
  // Stale Lock Cleanup Tests
  // ============================================================================

  describe('stale lock cleanup', () => {
    it('should clean up lock from non-existent process', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      // Manually create a lock file with a non-existent PID
      fs.mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: 999999999, // Very unlikely to be a real process
        timestamp: Date.now() - 120000, // 2 minutes old
        file: testFile
      }), { mode: 0o600 });

      assert.ok(fs.existsSync(lockPath), 'Stale lock file should exist before test');

      // Attempt to acquire should clean up stale lock and succeed
      const result = acquireLockSync(testFile, { lockDir: testLockDir, staleThresholdMs: 60000 });

      assert.strictEqual(result.acquired, true, 'Should acquire lock after cleaning up stale lock');
      releaseLockSync(result.lockPath);
    });

    it('should not clean up lock from running process', () => {
      // Acquire a lock (current process is definitely running)
      const result = acquireLockSync(testFile, { lockDir: testLockDir });

      try {
        // Try to acquire again - should fail because owner process is running
        const second = acquireLockSync(testFile, {
          lockDir: testLockDir,
          maxRetries: 1,
          retryDelayMs: 10,
          staleThresholdMs: 0 // Even with 0 threshold, running process lock should not be removed
        });

        assert.strictEqual(second.acquired, false, 'Should not acquire lock from running process');
      } finally {
        releaseLockSync(result.lockPath);
      }
    });

    it('should detect stale lock by dead process even if timestamp is recent', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      // Create lock with dead PID but recent timestamp
      fs.mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: 999999999, // Non-existent process
        timestamp: Date.now(), // Just created
        file: testFile
      }), { mode: 0o600 });

      // Should still acquire because process is dead
      const result = acquireLockSync(testFile, { lockDir: testLockDir });

      assert.strictEqual(result.acquired, true, 'Should acquire lock from dead process');
      releaseLockSync(result.lockPath);
    });
  });

  // ============================================================================
  // Security Tests
  // ============================================================================

  describe('security', () => {
    it('should safely handle symlinks in lock path', () => {
      const realLockFile = path.join(testDir, 'real-lock.lock');
      const symlinkPath = path.join(testDir, 'symlink-lock.lock');

      // Create a real lock file manually
      fs.writeFileSync(realLockFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        file: testFile
      }), { mode: 0o600 });

      // Create a symlink pointing to the real lock file
      try {
        fs.symlinkSync(realLockFile, symlinkPath);
      } catch (err) {
        // Symlinks might not work on some systems, skip test
        if (err.code === 'EPERM') {
          fs.unlinkSync(realLockFile);
          return;
        }
        throw err;
      }

      try {
        // Trying to release via symlink should fail safely (not delete real file)
        // The module validates symlinks and logs error but doesn't throw
        // This is a safe failure mode - the symlink is detected and rejected
        releaseLockSync(symlinkPath);

        // Original lock should still exist (symlink was rejected)
        assert.ok(fs.existsSync(realLockFile), 'Original lock file should still exist');

        // Symlink should also still exist (we didn't delete it)
        assert.ok(fs.lstatSync(symlinkPath).isSymbolicLink(), 'Symlink should still exist');
      } finally {
        fs.rmSync(symlinkPath, { force: true });
        fs.unlinkSync(realLockFile);
      }
    });

    it('should create new lock directory with 0o700 permissions', () => {
      const secureDir = path.join(testDir, 'secure-locks-' + Date.now());

      const result = acquireLockSync(testFile, { lockDir: secureDir });

      try {
        const stat = fs.statSync(secureDir);
        const permissions = stat.mode & 0o777;
        assert.strictEqual(permissions, 0o700, `Directory should have 0700 permissions, got: ${permissions.toString(8)}`);
      } finally {
        releaseLockSync(result.lockPath);
        fs.rmSync(secureDir, { recursive: true, force: true });
      }
    });
  });

  // ============================================================================
  // Error Cases
  // ============================================================================

  describe('error cases', () => {
    it('should return acquired: false after max retries', () => {
      // First, acquire the lock
      const first = acquireLockSync(testFile, { lockDir: testLockDir });

      try {
        const result = acquireLockSync(testFile, {
          lockDir: testLockDir,
          maxRetries: 3,
          retryDelayMs: 1
        });

        assert.strictEqual(result.acquired, false, 'Should return acquired: false');
        assert.ok(result.lockPath, 'Should still return lock path');
      } finally {
        releaseLockSync(first.lockPath);
      }
    });

    it('should handle corrupted lock file gracefully', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      // Create corrupted lock file with old mtime to trigger stale check
      fs.mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(lockPath, 'not valid json {{{', { mode: 0o600 });

      // Set old mtime to trigger stale detection
      const oldTime = new Date(Date.now() - 120000);
      fs.utimesSync(lockPath, oldTime, oldTime);

      // Should handle gracefully and acquire (corrupted file can't be parsed, no PID check)
      const result = acquireLockSync(testFile, {
        lockDir: testLockDir,
        staleThresholdMs: 60000
      });

      assert.strictEqual(result.acquired, true, 'Should acquire lock when existing lock is corrupted');
      releaseLockSync(result.lockPath);
    });

    it('should handle empty lock file gracefully', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      // Create empty lock file with old mtime
      fs.mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(lockPath, '', { mode: 0o600 });

      // Set old mtime to trigger stale detection
      const oldTime = new Date(Date.now() - 120000);
      fs.utimesSync(lockPath, oldTime, oldTime);

      const result = acquireLockSync(testFile, {
        lockDir: testLockDir,
        staleThresholdMs: 60000
      });

      assert.strictEqual(result.acquired, true, 'Should acquire lock when existing lock is empty');
      releaseLockSync(result.lockPath);
    });

    it('should handle lock file with missing PID', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      // Create lock file without PID and old timestamp
      fs.mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(lockPath, JSON.stringify({
        timestamp: Date.now() - 120000,
        file: testFile
      }), { mode: 0o600 });

      // Set old mtime to trigger stale detection by age
      const oldTime = new Date(Date.now() - 120000);
      fs.utimesSync(lockPath, oldTime, oldTime);

      const result = acquireLockSync(testFile, {
        lockDir: testLockDir,
        staleThresholdMs: 60000
      });

      assert.strictEqual(result.acquired, true, 'Should acquire lock when existing lock has no PID');
      releaseLockSync(result.lockPath);
    });
  });

  // ============================================================================
  // Async API Tests
  // ============================================================================

  describe('acquireLockAsync', () => {
    it('should create lock file with correct content', async () => {
      const result = await acquireLockAsync(testFile, { lockDir: testLockDir });

      try {
        assert.strictEqual(result.acquired, true, 'Lock should be acquired');
        assert.ok(fs.existsSync(result.lockPath), 'Lock file should exist');

        const content = JSON.parse(fs.readFileSync(result.lockPath, 'utf8'));
        assert.strictEqual(content.pid, process.pid, 'Lock should contain current PID');
      } finally {
        await releaseLockAsync(result.lockPath);
      }
    });

    it('should fail after max retries when lock is held', async () => {
      const first = await acquireLockAsync(testFile, { lockDir: testLockDir });

      try {
        const second = await acquireLockAsync(testFile, {
          lockDir: testLockDir,
          maxRetries: 2,
          retryDelayMs: 10
        });

        assert.strictEqual(second.acquired, false, 'Second lock attempt should fail');
      } finally {
        await releaseLockAsync(first.lockPath);
      }
    });
  });

  describe('withFileLockAsync', () => {
    it('should execute async function with lock held', async () => {
      let wasLockHeld = false;
      const lockPath = getLockPath(testFile, testLockDir);

      const result = await withFileLockAsync(testFile, async () => {
        wasLockHeld = fs.existsSync(lockPath);
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async-result';
      }, { lockDir: testLockDir });

      assert.strictEqual(result, 'async-result', 'Should return async function result');
      assert.ok(wasLockHeld, 'Lock should be held during async function execution');
    });

    it('should release lock even if async function throws', async () => {
      const lockPath = getLockPath(testFile, testLockDir);

      await assert.rejects(async () => {
        await withFileLockAsync(testFile, async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error('Async test error');
        }, { lockDir: testLockDir });
      }, /Async test error/);

      assert.ok(!fs.existsSync(lockPath), 'Lock should be released even after async error');
    });

    it('should throw when async lock acquisition fails', async () => {
      const first = await acquireLockAsync(testFile, { lockDir: testLockDir });

      try {
        await assert.rejects(async () => {
          await withFileLockAsync(testFile, async () => {
            return 'should not reach here';
          }, {
            lockDir: testLockDir,
            maxRetries: 2,
            retryDelayMs: 10
          });
        }, /Failed to acquire lock/);
      } finally {
        await releaseLockAsync(first.lockPath);
      }
    });
  });

  // ============================================================================
  // DEFAULT_CONFIG Tests
  // ============================================================================

  describe('DEFAULT_CONFIG', () => {
    it('should export expected default values', () => {
      assert.ok(DEFAULT_CONFIG.lockDir, 'Should have lockDir');
      assert.strictEqual(typeof DEFAULT_CONFIG.maxRetries, 'number', 'maxRetries should be a number');
      assert.strictEqual(typeof DEFAULT_CONFIG.retryDelayMs, 'number', 'retryDelayMs should be a number');
      assert.strictEqual(typeof DEFAULT_CONFIG.maxRetryDelayMs, 'number', 'maxRetryDelayMs should be a number');
      assert.strictEqual(typeof DEFAULT_CONFIG.staleThresholdMs, 'number', 'staleThresholdMs should be a number');
    });

    it('should have sensible default values', () => {
      assert.ok(DEFAULT_CONFIG.maxRetries >= 10, 'Should have reasonable max retries');
      assert.ok(DEFAULT_CONFIG.retryDelayMs >= 50, 'Should have reasonable initial delay');
      assert.ok(DEFAULT_CONFIG.staleThresholdMs >= 30000, 'Stale threshold should be at least 30s');
    });
  });
});
