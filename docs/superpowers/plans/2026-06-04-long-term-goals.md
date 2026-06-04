# Long-Term Goals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing `createLongTermGoal` and `progressMilestone` methods through a guided 4-step conversation flow, a goal list view with progress bars, and inline milestone completion buttons.

**Architecture:** A `goalDraft` state machine in `profile` intercepts messages during goal creation (same pattern as the existing onboarding flow). `assistant-features.js` gets four new methods (`listLongTermGoals`, `getLongTermGoalDetail`, `markMilestoneByText`, `_goalProgressBar`) plus two LLM helpers (`_generateMilestones`, `_reviseMilestones`). `slack-telegram-integration.js` handles the draft flow and new intent cases. `backend.js` gets `goal_view` and `milestone_done` callback handlers plus the `/longterm` slash command.

**Tech Stack:** Node.js (CommonJS), existing `_callOpenRouter`, existing `progressMilestone`/`createLongTermGoal` methods, Jest for unit tests.

---

## File Map

| File | What changes |
|---|---|
| `tests/snapshot.test.js` | Add 3 tests for `_goalProgressBar` |
| `assistant-features.js` | Add `_goalProgressBar`, `listLongTermGoals`, `getLongTermGoalDetail`, `_generateMilestones`, `_reviseMilestones`, `markMilestoneByText`; fix `createLongTermGoal` coach response parsing; update `classifyIntent` |
| `slack-telegram-integration.js` | Add `_handleGoalDraft`; add goalDraft state intercept in `handleTelegramMessage`; add `longterm` + `milestonedone` cases |
| `backend.js` | Add `goal_view` + `milestone_done` callback handlers in webhook + polling; add `/longterm` to `setMyCommands` + `resolveSlashCommand` |

---

### Task 1: `_goalProgressBar` helper with tests

**Files:**
- Modify: `assistant-features.js`
- Modify: `tests/snapshot.test.js`

- [ ] **Step 1: Write failing tests**

Add to the bottom of `tests/snapshot.test.js`:

```js
test('_goalProgressBar shows 0% for no completed milestones', () => {
  const ms = [{ name: 'MVP', completed: false }, { name: 'Launch', completed: false }];
  const result = assistant._goalProgressBar(ms);
  expect(result.pct).toBe(0);
  expect(result.done).toBe(0);
  expect(result.total).toBe(2);
  expect(result.bar).toBe('░░░░░░░░░░');
  expect(result.next).toBe('MVP');
});

test('_goalProgressBar shows 50% when half complete', () => {
  const ms = [{ name: 'MVP', completed: true }, { name: 'Launch', completed: false }];
  const result = assistant._goalProgressBar(ms);
  expect(result.pct).toBe(50);
  expect(result.done).toBe(1);
  expect(result.next).toBe('Launch');
});

test('_goalProgressBar shows 100% and done message when all complete', () => {
  const ms = [{ name: 'MVP', completed: true }];
  const result = assistant._goalProgressBar(ms);
  expect(result.pct).toBe(100);
  expect(result.bar).toBe('▓▓▓▓▓▓▓▓▓▓');
  expect(result.next).toBe('All done! 🎉');
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test tests/snapshot.test.js
```

Expected: FAIL — `_goalProgressBar is not a function`

- [ ] **Step 3: Add `_goalProgressBar` to `assistant-features.js`**

Add after `_formatHabit`:

```js
_goalProgressBar(milestonesProgress) {
  const total = milestonesProgress.length;
  const done = milestonesProgress.filter(m => m.completed).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const filled = Math.round(pct / 10);
  const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
  const next = milestonesProgress.find(m => !m.completed)?.name || 'All done! 🎉';
  return { bar, pct, done, total, next };
}
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
npm test tests/snapshot.test.js
```

