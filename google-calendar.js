// google-calendar.js - Google Calendar API Integration
// Install: npm install googleapis

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class GoogleCalendarSync {
  constructor(config) {
    this.credentials = config.credentials; // OAuth2 credentials JSON
    this.tokenPath = config.tokenPath || './google-token.json';
    this.tokenJson = config.tokenJson || null;
    this.calendarId = config.calendarId || 'primary'; // 'primary' = default calendar
    this.timezone = config.timezone || process.env.USER_TIMEZONE || 'Asia/Singapore';
    this.auth = null;
  }

  /**
   * Initialize OAuth2 client
   * Call once at startup
   */
  async initialize() {
    try {
      const creds = this.credentials.installed || this.credentials.web || {};
      const { client_secret, client_id, redirect_uris } = creds;

      if (!client_id || !client_secret || !redirect_uris || redirect_uris.length === 0) {
        console.error('❌ Google OAuth credentials are missing required fields.');
        console.error('Use a Desktop OAuth client or a Web OAuth client with redirect_uris configured.');
        return false;
      }

      this.auth = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      // Prefer explicit tokenJson (per-user tokens) over the shared file token.
      // This prevents the shared ./google-token.json from overriding a user's
      // personal token when creating per-user calendar instances.
      if (this.tokenJson) {
        this.auth.setCredentials(this.tokenJson);
        console.log('✅ Google Calendar authenticated using token JSON');
      } else if (fs.existsSync(this.tokenPath)) {
        const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
        this.auth.setCredentials(token);
        this.tokenJson = token;
        console.log('✅ Google Calendar authenticated from file');
      } else {
        console.log('⚠️ No token found. Run generateAuthUrl() first');
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ Auth error:', error.message);
      return false;
    }
  }

  /**
   * Generate authorization URL (run once during setup)
   * User visits URL, grants permission, then call setAuthCode(code)
   */
  generateAuthUrl() {
    if (!this.auth) {
      console.error('Auth not initialized');
      return null;
    }

    const scopes = ['https://www.googleapis.com/auth/calendar'];
    const authUrl = this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent' // Force consent screen to ensure refresh_token is issued
    });

    console.log('Visit this URL to authorize:\n', authUrl);
    return authUrl;
  }

  /**
   * Exchange auth code for token (call after user visits generateAuthUrl)
   */
  async setAuthCode(code) {
    try {
      const { tokens } = await this.auth.getToken(code);
      this.auth.setCredentials(tokens);
      this.tokenJson = tokens;

      // Save token for future use if file storage is available
      try {
        fs.writeFileSync(this.tokenPath, JSON.stringify(tokens));
        console.log('✅ Token saved to file. You can now use the calendar.');
      } catch (writeError) {
        console.warn('⚠️ Could not save token to file:', writeError.message);
      }

      return true;
    } catch (error) {
      console.error('❌ Error setting auth code:', error.message);
      return false;
    }
  }

  /**
   * Add event to Google Calendar
   * @param {Object} actionData - { action, deadline, priority, motivation }
   * @returns {Promise<string>} Event ID
   */
  async addEvent(actionData) {
    try {
      if (!this.auth) await this.initialize();

      const calendar = google.calendar({ version: 'v3', auth: this.auth });
      const eventTimeStr = this._parseDeadline(actionData.deadline);

      console.log(`[DEBUG] Deadline input: "${actionData.deadline}"`);
      console.log(`[DEBUG] Parsed time: ${eventTimeStr} (${this.timezone})`);

      const event = {
        summary: actionData.action,
        description: actionData.motivation,
        start: {
          dateTime: eventTimeStr,
          timeZone: this.timezone
        },
        end: {
          dateTime: this._addHours(eventTimeStr, 1),
          timeZone: this.timezone
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 },
            { method: 'popup', minutes: 10 }
          ]
        }
      };

      // Add color based on priority
      const colorMap = {
        high: '11',   // Tomato
        medium: '5',  // Tangerine
        low: '2'      // Sage
      };
      event.colorId = colorMap[actionData.priority] || '5';

      const response = await calendar.events.insert({
        calendarId: this.calendarId,
        resource: event
      });

      console.log('✅ Added to Google Calendar:', actionData.action);
      return response.data.id;
    } catch (error) {
      console.error('❌ Google Calendar error:', error.message);
      throw error;
    }
  }

  /**
   * Get upcoming events
   */
  async addRecurringEvent(actionData, count = 30, durationMinutes = 30) {
    try {
      if (!this.auth) await this.initialize();

      const calendar = google.calendar({ version: 'v3', auth: this.auth });
      const eventTimeStr = this._parseDeadline(actionData.deadline);
      const event = {
        summary: actionData.action,
        description: actionData.motivation,
        start: {
          dateTime: eventTimeStr,
          timeZone: this.timezone
        },
        end: {
          dateTime: this._addHours(eventTimeStr, durationMinutes / 60),
          timeZone: this.timezone
        },
        recurrence: [`RRULE:FREQ=DAILY;COUNT=${count}`],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 },
            { method: 'popup', minutes: 10 }
          ]
        },
        colorId: {
          high: '11',
          medium: '5',
          low: '2'
        }[actionData.priority] || '5'
      };

      const response = await calendar.events.insert({
        calendarId: this.calendarId,
        resource: event
      });

      console.log('✅ Added recurring Google Calendar event:', actionData.action);
      return response.data.id;
    } catch (error) {
      console.error('❌ Google Calendar recurring event error:', error.message);
      throw error;
    }
  }

  async getUpcomingEvents(maxResults = 10) {
    try {
      if (!this.auth) await this.initialize();

      const calendar = google.calendar({ version: 'v3', auth: this.auth });

      const response = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin: new Date().toISOString(),
        maxResults: maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      });

      return response.data.items.map(event => ({
        id: event.id,
        title: event.summary,
        start: event.start.dateTime || event.start.date,
        description: event.description,
        colorId: event.colorId
      }));
    } catch (error) {
      console.error('❌ Error fetching events:', error.message);
      return [];
    }
  }

  async getTodayEvents(timezone) {
    try {
      if (!this.auth) await this.initialize();
      const calendar = google.calendar({ version: 'v3', auth: this.auth });
      const tz = timezone || this.timezone;

      // Compute UTC bounds for "today" in the user's timezone.
      // Strategy: noon UTC on today-in-tz tells us the tz offset; use that to shift midnight.
      const now = new Date();
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
      const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(tomorrowDate);

      // Detect tz offset by checking what hour and minute it is in the tz when UTC is noon
      const refDate = new Date(todayStr + 'T12:00:00Z');
      const tzParts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: false
      }).formatToParts(refDate);
      const tzHour = parseInt(tzParts.find(p => p.type === 'hour').value);
      const tzMinute = parseInt(tzParts.find(p => p.type === 'minute').value);
      const offsetMinutes = (tzHour - 12) * 60 + tzMinute;

      const timeMin = new Date(new Date(todayStr + 'T00:00:00Z').getTime() - offsetMinutes * 60000).toISOString();
      const timeMax = new Date(new Date(tomorrowStr + 'T00:00:00Z').getTime() - offsetMinutes * 60000).toISOString();

      const response = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20
      });

      return (response.data.items || []).map(event => ({
        id: event.id,
        title: event.summary || '(no title)',
        start: event.start.dateTime || event.start.date
      }));
    } catch (error) {
      console.error('❌ getTodayEvents error:', error.message);
      return [];
    }
  }

  /**
   * Delete event
   */
  async deleteEvent(eventId) {
    try {
      if (!this.auth) await this.initialize();

      const calendar = google.calendar({ version: 'v3', auth: this.auth });

      await calendar.events.delete({
        calendarId: this.calendarId,
        eventId: eventId
      });

      console.log('✅ Event deleted');
    } catch (error) {
      console.error('❌ Error deleting event:', error.message);
    }
  }

  /**
   * Update event
   */
  async updateEvent(eventId, updates) {
    try {
      if (!this.auth) await this.initialize();

      const calendar = google.calendar({ version: 'v3', auth: this.auth });

      // Get existing event
      const existing = await calendar.events.get({
        calendarId: this.calendarId,
        eventId: eventId
      });

      // Merge updates
      const updated = { ...existing.data, ...updates };

      const response = await calendar.events.update({
        calendarId: this.calendarId,
        eventId: eventId,
        resource: updated
      });

      console.log('✅ Event updated');
      return response.data.id;
    } catch (error) {
      console.error('❌ Error updating event:', error.message);
    }
  }

  /**
   * Parse deadline string into a local datetime string (no Z/UTC suffix).
   * Google Calendar interprets this as the time in this.timezone.
   * Supports: "today", "tomorrow", "tomorrow at 6:00 PM", "in 3 days", "2024-12-25", etc.
   */
  _parseDeadline(deadlineStr) {
    const pad = n => String(n).padStart(2, '0');

    // Get "now" expressed in the user's timezone using Intl
    const nowParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = type => parseInt(nowParts.find(p => p.type === type)?.value);
    let year = get('year'), month = get('month') - 1, day = get('day');

    const str = deadlineStr.toLowerCase().trim();

    // Extract time component (e.g. "6:00 PM", "6pm", "at 18:00")
    let hours = 9, minutes = 0;
    const timeMatch = str.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1]);
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const ampm = (timeMatch[3] || '').toLowerCase();
      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
    }

    // Extract date component
    const dateStr = str.replace(/(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i, '').trim();

    if (dateStr.includes('tomorrow') || dateStr.includes('tmr')) {
      const d = new Date(year, month, day + 1);
      year = d.getFullYear(); month = d.getMonth(); day = d.getDate();
    } else if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      year = y; month = m - 1; day = d;
    } else if (dateStr.match(/in (\d+) days?/)) {
      const days = parseInt(dateStr.match(/in (\d+) days?/)[1]);
      const d = new Date(year, month, day + days);
      year = d.getFullYear(); month = d.getMonth(); day = d.getDate();
    }
    // "today" or no date → keep current day

    const dateTimeStr = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
    console.log(`[DEBUG] Deadline input: "${deadlineStr}" → ${dateTimeStr} (${this.timezone})`);
    return dateTimeStr;
  }

  /**
   * Add a number of hours to a local datetime string (no timezone suffix).
   */
  _addHours(dateTimeStr, hours) {
    const pad = n => String(n).padStart(2, '0');
    const d = new Date(dateTimeStr); // parsed as local server time, only used for arithmetic
    d.setMinutes(d.getMinutes() + Math.round(hours * 60));
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }
}

module.exports = GoogleCalendarSync;

// Usage example:
/*
const GoogleCalendarSync = require('./google-calendar');

// First time setup:
// 1. Download OAuth2 credentials from Google Cloud Console
// 2. Initialize with your credentials.json file

const google = new GoogleCalendarSync({
  credentials: require('./credentials.json'),
  tokenPath: './google-token.json',
  calendarId: 'primary'
});

// Initialize
await google.initialize();

// If no token exists yet:
// const authUrl = google.generateAuthUrl();
// User visits authUrl, gets code, then:
// await google.setAuthCode(code);

// Add event
const actionData = {
  action: 'Fix login bug',
  deadline: 'tomorrow',
  priority: 'high',
  motivation: 'You got this!'
};

google.addEvent(actionData).then(eventId => {
  console.log('Event added:', eventId);
});

// Get upcoming events
google.getUpcomingEvents(5).then(events => {
  console.log('Upcoming events:', events);
});
*/
