/**
 * gameApiRoutes.js
 * Mounted at /api/game-api in server.js
 *
 * Key endpoints used by Dama (and any game):
 *   POST /api/game-api/player-balance   — get live balance on page load
 *   POST /api/game-api/game-action      — bet / win / loss / refund
 *
 * Token accepted via:
 *   - Header:  X-API-Token: GT-XXX
 *   - Header:  Authorization: Bearer GT-XXX
 *   - Body:    { token: "GT-XXX" }
 *   - Query:   ?token=GT-XXX
 *
 * Response format (matching Dama spec):
 *   Success: { ok: true,  data: { ... } }
 *   Error:   { ok: false, error: "message" }
 */

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const axios   = require('axios');

// ── Token auth middleware ─────────────────────────────────────────────────────
const requireGameToken = (req, res, next) => {
  const raw =
    req.headers['x-api-token'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
    req.body?.token ||
    req.query?.token;

  if (!raw) return res.status(401).json({ ok: false, error: 'Game token required' });

  db.get(
    `SELECT gt.*, g.id AS game_id, g.name AS game_name, g.status AS game_status
     FROM game_tokens gt
     JOIN games g ON g.id = gt.game_id
     WHERE gt.token = ?`,
    [raw],
    (err, row) => {
      if (err)  return res.status(500).json({ ok: false, error: 'Database error' });
      if (!row) return res.status(401).json({ ok: false, error: 'Invalid game token' });
      if (row.status      !== 'active') return res.status(403).json({ ok: false, error: 'Token is inactive' });
      if (row.game_status !== 'active') return res.status(403).json({ ok: false, error: 'Game is not active' });
      req.gameToken = row;
      next();
    }
  );
};

const { normalizePhone } = require('../utils/validation');

// ── Resolve player by phone or username ───────────────────────────────────────
const resolveUser = (identifier, callback) => {
  const cleanStr = String(identifier || '').replace(/\D/g, '');
  const normalized = normalizePhone(identifier);
  let query = `
    SELECT u.id, u.username, u.phone_number, u.telegram_id,
           b.balance, b.coins
    FROM users u
    LEFT JOIN balances b ON b.user_id = u.id
    WHERE u.phone_number = ? OR u.phone_number = ? OR u.username = ?
  `;
  const params = [identifier, normalized, identifier];

  if (cleanStr.length >= 9) {
    const last9 = cleanStr.slice(-9);
    query += ` OR u.phone_number LIKE ?`;
    params.push(`%${last9}`);
  }

  query += ` LIMIT 1`;
  db.get(query, params, callback);
};

// ── Local balance lookup ──────────────────────────────────────────────────────
const getLocalBalance = (identifier, callback) => {
  resolveUser(identifier, (err, user) => {
    if (err || !user) return callback(err, null);
    callback(null, { balance: Number(user.balance ?? 0), user });
  });
};

// ────────────────────────────────────────────────────────────────────────────
// POST /api/game-api/player-balance
//
// Step 1: Validate token → get backend_url
// Step 2: POST {backend_url}/dama { action:'get_balance', phone, username }
// Step 3: Return { ok:true, data:{ balance } }
// Fallback: local DB balance if no backend_url or owner backend fails
// ────────────────────────────────────────────────────────────────────────────
router.post('/player-balance', requireGameToken, async (req, res) => {
  const { phone, username } = req.body;
  const identifier  = phone || username;
  const backendUrl  = req.gameToken.backend_url;

  if (!identifier) {
    return res.status(400).json({ ok: false, error: 'phone or username is required' });
  }

  // ── If owner backend is configured → proxy ────────────────────────────────
  if (backendUrl) {
    try {
      const ownerRes = await axios.post(
        `${backendUrl}/dama`,
        { action: 'get_balance', phone: phone || '', username: username || '' },
        { timeout: 8000 }
      );

      // Owner backend must return { balance: number }
      const balance = Number(
        ownerRes.data?.balance ??
        ownerRes.data?.data?.balance ??
        0
      );

      return res.json({ ok: true, data: { balance } });
    } catch (err) {
      console.error('[player-balance] Owner backend unreachable:', err.message);
      // Fall through to local fallback
    }
  }

  // ── Local DB fallback ─────────────────────────────────────────────────────
  getLocalBalance(identifier, (err, result) => {
    if (err || !result) {
      return res.status(404).json({ ok: false, error: 'Player not found' });
    }
    return res.json({
      ok:   true,
      data: { balance: result.balance },
      source: backendUrl ? 'local_fallback' : 'local',
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/game-api/game-action
//
// Handles: deduct | credit | loss | refund
// Proxies to {backend_url}/dama, falls back to local DB if needed.
//
// Body: { token, action, phone, username, playerId, amount, fee, gameId }
// Response: { ok: true, data: { ... } }
// ────────────────────────────────────────────────────────────────────────────
router.post('/game-action', requireGameToken, async (req, res) => {
  const { action, phone, username, playerId, amount, fee, gameId } = req.body;
  const backendUrl = req.gameToken.backend_url;
  const identifier = phone || username;

  const VALID = ['deduct', 'credit', 'loss', 'refund'];
  if (!action || !VALID.includes(action)) {
    return res.status(400).json({ ok: false, error: `action must be one of: ${VALID.join(', ')}` });
  }
  if (!identifier) {
    return res.status(400).json({ ok: false, error: 'phone or username is required' });
  }

  const payload = {
    action,
    phone:    phone    || '',
    username: username || '',
    playerId: playerId || `ph_${phone || username}`,
    amount:   Number(amount || 0),
    fee:      Number(fee    || 0),
    gameId:   gameId   || String(req.gameToken.game_id),
  };

  // ── If owner backend configured → proxy ───────────────────────────────────
  if (backendUrl) {
    try {
      const ownerRes = await axios.post(`${backendUrl}/dama`, payload, { timeout: 8000 });
      // Owner response is ignored for non-get_balance actions per spec
      return res.json({ ok: true, data: ownerRes.data || {} });
    } catch (err) {
      console.error(`[game-action:${action}] Owner backend error:`, err.message);
      // Fall through to local handling
    }
  }

  // ── Local DB handling ─────────────────────────────────────────────────────
  resolveUser(identifier, (err, user) => {
    if (err)   return res.status(500).json({ ok: false, error: 'Database error' });
    if (!user) return res.status(404).json({ ok: false, error: 'Player not found' });

    const amt  = Number(amount || 0);
    const note = `${action} — ${req.gameToken.game_name}`;

    const respond = (newBal) => res.json({ ok: true, data: { balance: newBal } });

    if (action === 'deduct') {
      const cur = Number(user.balance ?? 0);
      if (cur < amt) {
        return res.status(400).json({ ok: false, error: 'Insufficient balance', data: { balance: cur } });
      }
      db.run(
        `UPDATE balances SET balance = balance - ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, user.id], function(e) {
          if (e) return res.status(500).json({ ok: false, error: 'Failed to deduct' });
          db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
            [user.id, 'withdraw', amt, 'game', 'done', note]);
          respond(cur - amt);
        }
      );

    } else if (action === 'credit') {
      const cur = Number(user.balance ?? 0);
      db.run(
        `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, user.id], function(e) {
          if (e) return res.status(500).json({ ok: false, error: 'Failed to credit' });
          db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
            [user.id, 'deposit', amt, 'game', 'done', note]);
          respond(cur + amt);
        }
      );

    } else if (action === 'loss') {
      db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
        [user.id, 'withdraw', 0, 'game', 'done', note]);
      respond(Number(user.balance ?? 0));

    } else if (action === 'refund') {
      const cur = Number(user.balance ?? 0);
      db.run(
        `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, user.id], function(e) {
          if (e) return res.status(500).json({ ok: false, error: 'Failed to refund' });
          db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
            [user.id, 'deposit', amt, 'game', 'done', note]);
          respond(cur + amt);
        }
      );
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Keep existing endpoints (verify, balance GET, deduct, add, result, leaderboard)
// ────────────────────────────────────────────────────────────────────────────

router.post('/verify', requireGameToken, (req, res) => {
  const identifier = req.body.username || req.body.phone;
  if (!identifier) return res.status(400).json({ ok: false, error: 'username or phone required' });
  resolveUser(identifier, (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: 'Player not found' });
    res.json({ ok: true, data: {
      game:   { id: req.gameToken.game_id, name: req.gameToken.game_name },
      player: { id: user.id, username: user.username, phone: user.phone_number,
                balance: Number(user.balance ?? 0), coins: Number(user.coins ?? 0) }
    }});
  });
});

router.get('/balance', requireGameToken, (req, res) => {
  const identifier = req.query.username || req.query.phone;
  if (!identifier) return res.status(400).json({ ok: false, error: 'username or phone required' });
  resolveUser(identifier, (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: 'Player not found' });
    res.json({ ok: true, data: { balance: Number(user.balance ?? 0), coins: Number(user.coins ?? 0) }});
  });
});

router.get('/leaderboard', requireGameToken, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  db.all(
    `SELECT u.username, u.phone_number,
            COUNT(gs.id) AS games_played,
            SUM(CASE WHEN gs.result='win' THEN 1 ELSE 0 END) AS wins,
            MAX(gs.score) AS best_score
     FROM game_sessions gs JOIN users u ON u.id=gs.user_id
     WHERE gs.game_id=? GROUP BY gs.user_id
     ORDER BY wins DESC, best_score DESC LIMIT ?`,
    [req.gameToken.game_id, limit],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, error: 'Database error' });
      res.json({ ok: true, data: { game: { id: req.gameToken.game_id, name: req.gameToken.game_name }, leaderboard: rows }});
    }
  );
});

// ────────────────────────────────────────────────────────────────────────────
// POST /dama (Owner Callback Endpoint)
// Receives get_balance, deduct, credit, loss, refund actions from the Dama game.
// This route is also exposed directly at /dama for partner callback requests.
// ────────────────────────────────────────────────────────────────────────────
const handleDamaCallback = (req, res) => {
  const { action, phone, username, amount, gameId, type, humanPlayerId } = req.body;
  const identifier = phone || username;

  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  if (action === 'ping') {
    return res.json({ ok: true, message: 'pong' });
  }

  if (action === 'owner_fee') {
    const ownerAmount = Number(amount || 0);
    const note = [
      'owner_fee',
      type || 'unknown',
      gameId ? `game:${gameId}` : null,
      humanPlayerId ? `player:${humanPlayerId}` : null
    ].filter(Boolean).join(' | ');

    return db.run(
      `INSERT INTO admin_balance_transactions (type, amount, user_id, note) VALUES (?, ?, ?, ?)` ,
      ['owner_fee', ownerAmount, null, note],
      (err) => {
        if (err) {
          console.error('Failed to record owner fee:', err.message);
          return res.status(500).json({ error: 'Failed to record owner fee' });
        }

        db.run(
          `UPDATE admin_balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1`,
          [ownerAmount],
          (balanceErr) => {
            if (balanceErr) {
              console.error('Failed to update owner balance:', balanceErr.message);
              return res.status(500).json({ error: 'Failed to update owner balance' });
            }
            return res.json({ ok: true });
          }
        );
      }
    );
  }

  if (!identifier) {
    return res.status(400).json({ error: 'phone or username is required' });
  }

  resolveUser(identifier, (err, user) => {
    if (err) {
      console.error('Database error in resolveUser:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = user.id;

    if (action === 'get_balance') {
      return res.json({
        ok: true,
        balance: Number(user.balance ?? 0),
        username: user.username,
        phone: user.phone_number,
        data: {
          balance: Number(user.balance ?? 0),
          username: user.username,
          phone: user.phone_number
        }
      });
    }

    const amt = Number(amount || 0);
    const cur = Number(user.balance ?? 0);

    if (action === 'deduct') {
      if (cur < amt) {
        return res.status(400).json({ ok: false, error: 'Insufficient balance', balance: cur });
      }
      db.run(
        `UPDATE balances SET balance = balance - ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, userId],
        function (e) {
          if (e) return res.status(500).json({ error: 'Failed to deduct' });
          db.run(
            `INSERT INTO transactions (user_id, type, amount, method, status, note) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, 'withdraw', amt, 'game', 'done', 'deduct - Dama']
          );
          return res.json({ ok: true, balance: cur - amt });
        }
      );
    } else if (action === 'credit') {
      db.run(
        `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, userId],
        function (e) {
          if (e) return res.status(500).json({ error: 'Failed to credit' });
          db.run(
            `INSERT INTO transactions (user_id, type, amount, method, status, note) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, 'deposit', amt, 'game', 'done', 'credit - Dama']
          );
          return res.json({ ok: true, balance: cur + amt });
        }
      );
    } else if (action === 'loss') {
      db.run(
        `INSERT INTO transactions (user_id, type, amount, method, status, note) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, 'withdraw', 0, 'game', 'done', 'loss - Dama']
      );
      return res.json({ ok: true, balance: cur });
    } else if (action === 'refund') {
      db.run(
        `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, userId],
        function (e) {
          if (e) return res.status(500).json({ error: 'Failed to refund' });
          db.run(
            `INSERT INTO transactions (user_id, type, amount, method, status, note) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, 'deposit', amt, 'game', 'done', 'refund - Dama']
          );
          return res.json({ ok: true, balance: cur + amt });
        }
      );
    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  });
};

const verifyGameToken = require('../middleware/verifyGameToken');
router.post('/dama', verifyGameToken, handleDamaCallback);

module.exports = router;
module.exports.handleDamaCallback = handleDamaCallback;
