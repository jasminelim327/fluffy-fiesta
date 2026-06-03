# Task Management UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 UX gaps in Fluffy Fiesta: save tasks to profile, add list/complete/delete task flows, fix streak display, add welcome message, and add custom daily message time.

**Architecture:** All new methods go in `FriendlyAssistant` (`assistant-features.js`); routing goes in `MessagingIntegration` (`slack-telegram-integration.js`); cron change goes in `backend.js`. New intents: `list`, `complete`, `delete`, `streak`, `dailyconfig`.

**Tech Stack:** Node.js, Jest (existing test suite in `__tests__/`)

---

## File Map

| File | Changes |
|------|---------|
| `assistant-features.js` | Add `saveTask`, `listTasks`, `completeTask`, `deleteTask`, `getWelcomeIfNew`; fix streak response format; add `preferredHour` to `buildDailyMessage`; add new intents to classifier |
| `slack-telegram-integration.js` | Call `saveTask` after `parseTask`; add `list`, `complete`, `delete`, `streak`, `dailyconfig` cases; send welcome |
| `backend.js` | Change cron to hourly; filter by `preferredHour` |
| `__tests__/assistant-features.test.js` | Add tests for all new methods |
| `__tests__/messaging-integration.test.js` | Add routing tests for new intents |

---

### Task 1: `saveTask` — persist tasks to profile

