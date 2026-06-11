// ============================================================================
// Astrology Bot integration (outbound feedback)
// ----------------------------------------------------------------------------
// Once a day, after the user's last check-in, send an execution + energy
// summary to the Astrology Bot so tomorrow's briefing is grounded in what
// actually happened. Fire-and-forget: never block or break the bot.
//
// Configure via environment variables:
//   ASTROLOGY_FEEDBACK_URL  e.g. https://astrology-bot-i57e.onrender.com/api/daily-feedback
//   INTEGRATION_SECRET      shared secret, must match the Astrology Bot's INTEGRATION_SECRET
// ============================================================================

const axios = require('axios');

/**
 * Build a feedback summary from a Fluffy user profile for a given local day.
 * @param {object} profile  the user's profile (allTasks, commitmentHistory, energyLog, ...)
 * @param {string} todayKey local date as YYYY-MM-DD
 */
function buildSummary(profile, todayKey) {
  const tasks = Array.isArray(profile.allTasks) ? profile.allTasks : [];
  const todayTasks = tasks.filter(t =>
    t.briefingDate === todayKey || (t.created || '').slice(0, 10) === todayKey
  );
  const tasks_total = todayTasks.length;
  const tasks_done = todayTasks.filter(t => t.completed).length;

  const habit_done = !!(profile.commitmentHistory && profile.commitmentHistory[todayKey] &&
    profile.commitmentHistory[todayKey].success);
  const streak = profile.currentStreak || 0;

  const todayEnergy = (profile.energyLog || [])
    .filter(e => e.timestamp && e.timestamp.startsWith(todayKey))
    .map(e => Number(e.level))
    .filter(n => !isNaN(n));
  const energy_avg = todayEnergy.length
    ? Math.round((todayEnergy.reduce((a, b) => a + b, 0) / todayEnergy.length) * 10) / 10
    : null;

  return { tasks_total, tasks_done, habit_done, streak, energy_avg };
}

/**
 * POST the day's summary to the Astrology Bot. Resolves to a small status object;
 * never throws.
 */
async function postDailyFeedback(email, todayKey, summary) {
  const url = process.env.ASTROLOGY_FEEDBACK_URL;
  const secret = process.env.INTEGRATION_SECRET;
  if (!url || !secret) return { ok: false, skipped: true, reason: 'not configured' };
  if (!email) return { ok: false, skipped: true, reason: 'no linked email' };

  try {
    await axios.post(url,
      { user_email: email, date: todayKey, ...summary },
      { headers: { 'X-Integration-Secret': secret }, timeout: 10000 }
    );
    console.log(`[astro] feedback sent for ${email} (${todayKey})`);
    return { ok: true };
  } catch (err) {
    console.warn('[astro] feedback push failed (non-fatal):', err.response?.status || err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { buildSummary, postDailyFeedback };
