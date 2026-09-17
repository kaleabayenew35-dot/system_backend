const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(os.tmpdir(), `system-backend-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.DB_PATH = dbPath;
delete require.cache[require.resolve('../src/config/database')];
const db = require('../src/config/database');

const waitForDatabaseReady = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000;

  const check = () => {
    db.get('SELECT name FROM sqlite_master WHERE type = "table" AND name = "games"', (err, row) => {
      if (!err && row) {
        resolve();
        return;
      }

      if (Date.now() > deadline) {
        reject(new Error('Database initialization timed out'));
        return;
      }

      setTimeout(check, 50);
    });
  };

  check();
});

test('seed helper skips default game insertion when games already exist', async () => {
  await waitForDatabaseReady();
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM games', (deleteErr) => {
        if (deleteErr) return reject(deleteErr);
        db.run('INSERT INTO games (name, description, game_url, mini_app_url, min_players, max_players, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ['Custom Game', 'Existing game', 'https://example.com/custom', 'https://example.com/custom-app', 2, 2, 'active'],
          (insertErr) => {
            if (insertErr) return reject(insertErr);
            resolve();
          }
        );
      });
    });
  });

  await new Promise((resolve, reject) => {
    db.seedDefaultGamesIfEmpty((err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const count = await new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) AS count FROM games', (err, row) => {
      if (err) return reject(err);
      resolve(row.count);
    });
  });

  assert.equal(count, 1);

  await new Promise((resolve, reject) => {
    db.close((closeErr) => {
      if (closeErr) return reject(closeErr);
      resolve();
    });
  });

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
});
