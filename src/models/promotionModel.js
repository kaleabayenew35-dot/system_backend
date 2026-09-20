const db = require('../config/database');

const getAll = (callback) => {
  db.all('SELECT * FROM promotions ORDER BY created_at DESC', [], callback);
};

const create = ({ title, buttonText, buttonUrl, imageData }, callback) => {
  db.run(
    `INSERT INTO promotions (title, button_text, button_url, image_data)
     VALUES (?, ?, ?, ?)`,
    [title, buttonText, buttonUrl || null, imageData || null],
    function (err) { callback(err, this?.lastID); }
  );
};

module.exports = { getAll, create };