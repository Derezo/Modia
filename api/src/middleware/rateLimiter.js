const rateLimit = require('express-rate-limit');

// Skip rate limiting in test environment
const isTest = process.env.NODE_ENV === 'test';

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
  max: isTest ? 0 : parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // 0 = unlimited in test
  skip: () => isTest,
  message: {
    error: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 0 : 10, // 0 = unlimited in test, 10 attempts per 15 minutes in production
  skip: () => isTest,
  message: {
    error: 'Too many login attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { rateLimiter, authLimiter };
