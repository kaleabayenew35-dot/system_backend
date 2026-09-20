const express = require('express');
const router = express.Router();
const userModel = require('../models/userModel');
const transactionModel = require('../models/transactionModel');
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

// Telegram-native registration — no username/password prompt.
// The bot calls this after the user shares their phone number.
// Username is derived from Telegram profile; a secure random password
// is generated server-side and stored (user never types it).
router.post('/telegram-register', (req, res) => {
  const { telegram_id, phone_number, telegram_username, first_name } = req.body;
  if (!telegram_id || !phone_number) {
    return res.status(400).json({ error: 'telegram_id and phone_number are required' });
  }

  const db          = require('../config/database');
  const bcrypt      = require('bcryptjs');
  const crypto      = require('crypto');
  const { generateToken } = require('../utils/jwt');
  const { normalizePhone } = require('../utils/validation');
  const userModel   = require('../models/userModel');

  // If user already exists, just auto-login them
  userModel.getUserByTelegramId(String(telegram_id), (lookupErr, existing) => {
    if (lookupErr) return res.status(500).json({ error: 'Database error' });

    if (existing) {
      const token = generateToken(existing.id, existing.telegram_id);
      return res.json({ success: true, token, userId: existing.id, username: existing.username, existing: true });
    }

    // Build a username from Telegram data
    // Priority: telegram_username → first_name → tg_<id>
    let base = (telegram_username || first_name || `tg_${telegram_id}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 18);
    if (base.length < 3) base = `tg_${String(telegram_id).slice(-6)}`;

    // Ensure username is unique by appending a suffix when needed
    const tryInsert = (candidate, attempt) => {
      const username = attempt === 0 ? candidate : `${candidate}_${attempt}`;
      const password = crypto.randomBytes(16).toString('hex'); // random, never shown
      const hash     = bcrypt.hashSync(password, 10);
      const phone    = normalizePhone(phone_number) || phone_number;

      db.run(
        `INSERT INTO users (telegram_id, phone_number, username, password) VALUES (?, ?, ?, ?)`,
        [String(telegram_id), phone, username, hash],
        function (insertErr) {
          if (insertErr) {
            // Duplicate username — try next suffix (up to 10 attempts)
            if (/UNIQUE|duplicate key/i.test(insertErr.message) && attempt < 10) {
              return tryInsert(candidate, attempt + 1);
            }
            return res.status(400).json({ error: insertErr.message || 'Registration failed' });
          }

          const userId = this.lastID;
          // Create balance + player records
          db.run(`INSERT INTO balances (user_id, balance, coins) VALUES (?, 0, 100) ON CONFLICT (user_id) DO NOTHING`, [userId]);
          db.run(`INSERT INTO players (user_id) VALUES (?) ON CONFLICT DO NOTHING`, [userId]);

          const token = generateToken(userId, String(telegram_id));
          res.json({ success: true, token, userId, username, existing: false });
        }
      );
    };

    tryInsert(base, 0);
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

// Authenticated user's own transaction history.
router.get('/:id/transactions', verifyTokenMiddleware, (req, res) => {
  const userId = Number(req.params.id);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  if (!req.user || Number(req.user.userId) !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  transactionModel.getByUser(userId, { limit }, (err, transactions) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    return res.json({ success: true, transactions: transactions || [] });
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
