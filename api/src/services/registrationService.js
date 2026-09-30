/**
 * @module registrationService
 * @description Handles atomic user + character creation in a single database transaction.
 *
 * This service ensures all registration operations succeed together or fail together:
 * - User creation with password hashing
 * - Character creation with starter equipment/skills/traits
 * - Node discovery initialization
 * - Session token generation
 */

import bcrypt from 'bcrypt';
import { withTransaction } from '../config/database.js';
import { generateAccessToken, generateRefreshToken, hashRefreshToken } from '../config/jwt.js';
import { RACES, CLASSES, GENDERS } from '../config/constants.js';
import { STARTING_GOLD } from '../config/constants.js';
import { createFirstCharacterWithClient } from './firstCharacterService.js';
import { validateCharacterNameResult } from '../utils/nameValidation.js';
import { AppError } from '../middleware/errorHandler.js';

const SALT_ROUNDS = 12;

/**
 * Validates a password meets security requirements.
 * @param {string} password - The password to validate
 * @throws {AppError} 400 error if validation fails
 *
 * Finding 35: bcrypt silently truncates input at 72 bytes, so a password
 * longer than 72 UTF-8 bytes would have its suffix ignored. Reject such
 * passwords at registration with a clear error.
 */
export function validatePassword(password) {
  if (typeof password !== 'string') {
    throw new AppError('Password must be a string', 400);
  }
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }
  const byteLength = Buffer.byteLength(password, 'utf8');
  if (byteLength > 72) {
    throw new AppError('Password exceeds maximum length (72 bytes)', 400);
  }
}

/**
 * Validates registration input data
 * @throws {AppError} 400 error if validation fails
 * @returns {string} The validated and trimmed character name
 */
function validateInput({ username, email, password, characterName, race, characterClass, gender }) {
  // Username validation
  if (!username || typeof username !== 'string') {
    throw new AppError('Username is required', 400);
  }
  if (username.length < 3 || username.length > 32) {
    throw new AppError('Username must be between 3 and 32 characters', 400);
  }

  // Email validation
  if (!email || typeof email !== 'string') {
    throw new AppError('Email is required', 400);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 400);
  }

  // Password validation (Finding 35: bcrypt truncates at 72 bytes)
  if (!password) {
    throw new AppError('Password is required', 400);
  }
  validatePassword(password);

  // Character name validation (defense-in-depth for XSS prevention)
  const nameResult = validateCharacterNameResult(characterName);
  if (!nameResult.valid) {
    throw new AppError(nameResult.error, 400);
  }
  const validatedCharacterName = nameResult.value;

  // Race validation
  if (!Object.values(RACES).includes(race)) {
    throw new AppError(`Invalid race. Must be one of: ${Object.values(RACES).join(', ')}`, 400);
  }

  // Class validation
  if (!Object.values(CLASSES).includes(characterClass)) {
    throw new AppError(`Invalid class. Must be one of: ${Object.values(CLASSES).join(', ')}`, 400);
  }

  // Gender validation (optional, defaults to 'other')
  if (gender && !Object.values(GENDERS).includes(gender)) {
    throw new AppError(`Invalid gender. Must be one of: ${Object.values(GENDERS).join(', ')}`, 400);
  }

  return validatedCharacterName;
}

/**
 * Register a new user with their first character in a single atomic transaction.
 *
 * @param {Object} params - Registration parameters
 * @param {string} params.username - User's username (3-32 chars)
 * @param {string} params.email - User's email address
 * @param {string} params.password - User's password (8+ chars)
 * @param {string} params.characterName - Character name (2-24 chars)
 * @param {string} params.race - Character race (human, elf, dwarf, vampire, orc)
 * @param {string} params.characterClass - Character class (warrior, wizard, monk, chemist)
 * @param {string} [params.gender='other'] - Character gender
 * @returns {Promise<{user: Object, character: Object, accessToken: string, refreshToken: string}>}
 * @throws {Error} Validation or uniqueness errors
 */
export async function registerUserWithCharacter({
  username,
  email,
  password,
  characterName: rawCharacterName,
  race,
  characterClass,
  gender = 'other'
}) {
  // Validate all inputs before starting transaction
  // validateInput returns the trimmed/validated character name
  const characterName = validateInput({ username, email, password, characterName: rawCharacterName, race, characterClass, gender });

  // Hash password before transaction (CPU-intensive, don't hold transaction open)
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  return withTransaction(async (client) => {
    const normalizedUsername = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();

    // Check username/email uniqueness
    const existingUser = await client.query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $2',
      [normalizedUsername, normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      const existing = existingUser.rows[0];
      if (existing.username === normalizedUsername) {
        throw new AppError('Username already exists', 409);
      }
      throw new AppError('Email already exists', 409);
    }

    // Insert user
    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, gold)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, gold, created_at`,
      [normalizedUsername, normalizedEmail, passwordHash, STARTING_GOLD]
    );
    const user = userResult.rows[0];

    const character = await createFirstCharacterWithClient(client, {
      userId: user.id,
      name: characterName,
      race,
      characterClass,
      gender
    });

    // Generate JWT tokens
    const accessToken = generateAccessToken(user.id, user.username);
    const refreshToken = generateRefreshToken(user.id);

    // Store sha256 hash of refresh token (Finding 34: bcrypt truncates JWTs)
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await client.query(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshTokenHash, expiresAt]
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        gold: user.gold
      },
      character,
      accessToken,
      refreshToken
    };
  });
}
