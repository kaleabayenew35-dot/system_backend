const db = require('../config/database');
const bcrypt = require('bcryptjs');

const isUniqueConstraintError = (err) => {
  return !!err && (err.code === 'SQLITE_CONSTRAINT' || /UNIQUE/i.test(err.message));
};

const ensureUserProfile = (userId, callback) => {
  db.run(
    `INSERT OR IGNORE INTO balances (user_id, balance, coins) VALUES (?, ?, ?)`,
    [userId, 0, 100],
    (balanceErr) => {
      if (balanceErr) return callback(balanceErr);

      db.run(
        `INSERT OR IGNORE INTO players (user_id) VALUES (?)`,
        [userId],
        (playerErr) => {
          callback(playerErr);
        }
      );
    }
  );
};

// Create User
const createUser = (telegramId, phoneNumber, username, password, callback) => {
  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(
    `INSERT INTO users (telegram_id, phone_number, username, password) 
     VALUES (?, ?, ?, ?)`,
    [telegramId, phoneNumber, username, hashedPassword],
    function(err) {
      if (err) {
        if (isUniqueConstraintError(err)) {
          return getUserByTelegramId(telegramId, (lookupErr, existingUser) => {
            if (lookupErr) return callback(lookupErr, null);
            if (!existingUser) return callback(err, null);
            callback(null, existingUser.id);
          });
        }

        return callback(err, null);
      }

      const userId = this.lastID;
      ensureUserProfile(userId, (profileErr) => {
        if (profileErr) {
          return callback(profileErr, null);
        }
        callback(null, userId);
      });
    }
  );
};

// Get User by Telegram ID
const getUserByTelegramId = (telegramId, callback) => {
  db.get(
    `SELECT * FROM users WHERE telegram_id = ?`,
    [telegramId],
    callback
  );
};

// Get User by ID
const getUserById = (userId, callback) => {
  db.get(
    `SELECT * FROM users WHERE id = ?`,
    [userId],
    callback
  );
};

// Verify Password
const verifyPassword = (inputPassword, hashedPassword) => {
  return bcrypt.compareSync(inputPassword, hashedPassword);
};

// Get User Balance
const getUserBalance = (userId, callback) => {
  db.get(
    `SELECT * FROM balances WHERE user_id = ?`,
    [userId],
    callback
  );
};

// Update Balance
const updateBalance = (userId, amount, callback) => {
  db.run(
    `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP 
     WHERE user_id = ?`,
    [amount, userId],
    callback
  );
};

// Update username
const updateUsername = (userId, newUsername, callback) => {
  db.run(
    `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newUsername, userId],
    function(err) {
      callback(err, this.changes);
    }
  );
};

// Update password
const updatePassword = (userId, newPassword, callback) => {
  const hashedPassword = bcrypt.hashSync(newPassword, 10);

  db.run(
    `UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [hashedPassword, userId],
    function(err) {
      callback(err, this.changes);
    }
  );
};

module.exports = {
  createUser,
  getUserByTelegramId,
  getUserById,
  verifyPassword,
  getUserBalance,
  updateBalance,
  updateUsername,
  updatePassword
};
