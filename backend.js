// backend.js - Personal Assistant Bot Server
// Run: node backend.js
// Install: npm install express openrouter dotenv axios body-parser

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const bodyParser = require('body-parser');
const db = require('./db');
const MessagingIntegration = require('./slack-telegram-integration');

const app = express();
// Capture raw body for Slack signature verification (works for JSON and urlencoded)
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(bodyParser.urlencoded({ extended: true, verify: (req, res, buf) => { req.rawBody = buf; } }));

// ============================================
// CONFIG
// ============================================

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SECRET = process.env.SLACK_SIGNING_SECRET;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Startup checks: warn when critical env vars are missing
if (!OPENROUTER_KEY) console.warn('⚠️ OPENROUTER_API_KEY not set. OpenRouter requests will fail.');
if (!SLACK_TOKEN || !SLACK_SECRET) console.warn('⚠️ SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET missing — Slack endpoints may fail.');
if (!TELEGRAM_TOKEN) console.warn('⚠️ TELEGRAM_BOT_TOKEN not set — Telegram integration disabled.');

// ============================================
// SLACK VERIFICATION
// ============================================

function verifySlackSignature(req) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  // Basic checks
  if (!signature || !timestamp || !SLACK_SECRET) return false;

  // Verify timestamp is recent (within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  // Prefer raw body captured by body-parser's verify hook
  let raw = '';
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    raw = req.rawBody.toString('utf8');
  } else if (typeof req.body === 'string') {
    raw = req.body;
  } else {
    // Fallback - not ideal for Slack signature verification
    raw = JSON.stringify(req.body || '');
  }

  const baseString = `v0:${timestamp}:${raw}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', SLACK_SECRET).update(baseString).digest('hex');

  const sigBuf = Buffer.from(signature);
  const mySigBuf = Buffer.from(mySignature);
  if (sigBuf.length !== mySigBuf.length) return false;

  try {
    return crypto.timingSafeEqual(sigBuf, mySigBuf);
  } catch (e) {
    return false;
  }
}

// ============================================
// OPENROUTER INTEGRATION
// ============================================

async function callOpenRouter(userMessage, systemPrompt) {
  try {
    const response = await axios.post(OPENROUTER_URL, {
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://personal-assistant.local',
        'X-Title': 'Personal Assistant Bot'
      }
    });
    
    const output = response.data.choices?.[0]?.message?.content || response.data.choices?.[0]?.text || '';
    console.log('OpenRouter response:', JSON.stringify(output));
    return output;
  } catch (error) {
    console.error('OpenRouter error:', error.response?.data || error.message);
    return 'Sorry, I had trouble processing that. Try again!';
  }
}

// ============================================
// AI LOGIC: Convert message to actions
// ============================================

async function processMessage(text) {
  const normalized = (text || '').trim().toLowerCase();
  const cleaned = normalized.replace(/[^\u0000-\u007f]/g, '').replace(/[\p{P}\p{S}]/gu, '').trim();
  const confirmationRegex = /^(go|ok|okay|yes|sure|ready|yep|yeah|nope|nah|fine|thanks?)$/i;
  const greetingRegex = /^(hi|hello|hey|yo|hola|greetings|sup|good morning|good afternoon|good evening)$/i;

  if (confirmationRegex.test(cleaned) || greetingRegex.test(cleaned) || cleaned.length === 0) {
    console.log('Non-task message detected, sending clarification prompt:', JSON.stringify(cleaned));
    return {
      action: 'I need a task to help you. Please tell me something like "Buy milk tomorrow" or "Schedule a call on Friday".',
      deadline: 'today',
      priority: 'medium',
      motivation: 'I’m ready when you are.',
      clarification: true
    };
  }

  const systemPrompt = `You are a personal assistant bot. Convert user messages into:
1. ACTION: What to do
2. DEADLINE: When (if mentioned, else "today")
3. PRIORITY: high/medium/low
4. MOTIVATION: One short encouraging phrase

Format EXACTLY as:
ACTION: [task description]
DEADLINE: [date/time]
PRIORITY: [level]
MOTIVATION: [phrase]

If the user message is just a greeting, confirmation, or not a real task, respond with:
ACTION: Please provide a specific task or goal.
DEADLINE: today
PRIORITY: medium
MOTIVATION: I’m ready when you are.

