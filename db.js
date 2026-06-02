const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
let pool = null;

if (connectionString) {
  const config = { connectionString };

  // Supabase requires SSL for remote Postgres connections.
  if (process.env.SUPABASE_DB_SSL === 'true' || /supabase\.co/.test(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }

  pool = new Pool(config);
} else {
  console.warn('⚠️ DATABASE_URL is not set. Database persistence is disabled.');
}

async function initializeDatabase() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      profile JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log('✅ Database initialized');
}

async function getUserProfile(userId) {
  if (!pool) return null;

  const { rows } = await pool.query(
    'SELECT profile FROM user_profiles WHERE user_id = $1',
    [userId]
  );

  return rows[0]?.profile || null;
}

async function saveUserProfile(userId, profile) {
  if (!pool) return;

  await pool.query(
    `INSERT INTO user_profiles (user_id, profile)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()`,
    [userId, profile]
  );
}

module.exports = {
  initializeDatabase,
  getUserProfile,
  saveUserProfile
};
