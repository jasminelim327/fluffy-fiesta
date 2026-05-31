# Personal Assistant Bot - Setup Guide

## Overview
Turn your short messages into action items. Works on Slack, Telegram, or web. Uses OpenRouter API for AI decisions.

---

## 1. OPENROUTER API SETUP

1. Go to https://openrouter.ai
2. Sign up & get API key
3. Set budget/limits in dashboard
4. Note your key: `sk-or-...`

**Best models for this:**
- `mistral/mistral-7b-instruct` (fast, cheap)
- `meta-llama/llama-2-70b-chat` (better reasoning)
- `openai/gpt-4-turbo` (most capable)

---

## 2. SLACK INTEGRATION

### Step 1: Create Slack App
1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From scratch"
4. Name: "Personal Assistant"
5. Pick your workspace

### Step 2: Enable Features
1. **Slash Commands**
   - Go to "Slash Commands" 
   - Create: `/task`
   - Request URL: `https://your-domain.com/slack/command`
   - Save

2. **Event Subscriptions**
   - Toggle "Enable Events"
   - Request URL: `https://your-domain.com/slack/events`
   - Subscribe to: `message.im`, `app_mention`
   - Save

3. **OAuth & Permissions**
   - Add scopes: `commands`, `chat:write`, `incoming-webhook`
   - Install to workspace
   - Copy Bot Token: `xoxb-...`

### Step 3: Store Credentials
```env
SLACK_BOT_TOKEN=xoxb-xxxxx
SLACK_SIGNING_SECRET=xxxxx
```

---

## 3. TELEGRAM INTEGRATION

### Step 1: Create Bot
1. Message @BotFather on Telegram
2. Type `/newbot`
3. Follow prompts
4. Copy bot token: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`

### Step 2: Set Webhook
Use either polling or webhook:

**Webhook (recommended):**
```bash
curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook \
  -d url=https://your-domain.com/telegram/webhook
```

**Polling (no server needed):**
Keep bot running and it polls automatically.

### Step 3: Store Credentials
```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

---

## 4. BACKEND SERVER

### Use Node.js + Express

```bash
npm install express openrouter dotenv axios
```

See `backend.js` in this repo.

**Environment variables needed:**
```
OPENROUTER_API_KEY=sk-or-xxxxx
SLACK_BOT_TOKEN=xoxb-xxxxx
SLACK_SIGNING_SECRET=xxxxx
TELEGRAM_BOT_TOKEN=123456:xxxxx
DATABASE_URL=postgres://... # Optional, for persistence
```

---

## 5. DEPLOYMENT OPTIONS

### Option A: Heroku (Free tier ending soon)
```bash
heroku create your-app-name
heroku config:set OPENROUTER_API_KEY=sk-or-xxxxx
git push heroku main
```

### Option B: Railway.app
1. Connect GitHub repo
2. Add env variables
3. Deploy (free tier available)

### Option C: Replit
1. Create new Replit from GitHub
2. Add secrets (env vars)
3. Click Run
4. Share URL with Slack/Telegram webhooks

### Option D: Self-hosted (VPS)
- Linode, DigitalOcean, AWS EC2
- Run `node backend.js` with PM2/systemd
- Use Nginx for reverse proxy

---

## 6. CALENDAR & NOTES INTEGRATIONS

### Google Calendar
```javascript
// Install: npm install google-calendar-api
const google = require('googleapis').google;
// Setup OAuth2 flow to get credentials
// Then add events automatically
```

### Notion (easiest for notes)
```javascript
// Install: npm install @notionhq/client
const NotionClient = require('@notionhq/client').Client;
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
// Create pages/entries
```

### Apple Calendar / iCloud
- Use CalDAV protocol
- Or sync via Google Calendar

---

## 7. TESTING

### Test Slack locally
```bash
npm install ngrok  # Create tunnel
./ngrok http 3000  # Get https URL
# Update Slack webhook URLs with ngrok URL
# Send message to bot
```

### Test Telegram locally
Same ngrok approach, or use polling.

---

## 8. QUICK START CHECKLIST

- [ ] OpenRouter API key ready
- [ ] Slack app created + tokens
- [ ] Telegram bot token ready
- [ ] Backend code deployed
- [ ] Environment variables set
- [ ] Webhook URLs configured
- [ ] Test message in Slack/Telegram
- [ ] Calendar integration working
- [ ] Notes integration working

---

## 9. FEATURES TO BUILD

1. **Message → Action**: "need to fix bug X" → creates task + sets calendar reminder
2. **Motivation boost**: Random encouragement when starting task
3. **Progress tracking**: Emoji reactions to mark done
4. **Smart parsing**: Extract deadlines, priority, dependencies
5. **Daily summary**: Morning message with today's tasks
6. **Pomodoro timer**: "/timer 25" starts countdown + notification
7. **Quick notes**: Append thoughts to running note
8. **Analytics**: Weekly productivity report

---

## Need Help?

See `backend.js` and `frontend.jsx` files in this project for full working code.
