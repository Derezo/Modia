import express from 'express';
import bcrypt from 'bcrypt';
import { query } from '../config/database.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../config/jwt.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { authenticate } from '../middleware/auth.js';
import { STARTING_GOLD } from '../config/constants.js';

const router = express.Router();

const SALT_ROUNDS = 12;

// POST /api/auth/register
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  // Validation
  if (!username || !email || !password) {
    throw new AppError('Username, email, and password are required', 400);
  }

  if (username.length < 3 || username.length > 32) {
    throw new AppError('Username must be between 3 and 32 characters', 400);
  }

  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

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

  // Store refresh token hash
  const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
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

// POST /api/auth/login
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body;

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

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.username);
  const refreshToken = generateRefreshToken(user.id);

  // Store refresh token hash
  const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
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
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  // Verify refresh token
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  // Find valid session
  const sessionsResult = await query(
    `SELECT id, refresh_token_hash FROM user_sessions
     WHERE user_id = $1 AND expires_at > NOW()`,
    [decoded.userId]
  );

  let validSession = null;
  for (const session of sessionsResult.rows) {
    const valid = await bcrypt.compare(refreshToken, session.refresh_token_hash);
    if (valid) {
      validSession = session;
      break;
    }
  }

  if (!validSession) {
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
  const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Delete old session and create new one
  await query('DELETE FROM user_sessions WHERE id = $1', [validSession.id]);
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
    // Invalidate specific session
    const sessionsResult = await query(
      `SELECT id, refresh_token_hash FROM user_sessions WHERE user_id = $1`,
      [req.user.userId]
    );

    for (const session of sessionsResult.rows) {
      const valid = await bcrypt.compare(refreshToken, session.refresh_token_hash);
      if (valid) {
        await query('DELETE FROM user_sessions WHERE id = $1', [session.id]);
        break;
      }
    }
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
