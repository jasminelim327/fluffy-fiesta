// backend.js - Personal Assistant Bot Server
// Run: node backend.js
// Install: npm install express openrouter dotenv axios body-parser

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const db = require('./db');
const MessagingIntegration = require('./slack-telegram-integration');

const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'docs')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================
// CONFIG
// ============================================

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SHORTCUT_MAP = {
  list: 'list my tasks',
  streak: 'show my streak',
  motivation: 'motivate me',
  patterns: 'show my patterns',
  goals: 'check abandoned goals'
};

// ============================================
// BOT COMMAND REGISTRATION
// ============================================

async function registerBotCommands() {
  if (!TELEGRAM_TOKEN) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setMyCommands`, {
      commands: [
        { command: 'start', description: 'Get started with a guided setup' },
        { command: 'help', description: 'See everything I can do' },
        { command: 'tasks', description: 'View your open tasks' },
        { command: 'streak', description: 'Check your daily habit streak' },
        { command: 'review', description: 'Get your weekly progress review' },
        { command: 'patterns', description: 'Analyse your productivity patterns' },
        { command: 'motivation', description: 'Get a boost when you need it' },
        { command: 'energy', description: 'Log your energy level (1–10)' },
        { command: 'goals', description: 'Revisit goals you have not touched' },
        { command: 'connect', description: 'Link your Google Calendar' }
      ]
    });
    console.log('✅ Bot commands registered with Telegram');
  } catch (err) {
    console.warn('⚠️ setMyCommands failed (non-fatal):', err.response?.data?.description || err.message);
  }
}

function resolveSlashCommand(msg) {
  const entity = (msg.entities || []).find(e => e.type === 'bot_command' && e.offset === 0);
  if (!entity) return null;
  const raw = msg.text.slice(1, entity.length).split('@')[0].toLowerCase();
  const commandMap = {
    help: 'help',
    tasks: 'list my tasks',
    streak: 'show my streak',
    review: 'weekly review',
    patterns: 'show my patterns',
    motivation: 'motivate me',
    energy: 'energy',
    goals: 'check abandoned goals',
    connect: 'connect google'
  };
  return { command: raw, text: commandMap[raw] || null };
}

// Startup checks: warn when critical env vars are missing
if (!OPENROUTER_KEY) console.warn('⚠️ OPENROUTER_API_KEY not set. OpenRouter requests will fail.');
if (!TELEGRAM_TOKEN) console.warn('⚠️ TELEGRAM_BOT_TOKEN not set — Telegram integration disabled.');

// Send a formatted response then, if it has followUpButtons, send them as a guaranteed second message
async function sendFormattedResponse(messaging, chatId, formatted) {
  await messaging.sendToTelegram(formatted.chat_id || chatId, formatted.text, {
    parse_mode: formatted.parse_mode,
    reply_markup: formatted.reply_markup
  });
  if (formatted.followUpButtons) {
    await messaging.sendToTelegram(chatId, '_What\'s next?_', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: formatted.followUpButtons }
    });
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
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Missing code in callback request.');
  }

  if (!googleCalendar) {
    return res.status(500).send('Google Calendar credentials are not configured.');
  }

  // ── Per-user flow (initiated from Telegram) ──────────────────────────────
  if (state && pendingOAuthStates.has(state)) {
    const { userId, chatId } = pendingOAuthStates.get(state);
    pendingOAuthStates.delete(state);

    try {
      // Use a fresh OAuth2 client for token exchange — reusing the shared
      // googleCalendar.auth can cause "No refresh token" errors if it already
      // has credentials set, because getToken() skips issuing a refresh_token.
      const { google } = require('googleapis');
      const creds = googleCalendar.credentials.installed || googleCalendar.credentials.web || {};
      const tempAuth = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
      const { tokens } = await tempAuth.getToken(code);

      console.log(`[OAuth] tokens received for user ${userId}: refresh_token=${tokens.refresh_token ? 'yes' : 'no'}, access_token=${tokens.access_token ? 'yes' : 'no'}`);

      if (!tokens.refresh_token) {
        console.warn(`⚠️ No refresh_token returned for user ${userId}. User may need to revoke app access and reconnect.`);
      }

      // Persist token in its own dedicated table — isolated from the user profile
      // blob so FriendlyAssistant saves can never accidentally overwrite it.
      await db.saveGoogleToken(userId, tokens);

      // Verify the save
      const saved = await db.getGoogleToken(userId);
      console.log(`[OAuth] verify save for user ${userId}: token=${saved ? 'present' : 'MISSING'}, refresh_token=${saved?.refresh_token ? 'yes' : 'no'}`);

      console.log(`✅ Google Calendar linked for Telegram user ${userId}`);

      // Notify user in Telegram and ask for location to set timezone
      if (chatId && TELEGRAM_TOKEN) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: '✅ *Google Calendar connected!*\n\nYour tasks will now be added to your personal Google Calendar automatically.',
          parse_mode: 'Markdown'
        }).catch(err => console.error('Telegram confirmation failed:', err.message));

        // Ask user to share location so we can set their timezone
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: '📍 *One more step!* Share your location so I can schedule events at the right local time for you.',
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[{ text: '📍 Share my location', request_location: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        }).catch(err => console.error('Telegram location prompt failed:', err.message));
      }

      return res.send(`
        <html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center">
          <h1>✅ Connected!</h1>
          <p>Your Google Calendar is now linked. You can close this tab and return to Telegram.</p>
        </body></html>
      `);
    } catch (error) {
      console.error('Per-user OAuth callback error:', error.response?.data || error.message);
      return res.status(500).send('OAuth failed. Please try the "connect google" command again in Telegram.');
    }
  }

  // ── Shared server flow (admin setup) ─────────────────────────────────────
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

// ============================================
// TELEGRAM HANDLERS
// ============================================

// Detect IANA timezone from coordinates using BigDataCloud (free, no API key needed)
async function detectTimezone(latitude, longitude) {
  try {
    const resp = await axios.get('https://api.bigdatacloud.net/data/timezone-by-location', {
      params: { latitude, longitude }
    });
    return resp.data?.ianaTimeZone || null;
  } catch (err) {
    console.error('Timezone detection failed:', err.message);
    return null;
  }
}

// Handle a location message from a Telegram user — detect + save their timezone
async function handleTelegramLocation(userId, chatId, latitude, longitude) {
  const tz = await detectTimezone(latitude, longitude);
  if (!tz) {
    await sendTelegramMessage(chatId, '⚠️ Could not detect timezone from your location. Please try again.');
    return;
  }

  // Save to user profile
  if (messagingIntegration) {
    await messagingIntegration.assistant.updateProfileMeta(userId, { timezone: tz, telegramChatId: chatId });
  }

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text: `✅ *Timezone set to ${tz}*\n\nYour calendar events will now show at the right local time.`,
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true }  // dismiss the location keyboard
  });
  console.log(`✅ Timezone ${tz} saved for user ${userId}`);
}

app.post('/telegram/webhook', async (req, res) => {
  const update = req.body;
  console.log('Telegram webhook received update:', JSON.stringify(update?.message?.text || update?.callback_query?.data || update?.message?.location || update));

  res.send('OK');

  // Handle inline button taps (Done / Snooze)
  if (update.callback_query) {
    const { id: callbackId, data, message } = update.callback_query;
    const cbChatId = message.chat.id;
    const cbMessageId = message.message_id;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackId
    }).catch(() => {});
    const parts = (data || '').split(':');
    const action = parts[0];
    const cbUserId = parts[1];
    const taskId = parts[2];
    if (messagingIntegration && (action === 'done' || action === 'snooze')) {
      try {
        let newText;
        if (action === 'done') {
          const task = await messagingIntegration.assistant.completeTaskById(cbUserId, taskId);
          newText = `✅ *Done* — ${task?.action || 'task'}`;
        } else {
          const task = await messagingIntegration.assistant.snoozeTask(cbUserId, taskId, 30);
          newText = `⏰ *Snoozed* — ${task?.action || 'task'} — see you in 30min`;
        }
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
          chat_id: cbChatId,
          message_id: cbMessageId,
          text: newText,
          parse_mode: 'Markdown'
        });
      } catch (err) {
        console.error('Callback action failed:', err.message);
      }
    } else if (action === 'shortcut' && messagingIntegration) {
      const target = parts[2];
      const cbUserId = parts[1];
      if (SHORTCUT_MAP[target]) {
        try {
          const formatted = await messagingIntegration.handleTelegramMessage(SHORTCUT_MAP[target], cbUserId, cbChatId);
          await sendFormattedResponse(messagingIntegration, cbChatId, formatted);
        } catch (err) {
          console.error('Shortcut callback failed:', err.message);
        }
      }
    } else if (action === 'habit_done' && messagingIntegration) {
      const cbUserId = parts[1];
      try {
        const profile = await db.getUserProfile(cbUserId);
        if (profile?.dailyCommitment) {
          await messagingIntegration.assistant.logDailyCommitment(cbUserId, profile.dailyCommitment.minutes);
        }
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
          chat_id: cbChatId,
          message_id: cbMessageId,
          text: '✅ *Habit logged!* Great work — keep that streak going! 🔥',
          parse_mode: 'Markdown'
        });
      } catch (err) {
        console.error('habit_done callback failed:', err.message);
      }
    } else if (action === 'habit_skip') {
      try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
          chat_id: cbChatId,
          message_id: cbMessageId,
          text: '⏭ Skipped today — that\'s okay. Tomorrow, fresh start.',
          parse_mode: 'Markdown'
        });
      } catch (err) {
        console.error('habit_skip callback failed:', err.message);
      }
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // Location share — detect and save timezone
  if (msg.location) {
    try {
      await handleTelegramLocation(userId, chatId, msg.location.latitude, msg.location.longitude);
    } catch (err) {
      console.error('Location handling error:', err.message);
    }
    return;
  }

  if (!msg.text) return;

  try {
    await sendTelegramTyping(chatId);

    if (messagingIntegration) {
      messagingIntegration.assistant.updateProfileMeta(userId, { telegramChatId: chatId })
        .catch(err => console.error('Profile meta update failed:', err.message));

      // Handle slash commands
      const slash = resolveSlashCommand(msg);
      if (slash) {
        if (slash.command === 'start') {
          await messagingIntegration.handleStart(userId, chatId);
          return;
        }
        if (slash.text) {
          const formatted = await messagingIntegration.handleTelegramMessage(slash.text, userId, chatId);
          await sendFormattedResponse(messagingIntegration, chatId, formatted);
          return;
        }
      }

      const text = msg.text;
      const formatted = await messagingIntegration.handleTelegramMessage(text, userId, chatId);
      await sendFormattedResponse(messagingIntegration, chatId, formatted);
    } else {
      const actionData = await processMessage(text);
      const message = actionData.clarification
        ? `I didn't get a task yet. Please tell me something like: "Buy milk tomorrow".`
        : `\n✅ Got it!\n<b>${actionData.action}</b>\n📅 ${actionData.deadline}\n🎯 ${(actionData.priority || 'medium').toUpperCase()}\n💪 ${actionData.motivation}`;
      await sendTelegramMessage(chatId, message);
      if (!actionData.clarification) await syncTask(actionData, userId);
    }
  } catch (error) {
    console.error('Telegram processing error:', error.response?.data || error.message);
  }
});

