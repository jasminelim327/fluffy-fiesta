# Question Answering Feature — Design Spec

**Date:** 2026-06-03  
**Status:** Approved

## Problem

The bot currently misroutes questions (e.g. "What's my streak?", "How do I cook pasta?") into `task` or `schedule` handlers instead of answering them. The `chat` intent exists as a catch-all but is too broad and poorly defined for reliable question handling. Personal data questions go unanswered with real data because the LLM has no access to the user's stored profile.

## Goal

Make the bot reliably answer any question a user sends — general knowledge, how-to, advice, and personal data (streak, tasks, commitments) — and return a clear, correctly formatted Telegram response.

---

## Architecture

### 1. Intent Classification (`assistant-features.js` → `classifyIntent`)

Add `question` as a first-class intent to the LLM classifier prompt:

```
question - any direct question the user is asking ("what is X?", "how do I...",
           "what's my streak?", "tell me about...", "why does...")
```

`chat` remains for casual, non-question conversation (greetings, small talk, follow-ups that aren't questions). The `question` intent captures all interrogative messages so they are never misclassified as `task`, `schedule`, or other action intents.

### 2. `answerQuestion` method (`assistant-features.js` → `FriendlyAssistant`)

New method signature: `async answerQuestion(message, userId)`

**Steps:**
1. Load user profile from DB via `_getOrCreateProfile(userId)`
2. Build a compact profile summary string covering:
   - Current streak and daily commitment
   - Incomplete tasks (action + deadline), up to 10
   - Most recent energy level
3. Inject the summary into the system prompt context block
4. Call `_callOpenRouter` with a Q&A-focused system prompt
5. Return the LLM response string (already Telegram-formatted)

**System prompt:**
```
You are a knowledgeable and friendly assistant. Answer the user's question directly and clearly.
- Format for Telegram: use *bold* for titles, _italic_ for tips, numbered or bullet lists
- Do NOT use markdown headers (#, ##), **double asterisks**, or blockquotes (>)
- Keep responses concise and scannable
- For personal questions about the user's data, use the User Context below
- For general knowledge questions, answer from your own knowledge

User Context:
{profileSummary}
```

If the user has no profile data, `profileSummary` is `"No personal data available yet."`.

### 3. Routing (`slack-telegram-integration.js` → `handleTelegramMessage`)

Add a new case to the intent switch:

```js
case 'question':
  return this._formatTelegramResponse(
    await this.assistant.answerQuestion(message, userId), chatId
  );
```

No other routing changes. `chat` continues handling casual non-question messages via `answerDirectly`.

---

## Data Flow

```
User message
    ↓
classifyIntent()
    ↓ 'question'
handleTelegramMessage switch → case 'question'
    ↓
answerQuestion(message, userId)
    ↓
_getOrCreateProfile(userId) → profile summary
    ↓
_callOpenRouter(message, systemPrompt + profileSummary)
    ↓
_formatTelegramResponse()
    ↓
sendToTelegram()
```

---

## Error Handling

- If profile load fails, `answerQuestion` falls back to `"No personal data available yet."` in the context — the LLM still answers general questions
- LLM errors already handled by `_callOpenRouter` returning a fallback string

---

## Testing

- Send "What's my streak?" → bot should return actual streak value from DB
- Send "How do I cook pasta?" → bot should return a recipe/instructions
- Send "What tasks do I have today?" → bot should list incomplete tasks with today's deadline
- Send "Buy milk tomorrow" → should still route as `task`, NOT `question`
- Send "Schedule a call Friday" → should still route as `schedule`, NOT `question`
