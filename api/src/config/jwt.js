const jwt = require('jsonwebtoken');

// Security: Fail startup if JWT secrets are not set in production
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('CRITICAL: JWT_SECRET environment variable must be set in production');
}
if (isProduction && !process.env.JWT_REFRESH_SECRET) {
  throw new Error('CRITICAL: JWT_REFRESH_SECRET environment variable must be set in production');
}

// In development/test, use insecure defaults with a warning
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('WARNING: Using insecure default JWT_SECRET. Set JWT_SECRET in production.');
  return 'dev-secret-change-in-production';
})();

const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (() => {
  console.warn('WARNING: Using insecure default JWT_REFRESH_SECRET. Set JWT_REFRESH_SECRET in production.');
  return 'dev-refresh-secret-change-in-production';
})();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const generateAccessToken = (userId, username) => {
  return jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_REFRESH_SECRET);
};

module.exports = {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
