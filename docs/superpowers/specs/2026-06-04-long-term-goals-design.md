# Long-Term Goals — Design Spec

**Date:** 2026-06-04
**Status:** Approved

## Problem

`createLongTermGoal` and `progressMilestone` are fully implemented in `assistant-features.js` but completely inaccessible to users — no intent, no slash command, no UI. Users have no way to set big goals, track milestones, or see progress.

## Goal

Give users a guided conversation flow to set long-term goals with milestones, view progress, and mark milestones done — all from natural Telegram messages.

---

## Architecture

Three layers:

1. **Draft state machine** (`assistant-features.js` + `slack-telegram-integration.js`) — intercepts messages during goal creation
2. **Goal list + milestone view** (`assistant-features.js`) — new formatting methods
3. **Intent + command wiring** (`assistant-features.js` + `slack-telegram-integration.js` + `backend.js`)

---

## Section 1 — Goal Creation Flow (State Machine)

### 1.1 Trigger

The `longterm` intent is classified when the user says something like:
- "I want to build a startup"
- "My long-term goal is to run a marathon"
- "Set a big goal"
- `/longterm` (when no goals exist, or user explicitly wants to add one)

When triggered and `profile.goalDraft` is not active, the bot sends Step 1 and sets the draft state.

### 1.2 Draft State

Stored in `profile.goalDraft`:

```js
{
  step: 'awaiting_title' | 'awaiting_why' | 'awaiting_timeline' | 'confirming_milestones',
  title: string | null,
  why: string | null,
  timeline: string | null,
  proposedMilestones: [{ name: string, daysUntil: number }] // LLM-generated, pending confirmation
}
```

### 1.3 Step Messages

**Step 1 — Title** (sent when flow starts):
```
🎯 *Let's set a big goal.*

What's the goal? Just the name — keep it short.

For example:
• "Build a SaaS product"
• "Run a marathon"
• "Write a book"
```

**Step 2 — Why** (sent after title received):
```
✨ *[title]* — love it.

Why does this matter to you? What's the real reason behind it?
```

**Step 3 — Timeline** (sent after why received):
```
Got it. How long are you giving yourself?

For example: _"3 months"_, _"by December"_, _"6 months"_
```

**Step 4 — Milestone confirmation** (sent after timeline received):
LLM generates 3–5 milestones based on title + why + timeline. Bot presents them:
```
📍 *Here's a milestone plan for [title]:*

1. [Milestone 1]
2. [Milestone 2]
3. [Milestone 3]
4. [Milestone 4]

Does this look right? Say *"yes"* to save, or tell me what to change.
```

**Confirmation** — if user says yes/ok/looks good → call `createLongTermGoal`, clear draft, show coach response.

**Revision** — if user says "change X to Y" or "add Z" → use LLM to update `proposedMilestones`, re-present Step 4.

### 1.4 State Intercept

At the top of `handleTelegramMessage`, after the onboarding check:

```js
if (profile.goalDraft?.step && !this._resolveKeyboardShortcut(message)) {
  return this._handleGoalDraft(message, userId, chatId, profile);
}
```

`_handleGoalDraft` routes to the correct step handler based on `profile.goalDraft.step`.

### 1.5 Saving

On confirmation, call `this.assistant.createLongTermGoal(userId, { title, why, timeline, milestones: proposedMilestones })`. Clear `profile.goalDraft` via `updateProfileMeta(userId, { goalDraft: null })`.

### 1.6 Coach Response

Parse the LLM response from `createLongTermGoal`:

```js
const get = (label) => raw.match(new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i'))?.[1]?.trim();
```

Format as:
```
🚀 *[BELIEF — one sentence]*

🗓 *This week*
[FIRST_STEP]

💙 [MOTIVATION]
```

BREAKDOWN is omitted — milestones were already confirmed by the user.

---

## Section 2 — Viewing Goals

### 2.1 `listLongTermGoals(userId)` — new method in `assistant-features.js`

Returns a formatted string. For each active goal, shows:
- Title + timeline
- ASCII progress bar (10 chars, filled proportional to milestones completed)
- Milestone count `X/Y`
- Next incomplete milestone

```
🎯 *Your Long-term Goals*
─────────────────
1. Build a SaaS product _(6 months)_
   ▓▓▓░░░░░░░ 40% · 2/5 milestones
   Next: First paying customer

2. Run a marathon _(by December)_
   ░░░░░░░░░░ 0% · 0/4 milestones
   Next: Run 5km without stopping
```

Progress bar: `Math.round(pct / 10)` filled chars (`▓`) + remainder empty (`░`).

If no goals:
```
No long-term goals yet.

Say something like _"I want to build a SaaS product"_ to set one.
```

### 2.2 `getLongTermGoalDetail(userId, goalId)` — new method

Returns a detailed milestone view for one goal:

```
🎯 *Build a SaaS product*
Timeline: 6 months · 40% complete
─────────────────
✅ MVP launched
✅ First user
⬜ First paying customer
⬜ $1K MRR
⬜ 100 users
```

The caller attaches inline `✅ Done` buttons per incomplete milestone.

