# Quick Start - 10 Minutes to Running Bot

## 1️⃣ CLONE & INSTALL (2 min)

```bash
# Copy these files to your local folder:
# - backend.js
# - package.json
# - .env.example

# Then:
npm install
cp .env.example .env
```

## 2️⃣ GET API KEYS (3 min)

### OpenRouter (Required)
1. Go to https://openrouter.ai
2. Sign up
3. Click your profile → API Keys
4. Copy your key
5. Paste in `.env`: `OPENROUTER_API_KEY=sk-or-xxxxx`

### Slack (Optional but recommended)
1. Go to https://api.slack.com/apps
2. Create New App → From scratch
3. Name: "Personal Assistant"
4. Pick your workspace
5. Go to "OAuth & Permissions"
6. Scroll to "Scopes" → Bot Token Scopes
7. Add: `chat:write`, `commands`, `incoming-webhook`
8. Scroll up and click "Install to Workspace"
9. Copy "Bot User OAuth Token" (starts with `xoxb-`)
10. Paste in `.env`: `SLACK_BOT_TOKEN=xoxb-xxxxx`

Then go to "Signing Secret" tab and copy it:
```
SLACK_SIGNING_SECRET=xxxxx
```

### Telegram (Optional)
1. Open Telegram app
2. Search for `@BotFather`
3. Send `/newbot`
4. Follow prompts (give it a name)
5. Copy the token (e.g., `123456:ABC-DEF123`)
6. Paste in `.env`: `TELEGRAM_BOT_TOKEN=123456:ABC-DEF123`

## 3️⃣ TEST LOCALLY (3 min)

```bash
npm start
```

You should see:
```
🤖 Assistant running on port 3000
```

## 4️⃣ EXPOSE TO INTERNET (2 min)

Need webhooks accessible? Use ngrok:

```bash
# Download from ngrok.com, then:
ngrok http 3000

# You'll get: https://abc123.ngrok.io
```

## 5️⃣ CONFIGURE WEBHOOKS

### For Slack:
1. Go back to https://api.slack.com/apps
2. Click your app
3. Left menu → "Event Subscriptions"
4. Toggle "Enable Events" ON
5. Request URL: `https://abc123.ngrok.io/slack/events` (or your real domain)
6. Wait for ✅ Verified
7. Scroll to "Subscribe to bot events"
8. Add: `message.im` (DMs)
9. Save

Then add Slash Command:
1. Left menu → "Slash Commands"
2. Create New Command
3. Command: `/task`
4. Request URL: `https://abc123.ngrok.io/slack/command`
5. Save

### For Telegram:
Option A - Webhook (recommended):
```bash
curl -X POST https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook \
  -d url=https://abc123.ngrok.io/telegram/webhook
```

Option B - Polling (no webhook needed):
```bash
# Just keep the bot running, it polls automatically
```

## 🎯 TEST IT

### Slack:
1. Open your workspace
2. DM the bot: "need to fix that bug"
3. It should reply with ACTION + DEADLINE + PRIORITY + MOTIVATION

### Telegram:
1. Message your bot
2. Send: "call mom later"
3. It should reply with action items

### Web:
1. Go to `http://localhost:3000` (if you add a landing page)
2. Or use the dashboard provided

---

## 🚀 DEPLOY (Optional)

### Easiest: Railway.app
1. Push code to GitHub
2. Go to railway.app
3. Click "Deploy from GitHub"
4. Select repo
5. Add env variables (copy from `.env`)
6. Deploy
7. Use the provided `railway.app` domain for webhooks

### Alternative: Heroku
```bash
heroku create your-app-name
heroku config:set OPENROUTER_API_KEY=sk-or-xxxxx SLACK_BOT_TOKEN=xoxb-xxxxx ...
git push heroku main
```

### Alternative: Self-hosted
- VPS (DigitalOcean, Linode, AWS)
- Install Node
- Run: `npm start` (with PM2 for persistence)
- Point domain to your VPS IP

---

## 🐛 TROUBLESHOOTING

**Bot not responding in Slack?**
- Check Slack signing secret is copied correctly
- Make sure webhook URL is accessible (test with curl)
- Check API Keys in `.env`

**Telegram not working?**
- Try polling mode first (easier)
- Check bot token is correct
- Send `/start` to your bot then try again

**OpenRouter errors?**
- Verify API key is correct
- Check you have credits/allowance
- Try a different model if needed

**Webhook URL not verified?**
- Make sure your server is running
- Test: `curl https://your-url/slack/events`
- Should get 401 (which is fine, means it's listening)

---

## 📚 NEXT STEPS

1. **Add calendar integration**: Uncomment `addToCalendar()` in backend.js, add Google Calendar API
2. **Add notes**: Connect Notion API for note-taking
3. **Add persistence**: Connect to a database (Supabase, MongoDB, PostgreSQL)
4. **Add more features**: Pomodoro timer, daily digest, priority sorting
5. **Customize AI**: Change model in `callOpenRouter()` or tweak system prompt

---

## 📞 NEED HELP?

- OpenRouter docs: https://openrouter.ai/docs
- Slack API: https://api.slack.com/docs
- Telegram API: https://core.telegram.org/bots/api
- Check backend.js comments for detailed explanations