// Polling fallback for Telegram (if no webhook)
async function telegramPolling() {
  let offset = 0;
  const processedIds = new Set();

  setInterval(async () => {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`,
        { params: { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] } }
      );

      for (const update of response.data.result) {
        if (processedIds.has(update.update_id)) {
          offset = update.update_id + 1;
          continue;
        }
        processedIds.add(update.update_id);
        offset = update.update_id + 1;

        // Handle inline button taps in polling mode
        if (update.callback_query) {
          const { id: callbackId, data, message } = update.callback_query;
          const cbChatId = message.chat.id;
          const cbMessageId = message.message_id;
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackId
          }).catch(() => {});
          const parts = (data || '').split(':');
          const action = parts[0];
          const cbUserId = parts[1];
          const taskId = parts[2];
          if (messagingIntegration && (action === 'done' || action === 'snooze')) {
            try {
              let newText;
              if (action === 'done') {
                const task = await messagingIntegration.assistant.completeTaskById(cbUserId, taskId);
                newText = `✅ *Done* — ${task?.action || 'task'}`;
              } else {
                const task = await messagingIntegration.assistant.snoozeTask(cbUserId, taskId, 30);
                newText = `⏰ *Snoozed* — ${task?.action || 'task'} — see you in 30min`;
              }
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
                chat_id: cbChatId,
                message_id: cbMessageId,
                text: newText,
                parse_mode: 'Markdown'
              });
            } catch (err) {
              console.error('Polling callback action failed:', err.message);
            }
          } else if (action === 'shortcut' && messagingIntegration) {
            const target = parts[2];
            const cbUserId = parts[1];
            if (SHORTCUT_MAP[target]) {
              try {
                const formatted = await messagingIntegration.handleTelegramMessage(SHORTCUT_MAP[target], cbUserId, cbChatId);
                await messagingIntegration.sendToTelegram(formatted.chat_id || cbChatId, formatted.text, {
                  parse_mode: formatted.parse_mode,
                  reply_markup: formatted.reply_markup
                });
              } catch (err) {
                console.error('Shortcut callback failed:', err.message);
              }
            }
          } else if (action === 'habit_done' && messagingIntegration) {
            const cbUserId = parts[1];
            try {
              const profile = await db.getUserProfile(cbUserId);
              if (profile?.dailyCommitment) {
                await messagingIntegration.assistant.logDailyCommitment(cbUserId, profile.dailyCommitment.minutes);
              }
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
                chat_id: cbChatId,
                message_id: cbMessageId,
                text: '✅ *Habit logged!* Great work — keep that streak going! 🔥',
                parse_mode: 'Markdown'
              });
            } catch (err) {
              console.error('habit_done callback failed:', err.message);
            }
          } else if (action === 'habit_skip') {
            try {
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
                chat_id: cbChatId,
                message_id: cbMessageId,
                text: '⏭ Skipped today — that\'s okay. Tomorrow, fresh start.',
                parse_mode: 'Markdown'
              });
            } catch (err) {
              console.error('habit_skip callback failed:', err.message);
            }
          }
          continue;
        }

        const msg = update.message;
        if (!msg) continue;
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        // Location share — detect and save timezone
        if (msg.location) {
          try {
            await handleTelegramLocation(userId, chatId, msg.location.latitude, msg.location.longitude);
          } catch (err) {
            console.error('Polling location handling error:', err.message);
          }
          continue;
        }

        if (msg.text) {
          try {
            await sendTelegramTyping(chatId);
            if (messagingIntegration) {
              messagingIntegration.assistant.updateProfileMeta(userId, { telegramChatId: chatId })
                .catch(err => console.error('Profile meta update failed:', err.message));

              const slash = resolveSlashCommand(msg);
              if (slash) {
                if (slash.command === 'start') {
                  await messagingIntegration.handleStart(userId, chatId);
                  continue;
                }
                if (slash.text) {
                  const formatted = await messagingIntegration.handleTelegramMessage(slash.text, userId, chatId);
                  await sendFormattedResponse(messagingIntegration, chatId, formatted);
                  continue;
                }
              }

              const text = msg.text;
              const formatted = await messagingIntegration.handleTelegramMessage(text, userId, chatId);
              await sendFormattedResponse(messagingIntegration, chatId, formatted);
            } else {
              const actionData = await processMessage(text);
              const message = actionData.clarification
                ? `I didn't get a task yet. Please tell me something like: "Buy milk tomorrow".`
                : `\n✅ Got it!\n<b>${actionData.action}</b>\n📅 ${actionData.deadline}\n🎯 ${(actionData.priority || 'medium').toUpperCase()}\n💪 ${actionData.motivation}`;
              await sendTelegramMessage(chatId, message);
              if (!actionData.clarification) await syncTask(actionData, userId);
            }
          } catch (error) {
            console.error('Polling message error:', error.message);
          }
        }
      }

      // Prevent unbounded memory growth
      if (processedIds.size > 1000) processedIds.clear();
    } catch (error) {
      console.error('Polling error:', error.message);
    }
  }, 3000);
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
let messagingIntegration = null;

