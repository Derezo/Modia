import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  learnSkillWithClient,
  validateSkillLearningLevels
} from '../../routes/skills.js';

function createTrainingHarness({
  experience = 1000,
  spentXP = 0,
  skills = {}
} = {}) {
  const state = {
    character: {
      id: 17,
      class: 'wizard',
      race: 'human',
      experience,
      level: 1,
      spent_xp: spentXP,
      strength: 5,
      intelligence: 10,
      agility: 5,
      vitality: 5,
      luck: 5,
      hp_current: 100,
      mp_current: 100,
      hp_max: 100,
      mp_max: 100
    },
    skills: new Map(Object.entries(skills)),
    queries: []
  };

  let lockTail = Promise.resolve();

  function createClient() {
    let releaseCharacterLock = null;

    return {
      async query(sql, params) {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        state.queries.push({ sql: normalized, params });

        if (normalized.startsWith('SELECT id, class, race, experience')) {
          const previousLock = lockTail;
          lockTail = new Promise(resolve => {
            releaseCharacterLock = resolve;
          });
          await previousLock;

          if (params[0] !== state.character.id || params[1] !== 91) {
            return { rows: [] };
          }
          return { rows: [{ ...state.character }] };
        }

        if (normalized.startsWith('SELECT skill_id, level')) {
          const relevantIds = new Set(params[1]);
          return {
            rows: [...state.skills.entries()]
              .filter(([skillId]) => relevantIds.has(skillId))
              .map(([skillId, level]) => ({ skill_id: skillId, level }))
          };
        }

        if (normalized.startsWith('UPDATE characters')) {
          state.character = {
            ...state.character,
            experience: params[0],
            spent_xp: params[1],
            level: params[2],
            strength: state.character.strength + params[3],
            intelligence: state.character.intelligence + params[4],
            agility: state.character.agility + params[5],
            vitality: state.character.vitality + params[6],
            luck: state.character.luck + params[7],
            hp_max: params[8],
            mp_max: params[9],
            hp_current: params[10],
            mp_current: params[11]
          };
          return { rows: [{ ...state.character }] };
        }

        if (normalized.startsWith('INSERT INTO character_skills')) {
          const currentLevel = state.skills.get(params[1]) || 0;
          const newLevel = currentLevel + params[2];
          state.skills.set(params[1], newLevel);
          return { rows: [{ level: newLevel }] };
        }

        throw new Error(`Unexpected SQL: ${normalized}`);
      },

      release() {
        releaseCharacterLock?.();
      }
    };
  }

  return {
    state,
    async learn(options = {}) {
      const client = createClient();
      try {
        return await learnSkillWithClient(client, {
          characterId: 17,
          userId: 91,
          skillId: 'fireball',
          levels: 1,
          ...options
        });
      } finally {
        client.release();
      }
    }
  };
}

describe('Training Grounds skill learning hardening', () => {
  it('rejects non-positive, fractional, unsafe, and non-numeric level counts', () => {
    const invalidLevels = [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
      null
    ];

    for (const levels of invalidLevels) {
      assert.throws(
        () => validateSkillLearningLevels(levels),
        error => error.statusCode === 400 &&
          error.message === 'Levels must be a positive safe integer'
      );
    }

    assert.equal(validateSkillLearningLevels(1), 1);
  });

  it('serializes concurrent learning so both XP costs and increments are retained', async () => {
    const harness = createTrainingHarness();

    const results = await Promise.all([
      harness.learn(),
      harness.learn()
    ]);

    assert.deepEqual(results.map(result => result.newLevel).sort((a, b) => a - b), [1, 2]);
    assert.deepEqual(results.map(result => result.totalCost).sort((a, b) => a - b), [50, 141]);
    assert.equal(harness.state.skills.get('fireball'), 2);
    assert.equal(harness.state.character.experience, 809);
    assert.equal(harness.state.character.spent_xp, 191);

    const characterReads = harness.state.queries
      .filter(entry => entry.sql.startsWith('SELECT id, class, race, experience'));
    assert.equal(characterReads.length, 2);
    assert.ok(characterReads.every(entry => entry.sql.endsWith('FOR UPDATE')));

    const skillReads = harness.state.queries
      .filter(entry => entry.sql.startsWith('SELECT skill_id, level'));
    assert.equal(skillReads.length, 2);
    assert.ok(skillReads.every(entry => entry.sql.endsWith('FOR UPDATE')));

    const upserts = harness.state.queries
      .filter(entry => entry.sql.startsWith('INSERT INTO character_skills'));
    assert.ok(upserts.every(entry =>
      entry.sql.includes('character_skills.level + EXCLUDED.level')
    ));
  });

  it('does not let a queued concurrent request spend XP that is no longer available', async () => {
    const harness = createTrainingHarness({ experience: 100 });

    const results = await Promise.allSettled([
      harness.learn(),
      harness.learn()
    ]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.statusCode, 400);
    assert.equal(rejected.reason.message, 'Not enough XP. Need 141, have 50');
    assert.equal(harness.state.skills.get('fireball'), 1);
    assert.equal(harness.state.character.experience, 50);
    assert.equal(harness.state.character.spent_xp, 50);
  });

  it('checks prerequisites from the locked skill state before spending XP', async () => {
    const harness = createTrainingHarness({
      skills: { fireball: 4 }
    });

    await assert.rejects(
      harness.learn({ skillId: 'inferno' }),
      error => error.statusCode === 400 &&
        error.message === 'Requires fireball at level 5'
    );

    assert.equal(harness.state.character.experience, 1000);
    assert.equal(harness.state.skills.has('inferno'), false);
    assert.deepEqual(harness.state.queries[1].params[1], ['inferno', 'fireball']);
    assert.ok(harness.state.queries[0].sql.endsWith('FOR UPDATE'));
    assert.ok(harness.state.queries[1].sql.endsWith('FOR UPDATE'));
  });
});
