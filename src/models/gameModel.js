const db = require('../config/database');

// ── Public / bot ──────────────────────────────────────────────────────────────

const getAllGames = (callback) => {
  db.all(`SELECT * FROM games WHERE status = 'active' ORDER BY created_at DESC`, callback);
};

const getAllGamesAdmin = ({ limit, offset } = {}, callback) => {
  if (typeof limit === 'number') {
    db.all(
      `SELECT * FROM games ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset || 0],
      callback
    );
  } else {
    db.all(`SELECT * FROM games ORDER BY created_at DESC`, callback);
  }
};

const countAllGames = (callback) => {
  db.get(`SELECT COUNT(*) AS total FROM games`, callback);
};

const getGameById = (gameId, callback) => {
  db.get(`SELECT * FROM games WHERE id = ?`, [gameId], callback);
};

// ── Admin CRUD ────────────────────────────────────────────────────────────────

const createGame = ({ name, description, game_url, mini_app_url, min_players, max_players, status = 'active' }, callback) => {
  db.run(
    `INSERT INTO games (name, description, game_url, mini_app_url, min_players, max_players, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, description || null, game_url, mini_app_url || null, min_players || 1, max_players || 1, status],
    function (err) { callback(err, this.lastID); }
  );
};

const updateGame = (id, { name, game_url, mini_app_url, description, status }, callback) => {
  db.run(
    `UPDATE games
     SET name = COALESCE(?, name),
         game_url = COALESCE(?, game_url),
         mini_app_url = COALESCE(?, mini_app_url),
         description = COALESCE(?, description),
         status = COALESCE(?, status)
     WHERE id = ?`,
    [name ?? null, game_url ?? null, mini_app_url ?? null, description ?? null, status ?? null, id],
    function (err) { callback(err, this.changes); }
  );
};

const deleteGame = (id, callback) => {
  db.run(`DELETE FROM games WHERE id = ?`, [id], function (err) { callback(err, this.changes); });
};

// ── Sessions ──────────────────────────────────────────────────────────────────

const createGameSession = (userId, gameId, callback) => {
  db.run(
    `INSERT INTO game_sessions (user_id, game_id) VALUES (?, ?)`,
    [userId, gameId],
    function (err) { callback(err, this.lastID); }
  );
};

const updateGameSession = (sessionId, result, score, callback) => {
  db.run(
    `UPDATE game_sessions SET result = ?, score = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [result, score, sessionId],
    callback
  );
};

module.exports = {
  getAllGames,
  getAllGamesAdmin,
  countAllGames,
  getGameById,
  createGame,
  updateGame,
  deleteGame,
  createGameSession,
  updateGameSession,
};
