// Name generator for procedural recruit names
// Uses race and gender to select from appropriate name pools

const { NAME_POOLS } = require('../../../shared/nameData');
const { RACES, GENDERS, SeededRandom } = require('../../../shared/constants');

/**
 * Generate a random name based on race and gender
 *
 * @param {string} race - Character race (human, elf, dwarf, vampire, orc)
 * @param {string} gender - Character gender (male, female, other)
 * @param {SeededRandom|null} rng - Optional seeded random generator for deterministic results
 * @returns {string} A randomly selected name appropriate for the race and gender
 */
function generateName(race, gender, rng = null) {
  // Validate race
  const validRaces = Object.values(RACES);
  if (!validRaces.includes(race)) {
    throw new Error(`Invalid race: ${race}. Valid races are: ${validRaces.join(', ')}`);
  }

  // Validate gender
  const validGenders = Object.values(GENDERS);
  if (!validGenders.includes(gender)) {
    throw new Error(`Invalid gender: ${gender}. Valid genders are: ${validGenders.join(', ')}`);
  }

  // Get name pools for this race
  const racePools = NAME_POOLS[race];
  if (!racePools) {
    throw new Error(`No name pool found for race: ${race}`);
  }

  // Build the candidate pool based on gender
  let candidatePool = [];

  switch (gender) {
    case GENDERS.MALE:
      // Male characters draw from male + unisex pools
      candidatePool = [...racePools.male, ...racePools.unisex];
      break;
    case GENDERS.FEMALE:
      // Female characters draw from female + unisex pools
      candidatePool = [...racePools.female, ...racePools.unisex];
      break;
    case GENDERS.OTHER:
      // Other gender draws from unisex pool only
      candidatePool = [...racePools.unisex];
      break;
    default:
      // Fallback to unisex if somehow we get here
      candidatePool = [...racePools.unisex];
  }

  if (candidatePool.length === 0) {
    throw new Error(`No names available for race: ${race}, gender: ${gender}`);
  }

  // Select a random name using provided RNG or Math.random
  if (rng && typeof rng.pick === 'function') {
    return rng.pick(candidatePool);
  } else {
    const index = Math.floor(Math.random() * candidatePool.length);
    return candidatePool[index];
  }
}

/**
 * Generate multiple unique names for a given race and gender
 *
 * @param {string} race - Character race
 * @param {string} gender - Character gender
 * @param {number} count - Number of unique names to generate
 * @param {SeededRandom|null} rng - Optional seeded random generator
 * @returns {string[]} Array of unique names
 */
function generateUniqueNames(race, gender, count, rng = null) {
  // Get the candidate pool size first
  const validRaces = Object.values(RACES);
  const validGenders = Object.values(GENDERS);

  if (!validRaces.includes(race) || !validGenders.includes(gender)) {
    return []; // Let generateName throw the proper error
  }

  const racePools = NAME_POOLS[race];
  let poolSize = 0;

  switch (gender) {
    case GENDERS.MALE:
      poolSize = racePools.male.length + racePools.unisex.length;
      break;
    case GENDERS.FEMALE:
      poolSize = racePools.female.length + racePools.unisex.length;
      break;
    case GENDERS.OTHER:
      poolSize = racePools.unisex.length;
      break;
  }

  // Can't generate more unique names than available
  const maxCount = Math.min(count, poolSize);
  const names = new Set();

  // Safety limit to prevent infinite loops
  let attempts = 0;
  const maxAttempts = maxCount * 10;

  while (names.size < maxCount && attempts < maxAttempts) {
    const name = generateName(race, gender, rng);
    names.add(name);
    attempts++;
  }

  return Array.from(names);
}

module.exports = {
  generateName,
  generateUniqueNames
};

// Self-test when run directly
if (require.main === module) {
  console.log('=== Name Generator Tests ===\n');

  const testCases = [
    { race: 'human', gender: 'male', label: 'Human Male' },
    { race: 'human', gender: 'female', label: 'Human Female' },
    { race: 'human', gender: 'other', label: 'Human Other' },
    { race: 'elf', gender: 'male', label: 'Elf Male' },
    { race: 'elf', gender: 'female', label: 'Elf Female' },
    { race: 'elf', gender: 'other', label: 'Elf Other' },
    { race: 'dwarf', gender: 'male', label: 'Dwarf Male' },
    { race: 'dwarf', gender: 'female', label: 'Dwarf Female' },
    { race: 'dwarf', gender: 'other', label: 'Dwarf Other' },
    { race: 'vampire', gender: 'male', label: 'Vampire Male' },
    { race: 'vampire', gender: 'female', label: 'Vampire Female' },
    { race: 'vampire', gender: 'other', label: 'Vampire Other' },
    { race: 'orc', gender: 'male', label: 'Orc Male' },
    { race: 'orc', gender: 'female', label: 'Orc Female' },
    { race: 'orc', gender: 'other', label: 'Orc Other' }
  ];

  console.log('--- Random Name Generation ---');
  for (const tc of testCases) {
    const names = [];
    for (let i = 0; i < 3; i++) {
      names.push(generateName(tc.race, tc.gender));
    }
    console.log(`${tc.label}: ${names.join(', ')}`);
  }

  console.log('\n--- Seeded Random (deterministic) ---');
  const seed = 12345;
  const rng1 = new SeededRandom(seed);
  const rng2 = new SeededRandom(seed);

  const seededName1 = generateName('human', 'male', rng1);
  const seededName2 = generateName('human', 'male', rng2);

  console.log(`Same seed (${seed}) produces same name: ${seededName1 === seededName2 ? 'PASS' : 'FAIL'}`);
  console.log(`  Name 1: ${seededName1}`);
  console.log(`  Name 2: ${seededName2}`);

  console.log('\n--- Unique Name Generation ---');
  const uniqueNames = generateUniqueNames('elf', 'other', 5);
  console.log(`5 unique Elf Other names: ${uniqueNames.join(', ')}`);
  console.log(`All unique: ${new Set(uniqueNames).size === uniqueNames.length ? 'PASS' : 'FAIL'}`);

  console.log('\n--- Pool Size Verification ---');
  for (const race of Object.values(RACES)) {
    const pools = NAME_POOLS[race];
    console.log(`${race}: male=${pools.male.length}, female=${pools.female.length}, unisex=${pools.unisex.length}`);
  }

  console.log('\n--- Error Handling ---');
  try {
    generateName('invalid_race', 'male');
    console.log('Invalid race: FAIL (should have thrown)');
  } catch (e) {
    console.log(`Invalid race error: PASS (${e.message})`);
  }

  try {
    generateName('human', 'invalid_gender');
    console.log('Invalid gender: FAIL (should have thrown)');
  } catch (e) {
    console.log(`Invalid gender error: PASS (${e.message})`);
  }

  console.log('\n=== All Tests Complete ===');
}
