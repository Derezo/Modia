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
import { generateAccessToken, generateRefreshToken } from '../config/jwt.js';
import { calculateStats, STARTING_EXPERIENCE, RACES, CLASSES, GENDERS } from '../config/constants.js';
import { STARTING_GOLD } from '../config/constants.js';
import { STARTING_CONSUMABLES } from '../../../shared/constants.js';
import { discoverNodeAndAdjacent } from './world/discoveryService.js';

const SALT_ROUNDS = 12;

// Starter equipment by class (weapon, armor, accessory)
const STARTER_EQUIPMENT = {
  warrior: ['Trainee Sword', 'Trainee Tunic', 'Warrior\'s Pendant'],
  wizard: ['Novice Wand', 'Student Robe', 'Mage\'s Crystal'],
  monk: ['Initiate Wraps', 'Initiate Gi', 'Monk\'s Beads'],
  chemist: ['Mixing Rod', 'Alchemist Coat', 'Reagent Pouch']
};

// Starter skills by class (first skill in each class tree)
const STARTER_SKILLS = {
  warrior: ['power_strike'],
  wizard: ['fireball'],
  monk: ['palm_strike'],
  chemist: ['brew_potion']
};

/**
 * Validates registration input data
 * @throws {Error} If validation fails
 */
function validateInput({ username, email, password, characterName, race, characterClass, gender }) {
  // Username validation
  if (!username || typeof username !== 'string') {
    throw new Error('Username is required');
  }
  if (username.length < 3 || username.length > 32) {
    throw new Error('Username must be between 3 and 32 characters');
  }

  // Email validation
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Password validation
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // Character name validation
  if (!characterName || typeof characterName !== 'string') {
    throw new Error('Character name is required');
  }
  if (characterName.length < 2 || characterName.length > 24) {
    throw new Error('Character name must be between 2 and 24 characters');
  }

  // Race validation
  if (!Object.values(RACES).includes(race)) {
    throw new Error(`Invalid race. Must be one of: ${Object.values(RACES).join(', ')}`);
  }

  // Class validation
  if (!Object.values(CLASSES).includes(characterClass)) {
    throw new Error(`Invalid class. Must be one of: ${Object.values(CLASSES).join(', ')}`);
  }

  // Gender validation (optional, defaults to 'other')
  if (gender && !Object.values(GENDERS).includes(gender)) {
    throw new Error(`Invalid gender. Must be one of: ${Object.values(GENDERS).join(', ')}`);
  }
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
  characterName,
  race,
  characterClass,
  gender = 'other'
}) {
  // Validate all inputs before starting transaction
  validateInput({ username, email, password, characterName, race, characterClass, gender });

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
        throw new Error('Username already exists');
      }
      throw new Error('Email already exists');
    }

    // Insert user
    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, gold)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, gold, created_at`,
      [normalizedUsername, normalizedEmail, passwordHash, STARTING_GOLD]
    );
    const user = userResult.rows[0];

    // Calculate initial stats
    const stats = calculateStats(race, characterClass, 1);

    // Get spawn location (race's homeland castle)
    const regionResult = await client.query(
      'SELECT id, castle_node_id FROM world_regions WHERE race = $1',
      [race]
    );

    if (regionResult.rows.length === 0) {
      throw new Error('Invalid race for spawn location');
    }

    const region = regionResult.rows[0];
    const spawnNodeId = region.castle_node_id;
    const homeRegionId = region.id;

    if (!spawnNodeId) {
      throw new Error('Unable to determine spawn location');
    }

    // Insert character with party_slot=1 (first character is always party leader)
    const characterResult = await client.query(
      `INSERT INTO characters (
         user_id, name, race, class, gender, level, experience,
         hp_current, hp_max, mp_current, mp_max,
         strength, intelligence, agility, vitality, luck,
         party_slot, current_node_id, home_region_id
       )
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $7, $8, $8, $9, $10, $11, $12, $13, 1, $14, $15)
       RETURNING *`,
      [
        user.id, characterName, race, characterClass, gender,
        STARTING_EXPERIENCE,
        stats.hpMax, stats.mpMax,
        stats.strength, stats.intelligence, stats.agility, stats.vitality, stats.luck,
        spawnNodeId, homeRegionId
      ]
    );
    const character = characterResult.rows[0];

    // Grant starter equipment
    const starterItems = STARTER_EQUIPMENT[characterClass];
    if (starterItems) {
      for (const itemName of starterItems) {
        await client.query(
          `INSERT INTO character_items (character_id, item_template_id, quantity, is_equipped, equipped_slot)
           SELECT $1, id, 1, true, equipment_slot
           FROM item_templates WHERE name = $2`,
          [character.id, itemName]
        );
      }
    }

    // Grant starter skills
    const starterSkills = STARTER_SKILLS[characterClass];
    if (starterSkills) {
      for (const skillId of starterSkills) {
        await client.query(
          `INSERT INTO character_skills (character_id, skill_id, level)
           VALUES ($1, $2, 1)
           ON CONFLICT (character_id, skill_id) DO NOTHING`,
          [character.id, skillId]
        );
      }
    }

    // Grant starting consumables to shared inventory (character_id NULL)
    for (const { templateId, quantity } of STARTING_CONSUMABLES) {
      await client.query(
        `INSERT INTO character_items (user_id, character_id, item_template_id, quantity, is_equipped)
         VALUES ($1, NULL, $2, $3, false)`,
        [user.id, templateId, quantity]
      );
    }

    // Grant starting trait based on race/class combination
    const startingTraitResult = await client.query(
      'SELECT trait_id FROM starting_trait_mappings WHERE race = $1 AND class = $2',
      [race, characterClass]
    );

    if (startingTraitResult.rows.length > 0) {
      const traitId = startingTraitResult.rows[0].trait_id;
      await client.query(
        `INSERT INTO character_traits (character_id, trait_id)
         VALUES ($1, $2)
         ON CONFLICT (character_id, trait_id) DO NOTHING`,
        [character.id, traitId]
      );
    }

    // Initialize node discovery (pass client for transaction)
    await discoverNodeAndAdjacent(user.id, spawnNodeId, client);

    // Generate JWT tokens
    const accessToken = generateAccessToken(user.id, user.username);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token hash in session
    const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
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
