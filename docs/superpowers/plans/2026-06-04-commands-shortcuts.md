# Commands, Shortcuts & Workflow Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slash commands, persistent keyboard, contextual prompts, guided onboarding, daily snapshot, post-action buttons, habit nudges, and four cron jobs so the bot feels like a natural part of the user's daily routine.

**Architecture:** Three layers — (1) `backend.js` registers commands with Telegram on startup, detects slash commands before LLM classification, and runs four new per-user cron checks inside the existing hourly cron; (2) `slack-telegram-integration.js` enriches every response with a persistent keyboard, appends a daily snapshot on the first message of the day, sends post-action inline buttons fire-and-forget, and handles onboarding state; (3) `assistant-features.js` adds `_buildDailySnapshot`, updates `getWelcomeIfNew` for onboarding, and extends `setDailyMessageTime` to configure all four job times.

**Tech Stack:** Node.js (CommonJS), Telegram Bot API, node-cron (already installed), Jest (new dev dep), native `Intl.DateTimeFormat` for timezone-aware date formatting.

---

## File Map

| File | What changes |
|---|---|
| `package.json` | Add `jest` dev dependency + `"test": "jest"` script |
| `tests/keyboard.test.js` | New — unit tests for keyboard helpers |
| `tests/snapshot.test.js` | New — unit tests for `_buildDailySnapshot` |
| `assistant-features.js` | `_buildDailySnapshot`, updated `getWelcomeIfNew`, extended `setDailyMessageTime`, enhanced `listTasks` + `checkAbandonedGoals` empty states |
| `slack-telegram-integration.js` | `_persistentKeyboard`, `_resolveKeyboardShortcut`, `handleStart`, `_handleOnboardingReply`, `_appendDailySnapshot`, keyboard on all responses, habit nudge in task saves, post-action contextual buttons |
| `backend.js` | `setMyCommands` on startup, slash command detection in webhook + polling loop, three new hourly cron checks + habit_done/habit_skip callback handling |

---

### Task 1: Set up Jest

**Files:**
- Modify: `package.json`
- Create: `tests/keyboard.test.js`

- [ ] **Step 1: Install jest**

```bash
npm install --save-dev jest
```

- [ ] **Step 2: Add test script to `package.json`**

Replace:
```json
"test": "echo \"Error: no test specified\" && exit 1"
```
With:
```json
"test": "jest"
```

- [ ] **Step 3: Create placeholder test**

Create `tests/keyboard.test.js`:
```js
test('jest is working', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
npm test
```

Expected: `PASS tests/keyboard.test.js` — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/keyboard.test.js
git commit -m "chore: add jest for unit tests"
```

---

### Task 2: Persistent keyboard helpers

**Files:**
- Modify: `slack-telegram-integration.js`
- Modify: `tests/keyboard.test.js`

- [ ] **Step 1: Write failing tests**

Replace `tests/keyboard.test.js` with:
```js
const MessagingIntegration = require('../slack-telegram-integration');

const integration = new MessagingIntegration({
  openrouterKey: 'test',
  openrouterModel: 'test',
  telegramToken: 'test'
});

test('_persistentKeyboard returns 2 rows of 3 buttons', () => {
  const kb = integration._persistentKeyboard();
  expect(kb.keyboard).toHaveLength(2);
  expect(kb.keyboard[0]).toHaveLength(3);
  expect(kb.keyboard[1]).toHaveLength(3);
  expect(kb.persistent).toBe(true);
  expect(kb.resize_keyboard).toBe(true);
});

test('_resolveKeyboardShortcut maps My Tasks to list', () => {
  expect(integration._resolveKeyboardShortcut('📋 My Tasks')).toBe('list');
});

test('_resolveKeyboardShortcut maps My Streak to streak', () => {
  expect(integration._resolveKeyboardShortcut('🔥 My Streak')).toBe('streak');
});

test('_resolveKeyboardShortcut maps Motivate Me to motivation', () => {
  expect(integration._resolveKeyboardShortcut('💪 Motivate Me')).toBe('motivation');
});

test('_resolveKeyboardShortcut maps Patterns to pattern', () => {
  expect(integration._resolveKeyboardShortcut('📊 Patterns')).toBe('pattern');
});

test('_resolveKeyboardShortcut maps Weekly Review to review', () => {
  expect(integration._resolveKeyboardShortcut('📅 Weekly Review')).toBe('review');
});

test('_resolveKeyboardShortcut maps Help to help', () => {
  expect(integration._resolveKeyboardShortcut('❓ Help')).toBe('help');
});

