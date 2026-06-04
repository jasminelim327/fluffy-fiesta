# Google Calendar Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull today's Google Calendar events into the task list and morning brief, with a Done button that deletes the event from Google Calendar.

**Architecture:** `google-calendar.js` gets a `getTodayEvents(timezone)` method. `assistant-features.js` gets `getTodayCalendarEvents(userId)` and `deleteCalendarEvent(userId, eventId)`, both using `db.getGoogleToken` + a `googleCredentials` config param passed from `backend.js`. `listTasks` merges Calendar events into its output. `_buildDailySnapshot` gains an optional `calendarEvents` param. `slack-telegram-integration.js` attaches `cal_done` inline buttons to the task list. `backend.js` handles the `cal_done` callback in both webhook and polling.

**Tech Stack:** Node.js (CommonJS), googleapis (already installed), Jest, existing `db.getGoogleToken`, existing `GoogleCalendarSync`.

---

## File Map

| File | Changes |
|---|---|
| `google-calendar.js` | Add `getTodayEvents(timezone)` method |
| `assistant-features.js` | Add `googleCredentials` config param; add `require('./google-calendar')`; add `getTodayCalendarEvents`, `deleteCalendarEvent`; update `listTasks`, `_buildDailySnapshot`, `buildDailyMessage` |
| `slack-telegram-integration.js` | Accept + forward `googleCredentials`; update `case 'list':` to add `cal_done` buttons; update `_appendDailySnapshot` to pre-fetch events |
| `backend.js` | Pass `googleCredentials` to `MessagingIntegration`; add `cal_done` handler to webhook + polling |
| `tests/snapshot.test.js` | Tests for `getTodayCalendarEvents` returns `[]` without credentials; `_buildDailySnapshot` with/without calendar events |

---

### Task 1: `getTodayEvents` in `google-calendar.js`

**Files:**
- Modify: `google-calendar.js`

- [ ] **Step 1: Add `getTodayEvents(timezone)` after `getUpcomingEvents`**

Open `google-calendar.js`. After the closing `}` of `getUpcomingEvents` (around line 236), add:

```js
async getTodayEvents(timezone) {
  try {
    if (!this.auth) await this.initialize();
    const calendar = google.calendar({ version: 'v3', auth: this.auth });
    const tz = timezone || this.timezone;

    // Compute UTC bounds for "today" in the user's timezone.
    // Strategy: noon UTC on today-in-tz tells us the tz offset; use that to shift midnight.
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
    const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(tomorrowDate);

    // Detect tz offset by checking what hour it is in the tz when UTC is noon
    const refDate = new Date(todayStr + 'T12:00:00Z');
    const tzHour = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false
    }).format(refDate));
    const offsetHours = tzHour - 12;

    const timeMin = new Date(new Date(todayStr + 'T00:00:00Z').getTime() - offsetHours * 3600000).toISOString();
    const timeMax = new Date(new Date(tomorrowStr + 'T00:00:00Z').getTime() - offsetHours * 3600000).toISOString();

    const response = await calendar.events.list({
      calendarId: this.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20
    });

    return (response.data.items || []).map(event => ({
      id: event.id,
      title: event.summary || '(no title)',
      start: event.start.dateTime || event.start.date
    }));
  } catch (error) {
    console.error('❌ getTodayEvents error:', error.message);
    return [];
  }
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check google-calendar.js && echo "✅ OK"
```

Expected: `✅ OK`

- [ ] **Step 3: Commit**

```bash
git add google-calendar.js
git commit -m "feat: add getTodayEvents method to GoogleCalendarSync"
```

---

### Task 2: `getTodayCalendarEvents` + `deleteCalendarEvent` in `assistant-features.js`

**Files:**
- Modify: `assistant-features.js`
- Modify: `tests/snapshot.test.js`

- [ ] **Step 1: Write failing tests**

Append to the bottom of `tests/snapshot.test.js`:

