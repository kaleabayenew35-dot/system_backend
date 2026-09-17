require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 5000;

// Trust first proxy hop (app sits behind one proxy)
app.set('trust proxy', 1);

const gameApiRoutes   = require('./routes/gameApiRoutes');
const xoRoutes        = require('./routes/xo');
const verifyGameToken = require('./middleware/verifyGameToken');
const { createKeepAliveScheduler } = require('./utils/keepAlive');
const { resolveLaunchToken } = require('./utils/launchToken');

// ── API endpoint registry (unchanged — other services depend on this list) ────
const apiEndpoints = [
  { method: 'GET',    path: '/api/health',                              description: 'Health check' },
  { method: 'GET',    path: '/api',                                     description: 'API overview' },
  { method: 'GET',    path: '/api/endpoints',                           description: 'List all available API endpoints' },
  { method: 'POST',   path: '/api/users/register',                      description: 'Register a new user' },
  { method: 'POST',   path: '/api/users/login',                         description: 'Login a user' },
  { method: 'POST',   path: '/api/users/auto-login',                    description: 'Auto-login with telegram ID' },
  { method: 'GET',    path: '/api/users/check/:telegram_id',            description: 'Check if a user exists' },
  { method: 'GET',    path: '/api/users/:id',                           description: 'Get a user by ID' },
  { method: 'GET',    path: '/api/users/:id/balance',                   description: 'Get user balance' },
  { method: 'PUT',    path: '/api/users/:id/username',                  description: 'Update username' },
  { method: 'PUT',    path: '/api/users/:id/password',                  description: 'Update password' },
  { method: 'GET',    path: '/api/games',                               description: 'Get all games' },
  { method: 'GET',    path: '/api/games/:id',                           description: 'Get a game by ID' },
  { method: 'POST',   path: '/api/games/:id/start',                     description: 'Start a game session' },
  { method: 'POST',   path: '/api/games/session/:session_id/end',       description: 'End a game session' },
  { method: 'POST',   path: '/api/admin/games/login',                   description: 'Admin login' },
  { method: 'GET',    path: '/api/admin/games/users',                   description: 'Get all users (admin)' },
  { method: 'GET',    path: '/api/admin/games/admin-balance',           description: 'Get admin balance' },
  { method: 'GET',    path: '/api/admin/games/all-games',               description: 'Get all games including inactive (admin)' },
  { method: 'POST',   path: '/api/admin/games',                         description: 'Create a game (admin)' },
  { method: 'PUT',    path: '/api/admin/games/:id',                     description: 'Update a game (admin)' },
  { method: 'DELETE', path: '/api/admin/games/:id',                     description: 'Delete a game (admin)' },
  { method: 'GET',    path: '/api/scores/leaderboard',                  description: 'Get leaderboard' },
  { method: 'GET',    path: '/api/scores/:user_id',                     description: 'Get user scores' },
  { method: 'POST',   path: '/api/game-api/player-balance',             description: 'Get player balance for a game' },
  { method: 'POST',   path: '/api/game-api/game-action',                description: 'Process game balance action' },
  { method: 'POST',   path: '/api/game-api/verify',                     description: 'Verify a player' },
  { method: 'POST',   path: '/api/verify-launch-token',                 description: 'Verify a launch token' },
  { method: 'POST',   path: '/api/games/start-bet',                     description: 'Start a Dama-style bet' },
  { method: 'POST',   path: '/api/xo/player-balance',                  description: 'Get player balance for XO game' },
  { method: 'POST',   path: '/api/xo/game-action',                     description: 'Process XO game balance action' },
  { method: 'POST',   path: '/api/xo/verify',                          description: 'Verify an XO player' },
  { method: 'POST',   path: '/xo',                                     description: 'Direct XO callback for balance and game actions' },
  { method: 'POST',   path: '/dama',                                    description: 'Direct partner callback for balance and game actions' },
  // Bot session & conversation state (replaces local bot.db)
  { method: 'PUT',    path: '/api/bot/sessions/:telegramId',            description: 'Upsert bot session' },
  { method: 'GET',    path: '/api/bot/sessions/:telegramId',            description: 'Get bot session' },
  { method: 'PATCH',  path: '/api/bot/sessions/:telegramId/touch',      description: 'Refresh session last_active' },
  { method: 'PATCH',  path: '/api/bot/sessions/:telegramId/token',      description: 'Refresh session token' },
  { method: 'DELETE', path: '/api/bot/sessions/:telegramId',            description: 'Delete bot session' },
  { method: 'PUT',    path: '/api/bot/states/:chatId',                  description: 'Upsert conversation state' },
  { method: 'GET',    path: '/api/bot/states/:chatId',                  description: 'Get conversation state' },
  { method: 'PATCH',  path: '/api/bot/states/:chatId',                  description: 'Patch conversation state data' },
  { method: 'DELETE', path: '/api/bot/states/:chatId',                  description: 'Delete conversation state' },
  { method: 'DELETE', path: '/api/bot/states',                          description: 'Purge expired conversation states' },
];

