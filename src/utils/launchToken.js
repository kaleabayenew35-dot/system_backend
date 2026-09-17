require('dotenv').config();

const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { normalizePhone } = require('./validation');

const getLaunchSecret = () => {
  const secret = process.env.DAMA_LAUNCH_SECRET;
  if (!secret) throw new Error('DAMA_LAUNCH_SECRET is not configured');
  return secret;
};

const signLaunchToken = ({ phone, username, balance, gameId }) => {
  const payload = { phone, username, balance, gameId };
  return jwt.sign(payload, getLaunchSecret(), { expiresIn: '5m' });
};

const verifyLaunchToken = (launchToken) => {
  console.log('[verify] secret length:', (process.env.DAMA_LAUNCH_SECRET || '').length);
  console.log('[verify] token to verify:', launchToken ? launchToken.slice(0, 20) + '...' : 'undefined');

  try {
    return jwt.verify(launchToken, getLaunchSecret());
  } catch (err) {
    console.error('[verify] jwt error', { name: err?.name, message: err?.message });
    throw err;
  }
};

const resolveLaunchToken = (launchToken, callback) => {
  try {
    const payload = verifyLaunchToken(launchToken);
    if (!payload?.phone) {
      return callback(null, { valid: false, reason: 'phone is required in launch payload' });
    }

    const normalizedPhone = normalizePhone(payload.phone);

    db.get(
      `SELECT u.id, u.username, u.phone_number, u.telegram_id, b.balance, b.coins
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id
       WHERE u.phone_number = ? OR u.phone_number = ? OR u.username = ?
       LIMIT 1`,
      [payload.phone, normalizedPhone, payload.username || ''],
      (err, user) => {
        if (err) return callback(err);

        if (!user) {
          return callback(null, {
            valid: false,
            reason: 'user not found for launch payload',
            payload,
          });
        }

        callback(null, {
          valid: true,
          payload,
          user: {
            id: user.id,
            username: user.username,
            phone: user.phone_number,
            balance: Number(user.balance ?? 0),
            coins: Number(user.coins ?? 0),
            telegramId: user.telegram_id,
          },
        });
      }
    );
  } catch (error) {
    console.error('[resolve-launch-token] verification failed', { name: error?.name, message: error?.message });
    callback(error);
  }
};

module.exports = { signLaunchToken, verifyLaunchToken, resolveLaunchToken };
