# Commands, Shortcuts & Workflow Integration — Design Spec

**Date:** 2026-06-04
**Status:** Approved

## Problem

The bot is entirely natural language today — there are no slash commands, no persistent keyboard, and no proactive outreach. New users have no signposts to discover features, and returning users have to remember everything by heart. There is no cron-driven rhythm to keep users engaged with their habits and tasks throughout the day.

## Goal

Add a comprehensive layer of discoverability and daily-rhythm features: Telegram slash commands with descriptions, a persistent reply keyboard, context-aware prompts, a guided onboarding flow, smart empty states, post-action contextual buttons, habit nudges woven into existing flows, and scheduled cron jobs — all in service of making the bot feel like a natural part of the user's day.

---

## Architecture Overview

Three layers of change:

1. **Command routing** (`backend.js`) — detect slash commands before LLM classification, route directly
2. **UX layer** (`slack-telegram-integration.js`) — persistent keyboard, contextual inline buttons, response enrichment
3. **Scheduler** (`backend.js` cron section) — four new per-user, timezone-aware cron jobs

---

## Section 1 — Slash Commands

### 1.1 Registration

On server startup, call `setMyCommands` once to register all commands with Telegram. These descriptions appear as hints in the Telegram command picker when the user types `/`.

| Command | Telegram description |
|---|---|
| `/start` | Get started with a guided setup |
| `/help` | See everything I can do |
| `/tasks` | View your open tasks |
| `/streak` | Check your daily habit streak |
| `/review` | Get your weekly progress review |
| `/patterns` | Analyse your productivity patterns |
| `/motivation` | Get a boost when you need it |
| `/energy` | Log your energy level (1–10) |
| `/goals` | Revisit goals you haven't touched |
| `/connect` | Link your Google Calendar |

### 1.2 Routing

In `backend.js` `/telegram/webhook` and the polling loop, before calling `handleTelegramMessage`, check `msg.entities` for `type === 'bot_command'`. If found, extract the command (strip `/` and any `@botname` suffix) and map it to a synthetic natural-language string that the existing intent classifier already handles:

| Slash command | Synthetic message passed to handler |
|---|---|
| `/start` | handled specially (see Section 4) |
| `/help` | `"help"` |
| `/tasks` | `"list my tasks"` |
| `/streak` | `"show my streak"` |
| `/review` | `"weekly review"` |
| `/patterns` | `"show my patterns"` |
| `/motivation` | `"motivate me"` |
| `/energy` | `"energy"` (triggers prompt, see Section 3) |
| `/goals` | `"check abandoned goals"` |
| `/connect` | `"connect google"` |

This keeps all intent routing inside `handleTelegramMessage` unchanged.

### 1.3 Polling loop parity

The polling loop in `backend.js` duplicates webhook logic. Apply the same slash-command detection there so both paths behave identically.

---

## Section 2 — Persistent Reply Keyboard

### 2.1 Layout

Two rows, always visible at the bottom of the chat:

```
[ 📋 My Tasks ]   [ 🔥 My Streak ]   [ 💪 Motivate Me ]
[ 📊 Patterns  ]   [ 📅 Weekly Review ]   [ ❓ Help ]
```

### 2.2 Implementation

Add `_persistentKeyboard()` to `MessagingIntegration`:

```js
_persistentKeyboard() {
  return {
    keyboard: [
      [{ text: '📋 My Tasks' }, { text: '🔥 My Streak' }, { text: '💪 Motivate Me' }],
      [{ text: '📊 Patterns' }, { text: '📅 Weekly Review' }, { text: '❓ Help' }]
    ],
    resize_keyboard: true,
    persistent: true
  };
}
```

### 2.3 Attachment

`sendToTelegram` gains an optional `keyboard` parameter. Every response from `handleTelegramMessage` includes `reply_markup: this._persistentKeyboard()` unless that response already carries its own `reply_markup` (e.g. Google connect inline button, location request).

### 2.4 Button text routing

Button labels are exact-matched before the LLM classifier so taps are instant:

| Button text | Maps to intent |
|---|---|
| `📋 My Tasks` | `list` |
| `🔥 My Streak` | `streak` |
| `💪 Motivate Me` | `motivation` |
| `📊 Patterns` | `pattern` |
| `📅 Weekly Review` | `review` |
| `❓ Help` | `help` |

Add a `_resolveKeyboardShortcut(text)` helper in `MessagingIntegration` that returns the intent string or `null`. Call it at the top of `handleTelegramMessage` before `classifyIntent`.

---

## Section 3 — Context-Aware Prompts

Commands that expect follow-up input return a prompt instead of an empty/confusing response:

