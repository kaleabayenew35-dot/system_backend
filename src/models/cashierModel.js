const db   = require('../config/database');
const bcrypt = require('bcryptjs');

// ── CRUD ──────────────────────────────────────────────────────────────────────

const getAll = ({ limit, offset } = {}, callback) => {
  if (typeof limit === 'number') {
    db.all(
      `SELECT id, name, username, balance, status, created_at FROM cashiers
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset || 0],
      callback
    );
  } else {
    db.all(
      `SELECT id, name, username, balance, status, created_at FROM cashiers ORDER BY created_at DESC`,
      callback
    );
  }
};

const count = (callback) => {
  db.get(`SELECT COUNT(*) AS total FROM cashiers`, callback);
};

const getById = (id, callback) => {
  db.get(`SELECT * FROM cashiers WHERE id = ?`, [id], callback);
};

const create = ({ name, username, password, balance = 0 }, callback) => {
  const hashed = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO cashiers (name, username, password, balance) VALUES (?, ?, ?, ?)`,
    [name, username, hashed, parseFloat(balance) || 0],
    function (err) { callback(err, this.lastID); }
  );
};

const update = (id, { name, username, password, status }, callback) => {
  if (password) {
    const hashed = bcrypt.hashSync(password, 10);
    db.run(
      `UPDATE cashiers SET name=?, username=?, password=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [name, username, hashed, status || 'active', id],
      function (err) { callback(err, this.changes); }
    );
  } else {
    db.run(
      `UPDATE cashiers SET name=?, username=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [name, username, status || 'active', id],
      function (err) { callback(err, this.changes); }
    );
  }
};

const remove = (id, callback) => {
  db.run(`DELETE FROM cashiers WHERE id=?`, [id], function (err) { callback(err, this.changes); });
};

// ── Balance ───────────────────────────────────────────────────────────────────

const getBalance = (id, callback) => {
  db.get(`SELECT balance FROM cashiers WHERE id = ?`, [id], callback);
};

const adjustBalance = (id, delta, callback) => {
  db.run(
    `UPDATE cashiers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [delta, id],
    function (err) { callback(err, this.changes); }
  );
};

module.exports = { getAll, count, getById, create, update, remove, getBalance, adjustBalance };
