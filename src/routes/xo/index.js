const express = require('express');
const axios = require('axios');
const db = require('../../config/database');

const router = express.Router();

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
      if (err) return res.status(500).json({ ok: false, error: 'Database error' });
      if (!row) return res.status(401).json({ ok: false, error: 'Invalid game token' });
      if (row.status !== 'active') return res.status(403).json({ ok: false, error: 'Token is inactive' });
      if (row.game_status !== 'active') return res.status(403).json({ ok: false, error: 'Game is not active' });
      req.gameToken = row;
      next();
    }
  );
};

const resolveUser = (identifier, callback) => {
  const cleanStr = String(identifier || '').replace(/\D/g, '');
  const normalized = identifier?.replace(/[^\d+]/g, '') || '';
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

const getLocalBalance = (identifier, callback) => {
  resolveUser(identifier, (err, user) => {
    if (err || !user) return callback(err, null);
    callback(null, { balance: Number(user.balance ?? 0), user });
  });
};

router.post('/player-balance', requireGameToken, async (req, res) => {
  const { phone, username } = req.body;
  const identifier = phone || username;
  const backendUrl = req.gameToken.backend_url;

  if (!identifier) {
    return res.status(400).json({ ok: false, error: 'phone or username is required' });
  }

  if (backendUrl) {
    try {
      const ownerRes = await axios.post(
        `${backendUrl.replace(/\/$/, '')}/xo`,
        { action: 'get_balance', phone: phone || '', username: username || '' },
        { timeout: 8000 }
      );

      const balance = Number(
        ownerRes.data?.balance ??
        ownerRes.data?.data?.balance ??
        0
      );

      return res.json({ ok: true, data: { balance } });
    } catch (err) {
      console.error('[xo/player-balance] Owner backend unreachable:', err.message);
    }
  }

  getLocalBalance(identifier, (err, result) => {
    if (err || !result) {
      return res.status(404).json({ ok: false, error: 'Player not found' });
    }
    return res.json({
      ok: true,
      data: { balance: result.balance },
      source: backendUrl ? 'local_fallback' : 'local',
    });
  });
});

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
    phone: phone || '',
    username: username || '',
    playerId: playerId || `ph_${phone || username}`,
    amount: Number(amount || 0),
    fee: Number(fee || 0),
    gameId: gameId || String(req.gameToken.game_id),
  };

  if (backendUrl) {
    try {
      const ownerRes = await axios.post(`${backendUrl.replace(/\/$/, '')}/xo`, payload, { timeout: 8000 });
      return res.json({ ok: true, data: ownerRes.data || {} });
    } catch (err) {
      console.error(`[xo/game-action:${action}] Owner backend error:`, err.message);
    }
  }

  resolveUser(identifier, (err, user) => {
    if (err) return res.status(500).json({ ok: false, error: 'Database error' });
    if (!user) return res.status(404).json({ ok: false, error: 'Player not found' });

    const amt = Number(amount || 0);
    const note = `${action} — XO ${req.gameToken.game_name}`;
    const respond = (newBal) => res.json({ ok: true, data: { balance: newBal } });

    if (action === 'deduct') {
      const cur = Number(user.balance ?? 0);
      if (cur < amt) {
        return res.status(400).json({ ok: false, error: 'Insufficient balance', data: { balance: cur } });
      }
      db.run(
        `UPDATE balances SET balance = balance - ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, user.id],
        function (e) {
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
        [amt, user.id],
        function (e) {
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
        [amt, user.id],
        function (e) {
          if (e) return res.status(500).json({ ok: false, error: 'Failed to refund' });
          db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
            [user.id, 'deposit', amt, 'game', 'done', note]);
          respond(cur + amt);
        }
      );
    }
  });
});

router.post('/verify', requireGameToken, (req, res) => {
  const identifier = req.body.username || req.body.phone;
  if (!identifier) return res.status(400).json({ ok: false, error: 'username or phone required' });
  resolveUser(identifier, (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: 'Player not found' });
    res.json({ ok: true, data: {
      game: { id: req.gameToken.game_id, name: req.gameToken.game_name },
      player: {
        id: user.id,
        username: user.username,
        phone: user.phone_number,
        balance: Number(user.balance ?? 0),
        coins: Number(user.coins ?? 0),
      }
    }});
  });
});

const handleXoCallback = (req, res) => {
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
      humanPlayerId ? `player:${humanPlayerId}` : null,
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
          (updateErr) => {
            if (updateErr) {
              console.error('Failed to update owner balance:', updateErr.message);
              return res.status(500).json({ error: 'Failed to update owner balance' });
            }
            return res.json({ ok: true, message: 'owner fee recorded' });
          }
        );
      }
    );
  }

  if (!identifier) {
    return res.status(400).json({ error: 'phone or username is required' });
  }

  if (action === 'get_balance') {
    getLocalBalance(identifier, (err, result) => {
      if (err || !result) return res.status(404).json({ error: 'Player not found' });
      return res.json({ ok: true, balance: result.balance });
    });
    return;
  }

  resolveUser(identifier, (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const amt = Number(amount || 0);
    const note = `${action} - XO`;

    if (action === 'deduct') {
      const cur = Number(user.balance ?? 0);
      if (cur < amt) return res.status(400).json({ error: 'Insufficient balance', balance: cur });
      db.run(
        `UPDATE balances SET balance = balance - ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, user.id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Failed to deduct' });
          db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
            [user.id, 'withdraw', amt, 'game', 'done', note]);
          return res.json({ ok: true, balance: cur - amt });
        }
      );
      return;
    }

    if (action === 'credit') {
      const cur = Number(user.balance ?? 0);
      db.run(
        `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, user.id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Failed to credit' });
          db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
            [user.id, 'deposit', amt, 'game', 'done', note]);
          return res.json({ ok: true, balance: cur + amt });
        }
      );
      return;
    }

    if (action === 'loss') {
      db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
        [user.id, 'withdraw', 0, 'game', 'done', note]);
      return res.json({ ok: true, balance: Number(user.balance ?? 0) });
    }

    if (action === 'refund') {
      const cur = Number(user.balance ?? 0);
      db.run(
        `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [amt, user.id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Failed to refund' });
          db.run(`INSERT INTO transactions (user_id,type,amount,method,status,note) VALUES (?,?,?,?,?,?)`,
            [user.id, 'deposit', amt, 'game', 'done', note]);
          return res.json({ ok: true, balance: cur + amt });
        }
      );
      return;
    }

    return res.status(400).json({ error: 'Unsupported action' });
  });
};

module.exports = router;
module.exports.handleXoCallback = handleXoCallback;
