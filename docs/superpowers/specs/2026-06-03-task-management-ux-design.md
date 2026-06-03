# Task Management UX Improvements — Design Spec

**Date:** 2026-06-03  
**Status:** Approved

## Context

Tasks created via the bot are synced to Google Calendar but never saved to the user's local profile. This means `profile.allTasks` is always empty, breaking: task listing, abandoned goals detection, daily message task list, and pattern analysis. Additionally there is no way to view, complete, or delete tasks in Telegram, no onboarding for new users, streak display uses the full weekly review, and the daily message fires at a fixed time for all users.

---

## Fix 1: Save tasks to profile on creation

**Method:** `saveTask(userId, taskData)` added to `FriendlyAssistant` (`assistant-features.js`)

Loads profile, pushes task object, saves to DB. Called from `handleTelegramMessage` after `parseTask`, alongside the existing `onTaskCreated` (Google Calendar sync).

**Task schema:**
```js
{
  id: '<timestamp>-<random>',
  action: 'Buy milk',
  deadline: 'today',
  priority: 'medium',
  recurring: false,
  completed: false,
  created: '<ISO date>',
  lastTouched: '<ISO date>'
}
```

---

## Fix 2: View tasks (`list` intent)

**New intent:** `list` — "show my tasks", "what do I have today", "what's on my plate", "list tasks"

**Method:** `listTasks(userId)` in `FriendlyAssistant`

Returns incomplete tasks sorted by deadline. If none, returns an encouraging empty state.

**Response format:**
```
📋 *Your tasks:*
─────────────────
1. Buy milk — today
2. Call dentist — Friday
3. Submit report — tomorrow

💡 Say "done with buy milk" to tick one off.
```

Empty state: `✨ No tasks yet! Tell me something like "Buy milk tomorrow" to add one.`

---

## Fix 3: Complete a task (`complete` intent)

**New intent:** `complete` — "done with buy milk", "finished dentist call", "mark X done", "completed X task"

Note: distinct from `commit` which is for habit minutes ("I completed 20 min").

**Method:** `completeTask(userId, message)` in `FriendlyAssistant`

Fuzzy match: finds first incomplete task whose `action` is a case-insensitive substring of the message (or message is substring of action). Marks `completed: true`, updates `lastTouched`, saves to DB.

**Response:**
```
✅ *Done!* "Buy milk" marked as complete.
🔥 Keep the momentum going!
```

No match: `Hmm, I couldn't find that task. Say "show my tasks" to see what's on your list.`

---

## Fix 4: Delete a task (`delete` intent)

**New intent:** `delete` — "remove buy milk", "delete dentist task", "cancel X", "get rid of X"

**Method:** `deleteTask(userId, message)` in `FriendlyAssistant`

Same fuzzy match as `completeTask`. Removes task from `allTasks` array entirely. Saves to DB.

**Response:**
```
🗑 *Removed* "Buy milk" from your tasks.
```

No match: `Hmm, I couldn't find that task. Say "show my tasks" to see what's on your list.`

---

## Fix 5: Streak display (`streak` intent)

**New intent:** `streak` — "show my streak", "what's my streak", "how many days", "streak status"

Routes to existing `getStreakStatus(userId)` — no new method needed.

**Response format:**
```
🔥 *Your streak: 5 days*
─────────────────
🎯 Daily goal: 15min writing
✅ Today: completed
💪 Keep it going!
```

No commitment set: `No daily commitment yet. Say "set a daily commitment to 15 min reading" to start one!`

---

## Fix 6: Welcome message

On first message from a user (detected by `!profile.welcomed`), prepend a welcome card before the normal response. After sending, set `profile.welcomed = true` and save.

**Welcome card:**
```
👋 *Welcome to Fluffy Fiesta!*
I'm your personal productivity companion on Telegram.
Type *"help"* anytime to see everything I can do.
─────────────────
```

Implemented in `handleTelegramMessage` before the intent switch — check profile, send welcome if needed, then proceed normally.

---

## Fix 7: Custom daily message time

**User sets preference:** "send my daily message at 7am" — new `dailyconfig` intent stored as `profile.preferredHour` (0–23, default 8). Timezone already stored as `profile.timezone`.

**Cron change:** Switch from `0 8 * * *` (fixed 8am SGT) to `0 * * * *` (every hour). On each tick, send only to users whose current local hour matches `profile.preferredHour`.

**Response when user sets time:**
```
⏰ Got it! I'll send your morning message at 7:00 AM every day.
```

---

## Files Modified

| File | Changes |
|------|---------|
| `assistant-features.js` | Add `saveTask`, `listTasks`, `completeTask`, `deleteTask` methods; fix `getStreakStatus` response format; add welcome check in profile; add `preferredHour` to `buildDailyMessage` |
| `slack-telegram-integration.js` | Add `list`, `complete`, `delete`, `streak`, `dailyconfig` intents + cases; call `saveTask` after `parseTask`; send welcome on first message |
| `backend.js` | Change cron from `0 8 * * *` to `0 * * * *`; filter users by `preferredHour` vs current local hour |

---

## Verification

1. Add a task → send "show my tasks" → should appear in list
2. Say "done with [task]" → list again → should be gone
3. Say "remove [task]" → list again → should be gone
4. Say "show my streak" → should show streak card, not full weekly review
5. First message from a fresh user → welcome card appears
6. Say "send my daily message at 7am" → `profile.preferredHour` set to 7
7. Tasks appear in daily morning message