| Trigger | Response |
|---|---|
| `/energy` with no number | *"How's your energy today? Reply with a number — 1 (exhausted) to 10 (on fire) ⚡"* |
| `/streak` and no daily commitment set | *"No daily habit set yet. Tell me what you want to do every day, e.g. '15 min reading' or '30 min workout' 💪"* |
| `/tasks` and task list is empty | *"No tasks yet! Try typing something like 'Call dentist Friday' or 'Submit report by Monday' 📌"* |
| `/review` and fewer than 3 days of data | *"Not enough data for a full review yet — keep logging for a few days. Want to set a daily habit to track? 🔥"* |
| `/goals` and nothing abandoned | *"No forgotten goals — you're on top of everything! Want to add a new goal? Just type it. 🎯"* |

These checks happen inside the respective `assistant-features.js` methods (`listTasks`, `formatStreakMessage`, `generateWeeklyReview`, `checkAbandonedGoals`) before calling the LLM, using data already loaded from the DB.

---

## Section 4 — `/start` Onboarding Flow

### 4.1 New users

When a user with no profile sends `/start`:

**Message 1:** Welcome
```
👋 Hey! I'm your personal productivity companion.

Here's what I do:
• 📌 Remember your tasks and remind you before deadlines
• 🔥 Track your daily habits and keep your streak alive
• 💪 Motivate you and help you reflect on your progress

Let's get you set up in 30 seconds.
```

**Message 2:** Habit prompt (sent immediately after)
```
What's one thing you want to do every day?

For example:
• 15 min reading
• 30 min workout
• 10 min journaling

Just type it below 👇
```

The bot then listens for the reply. If it matches the `commit` intent, it auto-sets the daily commitment and confirms:
```
🔥 Done! I'll track your [habit] streak every day.

You're all set. Just type naturally — or use the buttons below. Type /help anytime to see what I can do.
```

The persistent keyboard appears with this confirmation message.

### 4.2 Returning users

Returning users who type `/start` get a short re-orientation:
```
👋 Welcome back! You're all set up.

Your streak: [N] days | Tasks due today: [N]

Use the buttons below or just type naturally. /help for the full list.
```

### 4.3 Onboarding state tracking

Track `onboardingStep` in the user profile (`'none'` | `'awaiting_habit'`). In `handleTelegramMessage`, check this field first. If `'awaiting_habit'`, route the message to `setDailyCommitment` regardless of classified intent, then clear the state.

---

## Section 5 — Daily Snapshot (first message of the day)

When a user sends their first message after midnight (based on their saved timezone), after the normal response, append:

```
─────────────────
📅 Today's snapshot
• [N] tasks due today  (or "No tasks due today")
• 🔥 Streak: [N] days ([habit name])  (or "No habit set yet")
• ⚡ Yesterday's energy: [N]/10  (or "Not logged yet")
```

**Implementation:**
- `_getOrCreateProfile` returns `lastSnapshotDate` (stored as `YYYY-MM-DD` in user profile)
- `handleTelegramMessage` compares today's date (in user's timezone) against `lastSnapshotDate`
- If different: build snapshot, append to response text, update `lastSnapshotDate`
- Helper `_buildDailySnapshot(userId)` in `assistant-features.js` returns the snapshot string

---

## Section 6 — Post-Action Contextual Inline Buttons

After key actions, append ephemeral inline keyboard buttons as the next step. These are in addition to (not replacing) the persistent keyboard.

| After action | Inline buttons shown |
|---|---|
| Task saved | `📋 See All Tasks` · `➕ Add Another` |
| Task completed | `📋 Remaining Tasks` · `🔥 My Streak` |
| Streak checked, habit not logged today | `✅ Log Today` · `💪 Motivate Me` |
| Weekly review sent | `📊 See Patterns` · `🎯 Revisit Goals` |
| Energy ≤ 4 logged | `💪 Motivate Me` · `📋 My Tasks` |

**Implementation:**
Return `contextualInlineKeyboard` from each handler method; `_formatTelegramResponse` merges it into `reply_markup.inline_keyboard` if present. The persistent keyboard and inline buttons coexist: persistent keyboard uses `reply_markup.keyboard`, inline buttons use `reply_markup.inline_keyboard` in a separate message sent immediately after.

---

## Section 7 — Habit Nudge in Task Saves

When saving a new task, after building the confirmation message, check if:
- User has a daily commitment set
- Today's habit has not been logged yet

If both true, append one line to the task confirmation:
```
💬 _Don't forget your [N] min [habit] today — you're on a [streak]-day streak!_
```

This check uses already-loaded profile data. No extra DB call.

---

## Section 8 — Smart Empty States

Handled in Section 3 (context-aware prompts) — empty states are the prompt text returned when the relevant method finds no data.

Additionally, for `/tasks` with an empty list, include three tappable example suggestions as inline buttons:
```
[ Call dentist Friday ] [ Submit report Monday ] [ 30 min workout today ]
```
Tapping one pre-fills and sends that text as a message, creating the task immediately.

---

## Section 9 — Scheduled Cron Jobs

Four new per-user cron jobs. All times are in the user's saved timezone (defaults to UTC if not set). Jobs iterate over all users who have `telegramChatId` in their profile.

