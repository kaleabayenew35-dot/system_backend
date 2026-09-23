const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
if (process.env.NODE_ENV === 'production' && (!configuredDatabaseUrl || configuredDatabaseUrl.endsWith('.db'))) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection string in production.');
}

const databaseUrl = configuredDatabaseUrl || 'postgresql://postgres:password@localhost:5432/system_backend';
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 15,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (error) => console.error('[db] PostgreSQL pool error:', error.message));

const autoIdTables = new Set([
  'users', 'players', 'games', 'balances', 'game_sessions', 'bet_logs', 'cashiers',
  'game_tokens', 'transactions', 'admin_balance_transactions', 'promotions',
]);

function translateSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function tableNameFromInsert(sql) {
  return sql.match(/^\s*INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+([\w"]+)/i)?.[1]?.replace(/"/g, '').toLowerCase();
}

function addReturningId(sql) {
  const table = tableNameFromInsert(sql);
  if (!table || !autoIdTables.has(table) || /\bRETURNING\b/i.test(sql)) return sql;
  return `${sql.trim().replace(/;$/, '')} RETURNING id`;
}

async function rawQuery(sql, params = []) {
  return pool.query(translateSql(sql), params);
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, telegram_id TEXT UNIQUE NOT NULL,
    phone_number TEXT NOT NULL, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_unique ON users(phone_number)`,
  `CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL,
    total_games_played INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
    game_url TEXT, mini_app_url TEXT, backend_url TEXT, min_players INTEGER DEFAULT 1,
    max_players INTEGER DEFAULT 1, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS balances (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE,
    balance REAL DEFAULT 0, coins INTEGER DEFAULT 100, last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS game_sessions (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, game_id INTEGER NOT NULL,
    result TEXT, score INTEGER DEFAULT 0, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ended_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS bet_logs (
    id SERIAL PRIMARY KEY, game_id TEXT NOT NULL, player_id TEXT NOT NULL,
    phone TEXT, bet_amount REAL NOT NULL, backend_url TEXT, request_body TEXT, response_body TEXT,
    status TEXT DEFAULT 'success', error TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS cashiers (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, balance REAL DEFAULT 0, status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS game_tokens (
    id SERIAL PRIMARY KEY, game_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
    label TEXT, backend_url TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL,
    amount REAL NOT NULL, method TEXT, transaction_id TEXT, transaction_number TEXT,
    transaction_ref TEXT, status TEXT DEFAULT 'pending', rejection_reason TEXT, note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS promotions (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, button_text TEXT NOT NULL,
    button_url TEXT, image_data TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS admin_balances (
    id INTEGER PRIMARY KEY, balance REAL NOT NULL DEFAULT 0.00, last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS admin_balance_transactions (
    id SERIAL PRIMARY KEY, type TEXT NOT NULL, amount REAL NOT NULL,
    user_id INTEGER, note TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS bot_sessions (
    telegram_id TEXT PRIMARY KEY, token TEXT NOT NULL, user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_active INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bot_conversation_states (
    chat_id TEXT PRIMARY KEY, step TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', expires_at INTEGER NOT NULL
  )`,
];

const databaseReady = (async () => {
  for (const statement of schemaStatements) await rawQuery(statement);
  await rawQuery('INSERT INTO admin_balances (id, balance) VALUES (1, 10000.00) ON CONFLICT DO NOTHING');

  const username = process.env.ADMIN_USERNAME || 'kaleab';
  const password = process.env.ADMIN_PASSWORD || 'Kale@1513';
  const passwordHash = bcrypt.hashSync(password, 10);
  await rawQuery(
    'INSERT INTO users (telegram_id, phone_number, username, password) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    ['999999', '+1234567890', username, passwordHash]
  );
  console.log('[db] PostgreSQL schema ready');
})().catch((error) => {
  console.error('[db] PostgreSQL initialization failed:', error);
  throw error;
});

function callbackError(callback, error) {
  if (typeof callback === 'function') callback(error);
}

const db = {
  run(sql, params = [], callback = () => {}) {
    if (typeof params === 'function') { callback = params; params = []; }
    databaseReady.then(async () => {
      const result = await rawQuery(addReturningId(sql), params);
      const row = result.rows[0];
      callback.call({ lastID: row?.id, changes: result.rowCount || 0 }, null);
    }).catch((error) => callbackError(callback, error));
  },

  get(sql, params = [], callback = () => {}) {
    if (typeof params === 'function') { callback = params; params = []; }
    databaseReady.then(() => rawQuery(sql, params))
      .then((result) => callback(null, result.rows[0]))
      .catch((error) => callbackError(callback, error));
  },

  all(sql, params = [], callback = () => {}) {
    if (typeof params === 'function') { callback = params; params = []; }
    databaseReady.then(() => rawQuery(sql, params))
      .then((result) => callback(null, result.rows))
      .catch((error) => callbackError(callback, error));
  },

  serialize(callback) { callback(); },
  close(callback = () => {}) { databaseReady.then(() => pool.end()).then(() => callback(null)).catch(callback); },
};

function defaultBackendUrl(name) {
  const key = String(name || '').toLowerCase();
  if (key.includes('bingo')) return process.env.BINGO_BACKEND_URL || 'https://bingo-backend-m1yf.onrender.com';
  if (key.includes('dama')) return process.env.DAMA_BACKEND_URL || 'https://dama-backend.onrender.com';
  if (key.includes('ludo')) return process.env.LUDO_BACKEND_URL || 'https://ludo-backend-wykz.onrender.com';
  if (key.includes('tic') || key.includes('xo')) return process.env.XO_BACKEND_URL || 'https://tic-tak-backend.onrender.com';
  return null;
}

const seedDefaultGamesIfEmpty = (callback = () => {}) => {
  db.get('SELECT COUNT(*) AS count FROM games', (err, row) => {
    if (err) return callback(err);
    if (Number(row?.count || 0) > 0) return callback(null, { skipped: true });
    const games = [
      ['Dama', 'A classic board game of strategy and capture.', 2, 2],
      ['Bingo', 'A colorful number-calling game full of excitement.', 1, 8],
      ['Ludo', 'Race your tokens to the finish in this classic board game.', 2, 4],
      ['Flappy Bird', 'Navigate your bird through pipes.', 1, 1],
      ['2048', 'Combine tiles to reach the 2048 tile.', 1, 1],
      ['Snake', 'Eat food and grow without hitting the walls.', 1, 1],
    ];
    Promise.all(games.map(([name, description, min, max]) => new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO games (name, description, game_url, mini_app_url, backend_url, min_players, max_players, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
        [name, description, null, null, defaultBackendUrl(name), min, max],
        (insertError) => insertError ? reject(insertError) : resolve()
      );
    }))).then(() => callback(null, { inserted: true })).catch(callback);
  });
};

db.seedDefaultGamesIfEmpty = seedDefaultGamesIfEmpty;
databaseReady.then(() => seedDefaultGamesIfEmpty()).catch((error) => console.error('[db] game seed failed:', error.message));

module.exports = db;
module.exports.databaseReady = databaseReady;