### 2.3 `/longterm` behaviour

- If user has no goals → start creation flow (Step 1)
- If user has goals → call `listLongTermGoals`, attach `📍 View` inline button per goal

---

## Section 3 — Marking Milestones Done

### 3.1 Inline buttons

`listLongTermGoals` response includes one `📍 View` inline button per goal:
```js
{ text: '📍 View', callback_data: `goal_view:userId:goalId` }
```

`getLongTermGoalDetail` response includes one `✅ Done` button per incomplete milestone:
```js
{ text: '✅ Done', callback_data: `milestone_done:userId:goalId:milestoneIndex` }
```

### 3.2 Callback handlers (both webhook + polling)

**`goal_view:userId:goalId`** — load goal detail, send formatted message with `✅ Done` buttons.

**`milestone_done:userId:goalId:milestoneIndex`** — call `progressMilestone(userId, goalId, milestoneIndex)`, edit the message to show updated progress. Response from `progressMilestone` already formats the celebration text.

### 3.3 `milestonedone` intent — natural language fallback

For "I finished the MVP" or "Completed the first milestone":

New method `markMilestoneByText(userId, message)`:
1. Load all active goals + their incomplete milestones
2. Use LLM to match the message to the most likely goal + milestone index
3. Call `progressMilestone`
4. Return confirmation text

---

## Section 4 — Intent + Command Wiring

### 4.1 `classifyIntent` additions

New entries in the prompt and valid list:

```
longterm - setting or viewing long-term goals ("I want to build X", "my long-term goals", "big goal", "set a goal")
milestonedone - completing a milestone of a long-term goal ("I finished the MVP", "milestone done", "completed X")
```

Fast-path regex for `longterm`:
```js
if (/\b(long.?term goal|big goal|set a goal|my goals)\b/i.test(normalized)) return 'longterm';
```

### 4.2 `handleTelegramMessage` additions

```js
case 'longterm': {
  const goals = profile.longTermGoals?.filter(g => g.status === 'active') || [];
  if (goals.length === 0) {
    // Start creation flow
    await this.assistant.updateProfileMeta(userId, {
      goalDraft: { step: 'awaiting_title', title: null, why: null, timeline: null, proposedMilestones: [] }
    });
    response = { chat_id: chatId, text: STEP1_MESSAGE, parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
  } else {
    const listText = await this.assistant.listLongTermGoals(userId);
    const buttons = goals.map(g => [{ text: `📍 ${g.title.slice(0, 35)}`, callback_data: `goal_view:${userId}:${g.id}` }]);
    buttons.push([{ text: '➕ Add new goal', callback_data: `shortcut:${userId}:newgoal` }]);
    response = { chat_id: chatId, text: this._toTelegramMarkdown(listText), parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
  }
  break;
}

case 'milestonedone':
  response = this._formatTelegramResponse(await this.assistant.markMilestoneByText(userId, message), chatId);
  break;
```

### 4.3 `_resolveKeyboardShortcut` addition

```js
'newgoal': 'longterm'  // maps the "Add new goal" callback shortcut
```

Or handle `newgoal` directly in the shortcut callback handler.

### 4.4 `setMyCommands` addition

```js
{ command: 'longterm', description: 'Set or view your long-term goals' }
```

### 4.5 `resolveSlashCommand` addition

```js
longterm: 'my long-term goals'
```

---

## Files Changed

| File | Changes |
|---|---|
| `assistant-features.js` | `listLongTermGoals`, `getLongTermGoalDetail`, `markMilestoneByText`; update `classifyIntent`; fix `createLongTermGoal` coach response parsing |
| `slack-telegram-integration.js` | `_handleGoalDraft`; `longterm` + `milestonedone` cases; `goal_view` + `milestone_done` + `➕ Add new goal` callback handling; goalDraft state intercept |
| `backend.js` | `goal_view` + `milestone_done` callback handlers in webhook + polling; `/longterm` in `setMyCommands` + `resolveSlashCommand` |

---

## Error Handling

- If `goalDraft` state is active and user sends a keyboard button tap → passthrough (shortcut resolver fires first)
- If `markMilestoneByText` LLM match confidence is low → return "I couldn't match that to a milestone. Tap 📍 to see your goals."
- If `progressMilestone` called with invalid goalId or milestoneIndex → return error string, do not crash
- If user abandons goal creation mid-flow → draft persists in profile; sending `/longterm` again restarts from last step or offers to start fresh

---

## Testing

- Say "I want to run a marathon" → Step 1 prompt appears
- Complete all 4 steps → goal saved, coach response formatted correctly (no raw labels)
- `/longterm` with existing goals → list with 📍 View buttons
- Tap 📍 View → milestone detail with ✅ Done buttons per incomplete milestone
- Tap ✅ Done → message edited, progress bar updates
- Say "I finished the MVP" → matched to correct goal/milestone, marked done
- `/longterm` with no goals → creation flow starts
- Keyboard button during goal draft → routes normally (not captured by draft handler)
- Abandon mid-draft, send `/longterm` again → offered to continue or restart
