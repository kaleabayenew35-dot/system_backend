/**
 * adminController.js
 *
 * Pure request/response layer for admin routes.
 * All SQL lives in models/. All balance logic lives in services/balanceService.js.
 */

const bcrypt           = require('bcryptjs');
const { validationResult } = require('express-validator');
const db               = require('../config/database');
const gameModel        = require('../models/gameModel');
const cashierModel     = require('../models/cashierModel');
const transactionModel = require('../models/transactionModel');
const gameTokenModel   = require('../models/gameTokenModel');
const balanceService   = require('../services/balanceService');
const { generateToken } = require('../utils/jwt');
const { signLaunchToken } = require('../utils/launchToken');
const { ok, err, parsePagination } = require('../utils/response');

// ── Validation guard ──────────────────────────────────────────────────────────
const guard = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, error: 'Validation failed', details: errors.array() });
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

const login = (req, res) => {
  if (guard(req, res)) return;
  const { username, password } = req.body;

  db.get(`SELECT * FROM users WHERE username = ?`, [username], (dbErr, user) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (!user)  return err(res, 'Invalid username or password', 401);
    if (!bcrypt.compareSync(password, user.password)) return err(res, 'Invalid username or password', 401);

    const token = generateToken(user.id, user.telegram_id);
    return ok(res, { message: 'Login successful', token, user: { id: user.id, username: user.username } });
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

const getUsers = (req, res) => {
  const pg = parsePagination(req.query);

  const query = (limit, offset) => {
    const args = typeof limit === 'number'
      ? { suffix: 'LIMIT ? OFFSET ?', params: [limit, offset] }
      : { suffix: '', params: [] };

    db.all(
      `SELECT u.id, u.username, u.phone_number, u.telegram_id, u.created_at,
              b.balance, b.coins
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id
       ORDER BY u.created_at DESC ${args.suffix}`,
      args.params,
      (dbErr, rows) => {
        if (dbErr) return err(res, 'Database error', 500);
        if (typeof limit === 'number') {
          db.get(`SELECT COUNT(*) AS total FROM users`, (cErr, countRow) => {
            return ok(res, { users: rows, pagination: { total: countRow?.total ?? 0, limit, offset } });
          });
        } else {
          return ok(res, { users: rows });
        }
      }
    );
  };

  if (pg && pg.limit !== null) {
    query(pg.limit, pg.offset);
  } else {
    query();
  }
};

const updateUserUsername = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;
  const { username } = req.body;

  db.run(
    `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [username, id],
    function (dbErr) {
      if (dbErr) {
        if (dbErr.message.includes('UNIQUE')) return err(res, 'Username already taken', 409);
        return err(res, 'Failed to update username', 500);
      }
      if (!this.changes) return err(res, 'User not found', 404);
      return ok(res, { message: 'Username updated' });
    }
  );
};

const resetUserPassword = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;
  const { password } = req.body;
  const hashed = bcrypt.hashSync(password, 10);

  db.run(
    `UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [hashed, id],
    function (dbErr) {
      if (dbErr) return err(res, 'Failed to reset password', 500);
      if (!this.changes) return err(res, 'User not found', 404);
      return ok(res, { message: 'Password reset successfully' });
    }
  );
};

const deleteUser = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;

  db.serialize(() => {
    db.run(`DELETE FROM balances WHERE user_id = ?`, [id]);
    db.run(`DELETE FROM players WHERE user_id = ?`, [id]);
    db.run(`DELETE FROM game_sessions WHERE user_id = ?`, [id]);
    db.run(`DELETE FROM transactions WHERE user_id = ?`, [id]);
    db.run(`DELETE FROM admin_balance_transactions WHERE user_id = ?`, [id]);
    db.run(`DELETE FROM users WHERE id = ?`, [id], function (dbErr) {
      if (dbErr) return err(res, 'Failed to delete user', 500);
      if (!this.changes) return err(res, 'User not found', 404);
      return ok(res, { message: 'User deleted successfully' });
    });
  });
};

// ── User balance (admin direct) ───────────────────────────────────────────────

