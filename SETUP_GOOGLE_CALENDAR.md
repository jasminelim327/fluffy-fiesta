# Google Calendar Integration Setup

## What you get
- Events automatically added to your Google Calendar
- Color-coded by priority (red=high, orange=medium, green=low)
- Reminders 30 min + 10 min before each event
- Fully synced with desktop & mobile

## Step-by-step Setup

### 1. Create Google Cloud Project
1. Go to https://console.cloud.google.com
2. Click "Select a project" → "New Project"
3. Name: "Personal Assistant Bot"
4. Click "Create"

### 2. Enable Calendar API
1. Search "Google Calendar API" in the search bar
2. Click it
3. Click "Enable"

### 3. Create OAuth2 Credentials
1. Left sidebar → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, click "Configure Consent Screen" first:
   - Choose "External"
   - Fill in app name, user support email
   - Skip optional fields, save
4. Choose the OAuth client type you need:
   - **Desktop application** for local testing with `npm run google-auth`
   - **Web application** if you want deployed auth flow
5. If you choose Web application, add a redirect URI:
   - Local dev: `http://localhost:3000/google/oauth/callback`
   - Render deploy: `https://<your-render-service>.onrender.com/google/oauth/callback`
6. Click "Create"
7. Click the download icon (looks like ⬇️)
8. Save as `credentials.json` in your project folder

### 4. Update .env
```env
GOOGLE_CREDENTIALS_PATH=./credentials.json
GOOGLE_TOKEN_PATH=./google-token.json
GOOGLE_CALENDAR_ID=primary
```

If you want to keep credentials and token data in Render secrets instead of local files, you can also set:
```env
GOOGLE_CREDENTIALS_JSON="{...}"
GOOGLE_TOKEN_JSON="{...}"
```

For deployed web OAuth, the callback route is:
- `https://<your-app>.onrender.com/google/oauth/callback`

If you use a Web application client on Google Cloud Console, make sure that exact callback URL is added to your credential redirect URIs.

### 5. Get OAuth Token
Use the repo helper script to generate the authorization URL and save your token.

```bash
npm run google-auth
```

1. Copy the URL printed by the helper script
2. Paste it in your browser
3. Sign in with your Google account and allow access
4. Copy the authorization code from the redirect URL
5. Run:
```bash
npm run google-auth -- --code YOUR_CODE
```

The script saves the token to `google-token.json`, and your app can then add events to Google Calendar automatically.

### 6. Test
```bash
npm start
```

Send a task to Slack/Telegram. Check your Google Calendar - should appear!

## Troubleshooting

**"Cannot find module 'googleapis'"**
```bash
npm install googleapis
```

**"OAuth token expired"**
Delete `google-token.json` and repeat Step 5.

**"Calendar API not enabled"**
Go back to https://console.cloud.google.com, search "Google Calendar API", click "Enable".

**Events not appearing**
- Check `GOOGLE_CALENDAR_ID` is correct (use "primary" for main calendar)
- Check timezone in settings (in the code: `Intl.DateTimeFormat().resolvedOptions().timeZone`)

## Color Reference
In backend, events are colored by priority:
- High: Tomato (11)
- Medium: Tangerine (5)
- Low: Sage (2)

You can customize these color IDs in `google-calendar.js` if desired.

## Advanced: Multiple Calendars
To add to a specific calendar instead of "primary":
1. Get your calendar ID:
   - Google Calendar → Settings → Calendar list → Find calendar
   - Calendar ID is like: `abc123def456@group.calendar.google.com`
2. Update `.env`: `GOOGLE_CALENDAR_ID=abc123def456@group.calendar.google.com`

## API Quota
Google Calendar API is free. Quota limits:
- 1,000,000 requests/day
- Your bot uses ~1-5 requests per task

You're fine unless you're adding thousands of events per day.