Expected: PASS — 3 new tests passing, all prior tests still passing.

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js tests/snapshot.test.js
git commit -m "feat: add _goalProgressBar helper with tests"
```

---

### Task 2: `listLongTermGoals` and `getLongTermGoalDetail`

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Add `listLongTermGoals` after `_goalProgressBar`**

```js
async listLongTermGoals(userId) {
  const profile = await this._getOrCreateProfile(userId);
  const goals = (profile.longTermGoals || []).filter(g => g.status === 'active');
  if (goals.length === 0) {
    return 'No long-term goals yet.\n\nSay something like _"I want to build a SaaS product"_ to set one.';
  }
  const lines = ['🎯 *Your Long-term Goals*', '─────────────────'];
  goals.forEach((g, i) => {
    const { bar, pct, done, total, next } = this._goalProgressBar(g.milestonesProgress || []);
    lines.push(`\n${i + 1}. *${g.title}* _(${g.timeline})_`);
    lines.push(`   ${bar} ${pct}% · ${done}/${total} milestones`);
    lines.push(`   Next: ${next}`);
  });
  return lines.join('\n');
}
```

- [ ] **Step 2: Add `getLongTermGoalDetail` after `listLongTermGoals`**

```js
getLongTermGoalDetail(profile, goalId) {
  const goal = (profile.longTermGoals || []).find(g => g.id === goalId);
  if (!goal) return null;
  const { pct } = this._goalProgressBar(goal.milestonesProgress || []);
  const lines = [
    `🎯 *${goal.title}*`,
    `Timeline: ${goal.timeline} · ${pct}% complete`,
    '─────────────────'
  ];
  (goal.milestonesProgress || []).forEach(m => {
    const dateStr = m.completed && m.completedDate
      ? ` _(${new Date(m.completedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})_`
      : '';
    lines.push(`${m.completed ? '✅' : '⬜'} ${m.name}${dateStr}`);
  });
  return { goal, text: lines.join('\n') };
}
```

Note: `getLongTermGoalDetail` takes `profile` directly (already loaded) rather than `userId` — avoids a second DB call since callers always have the profile already.

- [ ] **Step 3: Run all tests — confirm still passing**

```bash
npm test
```

Expected: all 20 tests passing (17 prior + 3 from Task 1).

- [ ] **Step 4: Commit**

```bash
git add assistant-features.js
git commit -m "feat: add listLongTermGoals and getLongTermGoalDetail"
```

---

### Task 3: `_generateMilestones`, `_reviseMilestones`, `markMilestoneByText`

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Add `_generateMilestones` after `getLongTermGoalDetail`**

```js
async _generateMilestones(title, why, timeline) {
  const monthMatch = timeline.match(/(\d+)\s*month/i);
  const weekMatch = timeline.match(/(\d+)\s*week/i);
  const totalDays = monthMatch ? parseInt(monthMatch[1]) * 30
    : weekMatch ? parseInt(weekMatch[1]) * 7
    : 90;

  const systemPrompt = `Generate 4-5 concrete, measurable milestones for this goal. Each milestone should be a clear checkpoint.

Goal: ${title}
Why it matters: ${why}
Timeline: ${timeline}

Reply with ONLY a numbered list, one milestone per line:
1. [milestone name]
2. [milestone name]
...

Milestones must be specific, achievable, and in chronological order. No explanations.`;

  const raw = await this._callOpenRouter(`Milestones for: ${title}`, systemPrompt);
  const milestones = [];
  raw.split('\n').forEach(line => {
    const match = line.match(/^\d+[.)]\s*(.+)/);
    if (match && milestones.length < 5) {
      milestones.push({
        name: match[1].trim(),
        daysUntil: Math.round(totalDays * (milestones.length + 1) / 5)
      });
    }
  });
  return milestones.length > 0 ? milestones : [{ name: 'First milestone', daysUntil: 30 }];
}
```

- [ ] **Step 2: Add `_reviseMilestones` after `_generateMilestones`**

```js
async _reviseMilestones(currentMilestones, feedback) {
  const systemPrompt = `Update this milestone list based on user feedback. Keep changes minimal.

Current milestones:
${currentMilestones.map((m, i) => `${i + 1}. ${m.name}`).join('\n')}

User feedback: "${feedback}"

Reply with ONLY the updated numbered list:
1. [milestone name]
2. [milestone name]
...`;

  const raw = await this._callOpenRouter('Update milestones', systemPrompt);
  const updated = [];
  raw.split('\n').forEach(line => {
    const match = line.match(/^\d+[.)]\s*(.+)/);
    if (match) updated.push({ name: match[1].trim(), daysUntil: 30 });
  });
  return updated.length > 0 ? updated : currentMilestones;
}
```

- [ ] **Step 3: Add `markMilestoneByText` after `_reviseMilestones`**

```js
async markMilestoneByText(userId, message) {
  const profile = await this._getOrCreateProfile(userId);
  const goals = (profile.longTermGoals || []).filter(g => g.status === 'active');
  if (goals.length === 0) {
    return "You don't have any active long-term goals. Say _\"I want to...\"_ to set one.";
  }

  const candidates = goals.flatMap(g =>
    (g.milestonesProgress || []).map((m, i) => ({
      goalId: g.id, goalTitle: g.title, milestoneIndex: i, name: m.name, completed: m.completed
    }))
  ).filter(m => !m.completed);

  if (candidates.length === 0) return 'All your milestones are already done! 🎉';

  const systemPrompt = `Match the user message to the most likely milestone being completed.

Message: "${message}"

Incomplete milestones:
${candidates.map((m, i) => `${i}: [${m.goalTitle}] ${m.name}`).join('\n')}

Reply with ONLY the index number (0, 1, 2…) of the best match. If no match, reply "none".`;

  const raw = await this._callOpenRouter(message, systemPrompt);
  const trimmed = raw.trim().toLowerCase();
  const idx = parseInt(trimmed);
  if (trimmed === 'none' || isNaN(idx) || !candidates[idx]) {
    return "I couldn't match that to a milestone. Tap 📍 on your goals to see and complete milestones.";
  }

  const match = candidates[idx];
  const result = await this.progressMilestone(userId, match.goalId, match.milestoneIndex);
  return typeof result === 'object' ? result.message : result;
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js
git commit -m "feat: add _generateMilestones, _reviseMilestones, markMilestoneByText"
```

---

### Task 4: Fix `createLongTermGoal` coach response parsing

**Files:**
- Modify: `assistant-features.js`

The existing `createLongTermGoal` returns `{ goalId, goal, coachResponse }` where `coachResponse` is raw LLM text with `BELIEF:`, `BREAKDOWN:`, `FIRST_STEP:`, `MOTIVATION:` labels. The caller (`_handleGoalDraft`) will use `coachResponse` directly as the message text, so it must be pre-formatted.

- [ ] **Step 1: Find the return block in `createLongTermGoal`**

Current code (around line 379):
```js
const response = await this._callOpenRouter(`Help me start: ${goal.title}`, systemPrompt);

return {
  goalId,
  goal: fullGoal,
  coachResponse: response
};
```

- [ ] **Step 2: Add parsing before the return**

Replace the `return` block with:

```js
const raw = await this._callOpenRouter(`Help me start: ${goal.title}`, systemPrompt);

const get = (label) => {
  const match = raw.match(new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i'));
  return match ? match[1].trim() : null;
};
const belief = get('BELIEF');
const firstStep = get('FIRST.?STEP');
const motivation = get('MOTIVATION');

const lines = [];
if (belief) lines.push(`🚀 *${belief}*`);
if (firstStep) lines.push(`\n🗓 *This week*\n${firstStep}`);
if (motivation) lines.push(`\n💙 ${motivation}`);
const coachResponse = lines.join('\n') || raw;

return { goalId, goal: fullGoal, coachResponse };
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 4: Commit**

```bash
git add assistant-features.js
git commit -m "fix: parse createLongTermGoal coach response into Telegram-formatted text"
```

---

### Task 5: Update `classifyIntent` for new intents

**Files:**
- Modify: `assistant-features.js`

- [ ] **Step 1: Add fast-paths after the existing `streak` fast-path**

Find this line in `classifyIntent`:
```js
if (/\b(streak|how many days)\b/i.test(normalized)) return 'streak';
```

Add immediately after it:
```js
if (/\b(long.?term goal|big goal|set a goal|my goals|my long.?term)\b/i.test(normalized)) return 'longterm';
if (/\b(milestone done|finished the|completed the|i finished|i completed)\b/i.test(normalized)) return 'milestonedone';
```

- [ ] **Step 2: Add intent descriptions to the LLM prompt**

Find the block ending with `dailyconfig - ...` and `chat - ...`. Add before `chat`:

```
longterm - setting or viewing long-term goals ("I want to build X", "my long-term goals", "big goal", "set a big goal", "show my goals")
milestonedone - completing a milestone of a long-term goal ("I finished the MVP", "milestone done", "I completed X")
```

- [ ] **Step 3: Add `longterm` and `milestonedone` to the valid list**

Find:
```js
const valid = ['task','schedule','idea','commit','energy','review','motivation','pattern','abandoned','help','connect','question','list','complete','delete','edit','streak','stats','settings','peakhours','insight','dailyconfig','chat'];
```

Replace with:
```js
const valid = ['task','schedule','idea','commit','energy','review','motivation','pattern','abandoned','help','connect','question','list','complete','delete','edit','streak','stats','settings','peakhours','insight','longterm','milestonedone','dailyconfig','chat'];
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js
git commit -m "feat: add longterm and milestonedone intents to classifyIntent"
```

---

### Task 6: `_handleGoalDraft` + goalDraft state intercept

**Files:**
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Add `_handleGoalDraft` method**

Add this method inside `MessagingIntegration`, after `_handleOnboardingReply`:

```js
async _handleGoalDraft(message, userId, chatId, profile) {
  const draft = profile.goalDraft;

  // Allow cancellation at any step
  if (/^(cancel|stop|restart|start over|never mind|abort)\b/i.test(message.trim())) {
    await this.assistant.updateProfileMeta(userId, { goalDraft: null });
    return this._formatTelegramResponse(
      'Goal draft cancelled. Say _"I want to..."_ whenever you\'re ready to set a big goal.',
      chatId
    );
  }

  if (draft.step === 'awaiting_title') {
    const title = message.trim();
    await this.assistant.updateProfileMeta(userId, {
      goalDraft: { step: 'awaiting_why', title, why: null, timeline: null, proposedMilestones: [] }
    });
    return {
      chat_id: chatId,
      text: `✨ *${title}* — love it.\n\nWhy does this matter to you? What's the real reason behind it?`,
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    };
  }

  if (draft.step === 'awaiting_why') {
    const why = message.trim();
    await this.assistant.updateProfileMeta(userId, {
      goalDraft: { ...draft, step: 'awaiting_timeline', why }
    });
    return {
      chat_id: chatId,
      text: 'Got it. How long are you giving yourself?\n\nFor example: _"3 months"_, _"by December"_, _"6 months"_',
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    };
  }

  if (draft.step === 'awaiting_timeline') {
    const timeline = message.trim();
    const milestones = await this.assistant._generateMilestones(draft.title, draft.why, timeline);
    await this.assistant.updateProfileMeta(userId, {
      goalDraft: { ...draft, step: 'confirming_milestones', timeline, proposedMilestones: milestones }
    });
    const list = milestones.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
    return {
      chat_id: chatId,
      text: `📍 *Here's a milestone plan for ${draft.title}:*\n\n${list}\n\nDoes this look right? Say *"yes"* to save, or tell me what to change.`,
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    };
  }

  if (draft.step === 'confirming_milestones') {
    const confirmed = /^(yes|yep|yeah|looks good|perfect|great|ok|okay|sure|save|that('s| is) (good|right|perfect))/i.test(message.trim());
    if (confirmed) {
      const result = await this.assistant.createLongTermGoal(userId, {
        title: draft.title,
        why: draft.why,
        timeline: draft.timeline,
        milestones: draft.proposedMilestones
      });
      await this.assistant.updateProfileMeta(userId, { goalDraft: null });
      return {
        chat_id: chatId,
        text: result.coachResponse,
        parse_mode: 'Markdown',
        reply_markup: this._persistentKeyboard()
      };
    }
    // Revision requested
    const updated = await this.assistant._reviseMilestones(draft.proposedMilestones, message);
    await this.assistant.updateProfileMeta(userId, {
      goalDraft: { ...draft, proposedMilestones: updated }
    });
    const list = updated.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
    return {
      chat_id: chatId,
      text: `📍 *Updated plan:*\n\n${list}\n\nDoes this look right? Say *"yes"* to save.`,
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    };
  }

  // Unknown step — clear draft
  await this.assistant.updateProfileMeta(userId, { goalDraft: null });
  return this._formatTelegramResponse('Something went wrong with your goal draft. Let\'s start fresh — say "I want to..." to begin.', chatId);
}
```

- [ ] **Step 2: Add goalDraft state intercept in `handleTelegramMessage`**

Find the onboarding intercept at the top of `handleTelegramMessage`:

```js
if (profile.onboardingStep === 'awaiting_habit' && !this._resolveKeyboardShortcut(message)) {
  return this._handleOnboardingReply(message, userId, chatId);
}
```

Add immediately after it:

```js
if (profile.goalDraft?.step && !this._resolveKeyboardShortcut(message)) {
  return this._handleGoalDraft(message, userId, chatId, profile);
}
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 4: Commit**

```bash
git add slack-telegram-integration.js
git commit -m "feat: add _handleGoalDraft and goalDraft state intercept"
```

---

### Task 7: `longterm` and `milestonedone` cases in `handleTelegramMessage`

**Files:**
- Modify: `slack-telegram-integration.js`

- [ ] **Step 1: Add `longterm` case to the switch statement**

Find the `case 'milestonedone':` placeholder location. In `handleTelegramMessage`, add these two cases after `case 'insight':`:

```js
case 'longterm': {
  const goals = (profile.longTermGoals || []).filter(g => g.status === 'active');
  if (goals.length === 0) {
    // No goals — start creation flow
    await this.assistant.updateProfileMeta(userId, {
      goalDraft: { step: 'awaiting_title', title: null, why: null, timeline: null, proposedMilestones: [] }
    });
    response = {
      chat_id: chatId,
      text: '🎯 *Let\'s set a big goal.*\n\nWhat\'s the goal? Just the name — keep it short.\n\nFor example:\n• "Build a SaaS product"\n• "Run a marathon"\n• "Write a book"',
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    };
  } else {
    const listText = await this.assistant.listLongTermGoals(userId);
    const buttons = goals.map(g => [{
      text: `📍 ${g.title.slice(0, 35)}`,
      callback_data: `goal_view:${userId}:${g.id}`
    }]);
    buttons.push([{ text: '➕ Add new goal', callback_data: `longterm_new:${userId}` }]);
    response = {
      chat_id: chatId,
      text: this._toTelegramMarkdown(listText),
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    };
  }
  break;
}

case 'milestonedone':
  response = this._formatTelegramResponse(
    await this.assistant.markMilestoneByText(userId, message), chatId
  );
  break;
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 3: Commit**

```bash
git add slack-telegram-integration.js
git commit -m "feat: add longterm and milestonedone cases to handleTelegramMessage"
```

---

### Task 8: `goal_view`, `milestone_done`, `longterm_new` callback handlers in `backend.js`

**Files:**
- Modify: `backend.js`

The callback handler chain in the webhook handler ends with `habit_skip`. The same chain exists in the polling loop. Add three new `else if` blocks to both.

- [ ] **Step 1: Add handlers in the webhook `callback_query` block**

Find the last `} else if (action === 'habit_skip')` block closing `}` in the webhook handler. Add after it:

```js
} else if (action === 'goal_view' && messagingIntegration) {
  const cbUserId = parts[1];
  const goalId = parts[2];
  try {
    const profile = await db.getUserProfile(cbUserId);
    if (!profile) return;
    const detail = messagingIntegration.assistant.getLongTermGoalDetail(profile, goalId);
    if (!detail) return;
    const { goal, text } = detail;
    const inlineButtons = (goal.milestonesProgress || [])
      .map((m, i) => !m.completed ? [{
        text: `✅ ${m.name.slice(0, 35)}`,
        callback_data: `milestone_done:${cbUserId}:${goalId}:${i}`
      }] : null)
      .filter(Boolean);
    await messagingIntegration.sendToTelegram(cbChatId, text, {
      parse_mode: 'Markdown',
      reply_markup: inlineButtons.length > 0 ? { inline_keyboard: inlineButtons } : undefined
    });
  } catch (err) {
    console.error('goal_view callback failed:', err.message);
  }
} else if (action === 'milestone_done' && messagingIntegration) {
  const cbUserId = parts[1];
  const goalId = parts[2];
  const milestoneIndex = parseInt(parts[3]);
  try {
    const result = await messagingIntegration.assistant.progressMilestone(cbUserId, goalId, milestoneIndex);
    const text = typeof result === 'object' ? result.message : result;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
      chat_id: cbChatId,
      message_id: cbMessageId,
      text,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('milestone_done callback failed:', err.message);
  }
} else if (action === 'longterm_new' && messagingIntegration) {
  const cbUserId = parts[1];
  try {
    await messagingIntegration.assistant.updateProfileMeta(cbUserId, {
      goalDraft: { step: 'awaiting_title', title: null, why: null, timeline: null, proposedMilestones: [] }
    });
    await messagingIntegration.sendToTelegram(cbChatId,
      '🎯 *Let\'s set a new big goal.*\n\nWhat\'s the goal?',
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('longterm_new callback failed:', err.message);
  }
}
```

- [ ] **Step 2: Apply identical blocks to the polling loop**

Find the polling loop's `habit_skip` closing `}` and add the same three `else if` blocks (exact same code — `return` is not used in polling, the blocks just fall through).

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 4: Commit**

```bash
git add backend.js
git commit -m "feat: add goal_view, milestone_done, longterm_new callback handlers"
```

---

### Task 9: `/longterm` slash command in `setMyCommands` + `resolveSlashCommand`

**Files:**
- Modify: `backend.js`

- [ ] **Step 1: Add `/longterm` to `setMyCommands` commands list**

Find the `commands` array in `registerBotCommands`. Add after `/settings`:

```js
{ command: 'longterm',  description: 'Set or view your long-term goals' },
```

- [ ] **Step 2: Add `longterm` to `resolveSlashCommand` commandMap**

Find the `commandMap` object in `resolveSlashCommand`. Add:

```js
longterm: 'my long-term goals',
```

- [ ] **Step 3: Force-register updated commands with Telegram**

```bash
source .env && node -e "
const axios = require('axios');
axios.post('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/setMyCommands', {
  commands: [
    {command:'start',description:'Get started with a guided setup'},
    {command:'help',description:'See everything I can do'},
    {command:'tasks',description:'View your open tasks'},
    {command:'streak',description:'Check your daily habit streak'},
    {command:'stats',description:'Your productivity stats at a glance'},
    {command:'review',description:'Get your weekly progress review'},
    {command:'patterns',description:'Analyse your productivity patterns'},
    {command:'insights',description:'Your peak work hours based on energy'},
    {command:'coach',description:'Deep personal AI coaching'},
    {command:'motivation',description:'Get a boost when you need it'},
    {command:'energy',description:'Log your energy level (1-10)'},
    {command:'goals',description:'Revisit goals you have not touched'},
    {command:'settings',description:'View your current settings'},
    {command:'longterm',description:'Set or view your long-term goals'},
    {command:'connect',description:'Link your Google Calendar'}
  ]
}).then(r => console.log(r.data)).catch(e => console.error(e.message));
"
```

Expected output: `{ ok: true, result: true }`

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 5: Commit and push**

```bash
git add backend.js
git commit -m "feat: add /longterm slash command to setMyCommands and resolveSlashCommand"
git push origin main
```

---

## Verification Checklist

Before marking implementation complete:

- [ ] Say "I want to run a marathon" → Step 1 prompt appears (awaiting_title)
- [ ] Complete all 4 steps → goal saved, coach response shows `🚀` / `🗓 This week` / `💙` sections (no raw labels)
- [ ] `/longterm` with no goals → creation flow starts at Step 1
- [ ] `/longterm` with existing goals → list with 📍 View buttons + ➕ Add new goal
- [ ] Tap 📍 View → milestone detail with ✅ Done buttons per incomplete milestone
- [ ] Tap ✅ Done on a milestone → message edits to show celebration text
- [ ] Say "I finished the MVP" → matched to correct milestone, marked done
- [ ] Tap ➕ Add new goal → creation flow starts
- [ ] Pressing a keyboard button (📋 My Tasks) during goal draft → routes normally, not captured by draft
- [ ] All 20 tests pass: `npm test`
