# Integration Setup Master Guide

Choose which integrations you want. All are optional!

## Quick Reference

| Integration | Setup Time | Effort | Best For |
|-------------|-----------|--------|----------|
| **Google Calendar** | 5 min | Low | Android users, Gmail ecosystem |
| **Apple Calendar** | 3 min | Very Low | iPhone, iPad, Mac users |
| **Notion** | 5 min | Low | All-in-one workspace, database features |

## Recommended Combos

### 🍎 Apple User
- Apple Calendar (CalDAV)
- Notion (for notes/tracking)
- Total setup: 8 minutes

### 🤖 Google Ecosystem
- Google Calendar
- Google Drive notes (future integration)
- Notion (optional, for richer database)
- Total setup: 10 minutes

### 🔧 All-In-One
- All three: Google + Apple + Notion
- Events sync everywhere
- Tasks stored in Notion
- Total setup: 15 minutes

---

## Step 1: Install Dependencies

```bash
npm install
npm install googleapis @notionhq/client
```

---

## Step 2: Choose Your Integrations

### Option A: Only Google Calendar

1. **Follow:** [`SETUP_GOOGLE_CALENDAR.md`](./SETUP_GOOGLE_CALENDAR.md)
2. **Result:** Events appear in Google Calendar

### Option B: Only Apple Calendar

1. **Follow:** [`SETUP_APPLE_CALENDAR.md`](./SETUP_APPLE_CALENDAR.md)
2. **Result:** Events appear in iCloud Calendar

### Option C: Only Notion

1. **Follow:** [`SETUP_NOTION.md`](./SETUP_NOTION.md)
2. **Result:** Tasks stored in Notion database

### Option D: Google + Notion

1. **Follow:** [`SETUP_GOOGLE_CALENDAR.md`](./SETUP_GOOGLE_CALENDAR.md)
2. **Follow:** [`SETUP_NOTION.md`](./SETUP_NOTION.md)
3. **Update .env** with both `GOOGLE_*` and `NOTION_*` keys
4. **Result:** Calendar events + task database

### Option E: Apple + Notion

1. **Follow:** [`SETUP_APPLE_CALENDAR.md`](./SETUP_APPLE_CALENDAR.md)
2. **Follow:** [`SETUP_NOTION.md`](./SETUP_NOTION.md)
3. **Update .env** with both `APPLE_*` and `NOTION_*` keys
4. **Result:** Calendar events + task database

### Option F: All Three (Google + Apple + Notion)

1. **Follow:** [`SETUP_GOOGLE_CALENDAR.md`](./SETUP_GOOGLE_CALENDAR.md)
2. **Follow:** [`SETUP_APPLE_CALENDAR.md`](./SETUP_APPLE_CALENDAR.md)
3. **Follow:** [`SETUP_NOTION.md`](./SETUP_NOTION.md)
4. **Update .env** with all keys
5. **Result:** Events sync to all three platforms, Notion for database

---

## Step 3: Update .env

See `.env.example.full` for all options, or copy-paste relevant sections:

```env
# Core (always needed)
OPENROUTER_API_KEY=sk-or-xxxxx
SLACK_BOT_TOKEN=xoxb-xxxxx
SLACK_SIGNING_SECRET=xxxxx
TELEGRAM_BOT_TOKEN=123456:xxxxx

# Pick which integrations you want:
# Google Calendar
GOOGLE_CREDENTIALS_PATH=./credentials.json
GOOGLE_CALENDAR_ID=primary

# Apple Calendar
APPLE_USERNAME=your-email@icloud.com
APPLE_PASSWORD=abcd-efgh-ijkl-mnop
APPLE_CALENDAR_ID=personal

# Notion
NOTION_API_KEY=secret_xxxxx
NOTION_DATABASE_ID=abc123def456xxx
```

---

## Step 4: Test

```bash
npm start
```

You should see:
```
🤖 Assistant running on port 3000
✅ Google Calendar initialized
✅ Apple Calendar initialized  
✅ Notion initialized
📱 Starting Telegram polling...
```

(You'll only see "✅" for integrations you configured)

Send a task to Slack/Telegram:
- "fix the bug"

The bot will:
1. **Parse:** Action + deadline + priority + motivation
2. **Add to Google Calendar** (if configured)
3. **Add to Apple Calendar** (if configured)
4. **Store in Notion** (if configured)

Check each platform - your task should appear!

---

## Troubleshooting

**"Only some integrations appear as ✅"**
- That's fine! If you didn't configure it, it's skipped silently
- Check `.env` for those integrations' variables

**"No integrations initialized at all"**
- You configured none, OR
- API keys are invalid/missing
- Check your `.env` file

**"Only one calendar works, not all three"**
- Each integration fails silently if not configured
- Make sure ALL three sets of env vars are present if you want all three
- Restart the bot after updating `.env`

**"Event added to calendar but Notion didn't work"**
- Each integration works independently
- If Notion fails, it won't break calendar sync
- Check `NOTION_API_KEY` and `NOTION_DATABASE_ID`

---

## What Happens Behind the Scenes

When you send "need to fix bug":

```
User Message
    ↓
[Parse with OpenRouter]
    ↓
Get: Action + Deadline + Priority + Motivation
    ↓
Split into parallel tasks:
    ├→ [Google Calendar] Add event (if configured)
    ├→ [Apple Calendar] Add event (if configured)
    └→ [Notion] Add task to database (if configured)
    ↓
Send response back to user
```

Each integration is independent. If one fails, others still work.

---

## Advanced: Conditional Setup

You can run multiple instances with different configurations:

**Instance 1: Google + Notion**
```bash
# .env.google
GOOGLE_CREDENTIALS_PATH=...
NOTION_API_KEY=...
npm start
```

**Instance 2: Apple + Notion**
```bash
# .env.apple
APPLE_USERNAME=...
NOTION_API_KEY=...
npm start --env .env.apple
```

---

## API Limits

All services have free tiers that are plenty for personal use:

| Service | Free Limit | Your Usage |
|---------|-----------|-----------|
| Google Calendar API | 1M requests/day | ~1-5/task |
| Apple Calendar | Unlimited CalDAV | Unlimited |
| Notion | Unlimited API | ~1/task |
| OpenRouter | Pay as you go | ~$0.001/task |

You're safe unless you're adding 1000+ tasks per day.

---

## Next Steps

1. ✅ Choose your integrations (above)
2. ✅ Follow each setup guide
3. ✅ Update `.env`
4. ✅ Test with `npm start`
5. 🚀 Deploy to production

See `QUICK_START.md` for deployment options.

---

## Need Help?

- **Google Calendar issues:** See `SETUP_GOOGLE_CALENDAR.md`
- **Apple Calendar issues:** See `SETUP_APPLE_CALENDAR.md`
- **Notion issues:** See `SETUP_NOTION.md`
- **General issues:** Check `QUICK_START.md` troubleshooting

Good luck! 🚀