const depositToUser = (req, res) => {
  if (guard(req, res)) return;
  const userId = Number(req.params.id);
  const amount = Number(req.body.amount);

  balanceService.adminCreditUser(userId, amount, 'Admin deposit', (svcErr) => {
    if (svcErr) {
      if (svcErr.code === 'NOT_FOUND') return err(res, 'User balance not found', 404);
      return err(res, 'Failed to deposit', 500);
    }
    return ok(res, { message: `Deposited $${amount}` });
  });
};

const withdrawFromUser = (req, res) => {
  if (guard(req, res)) return;
  const userId = Number(req.params.id);
  const amount = Number(req.body.amount);

  balanceService.adminDebitUser(userId, amount, 'Admin withdraw', (svcErr) => {
    if (svcErr) {
      if (svcErr.code === 'NOT_FOUND')    return err(res, 'User balance not found', 404);
      if (svcErr.code === 'INSUFFICIENT') return err(res, 'Insufficient balance', 400);
      return err(res, 'Failed to withdraw', 500);
    }
    return ok(res, { message: `Withdrew $${amount}` });
  });
};

// ── Deposit / withdraw request (pending, by bot user) ────────────────────────

const requestDeposit = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;
  const { amount, method, transaction_id, transaction_number } = req.body;

  transactionModel.insert(
    { userId: id, type: 'deposit', amount, method, transactionId: transaction_id,
      transactionNumber: transaction_number, status: 'pending', note: 'User deposit request' },
    (dbErr, txId) => {
      if (dbErr) return err(res, 'Failed to save request', 500);
      return ok(res, { transactionId: txId, message: 'Deposit request submitted' }, 201);
    }
  );
};

const requestWithdraw = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;
  const { amount, method, transaction_id, transaction_number } = req.body;

  db.get(`SELECT balance FROM balances WHERE user_id = ?`, [id], (dbErr, row) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (!row)  return err(res, 'Balance not found', 404);
    if (row.balance < amount) return err(res, 'Insufficient balance', 400);

    transactionModel.insert(
      { userId: id, type: 'withdraw', amount, method, transactionId: transaction_id,
        transactionNumber: transaction_number, status: 'pending', note: 'User withdraw request' },
      (insErr, txId) => {
        if (insErr) return err(res, 'Failed to save request', 500);
        return ok(res, { transactionId: txId, message: 'Withdraw request submitted' }, 201);
      }
    );
  });
};

