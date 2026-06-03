# Deadline Parsing & Reminder Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse natural language deadlines into real timestamps and deliver timed Telegram reminder messages with Done/Snooze inline buttons.

**Architecture:** `chrono-node` parses deadline strings into `deadlineMs` at task creation time; a per-minute cron scans all users' tasks and fires Telegram messages with inline buttons; `callback_query` updates on the webhook/polling path handle Done and Snooze taps.

**Tech Stack:** Node.js, `chrono-node`, Telegram Bot API (inline keyboards, editMessageText, answerCallbackQuery)

---

## File Map

| File | Changes |
|------|---------|
| `package.json` | Add `chrono-node` dependency |
| `assistant-features.js` | Add `_parseDeadlineMs` helper; update `saveTask` to store `deadlineMs`; add `completeTaskById`, `snoozeTask` |
| `backend.js` | Add `callback_query` handler to webhook; add `callback_query` to polling `allowed_updates`; add per-minute reminder cron |

---

### Task 1: Install chrono-node

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install chrono-node
```

- [ ] **Step 2: Verify it parses correctly**

```bash
node -e "const c = require('chrono-node'); console.log(c.parseDate('Friday at 3pm', new Date(), { timezone: 'Asia/Singapore' }));"
```

Expected: a Date object printed (not null).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add chrono-node for natural language date parsing"
```

---

### Task 2: Add `_parseDeadlineMs` + update `saveTask`

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Add `require('chrono-node')` at the top of `assistant-features.js`**

After the existing requires (line 1–4), add:

```js
const chrono = require('chrono-node');
```

- [ ] **Step 2: Add `_parseDeadlineMs` helper in the HELPER METHODS section (before `_getTodayKey`)**

```js
_parseDeadlineMs(deadline, timezone) {
  if (!deadline) return null;
  const hasExplicitTime = /\d+\s*(am|pm)|at\s+\d|\d+:\d+|\bin\s+\d+\s*(hour|min)/i.test(deadline);
  if (!hasExplicitTime) return null;
  try {
    const parsed = chrono.parseDate(deadline, new Date(), { timezone: timezone || 'Asia/Singapore' });
    return parsed ? parsed.getTime() : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Update `saveTask` to call `_parseDeadlineMs` and store `deadlineMs`**

Find the current `saveTask` method. Replace the `profile.allTasks.push(...)` block with:

```js
async saveTask(userId, taskData) {
  if (!taskData.action) return;
  const profile = await this._getOrCreateProfile(userId);
  if (!profile.allTasks) profile.allTasks = [];
  const userTimezone = profile.timezone || 'Asia/Singapore';
  const deadlineMs = this._parseDeadlineMs(taskData.deadline, userTimezone);
  profile.allTasks.push({
    id: this._generateId(),
    action: taskData.action,
    deadline: taskData.deadline || 'today',
    priority: taskData.priority || 'medium',
    recurring: taskData.recurring || false,
    completed: false,
    deadlineMs: deadlineMs || null,
    remindedAt: null,
    created: new Date().toISOString(),
    lastTouched: new Date().toISOString()
  });
  await this._saveProfile(userId, profile);
}
```

- [ ] **Step 4: Verify parsing works end-to-end**

```bash
node -e "
const FA = require('./assistant-features');
const a = new FA({ openrouterKey: 'x' });
console.log('3pm today:', a._parseDeadlineMs('today at 3pm', 'Asia/Singapore'));
console.log('tomorrow no time:', a._parseDeadlineMs('tomorrow', 'Asia/Singapore'));
console.log('in 2 hours:', a._parseDeadlineMs('in 2 hours', 'Asia/Singapore'));
console.log('friday at noon:', a._parseDeadlineMs('friday at noon', 'Asia/Singapore'));
"
```

Expected output:
- `today at 3pm` → a large number (epoch ms)
- `tomorrow` → `null`
- `in 2 hours` → a number ~7200000ms from now
- `friday at noon` → a large number (epoch ms)

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js
git commit -m "feat: parse deadline strings into deadlineMs timestamps"
```

