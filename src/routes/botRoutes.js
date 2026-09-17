/**
 * botRoutes.js
 *
 * REST API for the Telegram bot's session store and conversation-state store.
 * These replace the local better-sqlite3 database that previously lived inside
 * the telegram/ folder.
 *
 * Endpoints:
 *
 *   Sessions
 *     PUT  /api/bot/sessions/:telegramId          upsert session
 *     GET  /api/bot/sessions/:telegramId          get session (null if expired)
 *     PATCH /api/bot/sessions/:telegramId/touch   refresh last_active
 *     PATCH /api/bot/sessions/:telegramId/token   update token + expiry
 *     DELETE /api/bot/sessions/:telegramId        remove session
 *
 *   Conversation states
 *     PUT  /api/bot/states/:chatId                upsert state
 *     GET  /api/bot/states/:chatId                get state (null if expired)
 *     PATCH /api/bot/states/:chatId               merge-patch data field
 *     DELETE /api/bot/states/:chatId              remove state
 */

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');

const now = () => Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────────────────────────

// Upsert session
router.put('/sessions/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  const { token, userId, createdAt, lastActive, expiresAt } = req.body;

  if (!token || !userId || !expiresAt) {
    return res.status(400).json({ error: 'token, userId and expiresAt are required' });
  }

  const ts = now();
  db.run(
    `INSERT INTO bot_sessions (telegram_id, token, user_id, created_at, last_active, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       token       = excluded.token,
       user_id     = excluded.user_id,
       created_at  = excluded.created_at,
       last_active = excluded.last_active,
       expires_at  = excluded.expires_at`,
    [String(telegramId), token, String(userId), createdAt || ts, lastActive || ts, expiresAt],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      res.json({ success: true });
    }
  );
});

// Get session
router.get('/sessions/:telegramId', (req, res) => {
  const { telegramId } = req.params;

  db.get(
    `SELECT * FROM bot_sessions WHERE telegram_id = ?`,
    [String(telegramId)],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      if (!row) return res.json({ session: null });

      // Expired — delete and return null
      if (now() > row.expires_at) {
        db.run(`DELETE FROM bot_sessions WHERE telegram_id = ?`, [String(telegramId)]);
        return res.json({ session: null });
      }

      // Refresh last_active on read
      db.run(`UPDATE bot_sessions SET last_active = ? WHERE telegram_id = ?`, [now(), String(telegramId)]);

      res.json({
        session: {
          token:        row.token,
          userId:       row.user_id,
          createdAt:    row.created_at,
          lastActiveAt: row.last_active,
          expiresAt:    row.expires_at,
        }
      });
    }
  );
});

// Touch last_active
router.patch('/sessions/:telegramId/touch', (req, res) => {
  const { telegramId } = req.params;
  db.run(
    `UPDATE bot_sessions SET last_active = ? WHERE telegram_id = ?`,
    [now(), String(telegramId)],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      res.json({ success: true });
    }
  );
});

// Update token (refresh session)
router.patch('/sessions/:telegramId/token', (req, res) => {
  const { telegramId } = req.params;
  const { token, expiresAt } = req.body;

  if (!token || !expiresAt) {
    return res.status(400).json({ error: 'token and expiresAt are required' });
  }

  const ts = now();
  db.run(
    `UPDATE bot_sessions
     SET token = ?, created_at = ?, last_active = ?, expires_at = ?
     WHERE telegram_id = ?`,
    [token, ts, ts, expiresAt, String(telegramId)],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      res.json({ success: true });
    }
  );
});

// Delete session
router.delete('/sessions/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  db.run(
    `DELETE FROM bot_sessions WHERE telegram_id = ?`,
    [String(telegramId)],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      res.json({ success: true });
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION STATES
// ─────────────────────────────────────────────────────────────────────────────

const STATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Upsert state
router.put('/states/:chatId', (req, res) => {
  const { chatId } = req.params;
  const { step, data } = req.body;

  if (!step) {
    return res.status(400).json({ error: 'step is required' });
  }

  const expiresAt = now() + STATE_TIMEOUT_MS;

  db.run(
    `INSERT INTO bot_conversation_states (chat_id, step, data, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       step       = excluded.step,
       data       = excluded.data,
       expires_at = excluded.expires_at`,
    [String(chatId), step, JSON.stringify(data || {}), expiresAt],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      res.json({ success: true });
    }
  );
});

// Get state
router.get('/states/:chatId', (req, res) => {
  const { chatId } = req.params;

  db.get(
    `SELECT * FROM bot_conversation_states WHERE chat_id = ?`,
    [String(chatId)],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      if (!row) return res.json({ state: null });

      // Expired — delete and return null
      if (now() > row.expires_at) {
        db.run(`DELETE FROM bot_conversation_states WHERE chat_id = ?`, [String(chatId)]);
        return res.json({ state: null });
      }

      let parsed;
      try { parsed = JSON.parse(row.data); } catch { parsed = {}; }

      res.json({ state: { step: row.step, data: parsed } });
    }
  );
});

// Patch (merge) data field — keeps step, merges data, refreshes expiry
router.patch('/states/:chatId', (req, res) => {
  const { chatId } = req.params;
  const patch = req.body.data || {};

  db.get(
    `SELECT * FROM bot_conversation_states WHERE chat_id = ?`,
    [String(chatId)],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      if (!row) return res.json({ state: null });

      if (now() > row.expires_at) {
        db.run(`DELETE FROM bot_conversation_states WHERE chat_id = ?`, [String(chatId)]);
        return res.json({ state: null });
      }

      let existing;
      try { existing = JSON.parse(row.data); } catch { existing = {}; }
      const merged = { ...existing, ...patch };
      const expiresAt = now() + STATE_TIMEOUT_MS;

      db.run(
        `UPDATE bot_conversation_states SET data = ?, expires_at = ? WHERE chat_id = ?`,
        [JSON.stringify(merged), expiresAt, String(chatId)],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Database error', detail: updateErr.message });
          res.json({ state: { step: row.step, data: merged } });
        }
      );
    }
  );
});

// Delete state
router.delete('/states/:chatId', (req, res) => {
  const { chatId } = req.params;
  db.run(
    `DELETE FROM bot_conversation_states WHERE chat_id = ?`,
    [String(chatId)],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      res.json({ success: true });
    }
  );
});

// Cleanup expired states (called by the bot's periodic sweep OR on-demand)
router.delete('/states', (req, res) => {
  db.run(
    `DELETE FROM bot_conversation_states WHERE expires_at < ?`,
    [now()],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error', detail: err.message });
      res.json({ success: true, deleted: this.changes });
    }
  );
});

module.exports = router;
