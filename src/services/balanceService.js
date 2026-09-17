/**
 * balanceService.js
 *
 * Single place for every "update balance + log transaction + update admin balance"
 * operation. All callers (admin deposit/withdraw, approve transaction, cashier
 * deposit/withdraw) use these functions so the logic stays consistent.
 */

const db              = require('../config/database');
const transactionModel = require('../models/transactionModel');

/**
 * Credit a user's balance and record the transaction.
 * Admin balance is NOT affected (use adminCreditUser / adminDebitUser for that).
 *
 * @param {number} userId
 * @param {number} amount  positive value
 * @param {object} txMeta  { type, method, status, note }
 * @param {Function} callback  (err, newBalance)
 */
const creditUserBalance = (userId, amount, txMeta = {}, callback) => {
  db.get(`SELECT balance FROM balances WHERE user_id = ?`, [userId], (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(Object.assign(new Error('Balance record not found'), { code: 'NOT_FOUND' }));

    db.run(
      `UPDATE balances SET balance = balance + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
      [amount, userId],
      (updateErr) => {
        if (updateErr) return callback(updateErr);
        const newBalance = (row.balance || 0) + amount;
        transactionModel.insert({
          userId,
          type:              txMeta.type   || 'deposit',
          amount,
          method:            txMeta.method || null,
          status:            txMeta.status || 'done',
          note:              txMeta.note   || null,
        }, (logErr) => {
          // Log failure is non-fatal; still return success
          if (logErr) console.error('[balanceService] tx log error:', logErr.message);
          callback(null, newBalance);
        });
      }
    );
  });
};

/**
 * Debit a user's balance. Returns error if insufficient.
 *
 * @param {number} userId
 * @param {number} amount  positive value
 * @param {object} txMeta  { type, method, status, note }
 * @param {Function} callback  (err, newBalance)
 */
const debitUserBalance = (userId, amount, txMeta = {}, callback) => {
  db.get(`SELECT balance FROM balances WHERE user_id = ?`, [userId], (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(Object.assign(new Error('Balance record not found'), { code: 'NOT_FOUND' }));
    if ((row.balance || 0) < amount) {
      return callback(Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT' }));
    }

    db.run(
      `UPDATE balances SET balance = balance - ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`,
      [amount, userId],
      (updateErr) => {
        if (updateErr) return callback(updateErr);
        const newBalance = (row.balance || 0) - amount;
        transactionModel.insert({
          userId,
          type:   txMeta.type   || 'withdraw',
          amount,
          method: txMeta.method || null,
          status: txMeta.status || 'done',
          note:   txMeta.note   || null,
        }, (logErr) => {
          if (logErr) console.error('[balanceService] tx log error:', logErr.message);
          callback(null, newBalance);
        });
      }
    );
  });
};

/**
 * Admin deposits to a user:
 *   user balance += amount
 *   admin balance -= amount
 *   transaction + admin_balance_transaction logged
 */
const adminCreditUser = (userId, amount, note, callback) => {
  creditUserBalance(userId, amount, { type: 'deposit', status: 'done', note: note || 'Admin deposit' }, (err, newBalance) => {
    if (err) return callback(err);
    transactionModel.adjustAdminBalance(-amount, (adminErr) => {
      if (adminErr) console.error('[balanceService] admin balance deduct error:', adminErr.message);
      transactionModel.logAdminTx({ type: 'deposit_deduction', amount, userId, note: note || 'Admin deposit deduction' });
      callback(null, newBalance);
    });
  });
};

/**
 * Admin withdraws from a user:
 *   user balance -= amount
 *   admin balance += amount
 *   transaction + admin_balance_transaction logged
 */
const adminDebitUser = (userId, amount, note, callback) => {
  debitUserBalance(userId, amount, { type: 'withdraw', status: 'done', note: note || 'Admin withdraw' }, (err, newBalance) => {
    if (err) return callback(err);
    transactionModel.adjustAdminBalance(+amount, (adminErr) => {
      if (adminErr) console.error('[balanceService] admin balance add error:', adminErr.message);
      transactionModel.logAdminTx({ type: 'withdraw_addition', amount, userId, note: note || 'Admin withdraw addition' });
      callback(null, newBalance);
    });
  });
};

/**
 * Approve a pending transaction:
 *   deposit  → credit user, debit admin
 *   withdraw → debit user, credit admin
 */
const approveTransaction = (tx, callback) => {
  if (tx.type === 'deposit') {
    adminCreditUser(tx.user_id, tx.amount, 'Approved user deposit', callback);
  } else if (tx.type === 'withdraw') {
    adminDebitUser(tx.user_id, tx.amount, 'Approved user withdraw', callback);
  } else {
    callback(new Error(`Unknown transaction type: ${tx.type}`));
  }
};

/**
 * Admin→Cashier transfer: admin balance -= amount, cashier balance += amount
 */
const adminToCashier = (cashierId, amount, callback) => {
  transactionModel.getAdminBalance((err, adminRow) => {
    if (err) return callback(err);
    if (!adminRow || adminRow.balance < amount) {
      return callback(Object.assign(new Error('Insufficient admin balance'), { code: 'INSUFFICIENT' }));
    }
    db.run(
      `UPDATE cashiers SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, cashierId],
      function (err2) {
        if (err2) return callback(err2);
        if (!this.changes) return callback(Object.assign(new Error('Cashier not found'), { code: 'NOT_FOUND' }));
        transactionModel.adjustAdminBalance(-amount, (err3) => {
          if (err3) return callback(err3);
          transactionModel.logAdminTx({
            type: 'cashier_deposit', amount, userId: cashierId,
            note: `Deposited $${amount} to cashier #${cashierId}`,
          });
          callback(null);
        });
      }
    );
  });
};

/**
 * Cashier→Admin transfer: cashier balance -= amount, admin balance += amount
 */
const cashierToAdmin = (cashierId, amount, callback) => {
  db.get(`SELECT balance FROM cashiers WHERE id = ?`, [cashierId], (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(Object.assign(new Error('Cashier not found'), { code: 'NOT_FOUND' }));
    if (row.balance < amount) return callback(Object.assign(new Error('Insufficient cashier balance'), { code: 'INSUFFICIENT' }));
    db.run(
      `UPDATE cashiers SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, cashierId],
      (err2) => {
        if (err2) return callback(err2);
        transactionModel.adjustAdminBalance(+amount, (err3) => {
          if (err3) return callback(err3);
          transactionModel.logAdminTx({
            type: 'cashier_withdraw', amount, userId: cashierId,
            note: `Withdrew $${amount} from cashier #${cashierId}`,
          });
          callback(null);
        });
      }
    );
  });
};

module.exports = {
  creditUserBalance,
  debitUserBalance,
  adminCreditUser,
  adminDebitUser,
  approveTransaction,
  adminToCashier,
  cashierToAdmin,
};
