const rateLimit = require('express-rate-limit');

// Skip rate limiting in test and development environments
const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// Development: very high limits (essentially unlimited for local dev)
// Production: doubled limits for better UX
const getMaxRequests = (prodDefault) => {
  if (isTest || isDev) return 0; // 0 = unlimited
  return parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || String(prodDefault * 2));
};

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
  max: getMaxRequests(100), // 200/min in production, unlimited in dev/test
  skip: () => isTest || isDev,
  message: {
    error: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest || isDev ? 0 : 20, // 20 attempts per 15 minutes in production (doubled)
  skip: () => isTest || isDev,
  message: {
    error: 'Too many login attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { rateLimiter, authLimiter };