```js
test('getTodayCalendarEvents returns [] when no googleCredentials configured', async () => {
  const a = new FriendlyAssistant({ openrouterKey: 'test' });
  const result = await a.getTodayCalendarEvents('user123');
  expect(result).toEqual([]);
});

test('_buildDailySnapshot shows calendar events line when events provided', () => {
  const profile = { allTasks: [], dailyCommitment: null, currentStreak: 0, energyLog: [], timezone: 'UTC' };
  const events = [
    { id: 'e1', title: 'Standup', start: '2026-06-04T09:00:00Z' },
    { id: 'e2', title: 'Design review', start: '2026-06-04T14:00:00Z' }
  ];
  const snapshot = assistant._buildDailySnapshot(profile, events);
  expect(snapshot).toContain('2 events today');
  expect(snapshot).toContain('Standup');
  expect(snapshot).toContain('Design review');
});

test('_buildDailySnapshot with no calendar events is unchanged', () => {
  const profile = { allTasks: [], dailyCommitment: null, currentStreak: 0, energyLog: [], timezone: 'UTC' };
  const snapshot = assistant._buildDailySnapshot(profile, []);
  expect(snapshot).not.toContain('events today');
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test tests/snapshot.test.js
```

Expected: FAIL — `getTodayCalendarEvents is not a function` and `_buildDailySnapshot` tests fail.

- [ ] **Step 3: Add `require('./google-calendar')` and `googleCredentials` to `assistant-features.js`**

At the top of `assistant-features.js`, after the existing requires:

```js
const GoogleCalendarSync = require('./google-calendar');
```

In the `FriendlyAssistant` constructor, add:

```js
this.googleCredentials = config.googleCredentials || null;
```

- [ ] **Step 4: Add `getTodayCalendarEvents` after `deleteTask`**

Find `async deleteTask` (around line 926). After its closing `}`, add:

```js
async getTodayCalendarEvents(userId) {
  if (!this.googleCredentials) return [];
  try {
    const token = await db.getGoogleToken(userId);
    if (!token) return [];
    const profile = await this._getOrCreateProfile(userId);
    const tz = profile.timezone || 'Asia/Singapore';
    const cal = new GoogleCalendarSync({
      credentials: this.googleCredentials,
      tokenJson: token,
      calendarId: 'primary',
      timezone: tz
    });
    const ok = await cal.initialize();
    if (!ok) return [];
    return await cal.getTodayEvents(tz);
  } catch (err) {
    console.error(`getTodayCalendarEvents(${userId}) failed:`, err.message);
    return [];
  }
}
```

- [ ] **Step 5: Add `deleteCalendarEvent` after `getTodayCalendarEvents`**

```js
async deleteCalendarEvent(userId, eventId) {
  if (!this.googleCredentials) return false;
  try {
    const token = await db.getGoogleToken(userId);
    if (!token) return false;
    const profile = await this._getOrCreateProfile(userId);
    const tz = profile.timezone || 'Asia/Singapore';
    const cal = new GoogleCalendarSync({
      credentials: this.googleCredentials,
      tokenJson: token,
      calendarId: 'primary',
      timezone: tz
    });
    await cal.initialize();
    await cal.deleteEvent(eventId);
    return true;
  } catch (err) {
    console.error(`deleteCalendarEvent(${userId}, ${eventId}) failed:`, err.message);
    return false;
  }
}
```

- [ ] **Step 6: Run tests — confirm partial pass**

```bash
npm test tests/snapshot.test.js
```

Expected: `getTodayCalendarEvents returns []` and `_buildDailySnapshot with no calendar events` pass. `_buildDailySnapshot shows calendar events line` still FAILS — that's expected, `_buildDailySnapshot` gains the `calendarEvents` param in Task 4.

- [ ] **Step 7: Commit**

```bash
git add assistant-features.js tests/snapshot.test.js
git commit -m "feat: add getTodayCalendarEvents and deleteCalendarEvent to FriendlyAssistant"
```

---

