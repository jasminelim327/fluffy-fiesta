# Question Answering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `question` intent so any question the user asks is reliably answered — general knowledge or personal data — instead of being misrouted to task/schedule handlers.

**Architecture:** Add `question` to the LLM intent classifier, add an `answerQuestion(message, userId)` method to `FriendlyAssistant` that loads user profile data and injects it as LLM context, and add a `case 'question':` route in `MessagingIntegration`.

**Tech Stack:** Node.js, Jest (unit tests), axios (mocked in tests)

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Add jest dev dependency, update test script |
| `assistant-features.js` | Add `question` to `classifyIntent` prompt; add `_buildProfileSummary` helper; add `answerQuestion` method |
| `slack-telegram-integration.js` | Add `case 'question':` to `handleTelegramMessage` switch |
| `__tests__/assistant-features.test.js` | New: unit tests for `classifyIntent` (question routing) and `answerQuestion` |
| `__tests__/messaging-integration.test.js` | New: unit test for question routing in `handleTelegramMessage` |

---

### Task 1: Install Jest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Jest**

```bash
npm install --save-dev jest
```

- [ ] **Step 2: Update the test script in `package.json`**

Change:
```json
"test": "echo \"Error: no test specified\" && exit 1"
```
To:
```json
"test": "jest"
```

- [ ] **Step 3: Verify Jest runs**

```bash
npm test
```

Expected: `No tests found` (exit 0 or a Jest "no tests" message — not a script error).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jest for unit testing"
```

---

### Task 2: Add `question` intent to `classifyIntent`

**Files:**
- Modify: `assistant-features.js` (lines 543–578)
- Create: `__tests__/assistant-features.test.js`

- [ ] **Step 1: Create the test file with a failing test**

Create `__tests__/assistant-features.test.js`:

```js
const FriendlyAssistant = require('../assistant-features');

jest.mock('../db', () => ({
  getUserProfile: jest.fn().mockResolvedValue(null),
  saveUserProfile: jest.fn().mockResolvedValue(undefined),
}));