### 9.1 Morning Briefing (default 8:00am)

Sent daily at the user's `morningBriefTime` (configurable, default `'08:00'`).

Content:
```
☀️ Good morning! Here's your day:

📌 Tasks due today:
• [task 1]
• [task 2]
(or "No tasks due today — enjoy the free time!")

🔥 Streak: [N] days — keep it up!
⚡ Yesterday's energy: [N]/10

Just type to add a task, or use the buttons below.
```

### 9.2 Habit Nudge (default 8:00pm)

Sent daily at `habitNudgeTime` (default `'20:00'`) only if the daily habit has not been logged for today.

Content:
```
🔔 Hey! Your [N]-day streak is on the line.

Have you done your [habit] today?

Log it: "I did [N] min [habit]" — or tap below.
```

Inline buttons: `✅ I did it` · `⏭ Skip today`

### 9.3 Energy Check-In (default 9:00pm)

Sent daily at `energyCheckTime` (default `'21:00'`) only if energy has not been logged today.

Content:
```
⚡ How was your energy today?

Reply with a number: 1 (exhausted) → 10 (on fire)
```

### 9.4 Weekly Review (Sunday 6:00pm)

Sent every Sunday at `weeklyReviewTime` (default `'18:00'`). Only fires if user has ≥ 3 days of data in the past week.

Content: same as `/review` response.

### 9.5 Cron job implementation

```js
// Runs every minute, checks per-user scheduled times
cron.schedule('* * * * *', async () => {
  const users = await db.getAllUsersWithChatId();
  const now = new Date();
  for (const user of users) {
    await checkAndSendScheduledMessages(user, now);
  }
});
```

`checkAndSendScheduledMessages` converts `now` to the user's timezone, compares HH:MM against each configured time, and checks a `lastSentDate` flag per job type in the user profile to avoid duplicate sends.

### 9.6 Configuration

Users configure job times via natural language or `/dailyconfig`:

- "Send my morning brief at 7am"
- "Remind me about my habit at 9pm"
- "Don't send me energy check-ins"

`setDailyMessageTime` (already exists) is extended to save `morningBriefTime`, `habitNudgeTime`, `energyCheckTime`, and `weeklyReviewTime` to the user profile. Setting a time to `"off"` disables that job.

---

## Data Model Changes

New fields added to user profile (all optional, defaults applied at send time):

```js
{
  onboardingStep: 'none' | 'awaiting_habit',  // onboarding state
  lastSnapshotDate: 'YYYY-MM-DD',             // daily snapshot tracking
  morningBriefTime: '08:00',                  // HH:MM in user timezone
  habitNudgeTime: '20:00',
  energyCheckTime: '21:00',
  weeklyReviewTime: '18:00',
  lastMorningBriefDate: 'YYYY-MM-DD',         // dedup flags
  lastHabitNudgeDate: 'YYYY-MM-DD',
  lastEnergyCheckDate: 'YYYY-MM-DD',
  lastWeeklyReviewDate: 'YYYY-MM-DD'
}
```

No schema migration needed — `_getOrCreateProfile` returns defaults for missing fields.

---

## Files Changed

| File | Changes |
|---|---|
| `backend.js` | `setMyCommands` on startup; slash command detection before `handleTelegramMessage`; 4 new cron jobs; `getAllUsersWithChatId` DB call |
| `slack-telegram-integration.js` | `_persistentKeyboard()`; `_resolveKeyboardShortcut()`; keyboard attached to all responses; contextual inline buttons; daily snapshot append; habit nudge in task save; `/start` routing |
| `assistant-features.js` | `_buildDailySnapshot()`; onboarding state in `getWelcomeIfNew`; empty-state returns in `listTasks`, `formatStreakMessage`, `generateWeeklyReview`, `checkAbandonedGoals`; `setDailyMessageTime` extended for 4 job times |
| `db.js` | `getAllUsersWithChatId()` — returns all profiles that have `telegramChatId` set |

---

## Error Handling

- `setMyCommands` failure on startup: log warning, do not crash — commands degrade gracefully to natural language
- Cron job send failure per user: log error, continue to next user — one user's failure does not block others
- Missing timezone: default to UTC for cron jobs; morning brief includes a note to share location if timezone unknown
- Onboarding `'awaiting_habit'` state: if user sends something unrecognisable, re-prompt once, then fall back to normal routing after second attempt

---

## Testing

- Send `/tasks` with no tasks → see empty-state prompt with example inline buttons
- Send `/streak` with no habit → see setup prompt
- Send `/start` as new user → receive 2-message onboarding, reply with habit → see confirmation + keyboard
- Send `/start` as returning user → see short re-orientation
- Tap `📋 My Tasks` keyboard button → instant response, no LLM call
- Save a task → see habit nudge appended (if habit set and not logged today)
- Set energy to 3 → see Motivate Me inline button in response
- Wait for cron time → morning brief arrives automatically
- Send "Send my morning brief at 7am" → briefing time updates