**Files:**
- Modify: `assistant-features.js` (after `parseTask` method, ~line 630)
- Modify: `__tests__/assistant-features.test.js`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/assistant-features.test.js`:

```js
describe('saveTask', () => {
  let assistant;
  beforeEach(() => {
    assistant = new FriendlyAssistant({ openrouterKey: 'test-key' });
  });

  it('appends task to allTasks with completed:false', async () => {
    const profile = { allTasks: [] };
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue(profile);
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    await assistant.saveTask('user1', { action: 'Buy milk', deadline: 'today', priority: 'medium', recurring: false });
    expect(profile.allTasks).toHaveLength(1);
    expect(profile.allTasks[0].action).toBe('Buy milk');
    expect(profile.allTasks[0].completed).toBe(false);
    expect(profile.allTasks[0].id).toBeDefined();
  });

  it('does not save if action is empty', async () => {
    const profile = { allTasks: [] };
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue(profile);
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    await assistant.saveTask('user1', { action: '', deadline: 'today' });
    expect(profile.allTasks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: FAIL — `saveTask is not a function`

- [ ] **Step 3: Add `saveTask` to `assistant-features.js`**

Add after the `parseTask` method (~line 630):

```js
async saveTask(userId, taskData) {
  if (!taskData.action) return;
  const profile = await this._getOrCreateProfile(userId);
  if (!profile.allTasks) profile.allTasks = [];
  profile.allTasks.push({
    id: this._generateId(),
    action: taskData.action,
    deadline: taskData.deadline || 'today',
    priority: taskData.priority || 'medium',
    recurring: taskData.recurring || false,
    completed: false,
    created: new Date().toISOString(),
    lastTouched: new Date().toISOString()
  });
  await this._saveProfile(userId, profile);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: all saveTask tests PASS

- [ ] **Step 5: Wire `saveTask` into `handleTelegramMessage` in `slack-telegram-integration.js`**

In the `task`/`schedule` case, after `parseTask`, add the saveTask call:

```js
case 'task':
case 'schedule': {
  const taskData = await this.assistant.parseTask(message);
  await this.assistant.saveTask(userId, taskData).catch(err =>
    console.error('Task save failed:', err.message)
  );
  if (this.onTaskCreated) {
    await this.onTaskCreated(taskData, userId).catch(err =>
      console.error('Task sync failed:', err.message)
    );
  }
  // ... rest unchanged
```

- [ ] **Step 6: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js __tests__/assistant-features.test.js
git commit -m "feat: save tasks to profile on creation"
```

---

### Task 2: `listTasks` + `list` intent

**Files:**
- Modify: `assistant-features.js`
- Modify: `slack-telegram-integration.js`
- Modify: `__tests__/assistant-features.test.js`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/assistant-features.test.js`:

```js
describe('listTasks', () => {
  let assistant;
  beforeEach(() => {
    assistant = new FriendlyAssistant({ openrouterKey: 'test-key' });
  });

  it('returns numbered list of incomplete tasks', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({
      allTasks: [
        { id: '1', action: 'Buy milk', deadline: 'today', completed: false },
        { id: '2', action: 'Call dentist', deadline: 'Friday', completed: false },
        { id: '3', action: 'Old done task', deadline: 'yesterday', completed: true }
      ]
    });
    const result = await assistant.listTasks('user1');
    expect(result).toContain('Buy milk');
    expect(result).toContain('Call dentist');
    expect(result).not.toContain('Old done task');
  });

  it('returns empty state when no incomplete tasks', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({ allTasks: [] });
    const result = await assistant.listTasks('user1');
    expect(result).toContain('No tasks yet');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: FAIL — `listTasks is not a function`

- [ ] **Step 3: Add `listTasks` to `assistant-features.js`**

Add after `saveTask`:

```js
async listTasks(userId) {
  const profile = await this._getOrCreateProfile(userId);
  const tasks = (profile.allTasks || []).filter(t => !t.completed);
  if (tasks.length === 0) {
    return '✨ *No tasks yet!*\nTell me something like "Buy milk tomorrow" to add one.';
  }
  const lines = ['📋 *Your tasks:*', '─────────────────'];
  tasks.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.action} — _${t.deadline}_`);
  });
  lines.push('', '💡 Say "done with [task]" to tick one off.');
  return lines.join('\n');
}
```

- [ ] **Step 4: Add `list` intent to classifier in `assistant-features.js`**

In `classifyIntent`, update the system prompt — add after the `question` line:

```
list - viewing saved tasks ("show my tasks", "what do I have today", "list tasks", "what's on my plate", "my to-do list")
```

Update the `valid` array to include `'list'`:

```js
const valid = ['task','schedule','idea','commit','energy','review','motivation','pattern','abandoned','help','connect','question','list','complete','delete','streak','dailyconfig','chat'];
```

- [ ] **Step 5: Add `case 'list':` to `handleTelegramMessage` in `slack-telegram-integration.js`**

Add before `case 'question':`:

```js
case 'list':
  return this._formatTelegramResponse(await this.assistant.listTasks(userId), chatId);
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js __tests__/assistant-features.test.js
git commit -m "feat: add list tasks feature"
```

---

### Task 3: `completeTask` + `complete` intent

**Files:**
- Modify: `assistant-features.js`
- Modify: `slack-telegram-integration.js`
- Modify: `__tests__/assistant-features.test.js`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/assistant-features.test.js`:

```js
describe('completeTask', () => {
  let assistant;
  beforeEach(() => {
    assistant = new FriendlyAssistant({ openrouterKey: 'test-key' });
  });

  it('marks task as completed when message contains action text', async () => {
    const profile = {
      allTasks: [{ id: '1', action: 'Buy milk', deadline: 'today', completed: false }]
    };
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue(profile);
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    const result = await assistant.completeTask('user1', 'done with buy milk');
    expect(profile.allTasks[0].completed).toBe(true);
    expect(result).toContain('Buy milk');
  });

  it('returns not-found message when no match', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({ allTasks: [] });
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    const result = await assistant.completeTask('user1', 'done with something random');
    expect(result).toContain("couldn't find");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: FAIL — `completeTask is not a function`

- [ ] **Step 3: Add `completeTask` to `assistant-features.js`**

Add after `listTasks`:

```js
async completeTask(userId, message) {
  const profile = await this._getOrCreateProfile(userId);
  const lower = message.toLowerCase();
  const task = (profile.allTasks || []).find(t =>
    !t.completed && (lower.includes(t.action.toLowerCase()) || t.action.toLowerCase().includes(lower))
  );
  if (!task) {
    return "Hmm, I couldn't find that task. Say *\"show my tasks\"* to see what's on your list.";
  }
  task.completed = true;
  task.lastTouched = new Date().toISOString();
  await this._saveProfile(userId, profile);
  return `✅ *Done!* "${task.action}" marked as complete.\n🔥 Keep the momentum going!`;
}
```

- [ ] **Step 4: Add `complete` intent to classifier**

In `classifyIntent` system prompt, add after the `list` line:

```
complete - marking a task as done ("done with X", "finished X", "mark X done", "completed the X task", "I did X")
```

`valid` array already updated in Task 2 Step 4.

- [ ] **Step 5: Add `case 'complete':` to `handleTelegramMessage`**

Add after `case 'list':`:

```js
case 'complete':
  return this._formatTelegramResponse(await this.assistant.completeTask(userId, message), chatId);
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js __tests__/assistant-features.test.js
git commit -m "feat: add complete task feature"
```

---

### Task 4: `deleteTask` + `delete` intent

**Files:**
- Modify: `assistant-features.js`
- Modify: `slack-telegram-integration.js`
- Modify: `__tests__/assistant-features.test.js`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/assistant-features.test.js`:

```js
describe('deleteTask', () => {
  let assistant;
  beforeEach(() => {
    assistant = new FriendlyAssistant({ openrouterKey: 'test-key' });
  });

  it('removes matching task from allTasks', async () => {
    const profile = {
      allTasks: [{ id: '1', action: 'Buy milk', deadline: 'today', completed: false }]
    };
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue(profile);
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    const result = await assistant.deleteTask('user1', 'remove buy milk');
    expect(profile.allTasks).toHaveLength(0);
    expect(result).toContain('Buy milk');
  });

  it('returns not-found message when no match', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({ allTasks: [] });
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    const result = await assistant.deleteTask('user1', 'remove something random');
    expect(result).toContain("couldn't find");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: FAIL — `deleteTask is not a function`

- [ ] **Step 3: Add `deleteTask` to `assistant-features.js`**

Add after `completeTask`:

```js
async deleteTask(userId, message) {
  const profile = await this._getOrCreateProfile(userId);
  const lower = message.toLowerCase();
  const index = (profile.allTasks || []).findIndex(t =>
    !t.completed && (lower.includes(t.action.toLowerCase()) || t.action.toLowerCase().includes(lower))
  );
  if (index === -1) {
    return "Hmm, I couldn't find that task. Say *\"show my tasks\"* to see what's on your list.";
  }
  const [removed] = profile.allTasks.splice(index, 1);
  await this._saveProfile(userId, profile);
  return `🗑 *Removed* "${removed.action}" from your tasks.`;
}
```

- [ ] **Step 4: Add `delete` intent to classifier**

In `classifyIntent` system prompt, add after the `complete` line:

```
delete - removing a task entirely ("remove X", "delete X task", "cancel X", "get rid of X")
```

- [ ] **Step 5: Add `case 'delete':` to `handleTelegramMessage`**

Add after `case 'complete':`:

```js
case 'delete':
  return this._formatTelegramResponse(await this.assistant.deleteTask(userId, message), chatId);
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js __tests__/assistant-features.test.js
git commit -m "feat: add delete task feature"
```

---

### Task 5: Fix streak display

**Files:**
- Modify: `assistant-features.js`
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Add `streak` intent to classifier in `assistant-features.js`**

In the `classifyIntent` system prompt, add after the `delete` line:

```
streak - checking habit streak ("show my streak", "what's my streak", "how many days", "streak status", "my streak")
```

Also add a fast-path before the LLM call (after the existing `remind` fast-path):

```js
if (/\b(streak|how many days)\b/i.test(normalized)) {
  return 'streak';
}
```

- [ ] **Step 2: Add streak formatter to `assistant-features.js`**

Add a new `formatStreakMessage(userId)` method after `getStreakStatus`:

```js
async formatStreakMessage(userId) {
  const s = await this.getStreakStatus(userId);
  if (!s.dailyCommitment) {
    return 'No daily commitment set yet.\nSay *"set a daily commitment to 15 min reading"* to start one!';
  }
  const todayLine = s.todayComplete ? '✅ Today: completed' : '⏳ Today: not yet';
  return [
    `🔥 *Your streak: ${s.currentStreak} day(s)*`,
    '─────────────────',
    `🎯 Daily goal: ${s.dailyCommitment.minutes}min ${s.dailyCommitment.description}`,
    todayLine,
    '💪 Keep it going!'
  ].join('\n');
}
```

- [ ] **Step 3: Add `case 'streak':` to `handleTelegramMessage` in `slack-telegram-integration.js`**

Add after `case 'delete':`:

```js
case 'streak':
  return this._formatTelegramResponse(await this.assistant.formatStreakMessage(userId), chatId);
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js
git commit -m "feat: add dedicated streak display"
```

---

### Task 6: Welcome message for new users

**Files:**
- Modify: `assistant-features.js`
- Modify: `slack-telegram-integration.js`
- Modify: `__tests__/assistant-features.test.js`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/assistant-features.test.js`:

```js
describe('getWelcomeIfNew', () => {
  let assistant;
  beforeEach(() => {
    assistant = new FriendlyAssistant({ openrouterKey: 'test-key' });
  });

  it('returns welcome string and sets welcomed=true for new user', async () => {
    const profile = { welcomed: false };
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue(profile);
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    const result = await assistant.getWelcomeIfNew('user1');
    expect(result).toContain('Welcome');
    expect(profile.welcomed).toBe(true);
  });

  it('returns null for returning user', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({ welcomed: true });
    jest.spyOn(assistant, '_saveProfile').mockResolvedValue();
    const result = await assistant.getWelcomeIfNew('user1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: FAIL — `getWelcomeIfNew is not a function`

- [ ] **Step 3: Add `getWelcomeIfNew` to `assistant-features.js`**

Add after `updateProfileMeta`:

```js
async getWelcomeIfNew(userId) {
  const profile = await this._getOrCreateProfile(userId);
  if (profile.welcomed) return null;
  profile.welcomed = true;
  await this._saveProfile(userId, profile);
  return '👋 *Welcome to Fluffy Fiesta!*\nI\'m your personal productivity companion on Telegram.\nType *"help"* anytime to see everything I can do.\n─────────────────';
}
```

- [ ] **Step 4: Call `getWelcomeIfNew` at the start of `handleTelegramMessage` in `slack-telegram-integration.js`**

At the very start of `handleTelegramMessage`, before the intent switch:

```js
async handleTelegramMessage(message, userId, chatId) {
  const welcome = await this.assistant.getWelcomeIfNew(userId);

  const intent = await this.assistant.classifyIntent(message);
  console.log(`Intent classified as "${intent}" for message:`, message);

  // ... existing switch ...
```

Then in each case that returns a text response, prepend the welcome if present. The cleanest way: after the switch resolves to a `formatted` result, prepend:

Replace the switch + return pattern with:

```js
async handleTelegramMessage(message, userId, chatId) {
  const welcome = await this.assistant.getWelcomeIfNew(userId);

  const intent = await this.assistant.classifyIntent(message);
  console.log(`Intent classified as "${intent}" for message:`, message);

  let result;
  switch (intent) {
    // ... all existing cases unchanged, assign to result instead of return ...
    // Change every `return { ... }` to `result = { ... }; break;`
    // Change every `return this._formatTelegramResponse(...)` to
    //   `result = this._formatTelegramResponse(...); break;`
  }

  if (welcome && result) {
    result.text = welcome + '\n\n' + (result.text || '');
  }
  return result;
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js __tests__/assistant-features.test.js
git commit -m "feat: add welcome message for new users"
```

---

### Task 7: Custom daily message time

**Files:**
- Modify: `assistant-features.js` (classifier + handler)
- Modify: `slack-telegram-integration.js` (new case)
- Modify: `backend.js` (cron change)

- [ ] **Step 1: Add `dailyconfig` intent + handler to `assistant-features.js`**

In classifier system prompt, add after `streak`:

```
dailyconfig - setting preferred daily message time ("send my daily message at 7am", "daily message at 9", "change morning message to 6am")
```

Add `setDailyMessageTime(userId, message)` method after `formatStreakMessage`:

```js
async setDailyMessageTime(userId, message) {
  const hourMatch = message.match(/(\d{1,2})\s*(am|pm)?/i);
  if (!hourMatch) {
    return "I couldn't parse that time. Try something like *\"send my daily message at 7am\"*.";
  }
  let hour = parseInt(hourMatch[1]);
  const meridiem = (hourMatch[2] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) {
    return "Please give a valid hour between 0 and 23.";
  }
  const profile = await this._getOrCreateProfile(userId);
  profile.preferredHour = hour;
  await this._saveProfile(userId, profile);
  const display = hour === 0 ? '12:00 AM' : hour < 12 ? `${hour}:00 AM` : hour === 12 ? '12:00 PM' : `${hour - 12}:00 PM`;
  return `⏰ Got it! I'll send your morning message at *${display}* every day.`;
}
```

- [ ] **Step 2: Add `case 'dailyconfig':` to `handleTelegramMessage` in `slack-telegram-integration.js`**

Add after `case 'streak':`:

```js
case 'dailyconfig':
  return this._formatTelegramResponse(await this.assistant.setDailyMessageTime(userId, message), chatId);
```

- [ ] **Step 3: Update cron in `backend.js`**

Find the cron block (after `messagingIntegration` is initialized) and replace:

```js
// Daily morning message — 8am Singapore time
const dailyMsgTime = process.env.DAILY_MESSAGE_TIME || '0 8 * * *';
const dailyMsgTimezone = process.env.DAILY_MESSAGE_TIMEZONE || 'Asia/Singapore';
cron.schedule(dailyMsgTime, async () => {
  if (!messagingIntegration || !TELEGRAM_TOKEN) return;
  console.log('📅 Sending daily morning messages...');
  const users = await db.getAllUsersWithTelegram().catch(() => []);
  for (const user of users) {
    try {
      const text = await messagingIntegration.assistant.buildDailyMessage(user.userId);
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: user.telegramChatId,
        text,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      console.error(`Daily message failed for user ${user.userId}:`, err.message);
    }
  }
}, { timezone: dailyMsgTimezone });
console.log(`⏰ Daily message scheduled at ${dailyMsgTime} (${dailyMsgTimezone})`);
```

With:

```js
// Daily morning message — runs every hour, sends to users whose preferredHour matches
cron.schedule('0 * * * *', async () => {
  if (!messagingIntegration || !TELEGRAM_TOKEN) return;
  const users = await db.getAllUsersWithTelegram().catch(() => []);
  for (const user of users) {
    try {
      const tz = user.timezone || process.env.DAILY_MESSAGE_TIMEZONE || 'Asia/Singapore';
      const localHour = new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
      const preferredHour = user.preferredHour !== undefined ? user.preferredHour : 8;
      if (parseInt(localHour) !== preferredHour) continue;
      console.log(`📅 Sending daily message to user ${user.userId} (${tz} hour ${localHour})`);
      const text = await messagingIntegration.assistant.buildDailyMessage(user.userId);
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: user.telegramChatId,
        text,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      console.error(`Daily message failed for user ${user.userId}:`, err.message);
    }
  }
});
console.log('⏰ Hourly cron active — daily messages fire at each user\'s preferred hour');
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 5: Commit and push**

```bash
git add assistant-features.js slack-telegram-integration.js backend.js
git commit -m "feat: custom daily message time per user"
git push
```
