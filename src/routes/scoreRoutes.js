const express = require('express');
const router = express.Router();
const userModel = require('../models/userModel');

// Get all scores/leaderboard
router.get('/leaderboard', (req, res) => {
  res.json({ success: true, message: 'Leaderboard endpoint' });
});

// Get user scores
router.get('/:user_id', (req, res) => {
  res.json({ success: true, message: 'User scores endpoint' });
});

module.exports = router;
