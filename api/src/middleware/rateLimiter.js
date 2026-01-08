const rateLimit = require('express-rate-limit');

// Security: Rate limiting is ENABLED by default
// Only explicitly disable in test environment
// In development, use higher limits but still enforce them
const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production' || (!isTest && !isDev);

// Log a warning if NODE_ENV is not set (defaults to production-like behavior)
if (!process.env.NODE_ENV) {
  console.warn('WARNING: NODE_ENV not set. Rate limiting is enabled. Set NODE_ENV=development for higher limits.');
}

// Get rate limit based on environment
// Test: unlimited (for running automated tests)
// Development: high but not unlimited (500/min) - catches bugs without being annoying
// Production: standard limits (200/min)
const getMaxRequests = (prodDefault) => {
  if (isTest) return 0; // 0 = unlimited in test only
  if (isDev) return parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || String(prodDefault * 5), 10); // 5x in dev
  return parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || String(prodDefault * 2), 10); // 2x in prod
};

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  max: getMaxRequests(100), // 200/min prod, 500/min dev, unlimited test
  skip: () => isTest, // Only skip in test environment
  message: {
    error: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for auth endpoints
// Test: unlimited, Dev: 100 attempts, Prod: 20 attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 0 : (isDev ? 100 : 20),
  skip: () => isTest,
  message: {
    error: 'Too many login attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { rateLimiter, authLimiter };
