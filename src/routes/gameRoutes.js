const express = require('express');
const router = express.Router();
const axios = require('axios');
const gameModel = require('../models/gameModel');
const db = require('../config/database');
const { verifyTokenMiddleware } = require('../middleware/authMiddleware');
const { normalizePhone } = require('../utils/validation');

const requireGameToken = (req, res, next) => {
  const raw = req.headers['x-api-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.token || req.query?.token;

  if (!raw) {
    return res.status(401).json({ ok: false, error: 'X-API-Token is required' });
  }

  db.get(
    `SELECT gt.*, g.id AS game_id, g.name AS game_name, g.status AS game_status
     FROM game_tokens gt
     JOIN games g ON g.id = gt.game_id
     WHERE gt.token = ?`,
    [raw],
    (err, row) => {
      if (err) {
        return res.status(500).json({ ok: false, error: 'Database error' });
      }
      if (!row) {
        return res.status(401).json({ ok: false, error: 'Invalid game token' });
      }
      if (row.status !== 'active') {
        return res.status(403).json({ ok: false, error: 'Token is inactive' });
      }
      if (row.game_status !== 'active') {
        return res.status(403).json({ ok: false, error: 'Game is not active' });
      }
      req.gameToken = row;
      next();
    }
  );
};

const resolveUser = (identifier, callback) => {
  const cleanStr = String(identifier || '').replace(/\D/g, '');
  const normalized = normalizePhone(identifier);
  let query = `
    SELECT u.id, u.username, u.phone_number, b.balance, b.coins
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

// Get all games (protected)
router.get('/', verifyTokenMiddleware, (req, res) => {
  gameModel.getAllGames((err, games) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true, games: games });
  });
});

// Get game by ID (protected)
router.get('/:id', verifyTokenMiddleware, (req, res) => {
  const { id } = req.params;

  gameModel.getGameById(id, (err, game) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (game) {
      res.json({ success: true, game: game });
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
  });
});

// Start a Dama-style bet
router.post('/start-bet', requireGameToken, (req, res) => {
  const { gameId, playerId, phone, betAmount, mode, player2Id } = req.body;
  const identifier = phone || req.body.username || playerId;
  const amount = Number(betAmount || 0);

  if (!gameId) {
    return res.status(400).json({ ok: false, error: 'gameId is required' });
  }
  if (!identifier) {
    return res.status(400).json({ ok: false, error: 'phone or username is required' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'betAmount must be greater than 0' });
  }

  resolveUser(identifier, (err, user) => {
    if (err) {
      return res.status(500).json({ ok: false, error: 'Database error' });
    }
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Player not found' });
    }

    const currentBalance = Number(user.balance ?? 0);
    if (currentBalance < amount) {
      return res.status(400).json({
        ok: false,
        error: 'Insufficient balance',
        data: { balance: currentBalance }
      });
    }

    const requestBody = {
      action: 'deduct',
      phone: user.phone_number,
      username: user.username,
      playerId: playerId || `ph_${user.phone_number || user.username}`,
      amount,
      gameId
    };

    const fallbackResponse = {
      status: 'success',
      balance: currentBalance - amount
    };

    const finalizeBet = (backendError, backendResponse) => {
      const responseBody = backendResponse && backendResponse.data
        ? { status: 'success', ...backendResponse.data }
        : fallbackResponse;
      const status = backendError ? 'failed' : 'success';
      const error = backendError ? backendError.message : null;

      db.run(
        `INSERT INTO bet_logs (game_id, player_id, phone, bet_amount, backend_url, request_body, response_body, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          gameId,
          playerId || String(user.id),
          user.phone_number,
          amount,
          req.gameToken.backend_url || null,
          JSON.stringify(requestBody),
          JSON.stringify(responseBody),
          status,
          error
        ],
        (logErr) => {
          if (logErr) {
            return res.status(500).json({ ok: false, error: 'Failed to save bet log' });
          }

          res.status(201).json({
            ok: true,
            data: {
              game: {
                id: gameId,
                mode: mode || 'ai',
                player1_id: playerId || String(user.id),
                player2_id: player2Id || 'bot_easy',
                status: 'active',
                bet_amount: amount
              },
              betLog: {
                id: this.lastID,
                game_id: gameId,
                player_id: playerId || String(user.id),
                phone: user.phone_number,
                bet_amount: amount,
                backendUrl: req.gameToken.backend_url || null,
                requestBody,
                responseBody,
                status,
                error
              }
            }
          });
        }
      );
    };

    db.run(
      `UPDATE balances SET balance = balance - ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
      [amount, user.id],
      async (err) => {
        if (err) {
          return res.status(500).json({ ok: false, error: 'Failed to deduct balance' });
        }

        if (req.gameToken.backend_url) {
          try {
            const partnerResponse = await axios.post(`${req.gameToken.backend_url}/dama`, requestBody, { timeout: 8000 });
            finalizeBet(null, partnerResponse);
          } catch (backendError) {
            finalizeBet(backendError, null);
          }
        } else {
          finalizeBet(null, null);
        }
      }
    );
  });
});

// Start game session (protected)
router.post('/:id/start', verifyTokenMiddleware, (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;

  gameModel.createGameSession(user_id, id, (err, sessionId) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to create game session' });
    }
    res.json({ success: true, session_id: sessionId });
  });
});

// End game session (protected)
router.post('/session/:session_id/end', verifyTokenMiddleware, (req, res) => {
  const { session_id } = req.params;
  const { result, score } = req.body;

  gameModel.updateGameSession(session_id, result, score, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to update session' });
    }
    res.json({ success: true, message: 'Game session ended' });
  });
});

module.exports = router;
