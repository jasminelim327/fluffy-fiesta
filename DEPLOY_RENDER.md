# Deploy to Render

## 1. Prepare your repo
- Commit your current code to GitHub (or another Git provider).
- Make sure `backend.js` listens on `process.env.PORT || 3000` (already handled).

## 2. Create a Render Web Service
1. Go to https://dashboard.render.com
2. Create a new **Web Service**.
3. Connect your GitHub repository.
4. Choose the branch you want to deploy.

## 3. Build and start commands
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Node.js

## 4. Environment variables
Add these in Render dashboard's **Environment** section:
- `OPENROUTER_API_KEY` = your OpenRouter key
- `TELEGRAM_BOT_TOKEN` = your Telegram bot token
- `USE_TELEGRAM_WEBHOOK` = `true`
- `PORT` = `3000` (optional; Render sets this automatically)

If you want to keep Slack disabled, do not set:
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`

Render will then start the app with Slack disabled automatically.

## 5. Telegram webhook
Once the service is live, use your Render URL and set Telegram webhook to:
- `https://<your-render-service>.onrender.com/telegram/webhook`

Example:
```bash
curl -F "url=https://<your-render-service>.onrender.com/telegram/webhook" \
  "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"
```

## 6. Optional: Google Calendar later
For deployment, if you want Google Calendar later, you will need:
- `GOOGLE_CREDENTIALS_PATH=./credentials.json`
- `GOOGLE_TOKEN_PATH=./google-token.json`
- `GOOGLE_CALENDAR_ID=primary`

Render’s filesystem is ephemeral for deploys, so storing secrets in files is not ideal long-term. A better next step later would be to add support for credentials via environment variables or a service account.

## 7. Verify
- Send a Telegram message to your bot.
- Check the Render service logs if requests fail.
- If you see "Telegram webhook received update" in logs, the webhook is working.
