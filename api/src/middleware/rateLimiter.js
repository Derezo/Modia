import { createLimiter } from './rateLimiterFactory.js';

// Global rate limiter for all API routes
// Production: 200/min, Development: 500/min, Test: disabled (unless TEST_RATE_LIMITS=true)
const rateLimiter = createLimiter({
  name: 'global',
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  maxRequests: 100, // Base: 100, actual: 200 prod, 500 dev
  message: 'Too many requests, please try again later.'
});

// Stricter limiter for auth endpoints (login, register)
// Production: 20 attempts/15min, Development: 100 attempts, Test: disabled
const authLimiter = createLimiter({
  name: 'auth',
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10, // Base: 10, actual: 20 prod, 50 dev
  message: 'Too many login attempts, please try again later.'
});

export { rateLimiter, authLimiter };
