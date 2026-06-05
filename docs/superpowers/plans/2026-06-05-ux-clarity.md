# UX Clarity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bot's core feedback loop visible — streak response shows week history and a data-driven feedback line; patterns and weekly review get clear headers explaining what data they use; energy logging returns a contextual response showing running stats and progress toward peak-hour insights.

**Architecture:** Pure copy/feedback changes to four existing methods in `assistant-features.js` (`formatStreakMessage`, `analyzePatterns`, `generateWeeklyReview`, `logEnergy`) plus one handler update in `slack-telegram-integration.js` (`case 'energy':`). A new pure helper `_streakFeedback` is extracted for testability. No new data is collected, no AI prompts changed, no new intents added.

**Tech Stack:** Node.js (CommonJS), Jest, existing `commitmentHistory`, `energyLog`, `_analyzeEnergyPattern`, `_formatHabit` helpers.

---

## File Map

| File | Changes |
|---|---|
| `assistant-features.js` | Add `_streakFeedback` helper; rewrite `formatStreakMessage`; add header + specific not-enough-data to `analyzePatterns`; add header to `generateWeeklyReview`; rewrite `logEnergy` to return a plain string |
| `slack-telegram-integration.js` | Update `case 'energy':` to handle plain string from `logEnergy` and add high-energy nudge |
| `tests/snapshot.test.js` | Tests for `_streakFeedback` variants; tests for energy log response format |

---

### Task 1: `_streakFeedback` helper + `formatStreakMessage` redesign

**Files:**
- Modify: `assistant-features.js`
- Modify: `tests/snapshot.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/snapshot.test.js`:

```js
test('_streakFeedback returns personal best message when streak is new high', () => {
  const history = [
    { date: '2026-06-01', success: true },
    { date: '2026-06-02', success: true },
    { date: '2026-06-03', success: true },
  ];
  const result = assistant._streakFeedback(history, 3);
  expect(result).toContain('longest streak');
});

test('_streakFeedback returns weekend slip message when weekend rate is low', () => {
  const history = [
    { date: '2026-06-02', success: true },  // Mon
    { date: '2026-06-03', success: true },  // Tue
    { date: '2026-06-04', success: true },  // Wed
    { date: '2026-05-31', success: false }, // Sat
    { date: '2026-06-01', success: false }, // Sun
  ];
  const result = assistant._streakFeedback(history, 3);
  expect(result).toContain('weekend');
});

test('_streakFeedback returns default message when not enough pattern', () => {
  const history = [
    { date: '2026-06-01', success: true },
    { date: '2026-06-02', success: true },
    { date: '2026-06-03', success: true },
    { date: '2026-06-04', success: true },
  ];
  const result = assistant._streakFeedback(history, 1);
  expect(typeof result).toBe('string');
  expect(result.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test tests/snapshot.test.js
```

Expected: FAIL — `_streakFeedback is not a function`

- [ ] **Step 3: Add `_streakFeedback` helper to `assistant-features.js`**

Add after `_formatHabit` (around line 1226):

```js
_streakFeedback(historyEntries, currentStreak) {
  // Completion rate by day of week
  const byDow = {};
  historyEntries.forEach(h => {
    if (!h.date) return;
    const [y, m, d] = h.date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
    if (!byDow[dow]) byDow[dow] = [];
    byDow[dow].push(h.success ? 1 : 0);
  });

  const rate = (days) => {
    const vals = days.flatMap(d => byDow[d] || []);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const weekdayRate = rate(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  const weekendRate = rate(['Saturday', 'Sunday']);

  // Personal best streak from history
  const sorted = [...historyEntries].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let best = 0, run = 0;
  sorted.forEach(h => { run = h.success ? run + 1 : 0; if (run > best) best = run; });

  if (currentStreak > 0 && currentStreak >= best && best > 1) {
    return `This is your longest streak yet — ${currentStreak} days!`;
  }
  if (weekdayRate !== null && weekendRate !== null && weekendRate < weekdayRate - 0.3 && weekendRate < 0.5) {
    return 'You tend to slip on weekends — weekdays are your strong suit.';
  }
  if (weekdayRate !== null && weekendRate !== null && weekdayRate < weekendRate - 0.3) {
    return "You're actually stronger on weekends — interesting.";
  }
  const worstEntries = Object.entries(byDow)
    .map(([d, vs]) => [d, vs.reduce((a, b) => a + b, 0) / vs.length])
    .sort((a, b) => a[1] - b[1]);
  if (worstEntries[0] && worstEntries[0][1] < 0.5) {
    return `${worstEntries[0][0]}s are your hardest day — plan ahead.`;
  }
  return 'Every check-in counts. Keep going.';
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm test tests/snapshot.test.js
```