const selfDeposit = (req, res) => {
  if (guard(req, res)) return;
  const userId = Number(req.params.id);
  const { amount, note } = req.body;

  db.run(
    `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
    [amount, userId],
    function (dbErr) {
      if (dbErr) return err(res, 'Failed to deposit', 500);
      if (!this.changes) return err(res, 'Balance record not found', 404);
      transactionModel.insert({ userId, type: 'deposit', amount, note: note || 'User deposit', status: 'done' }, () => {});
      return ok(res, { message: `Deposited $${amount}` });
    }
  );
};

const selfWithdraw = (req, res) => {
  if (guard(req, res)) return;
  const userId = Number(req.params.id);
  const { amount, note } = req.body;

  balanceService.debitUserBalance(userId, amount, { type: 'withdraw', status: 'done', note: note || 'User withdraw' }, (svcErr) => {
    if (svcErr) {
      if (svcErr.code === 'NOT_FOUND')    return err(res, 'Balance record not found', 404);
      if (svcErr.code === 'INSUFFICIENT') return err(res, 'Insufficient balance', 400);
      return err(res, 'Failed to withdraw', 500);
    }
    return ok(res, { message: `Withdrew $${amount}` });
  });
};

// ── Transactions ──────────────────────────────────────────────────────────────

const getTransactions = (req, res) => {
  const status = req.query.status || 'pending';
  const pg     = parsePagination(req.query);

  const opts = { status };
  if (pg && pg.limit !== null) { opts.limit = pg.limit; opts.offset = pg.offset; }

  transactionModel.getAll(opts, (dbErr, rows) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (pg && pg.limit !== null) {
      transactionModel.count({ status }, (cErr, countRow) => {
        return ok(res, { transactions: rows, pagination: { total: countRow?.total ?? 0, limit: pg.limit, offset: pg.offset } });
      });
    } else {
      return ok(res, { transactions: rows });
    }
  });
};

const getUserTransactions = (req, res) => {
  const { id } = req.params;
  const limit  = parseInt(req.query.limit) || 10;

  transactionModel.getByUser(id, { limit }, (dbErr, rows) => {
    if (dbErr) return err(res, 'Database error', 500);
    return ok(res, { transactions: rows });
  });
};

const checkTransaction = (req, res) => {
  const { id } = req.params;
  const { ref } = req.query;

  if (!ref) return err(res, 'Transaction ID is required', 400);

  transactionModel.getByUserAndRef(id, ref, (dbErr, row) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (!row)  return err(res, 'Transaction not found', 404);
    return ok(res, { transaction: row });
  });
};

const updateTransactionStatus = (req, res) => {
  if (guard(req, res)) return;
  const { txId } = req.params;
  const { status, rejection_reason } = req.body;

  transactionModel.getById(txId, (dbErr, tx) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (!tx)   return err(res, 'Transaction not found', 404);
    if (tx.status === 'done') return err(res, 'Transaction already processed', 409);

    transactionModel.setStatus(txId, { status, rejection_reason }, (setErr) => {
      if (setErr) return err(res, 'Failed to update status', 500);

      if (status === 'done') {
        balanceService.approveTransaction(tx, (svcErr) => {
          if (svcErr) {
            if (svcErr.code === 'INSUFFICIENT') return err(res, 'Insufficient balance', 400);
            console.error('[updateTransactionStatus] balance error:', svcErr.message);
          }
        });
      }

      return ok(res, { message: `Transaction ${status}` });
    });
  });
};

const getBalanceSummary = (req, res) => {
  transactionModel.getSummary((dbErr, summary) => {
    if (dbErr) return err(res, 'Database error', 500);
    return ok(res, { summary });
  });
};

const getAdminBalance = (req, res) => {
  transactionModel.getAdminBalance((dbErr, row) => {
    if (dbErr) return err(res, 'Database error', 500);
    return ok(res, { balance: row ? row.balance : 0 });
  });
};

const getCashierTransactions = (req, res) => {
  transactionModel.getCashierTransactions((dbErr, rows) => {
    if (dbErr) return err(res, 'Database error', 500);
    return ok(res, { transactions: rows || [] });
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// GAMES
// ═══════════════════════════════════════════════════════════════════════════════

const getAllGamesAdmin = (req, res) => {
  const pg = parsePagination(req.query);
  const opts = (pg && pg.limit !== null) ? { limit: pg.limit, offset: pg.offset } : {};

  gameModel.getAllGamesAdmin(opts, (dbErr, games) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (pg && pg.limit !== null) {
      gameModel.countAllGames((cErr, countRow) => {
        return ok(res, { games, pagination: { total: countRow?.total ?? 0, limit: pg.limit, offset: pg.offset } });
      });
    } else {
      return ok(res, { games });
    }
  });
};

const getGamesList = (req, res) => {
  gameModel.getAllGames((dbErr, games) => {
    if (dbErr) return err(res, 'Database error', 500);
    return ok(res, { games });
  });
};

const createGame = (req, res) => {
  if (guard(req, res)) return;
  const { name, game_url, mini_app_url, description, min_players, max_players } = req.body;

  gameModel.createGame({ name, game_url, mini_app_url, description, min_players, max_players }, (dbErr, gameId) => {
    if (dbErr) return err(res, dbErr.message || 'Failed to create game', 400);
    return ok(res, { gameId, message: 'Game added successfully' }, 201);
  });
};

const updateGame = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;
  const { name, game_url, mini_app_url, description, status } = req.body;

  gameModel.updateGame(id, { name, game_url, mini_app_url, description, status }, (dbErr, changes) => {
    if (dbErr) return err(res, 'Failed to update game', 500);
    if (!changes) return err(res, 'Game not found', 404);
    return ok(res, { message: 'Game updated' });
  });
};

const deleteGame = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;

  gameModel.deleteGame(id, (dbErr, changes) => {
    if (dbErr) return err(res, 'Failed to delete game', 500);
    if (!changes) return err(res, 'Game not found', 404);
    return ok(res, { message: 'Game deleted' });
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// GAME TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

const getTokens = (req, res) => {
  const pg = parsePagination(req.query);
  const opts = (pg && pg.limit !== null) ? { limit: pg.limit, offset: pg.offset } : {};

  gameTokenModel.getAll(opts, (dbErr, tokens) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (pg && pg.limit !== null) {
      gameTokenModel.count((cErr, countRow) => {
        return ok(res, { tokens, pagination: { total: countRow?.total ?? 0, limit: pg.limit, offset: pg.offset } });
      });
    } else {
      return ok(res, { tokens });
    }
  });
};

const getTokensByGame = (req, res) => {
  gameTokenModel.getByGame(req.params.gameId, (dbErr, tokens) => {
    if (dbErr) return err(res, 'Database error', 500);
    return ok(res, { tokens });
  });
};

const getActiveTokenByGame = (req, res) => {
  gameTokenModel.getActiveByGame(req.params.gameId, (dbErr, row) => {
    if (dbErr) return err(res, 'Database error', 500);
    return ok(res, { token: row ? row.token : null });
  });
};

/**
 * GET /api/admin/games/game-tokens/launch/:gameId
 *
 * Returns the active game token AND a signed 5-minute launch token.
 * The launch token encodes phone/username/balance so the game URL
 * never needs those values as plain query params.
 *
 * Query params (all optional — include what the caller knows):
 *   ?phone=...&username=...&balance=...
 *
 * Response (new endpoint, does not alter any existing endpoint shape):
 *   { success: true, token: "GT-...", launch: "<signed-jwt>" }
 */
const getLaunchToken = (req, res) => {
  const { phone, username, balance } = req.query;
  const { gameId } = req.params;

  console.log('[launch-token] request', { gameId, phone, username, balance });

  gameTokenModel.getActiveByGame(gameId, (dbErr, row) => {
    if (dbErr) {
      console.error('[launch-token] db error', dbErr.message);
      return err(res, 'Database error', 500);
    }
    if (!row) {
      console.error('[launch-token] no active token', { gameId });
      return err(res, 'Active game token not found', 404);
    }

    let launch;
    try {
      const signedPayload = { phone, username, balance, gameId };
      console.log('[launch-token] signing payload', signedPayload);
      launch = signLaunchToken(signedPayload);
      console.log('[launch-token] response', { success: true, token: row.token, launch });
    } catch (signErr) {
      console.error('[launch-token] signing error', signErr.message);
      return err(res, signErr.message || 'Failed to sign launch token', 500);
    }

    return ok(res, { token: row.token, launch });
  });
};

const createToken = (req, res) => {
  if (guard(req, res)) return;
  const { game_id, label, backend_url } = req.body;

  gameTokenModel.create({ game_id, label, backend_url }, (dbErr, result) => {
    if (dbErr) return err(res, 'Failed to generate token', 500);
    return ok(res, { tokenId: result.id, token: result.token, message: 'Token generated' }, 201);
  });
};

const updateToken = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;
  const { label, status, token, backend_url } = req.body;

  gameTokenModel.update(id, { label, status, token, backend_url }, (dbErr, changes) => {
    if (dbErr) {
      if (dbErr.code === 'DUPLICATE') return err(res, 'Token value already exists', 409);
      return err(res, 'Failed to update token', 500);
    }
    if (!changes) return err(res, 'Token not found', 404);
    return ok(res, { message: 'Token updated' });
  });
};

const deleteToken = (req, res) => {
  if (guard(req, res)) return;
  gameTokenModel.remove(req.params.id, (dbErr, changes) => {
    if (dbErr) return err(res, 'Failed to delete token', 500);
    if (!changes) return err(res, 'Token not found', 404);
    return ok(res, { message: 'Token deleted' });
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// CASHIERS
// ═══════════════════════════════════════════════════════════════════════════════

const getCashiers = (req, res) => {
  const pg = parsePagination(req.query);
  const opts = (pg && pg.limit !== null) ? { limit: pg.limit, offset: pg.offset } : {};

  cashierModel.getAll(opts, (dbErr, cashiers) => {
    if (dbErr) return err(res, 'Database error', 500);
    if (pg && pg.limit !== null) {
      cashierModel.count((cErr, countRow) => {
        return ok(res, { cashiers, pagination: { total: countRow?.total ?? 0, limit: pg.limit, offset: pg.offset } });
      });
    } else {
      return ok(res, { cashiers });
    }
  });
};

const createCashier = (req, res) => {
  if (guard(req, res)) return;
  const { name, username, password, balance } = req.body;

  cashierModel.create({ name, username, password, balance }, (dbErr, cashierId) => {
    if (dbErr) {
      if (dbErr.message.includes('UNIQUE')) return err(res, 'Username already taken', 409);
      return err(res, 'Failed to create cashier', 500);
    }
    return ok(res, { cashierId, message: 'Cashier created' }, 201);
  });
};

const updateCashier = (req, res) => {
  if (guard(req, res)) return;
  const { id } = req.params;
  const { name, username, password, status } = req.body;

  cashierModel.update(id, { name, username, password, status }, (dbErr, changes) => {
    if (dbErr) {
      if (dbErr.message.includes('UNIQUE')) return err(res, 'Username already taken', 409);
      return err(res, 'Failed to update cashier', 500);
    }
    if (!changes) return err(res, 'Cashier not found', 404);
    return ok(res, { message: 'Cashier updated' });
  });
};

const deleteCashier = (req, res) => {
  if (guard(req, res)) return;
  cashierModel.remove(req.params.id, (dbErr, changes) => {
    if (dbErr) return err(res, 'Failed to delete cashier', 500);
    if (!changes) return err(res, 'Cashier not found', 404);
    return ok(res, { message: 'Cashier deleted' });
  });
};

const depositToCashier = (req, res) => {
  if (guard(req, res)) return;
  const cashierId = Number(req.params.id);
  const amount    = Number(req.body.amount);

  balanceService.adminToCashier(cashierId, amount, (svcErr) => {
    if (svcErr) {
      if (svcErr.code === 'INSUFFICIENT') return err(res, 'Insufficient admin balance', 400);
      if (svcErr.code === 'NOT_FOUND')    return err(res, 'Cashier not found', 404);
      return err(res, 'Failed to deposit', 500);
    }
    return ok(res, { message: `Deposited $${amount} to cashier` });
  });
};

const withdrawFromCashier = (req, res) => {
  if (guard(req, res)) return;
  const cashierId = Number(req.params.id);
  const amount    = Number(req.body.amount);

  balanceService.cashierToAdmin(cashierId, amount, (svcErr) => {
    if (svcErr) {
      if (svcErr.code === 'INSUFFICIENT') return err(res, 'Insufficient cashier balance', 400);
      if (svcErr.code === 'NOT_FOUND')    return err(res, 'Cashier not found', 404);
      return err(res, 'Failed to withdraw', 500);
    }
    return ok(res, { message: `Withdrew $${amount} from cashier` });
  });
};

module.exports = {
  // auth
  login,
  // users
  getUsers, updateUserUsername, resetUserPassword, deleteUser,
  depositToUser, withdrawFromUser,
  requestDeposit, requestWithdraw, selfDeposit, selfWithdraw,
  // transactions
  getTransactions, getUserTransactions, checkTransaction,
  updateTransactionStatus, getBalanceSummary, getAdminBalance,
  getCashierTransactions,
  // games
  getAllGamesAdmin, getGamesList, createGame, updateGame, deleteGame,
  // tokens
  getTokens, getTokensByGame, getActiveTokenByGame, getLaunchToken, createToken, updateToken, deleteToken,
  // cashiers
  getCashiers, createCashier, updateCashier, deleteCashier,
  depositToCashier, withdrawFromCashier,
};
