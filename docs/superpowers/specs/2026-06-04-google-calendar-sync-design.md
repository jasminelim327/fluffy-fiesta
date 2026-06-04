# Google Calendar Sync — Design Spec

## Goal

Pull today's Google Calendar events into the bot's task list and morning brief. Users can tap Done on a Calendar event to delete it from Google Calendar. Direction: read-only pull + delete-on-done (no write/create — that already exists).

---

## Architecture

Pull on demand: every task list request and every morning brief fires a live Google Calendar API call for the authenticated user. If the API fails or the user hasn't connected Calendar, the bot continues normally with no Calendar section shown.

**Files changed:**

| File | Changes |
|---|---|
| `assistant-features.js` | Add `getTodayCalendarEvents`, `deleteCalendarEvent`; update `listTasks`, `_buildDailySnapshot`, `buildDailyMessage` |
| `slack-telegram-integration.js` | Update `case 'list':` to attach Done buttons for Calendar events; update first-message snapshot call |
| `backend.js` | Add `cal_done` callback handler in webhook + polling chains |

---

## Data Layer

### `getTodayCalendarEvents(userId)`

- Loads `profile.googleToken` via `_getOrCreateProfile`
- If no token, returns `[]`
- Creates a `GoogleCalendarSync` instance with `{ credentials, tokenJson: profile.googleToken }`
- Calls `calendar.events.list` with:
  - `timeMin`: start of today in user's timezone (`profile.timezone || 'Asia/Singapore'`)
  - `timeMax`: end of today in user's timezone
  - `singleEvents: true`, `orderBy: 'startTime'`, `maxResults: 20`
- Returns normalized array: `[{ id, title, start }]`
- On any error, logs and returns `[]`

### `deleteCalendarEvent(userId, eventId)`

- Same per-user client setup as `getTodayCalendarEvents`
- Calls `calendar.events.delete({ calendarId: 'primary', eventId })`
- Returns `true` on success, `false` on failure

---

## Task List Display

### `listTasks(userId)` — `assistant-features.js`

After building the existing task lines, calls `getTodayCalendarEvents(userId)`. If events exist, appends:

```
📅 *Today's Calendar*
─────────────────
1. Standup — 9:00 AM
2. Design review — 2:00 PM
```

Time is formatted in the user's timezone using `Intl.DateTimeFormat`.

### `case 'list':` — `slack-telegram-integration.js`

Fetches Calendar events (same call, passed through or re-used from `listTasks`). Appends an inline keyboard row per Calendar event:

```
[ ✅ Done — Standup ]
[ ✅ Done — Design review ]
```

Callback data: `cal_done:userId:eventId`

Bot tasks keep their existing inline buttons unchanged. If no Calendar events, no extra buttons shown.

---

## Morning Brief

### `_buildDailySnapshot(profile, calendarEvents = [])` — `assistant-features.js`

Gains optional `calendarEvents` param. When non-empty, appends a compact line:

```
📅 2 events today: Standup 9am · Design review 2pm
```

Titles are truncated to 20 chars each. If `calendarEvents` is empty or omitted, no Calendar line appears.

### `buildDailyMessage(userId)` — `assistant-features.js`

Already async. Calls `getTodayCalendarEvents(userId)` before building the message, passes result to `_buildDailySnapshot(profile, calendarEvents)`.

### First-message snapshot — `slack-telegram-integration.js`

The existing `_buildDailySnapshot(profile)` call gains a preceding `getTodayCalendarEvents(userId)` call. Result passed in as second arg.

---

## Callback Handler

### `cal_done:userId:eventId` — `backend.js`

Added to the webhook callback_query chain and the polling callback_query chain, after the existing `longterm_new` handler:

```js
} else if (action === 'cal_done' && messagingIntegration) {
  const cbUserId = parts[1];
  const eventId = parts[2];
  try {
    await messagingIntegration.assistant.deleteCalendarEvent(cbUserId, eventId);
    await axios.post(`.../editMessageText`, {
      chat_id: cbChatId,
      message_id: cbMessageId,
      text: '✅ Done — removed from Calendar',
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('cal_done callback failed:', err.message);
  }
}
```

No snooze for Calendar events — they have a fixed time and snoozing doesn't map to the Calendar data model.

---

## Error Handling

- No token → `getTodayCalendarEvents` returns `[]` silently. No Calendar section shown.
- API error → same: log error, return `[]`, bot continues normally.
- `deleteCalendarEvent` failure → log error, edit message to `⚠️ Could not remove from Calendar`.
- Users without Calendar connected never see Calendar UI (no buttons, no section).

---

## Out of Scope

- Creating/editing Calendar events from the bot (already exists via `addEvent`)
- Multi-calendar support (always uses `primary`)
- Snooze on Calendar events
- Syncing bot task completions back to Calendar
