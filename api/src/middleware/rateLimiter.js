import { createLimiter } from './rateLimiterFactory.js';

// Global rate limiter for all API routes
// Games need higher limits than typical web apps due to frequent interactions
// Production: 600/min, Development: 1500/min, Test: disabled (unless TEST_RATE_LIMITS=true)
// Uses per-user keying for authenticated requests (falls back to IP for unauthenticated)
const rateLimiter = createLimiter({
  name: 'global',
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  maxRequests: 300, // Base: 300, actual: 600 prod, 1500 dev
  message: 'Too many requests, please try again later.',
  useUserKey: true // Per-user limiting for authenticated requests
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
