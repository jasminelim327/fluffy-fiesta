# Apple Calendar Integration Setup

## What you get
- Events synced to iCloud Calendar
- Works on Mac, iPad, iPhone automatically
- CalDAV protocol (works with any CalDAV server, not just Apple)
- No extra apps needed

## Important: App-Specific Password
You **cannot** use your regular Apple ID password. You must create an app-specific password.

## Step-by-step Setup

### 1. Create App-Specific Password
1. Go to https://appleid.apple.com
2. Sign in with your Apple ID
3. Click "Security" in left sidebar
4. Scroll to "App-specific passwords"
5. Click "Generate app-specific password"
6. Select "Calendar" (or "Other App")
7. Apple generates a password like: `abcd-efgh-ijkl-mnop`
8. **Save this password** - you won't see it again

### 2. Update .env
```env
APPLE_USERNAME=your-email@icloud.com
APPLE_PASSWORD=abcd-efgh-ijkl-mnop
APPLE_CALENDAR_ID=personal
```

Replace:
- `your-email@icloud.com` with your Apple ID email
- `abcd-efgh-ijkl-mnop` with the app-specific password from Step 1
- `personal` with your calendar name (or leave as is)

### 3. Find Your Calendar ID (Optional)
If "personal" doesn't work, find your calendar ID:

**On Mac:**
1. Open Calendar app
2. Right-click your calendar in sidebar
3. Select "Sharing Settings"
4. Look for the calendar ID in the URL or settings

**Or via CalDAV:**
```bash
# This will list your calendars:
curl -u "your-email@icloud.com:abcd-efgh-ijkl-mnop" \
  -X PROPFIND \
  https://caldav.icloud.com/calendar/user/your-email@icloud.com/
```

### 4. Test
```bash
npm start
```

Send a task to Slack/Telegram. Check your Apple Calendar - should appear!

## Troubleshooting

**"401 Unauthorized"**
- Check your app-specific password is correct
- Make sure you're using the app-specific password, NOT your regular Apple ID password
- Regenerate if unsure: https://appleid.apple.com → Security → Generate new password

**"CalDAV error" or "not found"**
- Try `APPLE_CALENDAR_ID=personal`
- Or use the calendar ID from Step 3

**Events not appearing on iPhone/Mac**
- Make sure iCloud Calendar is enabled in Settings
- Try: Settings → [Your Name] → iCloud → Calendar ON
- The calendar might need a few seconds to sync

**Not working at all?**
Apple's CalDAV can be finicky. Try this quick test first:
```bash
curl -X PROPFIND \
  -u "your-email@icloud.com:abcd-efgh-ijkl-mnop" \
  https://caldav.icloud.com/
```

Should return `401 Unauthorized` or XML data (not a timeout or server error).

## Advanced: Multiple Calendars
You can run multiple instances, each pointing to a different calendar:
```env
# Instance 1: Personal
APPLE_CALENDAR_ID=personal

# Instance 2: Work (separate .env file)
APPLE_CALENDAR_ID=work
```

## Using Non-Apple CalDAV Servers
This same code works with any CalDAV server:
- Nextcloud
- OwnCloud
- Radicale
- Any WebDAV/CalDAV compatible server

Just change `APPLE_USERNAME`, `APPLE_PASSWORD`, and the server URL in `apple-calendar.js` line 13.

## Apple Calendar Color Coding
Events are prioritized using iCalendar PRIORITY field:
- High = 1 (topmost)
- Medium = 5 (middle)
- Low = 9 (bottom)

Not all CalDAV clients color-code by this, but Apple Calendar respects it.

## Reference: App-Specific Password
Why app-specific password?
- Apple requires it for security
- Your main password isn't exposed to third-party apps
- You can revoke it anytime without changing your main password
- Best practice for any online account

If you ever need to change it:
1. Go to https://appleid.apple.com
2. Regenerate a new password
3. Update `.env` with the new password
4. Restart the bot

That's it!
