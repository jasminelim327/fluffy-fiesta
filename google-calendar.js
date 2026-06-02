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

      // Try to load stored token from file or in-memory JSON
      if (fs.existsSync(this.tokenPath)) {
        const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
        this.auth.setCredentials(token);
        this.tokenJson = token;
        console.log('✅ Google Calendar authenticated');
      } else if (this.tokenJson) {
        this.auth.setCredentials(this.tokenJson);
        console.log('✅ Google Calendar authenticated using token JSON');
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
      const eventTime = this._parseDeadline(actionData.deadline);

      console.log(`[DEBUG] Deadline input: "${actionData.deadline}"`);
      console.log(`[DEBUG] Parsed time: ${eventTime.toISOString()}`);

      const event = {
        summary: actionData.action,
        description: actionData.motivation,
        start: {
          dateTime: eventTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: new Date(eventTime.getTime() + 60 * 60 * 1000).toISOString(), // 1 hour
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
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
      const eventTime = this._parseDeadline(actionData.deadline);
      const event = {
        summary: actionData.action,
        description: actionData.motivation,
        start: {
          dateTime: eventTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: new Date(eventTime.getTime() + durationMinutes * 60 * 1000).toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
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
   * Parse deadline string to Date
   * Supports: "today", "tomorrow", "tomorrow at 6:00 PM", "in 3 days", "2024-12-25", etc.
   */
  _parseDeadline(deadlineStr) {
    const now = new Date();
    const str = deadlineStr.toLowerCase().trim();

    // Extract time component if present (e.g., "tomorrow at 6:00 PM" or "tmr 6pm")
    let timeStr = '';
    let dateStr = str;
    const timeMatch = str.match(/(?:at|@)?\s*(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      timeStr = timeMatch[0];
      dateStr = str.replace(timeMatch[0], '').trim();
    }

    // Parse time component
    let hours = 9;
    let minutes = 0;
    if (timeStr) {
      const hourMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
      if (hourMatch) {
        hours = parseInt(hourMatch[1]);
        minutes = hourMatch[2] ? parseInt(hourMatch[2]) : 0;
        const ampm = (hourMatch[3] || '').toLowerCase();
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
      }
    }

    // Parse date component
    let targetDate = new Date(now);
    if (dateStr.includes('today')) {
      // Today at specified time
    } else if (dateStr.includes('tomorrow') || dateStr.includes('tmr')) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      // Parse "2024-12-25"
      const [year, month, day] = dateStr.split('-').map(Number);
      targetDate = new Date(year, month - 1, day);
    } else if (dateStr.match(/in (\d+) days?/)) {
      // "in X days"
      const daysMatch = dateStr.match(/in (\d+) days?/);
      const days = parseInt(daysMatch[1]);
      targetDate.setDate(targetDate.getDate() + days);
    }

    return new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      hours,
      minutes
    );
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