### Task 3: Update `listTasks` to merge Calendar section

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Replace `listTasks` with Calendar-aware version**

Find `async listTasks(userId)` (around line 732). Replace the entire method with:

```js
async listTasks(userId) {
  const profile = await this._getOrCreateProfile(userId);
  const tasks = (profile.allTasks || []).filter(t => !t.completed);
  const tz = profile.timezone || 'Asia/Singapore';
  const calEvents = await this.getTodayCalendarEvents(userId);

  if (tasks.length === 0 && calEvents.length === 0) {
    return '✨ *No tasks yet!*\n─────────────────\nTry typing one of these to get started:\n\n• _"Call dentist Friday"_\n• _"Submit report by Monday"_\n• _"Buy groceries today"_\n\nOr just tell me what you need to do!';
  }

  const lines = [];

  if (tasks.length > 0) {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...tasks].sort((a, b) =>
      (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
    );
    lines.push('📋 *Your tasks:*', '─────────────────');
    sorted.forEach((t, i) => {
      const prefix = t.priority === 'high' ? '⚡ ' : '';
      const recurTag = t.recurring ? ' ⟳' : '';
      lines.push(`${i + 1}. ${prefix}${t.action}${recurTag} — _${t.deadline}_`);
    });
    lines.push('', '💡 Tap ✅ to complete · ⏰ to snooze 30min');
  }

  if (calEvents.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('📅 *Today\'s Calendar*', '─────────────────');
    calEvents.forEach((e, i) => {
      const timeStr = e.start && e.start.includes('T')
        ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(e.start))
        : 'All day';
      lines.push(`${i + 1}. ${e.title} — _${timeStr}_`);
    });
    lines.push('', '💡 Tap ✅ to remove from Calendar');
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: 22 of 23 tests passing — the `_buildDailySnapshot shows calendar events line` test still fails until Task 4 updates `_buildDailySnapshot`.

- [ ] **Step 3: Commit**

```bash
git add assistant-features.js
git commit -m "feat: merge Google Calendar events into listTasks output"
```

---

### Task 4: Update `_buildDailySnapshot` and `buildDailyMessage`

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Update `_buildDailySnapshot` to accept `calendarEvents`**

Find `_buildDailySnapshot(profile)` (around line 1372). Replace the signature and add the calendar line at the bottom:

```js
_buildDailySnapshot(profile, calendarEvents = []) {
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  const tz = profile.timezone || 'UTC';
  const todayFormatted = new Date().toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric'
  });
  const tasksDue = (profile.allTasks || []).filter(t => {
    if (t.completed) return false;
    if (t.deadlineMs) return t.deadlineMs >= now && t.deadlineMs < in24h;
    return t.deadline === 'today' || t.deadline === todayFormatted;
  });
  const tasksLine = tasksDue.length > 0
    ? `• 📌 ${tasksDue.length} task(s) due today`
    : '• No tasks due today';

  const streakLine = profile.dailyCommitment
    ? `• 🔥 Streak: ${profile.currentStreak || 0} day(s) (${profile.dailyCommitment.description})`
    : '• No habit set yet';

  const lastEnergy = (profile.energyLog || []).slice(-1)[0] || null;
  const energyLine = lastEnergy
    ? `• ⚡ Last energy: ${lastEnergy.level}/10`
    : '• ⚡ Energy not logged yet';

  const lines = ['─────────────────', '📅 *Today\'s snapshot*', tasksLine, streakLine, energyLine];

  if (calendarEvents.length > 0) {
    const titles = calendarEvents.slice(0, 3).map(e => e.title).join(' · ');
    const more = calendarEvents.length > 3 ? ` +${calendarEvents.length - 3} more` : '';
    lines.push(`• 📅 ${calendarEvents.length} events today: ${titles}${more}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Update `buildDailyMessage` to pre-fetch Calendar events**

Find `async buildDailyMessage(userId)` (around line 1064). Replace with:

```js
async buildDailyMessage(userId) {
  const profile = await this._getOrCreateProfile(userId);
  const commitment = profile.dailyCommitment;
  const systemPrompt = `You are a warm, encouraging personal assistant sending a short morning message.
Write ONE sentence of motivation relevant to someone working on: ${commitment?.description || 'their goals'}.
Keep it under 20 words. No emojis. Just the sentence.`;
  const motivationLine = await this._callOpenRouter('morning motivation', systemPrompt);
  const calEvents = await this.getTodayCalendarEvents(userId);
  return `☀️ *Good morning!*\n\n${this._buildDailySnapshot(profile, calEvents)}\n\n💬 _${motivationLine.trim()}_`;
}
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: 23 tests passing.

- [ ] **Step 4: Commit**

```bash
git add assistant-features.js
git commit -m "feat: add calendarEvents to _buildDailySnapshot and buildDailyMessage"
```

---

### Task 5: Wire `googleCredentials` through, update `case 'list':` and `_appendDailySnapshot`

**Files:**
- Modify: `slack-telegram-integration.js`
- Modify: `backend.js`

- [ ] **Step 1: Add `googleCredentials` to `MessagingIntegration` constructor**

In `slack-telegram-integration.js`, update the constructor to accept and forward `googleCredentials`:

```js
constructor(config) {
  this.assistant = new FriendlyAssistant({
    openrouterKey: config.openrouterKey,
    openrouterModel: config.openrouterModel,
    googleCredentials: config.googleCredentials || null
  });
  this.telegramToken = config.telegramToken;
  this.calendarSync = config.calendarSync;
  this.onTaskCreated = config.onTaskCreated || null;
  this.onGoogleConnect = config.onGoogleConnect || null;
}
```

- [ ] **Step 2: Pass `googleCredentials` in `backend.js` when creating `MessagingIntegration`**

Find the `new MessagingIntegration({` block (around line 1045). Add `googleCredentials`:

```js
messagingIntegration = new MessagingIntegration({
  openrouterKey: OPENROUTER_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL,
  telegramToken: TELEGRAM_TOKEN,
  calendarSync: googleCalendar,
  googleCredentials: googleCredentials || null,
  onTaskCreated: syncTask,
  onGoogleConnect: generateGoogleAuthUrl
});
```

Note: `googleCredentials` is already in scope in `backend.js` (loaded at startup around line 930).

- [ ] **Step 3: Update `case 'list':` to add `cal_done` buttons for Calendar events**

In `slack-telegram-integration.js`, find `case 'list':` (around line 242). Replace the entire case with:

```js
case 'list': {
  const isTodayQuery = /\btoday\b/i.test(message);
  const listText = isTodayQuery
    ? await this.assistant.listTodayTasks(userId)
    : await this.assistant.listTasks(userId);
  const openTasks = (profile.allTasks || []).filter(t => {
    if (t.completed) return false;
    if (isTodayQuery) {
      const now = Date.now();
      const in24h = now + 24 * 60 * 60 * 1000;
      const tz = profile.timezone || 'UTC';
      const todayFormatted = new Date().toLocaleDateString('en-US', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric'
      });
      if (t.deadlineMs) return t.deadlineMs >= now && t.deadlineMs < in24h;
      return t.deadline === 'today' || t.deadline === todayFormatted;
    }
    return true;
  });
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sortedTasks = [...openTasks].sort((a, b) =>
    (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
  );
  const calEvents = await this.assistant.getTodayCalendarEvents(userId);
  const taskButtons = sortedTasks.slice(0, 6).map(t => [
    { text: `✅ ${t.action.slice(0, 28)}`, callback_data: `done:${userId}:${t.id}` },
    { text: '⏰ Snooze', callback_data: `snooze:${userId}:${t.id}` }
  ]);
  const calButtons = calEvents.slice(0, 4).map(e => [{
    text: `✅ ${e.title.slice(0, 35)}`,
    callback_data: `cal_done:${userId}:${e.id}`
  }]);
  const allButtons = [...taskButtons, ...calButtons];
  if (allButtons.length > 0) {
    response = {
      chat_id: chatId,
      text: this._toTelegramMarkdown(listText),
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: allButtons }
    };
  } else {
    response = this._formatTelegramResponse(listText, chatId);
  }
  break;
}
```

- [ ] **Step 4: Update `_appendDailySnapshot` to pre-fetch Calendar events**

In `slack-telegram-integration.js`, replace `_appendDailySnapshot`:

```js
async _appendDailySnapshot(response, userId) {
  try {
    const profile = await this.assistant._getOrCreateProfile(userId);
    const tz = profile.timezone || 'UTC';
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    if (profile.lastSnapshotDate === todayKey) return response;
    const calEvents = await this.assistant.getTodayCalendarEvents(userId);
    const snapshot = this.assistant._buildDailySnapshot(profile, calEvents);
    if (response && typeof response.text === 'string') {
      await this.assistant.updateProfileMeta(userId, { lastSnapshotDate: todayKey });
      return { ...response, text: response.text + '\n\n' + snapshot };
    }
  } catch (err) {
    console.error('Daily snapshot failed:', err.message);
  }
  return response;
}
```

- [ ] **Step 5: Verify syntax**

```bash
node --check slack-telegram-integration.js && node --check backend.js && echo "✅ OK"
```

Expected: `✅ OK`

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: 23 tests passing.

- [ ] **Step 7: Commit**

```bash
git add slack-telegram-integration.js backend.js
git commit -m "feat: wire googleCredentials and add cal_done buttons to task list"
```

---

### Task 6: `cal_done` callback handler in `backend.js`

**Files:**
- Modify: `backend.js`

- [ ] **Step 1: Add `cal_done` handler to webhook callback chain**

Find the `} else if (action === 'longterm_new' && messagingIntegration) {` block in the webhook handler. After its closing `}` (just before `return;`), add:

```js
} else if (action === 'cal_done' && messagingIntegration) {
  const cbUserId = parts[1];
  const eventId = parts[2];
  try {
    const deleted = await messagingIntegration.assistant.deleteCalendarEvent(cbUserId, eventId);
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
      chat_id: cbChatId,
      message_id: cbMessageId,
      text: deleted ? '✅ Done — removed from Calendar' : '⚠️ Could not remove from Calendar',
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('cal_done callback failed:', err.message);
  }
}
```

- [ ] **Step 2: Add `cal_done` handler to polling callback chain**

Find the `} else if (action === 'longterm_new' && messagingIntegration) {` block in the polling loop. After its closing `}` (just before `continue;`), add:

```js
} else if (action === 'cal_done' && messagingIntegration) {
  const cbUserId = parts[1];
  const eventId = parts[2];
  try {
    const deleted = await messagingIntegration.assistant.deleteCalendarEvent(cbUserId, eventId);
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
      chat_id: cbChatId,
      message_id: cbMessageId,
      text: deleted ? '✅ Done — removed from Calendar' : '⚠️ Could not remove from Calendar',
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('cal_done callback failed:', err.message);
  }
}
```

- [ ] **Step 3: Verify syntax**

```bash
node --check backend.js && echo "✅ OK"
```

Expected: `✅ OK`

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: 23 tests passing.

- [ ] **Step 5: Commit and push**

```bash
git add backend.js
git commit -m "feat: add cal_done callback handler for Google Calendar event completion"
git push origin main
```

---

## Verification Checklist

- [ ] `/tasks` with Calendar connected → Calendar section appears below bot tasks with `✅ EventName` buttons
- [ ] `/tasks` with no Calendar connected → no Calendar section, no error
- [ ] Tap `✅` on a Calendar event → message edits to `✅ Done — removed from Calendar`
- [ ] Morning brief → snapshot includes `• 📅 N events today: …` line when events exist
- [ ] First message of the day snapshot → same calendar line appears
- [ ] All 23 tests pass: `npm test`