Be concise. Extract real tasks from casual talk.`;

  const response = await callOpenRouter(text, systemPrompt);
  const result = parseResponse(response);

  if (!result.action) {
    console.warn('ParseResponse failed, using fallback text');
    console.warn('OpenRouter raw response:', JSON.stringify(response));
    return {
      action: response || 'Unable to parse task.',
      deadline: 'today',
      priority: 'medium',
      motivation: 'I could not parse the response format, but here is the reply.',
      clarification: true
    };
  }

  const clarificationPatterns = [
    /provide a specific task/i,
    /need.*task/i,
    /please.*clarification/i,
    /I could not.*parse/i
  ];
  const isClarification = clarificationPatterns.some((rx) => rx.test(result.action));
  return {
    ...result,
    clarification: isClarification
  };
}

function parseResponse(text) {
  const lines = (text || '').split(/\r?\n/);
  const result = {
    action: '',
    deadline: 'today',
    priority: 'medium',
    motivation: 'You got this!',
    clarification: false
  };
  
  lines.forEach(line => {
    const actionMatch = line.match(/^\s*ACTION\s*:\s*(.+)$/i);
    const deadlineMatch = line.match(/^\s*DEADLINE\s*:\s*(.+)$/i);
    const priorityMatch = line.match(/^\s*PRIORITY\s*:\s*(.+)$/i);
    const motivationMatch = line.match(/^\s*MOTIVATION\s*:\s*(.+)$/i);

    if (actionMatch) result.action = actionMatch[1].trim();
    if (deadlineMatch) result.deadline = deadlineMatch[1].trim();
    if (priorityMatch) result.priority = priorityMatch[1].trim();
    if (motivationMatch) result.motivation = motivationMatch[1].trim();
  });
  
  return result;
}

function isTaskMessage(text) {
  return /(schedule|calendar|appointment|meeting|remind|task|deadline|todo|to do|buy|book|call|meet|plan|plan to)/i.test(text);
}

// ============================================
// SLACK HANDLERS
// ============================================

if (SLACK_TOKEN && SLACK_SECRET) {
  app.post('/slack/command', (req, res) => {
    if (!verifySlackSignature(req)) {
      return res.status(401).send('Unauthorized');
    }

    res.send(''); // Acknowledge immediately

    const { command, text, user_id, team_id } = req.body;

    if (command === '/task') {
      processAndReplySlack(text, user_id);
    }
  });

  app.post('/slack/events', (req, res) => {
    if (!verifySlackSignature(req)) {
      return res.status(401).send('Unauthorized');
    }

    const { type, challenge, event } = req.body;

    // Slack challenge for verification
    if (type === 'url_verification') {
      return res.send(challenge);
    }

    res.send(''); // Acknowledge immediately

    if (event.type === 'message' && !event.bot_id) {
      // Don't process bot's own messages
      const { text, user, channel } = event;
      processAndReplySlack(text, user, channel);
    }
  });
} else {
  console.log('⚠️ Slack integration disabled: set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to enable it.');
}

app.get('/google/oauth', async (req, res) => {
  if (!googleCalendar) {
    return res.status(500).send('Google Calendar credentials are not configured.');
  }

  try {
    await googleCalendar.initialize();
    const authUrl = googleCalendar.generateAuthUrl();
    if (!authUrl) {
      return res.status(500).send('Unable to generate Google auth URL. Check credentials and redirect URIs.');
    }
    res.redirect(authUrl);
  } catch (error) {
    console.error('Google OAuth URL error:', error.message || error);
    res.status(500).send('Could not generate Google OAuth URL.');
  }
});

app.get('/google/oauth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Missing code in callback request.');
  }

  if (!googleCalendar) {
    return res.status(500).send('Google Calendar credentials are not configured.');
  }

  try {
    await googleCalendar.initialize();
    const success = await googleCalendar.setAuthCode(code);
    if (!success) {
      return res.status(500).send('Failed to exchange Google code for token.');
    }

    const tokenJson = googleCalendar.tokenJson || null;
    const tokenSaved = fs.existsSync(process.env.GOOGLE_TOKEN_PATH || './google-token.json');

    res.send(`
      <h1>Google Calendar connected</h1>
      <p>Token ${tokenSaved ? 'saved to file' : 'generated'} successfully.</p>
      <p>If you are using Render, copy the token JSON below into your <strong>GOOGLE_TOKEN_JSON</strong> secret.</p>
      <pre>${JSON.stringify(tokenJson, null, 2)}</pre>
    `);
  } catch (error) {
    console.error('Google OAuth callback error:', error.response?.data || error.message || error);
    res.status(500).send('Google OAuth callback failed. Check the server logs.');
  }
});

async function processAndReplySlack(userText, userId, channelId = '@' + userId) {
  try {
    const actionData = await processMessage(userText);
    
    const message = `
