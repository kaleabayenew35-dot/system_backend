/**
 * verifyGameToken.js
 *
 * Middleware for the /dama webhook endpoint.
 * Reads `token` from req.body and validates it against game_tokens.
 * Attaches the token row to req.gameToken on success.
 *
 * 401 → token missing or not found / inactive
 */

const db = require('../config/database');

const verifyGameToken = (req, res, next) => {
  const token = req.body?.token;

  if (!token) {
    return res.status(401).json({ ok: false, error: 'token is required' });
  }

  db.get(
    `SELECT gt.*, g.id AS game_id, g.name AS game_name, g.status AS game_status
     FROM game_tokens gt
     JOIN games g ON g.id = gt.game_id
     WHERE gt.token = ? AND gt.status = 'active'`,
    [token],
    (err, row) => {
      if (err)  return res.status(500).json({ ok: false, error: 'Database error' });
      if (!row) return res.status(401).json({ ok: false, error: 'Invalid or inactive game token' });
      req.gameToken = row;
      next();
    }
  );
};

module.exports = verifyGameToken;
