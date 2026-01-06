require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const http = require('http');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

// Simple HTTP client for testing
async function request(method, path, body = null, token = null) {
  const url = new URL(path, BASE_URL);

  const headers = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Generate unique test data
function uniqueUsername() {
  return `testuser_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
}

// Create and authenticate a test user
async function createTestUser() {
  const username = uniqueUsername();
  const email = uniqueEmail();
  const password = 'TestPassword123!';

  const res = await request('POST', '/api/auth/register', {
    username,
    email,
    password
  });

  if (res.status !== 201) {
    throw new Error(`Failed to create test user: ${JSON.stringify(res.body)}`);
  }

  return {
    userId: res.body.user.id,
    username,
    email,
    password,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken
  };
}

// Create a test character for a user
async function createTestCharacter(token, name = null) {
  const charName = name || `TestChar_${Date.now()}`;
  const races = ['human', 'elf', 'dwarf', 'orc'];
  const classes = ['warrior', 'wizard', 'monk', 'chemist'];

  const res = await request('POST', '/api/characters', {
    name: charName,
    race: races[Math.floor(Math.random() * races.length)],
    characterClass: classes[Math.floor(Math.random() * classes.length)]
  }, token);

  if (res.status !== 201) {
    throw new Error(`Failed to create test character: ${JSON.stringify(res.body)}`);
  }

  return res.body.character;
}

module.exports = {
  request,
  uniqueUsername,
  uniqueEmail,
  createTestUser,
  createTestCharacter,
  BASE_URL
};
