const db = require('../config/database');

// ── Queries ───────────────────────────────────────────────────────────────────

const getAll = ({ status, limit, offset } = {}, callback) => {
  const where = status ? `WHERE t.status = ?` : '';
  const params = status ? [status] : [];

  if (typeof limit === 'number') {
    db.all(
      `SELECT t.*, u.username, u.phone_number
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset || 0],
      callback
    );
  } else {
    db.all(
      `SELECT t.*, u.username, u.phone_number
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY t.created_at DESC`,
      params,
      callback
    );
  }
};

const count = ({ status } = {}, callback) => {
  if (status) {
    db.get(`SELECT COUNT(*) AS total FROM transactions WHERE status = ?`, [status], callback);
  } else {
    db.get(`SELECT COUNT(*) AS total FROM transactions`, callback);
  }
};

const getById = (id, callback) => {
  db.get(`SELECT * FROM transactions WHERE id = ?`, [id], callback);
};

const getByUser = (userId, { limit = 10 } = {}, callback) => {
  db.all(
    `SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
    callback
  );
};

const getByUserAndRef = (userId, ref, callback) => {
  db.get(
    `SELECT * FROM transactions
     WHERE user_id = ? AND transaction_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [userId, ref],
    callback
  );
};

const insert = ({ userId, type, amount, method, transactionId, transactionNumber, status = 'pending', note } = {}, callback) => {
  db.run(
    `INSERT INTO transactions (user_id, type, amount, method, transaction_id, transaction_number, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, type, amount, method || null, transactionId || null, transactionNumber || null, status, note || null],
    function (err) { callback(err, this.lastID); }
  );
};

const setStatus = (id, { status, rejection_reason } = {}, callback) => {
  db.run(
    `UPDATE transactions SET status = ?, rejection_reason = ? WHERE id = ?`,
    [status, rejection_reason || null, id],
    function (err) { callback(err, this.changes); }
  );
};

// ── Admin balance log ─────────────────────────────────────────────────────────

const logAdminTx = ({ type, amount, userId, note } = {}, callback) => {
  db.run(
    `INSERT INTO admin_balance_transactions (type, amount, user_id, note) VALUES (?, ?, ?, ?)`,
    [type, amount, userId || null, note || null],
    function (err) { if (callback) callback(err, this.lastID); }
  );
};

const getAdminBalance = (callback) => {
  db.get(`SELECT balance FROM admin_balances WHERE id = 1`, callback);
};

const adjustAdminBalance = (delta, callback) => {
  db.run(
    `UPDATE admin_balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1`,
    [delta],
    function (err) { if (callback) callback(err, this.changes); }
  );
};

// ── Summary ───────────────────────────────────────────────────────────────────

const getSummary = (callback) => {
  db.get(
    `SELECT
       COALESCE(SUM(balance), 0) AS total_balance,
       COUNT(*) AS total_users
     FROM balances`,
    (err, balRow) => {
      if (err) return callback(err);
      db.get(
        `SELECT
           COALESCE(SUM(CASE WHEN type='deposit'  AND status='done' THEN amount ELSE 0 END), 0) AS total_deposited,
           COALESCE(SUM(CASE WHEN type='withdraw' AND status='done' THEN amount ELSE 0 END), 0) AS total_withdrawn,
           COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END), 0)                  AS pending_amount,
           COUNT(CASE WHEN status='pending'  THEN 1 END) AS pending_count,
           COUNT(CASE WHEN status='done'     THEN 1 END) AS done_count,
           COUNT(CASE WHEN status='rejected' THEN 1 END) AS rejected_count
         FROM transactions`,
        (err2, txRow) => {
          if (err2) return callback(err2);
          callback(null, { ...balRow, ...txRow });
        }
      );
    }
  );
};

const getCashierTransactions = (callback) => {
  db.all(
    `SELECT
       abt.id, abt.type, abt.amount, abt.note, abt.created_at,
       abt.user_id AS cashier_id,
       c.name AS cashier_name, c.username AS cashier_username
     FROM admin_balance_transactions abt
     LEFT JOIN cashiers c ON c.id = abt.user_id
     WHERE abt.type IN ('cashier_deposit', 'cashier_withdraw')
     ORDER BY abt.created_at DESC`,
    [],
    callback
  );
};

module.exports = {
  getAll, count, getById, getByUser, getByUserAndRef,
  insert, setStatus,
  logAdminTx, getAdminBalance, adjustAdminBalance,
  getSummary, getCashierTransactions,
};
