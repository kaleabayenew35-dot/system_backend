const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const db = require('../src/config/database');
const { signLaunchToken, resolveLaunchToken } = require('../src/utils/launchToken');

test('resolveLaunchToken returns the authoritative user record from the backend database', async () => {
  const suffix = Date.now();
  const phone = `+251700000${suffix.toString().slice(-4)}`;
  const username = `launchuser${suffix}`;
  const telegramId = `launch-${suffix}`;
  const expectedBalance = 42.5;

  const insertUser = () => new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users (telegram_id, phone_number, username, password) VALUES (?, ?, ?, ?)`,
      [telegramId, phone, username, bcrypt.hashSync('Password123!', 10)],
      function (insertErr) {
        if (insertErr) return reject(insertErr);
        resolve(this.lastID);
      }
    );
  });

  const insertBalance = (userId) => new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO balances (user_id, balance, coins) VALUES (?, ?, ?)`,
      [userId, expectedBalance, 100],
      (balanceErr) => {
        if (balanceErr) return reject(balanceErr);
        resolve();
      }
    );
  });

  const cleanup = (userId) => new Promise((resolve) => {
    db.run(`DELETE FROM balances WHERE user_id = ?`, [userId], () => {
      db.run(`DELETE FROM users WHERE id = ?`, [userId], () => resolve());
    });
  });

  const userId = await insertUser();
  await insertBalance(userId);

  const launchToken = signLaunchToken({ phone, username, balance: 999, gameId: 'game-1' });
  const result = await new Promise((resolve, reject) => {
    resolveLaunchToken(launchToken, (resolveErr, data) => {
      if (resolveErr) return reject(resolveErr);
      resolve(data);
    });
  });

  assert.equal(result.valid, true);
  assert.equal(result.user.username, username);
  assert.equal(result.user.phone, phone);
  assert.equal(Number(result.user.balance), expectedBalance);
  assert.equal(result.payload.gameId, 'game-1');

  await cleanup(userId);
});
