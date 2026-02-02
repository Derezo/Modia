import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedisClientForRateLimit, isRedisConfigured } from '../config/redis.js';

// Environment detection
const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production' || (!isTest && !isDev);

// Redis store singleton (initialized lazily)
let redisStore = null;
let redisStoreInitialized = false;

// TEST_RATE_LIMITS=true enables rate limiting even in test mode
// This allows dedicated rate limit tests to verify behavior
const testRateLimitsEnabled = process.env.TEST_RATE_LIMITS === 'true';

// Determine if rate limiting should be active
const shouldEnableRateLimiting = () => {
  if (isTest) {
    return testRateLimitsEnabled;
  }
  return true; // Always enabled in dev/prod
};

// Test bypass header - allows integration tests to skip rate limiting on dev servers
// Only works in non-production environments
const TEST_BYPASS_HEADER = 'x-test-bypass-rate-limit';
const TEST_BYPASS_SECRET = 'modia-test-bypass-2024';

/**
 * Check if a request should skip rate limiting
 * @param {Request} req - Express request object
 * @param {boolean} rateLimitingEnabled - Whether rate limiting is enabled
 * @returns {boolean} - True if request should skip rate limiting
 */
const shouldSkipRateLimit = (req, rateLimitingEnabled) => {
  // If rate limiting is already disabled (test mode), skip
  if (!rateLimitingEnabled) {
    return true;
  }

  // In production, never allow bypass
  if (isProduction) {
    return false;
  }

  // In dev mode, allow bypass with correct header (for integration tests)
  const bypassHeader = req.get(TEST_BYPASS_HEADER);
  if (bypassHeader === TEST_BYPASS_SECRET) {
    return true;
  }

  return false;
};

// Log warning if NODE_ENV is not set
if (!process.env.NODE_ENV) {
  console.warn('WARNING: NODE_ENV not set. Rate limiting is enabled. Set NODE_ENV=development for higher limits.');
}

// Stats tracking for test assertions
const limiterStats = new Map();

// Store references to limiter instances for reset capability
const limiterInstances = new Map();

/**
 * Initialize Redis store for rate limiting
 * Falls back to in-memory store if Redis is unavailable
 * @returns {Promise<import('rate-limit-redis').RedisStore|null>}
 */
async function getRedisStore() {
  if (redisStoreInitialized) {
    return redisStore;
  }

  redisStoreInitialized = true;

  // Skip Redis in test mode unless explicitly enabled
  if (isTest && !process.env.TEST_REDIS) {
    return null;
  }

  // Check if Redis is configured
  if (!isRedisConfigured()) {
    return null;
  }

  try {
    const redisClient = await getRedisClientForRateLimit();
    if (!redisClient) {
      return null;
    }

    redisStore = new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix: 'rl:'  // Rate limit key prefix
    });

    console.log('[RateLimiter] Using Redis store');
    return redisStore;
  } catch (err) {
    console.warn('[RateLimiter] Failed to initialize Redis store:', err.message);
    console.warn('[RateLimiter] Falling back to in-memory store');
    return null;
  }
}

// Initialize Redis store asynchronously on module load
// This allows the store to be ready when limiters are created
let redisStorePromise = null;
if (isRedisConfigured() && !isTest) {
  redisStorePromise = getRedisStore();
}

/**
 * Get the max requests based on environment
 * @param {number} prodDefault - Default limit for production
 * @returns {number} - Max requests for current environment
 */
const getMaxRequests = (prodDefault) => {
  if (isTest && !testRateLimitsEnabled) {
    return 999999; // Effectively unlimited when rate limiting disabled in test
  }
  if (isTest && testRateLimitsEnabled) {
    return prodDefault; // Use production limits for rate limit tests
  }
  if (isDev) {
    return prodDefault * 5; // 5x in development
  }
  return prodDefault * 2; // 2x in production (allow some headroom)
};

/**
 * Create a rate limiter with environment-aware settings and stats tracking
 * @param {Object} config - Limiter configuration
 * @param {string} config.name - Unique name for this limiter (used for stats)
 * @param {number} config.windowMs - Time window in milliseconds
 * @param {number} config.maxRequests - Max requests per window (production default)
 * @param {string} config.message - Error message when limit exceeded
 * @param {boolean} config.useUserKey - If true, use user ID for authenticated requests (falls back to IP)
 * @returns {Function} - Express middleware
 */
