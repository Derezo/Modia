import { createLimiter } from './rateLimiterFactory.js';

// Action spam is most critical - 20/min
// Prevents rapid-fire action submissions
export const actionLimiter = createLimiter({
  name: 'battle:action',
  windowMs: 60 * 1000,
  maxRequests: 10, // Base: 10, actual: 20 prod, 50 dev
  message: 'Too many battle actions. Please wait.'
});

// Battle creation - 10/min
// Prevents battle creation spam
export const startLimiter = createLimiter({
  name: 'battle:start',
  windowMs: 60 * 1000,
  maxRequests: 5, // Base: 5, actual: 10 prod, 25 dev
  message: 'Too many battle starts. Please wait.'
});

// Read operations - 30/min
// More lenient for read-only endpoints (preview, current)
export const readLimiter = createLimiter({
  name: 'battle:read',
  windowMs: 60 * 1000,
  maxRequests: 15, // Base: 15, actual: 30 prod, 75 dev
  message: 'Too many requests. Please wait.'
});

// Rejoin attempts - 10/min
// Prevents reconnection spam
export const rejoinLimiter = createLimiter({
  name: 'battle:rejoin',
  windowMs: 60 * 1000,
  maxRequests: 5, // Base: 5, actual: 10 prod, 25 dev
  message: 'Too many rejoin attempts. Please wait.'
});

// Rewards queries - 20/min
// Post-battle reward fetching
export const rewardsLimiter = createLimiter({
  name: 'battle:rewards',
  windowMs: 60 * 1000,
  maxRequests: 10, // Base: 10, actual: 20 prod, 50 dev
  message: 'Too many reward requests. Please wait.'
});

// State polling - 60/min
// Lightweight endpoint for defensive polling (ETag support reduces actual load)
export const stateLimiter = createLimiter({
  name: 'battle:state',
  windowMs: 60 * 1000,
  maxRequests: 30, // Base: 30, actual: 60 prod, 150 dev
  message: 'Too many state requests. Please wait.'
});
