// Seed script to add sample games and admin user to the database
const db = require('./src/config/database');
const bcrypt = require('bcryptjs');

const sampleGames = [
  {
    name: 'Dama',
    description: 'A classic board game of strategy and capture. Enjoy the challenge!',
    game_url: 'https://example.com/games/dama',
    min_players: 2,
    max_players: 2
  },
  {
    name: 'Bingo',
    description: 'A colorful number-calling game full of excitement and luck!',
    game_url: 'https://example.com/games/bingo',
    min_players: 1,
    max_players: 8
  },
  {
    name: 'Ludo',
    description: 'Race your tokens to the finish in this classic board game!',
    game_url: 'https://example.com/games/ludo',
    min_players: 2,
    max_players: 4
  },
  {
    name: 'Bingo',
    description: 'A colorful number-calling game full of excitement.',
    game_url: 'https://example.com/games/bingo',
    mini_app_url: 'https://t.me/your_bot_name/app?game=bingo',
    min_players: 1,
    max_players: 8
  },
  {
    name: 'Ludo',
    description: 'Race your tokens to the finish in this classic board game.',
    game_url: 'https://example.com/games/ludo',
    mini_app_url: 'https://t.me/your_bot_name/app?game=ludo',
    min_players: 2,
    max_players: 4
  },
  {
    name: 'Flappy Bird',
    description: 'Navigate your bird through pipes. How far can you go?',
    game_url: 'https://example.com/games/flappy-bird',
    mini_app_url: 'https://t.me/your_bot_name/app?game=flappy',
    min_players: 1,
    max_players: 1
  },
  {
    name: '2048',
    description: 'Combine tiles to reach the 2048 tile. Classic puzzle game!',
    game_url: 'https://example.com/games/2048',
    min_players: 1,
    max_players: 1
  },
  {
    name: 'Snake',
    description: 'Eat food and grow. Don\'t hit yourself or the walls!',
    game_url: 'https://example.com/games/snake',
    min_players: 1,
    max_players: 1
  },
  {
    name: 'Tetris',
    description: 'Stack falling blocks. Complete lines to score points!',
    game_url: 'https://example.com/games/tetris',
    min_players: 1,
    max_players: 1
  },
  {
    name: 'Tic Tac Toe',
    description: 'Classic strategy game. Play against AI or friends!',
    game_url: 'https://example.com/games/tictactoe',
    min_players: 1,
    max_players: 2
  },
  {
    name: 'Memory Match',
    description: 'Flip cards and match pairs. Improve your memory!',
    game_url: 'https://example.com/games/memory',
    min_players: 1,
    max_players: 1
  },
  {
    name: 'Quiz Master',
    description: 'Answer questions and earn points. Test your knowledge!',
    game_url: 'https://example.com/games/quiz',
    min_players: 1,
    max_players: 1
  }
];

const seedGames = () => {
  console.log('🌱 Seeding games...');

  sampleGames.forEach((game) => {
    db.run(
      `INSERT OR IGNORE INTO games (name, description, game_url, mini_app_url, min_players, max_players, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [game.name, game.description, game.game_url, game.mini_app_url, game.min_players, game.max_players],
      function(err) {
        if (err) {
          console.error(`Error inserting ${game.name}:`, err.message);
        } else {
          console.log(`✅ Added game: ${game.name}`);
        }
      }
    );
  });
};

const seedAdminUser = () => {
  console.log('🌱 Creating admin user...');
  
  const adminUsername = 'kaleab';
  const adminPassword = 'Kale@1513';
  const hashedPassword = bcrypt.hashSync(adminPassword, 10);

  db.run(
    `INSERT OR IGNORE INTO users (telegram_id, phone_number, username, password) 
     VALUES (?, ?, ?, ?)`,
    [999999, '+1234567890', adminUsername, hashedPassword],
    function(err) {
      if (err) {
        console.error('Error creating admin user:', err.message);
      } else {
        console.log(`✅ Admin user created (username: ${adminUsername}, password: ${adminPassword})`);
        // Create balance for admin user
        const userId = this.lastID;
        db.run(
          `INSERT OR IGNORE INTO balances (user_id, balance, coins) VALUES (?, ?, ?)`,
          [userId, 0, 0],
          (err) => {
            if (err) console.error('Error creating balance:', err);
          }
        );
        // Create player record for admin
        db.run(
          `INSERT OR IGNORE INTO players (user_id) VALUES (?)`,
          [userId],
          (err) => {
            if (err) console.error('Error creating player record:', err);
          }
        );
      }
    }
  );
};

// Run seeding
const runSeeding = () => {
  seedAdminUser();
  seedGames();

  setTimeout(() => {
    console.log('✅ Seeding complete!');
    process.exit(0);
  }, 2000);
};

runSeeding();