test('_resolveKeyboardShortcut returns null for unknown text', () => {
  expect(integration._resolveKeyboardShortcut('buy milk tomorrow')).toBeNull();
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test tests/keyboard.test.js
```

Expected: FAIL with `TypeError: integration._persistentKeyboard is not a function`.

- [ ] **Step 3: Add `_persistentKeyboard` and `_resolveKeyboardShortcut` to `slack-telegram-integration.js`**

Add these two methods inside the `MessagingIntegration` class, after the constructor (before `handleTelegramMessage`):

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

_resolveKeyboardShortcut(text) {
  const map = {
    '📋 My Tasks': 'list',
    '🔥 My Streak': 'streak',
    '💪 Motivate Me': 'motivation',
    '📊 Patterns': 'pattern',
    '📅 Weekly Review': 'review',
    '❓ Help': 'help'
  };
  return map[text] || null;
}
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
npm test tests/keyboard.test.js
```

Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add slack-telegram-integration.js tests/keyboard.test.js
git commit -m "feat: add persistent keyboard helpers"
```

---

### Task 3: Attach keyboard to all responses + keyboard shortcut routing

**Files:**
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Attach keyboard in `_formatTelegramResponse`**

In `slack-telegram-integration.js`, find `_formatTelegramResponse`. At the end, before `return`, the method currently returns:
```js
return {
  chat_id: chatId,
  text: this._toTelegramMarkdown(text),
  parse_mode: 'Markdown'
};
```

Replace with:
```js
return {
  chat_id: chatId,
  text: this._toTelegramMarkdown(text),
  parse_mode: 'Markdown',
  reply_markup: this._persistentKeyboard()
};
```

- [ ] **Step 2: Preserve existing `reply_markup` overrides**

Some handlers return their own `reply_markup` (Google connect inline button, location request). These are returned directly as plain objects, not via `_formatTelegramResponse`, so they are not affected. Verify by searching for all `return {` statements in `handleTelegramMessage` that already include `reply_markup` — they bypass `_formatTelegramResponse` and will be fine.

The task-saved response (in `case 'task'/'schedule'`) returns a plain object. Update it to include the keyboard:

Find the block that ends with:
```js
return { chat_id: chatId, text: msg, parse_mode: 'Markdown' };
```

Replace with:
```js
return { chat_id: chatId, text: msg, parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
```

Also update the "I need a clearer task" fallback in the same case:
```js
return { chat_id: chatId, text: 'I need a clearer task. Try something like "Buy milk tomorrow" or "Call dentist on Friday".', parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
```

And the Google connect "not configured" fallback:
```js
return { chat_id: chatId, text: 'Google Calendar connection is not configured on this server.', parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
```

- [ ] **Step 3: Add keyboard shortcut routing at top of `handleTelegramMessage`**

In `handleTelegramMessage`, find:
```js
const intent = await this.assistant.classifyIntent(message);
console.log(`Intent classified as "${intent}" for message:`, message);
```

Replace with:
```js
const shortcutIntent = this._resolveKeyboardShortcut(message);
const intent = shortcutIntent || await this.assistant.classifyIntent(message);
console.log(`Intent classified as "${intent}" for message:`, message);
```

- [ ] **Step 4: Run the server and send a button tap manually to verify**

```bash
npm start
```

Tap `📋 My Tasks` in Telegram — confirm it responds with the task list instantly (no typing indicator delay from LLM).

- [ ] **Step 5: Commit**

```bash
git add slack-telegram-integration.js
git commit -m "feat: attach persistent keyboard to all responses + shortcut routing"
```

---

### Task 4: `_buildDailySnapshot` helper

**Files:**
- Modify: `assistant-features.js`
- Create: `tests/snapshot.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/snapshot.test.js`:
```js
const FriendlyAssistant = require('../assistant-features');

const assistant = new FriendlyAssistant({ openrouterKey: 'test', openrouterModel: 'test' });

test('_buildDailySnapshot shows no tasks when list is empty', () => {
  const profile = { allTasks: [], dailyCommitment: null, currentStreak: 0, energyLog: [], timezone: 'UTC' };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('No tasks due today');
  expect(snapshot).toContain('No habit set yet');
  expect(snapshot).toContain('Energy not logged yet');
});

test('_buildDailySnapshot shows streak and habit name', () => {
  const profile = {
    allTasks: [],
    dailyCommitment: { minutes: 15, description: 'reading' },
    currentStreak: 7,
    energyLog: [],
    timezone: 'UTC'
  };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('7 day');
  expect(snapshot).toContain('reading');
});

test('_buildDailySnapshot shows last energy level', () => {
  const profile = {
    allTasks: [],
    dailyCommitment: null,
    currentStreak: 0,
    energyLog: [{ level: 8, timestamp: new Date().toISOString() }],
    timezone: 'UTC'
  };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('8/10');
});

test('_buildDailySnapshot counts tasks due in next 24h', () => {
  const profile = {
    allTasks: [
      { completed: false, deadline: 'today', deadlineMs: null, action: 'Buy milk' },
      { completed: false, deadline: 'next week', deadlineMs: Date.now() + 8 * 24 * 60 * 60 * 1000, action: 'Tax return' },
      { completed: true, deadline: 'today', deadlineMs: null, action: 'Done thing' }
    ],
    dailyCommitment: null,
    currentStreak: 0,
    energyLog: [],
    timezone: 'UTC'
  };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('1 task');
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test tests/snapshot.test.js
```

Expected: FAIL with `TypeError: assistant._buildDailySnapshot is not a function`.

- [ ] **Step 3: Add `_buildDailySnapshot` to `assistant-features.js`**

Add this method inside `FriendlyAssistant`, after `_buildStreakMessage`:

```js
_buildDailySnapshot(profile) {
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  const tasksDue = (profile.allTasks || []).filter(t => {
    if (t.completed) return false;
    if (t.deadlineMs) return t.deadlineMs >= now && t.deadlineMs < in24h;
    return t.deadline === 'today';
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

  return ['─────────────────', '📅 *Today\'s snapshot*', tasksLine, streakLine, energyLine].join('\n');
}
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
npm test tests/snapshot.test.js
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js tests/snapshot.test.js
git commit -m "feat: add _buildDailySnapshot helper"
```

---

### Task 5: Daily snapshot on first message of the day

**Files:**
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Add `_appendDailySnapshot` method to `MessagingIntegration`**

Add this method inside the class, after `_resolveKeyboardShortcut`:

```js
async _appendDailySnapshot(response, userId) {
  try {
    const profile = await this.assistant._getOrCreateProfile(userId);
    const tz = profile.timezone || 'UTC';
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    if (profile.lastSnapshotDate === todayKey) return response;
    const snapshot = this.assistant._buildDailySnapshot(profile);
    await this.assistant.updateProfileMeta(userId, { lastSnapshotDate: todayKey });
    if (response && typeof response.text === 'string') {
      return { ...response, text: response.text + '\n\n' + snapshot };
    }
  } catch (err) {
    console.error('Daily snapshot failed:', err.message);
  }
  return response;
}
```

- [ ] **Step 2: Call `_appendDailySnapshot` at the end of `handleTelegramMessage`**

The `handleTelegramMessage` method has a `switch (intent)` block. Each case `return`s a response. Instead of modifying each case, refactor the end of the method to collect the response and pipe it through `_appendDailySnapshot`.

Find the switch statement in `handleTelegramMessage`. It currently looks like:

```js
switch (intent) {
  case 'help':
    return this._formatTelegramResponse(this._helpMessage(), chatId);
  case 'task':
  // ...
  default:
    return this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
}
```

Wrap the entire switch in a variable assignment, then pipe through the snapshot:

```js
let response;
switch (intent) {
  case 'help':
    response = this._formatTelegramResponse(this._helpMessage(), chatId);
    break;
  case 'task':
  case 'schedule': {
    // ... existing task handling code ...
    response = { chat_id: chatId, text: msg, parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
    break;
  }
  case 'idea':
    response = this._formatTelegramResponse(await this.assistant.deepenIdea(message, userId), chatId);
    break;
  case 'commit': {
    // ... existing commit handling ...
    response = this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
    break;
  }
  case 'energy': {
    // ... existing energy handling ...
    break;
  }
  case 'review':
    response = this._formatTelegramResponse(await this.assistant.generateWeeklyReview(userId), chatId);
    break;
  case 'motivation':
    response = this._formatTelegramResponse(await this.assistant.getMotivatation(userId, 'default'), chatId);
    break;
  case 'pattern':
    response = this._formatTelegramResponse(await this.assistant.analyzePatterns(userId), chatId);
    break;
  case 'abandoned':
    response = this._formatTelegramResponse(await this.assistant.checkAbandonedGoals(userId), chatId);
    break;
  case 'connect': {
    // ... existing connect handling (keeps its own reply_markup) ...
    break;
  }
  case 'question':
    response = this._formatTelegramResponse(await this.assistant.answerQuestion(message, userId), chatId);
    break;
  case 'list':
    response = this._formatTelegramResponse(await this.assistant.listTasks(userId), chatId);
    break;
  case 'complete':
    response = this._formatTelegramResponse(await this.assistant.completeTask(userId, message), chatId);
    break;
  case 'delete':
    response = this._formatTelegramResponse(await this.assistant.deleteTask(userId, message), chatId);
    break;
  case 'streak':
    response = this._formatTelegramResponse(await this.assistant.formatStreakMessage(userId), chatId);
    break;
  case 'dailyconfig':
    response = this._formatTelegramResponse(await this.assistant.setDailyMessageTime(userId, message), chatId);
    break;
  default:
    response = this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
}

return this._appendDailySnapshot(response, userId);
```

**Important:** The `connect` case already has its own `return` with a custom `reply_markup`. Keep that `return` in place — it bypasses both `_formatTelegramResponse` and `_appendDailySnapshot`, which is intentional (connect flow owns its UX). Extract it with `return` before reaching the snapshot append.

- [ ] **Step 3: Verify manually**

Start the bot, send any message. The snapshot should appear at the bottom of the first response of the day. Send another message — snapshot should NOT appear again.

- [ ] **Step 4: Commit**

```bash
git add slack-telegram-integration.js
git commit -m "feat: append daily snapshot on first message of each day"
```

---

### Task 6: Onboarding — `getWelcomeIfNew` + `handleStart`

**Files:**
- Modify: `assistant-features.js`
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Update `getWelcomeIfNew` in `assistant-features.js`**

The current `getWelcomeIfNew` sets `welcomed: true` and returns a generic welcome string for new users. It is called at the top of `handleTelegramMessage` for every message. Now that `/start` owns the onboarding flow, `getWelcomeIfNew` should only fire when a new user sends a message WITHOUT going through `/start` first (edge case).

Find the current implementation:

```js
async getWelcomeIfNew(userId) {
  const profile = await this._getOrCreateProfile(userId);
  if (profile.welcomed) return null;
  profile.welcomed = true;
  await this._saveProfile(userId, profile);
  return '👋 *Welcome to Fluffy Fiesta!*\nI\'m your personal productivity companion on Telegram.\nType *"help"* anytime to see everything I can do.\n─────────────────';
}
```

Replace with:

```js
async getWelcomeIfNew(userId) {
  const profile = await this._getOrCreateProfile(userId);
  if (profile.welcomed) return null;
  profile.welcomed = true;
  await this._saveProfile(userId, profile);
  return '👋 *Welcome to Fluffy Fiesta!*\n\nI\'m your personal productivity companion. Just type naturally to add tasks, track habits, or ask me anything.\n\nTip: type */start* for a quick guided setup, or */help* to see what I can do.\n─────────────────';
}
```

- [ ] **Step 2: Add `handleStart` to `MessagingIntegration` in `slack-telegram-integration.js`**

Add this method inside the class, after `handleTelegramMessage`:

```js
async handleStart(userId, chatId) {
  const profile = await this.assistant._getOrCreateProfile(userId);

  if (profile.welcomed && profile.onboardingStep !== 'awaiting_habit') {
    // Returning user — short re-orientation
    const streak = profile.currentStreak || 0;
    const commitment = profile.dailyCommitment;
    const openTasks = (profile.allTasks || []).filter(t => !t.completed).length;
    const lines = [
      '👋 *Welcome back!* You\'re all set up.',
      '',
      `🔥 Streak: ${streak} day(s)  |  📌 Open tasks: ${openTasks}`
    ];
    if (commitment) lines.push(`🎯 Daily habit: ${commitment.minutes}min ${commitment.description}`);
    lines.push('', 'Use the buttons below or just type naturally. /help to see everything.');
    await this.sendToTelegram(chatId, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    });
    return;
  }

  // New user — 2-message onboarding
  await this.sendToTelegram(chatId,
    '👋 *Hey! I\'m your personal productivity companion.*\n\n' +
    'Here\'s what I do:\n' +
    '• 📌 Remember your tasks and remind you before deadlines\n' +
    '• 🔥 Track your daily habits and keep your streak alive\n' +
    '• 💪 Motivate you and help you reflect on your progress\n\n' +
    'Let\'s get you set up in 30 seconds.',
    { parse_mode: 'Markdown' }
  );

  await this.sendToTelegram(chatId,
    '*What\'s one thing you want to do every day?*\n\n' +
    'For example:\n' +
    '• 15 min reading\n' +
    '• 30 min workout\n' +
    '• 10 min journaling\n\n' +
    'Just type it below 👇',
    { parse_mode: 'Markdown' }
  );

  await this.assistant.updateProfileMeta(userId, { welcomed: true, onboardingStep: 'awaiting_habit' });
}
```

- [ ] **Step 3: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js
git commit -m "feat: add /start onboarding flow for new and returning users"
```

---

### Task 7: Onboarding step routing in `handleTelegramMessage`

**Files:**
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Add `_handleOnboardingReply` method**

Add this inside the class, after `handleStart`:

```js
async _handleOnboardingReply(message, userId, chatId) {
  const minMatch = message.match(/(\d+)\s*min/i);
  if (minMatch) {
    const minutes = parseInt(minMatch[1]);
    const desc = message.replace(/\d+\s*min(ute)?s?/i, '').trim() || 'daily practice';
    await this.assistant.setDailyCommitment(userId, { minutes, description: desc });
    await this.assistant.updateProfileMeta(userId, { onboardingStep: 'none' });
    return {
      chat_id: chatId,
      text: `🔥 *Done! I'll track your ${minutes}min ${desc} streak every day.*\n\nYou're all set. Just type naturally — or use the buttons below.\nType /help anytime to see what I can do.`,
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    };
  }
  // Couldn't parse — re-prompt once
  return {
    chat_id: chatId,
    text: 'Hmm, I need something like _"15 min reading"_ or _"30 min workout"_. What\'s your daily habit?',
    parse_mode: 'Markdown'
  };
}
```

- [ ] **Step 2: Add onboarding check at top of `handleTelegramMessage`**

At the very top of `handleTelegramMessage`, before the `getWelcomeIfNew` call, add:

```js
// Handle onboarding habit capture
const profile = await this.assistant._getOrCreateProfile(userId);
if (profile.onboardingStep === 'awaiting_habit') {
  return this._handleOnboardingReply(message, userId, chatId);
}
```

- [ ] **Step 3: Test manually**

Send `/start` as a user with no profile → confirm 2 messages arrive. Reply with "15 min reading" → confirm confirmation message + keyboard appears. Send `/start` again → confirm re-orientation (not the 2-step flow).

- [ ] **Step 4: Commit**

```bash
git add slack-telegram-integration.js
git commit -m "feat: route awaiting_habit onboarding state in handleTelegramMessage"
```

---

### Task 8: Habit nudge woven into task saves

**Files:**
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Add habit nudge to the `task`/`schedule` case**

In `handleTelegramMessage`, find the `task`/`schedule` case. After saving the task and before assigning `response`, add a habit nudge check.

Find the line where `msg` is built (the `✅ *Task saved!*` message). After that array is constructed and joined, add:

```js
// Append habit nudge if habit not logged today
const todayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: profile.timezone || 'UTC'
}).format(new Date());
const habitProfile = await this.assistant._getOrCreateProfile(userId);
const habitLoggedToday = habitProfile.commitmentHistory?.[todayKey]?.success;
if (habitProfile.dailyCommitment && !habitLoggedToday) {
  const nudge = `\n\n💬 _Don't forget your ${habitProfile.dailyCommitment.minutes}min ${habitProfile.dailyCommitment.description} today — you're on a ${habitProfile.currentStreak || 0}-day streak!_`;
  response = { chat_id: chatId, text: msg + nudge, parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
} else {
  response = { chat_id: chatId, text: msg, parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
}
```

Note: `profile` is already loaded at the top of `handleTelegramMessage` from the onboarding check (Task 7, Step 2). Reuse it here — it's the same user, same request.

- [ ] **Step 2: Test manually**

Set a daily habit (e.g. "Set 15 min reading every day"), then add a task. The task confirmation should include the habit nudge line if you haven't logged the habit today.

- [ ] **Step 3: Commit**

```bash
git add slack-telegram-integration.js
git commit -m "feat: append habit nudge to task saves when habit not logged today"
```

---

### Task 9: Post-action contextual inline buttons

**Files:**
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Add `_sendContextualButtons` helper**

Add this method inside the class, after `_appendDailySnapshot`:

```js
_sendContextualButtons(chatId, userId, buttons) {
  this.sendToTelegram(chatId, '👆', {
    reply_markup: { inline_keyboard: buttons }
  }).catch(err => console.error('Contextual button send failed:', err.message));
}
```

- [ ] **Step 2: Fire contextual buttons in `complete` case**

In the `complete` case, after `response` is assigned, add:

```js
this._sendContextualButtons(chatId, userId, [[
  { text: '📋 Remaining Tasks', callback_data: `shortcut:${userId}:list` },
  { text: '🔥 My Streak', callback_data: `shortcut:${userId}:streak` }
]]);
```

- [ ] **Step 3: Fire contextual buttons in `review` case**

After `response` is assigned in the `review` case, add:

```js
this._sendContextualButtons(chatId, userId, [[
  { text: '📊 See Patterns', callback_data: `shortcut:${userId}:patterns` },
  { text: '🎯 Revisit Goals', callback_data: `shortcut:${userId}:goals` }
]]);
```

- [ ] **Step 4: Fire contextual buttons in `energy` case for low energy**

In the `energy` case, after a numeric match, after `response` is assigned:

```js
const energyLevel = parseInt(numMatch[1]);
if (energyLevel <= 4) {
  this._sendContextualButtons(chatId, userId, [[
    { text: '💪 Motivate Me', callback_data: `shortcut:${userId}:motivation` },
    { text: '📋 My Tasks', callback_data: `shortcut:${userId}:list` }
  ]]);
}
```

- [ ] **Step 5: Handle shortcut callback data in `backend.js`**

In `backend.js`, inside the `callback_query` handler, find:

```js
if (messagingIntegration && (action === 'done' || action === 'snooze')) {
```

Add an `else if` block after the closing `}`:

```js
} else if (action === 'shortcut' && messagingIntegration) {
  const shortcutMap = {
    list: 'list my tasks',
    streak: 'show my streak',
    motivation: 'motivate me',
    patterns: 'show my patterns',
    goals: 'check abandoned goals'
  };
  const target = parts[2];
  const cbUserId = parts[1];
  if (shortcutMap[target]) {
    try {
      const formatted = await messagingIntegration.handleTelegramMessage(shortcutMap[target], cbUserId, cbChatId);
      await messagingIntegration.sendToTelegram(formatted.chat_id || cbChatId, formatted.text, {
        parse_mode: formatted.parse_mode,
        reply_markup: formatted.reply_markup
      });
    } catch (err) {
      console.error('Shortcut callback failed:', err.message);
    }
  }
}
```

Apply the same change to the polling loop's `callback_query` block — it is identical to the webhook block.

- [ ] **Step 6: Commit**

```bash
git add slack-telegram-integration.js backend.js
git commit -m "feat: add post-action contextual inline buttons"
```

---

### Task 10: Smart empty states

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Update `listTasks` empty state**

Find in `assistant-features.js`:

```js
if (tasks.length === 0) {
  return '✨ *No tasks yet!*\nTell me something like "Buy milk tomorrow" to add one.';
}
```

Replace with:

```js
if (tasks.length === 0) {
  return '✨ *No tasks yet!*\n─────────────────\nTry typing one of these to get started:\n\n• _"Call dentist Friday"_\n• _"Submit report by Monday"_\n• _"Buy groceries today"_\n\nOr just tell me what you need to do!';
}
```

- [ ] **Step 2: Update `checkAbandonedGoals` empty state**

Find:

```js
if (abandoned.length === 0) return [];
```

Replace with:

```js
if (abandoned.length === 0) return '🎯 *No forgotten goals!*\n\nYou\'re on top of everything — great work.\nWant to add a new goal? Just type what you want to achieve.';
```

Note: the method currently returns `[]` (an array) for the empty case but a `reminders` array otherwise. The `formatTelegramResponse` already handles arrays. The new return is a string, which `_formatTelegramResponse` also handles (via the `typeof response === 'string'` branch). No other change needed.

- [ ] **Step 3: Update `formatStreakMessage` empty state**

Find:

```js
async formatStreakMessage(userId) {
  const s = await this.getStreakStatus(userId);
  if (!s.dailyCommitment) {
    return 'No daily commitment set yet.\nSay *"set a daily commitment to 15 min reading"* to start one!';
  }
```

Replace the empty-state return with:

```js
  if (!s.dailyCommitment) {
    return 'No daily habit set yet 🌱\n─────────────────\nTell me what you want to do every day, for example:\n\n• _"Set 15 min reading every day"_\n• _"30 min workout daily"_\n\nI\'ll track your streak automatically.';
  }
```

- [ ] **Step 4: Update `energy` case in `handleTelegramMessage` to return a direct prompt**

In `slack-telegram-integration.js`, in the `energy` case, find:

```js
return this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
```

This is the fallback when no number is found. Replace it with:

```js
response = {
  chat_id: chatId,
  text: '⚡ How\'s your energy today?\n\nReply with a number: *1* (exhausted) → *10* (on fire)',
  parse_mode: 'Markdown',
  reply_markup: this._persistentKeyboard()
};
break;
```

- [ ] **Step 5: Add data guard to `generateWeeklyReview` in `assistant-features.js`**

Find `generateWeeklyReview`. After loading the profile and calculating `weekStats`, add an early return if data is insufficient:

```js
async generateWeeklyReview(userId) {
  const profile = await this._getOrCreateProfile(userId);
  const weekStats = this._calculateWeekStats(profile);

  if (weekStats.attempts < 3) {
    return 'Not enough data for a full review yet 📊\n\nKeep logging for a few days — I need at least 3 days of data to spot patterns.\n\nWant to set a daily habit to track? Try _"Set 15 min reading every day"_.';
  }

  // ... rest of existing code unchanged ...
```

- [ ] **Step 6: Run existing tests to confirm nothing is broken**

```bash
npm test
```

Expected: all tests still passing.

- [ ] **Step 7: Commit**

```bash
git add assistant-features.js slack-telegram-integration.js
git commit -m "feat: improve empty states in listTasks, checkAbandonedGoals, formatStreakMessage, energy, review"
```

---

### Task 11: Extend `setDailyMessageTime` for 4 job types

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Replace `setDailyMessageTime` in `assistant-features.js`**

Find the entire current implementation of `setDailyMessageTime` and replace it with:

```js
async setDailyMessageTime(userId, message) {
  const lower = message.toLowerCase();

  // Detect "off" / "disable"
  const isOff = /\b(off|disable|stop|never)\b/.test(lower);

  // Parse hour
  const hourMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let hour = null;
  if (hourMatch && !isOff) {
    hour = parseInt(hourMatch[1]);
    const meridiem = (hourMatch[3] || '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) {
      return 'Please give a valid hour between 0 and 23.';
    }
  }

  // Detect which job to configure
  let field, jobName;
  if (/habit|nudge|streak reminder/i.test(lower)) {
    field = 'habitNudgeTime'; jobName = 'habit nudge';
  } else if (/energy|check.?in/i.test(lower)) {
    field = 'energyCheckTime'; jobName = 'energy check-in';
  } else if (/weekly|review|sunday/i.test(lower)) {
    field = 'weeklyReviewTime'; jobName = 'weekly review';
  } else {
    // Default: morning brief
    field = 'morningBriefTime'; jobName = 'morning brief';
  }

  const profile = await this._getOrCreateProfile(userId);

  if (isOff) {
    profile[field] = null;
    await this._saveProfile(userId, profile);
    return `⏰ Got it! Your ${jobName} has been turned off.`;
  }

  if (hour === null) {
    return 'I couldn\'t parse that time. Try something like *"morning brief at 7am"* or *"energy check at 9pm"*.';
  }

  profile[field] = hour;
  // Keep preferredHour in sync for backwards compatibility with the existing morning cron
  if (field === 'morningBriefTime') profile.preferredHour = hour;
  await this._saveProfile(userId, profile);

  const display = hour === 0 ? '12:00 AM' : hour < 12 ? `${hour}:00 AM` : hour === 12 ? '12:00 PM' : `${hour - 12}:00 PM`;
  return `⏰ Got it! Your ${jobName} is now set to *${display}* every day.`;
}
```

- [ ] **Step 2: Test manually**

Send "Send my morning brief at 7am" → confirm response says "morning brief" at 7:00 AM.
Send "Habit nudge at 9pm" → confirm response says "habit nudge" at 9:00 PM.
Send "Energy check off" → confirm "energy check-in has been turned off".

- [ ] **Step 3: Commit**

```bash
git add assistant-features.js
git commit -m "feat: extend setDailyMessageTime to configure all 4 scheduled job times"
```

---

### Task 12: `setMyCommands` registration on startup

**Files:**
- Modify: `backend.js`

- [ ] **Step 1: Add `registerBotCommands` function in `backend.js`**

Add this function near the top of `backend.js`, after the `OPENROUTER_URL` constant:

```js
async function registerBotCommands() {
  if (!TELEGRAM_TOKEN) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setMyCommands`, {
      commands: [
        { command: 'start', description: 'Get started with a guided setup' },
        { command: 'help', description: 'See everything I can do' },
        { command: 'tasks', description: 'View your open tasks' },
        { command: 'streak', description: 'Check your daily habit streak' },
        { command: 'review', description: 'Get your weekly progress review' },
        { command: 'patterns', description: 'Analyse your productivity patterns' },
        { command: 'motivation', description: 'Get a boost when you need it' },
        { command: 'energy', description: 'Log your energy level (1–10)' },
        { command: 'goals', description: 'Revisit goals you have not touched' },
        { command: 'connect', description: 'Link your Google Calendar' }
      ]
    });
    console.log('✅ Bot commands registered with Telegram');
  } catch (err) {
    console.warn('⚠️ setMyCommands failed (non-fatal):', err.response?.data?.description || err.message);
  }
}
```

- [ ] **Step 2: Call `registerBotCommands` in the startup block**

Inside `app.listen(PORT, async () => { ... })`, after `await initializeIntegrations();`, add:

```js
await registerBotCommands();
```

- [ ] **Step 3: Start the server and confirm the log line**

```bash
npm start
```

Expected log: `✅ Bot commands registered with Telegram`

Open Telegram, type `/` in the bot chat — confirm the command list appears.

- [ ] **Step 4: Commit**

```bash
git add backend.js
git commit -m "feat: register bot commands with Telegram on startup"
```

---

### Task 13: Slash command detection in webhook + polling

**Files:**
- Modify: `backend.js`

- [ ] **Step 1: Add slash command resolution helper**

Add this function near `registerBotCommands` in `backend.js`:

```js
function resolveSlashCommand(msg) {
  const entity = (msg.entities || []).find(e => e.type === 'bot_command' && e.offset === 0);
  if (!entity) return null;
  const raw = msg.text.slice(1, entity.length).split('@')[0].toLowerCase();
  const commandMap = {
    help: 'help',
    tasks: 'list my tasks',
    streak: 'show my streak',
    review: 'weekly review',
    patterns: 'show my patterns',
    motivation: 'motivate me',
    energy: 'energy',
    goals: 'check abandoned goals',
    connect: 'connect google'
  };
  return { command: raw, text: commandMap[raw] || null };
}
```

- [ ] **Step 2: Apply slash command detection in the webhook handler**

In the `/telegram/webhook` POST handler, find:

```js
if (!msg.text) return;
const text = msg.text;

try {
  await sendTelegramTyping(chatId);

  if (messagingIntegration) {
    messagingIntegration.assistant.updateProfileMeta(userId, { telegramChatId: chatId })
      .catch(err => console.error('Profile meta update failed:', err.message));

    const formatted = await messagingIntegration.handleTelegramMessage(text, userId, chatId);
```

Replace with:

```js
if (!msg.text) return;

try {
  await sendTelegramTyping(chatId);

  if (messagingIntegration) {
    messagingIntegration.assistant.updateProfileMeta(userId, { telegramChatId: chatId })
      .catch(err => console.error('Profile meta update failed:', err.message));

    // Handle slash commands
    const slash = resolveSlashCommand(msg);
    if (slash) {
      if (slash.command === 'start') {
        await messagingIntegration.handleStart(userId, chatId);
        return;
      }
      if (slash.text) {
        const formatted = await messagingIntegration.handleTelegramMessage(slash.text, userId, chatId);
        await messagingIntegration.sendToTelegram(formatted.chat_id || chatId, formatted.text, {
          parse_mode: formatted.parse_mode,
          reply_markup: formatted.reply_markup
        });
        return;
      }
    }

    const text = msg.text;
    const formatted = await messagingIntegration.handleTelegramMessage(text, userId, chatId);
```

- [ ] **Step 3: Apply the same detection in the polling loop**

In `telegramPolling()`, find the equivalent block inside the message processing loop:

```js
if (msg.text) {
  const { text } = msg;
  try {
    await sendTelegramTyping(chatId);
    if (messagingIntegration) {
      messagingIntegration.assistant.updateProfileMeta(userId, { telegramChatId: chatId })
        .catch(err => console.error('Profile meta update failed:', err.message));
      const formatted = await messagingIntegration.handleTelegramMessage(text, userId, chatId);
```

Replace with:

```js
if (msg.text) {
  try {
    await sendTelegramTyping(chatId);
    if (messagingIntegration) {
      messagingIntegration.assistant.updateProfileMeta(userId, { telegramChatId: chatId })
        .catch(err => console.error('Profile meta update failed:', err.message));

      const slash = resolveSlashCommand(msg);
      if (slash) {
        if (slash.command === 'start') {
          await messagingIntegration.handleStart(userId, chatId);
          continue;
        }
        if (slash.text) {
          const formatted = await messagingIntegration.handleTelegramMessage(slash.text, userId, chatId);
          await messagingIntegration.sendToTelegram(formatted.chat_id || chatId, formatted.text, {
            parse_mode: formatted.parse_mode,
            reply_markup: formatted.reply_markup
          });
          continue;
        }
      }

      const text = msg.text;
      const formatted = await messagingIntegration.handleTelegramMessage(text, userId, chatId);
```

- [ ] **Step 4: Test all slash commands**

Start the bot and send each slash command from Telegram:
- `/help` → help message with keyboard
- `/tasks` → task list (or empty state)
- `/streak` → streak message
- `/motivation` → motivation text
- `/energy` → prompt to log energy
- `/start` → onboarding (if new) or re-orientation (if returning)

- [ ] **Step 5: Commit**

```bash
git add backend.js
git commit -m "feat: detect and route slash commands in webhook and polling"
```

---

### Task 14: Scheduled cron jobs (habit nudge, energy check-in, weekly review)

**Files:**
- Modify: `backend.js`

The existing hourly cron already handles the morning briefing by checking `preferredHour`. Add the three new jobs inside the same `cron.schedule('0 * * * *', ...)` callback, after the existing morning-brief block.

- [ ] **Step 1: Handle `habit_done` and `habit_skip` callback data**

In the `callback_query` handler (webhook), inside the existing `if (messagingIntegration && (action === 'done' || action === 'snooze'))` block, add a new `else if` after it:

```js
} else if (action === 'habit_done' && messagingIntegration) {
  const cbUserId = parts[1];
  try {
    const profile = await db.getUserProfile(cbUserId);
    if (profile?.dailyCommitment) {
      await messagingIntegration.assistant.logDailyCommitment(cbUserId, profile.dailyCommitment.minutes);
    }
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
      chat_id: cbChatId,
      message_id: cbMessageId,
      text: '✅ *Habit logged!* Great work — keep that streak going! 🔥',
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('habit_done callback failed:', err.message);
  }
} else if (action === 'habit_skip') {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
      chat_id: cbChatId,
      message_id: cbMessageId,
      text: '⏭ Skipped today — that\'s okay. Tomorrow, fresh start.',
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('habit_skip callback failed:', err.message);
  }
}
```

Apply the identical block to the polling loop's callback_query handler.

- [ ] **Step 2: Add habit nudge, energy check-in, and weekly review to the hourly cron**

Find the existing cron block:

```js
cron.schedule('0 * * * *', async () => {
  if (!messagingIntegration || !TELEGRAM_TOKEN) return;
  const users = await db.getAllUsersWithTelegram().catch(() => []);
  for (const user of users) {
    try {
      const tz = user.timezone || process.env.DAILY_MESSAGE_TIMEZONE || 'Asia/Singapore';
      const localHour = parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
      const preferredHour = user.preferredHour !== undefined ? user.preferredHour : 8;
      if (localHour !== preferredHour) continue;
      console.log(`📅 Sending daily message to user ${user.userId} (${tz}, hour ${localHour})`);
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
```

Replace with:

```js
cron.schedule('0 * * * *', async () => {
  if (!messagingIntegration || !TELEGRAM_TOKEN) return;
  const users = await db.getAllUsersWithTelegram().catch(() => []);
  const now = new Date();

  for (const user of users) {
    if (!user.telegramChatId) continue;
    try {
      const tz = user.timezone || process.env.DAILY_MESSAGE_TIMEZONE || 'Asia/Singapore';
      const localHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
      const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

      // ── Morning briefing ──────────────────────────────────────────────────
      const morningHour = user.morningBriefTime !== undefined ? user.morningBriefTime
        : (user.preferredHour !== undefined ? user.preferredHour : 8);
      if (localHour === morningHour && user.lastMorningBriefDate !== todayKey) {
        const text = await messagingIntegration.assistant.buildDailyMessage(user.userId);
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: user.telegramChatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: messagingIntegration._persistentKeyboard()
        });
        await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastMorningBriefDate: todayKey });
        console.log(`☀️ Morning brief sent to user ${user.userId}`);
      }

      // ── Habit nudge ───────────────────────────────────────────────────────
      const habitHour = user.habitNudgeTime !== undefined ? user.habitNudgeTime : 20;
      const habitLoggedToday = user.commitmentHistory?.[todayKey]?.success;
      if (localHour === habitHour && user.dailyCommitment && !habitLoggedToday
          && user.lastHabitNudgeDate !== todayKey) {
        const streak = user.currentStreak || 0;
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: user.telegramChatId,
          text: `🔔 Hey! Your ${streak}-day streak is on the line.\n\nHave you done your *${user.dailyCommitment.description}* today?\n\nLog it: _"I did ${user.dailyCommitment.minutes} min ${user.dailyCommitment.description}"_`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ I did it', callback_data: `habit_done:${user.userId}` },
              { text: '⏭ Skip today', callback_data: `habit_skip:${user.userId}` }
            ]]
          }
        });
        await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastHabitNudgeDate: todayKey });
        console.log(`🔔 Habit nudge sent to user ${user.userId}`);
      }

      // ── Energy check-in ───────────────────────────────────────────────────
      const energyHour = user.energyCheckTime !== undefined ? user.energyCheckTime : 21;
      const energyLoggedToday = (user.energyLog || []).some(e =>
        e.timestamp && e.timestamp.startsWith(todayKey)
      );
      if (localHour === energyHour && !energyLoggedToday
          && user.lastEnergyCheckDate !== todayKey) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: user.telegramChatId,
          text: '⚡ *How was your energy today?*\n\nReply with a number: 1 (exhausted) → 10 (on fire)',
          parse_mode: 'Markdown',
          reply_markup: messagingIntegration._persistentKeyboard()
        });
        await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastEnergyCheckDate: todayKey });
        console.log(`⚡ Energy check-in sent to user ${user.userId}`);
      }

      // ── Weekly review (Sundays only) ──────────────────────────────────────
      const weeklyHour = user.weeklyReviewTime !== undefined ? user.weeklyReviewTime : 18;
      const isSunday = now.toLocaleString('en-US', { timeZone: tz, weekday: 'long' }) === 'Sunday';
      const hasEnoughData = Object.keys(user.commitmentHistory || {}).length >= 3;
      if (isSunday && localHour === weeklyHour && hasEnoughData
          && user.lastWeeklyReviewDate !== todayKey) {
        const review = await messagingIntegration.assistant.generateWeeklyReview(user.userId);
        const formatted = messagingIntegration._formatTelegramResponse(review, user.telegramChatId);
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: user.telegramChatId,
          text: formatted.text,
          parse_mode: 'Markdown',
          reply_markup: messagingIntegration._persistentKeyboard()
        });
        await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastWeeklyReviewDate: todayKey });
        console.log(`📊 Weekly review sent to user ${user.userId}`);
      }

    } catch (err) {
      console.error(`Scheduled message failed for user ${user.userId}:`, err.message);
    }
  }
});
```

- [ ] **Step 3: Run the server and verify cron log output**

```bash
npm start
```

Expected log: `⏰ Hourly cron active — daily messages fire at each user's preferred hour (default 8am)`

