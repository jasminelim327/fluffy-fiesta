const fs = require('fs');
const path = require('path');
const GoogleCalendarSync = require('../google-calendar');

const credentialsPath = path.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json');
const tokenPath = path.resolve(process.cwd(), process.env.GOOGLE_TOKEN_PATH || './google-token.json');
const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

if (!fs.existsSync(credentialsPath)) {
  console.error(`❌ credentials.json not found at ${credentialsPath}`);
  process.exit(1);
}

if (!fs.existsSync(tokenPath)) {
  console.error(`❌ google-token.json not found at ${tokenPath}`);
  process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
const google = new GoogleCalendarSync({ credentials, tokenPath, calendarId });

(async () => {
  const initialized = await google.initialize();
  if (!initialized) {
    console.error('❌ Google Calendar initialization failed.');
    process.exit(1);
  }

  const actionData = {
    action: 'DailyReminder integration test event',
    deadline: 'tomorrow',
    priority: 'medium',
    motivation: 'Testing Google Calendar integration from the dailyreminder repo.'
  };

  try {
    const eventId = await google.addEvent(actionData);
    console.log('✅ Test event created successfully!');
    console.log('Event ID:', eventId);
    console.log('Check your Google Calendar for "DailyReminder integration test event" tomorrow at 9:00 AM.');
  } catch (error) {
    console.error('❌ Failed to create test event:', error.message || error);
    process.exit(1);
  }
})();
