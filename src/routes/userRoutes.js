const express = require('express');
const router = express.Router();
const userModel = require('../models/userModel');
const { register, login } = require('../controllers/authController');
const { verifyTokenMiddleware } = require('../middleware/authMiddleware');
const { validateUsername, validatePasswordStrength } = require('../utils/validation');

// Auto-login by telegram_id only (session re-auth — no password needed)
router.post('/auto-login', (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

  const db = require('../config/database');
  const { generateToken } = require('../utils/jwt');

  db.get(`SELECT * FROM users WHERE telegram_id = ?`, [String(telegram_id)], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const token = generateToken(user.id, user.telegram_id);
    res.json({
      success: true,
      token,
      userId: user.id,
      username: user.username,
    });
  });
});

// Register new user
router.post('/register', register);

// Login user
router.post('/login', login);

// Check if user exists by telegram ID
router.get('/check/:telegram_id', (req, res) => {
  const { telegram_id } = req.params;

  userModel.getUserByTelegramId(telegram_id, (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (user) {
      res.json({ exists: true, user: { id: user.id, username: user.username } });
    } else {
      res.json({ exists: false });
    }
  });
});

// Get user by ID (protected)
router.get('/:id', verifyTokenMiddleware, (req, res) => {
  const { id } = req.params;

  userModel.getUserById(id, (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (user) {
      res.json({ success: true, user: { id: user.id, username: user.username, phone_number: user.phone_number } });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });
});

// Get user balance (protected)
router.get('/:id/balance', verifyTokenMiddleware, (req, res) => {
  const { id } = req.params;

  userModel.getUserBalance(id, (err, balance) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    // Always return a balance object — use 0 if no record exists yet
    res.json({
      success: true,
      balance: balance || { user_id: Number(id), balance: 0, coins: 0 }
    });
  });
});

// Update username (protected)
router.put('/:id/username', verifyTokenMiddleware, (req, res) => {
  const { id } = req.params;
  const { username } = req.body;

  if (!req.user || req.user.userId !== Number(id)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters (alphanumeric and underscore)' });
  }

  userModel.updateUsername(id, username, (err) => {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      return res.status(500).json({ error: 'Failed to update username' });
    }

    res.json({ success: true, message: 'Username updated successfully', username });
  });
});

// Update password (protected)
router.put('/:id/password', verifyTokenMiddleware, (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!req.user || req.user.userId !== Number(id)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
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

  userModel.updatePassword(id, password, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to update password' });
    }

    res.json({ success: true, message: 'Password updated successfully' });
  });
});

module.exports = router;