Expected: 3 new tests pass, all prior tests still pass.

- [ ] **Step 5: Replace `formatStreakMessage` in `assistant-features.js`**

Find `async formatStreakMessage(userId)` (around line 1082). Replace the entire method with:

```js
async formatStreakMessage(userId) {
  const s = await this.getStreakStatus(userId);
  if (!s.dailyCommitment) {
    return 'No daily habit set yet 🌱\n─────────────────\nTell me what you want to do every day, for example:\n\n• _"Set 15 min reading every day"_\n• _"30 min workout daily"_\n\nI\'ll track your streak automatically.';
  }

  const profile = await this._getOrCreateProfile(userId);
  const tz = profile.timezone || 'UTC';
  const history = profile.commitmentHistory || {};

  // Last 5 days ending today
  const now = new Date();
  const cells = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    const label = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
    cells.push(`${history[key]?.success ? '✅' : '⬜'} ${label}`);
  }

  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const todayDone = history[todayKey]?.success;
  const todayLine = todayDone
    ? '✅ Today: done — great work!'
    : '⏳ Today not logged yet\n→ Say _"I did it"_ to keep your streak';

  const historyEntries = Object.values(history);
  const feedback = historyEntries.length >= 4
    ? `\n\n💡 ${this._streakFeedback(historyEntries, s.currentStreak)}`
    : '';

  return [
    `🔥 *Streak: ${s.currentStreak} day(s) — ${this._formatHabit(s.dailyCommitment)}*`,
    '─────────────────',
    cells.join('  '),
    '',
    todayLine
  ].join('\n') + feedback;
}
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all 26 tests passing (23 prior + 3 new).

- [ ] **Step 7: Commit**

```bash
git add assistant-features.js tests/snapshot.test.js
git commit -m "feat: streak week view with data-driven feedback line"
```

---

### Task 2: `analyzePatterns` — header + specific not-enough-data message

**Files:**
- Modify: `assistant-features.js`
- Modify: `tests/snapshot.test.js`

- [ ] **Step 1: Write failing test**

Append to `tests/snapshot.test.js`:

```js
test('analyzePatterns not-enough-data message shows counts', async () => {
  const a = new FriendlyAssistant({ openrouterKey: 'test' });
  // In-memory profile with minimal data (no DB)
  a.userProfiles.set('testuser', {
    allTasks: [{ completed: true }, { completed: true }],
    energyLog: [{ level: 7, timestamp: new Date().toISOString() }, { level: 8, timestamp: new Date().toISOString() }],
    commitmentHistory: {},
    longTermGoals: []
  });
  const result = await a.analyzePatterns('testuser');
  expect(result).toContain('Energy logs: 2');
  expect(result).toContain('Tasks completed: 2');
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm test tests/snapshot.test.js
```

Expected: FAIL — analyzePatterns returns something that doesn't contain "Energy logs: 2"

- [ ] **Step 3: Update `analyzePatterns` in `assistant-features.js`**

Find `async analyzePatterns(userId)` (around line 429). Replace the entire method with:

```js
async analyzePatterns(userId) {
  const profile = await this._getOrCreateProfile(userId);

  const energyCount = (profile.energyLog || []).length;
  const habitCheckins = Object.values(profile.commitmentHistory || {}).filter(h => h.success).length;
  const completedTasks = (profile.allTasks || []).filter(t => t.completed).length;

  const hasEnoughData = energyCount >= 5 && habitCheckins >= 3;

  if (!hasEnoughData) {
    const energyLine = `• Energy logs: ${energyCount} so far (need 5+)`;
    const habitLine = `• Habit check-ins: ${habitCheckins} logged (need 3+)`;
    const tasksLine = `• Tasks completed: ${completedTasks}`;
    return `🔍 *How you work*\n_Based on your task history, energy logs, and habit check-ins_\n─────────────────\n\nNot enough data yet. Here\'s what I need:\n${energyLine}\n${habitLine}\n${tasksLine}\n\nKeep going — patterns emerge around day 7.\n_Say a number like "7" to log your energy today._`;
  }

  const analysis = {
    procrastinationPatterns: this._findProcrastinationPatterns(profile),
    focusWindows: this._findFocusWindows(profile),
    abandonmentRisk: this._findAtRiskGoals(profile),
    overcommitment: this._checkOvercommitment(profile),
    energyDrain: this._identifyEnergyDrains(profile)
  };

  const systemPrompt = `You are a behavioral coach analyzing someone's patterns.
Be insightful but kind. Show you see the person behind the data.

${JSON.stringify(analysis, null, 2)}

Reply in exactly this format (no extra text before or after):
INSIGHT: [what you notice about how they work — 2-3 sentences]
GOOD_NEWS: [what they're doing right — 2-3 sentences]
GENTLE_CHALLENGE: [what might be holding them back — 2-3 sentences]
EXPERIMENT: [one concrete small behavior change to try this week — 1-2 sentences]`;

  const raw = await this._callOpenRouter('Analyze my patterns', systemPrompt);

  const get = (label) => {
    const match = raw.match(new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i'));
    return match ? match[1].trim() : null;
  };
  const insight   = get('INSIGHT');
  const goodNews  = get('GOOD.?NEWS');
  const challenge = get('GENTLE.?CHALLENGE');
  const experiment = get('EXPERIMENT');

  const lines = ['🔍 *How you work*', '_Based on your task history, energy logs, and habit check-ins_', '─────────────────', ''];
  if (insight)    lines.push(`🔍 *Insight*\n${insight}`);
  if (goodNews)   lines.push(`✅ *Good news*\n${goodNews}`);
  if (challenge)  lines.push(`🎯 *Gentle challenge*\n${challenge}`);
  if (experiment) lines.push(`🧪 *Try this week*\n${experiment}`);

  return lines.join('\n\n');
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: 27 tests passing.

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js tests/snapshot.test.js
git commit -m "feat: analyzePatterns header and specific not-enough-data breakdown"
```

---

### Task 3: `generateWeeklyReview` — header

**Files:**
- Modify: `assistant-features.js`
- Modify: `tests/snapshot.test.js`

- [ ] **Step 1: Write failing test**

Append to `tests/snapshot.test.js`:

```js
test('generateWeeklyReview not-enough-data includes header', async () => {
  const a = new FriendlyAssistant({ openrouterKey: 'test' });
  a.userProfiles.set('testuser2', {
    allTasks: [],
    energyLog: [],
    commitmentHistory: {},
    longTermGoals: [],
    dailyCommitment: null
  });
  const result = await a.generateWeeklyReview('testuser2');
  expect(result).toContain("This week's review");
  expect(result).toContain('habit check-ins and tasks');
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm test tests/snapshot.test.js
```

Expected: FAIL

- [ ] **Step 3: Update `generateWeeklyReview` in `assistant-features.js`**

Find the not-enough-data return (around line 240) and the full-review return at the bottom (around line 281). Make two targeted edits:

**Edit 1** — replace the not-enough-data return. Find:
```js
      return `📊 *Not enough data yet*\n\nI need at least 3 days of check-ins to spot patterns and give you a meaningful review.\n\n${habitLine}\n\nAlso log your energy each day (just send a number like _"7"_) — that's how I learn when you work best.`;
```

Replace with:
```js
      return `📅 *This week\'s review*\n_Based on habit check-ins and tasks from the past 7 days_\n─────────────────\n\n📊 Not enough data yet — I need at least 3 days of check-ins.\n\n${habitLine}\n\nAlso log your energy each day (just send a number like _"7"_) — that\'s how I learn when you work best.`;
```

**Edit 2** — prepend header to the full review output. Find:

```js
    return lines.length > 0 ? lines.join('\n\n') : raw;
```

Replace with:

```js
    const header = '📅 *This week\'s review*\n_Based on habit check-ins and tasks from the past 7 days_\n─────────────────';
    const body = lines.length > 0 ? lines.join('\n\n') : raw;
    return `${header}\n\n${body}`;
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: 28 tests passing.

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js tests/snapshot.test.js
git commit -m "feat: weekly review header explaining data source"
```

---

### Task 4: `logEnergy` new response + `case 'energy':` handler

**Files:**
- Modify: `assistant-features.js`
- Modify: `slack-telegram-integration.js`
- Modify: `tests/snapshot.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/snapshot.test.js`:

```js
test('logEnergy response contains bar and week stats', async () => {
  const a = new FriendlyAssistant({ openrouterKey: 'test' });
  // Pre-seed in-memory profile with energy logs
  const now = new Date().toISOString();
  a.userProfiles.set('energyuser', {
    allTasks: [], commitmentHistory: {}, longTermGoals: [],
    energyLog: [
      { level: 7, timestamp: now, timeOfDay: 'morning' },
      { level: 8, timestamp: now, timeOfDay: 'morning' },
      { level: 5, timestamp: now, timeOfDay: 'evening' },
    ]
  });
  const result = await a.logEnergy('energyuser', 6, 'user logged');
  expect(typeof result).toBe('string');
  expect(result).toContain('6/10');
  expect(result).toContain('avg');
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm test tests/snapshot.test.js
```

Expected: FAIL — result is an object, not a string

- [ ] **Step 3: Replace `logEnergy` in `assistant-features.js`**

Find `async logEnergy(userId, level, context)` (around line 292). Replace the entire method with:

```js
async logEnergy(userId, level, context) {
  const profile = await this._getOrCreateProfile(userId);
  if (!profile.energyLog) profile.energyLog = [];

  profile.energyLog.push({
    timestamp: new Date().toISOString(),
    level,
    context,
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    timeOfDay: this._getTimeOfDay()
  });
  await this._saveProfile(userId, profile);

  const log = profile.energyLog;
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const weekLog = log.filter(e => new Date(e.timestamp).getTime() >= sevenDaysAgo);
  const weekAvg = weekLog.length
    ? (weekLog.reduce((s, e) => s + e.level, 0) / weekLog.length).toFixed(1)
    : level.toFixed(1);
  const weekCount = weekLog.length;

  const bar = '▓'.repeat(level) + '░'.repeat(10 - level);

  let insight = '';
  if (log.length >= 7) {
    const pattern = this._analyzeEnergyPattern(log);
    insight = `\n\n💡 Your highest energy: ${pattern.peak}. Schedule deep work then.`;
  } else {
    const needed = 7 - log.length;
    insight = `\n\n_${needed} more check-in${needed === 1 ? '' : 's'} and I can show you your peak hours._`;
  }

  let suffix = '';
  if (level >= 8) suffix = '\n\n💡 High energy today — good time to tackle something hard.';

  return `⚡ ${level}/10 logged\n\nThis week: avg ${weekAvg} · ${weekCount} check-in${weekCount === 1 ? '' : 's'}\n${bar}${insight}${suffix}`;
}
```

- [ ] **Step 4: Update `case 'energy':` in `slack-telegram-integration.js`**

Find `case 'energy': {` (around line 177). Replace the entire case block with:

```js
case 'energy': {
  const numMatch = message.match(/(\d+)/);
  if (numMatch) {
    const energyLevel = parseInt(numMatch[1]);
    const energyText = await this.assistant.logEnergy(userId, energyLevel, 'user logged');
    response = this._formatTelegramResponse(energyText, chatId);
    if (energyLevel <= 4) {
      response.followUpButtons = [[
        { text: '💪 Motivate Me', callback_data: `shortcut:${userId}:motivation` },
        { text: '📋 My Tasks', callback_data: `shortcut:${userId}:list` }
      ]];
    }
    break;
  }
  response = {
    chat_id: chatId,
    text: '⚡ How\'s your energy today?\n\nReply with a number: *1* (exhausted) → *10* (on fire)',
    parse_mode: 'Markdown',
    reply_markup: this._persistentKeyboard()
  };
  break;
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: 29 tests passing.

- [ ] **Step 6: Commit and push**

```bash
git add assistant-features.js slack-telegram-integration.js tests/snapshot.test.js
git commit -m "feat: energy log contextual response with stats and peak-hour progress"
git push origin main
```

---

## Verification Checklist

- [ ] `/streak` with habit set → shows 5-day week view + today status + feedback line (if ≥4 data points)
- [ ] `/streak` with no habit → unchanged prompt to set habit
- [ ] `/patterns` with < 5 energy logs → specific counts shown (e.g. "Energy logs: 2 so far (need 5+)")
- [ ] `/patterns` with enough data → header "🔍 How you work / Based on..." appears above AI output
- [ ] `/review` → header "📅 This week's review / Based on habit check-ins..." appears
- [ ] Say "7" → energy logged, response shows bar + week avg + peak-hour progress hint
- [ ] Say "9" → energy logged, response shows bar + "High energy today" nudge
- [ ] Say "3" → energy logged, motivate/tasks follow-up buttons still appear
- [ ] All 29 tests pass: `npm test`