// Tracks in-flight OAuth sessions: state token → { userId, chatId }
// Entries expire after 10 minutes
const pendingOAuthStates = new Map();

// Returns a per-user GoogleCalendarSync if the user has linked their account,
// otherwise falls back to the shared server calendar.
async function getCalendarForUser(userId) {
  if (!googleCalendar) return { calendar: null, needsConnect: false };
  if (!userId) return { calendar: googleCalendar, needsConnect: false };

  try {
    const userToken = await db.getGoogleToken(userId);

    console.log(`[DEBUG] getCalendarForUser ${userId}: token=${userToken ? 'found' : 'null'}, refresh_token=${userToken?.refresh_token ? 'yes' : 'no'}`);

    // Load user's timezone preference from their profile
    const userProfile = await db.getUserProfile(userId).catch(() => null);
    const userTimezone = userProfile?.timezone || process.env.USER_TIMEZONE || 'Asia/Singapore';

    // User has their own linked calendar with a valid refresh token
    if (userToken?.refresh_token) {
      const GoogleCalendarSync = require('./google-calendar');
      const userCalendar = new GoogleCalendarSync({
        credentials: googleCalendar.credentials,
        tokenJson: userToken,
        calendarId: 'primary',
        timezone: userTimezone
      });
      await userCalendar.initialize();

      // Persist refreshed access tokens automatically so they don't expire
      userCalendar.auth.on('tokens', async (newTokens) => {
        try {
          const existing = await db.getGoogleToken(userId) || {};
          await db.saveGoogleToken(userId, { ...existing, ...newTokens });
          console.log(`✅ Refreshed Google token saved for user ${userId}`);
        } catch (err) {
          console.error('Failed to persist refreshed token:', err.message);
        }
      });

      return { calendar: userCalendar, needsConnect: false };
    }

    // User linked their account but Google didn't return a refresh_token
    // (happens when app access wasn't revoked before reconnecting).
    // Use the access_token anyway — it lasts ~1 hour. Prompt user to reconnect properly.
    if (userToken?.access_token) {
      console.warn(`⚠️ User ${userId} has no refresh_token — using access_token (expires soon). Ask them to revoke at myaccount.google.com/permissions then "connect google" again.`);
      const GoogleCalendarSync = require('./google-calendar');
      const userCalendar = new GoogleCalendarSync({
        credentials: googleCalendar.credentials,
        tokenJson: userToken,
        calendarId: 'primary',
        timezone: userTimezone
      });
      await userCalendar.initialize();
      return { calendar: userCalendar, needsConnect: false, warnReconnect: true };
    }

    // Fall back to the shared server calendar only if it has a refresh token
    const sharedCreds = googleCalendar.auth?.credentials;
    if (sharedCreds?.refresh_token) {
      return { calendar: googleCalendar, needsConnect: false };
    }

    // No usable calendar — user hasn't connected and shared token has no refresh_token
    console.warn(`⚠️ No Google Calendar for user ${userId} — no token found`);
    return { calendar: null, needsConnect: true };
  } catch (err) {
    console.warn('Could not load per-user calendar:', err.message);
    return { calendar: null, needsConnect: false };
  }
}

