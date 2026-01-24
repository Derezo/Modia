/**
 * Redis Configuration
 *
 * Provides Redis client for rate limiting and other caching needs.
 * Gracefully falls back to null if Redis is unavailable.
 *
 * Set REDIS_URL environment variable to enable Redis:
 *   REDIS_URL=redis://localhost:6379
 *   REDIS_URL=redis://:password@host:port
 */

import { createClient } from 'redis';

// Redis client singleton
let redisClient = null;
let connectionPromise = null;
let isConnected = false;
let connectionAttempted = false;

/**
 * Get or create Redis client
 * Returns null if REDIS_URL is not set
 * @returns {Promise<import('redis').RedisClientType|null>}
 */
export async function getRedisClient() {
  // If no REDIS_URL, don't try to connect
  if (!process.env.REDIS_URL) {
    return null;
  }

  // Return existing client if connected
  if (redisClient && isConnected) {
    return redisClient;
  }

  // Return in-progress connection promise if one exists
  if (connectionPromise) {
    return connectionPromise;
  }

  // Don't retry if we already failed
  if (connectionAttempted && !isConnected) {
    return null;
  }

  connectionAttempted = true;

  // Create new connection
  connectionPromise = (async () => {
    try {
      redisClient = createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => {
            // Stop retrying after 3 attempts
            if (retries > 3) {
              console.warn('[Redis] Max reconnection attempts reached, giving up');
              return false;
            }
            // Exponential backoff: 100ms, 200ms, 400ms
            return Math.min(retries * 100, 400);
          },
          connectTimeout: 5000
        }
      });

      // Set up event handlers
      redisClient.on('error', (err) => {
        if (isConnected) {
          console.warn('[Redis] Connection error:', err.message);
        }
        isConnected = false;
      });

      redisClient.on('ready', () => {
        console.log('[Redis] Connected successfully');
        isConnected = true;
      });

      redisClient.on('end', () => {
        console.log('[Redis] Connection closed');
        isConnected = false;
      });

      await redisClient.connect();
      return redisClient;
    } catch (err) {
      console.warn('[Redis] Failed to connect:', err.message);
      console.warn('[Redis] Falling back to in-memory rate limiting');
      redisClient = null;
      isConnected = false;
      return null;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

/**
 * Check if Redis is connected
 * @returns {boolean}
 */
export function isRedisConnected() {
  return isConnected;
}

/**
 * Check if Redis is configured (REDIS_URL is set)
 * @returns {boolean}
 */
export function isRedisConfigured() {
  return !!process.env.REDIS_URL;
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection() {
  if (redisClient && isConnected) {
    try {
      await redisClient.quit();
      console.log('[Redis] Connection closed gracefully');
    } catch (err) {
      console.warn('[Redis] Error closing connection:', err.message);
    }
    redisClient = null;
    isConnected = false;
    connectionAttempted = false;
  }
}

/**
 * Get Redis client for rate-limit-redis store
 * Returns a sendCommand function compatible with rate-limit-redis
 * @returns {Promise<{sendCommand: Function}|null>}
 */
export async function getRedisClientForRateLimit() {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  // rate-limit-redis expects a client with sendCommand method
  // Modern redis client already has this
  return client;
}

/**
 * Ping Redis to check health
 * @returns {Promise<{healthy: boolean, latencyMs: number|null}>}
 */
export async function pingRedis() {
  const client = await getRedisClient();
  if (!client) {
    return { healthy: false, latencyMs: null };
  }

  try {
    const start = Date.now();
    await client.ping();
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, latencyMs: null };
  }
}

// Export for direct access in tests
export { redisClient };
