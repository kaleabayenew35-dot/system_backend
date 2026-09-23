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
  return jwt.sign(payload, getLaunchSecret(), { expiresIn: '30m' });
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

    const finish = (user) => {
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
    };

    // First search strictly by canonical phone number to ensure correct player identity
    db.get(
      `SELECT u.id, u.username, u.phone_number, u.telegram_id, b.balance, b.coins
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id
       WHERE u.phone_number = ?
       LIMIT 1`,
      [normalizedPhone],
      (err, user) => {
        if (err) return callback(err);

        if (user) {
          return finish(user);
        }

        // Only fall back to username search if phone was not found and username is provided
        if (payload.username && payload.username.trim()) {
          return db.get(
            `SELECT u.id, u.username, u.phone_number, u.telegram_id, b.balance, b.coins
             FROM users u
             LEFT JOIN balances b ON b.user_id = u.id
             WHERE u.username = ?
             LIMIT 1`,
            [payload.username.trim()],
            (uErr, userByUsername) => {
              if (uErr) return callback(uErr);
              if (!userByUsername) {
                return callback(null, {
                  valid: false,
                  reason: 'user not found for launch payload',
                  payload,
                });
              }
              return finish(userByUsername);
            }
          );
        }

        return callback(null, {
          valid: false,
          reason: 'user not found for launch payload',
          payload,
        });
      }
    );
  } catch (error) {
    console.error('[resolve-launch-token] verification failed', { name: error?.name, message: error?.message });
    callback(error);
  }
};

module.exports = { signLaunchToken, verifyLaunchToken, resolveLaunchToken };