---

### Task 3: Add `completeTaskById` and `snoozeTask`

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Add `completeTaskById` after the `deleteTask` method**

```js
async completeTaskById(userId, taskId) {
  const profile = await this._getOrCreateProfile(userId);
  const task = (profile.allTasks || []).find(t => t.id === taskId);
  if (!task) return null;
  task.completed = true;
  task.lastTouched = new Date().toISOString();
  await this._saveProfile(userId, profile);
  return task;
}
```

- [ ] **Step 2: Add `snoozeTask` after `completeTaskById`**

```js
async snoozeTask(userId, taskId, minutes) {
  const profile = await this._getOrCreateProfile(userId);
  const task = (profile.allTasks || []).find(t => t.id === taskId);
  if (!task) return null;
  task.deadlineMs = Date.now() + minutes * 60 * 1000;
  task.remindedAt = null;
  task.lastTouched = new Date().toISOString();
  await this._saveProfile(userId, profile);
  return task;
}
```

- [ ] **Step 3: Verify syntax**

```bash
node --check assistant-features.js && echo "✅ OK"
```

Expected: `✅ OK`

- [ ] **Step 4: Commit**

```bash
git add assistant-features.js
git commit -m "feat: add completeTaskById and snoozeTask for inline button handling"
```

---

### Task 4: Add `callback_query` handler to webhook and polling

**Files:**
- Modify: `backend.js`

- [ ] **Step 1: Add `callback_query` handler at the top of `app.post('/telegram/webhook')` (after `res.send('OK')`)**

Replace the current webhook handler opening:

```js
app.post('/telegram/webhook', async (req, res) => {
  const update = req.body;
  console.log('Telegram webhook received update:', JSON.stringify(update?.message?.text || update?.message?.location || update));

  res.send('OK');

  const msg = update.message;
  if (!msg) return;
```

With:

```js
app.post('/telegram/webhook', async (req, res) => {
  const update = req.body;
  console.log('Telegram webhook received update:', JSON.stringify(update?.message?.text || update?.callback_query?.data || update?.message?.location || update));

  res.send('OK');

  // Handle inline button taps (Done / Snooze)
  if (update.callback_query) {
    const { id: callbackId, from, data, message } = update.callback_query;
    const cbChatId = message.chat.id;
    const cbMessageId = message.message_id;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackId
    }).catch(() => {});
    const parts = (data || '').split(':');
    const action = parts[0];
    const cbUserId = parts[1];
    const taskId = parts[2];
    if (messagingIntegration && (action === 'done' || action === 'snooze')) {
      let newText;
      try {
        if (action === 'done') {
          const task = await messagingIntegration.assistant.completeTaskById(cbUserId, taskId);
          newText = `✅ *Done* — ${task?.action || 'task'}`;
        } else {
          const task = await messagingIntegration.assistant.snoozeTask(cbUserId, taskId, 30);
          newText = `⏰ *Snoozed* — ${task?.action || 'task'} — see you in 30min`;
        }
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
          chat_id: cbChatId,
          message_id: cbMessageId,
          text: newText,
          parse_mode: 'Markdown'
        });
      } catch (err) {
        console.error('Callback action failed:', err.message);
      }
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;
```

- [ ] **Step 2: Add `callback_query` to polling `allowed_updates`**

Find the `telegramPolling` function. Update the `getUpdates` call params from:

```js
{ params: { offset, timeout: 0, allowed_updates: ['message'] } }
```

To:

```js
{ params: { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] } }
```

- [ ] **Step 3: Handle `callback_query` in the polling loop**

In the polling loop, after `const msg = update.message;` add handling for callback_query. Find this block in the polling loop:

```js
const msg = update.message;
if (!msg) continue;
const userId = msg.from.id;
const chatId = msg.chat.id;
```

Replace with:

