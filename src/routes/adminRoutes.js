/**
 * adminRoutes.js — routing only.
 * All business logic lives in controllers/adminController.js
 * All SQL lives in models/
 * All balance mutations live in services/balanceService.js
 *
 * Existing paths are preserved verbatim.
 */

const express  = require('express');
const router   = express.Router();
const { body, param, query } = require('express-validator');
const ctrl     = require('../controllers/adminController');
const { verifyTokenMiddleware } = require('../middleware/authMiddleware');

// ── Validation rule sets ──────────────────────────────────────────────────────

const v = {
  loginBody: [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  positiveAmount: [
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
  ],
  userId: [
    param('id').isInt({ gt: 0 }).withMessage('id must be a positive integer'),
  ],
  txStatus: [
    body('status').isIn(['pending', 'done', 'rejected']).withMessage('status must be pending, done, or rejected'),
    body('rejection_reason')
      .if(body('status').equals('rejected'))
      .notEmpty().withMessage('rejection_reason is required when rejecting'),
  ],
  gameBody: [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('game_url').trim().notEmpty().withMessage('game_url is required'),
    body('backend_url').optional({ values: 'null' }).isURL({ protocols: ['http', 'https'] }).withMessage('backend_url must be a valid http/https URL'),
  ],
  tokenBody: [
    body('game_id').isInt({ gt: 0 }).withMessage('game_id must be a positive integer'),
  ],
  cashierBody: [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('username').trim().notEmpty().withMessage('username is required'),
    body('password').notEmpty().withMessage('password is required'),
  ],
  cashierUpdateBody: [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('username').trim().notEmpty().withMessage('username is required'),
  ],
  requestTx: [
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
    body('method').trim().notEmpty().withMessage('Payment method is required'),
    body('transaction_id').trim().notEmpty().withMessage('Transaction ID is required'),
  ],
  usernameBody: [
    body('username').trim().notEmpty().withMessage('Username is required'),
  ],
  passwordBody: [
    body('password').notEmpty().withMessage('Password is required'),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/login',         v.loginBody, ctrl.login);

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/users',          verifyTokenMiddleware, ctrl.getUsers);

router.put('/users/:id/username',
  verifyTokenMiddleware, v.userId, v.usernameBody,
  ctrl.updateUserUsername
);

router.put('/users/:id/reset-password',
  verifyTokenMiddleware, v.userId, v.passwordBody,
  ctrl.resetUserPassword
);

router.delete('/users/:id',
  verifyTokenMiddleware, v.userId,
  ctrl.deleteUser
);

// Admin direct balance ops
router.post('/users/:id/deposit',
  verifyTokenMiddleware, v.userId, v.positiveAmount,
  ctrl.depositToUser
);

router.post('/users/:id/withdraw',
  verifyTokenMiddleware, v.userId, v.positiveAmount,
  ctrl.withdrawFromUser
);

// Pending request flows (bot user)
router.post('/users/:id/request-deposit',
  verifyTokenMiddleware, v.userId, v.requestTx,
  ctrl.requestDeposit
);

router.post('/users/:id/request-withdraw',
  verifyTokenMiddleware, v.userId, v.requestTx,
  ctrl.requestWithdraw
);

router.post('/users/:id/self-deposit',
  verifyTokenMiddleware, v.userId, v.positiveAmount,
  ctrl.selfDeposit
);

router.post('/users/:id/self-withdraw',
  verifyTokenMiddleware, v.userId, v.positiveAmount,
  ctrl.selfWithdraw
);

router.get('/users/:id/transactions', verifyTokenMiddleware, ctrl.getUserTransactions);
router.get('/users/:id/transaction-check', verifyTokenMiddleware, ctrl.checkTransaction);

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/transactions',           verifyTokenMiddleware, ctrl.getTransactions);
router.get('/cashier-transactions',   verifyTokenMiddleware, ctrl.getCashierTransactions);
router.get('/balance-summary',        verifyTokenMiddleware, ctrl.getBalanceSummary);
router.get('/admin-balance',          verifyTokenMiddleware, ctrl.getAdminBalance);

router.put('/transactions/:txId/status',
  verifyTokenMiddleware, v.txStatus,
  ctrl.updateTransactionStatus
);

// ═══════════════════════════════════════════════════════════════════════════════
// GAMES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/all-games',  verifyTokenMiddleware, ctrl.getAllGamesAdmin);
router.get('/list',       ctrl.getGamesList);  // public

router.post('/',
  verifyTokenMiddleware, v.gameBody,
  ctrl.createGame
);

router.put('/:id',
  verifyTokenMiddleware, v.gameBody,
  ctrl.updateGame
);

router.delete('/:id',
  verifyTokenMiddleware,
  [param('id').isInt({ gt: 0 }).withMessage('id must be a positive integer')],
  ctrl.deleteGame
);

// ═══════════════════════════════════════════════════════════════════════════════
// GAME TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/game-tokens',                  verifyTokenMiddleware, ctrl.getTokens);
router.get('/game-tokens/active/:gameId',   verifyTokenMiddleware, ctrl.getActiveTokenByGame);
router.get('/game-tokens/launch/:gameId',   verifyTokenMiddleware, ctrl.getLaunchToken);
router.get('/game-tokens/game/:gameId',     verifyTokenMiddleware, ctrl.getTokensByGame);

router.post('/game-tokens',
  verifyTokenMiddleware, v.tokenBody,
  ctrl.createToken
);

router.put('/game-tokens/:id',
  verifyTokenMiddleware,
  [param('id').isInt({ gt: 0 }).withMessage('id must be a positive integer')],
  ctrl.updateToken
);

router.delete('/game-tokens/:id',
  verifyTokenMiddleware,
  [param('id').isInt({ gt: 0 }).withMessage('id must be a positive integer')],
  ctrl.deleteToken
);

// ═══════════════════════════════════════════════════════════════════════════════
// CASHIERS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/cashiers',    verifyTokenMiddleware, ctrl.getCashiers);

router.post('/cashiers',
  verifyTokenMiddleware, v.cashierBody,
  ctrl.createCashier
);

router.put('/cashiers/:id',
  verifyTokenMiddleware, v.cashierUpdateBody,
  ctrl.updateCashier
);

router.delete('/cashiers/:id',
  verifyTokenMiddleware,
  [param('id').isInt({ gt: 0 }).withMessage('id must be a positive integer')],
  ctrl.deleteCashier
);

router.post('/cashiers/:id/deposit',
  verifyTokenMiddleware, v.positiveAmount,
  ctrl.depositToCashier
);

router.post('/cashiers/:id/withdraw',
  verifyTokenMiddleware, v.positiveAmount,
  ctrl.withdrawFromCashier
);

// ═══════════════════════════════════════════════════════════════════════════════
// AI CONFIG PROXY
// Proxies GET/PUT ai config to the appropriate game backend using server-side
// secrets — the admin frontend never needs to hold game-backend tokens.
// ═══════════════════════════════════════════════════════════════════════════════

const GAME_AI_BACKENDS = {
  dama:  { url: process.env.DAMA_BACKEND_URL  || 'https://dama-backend.onrender.com',  path: '/api/ai',        token: process.env.DAMA_ADMIN_TOKEN  || process.env.ADMIN_TOKEN || '' },
  bingo: { url: process.env.BINGO_BACKEND_URL || 'https://bingo-i1br.onrender.com',    path: '/api/ai/config', token: process.env.BINGO_ADMIN_TOKEN || '' },
  xo:    { url: process.env.XO_BACKEND_URL    || 'https://tic-tak-backend.onrender.com', path: '/api/ai/config', token: process.env.XO_ADMIN_TOKEN   || '' },
  ludo:  { url: process.env.LUDO_BACKEND_URL  || 'https://ludo-backend-g2ir.onrender.com', path: '/api/ai/config', token: process.env.LUDO_ADMIN_TOKEN || '' },
};

// GET /api/admin/games/ai-config/:gameKey — fetch current AI enabled state
router.get('/ai-config/:gameKey', verifyTokenMiddleware, async (req, res) => {
  const cfg = GAME_AI_BACKENDS[req.params.gameKey];
  if (!cfg) return res.status(400).json({ ok: false, error: 'Unknown game key' });

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers['X-Admin-Token'] = cfg.token;

    const upstream = await fetch(`${cfg.url}${cfg.path}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const json = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(json);
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Upstream error: ${e.message}` });
  }
});

// PUT /api/admin/games/ai-config/:gameKey — toggle AI enabled state
router.put('/ai-config/:gameKey',
  verifyTokenMiddleware,
  [body('aiEnabled').isBoolean().withMessage('aiEnabled must be a boolean')],
  async (req, res) => {
    const errors = require('express-validator').validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });

    const cfg = GAME_AI_BACKENDS[req.params.gameKey];
    if (!cfg) return res.status(400).json({ ok: false, error: 'Unknown game key' });

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (cfg.token) headers['X-Admin-Token'] = cfg.token;

      const upstream = await fetch(`${cfg.url}${cfg.path}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ aiEnabled: req.body.aiEnabled }),
        signal: AbortSignal.timeout(10000),
      });
      const json = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json(json);
    } catch (e) {
      return res.status(502).json({ ok: false, error: `Upstream error: ${e.message}` });
    }
  }
);

module.exports = router;
