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

  // Separate table for Google OAuth tokens — isolated from the profile blob
  // so FriendlyAssistant can never accidentally overwrite them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_google_tokens (
      user_id TEXT PRIMARY KEY,
      token JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log('✅ Database initialized');
}

async function getUserProfile(userId) {
  if (!pool) return null;

  try {
    const { rows } = await pool.query(
      'SELECT profile FROM user_profiles WHERE user_id = $1',
      [String(userId)]
    );
    return rows[0]?.profile || null;
  } catch (err) {
    console.error(`[DB] getUserProfile(${userId}) error:`, err.message);
    return null;
  }
}

async function saveUserProfile(userId, profile) {
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO user_profiles (user_id, profile)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()`,
      [String(userId), JSON.stringify(profile)]
    );
  } catch (err) {
    console.error(`[DB] saveUserProfile(${userId}) error:`, err.message);
    throw err;
  }
}

// Google OAuth tokens are stored separately so profile saves can never overwrite them.

async function saveGoogleToken(userId, token) {
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO user_google_tokens (user_id, token)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET token = EXCLUDED.token, updated_at = NOW()`,
      [String(userId), JSON.stringify(token)]
    );
    console.log(`[DB] saveGoogleToken(${userId}): refresh_token=${token.refresh_token ? 'yes' : 'no'}`);
  } catch (err) {
    console.error(`[DB] saveGoogleToken(${userId}) error:`, err.message);
    throw err;
  }
}

async function getGoogleToken(userId) {
  if (!pool) return null;

  try {
    const { rows } = await pool.query(
      'SELECT token FROM user_google_tokens WHERE user_id = $1',
      [String(userId)]
    );
    return rows[0]?.token || null;
  } catch (err) {
    console.error(`[DB] getGoogleToken(${userId}) error:`, err.message);
    return null;
  }
}

async function getAllUsersWithTelegram() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT user_id, profile FROM user_profiles WHERE profile->>'telegramChatId' IS NOT NULL`
    );
    return rows.map(r => ({ userId: r.user_id, ...r.profile }));
  } catch (err) {
    console.error('[DB] getAllUsersWithTelegram error:', err.message);
    return [];
  }
}

module.exports = {
  initializeDatabase,
  getUserProfile,
  saveUserProfile,
  saveGoogleToken,
  getGoogleToken,
  getAllUsersWithTelegram
};
