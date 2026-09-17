const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', '..', 'database.db');

if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('[db] using database file at:', dbPath, process.env.DB_PATH ? '(persistent)' : '(EPHEMERAL — will reset on restart!)');
    initializeDatabase();
  }
});

module.exports = db;

const insertDefaultGames = (callback = () => {}) => {
  const sampleGames = [
    {
      name: 'Dama',
      description: 'A classic board game of strategy and capture.',
      game_url: 'https://example.com/games/dama',
      mini_app_url: 'https://t.me/your_bot_name/app?game=dama',
      min_players: 2,
      max_players: 2
    },
    {
      name: 'Bingo',
      description: 'A colorful number-calling game full of excitement.',
      game_url: 'https://example.com/games/bingo',
      mini_app_url: 'https://t.me/your_bot_name/app?game=bingo',
      min_players: 1,
      max_players: 8
    },
    {
      name: 'Ludo',
      description: 'Race your tokens to the finish in this classic board game.',
      game_url: 'https://example.com/games/ludo',
      mini_app_url: 'https://t.me/your_bot_name/app?game=ludo',
      min_players: 2,
      max_players: 4
    },
    {
      name: 'Flappy Bird',
      description: 'Navigate your bird through pipes and beat your score.',
      game_url: 'https://example.com/games/flappy-bird',
      mini_app_url: 'https://t.me/your_bot_name/app?game=flappy',
      min_players: 1,
      max_players: 1
    },
    {
      name: '2048',
      description: 'Combine tiles to reach the 2048 tile.',
      game_url: 'https://example.com/games/2048',
      mini_app_url: 'https://t.me/your_bot_name/app?game=2048',
      min_players: 1,
      max_players: 1
    },
    {
      name: 'Snake',
      description: 'Eat food and grow without hitting the walls.',
      game_url: 'https://example.com/games/snake',
      mini_app_url: 'https://t.me/your_bot_name/app?game=snake',
      min_players: 1,
      max_players: 1
    }
  ];

  db.get(`SELECT COUNT(*) AS count FROM games`, (err, row) => {
    if (err) {
      console.error('Error checking games table:', err.message);
      callback(err);
      return;
    }

    if (row.count > 0) {
      callback(null, { skipped: true });
      return;
    }

    sampleGames.forEach((game) => {
      db.run(
        `INSERT OR IGNORE INTO games (name, description, game_url, mini_app_url, min_players, max_players, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [game.name, game.description, game.game_url, game.mini_app_url, game.min_players, game.max_players],
        (insertErr) => {
          if (insertErr) {
            console.error(`Error inserting default game ${game.name}:`, insertErr.message);
            callback(insertErr);
          }
        }
      );
    });

    console.log('Inserted default games into database');
    callback(null, { inserted: true });
  });
};

const seedDefaultGamesIfEmpty = (callback = () => {}) => {
  db.get('SELECT COUNT(*) AS count FROM games', (err, row) => {
    if (err) {
      console.error('Error checking games table before seeding:', err.message);
      callback(err);
      return;
    }

    if (row && row.count > 0) {
      console.log('[db] skipping default games seed because games table already has data');
      callback(null, { skipped: true });
      return;
    }

    insertDefaultGames(callback);
  });
};

module.exports.seedDefaultGamesIfEmpty = seedDefaultGamesIfEmpty;

const ensureGamesSchema = () => {
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      game_url TEXT,
      mini_app_url TEXT,
      min_players INTEGER DEFAULT 1,
      max_players INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating games table:', err.message);
      return;
    }

    db.all(`PRAGMA table_info(games)`, (pragmaErr, columns) => {
      if (pragmaErr) {
        console.error('Error reading games schema:', pragmaErr.message);
        return;
      }

      const hasMiniAppUrl = columns.some((column) => column.name === 'mini_app_url');
      if (!hasMiniAppUrl) {
        db.run(`ALTER TABLE games ADD COLUMN mini_app_url TEXT`, (alterErr) => {
          if (alterErr) {
            console.error('Error adding mini_app_url column:', alterErr.message);
          }
          seedDefaultGamesIfEmpty();
        });
      } else {
        seedDefaultGamesIfEmpty();
      }
    });
  });
};

const initializeDatabase = () => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      phone_number TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Players table
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_games_played INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Games table
  ensureGamesSchema();

  // Balance/Wallet table
  db.run(`
    CREATE TABLE IF NOT EXISTS balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      balance REAL DEFAULT 0,
      coins INTEGER DEFAULT 100,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Game Session table
  db.run(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_id INTEGER NOT NULL,
      result TEXT,
      score INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  // Bet logs table for Dama-style start-bet flow
  db.run(`
    CREATE TABLE IF NOT EXISTS bet_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      phone TEXT,
      bet_amount REAL NOT NULL,
      backend_url TEXT,
      request_body TEXT,
      response_body TEXT,
      status TEXT DEFAULT 'success',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Cashiers table
  db.run(`
    CREATE TABLE IF NOT EXISTS cashiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      balance REAL DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Game Tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS game_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      label TEXT,
      backend_url TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `, () => {
    // Migrate: add backend_url if missing
    db.all('PRAGMA table_info(game_tokens)', (err, cols) => {
      if (err || !cols) return;
      if (!cols.some(c => c.name === 'backend_url')) {
        db.run('ALTER TABLE game_tokens ADD COLUMN backend_url TEXT', (e) => {
          if (e) console.error('Migration error (game_tokens):', e.message);
        });
      }
    });
  });

  // Transactions table
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('deposit', 'withdraw')),
      amount REAL NOT NULL,
      method TEXT,
      transaction_id TEXT,
      transaction_number TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'rejected')),
      rejection_reason TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `, () => {
    // Migrate existing table: add new columns if missing
    const newCols = [
      { name: 'method',             def: 'ALTER TABLE transactions ADD COLUMN method TEXT' },
      { name: 'transaction_id',     def: 'ALTER TABLE transactions ADD COLUMN transaction_id TEXT' },
      { name: 'transaction_number', def: 'ALTER TABLE transactions ADD COLUMN transaction_number TEXT' },
      { name: 'transaction_ref',    def: 'ALTER TABLE transactions ADD COLUMN transaction_ref TEXT' },
      { name: 'status',             def: "ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'pending'" },
      { name: 'rejection_reason',   def: 'ALTER TABLE transactions ADD COLUMN rejection_reason TEXT' },
    ];
    db.all('PRAGMA table_info(transactions)', (err, cols) => {
      if (err || !cols) return;
      const existing = cols.map(c => c.name);
      newCols.forEach(({ name, def }) => {
        if (!existing.includes(name)) {
          db.run(def, (e) => { if (e) console.error('Migration error:', e.message); });
        }
      });
    });
  });

  // Admin Balance table
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      balance REAL NOT NULL DEFAULT 0.00,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, () => {
    db.run(`
      INSERT OR IGNORE INTO admin_balances (id, balance) VALUES (1, 10000.00)
    `);
  });

  // Admin Balance Transactions table
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      user_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Bot sessions table (replaces better-sqlite3 bot.db sessions table)
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      telegram_id  TEXT    PRIMARY KEY,
      token        TEXT    NOT NULL,
      user_id      TEXT    NOT NULL,
      created_at   INTEGER NOT NULL,
      last_active  INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    )
  `);

  // Bot conversation state table (replaces better-sqlite3 bot.db conversation_state table)
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_conversation_states (
      chat_id    TEXT    PRIMARY KEY,
      step       TEXT    NOT NULL,
      data       TEXT    NOT NULL DEFAULT '{}',
      expires_at INTEGER NOT NULL
    )
  `);

  // Bet logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS bet_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      phone TEXT,
      bet_amount REAL NOT NULL,
      backend_url TEXT,
      request_body TEXT,
      response_body TEXT,
      status TEXT DEFAULT 'success',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const gameTokenModel = require('../models/gameTokenModel');

  gameTokenModel.ensureDemoToken((tokenErr, result) => {
    if (tokenErr) {
      console.error('Error ensuring demo game token:', tokenErr.message);
      return;
    }

    if (result?.created) {
      console.log('[bootstrap] created demo token', { token: result.token, gameId: result.row?.id });
      gameTokenModel.syncTokenToDamaBackend(result.token, (syncErr, syncResult) => {
        if (syncErr) {
          console.error('Error syncing demo token to dama-backend:', syncErr.message);
        } else {
          console.log('[bootstrap] dama-backend sync', syncResult);
        }
      });
    } else if (result?.reused) {
      console.log('[bootstrap] reused existing demo token', { token: result.token });
    } else {
      console.log('[bootstrap] no demo token created', result);
    }
  });

  seedDefaultGamesIfEmpty();
  console.log('Database tables initialized');
};