// ── CORS ──────────────────────────────────────────────────────────────────────
const defaultAllowedOrigins = [
  // Local development
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
  // Production — all three deployed services
  'https://system-backend-jbnd.onrender.com',
  'https://system-telegram.onrender.com',
  'https://system-admin-8dis.onrender.com',
  // Legacy / previous deploy URLs
  'https://dama-game-backend.onrender.com',
  'https://dama-game-6d2b.onrender.com',
];

const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Token'],
};

// ── Security & observability middleware ───────────────────────────────────────
app.use(helmet());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Request logging (skip in test env)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// General rate limiter — 200 req / 15 min per IP (relaxed for game-api)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

// Stricter limiter for auth endpoints — 20 req / 15 min
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts, please try again later.' },
});

app.use(generalLimiter);
app.use(express.json());

// ── Auth rate limits ──────────────────────────────────────────────────────────
app.use('/api/users/register',     authLimiter);
app.use('/api/users/login',        authLimiter);
app.use('/api/admin/games/login',  authLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/api/verify-launch-token', (req, res) => {
  const { launch } = req.body;
  console.log('[verify-launch-token] request', { method: req.method, body: req.body });

  if (!launch) {
    console.warn('[verify-launch-token] missing launch token');
    return res.status(401).json({ valid: false, reason: 'launch token is required' });
  }

  resolveLaunchToken(launch, (resolveErr, result) => {
    if (resolveErr) {
      console.error('[verify-launch-token] verification error', { name: resolveErr?.name, message: resolveErr?.message });
      return res.status(401).json({ valid: false, reason: resolveErr.message || 'launch token verification failed' });
    }

    if (!result?.valid) {
      console.warn('[verify-launch-token] unresolved payload', result?.reason);
      return res.status(401).json({ valid: false, reason: result?.reason || 'launch payload could not be resolved' });
    }

    console.log('[verify-launch-token] success', {
      phone: result.user.phone,
      username: result.user.username,
      balance: result.user.balance,
      gameId: result.payload.gameId,
    });

    return res.status(200).json({
      valid: true,
      phone: result.user.phone,
      username: result.user.username,
      balance: result.user.balance,
      gameId: result.payload.gameId,
      user: result.user,
    });
  });
});

app.use('/api/users',        require('./routes/userRoutes'));
app.use('/api/games',        require('./routes/gameRoutes'));
app.use('/api/admin/games',  require('./routes/adminRoutes'));
app.use('/api/scores',       require('./routes/scoreRoutes'));
app.use('/api/bot',          require('./routes/botRoutes'));
app.use('/api/game-api',     gameApiRoutes);
app.use('/api/xo',           xoRoutes);
app.post('/xo', verifyGameToken, xoRoutes.handleXoCallback);   // ← token-protected XO webhook
app.post('/dama', verifyGameToken, gameApiRoutes.handleDamaCallback);   // ← token-protected webhook

// ── Utility endpoints ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  success: true,
  message: 'Telegram Games Backend API is running',
  docs: '/api/health',
}));

app.get('/api', (req, res) => res.json({
  success: true,
  message: 'Telegram Games Backend API',
  count: apiEndpoints.length,
  endpoints: apiEndpoints,
}));

app.get('/api/endpoints', (req, res) => res.json({
  success: true,
  count: apiEndpoints.length,
  endpoints: apiEndpoints,
}));

app.get('/api/health', (req, res) => res.json({
  status: 'Backend is running',
  timestamp: new Date().toISOString(),
}));

// ── Global error handler ──────────────────────────────────────────────────────
// Consistent shape: { success: false, error: "...", code?: "..." }
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error('[unhandled error]', error);

  // CORS rejection
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'CORS: origin not allowed' });
  }

  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message,
  });
});

// 404 handler
app.use((req, res) => {
  console.warn('[unmatched-route]', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'user-agent': req.headers['user-agent'],
    },
  });
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`   Health:    GET /api/health`);
  console.log(`   Endpoints: GET /api/endpoints`);
  console.log(`   Register:  POST /api/users/register`);
  console.log(`   Login:     POST /api/users/login`);

  const keepAliveEnabled = process.env.KEEP_ALIVE_ENABLED === 'true';
  const keepAliveTarget = process.env.KEEP_ALIVE_TARGET;
  const keepAliveIntervalMs = process.env.KEEP_ALIVE_INTERVAL_MS;

  if (keepAliveEnabled) {
    createKeepAliveScheduler({
      enabled: true,
      targetUrl: keepAliveTarget,
      intervalMs: keepAliveIntervalMs,
    });
  }
});

module.exports = app;
