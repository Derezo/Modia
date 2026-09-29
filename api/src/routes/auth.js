import express from 'express';
import bcrypt from 'bcrypt';
import { query } from '../config/database.js';
import { generateAccessToken, generateRefreshToken, hashRefreshToken, verifyRefreshToken } from '../config/jwt.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { refreshLimiter } from '../middleware/refreshRateLimiter.js';
import { authenticate } from '../middleware/auth.js';
import { STARTING_GOLD } from '../config/constants.js';
import { validateAndRepairDiscovery, fixOrphanedCharacters } from '../services/world/discoveryValidationService.js';
import { registerUserWithCharacter, validatePassword } from '../services/registrationService.js';

const router = express.Router();

const SALT_ROUNDS = 12;

// POST /api/auth/register
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  // Type checks (Finding 44: non-string input causes 500)
  if (typeof username !== 'string') {
    throw new AppError('Username must be a string', 400);
  }
  if (typeof email !== 'string') {
    throw new AppError('Email must be a string', 400);
  }
  if (typeof password !== 'string') {
    throw new AppError('Password must be a string', 400);
  }

  // Validation
  if (!username || !email || !password) {
    throw new AppError('Username, email, and password are required', 400);
  }

  if (username.length < 3 || username.length > 32) {
    throw new AppError('Username must be between 3 and 32 characters', 400);
  }

  // Password validation (Finding 35: bcrypt truncates at 72 bytes)
  validatePassword(password);

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 400);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user
  const result = await query(
    `INSERT INTO users (username, email, password_hash, gold)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, gold, created_at`,
    [username.toLowerCase(), email.toLowerCase(), passwordHash, STARTING_GOLD]
  );

  const user = result.rows[0];

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.username);
  const refreshToken = generateRefreshToken(user.id);

  // Store sha256 hash of refresh token (Finding 34: bcrypt truncates JWTs at 72 bytes)
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, refreshTokenHash, expiresAt]
  );

  res.status(201).json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      gold: user.gold
    },
    accessToken,
    refreshToken
  });
}));

// POST /api/auth/register-with-character
// Atomic registration: creates user + first character in single transaction
router.post('/register-with-character', authLimiter, asyncHandler(async (req, res) => {
  const { username, email, password, characterName, race, characterClass, gender } = req.body;

  const result = await registerUserWithCharacter({
    username, email, password, characterName, race, characterClass, gender
  });

  res.status(201).json(result);
}));

// POST /api/auth/login
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  // Type checks (Finding 44: non-string input causes 500)
  if (typeof username !== 'string') {
    throw new AppError('Username must be a string', 400);
  }
  if (typeof password !== 'string') {
    throw new AppError('Password must be a string', 400);
  }

  if (!username || !password) {
    throw new AppError('Username and password are required', 400);
  }

  // Find user
  const result = await query(
    `SELECT id, username, email, password_hash, gold, is_banned
     FROM users WHERE username = $1`,
    [username.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid username or password', 401);
  }

  const user = result.rows[0];

  if (user.is_banned) {
    throw new AppError('Account has been banned', 403);
  }

  // Verify password
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new AppError('Invalid username or password', 401);
  }

  // Update last login
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  // Self-healing: Fix orphaned characters and repair discovery state (blocking with timeout)
  // Must complete before login response so frontend fetches correct world data
  try {
    await Promise.race([
      (async () => {
        // First, fix any characters at non-existent nodes
        const orphanResult = await fixOrphanedCharacters(user.id);
        if (orphanResult.fixed.length > 0) {
          console.log(`[Login] Fixed ${orphanResult.fixed.length} orphaned characters for user ${user.id}`);
        }

        // Then, repair discovery state
        await validateAndRepairDiscovery(user.id);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]);
  } catch (err) {
    console.warn(`[Login] Self-healing failed for user ${user.id}:`, err.message);
    // Don't block login on repair failure
  }

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.username);
  const refreshToken = generateRefreshToken(user.id);

  // Store sha256 hash of refresh token (Finding 34: bcrypt truncates JWTs at 72 bytes)
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, refreshTokenHash, expiresAt]
  );

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      gold: user.gold
    },
    accessToken,
    refreshToken
  });
}));

// POST /api/auth/refresh
router.post('/refresh', refreshLimiter, asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  // Type check (Finding 44)
  if (typeof refreshToken !== 'string') {
    throw new AppError('Refresh token must be a string', 400);
  }

  // Verify refresh token signature
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  // Find valid session using sha256 hash (Finding 34: bcrypt truncates JWTs)
  // Use atomic DELETE with RETURNING to prevent race conditions
  const tokenHash = hashRefreshToken(refreshToken);
  const deleteResult = await query(
    `DELETE FROM user_sessions
     WHERE user_id = $1 AND refresh_token_hash = $2 AND expires_at > NOW()
     RETURNING id`,
    [decoded.userId, tokenHash]
  );

  if (deleteResult.rows.length === 0) {
    // Invalid, expired or already-rotated token. Pre-0.5.2 bcrypt sessions are
    // deliberately not accepted (bcrypt truncates JWTs at 72 bytes); migration
    // 067 purges them, so those players log in again once.
    throw new AppError('Invalid or expired refresh token', 401);
  }

  // Get user
  const userResult = await query(
    'SELECT id, username, email, gold FROM users WHERE id = $1',
    [decoded.userId]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = userResult.rows[0];

  // Generate new access token
  const accessToken = generateAccessToken(user.id, user.username);

  // Generate new refresh token (refresh token rotation for security)
  const newRefreshToken = generateRefreshToken(user.id);
  const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Create new session
  await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, newRefreshTokenHash, expiresAt]
  );

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      gold: user.gold
    },
    accessToken,
    refreshToken: newRefreshToken
  });
}));

// POST /api/auth/logout
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    // Invalidate specific session using sha256 hash (Finding 34)
    if (typeof refreshToken !== 'string') {
      throw new AppError('Refresh token must be a string', 400);
    }
    const tokenHash = hashRefreshToken(refreshToken);
    await query(
      'DELETE FROM user_sessions WHERE user_id = $1 AND refresh_token_hash = $2',
      [req.user.userId, tokenHash]
    );
  } else {
    // Invalidate all sessions for user
    await query('DELETE FROM user_sessions WHERE user_id = $1', [req.user.userId]);
  }

  res.json({ message: 'Logged out successfully' });
}));

// GET /api/auth/me
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, username, email, gold, created_at, last_login FROM users WHERE id = $1',
    [req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  res.json({ user: result.rows[0] });
}));

export default router;
