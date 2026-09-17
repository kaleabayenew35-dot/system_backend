const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/database');
const gameTokenModel = require('../src/models/gameTokenModel');

test('ensureDemoToken reuses the existing active token instead of creating a new one', async () => {
  const first = await new Promise((resolve, reject) => {
    gameTokenModel.ensureDemoToken((err, result) => (err ? reject(err) : resolve(result)));
  });

  const second = await new Promise((resolve, reject) => {
    gameTokenModel.ensureDemoToken((err, result) => (err ? reject(err) : resolve(result)));
  });

  assert.equal(first.reused, true);
  assert.equal(second.reused, true);
  assert.equal(first.token, second.token);

  await new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) AS count FROM game_tokens WHERE token = ?`, [first.token], (err, row) => {
      if (err) return reject(err);
      assert.equal(row.count, 1);
      resolve();
    });
  });
});