// Generates a Google OAuth URL tied to a Telegram userId + chatId.
// The state param lets the callback identify which user authorised.
function generateGoogleAuthUrl(userId, chatId) {
  if (!googleCalendar || !googleCalendar.credentials) return null;

  const state = crypto.randomBytes(16).toString('hex');
  pendingOAuthStates.set(state, { userId, chatId });
  setTimeout(() => pendingOAuthStates.delete(state), 10 * 60 * 1000); // 10-min TTL

  // Build URL manually — the googleapis generateAuthUrl() strips underscores
  // from param names in some versions (access_type → accesstype), breaking OAuth.
  const creds = googleCalendar.credentials.installed || googleCalendar.credentials.web || {};
  const params = new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: creds.redirect_uris[0],
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

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
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        timezone: process.env.USER_TIMEZONE || 'Asia/Singapore'
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

}

async function syncTask(actionData, userId) {
  const promises = [];

  const { calendar, needsConnect, warnReconnect } = await getCalendarForUser(userId);

  if (calendar) {
    const calendarOp = actionData.recurring
      ? calendar.addRecurringEvent(actionData, 30, 30)
      : calendar.addEvent(actionData);
    promises.push(
      calendarOp.catch(err => console.error('Google Calendar sync failed:', err.message))
    );
  }

  if (warnReconnect && userId) {
    const profile = await db.getUserProfile(userId).catch(() => null);
    const chatId = profile?.telegramChatId;
    if (chatId && TELEGRAM_TOKEN) {
      axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: '⚠️ Your Google Calendar link will expire soon.\n\nTo fix it permanently:\n1. Go to myaccount.google.com/permissions and remove this app\n2. Send *"connect google"* here again',
        parse_mode: 'Markdown'
      }).catch(err => console.error('Reconnect warning failed:', err.message));
    }
  } else if (needsConnect && userId) {
    // Let the user know their task was saved but calendar isn't linked yet
    const profile = await db.getUserProfile(userId).catch(() => null);
    const chatId = profile?.telegramChatId;
    if (chatId && TELEGRAM_TOKEN) {
      axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: '📅 *Task saved!* Your Google Calendar isn\'t connected yet.\n\nSend *"connect google"* to link it and sync tasks automatically.',
        parse_mode: 'Markdown'
      }).catch(err => console.error('Calendar nudge failed:', err.message));
    }
  }

  if (appleCalendar) {
    promises.push(
      appleCalendar.addEvent(actionData)
        .catch(err => console.error('Apple Calendar sync failed:', err.message))
    );
  }

  await Promise.all(promises);
}

