# Deadline Parsing & In-Bot Reminder Delivery — Design Spec

**Date:** 2026-06-03  
**Status:** Approved

## Context

Tasks are currently saved with `deadline` as a raw string ("tomorrow", "Friday at 3pm"). There is no `deadlineMs` timestamp, so the bot cannot deliver timed reminders via Telegram. Users expect a reminder bot to actually ping them — currently it only creates Google Calendar events. This spec adds real deadline timestamps and a per-minute cron that fires Telegram reminder messages with Done/Snooze inline buttons.

---

## Part 1: Deadline Parsing

### Library
`chrono-node` — a purpose-built natural language date parser for Node.js. Deterministic, zero API cost, handles all common phrases.

### When to parse
In `saveTask(userId, taskData)` in `assistant-features.js`, after loading the user's profile. The user's `profile.timezone` (already stored) is passed as reference timezone.

### What gets a `deadlineMs`
Only deadlines with an **explicit time component** get a `deadlineMs`. If no time is specified, `deadlineMs` is `null` and no timed reminder fires.

| Input | `deadline` (display) | `deadlineMs` |
|-------|----------------------|--------------|
| "Call dentist Friday at 3pm" | "Friday at 3pm" | epoch ms for 3pm Friday |
| "Buy milk tomorrow" | "tomorrow" | null |
| "Submit report in 2 hours" | "in 2 hours" | now + 7,200,000 |
| "Meeting tonight at 8" | "tonight at 8" | epoch ms for 8pm today |
| "Dentist appointment" | "today" | null |

### Detection logic
After chrono-node parses the string, check if the original `deadline` string contains an explicit time indicator: `/\d+\s*(am|pm)|at\s+\d|\d+:\d+|in\s+\d+\s*(hour|min)/i`. If the regex matches AND chrono-node returns a date, store `deadlineMs`. Otherwise leave it null.

### New field on task object
```js
{
  id, action, deadline, priority, recurring, completed,
  created, lastTouched,
  deadlineMs: 1749603600000  // null if no explicit time
}
```

---

## Part 2: Reminder Delivery Cron

### Schedule
`* * * * *` — runs every minute in `backend.js`, alongside the existing hourly morning message cron.

### Logic per tick
1. Load all users with `telegramChatId` via `db.getAllUsersWithTelegram()`
2. For each user, scan `allTasks` for tasks where:
   - `!task.completed`
   - `task.deadlineMs` is non-null
   - `task.deadlineMs >= now && task.deadlineMs < now + 60000`
3. For each matching task, send a Telegram message with inline keyboard

### Reminder message format
```
⏰ *Reminder:* Call dentist

[✅ Done]  [⏰ Snooze 30min]
```

`parse_mode: Markdown`, inline keyboard:
```js
reply_markup: {
  inline_keyboard: [[
    { text: '✅ Done', callback_data: `done:${userId}:${task.id}` },
    { text: '⏰ Snooze 30min', callback_data: `snooze:${userId}:${task.id}` }
  ]]
}
```

`userId` is embedded in `callback_data` so the webhook handler knows which user's task to update.

---

## Part 3: Inline Button Handling

### Webhook change
The existing `app.post('/telegram/webhook')` handler gets a new block at the top to handle `callback_query` updates (button taps) before the normal message flow:

```
if (update.callback_query) → handle button tap → return
if (update.message) → existing flow
```

### On button tap
1. Call `answerCallbackQuery(callbackQueryId)` immediately (dismisses spinner)
2. Parse `callback_data`: `"done:userId:taskId"` or `"snooze:userId:taskId"`
3. Load user's profile, find task by `id`
4. **Done**: set `task.completed = true`, save profile, edit original message to `✅ Done — Call dentist`
5. **Snooze**: set `task.deadlineMs += 30 * 60 * 1000`, save profile, edit original message to `⏰ Snoozed — see you in 30min`

### New methods in `FriendlyAssistant`
- `completeTaskById(userId, taskId)` — marks task complete by id, saves
- `snoozeTask(userId, taskId, minutes)` — adds minutes to `deadlineMs`, saves

### Telegram API call to edit message
```js
axios.post(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
  chat_id: chatId,
  message_id: messageId,
  text: '✅ Done — Call dentist',
  parse_mode: 'Markdown'
})
```

---

## Files Modified

| File | Changes |
|------|---------|
| `package.json` | Add `chrono-node` dependency |
| `assistant-features.js` | Update `saveTask` to parse `deadlineMs`; add `completeTaskById`, `snoozeTask` |
| `backend.js` | Add per-minute reminder cron; add `callback_query` handler to webhook |

---

## Verification

1. Add a task: "call dentist in 2 minutes" → check DB that `deadlineMs` ≈ now + 120s
2. Wait 2 minutes → Telegram message fires with Done/Snooze buttons
3. Tap Done → message edits to `✅ Done`, task marked complete
4. Add another task: "meeting in 3 minutes" → tap Snooze → `deadlineMs` advances 30min, message updates
5. Add "buy milk tomorrow" (no time) → `deadlineMs` is null, no reminder fires
