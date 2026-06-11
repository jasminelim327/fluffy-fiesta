# Fluffy Fiesta ⇄ Astrology Bot integration

This repo (Fluffy Fiesta, the *operator*) and the Astrology Bot repo (the *strategist*,
`dailynews-2`) now run as one daily loop:

```
Morning  Astrology Bot generates the briefing and POSTs it here:
         → POST /api/briefing-intake  (headline + execution stack)
         → its tasks become tap-to-do tasks; the 8am Telegram brief leads with the headline
Day      You act in Telegram (reminders, Calendar sync, energy logs) as usual
Evening  Fluffy POSTs an end-of-day summary to the Astrology Bot (~22:00 local)
         → tasks done, habit, streak, energy → shapes tomorrow's briefing
```

## One-time setup

1. **Shared secret.** Set `INTEGRATION_SECRET` to the *same* value in BOTH services.
2. **Fluffy env** (this repo):
   - `ASTROLOGY_FEEDBACK_URL=https://astrology-bot-i57e.onrender.com/api/daily-feedback`
   - `INTEGRATION_SECRET=<shared secret>`
3. **Astrology Bot env** (`dailynews-2`):
   - `FLUFFY_INTAKE_URL=https://fluffy-fiesta-kk85.onrender.com/api/briefing-intake`
   - `INTEGRATION_SECRET=<same secret>`
4. **Link in Telegram:** send the bot `/link your-astrology-email@example.com`
   (same email as your Astrology Bot profile). Stored as `integrationEmail` on your profile.

No shared database — the services talk over authenticated HTTP.

## What changed here (Fluffy Fiesta)

- `astrology-integration.js` — `buildSummary(profile, day)` + `postDailyFeedback(...)`.
- `backend.js` — `POST /api/briefing-intake`; `/link` command (registered + handled in webhook
  and polling); a once-a-day feedback push block in the hourly cron (default 22:00 local).
- `assistant-features.js` — `buildDailyMessage` leads with the pushed briefing headline (then
  clears it); `saveTask` carries `source` + `briefingDate` tags.
- `db.js` — `getUserByIntegrationEmail(email)` to map a linked email → Telegram user.

## Endpoints

- `POST /api/briefing-intake` (auth: `X-Integration-Secret`)
  ```json
  { "user_email": "you@example.com", "date": "2026-06-11",
    "headline": "PUSH day — high-concurrency day, manage your threads",
    "execution_stack": [
      { "title": "Career: solve one medium array problem — 25 min", "deadline": "today", "priority": "high" }
    ] }
  ```
  Looks up the linked Telegram user, loads the stack as tasks (idempotent per day), and
  stashes the headline for the next morning brief.

## Safety / behaviour notes

- All cross-service calls are **fire-and-forget**; one service being down never breaks the other.
- Unset `INTEGRATION_SECRET` / URLs → integration silently no-ops; the bot works standalone.
- The feedback push fires once per day (`feedbackPushTime`, default 22) and only when an
  `integrationEmail` is linked.