✅ Got it!
**${actionData.action}**
📅 ${actionData.deadline}
🎯 ${String(actionData.priority || 'medium').toUpperCase()}
💪 ${actionData.motivation}
    `;

    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: channelId,
      text: message,
      mrkdwn: true
    }, {
      headers: {
        'Authorization': `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    // TODO: Add to calendar/Notion here
    addToCalendar(actionData);
    addToNotes(actionData, userId);

  } catch (error) {
    console.error('Slack processing error:', error.message);
  }
}

// ============================================
// TELEGRAM HANDLERS
// ============================================

app.post('/telegram/webhook', async (req, res) => {
  const update = req.body;

  console.log('Telegram webhook received update:', JSON.stringify(update?.message?.text || update));

  if (update.message?.text) {
    const { text, from, chat } = update.message;
    const userId = from.id;
    const chatId = chat.id;

    res.send('OK');

    try {
      if (messagingIntegration && !isTaskMessage(text)) {
        console.log('Sending Telegram typing indicator for:', text);
        await messagingIntegration.sendTelegramTyping(chatId);
        console.log('Routing Telegram message through MessagingIntegration:', text);
        const formatted = await messagingIntegration.handleTelegramMessage(text, userId, chatId);
        await messagingIntegration.sendToTelegram(formatted.chat_id || chatId, formatted.text);
        return;
      }

      console.log('Sending Telegram typing indicator for fallback/task handling:', text);
      await sendTelegramTyping(chatId);
      console.log('Processing Telegram message (fallback/task):', text);
      const actionData = await processMessage(text);
      console.log('Processed actionData:', JSON.stringify(actionData));

      let message;
      if (actionData.clarification) {
        message = `I didn't get a task yet. Please tell me something like: "Buy milk tomorrow" or "Schedule a call on Friday".`;
      } else {
        message = `\n✅ Got it!\n<b>${actionData.action}</b>\n📅 ${actionData.deadline}\n🎯 ${String(actionData.priority || 'medium').toUpperCase()}\n💪 ${actionData.motivation}`;
      }

      await sendTelegramMessage(chatId, message);

      if (!actionData.clarification) {
        addToCalendar(actionData);
        addToNotes(actionData, userId);
      }
    } catch (error) {
      console.error('Telegram processing error:', error.response?.data || error.message);
    }
  } else {
    res.send('OK');
  }
});

