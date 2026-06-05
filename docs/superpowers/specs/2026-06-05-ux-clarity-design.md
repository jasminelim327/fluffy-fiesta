# UX Clarity — Habit, Patterns, Energy Design Spec

## Goal

Make the bot's core feedback loop visible to users. Three features — streak/habit, patterns/weekly review, energy logging — currently give no context about what data they use or what users get back. This spec fixes that with lightweight copy and inline feedback changes only. No structural redesign.

## Approach

Copy-first: change what each feature *says*, not how it's structured. All changes are in `assistant-features.js` (`formatStreakMessage`, `analyzePatterns`, `generateWeeklyReview`, `logEnergy`) and the `case 'energy':` handler in `slack-telegram-integration.js`.

---

## Section 1 — Streak Response

### Current behaviour
Shows streak count, habit name, today's status, generic "keep it going." No history, no feedback, no log CTA.

### New behaviour

**When habit is set:**
```
🔥 Streak: 3 days — 15min reading
─────────────────
✅ Mon  ✅ Tue  ✅ Wed  ⬜ Thu  ⬜ Fri

⏳ Today not logged yet
→ Say "I did it" to keep your streak

💡 You're strongest on weekdays — stay consistent today.
```

**When habit is set and today is done:**
```
🔥 Streak: 4 days — 15min reading
─────────────────
✅ Mon  ✅ Tue  ✅ Wed  ✅ Thu  ⬜ Fri

✅ Today: done — great work!

💡 You've completed every day this week so far.
```

**When no habit set:** unchanged — prompts user to set one.

### Data sources
- `profile.commitmentHistory` — keyed by date `YYYY-MM-DD`, each entry has `{ success: bool }`
- `profile.currentStreak` — current streak count
- `profile.dailyCommitment` — habit name + minutes

### Logic
**Week view:** build Mon–today (up to 5 days) from `commitmentHistory`. Show ✅ for completed days, ⬜ for missed or future.

**Feedback line:** only shown if ≥4 data points in `commitmentHistory`. Compute which days of the week have the highest completion rate. Generate one of these canned insights based on data:
- "You're strongest on weekdays — stay consistent today." (if weekday completion > weekend)
- "You've completed every day this week so far." (if full week streak)
- "You tend to miss Mondays — make today count." (if Monday has low completion)
- "You've never broken a streak longer than X days — this is a new record." (if current streak > personal best)
- Default: "Every check-in counts. Keep going."

No LLM call — all canned strings selected from data.

---

## Section 2 — Patterns and Weekly Review Headers

### Patterns (`analyzePatterns`)

Add a header before the existing AI-generated output:

```
🔍 *How you work*
_Based on your task history, energy logs, and habit check-ins_
─────────────────
[existing AI output]
```

**When not enough data**, replace the current generic error with a specific breakdown:

```
🔍 *How you work*

Not enough data yet. Here's what I need:
• Energy logs: 2 so far (need 5+)
• Habit check-ins: 0 logged
• Tasks completed: 3

Keep going — patterns emerge around day 7.
_Say a number (like "7") to log your energy today._
```

Data for the breakdown: `profile.energyLog.length`, `Object.values(profile.commitmentHistory || {}).filter(d => d.success).length`, `profile.allTasks.filter(t => t.completed).length`.

Threshold for "enough data": energyLog ≥ 5 AND at least 3 habit check-ins.

### Weekly Review (`generateWeeklyReview`)

Add a header before the existing AI-generated output:

```
📅 *This week's review*
_Based on your habit check-ins and tasks from the past 7 days_
─────────────────
[existing AI output]
```

**When not enough data**, replace the current message with:

```
📅 *This week's review*
_Based on habit check-ins and tasks from the past 7 days_

Not enough data yet — I need at least 3 days of check-ins.

[If habit set]:
You have a habit set: *15min reading*. Each day you check in
(tap ✅ on the habit nudge or say "I did it") counts as a data point.

[If no habit set]:
Try setting a daily habit first — e.g. _"15 min reading every day"_ —
then check in each day.

Also log your energy each day (just send a number like _"7"_) —
that's how I learn when you work best.
```

(This already exists from the previous fix — just adding the header.)

---

## Section 3 — Energy Logging Feedback

### Current behaviour
Returns `✅ Energy logged: 7/10` or an object that gets formatted generically.

### New behaviour

**Standard response (< 7 logs this week):**
```
⚡ 7/10 logged

This week: avg 6.8 · 4 check-ins
▓▓▓▓▓▓▓░░░

_3 more check-ins and I can show you your peak hours._
```

**With enough data (≥ 7 logs total):**
```
⚡ 6/10 logged

This week: avg 7.1 · 8 check-ins
▓▓▓▓▓▓▓░░░

💡 Your highest energy: Tue & Wed. Schedule deep work then.
```

**Low energy (≤ 4) — existing motivate/tasks buttons kept, add energy context:**
```
⚡ 3/10 logged

This week: avg 4.2 · 3 check-ins
▓▓▓░░░░░░░

Tough day. It happens. [existing buttons]
```

**High energy (≥ 8) — add nudge:**
```
⚡ 9/10 logged

This week: avg 7.8 · 5 check-ins
▓▓▓▓▓▓▓▓▓░

💡 High energy today — good time to tackle something hard.
```

### Data logic
- **Bar:** `'▓'.repeat(level) + '░'.repeat(10 - level)` — same pattern as `_goalProgressBar`
- **Week avg:** filter `profile.energyLog` to entries from the past 7 days, compute mean
- **Week count:** count of entries in past 7 days
- **Peak insight:** call existing `_analyzeEnergyPattern(profile.energyLog)` if `energyLog.length >= 7`, use `pattern.peak`
- **Progress hint:** `needed = 7 - energyLog.length` if < 7 total

### Response format
`logEnergy` currently returns `{ message: string }` or `{ message, pattern, suggestion }`. Change it to return a plain string (same as other methods) — `_formatTelegramResponse` in the `case 'energy':` handler handles strings fine.

The `case 'energy':` handler in `slack-telegram-integration.js` adds `followUpButtons` for low energy (≤ 4) — keep that logic, add a "💡 High energy today — tackle something hard." suffix for high energy (≥ 8) instead of follow-up buttons.

---

## File Map

| File | Changes |
|---|---|
| `assistant-features.js` | `formatStreakMessage` — week view + feedback line; `analyzePatterns` — header + specific not-enough-data message; `generateWeeklyReview` — header; `logEnergy` — new response format returning plain string |
| `slack-telegram-integration.js` | `case 'energy':` — handle plain string from `logEnergy`, add high-energy nudge |

## Out of Scope
- Redesigning the persistent keyboard labels
- Changing the weekly review or patterns AI prompts
- Adding new data collection
- Onboarding flow changes
