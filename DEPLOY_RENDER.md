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
For deployment, if you want Google Calendar later, you can use local files:
- `GOOGLE_CREDENTIALS_PATH=./credentials.json`
- `GOOGLE_TOKEN_PATH=./google-token.json`
- `GOOGLE_CALENDAR_ID=primary`

For a safer deploy setup, use environment JSON instead of local files:
- `GOOGLE_CREDENTIALS_JSON` = JSON string of your OAuth credentials
- `GOOGLE_TOKEN_JSON` = JSON string of your saved Google token
- `GOOGLE_CALENDAR_ID=primary`

Render’s filesystem is ephemeral across deploys. If you use local files, the token may disappear after redeploys. The env JSON approach is better for persistent deployment config.

### Render web OAuth callback
If you use a Google Web OAuth client, add this redirect URI to your Google Cloud credentials:
- `https://<your-render-service>.onrender.com/google/oauth/callback`

Then open this URL in your browser after deployment:
- `https://<your-render-service>.onrender.com/google/oauth`

After authorization, the callback page will show the token JSON. Copy that into `GOOGLE_TOKEN_JSON` if you want Render to keep the credentials across redeploys.

## 7. Verify
- Send a Telegram message to your bot.
- Check the Render service logs if requests fail.
- If you see "Telegram webhook received update" in logs, the webhook is working.