// Polling fallback for Telegram (if no webhook)
async function telegramPolling() {
  let offset = 0;
  
  setInterval(async () => {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`,
        { params: { offset, allowed_updates: ['message'] } }
      );

      response.data.result.forEach(async (update) => {
        if (update.message?.text) {
          const { text, from, chat } = update.message;
          const userId = from.id;
          const chatId = chat.id;

          try {
            const actionData = await processMessage(text);
            
            const message = `
✅ Got it!
<b>${actionData.action}</b>
📅 ${actionData.deadline}
🎯 ${actionData.priority.toUpperCase()}
💪 ${actionData.motivation}
            `;

            await sendTelegramMessage(chatId, message);

            addToCalendar(actionData);
            addToNotes(actionData, userId);

          } catch (error) {
            console.error('Error:', error.message);
          }
        }
        offset = update.update_id + 1;
      });
    } catch (error) {
      console.error('Polling error:', error.message);
    }
  }, 1000);
}

// ============================================
// INTEGRATIONS - Calendar & Notes
// ============================================

// Safe Telegram sender: try HTML parse_mode, fallback to plain text and log full errors
async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  try {
    console.log('Sending Telegram message to', chatId);
    return await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.warn('Telegram send with HTML failed, retrying without parse_mode:', err.response?.data || err.message);
    try {
      return await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text
      });
    } catch (err2) {
      console.error('Telegram send failed (plain):', err2.response?.data || err2.message);
      throw err2;
    }
  }
}

async function sendTelegramTyping(chatId) {
  if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  try {
    return await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
      chat_id: chatId,
      action: 'typing'
    });
  } catch (err) {
    console.error('Telegram typing action error:', err.response?.data || err.message);
  }
}

// Initialize integrations (optional - only if configured)
let googleCalendar = null;
let appleCalendar = null;
let notionManager = null;
let messagingIntegration = null;

async function initializeIntegrations() {
  // Google Calendar
  const googleCredentialsJson = process.env.GOOGLE_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) : null;
  const googleCredentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
  let googleCredentials = googleCredentialsJson;

  if (!googleCredentials && googleCredentialsPath) {
    try {
      googleCredentials = require(googleCredentialsPath);
    } catch (err) {
      console.warn('⚠️ Could not load GOOGLE_CREDENTIALS_PATH:', err.message);
    }
  }

  if (googleCredentials) {
    try {
      const GoogleCalendarSync = require('./google-calendar');
      const googleTokenJson = process.env.GOOGLE_TOKEN_JSON ? JSON.parse(process.env.GOOGLE_TOKEN_JSON) : null;
      googleCalendar = new GoogleCalendarSync({
        credentials: googleCredentials,
        tokenPath: process.env.GOOGLE_TOKEN_PATH || './google-token.json',
        tokenJson: googleTokenJson,
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary'
      });
      await googleCalendar.initialize();
      console.log('✅ Google Calendar initialized');
    } catch (error) {
      console.warn('⚠️ Google Calendar not configured:', error.message);
    }
  }

  // Apple Calendar (CalDAV)
  if (process.env.APPLE_USERNAME && process.env.APPLE_PASSWORD) {
    try {
      const AppleCalendarSync = require('./apple-calendar');
      appleCalendar = new AppleCalendarSync({
        username: process.env.APPLE_USERNAME,
        password: process.env.APPLE_PASSWORD,
        calendarId: process.env.APPLE_CALENDAR_ID || 'personal'
      });
      console.log('✅ Apple Calendar initialized');
    } catch (error) {
      console.warn('⚠️ Apple Calendar not configured:', error.message);
    }
  }

  // Notion
  if (process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
    try {
      const NotionTaskManager = require('./notion');
      notionManager = new NotionTaskManager({
        apiKey: process.env.NOTION_API_KEY,
        databaseId: process.env.NOTION_DATABASE_ID,
        notesPageId: process.env.NOTION_NOTES_PAGE_ID
      });
      console.log('✅ Notion initialized');
    } catch (error) {
      console.warn('⚠️ Notion not configured:', error.message);
    }
  }
}

async function addToCalendar(actionData) {
  const promises = [];

  // Add to Google Calendar
  if (googleCalendar) {
    try {
      promises.push(
        googleCalendar.addEvent(actionData)
          .catch(err => console.error('Google Calendar add failed:', err.message))
      );
    } catch (error) {
      console.error('Google Calendar error:', error.message);
    }
  }

  // Add to Apple Calendar
  if (appleCalendar) {
    try {
      promises.push(
        appleCalendar.addEvent(actionData)
          .catch(err => console.error('Apple Calendar add failed:', err.message))
      );
    } catch (error) {
      console.error('Apple Calendar error:', error.message);
    }
  }

  // Add to Notion
  if (notionManager) {
    try {
      promises.push(
        notionManager.addTask(actionData)
          .catch(err => console.error('Notion add failed:', err.message))
      );
    } catch (error) {
      console.error('Notion error:', error.message);
    }
  }

  // Wait for all to complete
  await Promise.all(promises);
}

async function addToNotes(actionData, userId) {
  if (notionManager) {
    try {
      await notionManager.addNote({
        title: actionData.action,
        content: actionData.motivation,
        userId: userId
      });
    } catch (error) {
      console.error('Error adding note:', error.message);
    }
  }
}

// ============================================
// STARTUP
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🤖 Assistant running on port ${PORT}`);
  
  // Initialize integrations
  await initializeIntegrations();

  // Initialize persistence layer
  await db.initializeDatabase();

  // Instantiate the messaging integration that wires assistant features to Slack/Telegram
  try {
    messagingIntegration = new MessagingIntegration({
      openrouterKey: OPENROUTER_KEY,
      openrouterModel: process.env.OPENROUTER_MODEL,
      slackToken: SLACK_TOKEN,
      telegramToken: TELEGRAM_TOKEN,
      calendarSync: googleCalendar
    });
    console.log('✅ Messaging integration initialized');
  } catch (err) {
    console.warn('Could not initialize MessagingIntegration:', err.message || err);
  }
  
  // Start Telegram polling if webhook not used
  if (!process.env.USE_TELEGRAM_WEBHOOK) {
    console.log('📱 Starting Telegram polling...');
    telegramPolling();
  }
});
