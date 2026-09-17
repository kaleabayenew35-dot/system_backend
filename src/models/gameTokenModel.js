const db     = require('../config/database');
const crypto = require('crypto');
const axios  = require('axios');

// ── Queries ───────────────────────────────────────────────────────────────────

const getAll = ({ limit, offset } = {}, callback) => {
  if (typeof limit === 'number') {
    db.all(
      `SELECT gt.*, g.name AS game_name, g.status AS game_status
       FROM game_tokens gt
       JOIN games g ON g.id = gt.game_id
       ORDER BY gt.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset || 0],
      callback
    );
  } else {
    db.all(
      `SELECT gt.*, g.name AS game_name, g.status AS game_status
       FROM game_tokens gt
       JOIN games g ON g.id = gt.game_id
       ORDER BY gt.created_at DESC`,
      callback
    );
  }
};

const count = (callback) => {
  db.get(`SELECT COUNT(*) AS total FROM game_tokens`, callback);
};

const getByGame = (gameId, callback) => {
  db.all(
    `SELECT gt.*, g.name AS game_name
     FROM game_tokens gt
     JOIN games g ON g.id = gt.game_id
     WHERE gt.game_id = ?
     ORDER BY gt.created_at DESC`,
    [gameId],
    callback
  );
};

const getActiveByGame = (gameId, callback) => {
  db.get(
    `SELECT token FROM game_tokens WHERE game_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [gameId],
    callback
  );
};

const findByToken = (token, callback) => {
  db.get(
    `SELECT gt.*, g.id AS game_id, g.name AS game_name, g.status AS game_status
     FROM game_tokens gt
     JOIN games g ON g.id = gt.game_id
     WHERE gt.token = ?`,
    [token],
    callback
  );
};

const create = ({ game_id, label, backend_url }, callback) => {
  const token = 'GT-' + crypto.randomBytes(16).toString('hex').toUpperCase();
  db.run(
    `INSERT INTO game_tokens (game_id, token, label, backend_url) VALUES (?, ?, ?, ?)`,
    [game_id, token, label || null, backend_url || null],
    function (err) { callback(err, { id: this.lastID, token }); }
  );
};

const ensureDemoToken = (callback) => {
  db.get(`SELECT id FROM games LIMIT 1`, (err, gameRow) => {
    if (err) return callback(err);
    if (!gameRow) return callback(null, { created: false, reused: false, token: null, reason: 'no-games' });

    db.get(
      `SELECT id, token, status, backend_url FROM game_tokens WHERE game_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [gameRow.id],
      (lookupErr, existingRow) => {
        if (lookupErr) return callback(lookupErr);
        if (existingRow) {
          console.log('[game-token] reused active token', { token: existingRow.token, gameId: gameRow.id, status: existingRow.status });
          return callback(null, { created: false, reused: true, token: existingRow.token, row: existingRow });
        }

        const token = 'GT-' + crypto.randomBytes(16).toString('hex').toUpperCase();
        db.run(
          `INSERT INTO game_tokens (game_id, token, label, backend_url, status) VALUES (?, ?, ?, ?, ?)`,
          [gameRow.id, token, 'Demo Dama Token', null, 'active'],
          function (insertErr) {
            if (insertErr) return callback(insertErr);
            console.log('[game-token] created new token', { token, gameId: gameRow.id });
            callback(null, { created: true, reused: false, token, row: { id: this.lastID, token } });
          }
        );
      }
    );
  });
};

const syncTokenToDamaBackend = (token, callback) => {
  const backendUrl = process.env.DAMA_BACKEND_URL || process.env.DAMA_BACKEND || null;
  if (!backendUrl) {
    return callback(null, { synced: false, reason: 'no-backend-url' });
  }

  const enforceExplicitSync = process.env.ENFORCE_DAMA_SYNC === 'true';
  if (!enforceExplicitSync) {
    console.info('[syncTokenToDamaBackend] sync disabled by config; skipping');
    return callback(null, { synced: false, reason: 'sync-disabled-by-config' });
  }

  // Avoid accidentally POSTing to our own server (causes self-call loops)
  try {
    const parsed = new URL(backendUrl);
    const selfHost = process.env.SELF_HOSTNAME || `localhost:${process.env.PORT || 5000}`;
    if (parsed.host === selfHost || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      console.warn('[syncTokenToDamaBackend] backendUrl resolves to this service, skipping sync');
      return callback(null, { synced: false, reason: 'backend-is-self' });
    }
  } catch (e) {
    // If URL parsing fails, proceed — runtime may provide a non-URL value
  }

  const payload = { action: 'register_token', token, source: 'system-backend' };
  axios.post(`${backendUrl.replace(/\/$/, '')}/dama`, payload, { timeout: 8000 })
    .then((response) => callback(null, { synced: true, response: response.data }))
    .catch((err) => callback(null, { synced: false, reason: err.message }));
};

const update = (id, { label, status, token, backend_url }, callback) => {
  if (token) {
    // Check uniqueness first
    db.get(
      `SELECT id FROM game_tokens WHERE token = ? AND id != ?`,
      [token, id],
      (err, existing) => {
        if (err) return callback(err);
        if (existing) return callback(Object.assign(new Error('Token value already exists'), { code: 'DUPLICATE' }));
        db.run(
          `UPDATE game_tokens SET token = ?, label = ?, status = ?, backend_url = ? WHERE id = ?`,
          [token, label || null, status || 'active', backend_url || null, id],
          function (e) { callback(e, this.changes); }
        );
      }
    );
  } else {
    db.run(
      `UPDATE game_tokens SET label = ?, status = ?, backend_url = ? WHERE id = ?`,
      [label || null, status || 'active', backend_url || null, id],
      function (err) { callback(err, this.changes); }
    );
  }
};

const remove = (id, callback) => {
  db.run(`DELETE FROM game_tokens WHERE id = ?`, [id], function (err) { callback(err, this.changes); });
};

module.exports = {
  getAll,
  count,
  getByGame,
  getActiveByGame,
  findByToken,
  create,
  ensureDemoToken,
  syncTokenToDamaBackend,
  update,
  remove,
};