```js
// Handle inline button taps in polling mode
if (update.callback_query) {
  const { id: callbackId, from, data, message } = update.callback_query;
  const cbChatId = message.chat.id;
  const cbMessageId = message.message_id;
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    callback_query_id: callbackId
  }).catch(() => {});
  const parts = (data || '').split(':');
  const action = parts[0];
  const cbUserId = parts[1];
  const taskId = parts[2];
  if (messagingIntegration && (action === 'done' || action === 'snooze')) {
    try {
      let newText;
      if (action === 'done') {
        const task = await messagingIntegration.assistant.completeTaskById(cbUserId, taskId);
        newText = `✅ *Done* — ${task?.action || 'task'}`;
      } else {
        const task = await messagingIntegration.assistant.snoozeTask(cbUserId, taskId, 30);
        newText = `⏰ *Snoozed* — ${task?.action || 'task'} — see you in 30min`;
      }
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
        chat_id: cbChatId,
        message_id: cbMessageId,
        text: newText,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      console.error('Polling callback action failed:', err.message);
    }
  }
  continue;
}

const msg = update.message;
if (!msg) continue;
const userId = msg.from.id;
const chatId = msg.chat.id;
```

- [ ] **Step 4: Verify syntax**

```bash
node --check backend.js && echo "✅ OK"
```

Expected: `✅ OK`

- [ ] **Step 5: Commit**

```bash
git add backend.js
git commit -m "feat: handle inline button callback_query for Done and Snooze"
```

---

### Task 5: Add per-minute reminder cron

**Files:**
- Modify: `backend.js`

- [ ] **Step 1: Add the per-minute cron after the hourly morning message cron**

After the `console.log('⏰ Hourly cron active...')` line, add:

```js
// Per-minute reminder cron — fires tasks with deadlineMs in the current minute window
cron.schedule('* * * * *', async () => {
  if (!messagingIntegration || !TELEGRAM_TOKEN) return;
  const users = await db.getAllUsersWithTelegram().catch(() => []);
  const now = Date.now();
  const windowEnd = now + 60000;

  for (const user of users) {
    if (!user.telegramChatId) continue;
    const dueTasks = (user.allTasks || []).filter(t =>
      !t.completed &&
      !t.remindedAt &&
      t.deadlineMs &&
      t.deadlineMs >= now &&
      t.deadlineMs < windowEnd
    );

    for (const task of dueTasks) {
      try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: user.telegramChatId,
          text: `⏰ *Reminder:* ${task.action}`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Done', callback_data: `done:${user.userId}:${task.id}` },
              { text: '⏰ Snooze 30min', callback_data: `snooze:${user.userId}:${task.id}` }
            ]]
          }
        });
        task.remindedAt = Date.now();
      } catch (err) {
        console.error(`Reminder failed for user ${user.userId} task ${task.id}:`, err.message);
      }
    }

    if (dueTasks.length > 0) {
      await db.saveUserProfile(user.userId, user).catch(err =>
        console.error(`Failed to save remindedAt for user ${user.userId}:`, err.message)
      );
    }
  }
});
console.log('⏱ Per-minute reminder cron active');
```

- [ ] **Step 2: Verify syntax**

```bash
node --check backend.js && echo "✅ OK"
```

Expected: `✅ OK`

- [ ] **Step 3: Commit and push**

```bash
git add backend.js package.json
git commit -m "feat: per-minute reminder cron with Done/Snooze inline buttons"
git push
```

---

### Task 6: End-to-end smoke test on Render

**No code changes — verification only.**

- [ ] **Step 1: After Render redeploys, send a timed task**

In Telegram: `remind me to drink water in 2 minutes`

- [ ] **Step 2: Wait 2 minutes**

Expected: Telegram message appears:
```
⏰ Reminder: drink water
[✅ Done]  [⏰ Snooze 30min]
```

- [ ] **Step 3: Tap Done**

Expected: message edits to `✅ Done — drink water`

- [ ] **Step 4: Send another timed task and test Snooze**

`call dentist in 2 minutes` → wait → tap Snooze → message edits to `⏰ Snoozed — call dentist — see you in 30min`

- [ ] **Step 5: Verify no-time task gets no reminder**

`buy milk tomorrow` → wait several minutes → no reminder fires
