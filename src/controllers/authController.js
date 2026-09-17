const db = require('../config/database');
const userModel = require('../models/userModel');
const { generateToken } = require('../utils/jwt');
const { validatePhoneNumber, normalizePhone, validateUsername, validatePasswordStrength } = require('../utils/validation');

// Register Controller
const register = (req, res) => {
  const { telegram_id, phone_number, username, password } = req.body;

  // Validation
  if (!telegram_id || !phone_number || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!validatePhoneNumber(phone_number)) {
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters (alphanumeric and underscore)' });
  }

  if (!validatePasswordStrength(password)) {
    return res.status(400).json({ 
      error: 'Password is not strong enough',
      requirements: {
        minLength: 8,
        needs: [
          'At least one uppercase letter',
          'At least one lowercase letter',
          'At least one number',
          'At least one special character (@$!%*?&)'
        ]
      }
    });
  }

  userModel.getUserByTelegramId(telegram_id, (lookupErr, existingUser) => {
    if (lookupErr) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingUser) {
      const token = generateToken(existingUser.id, existingUser.telegram_id);
      return res.json({
        success: true,
        message: 'User already registered',
        userId: existingUser.id,
        token,
        expiresIn: '24h',
        existing: true
      });
    }

    const normalizedPhone = normalizePhone(phone_number);
    userModel.createUser(telegram_id, normalizedPhone, username, password, (err, userId) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Registration failed' });
      }

      // Generate JWT token
      const token = generateToken(userId, telegram_id);

      res.json({
        success: true,
        message: 'User registered',
        userId: userId,
        token: token,
        expiresIn: '24h'
      });
    });
  });
};

// Login Controller
const login = (req, res) => {
  const { telegram_id, username, password } = req.body;

  if (!telegram_id || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  userModel.getUserByTelegramId(telegram_id, (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.username !== username) {
      return res.status(401).json({ error: 'Username does not match' });
    }

    if (!userModel.verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate JWT token
    const token = generateToken(user.id, telegram_id);

    res.json({
      success: true,
      message: 'Login successful',
      userId: user.id,
      username: user.username,
      token: token,
      expiresIn: '24h'
    });
  });
};

module.exports = {
  register,
  login
};
