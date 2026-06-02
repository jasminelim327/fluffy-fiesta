// apple-calendar.js - iCloud Calendar Sync via CalDAV
// Works with iCloud, Apple Calendar, or any CalDAV server

const axios = require('axios');
const crypto = require('crypto');

class AppleCalendarSync {
  constructor(config) {
    this.serverUrl = config.serverUrl || 'https://caldav.icloud.com'; // Apple's CalDAV server
    this.username = config.username; // Apple ID email
    this.password = config.password; // App-specific password (not regular Apple ID password)
    this.calendarId = config.calendarId || 'personal'; // Calendar name/ID
  }

  /**
   * Create calendar event via CalDAV
   * @param {Object} actionData - { action, deadline, priority, motivation }
   * @returns {Promise<string>} Event UID
   */
  async addEvent(actionData) {
    try {
      const eventUid = `assistant-${Date.now()}@personal-assistant.local`;
      const icalData = this._buildICalEvent(actionData, eventUid);

      // Parse deadline to determine event time
      const eventTime = this._parseDeadline(actionData.deadline);

      const calendarPath = `/calendar/user/${this.username}/${this.calendarId}/`;
      const eventPath = `${calendarPath}${eventUid}.ics`;

      const response = await axios.put(
        `${this.serverUrl}${eventPath}`,
        icalData,
        {
          auth: {
            username: this.username,
            password: this.password
          },
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8'
          }
        }
      );

      console.log('✅ Added to Apple Calendar:', actionData.action);
      return eventUid;
    } catch (error) {
      console.error('❌ Apple Calendar error:', error.response?.status, error.message);
      throw error;
    }
  }

  /**
   * Get upcoming events from Apple Calendar
   */
  async getUpcomingEvents(days = 7) {
    try {
      const calendarPath = `/calendar/user/${this.username}/${this.calendarId}/`;

      // Use PROPFIND + REPORT to query events
      const response = await axios.request({
        method: 'REPORT',
        url: `${this.serverUrl}${calendarPath}`,
        auth: {
          username: this.username,
          password: this.password
        },
        data: this._buildCalendarQuery(days),
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '1'
        }
      });

      // Parse XML response and extract events
      const events = this._parseCalendarResponse(response.data);
      return events;
    } catch (error) {
      console.error('❌ Failed to fetch events:', error.message);
      return [];
    }
  }

  /**
   * Build iCalendar format event
   */
  _buildICalEvent(actionData, uid) {
    const now = new Date();
    const eventTime = this._parseDeadline(actionData.deadline);

    // Format dates for iCalendar
    const createdTime = this._formatICalDate(now);
    const eventDate = this._formatICalDate(eventTime);

    // Priority mapping: high=1, medium=5, low=9
    const priorityMap = { high: 1, medium: 5, low: 9 };
    const priority = priorityMap[actionData.priority] || 5;

    const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Personal Assistant//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${createdTime}
DTSTART:${eventDate}
SUMMARY:${this._escapeText(actionData.action)}
DESCRIPTION:${this._escapeText(actionData.motivation)}
PRIORITY:${priority}
STATUS:TENTATIVE
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;

    return ical;
  }

  /**
   * Build CalDAV REPORT query for upcoming events
   */
  _buildCalendarQuery(days) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const startTime = this._formatCalDAVDate(now);
    const endTime = this._formatCalDAVDate(future);

    return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${startTime}" end="${endTime}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
  }

  /**
   * Parse iCalendar format date (YYYYMMDDTHHMMSSZ)
   */
  _formatICalDate(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  /**
   * Parse CalDAV date format
   */
  _formatCalDAVDate(date) {
    return this._formatICalDate(date);
  }

  /**
   * Parse deadline string to Date object
   * Examples: "today", "tomorrow", "2024-12-25", "next Monday", "in 3 days"
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

  /**
   * Escape text for iCalendar format
   */
  _escapeText(text) {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  /**
   * Parse CalDAV XML response (stub - would need XML parser)
   */
  _parseCalendarResponse(xmlData) {
    // In production, use xml2js or similar
    // For now, return empty array
    return [];
  }
}

module.exports = AppleCalendarSync;

// Usage example:
/*
const AppleCalendarSync = require('./apple-calendar');

const apple = new AppleCalendarSync({
  username: 'your-email@icloud.com',
  password: 'abcd-efgh-ijkl-mnop', // App-specific password from iCloud
  calendarId: 'personal' // or your calendar ID
});

const actionData = {
  action: 'Fix login bug',
  deadline: 'tomorrow',
  priority: 'high',
  motivation: 'You got this!'
};

apple.addEvent(actionData).then(uid => {
  console.log('Event added:', uid);
}).catch(err => {
  console.error('Error:', err.message);
});
*/