export function createLimiter({ name, windowMs, maxRequests, message, useUserKey = false }) {
  // Initialize stats for this limiter
  limiterStats.set(name, {
    calls: 0,
    blocked: 0,
    lastReset: Date.now()
  });

  const rateLimitingEnabled = shouldEnableRateLimiting();
  const max = getMaxRequests(maxRequests);

  // Key generator: use user ID for authenticated requests if useUserKey is enabled
  // Falls back to IP for unauthenticated requests or when useUserKey is false
  const keyGenerator = useUserKey
    ? (req) => (req.user?.userId ? `user:${req.user.userId}` : req.ip)
    : (req) => req.ip;

  // Build limiter config
  const limiterConfig = {
    windowMs,
    max,
    keyGenerator,
    skip: (req) => shouldSkipRateLimit(req, rateLimitingEnabled),
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      // Track blocked requests
      const stats = limiterStats.get(name);
      if (stats) {
        stats.blocked++;
      }
      res.status(options.statusCode).json(options.message);
    }
  };

  // Use Redis store if available (initialized synchronously from previous calls)
  if (redisStore) {
    limiterConfig.store = redisStore;
  }

  const limiter = rateLimit(limiterConfig);

  // Store the limiter instance for reset capability
  limiterInstances.set(name, limiter);

  // Wrap the limiter to track all calls
  return (req, res, next) => {
    const stats = limiterStats.get(name);
    if (stats) {
      stats.calls++;
    }
    return limiter(req, res, next);
  };
}

/**
 * Create a mock limiter that always passes (for tests that don't need rate limiting)
 * Still tracks stats for verification
 * @param {string} name - Unique name for this limiter
 * @returns {Function} - Express middleware that always passes
 */
export function createMockLimiter(name) {
  limiterStats.set(name, {
    calls: 0,
    blocked: 0,
    lastReset: Date.now()
  });

  return (req, res, next) => {
    const stats = limiterStats.get(name);
    if (stats) {
      stats.calls++;
    }
    next();
  };
}

/**
 * Get stats for a specific limiter
 * @param {string} name - Limiter name
 * @returns {Object|null} - Stats object or null if not found
 */
export function getLimiterStats(name) {
  return limiterStats.get(name) || null;
}

/**
 * Get stats for all limiters
 * @returns {Object} - Map of limiter name to stats
 */
export function getAllLimiterStats() {
  const result = {};
  for (const [name, stats] of limiterStats) {
    result[name] = { ...stats };
  }
  return result;
}

/**
 * Reset stats for a specific limiter
 * @param {string} name - Limiter name
 */
export function resetLimiterStats(name) {
  const stats = limiterStats.get(name);
  if (stats) {
    stats.calls = 0;
    stats.blocked = 0;
    stats.lastReset = Date.now();
  }
}

/**
 * Reset stats for all limiters
 */
export function resetAllLimiterStats() {
  for (const stats of limiterStats.values()) {
    stats.calls = 0;
    stats.blocked = 0;
    stats.lastReset = Date.now();
  }
}

/**
 * Check if rate limiting is currently enabled
 * @returns {boolean}
 */
export function isRateLimitingEnabled() {
  return shouldEnableRateLimiting();
}

/**
 * Reset all rate limiter stores (clears hit counts)
 * Only available in non-production environments
 * @returns {boolean} - True if reset was performed
 */
export async function resetAllRateLimiters() {
  if (isProduction) {
    console.warn('Rate limiter reset is not available in production');
    return false;
  }

  for (const [name, limiter] of limiterInstances) {
    try {
      // express-rate-limit stores have a resetAll method
      if (limiter.resetKey) {
        // For newer versions, we need to reset all keys
        // The limiter doesn't expose a resetAll directly, but we can access the store
        const store = limiter.options?.store;
        if (store && typeof store.resetAll === 'function') {
          await store.resetAll();
        }
      }
    } catch (err) {
      console.warn(`Failed to reset limiter ${name}:`, err.message);
    }

    // Also reset our stats tracking
    const stats = limiterStats.get(name);
    if (stats) {
      stats.calls = 0;
      stats.blocked = 0;
      stats.lastReset = Date.now();
    }
  }

  return true;
}

/**
 * Initialize Redis store for rate limiting
 * Call this during server startup to ensure Redis is ready
 * @returns {Promise<boolean>} - True if Redis store was initialized
 */
export async function initializeRateLimiterStore() {
  if (redisStorePromise) {
    await redisStorePromise;
  } else {
    await getRedisStore();
  }
  return !!redisStore;
}

/**
 * Check if rate limiting is using Redis
 * @returns {boolean}
 */
export function isUsingRedisStore() {
  return !!redisStore;
}

// Export environment detection for use in other modules
export { isTest, isDev, isProduction, testRateLimitsEnabled };

// Export test bypass constants for test utilities
export { TEST_BYPASS_HEADER, TEST_BYPASS_SECRET };
