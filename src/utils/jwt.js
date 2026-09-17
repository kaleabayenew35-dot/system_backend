const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
const JWT_EXPIRE = '48h'; // Token expiration time

// Generate JWT Token
const generateToken = (userId, telegramId) => {
  return jwt.sign(
    { userId, telegramId },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

// Verify JWT Token
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, data: decoded };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    return { valid: false, error: 'Invalid token' };
  }
};

// Refresh Token
const refreshToken = (token) => {
  const verified = verifyToken(token);
  if (verified.valid) {
    return generateToken(verified.data.userId, verified.data.telegramId);
  }
  return null;
};

// Decode Token (without verification)
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateToken,
  verifyToken,
  refreshToken,
  decodeToken,
  JWT_EXPIRE
};
