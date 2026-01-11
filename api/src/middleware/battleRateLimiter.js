import rateLimit from 'express-rate-limit';

// Security: Rate limiting is ENABLED by default
// Only explicitly disable in test environment
const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV === 'development';

// Create rate limiter with environment-aware settings
const createLimiter = (windowMs, maxRequests, message) => {
  return rateLimit({
    windowMs,
    max: isTest ? 0 : (isDev ? maxRequests * 5 : maxRequests),
    skip: () => isTest,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Action spam is most critical - 20/min
// Prevents rapid-fire action submissions
export const actionLimiter = createLimiter(
  60 * 1000,
  20,
  'Too many battle actions. Please wait.'
);

// Battle creation - 10/min
// Prevents battle creation spam
export const startLimiter = createLimiter(
  60 * 1000,
  10,
  'Too many battle starts. Please wait.'
);

// Read operations - 30/min
// More lenient for read-only endpoints (preview, current)
export const readLimiter = createLimiter(
  60 * 1000,
  30,
  'Too many requests. Please wait.'
);

// Rejoin attempts - 10/min
// Prevents reconnection spam
export const rejoinLimiter = createLimiter(
  60 * 1000,
  10,
  'Too many rejoin attempts. Please wait.'
);

// Rewards queries - 20/min
// Post-battle reward fetching
export const rewardsLimiter = createLimiter(
  60 * 1000,
  20,
  'Too many reward requests. Please wait.'
);