// ============================================
// STARTUP
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🤖 Assistant running on port ${PORT}`);

  // Initialize integrations
  await initializeIntegrations();

  // Register bot commands with Telegram
  await registerBotCommands();

  // Initialize persistence layer
  await db.initializeDatabase().catch(err =>
    console.warn('⚠️ Database initialization failed (continuing without DB):', err.message)
  );

  // Instantiate the messaging integration that wires assistant features to Slack/Telegram
  try {
    messagingIntegration = new MessagingIntegration({
      openrouterKey: OPENROUTER_KEY,
      openrouterModel: process.env.OPENROUTER_MODEL,
      telegramToken: TELEGRAM_TOKEN,
      calendarSync: googleCalendar,
      onTaskCreated: syncTask,
      onGoogleConnect: generateGoogleAuthUrl
    });
    console.log('✅ Messaging integration initialized');
  } catch (err) {
    console.warn('Could not initialize MessagingIntegration:', err.message || err);
  }
  
  // Hourly cron — morning brief, habit nudge, energy check-in, weekly review
  cron.schedule('0 * * * *', async () => {
    if (!messagingIntegration || !TELEGRAM_TOKEN) return;
    const users = await db.getAllUsersWithTelegram().catch(() => []);
    const now = new Date();

    for (const user of users) {
      if (!user.telegramChatId) continue;
      try {
        const tz = user.timezone || process.env.DAILY_MESSAGE_TIMEZONE || 'Asia/Singapore';
        const localHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
        const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

        // ── Morning briefing ──────────────────────────────────────────────────
        const morningHour = user.morningBriefTime !== undefined ? user.morningBriefTime
          : (user.preferredHour !== undefined ? user.preferredHour : 8);
        if (localHour === morningHour && user.lastMorningBriefDate !== todayKey) {
          const text = await messagingIntegration.assistant.buildDailyMessage(user.userId);
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: user.telegramChatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: messagingIntegration._persistentKeyboard()
          });
          await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastMorningBriefDate: todayKey });
          console.log(`☀️ Morning brief sent to user ${user.userId}`);
        }

        // ── Habit nudge ───────────────────────────────────────────────────────
        const habitHour = user.habitNudgeTime !== undefined ? user.habitNudgeTime : 20;
        const habitLoggedToday = user.commitmentHistory?.[todayKey]?.success;
        if (localHour === habitHour && user.dailyCommitment && !habitLoggedToday
            && user.lastHabitNudgeDate !== todayKey) {
          const streak = user.currentStreak || 0;
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: user.telegramChatId,
            text: `🔔 Hey! Your ${streak}-day streak is on the line.\n\nHave you done your *${user.dailyCommitment.description}* today?\n\nLog it: _"I did it"_ or tap below`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ I did it', callback_data: `habit_done:${user.userId}` },
                { text: '⏭ Skip today', callback_data: `habit_skip:${user.userId}` }
              ]]
            }
          });
          await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastHabitNudgeDate: todayKey });
          console.log(`🔔 Habit nudge sent to user ${user.userId}`);
        }

        // ── Energy check-in ───────────────────────────────────────────────────
        const energyHour = user.energyCheckTime !== undefined ? user.energyCheckTime : 21;
        const energyLoggedToday = (user.energyLog || []).some(e =>
          e.timestamp && e.timestamp.startsWith(todayKey)
        );
        if (localHour === energyHour && !energyLoggedToday
            && user.lastEnergyCheckDate !== todayKey) {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: user.telegramChatId,
            text: '⚡ *How was your energy today?*\n\nReply with a number: 1 (exhausted) → 10 (on fire)',
            parse_mode: 'Markdown',
            reply_markup: messagingIntegration._persistentKeyboard()
          });
          await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastEnergyCheckDate: todayKey });
          console.log(`⚡ Energy check-in sent to user ${user.userId}`);
        }

        // ── Weekly review (Sundays only) ──────────────────────────────────────
        const weeklyHour = user.weeklyReviewTime !== undefined ? user.weeklyReviewTime : 18;
        const isSunday = now.toLocaleString('en-US', { timeZone: tz, weekday: 'long' }) === 'Sunday';
        const hasEnoughData = Object.keys(user.commitmentHistory || {}).length >= 3;
        if (isSunday && localHour === weeklyHour && hasEnoughData
            && user.lastWeeklyReviewDate !== todayKey) {
          const review = await messagingIntegration.assistant.generateWeeklyReview(user.userId);
          const formatted = messagingIntegration._formatTelegramResponse(review, user.telegramChatId);
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: user.telegramChatId,
            text: formatted.text,
            parse_mode: 'Markdown',
            reply_markup: messagingIntegration._persistentKeyboard()
          });
          await messagingIntegration.assistant.updateProfileMeta(user.userId, { lastWeeklyReviewDate: todayKey });
          console.log(`📊 Weekly review sent to user ${user.userId}`);
        }

      } catch (err) {
        console.error(`Scheduled message failed for user ${user.userId}:`, err.message);
      }
    }
  });
  console.log('⏰ Hourly cron active — morning brief, habit nudge, energy check-in, weekly review');

  // Per-minute reminder cron — fires tasks with deadlineMs in the current minute window
  cron.schedule('* * * * *', async () => {
    if (!messagingIntegration || !TELEGRAM_TOKEN) return;
    const users = await db.getAllUsersWithTelegram().catch(() => []);
    const now = Date.now();
    const windowEnd = now + 60000;

    for (const user of users) {
      if (!user.telegramChatId) continue;
      const dueTasks = (user.allTasks || []).filter(t =>
        !t.completed && !t.remindedAt && t.deadlineMs &&
        t.deadlineMs >= now && t.deadlineMs < windowEnd
      );
      for (const task of dueTasks) {
        try {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: user.telegramChatId,
            text: `⏰ *Reminder:* ${task.action}`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Done', callback_data: `done:${user.userId}:${task.id}` },
                { text: '⏰ Snooze 30min', callback_data: `snooze:${user.userId}:${task.id}` }
              ]]
            }
          });
          task.remindedAt = Date.now();
        } catch (err) {
          console.error(`Reminder failed for user ${user.userId}:`, err.message);
        }
      }
      if (dueTasks.length > 0) {
        await db.saveUserProfile(user.userId, user).catch(err =>
          console.error(`Failed to save remindedAt for user ${user.userId}:`, err.message)
        );
      }
    }
  });
  console.log('⏱ Per-minute reminder cron active');

  // Start Telegram polling if webhook not used
  if (!process.env.USE_TELEGRAM_WEBHOOK) {
    console.log('📱 Starting Telegram polling...');
    telegramPolling();
  }
});