describe('classifyIntent', () => {
  let assistant;

  beforeEach(() => {
    assistant = new FriendlyAssistant({ openrouterKey: 'test-key' });
  });

  it('classifies a general knowledge question as "question"', async () => {
    jest.spyOn(assistant, '_callOpenRouter').mockResolvedValue('question');
    const intent = await assistant.classifyIntent('How do I cook pasta?');
    expect(intent).toBe('question');
  });

  it('classifies a personal data question as "question"', async () => {
    jest.spyOn(assistant, '_callOpenRouter').mockResolvedValue('question');
    const intent = await assistant.classifyIntent("What's my streak?");
    expect(intent).toBe('question');
  });

  it('still classifies task messages as "task"', async () => {
    jest.spyOn(assistant, '_callOpenRouter').mockResolvedValue('task');
    const intent = await assistant.classifyIntent('Buy milk tomorrow');
    expect(intent).toBe('task');
  });

  it('fast-paths recurring messages to "task" without calling the API', async () => {
    const spy = jest.spyOn(assistant, '_callOpenRouter');
    const intent = await assistant.classifyIntent('remind me to take medicine every day');
    expect(intent).toBe('task');
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: FAIL — `"question"` is not in the valid intents list, so it falls through to `'chat'`.

- [ ] **Step 3: Add `question` to the valid intents list and classifier prompt in `assistant-features.js`**

In `classifyIntent` (around line 555), update the `systemPrompt` string. Find the block that lists intents and add `question` after `help`:

```
question - any direct question the user is asking ("what is X?", "how do I...", "what's my streak?", "tell me about...", "why does...", "what are my tasks")
```

Then update the `valid` array on line 573 from:
```js
const valid = ['task','schedule','idea','commit','energy','review','motivation','pattern','abandoned','help','connect','chat'];
```
To:
```js
const valid = ['task','schedule','idea','commit','energy','review','motivation','pattern','abandoned','help','connect','question','chat'];
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add assistant-features.js __tests__/assistant-features.test.js
git commit -m "feat: add 'question' intent to classifyIntent"
```

---

### Task 3: Add `_buildProfileSummary` helper and `answerQuestion` method

**Files:**
- Modify: `assistant-features.js`
- Modify: `__tests__/assistant-features.test.js`

- [ ] **Step 1: Add failing tests for `answerQuestion` to the test file**

Append to `__tests__/assistant-features.test.js`:

```js
describe('answerQuestion', () => {
  let assistant;

  beforeEach(() => {
    assistant = new FriendlyAssistant({ openrouterKey: 'test-key' });
  });

  it('calls _callOpenRouter and returns the response', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({
      currentStreak: 5,
      dailyCommitment: { minutes: 15, description: 'writing' },
      allTasks: [{ action: 'buy milk', deadline: 'today', completed: false }],
      energyLog: [{ level: 8, timeOfDay: 'morning' }]
    });
    jest.spyOn(assistant, '_callOpenRouter').mockResolvedValue('Pasta takes 10 minutes.');
    const result = await assistant.answerQuestion('How do I cook pasta?', 'user1');
    expect(result).toBe('Pasta takes 10 minutes.');
    expect(assistant._callOpenRouter).toHaveBeenCalledWith(
      'How do I cook pasta?',
      expect.stringContaining('User Context'),
      'user1'
    );
  });

  it('injects streak and tasks into the system prompt', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({
      currentStreak: 3,
      dailyCommitment: { minutes: 20, description: 'coding' },
      allTasks: [{ action: 'call dentist', deadline: 'Friday', completed: false }],
      energyLog: []
    });
    jest.spyOn(assistant, '_callOpenRouter').mockResolvedValue('Your streak is 3 days.');
    await assistant.answerQuestion("What's my streak?", 'user2');
    const [, systemPrompt] = assistant._callOpenRouter.mock.calls[0];
    expect(systemPrompt).toContain('Streak: 3 day(s)');
    expect(systemPrompt).toContain('call dentist');
  });

  it('uses fallback context when user has no profile data', async () => {
    jest.spyOn(assistant, '_getOrCreateProfile').mockResolvedValue({
      currentStreak: 0,
      allTasks: [],
      energyLog: []
    });
    jest.spyOn(assistant, '_callOpenRouter').mockResolvedValue('France.');
    await assistant.answerQuestion('What is the capital of France?', 'user3');
    const [, systemPrompt] = assistant._callOpenRouter.mock.calls[0];
    expect(systemPrompt).toContain('No personal data available yet');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: FAIL — `answerQuestion is not a function`.

- [ ] **Step 3: Add `_buildProfileSummary` helper to `assistant-features.js`**

Add this method inside the `FriendlyAssistant` class, before the closing `}` of the HELPER METHODS section (around line 666):

```js
_buildProfileSummary(profile) {
  const lines = [];
  if (profile.currentStreak) lines.push(`Streak: ${profile.currentStreak} day(s)`);
  if (profile.dailyCommitment) {
    lines.push(`Daily commitment: ${profile.dailyCommitment.minutes}min on "${profile.dailyCommitment.description}"`);
  }
  const incompleteTasks = (profile.allTasks || []).filter(t => !t.completed).slice(0, 10);
  if (incompleteTasks.length > 0) {
    lines.push(`Tasks: ${incompleteTasks.map(t => `${t.action} (${t.deadline || 'no deadline'})`).join(', ')}`);
  }
  if (profile.energyLog && profile.energyLog.length > 0) {
    const last = profile.energyLog[profile.energyLog.length - 1];
    lines.push(`Last energy level: ${last.level}/10`);
  }
  return lines.length > 0 ? lines.join('\n') : 'No personal data available yet.';
}
```

- [ ] **Step 4: Add `answerQuestion` method to `assistant-features.js`**

Add this method inside the `FriendlyAssistant` class, after `answerDirectly` (around line 85):

```js
async answerQuestion(message, userId) {
  const profile = await this._getOrCreateProfile(userId);
  const profileSummary = this._buildProfileSummary(profile);

  const systemPrompt = `You are a knowledgeable and friendly assistant. Answer the user's question directly and clearly.
- Format for Telegram: use *bold* for titles/headers, _italic_ for tips or notes
- For lists use numbered items (1. 2. 3.) or bullet points starting with •
- Do NOT use markdown headers (#, ##, ###) — they do not render in Telegram
- Do NOT use **double asterisks** — use *single asterisks* for bold
- Do NOT use blockquotes (>)
- Keep responses concise and scannable
- For personal questions about the user's data, use the User Context below
- For general knowledge questions, answer from your own knowledge

User Context:
${profileSummary}`;

  return this._callOpenRouter(message, systemPrompt, userId);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- --testPathPattern=assistant-features
```

Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add assistant-features.js __tests__/assistant-features.test.js
git commit -m "feat: add answerQuestion method with user profile context"
```

---

### Task 4: Add `question` routing in `MessagingIntegration`

**Files:**
- Modify: `slack-telegram-integration.js` (around line 129)
- Create: `__tests__/messaging-integration.test.js`

- [ ] **Step 1: Create the test file with a failing test**

Create `__tests__/messaging-integration.test.js`:

```js
const MessagingIntegration = require('../slack-telegram-integration');

jest.mock('../assistant-features', () => {
  return jest.fn().mockImplementation(() => ({
    classifyIntent: jest.fn(),
    answerQuestion: jest.fn().mockResolvedValue('Paris is the capital of France.'),
    answerDirectly: jest.fn().mockResolvedValue('Hello!'),
    parseTask: jest.fn().mockResolvedValue({ action: 'buy milk', deadline: 'today', priority: 'medium', motivation: 'go!', recurring: false }),
    updateProfileMeta: jest.fn().mockResolvedValue(undefined),
    deepenIdea: jest.fn(),
    setDailyCommitment: jest.fn(),
    logDailyCommitment: jest.fn(),
    logEnergy: jest.fn(),
    generateWeeklyReview: jest.fn(),
    getMotivatation: jest.fn(),
    analyzePatterns: jest.fn(),
    checkAbandonedGoals: jest.fn(),
  }));
});

describe('handleTelegramMessage - question routing', () => {
  let integration;

  beforeEach(() => {
    integration = new MessagingIntegration({ telegramToken: 'test', openrouterKey: 'test' });
  });

  it('routes "question" intent to answerQuestion', async () => {
    integration.assistant.classifyIntent.mockResolvedValue('question');
    const result = await integration.handleTelegramMessage('What is the capital of France?', 'user1', 'chat1');
    expect(integration.assistant.answerQuestion).toHaveBeenCalledWith('What is the capital of France?', 'user1');
    expect(result.text).toContain('Paris is the capital of France.');
  });

  it('does not route "task" intent to answerQuestion', async () => {
    integration.assistant.classifyIntent.mockResolvedValue('task');
    await integration.handleTelegramMessage('Buy milk tomorrow', 'user1', 'chat1');
    expect(integration.assistant.answerQuestion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --testPathPattern=messaging-integration
```

Expected: FAIL — `answerQuestion` is never called, the `question` case doesn't exist yet.

- [ ] **Step 3: Add `case 'question':` to `handleTelegramMessage` in `slack-telegram-integration.js`**

In the switch statement inside `handleTelegramMessage` (around line 129), add the new case before `default:`:

```js
case 'question':
  return this._formatTelegramResponse(await this.assistant.answerQuestion(message, userId), chatId);
```

- [ ] **Step 4: Run all tests to verify everything passes**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add slack-telegram-integration.js __tests__/messaging-integration.test.js
git commit -m "feat: route 'question' intent to answerQuestion handler"
```

---

### Task 5: Manual smoke test

**No files changed — verification only.**

- [ ] **Step 1: Start the bot**

```bash
npm start
```

Confirm the server starts without errors on port 3000.

- [ ] **Step 2: Send a general knowledge question via Telegram**

Send: `How do I cook pasta?`

Expected: A helpful recipe/cooking response, NOT a task confirmation.

- [ ] **Step 3: Send a personal data question via Telegram**

Send: `What's my streak?`

Expected: The bot returns your actual current streak (or "No personal data yet" if none set).

- [ ] **Step 4: Verify task routing is unaffected**

Send: `Buy milk tomorrow`

Expected: `✅ Task saved!` — the task confirmation format, NOT a Q&A response.

- [ ] **Step 5: Verify schedule routing is unaffected**

Send: `Schedule a call on Friday at 3pm`

Expected: Task saved / calendar event format, NOT a Q&A response.