To test the habit nudge without waiting for 8pm: temporarily change `const habitHour = 20` to the current local hour for your test user, confirm the nudge arrives, then revert.

- [ ] **Step 4: Commit**

```bash
git add backend.js
git commit -m "feat: add habit nudge, energy check-in, and weekly review cron jobs"
```

---

## Verification Checklist

Before marking implementation complete:

- [ ] `/start` shows 2-message onboarding for new users; habit reply creates commitment; keyboard appears
- [ ] `/start` for returning user shows streak + open task count
- [ ] `/tasks`, `/streak`, `/help`, `/motivation`, `/energy`, `/review`, `/patterns`, `/goals`, `/connect` all work
- [ ] Command picker in Telegram shows all 10 commands with descriptions
- [ ] Persistent keyboard appears on every response (including task saves, reviews, etc.)
- [ ] Tapping a keyboard button responds instantly without LLM call (check server logs — no "Intent classified" log)
- [ ] First message of the day shows the snapshot section; second message of the day does not
- [ ] Task save with habit-not-logged-today shows nudge line; without habit or after logging shows nothing
- [ ] Completing a task shows contextual inline buttons for "Remaining Tasks" and "My Streak"
- [ ] Energy ≤ 4 shows "Motivate Me" + "My Tasks" contextual buttons
- [ ] Tapping a contextual inline button triggers the correct response
- [ ] `/tasks` with no tasks shows example suggestions
- [ ] `/streak` with no habit set shows setup prompt
- [ ] "Morning brief at 7am" updates the morning brief time
- [ ] "Habit nudge off" disables the habit nudge
- [ ] Habit nudge arrives at configured time if habit not logged
- [ ] Energy check-in arrives at 9pm if energy not logged
- [ ] Weekly review arrives Sunday at 6pm if ≥ 3 commitment history entries
- [ ] Tapping ✅ I did it on habit nudge logs the commitment and edits the message
- [ ] All existing tests still pass: `npm test`
