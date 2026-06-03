// slack-telegram-integration.js - Example: Wire friend features to messaging

const FriendlyAssistant = require('./assistant-features');
const axios = require('axios');

class MessagingIntegration {
  constructor(config) {
    this.assistant = new FriendlyAssistant({
      openrouterKey: config.openrouterKey,
      openrouterModel: config.openrouterModel
    });
    this.slackToken = config.slackToken;
    this.telegramToken = config.telegramToken;
    this.calendarSync = config.calendarSync;
    this.onTaskCreated = config.onTaskCreated || null;
    this.onGoogleConnect = config.onGoogleConnect || null;
  }

  // ============================================
  // TELEGRAM MESSAGE HANDLERS
  // ============================================

  async handleTelegramMessage(message, userId, chatId) {
    const intent = await this.assistant.classifyIntent(message);
    console.log(`Intent classified as "${intent}" for message:`, message);

    switch (intent) {
      case 'help':
        return this._formatTelegramResponse(this._helpMessage(), chatId);

      case 'task':
      case 'schedule': {
        const taskData = await this.assistant.parseTask(message);
        if (this.onTaskCreated) {
          await this.onTaskCreated(taskData, userId).catch(err =>
            console.error('Task sync failed:', err.message)
          );
        }
        if (!taskData.action) {
          return { chat_id: chatId, text: 'I need a clearer task. Try something like "Buy milk tomorrow" or "Call dentist on Friday".', parse_mode: 'Markdown' };
        }
        const priorityDot = { high: '🔴', medium: '🟡', low: '🟢' }[taskData.priority] || '🟡';
        const priorityLabel = taskData.priority
          ? taskData.priority.charAt(0).toUpperCase() + taskData.priority.slice(1)
          : 'Medium';
        const recurringLine = taskData.recurring ? '🔁 Recurring daily (30 days)' : null;
        const msg = [
          '✅ *Task saved!*',
          '─────────────────',
          `📌 *${taskData.action}*`,
          `📅 ${taskData.deadline}`,
          recurringLine,
          `${priorityDot} ${priorityLabel} priority`,
          `💬 _${taskData.motivation}_`
        ].filter(Boolean).join('\n');
        return { chat_id: chatId, text: msg, parse_mode: 'Markdown' };
      }

      case 'idea':
        return this._formatTelegramResponse(await this.assistant.deepenIdea(message, userId), chatId);

      case 'commit': {
        const minMatch = message.match(/(\d+)\s*min/i);
        if (minMatch) {
          const minutes = parseInt(minMatch[1]);
          const desc = message.replace(/\d+\s*min(ute)?s?/i, '').trim() || 'daily practice';
          const response = await this.assistant.setDailyCommitment(userId, { minutes, description: desc });
          if (this.calendarSync && response.commitment) {
            this.calendarSync.addRecurringEvent({
              action: `Daily habit: ${response.commitment.description}`,
              deadline: 'tomorrow',
              priority: 'medium',
              motivation: `Daily habit reminder for ${response.commitment.description}`
            }, 30, response.commitment.minutes || 30).catch(err =>
              console.error('Calendar habit event failed:', err.message)
            );
          }
          return this._formatTelegramResponse(response, chatId);
        }
        const numMatch = message.match(/(\d+)/);
        if (numMatch) {
          return this._formatTelegramResponse(
            await this.assistant.logDailyCommitment(userId, parseInt(numMatch[1])), chatId
          );
        }
        return this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
      }

      case 'energy': {
        const numMatch = message.match(/(\d+)/);
        if (numMatch) {
          return this._formatTelegramResponse(
            await this.assistant.logEnergy(userId, parseInt(numMatch[1]), 'user logged'), chatId
          );
        }
        return this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
      }

      case 'review':
        return this._formatTelegramResponse(await this.assistant.generateWeeklyReview(userId), chatId);

      case 'motivation':
        return this._formatTelegramResponse(await this.assistant.getMotivatation(userId, 'default'), chatId);

      case 'pattern':
        return this._formatTelegramResponse(await this.assistant.analyzePatterns(userId), chatId);

      case 'abandoned':
        return this._formatTelegramResponse(await this.assistant.checkAbandonedGoals(userId), chatId);

      case 'connect': {
        if (this.onGoogleConnect) {
          const url = await this.onGoogleConnect(userId, chatId);
          if (url) {
            return {
              chat_id: chatId,
              text: '🗓 *Connect your Google Calendar*\n\nTap the button below to sign in with Google. Once authorised, your tasks will be added to your personal calendar automatically.',
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[
                  { text: '🔗 Sign in with Google', url }
                ]]
              }
            };
          }
        }
        return { chat_id: chatId, text: 'Google Calendar connection is not configured on this server.', parse_mode: 'Markdown' };
      }

      default:
        return this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
    }
  }

  async classifyIntent(message) {
    return this.assistant.classifyIntent(message);
  }

  // ============================================
  // RESPONSE FORMATTING
  // ============================================

  _formatSlackResponse(response) {
    if (typeof response === 'string') {
      return {
        text: response,
        mrkdwn: true
      };
    }

    if (response.enthusiasm) {
      // Idea deepening response
      return {
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*${response.enthusiasm}*` }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Questions to dive deeper:*\n${response.deeper}` }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `💡 *What you might be missing:*\n${response.opportunity}` }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `🚀 *Next step:*\n${response.nextStep}` }
          }
        ]
      };
    }

    if (response.streak !== undefined) {
      // Streak response
      return {
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: response.message }
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Daily Target:*\n${response.todayTarget || 0}min`
              },
              {
                type: 'mrkdwn',
                text: `*Progress:*\n${Math.round((response.progress || 0) * 100)}%`
              }
            ]
          }
        ]
      };
    }

    return {
      text: JSON.stringify(response, null, 2),
      mrkdwn: true
    };
  }

  _formatStreakResponse(response) {
    const streakEmoji = response.currentStreak === 0 ? '⏰' : response.currentStreak < 7 ? '🔥' : '🚀';
    
    return {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${streakEmoji} ${response.currentStreak}-Day Streak`
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Daily Commitment:*\n${response.dailyCommitment?.minutes || 0}min ${response.dailyCommitment?.description || ''}`
            },
            {
              type: 'mrkdwn',
              text: `*Today's Progress:*\n${response.todayProgress}/${response.todayTarget}min`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: response.message
          }
        }
      ]
    };
  }

  _formatGoalResponse(response) {
    return {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: response.goal.title }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: response.coachResponse }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '_Goal ID: ' + response.goalId + '_' }
        }
      ]
    };
  }

  _formatReviewResponse(response) {
    return {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '📊 Weekly Review' }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Completed:*\n${response.stats.completed} tasks` },
            { type: 'mrkdwn', text: `*Streak:*\n${response.stats.streaks} days` },
            { type: 'mrkdwn', text: `*Most Active:*\n${response.stats.mostActiveDay}` },
            { type: 'mrkdwn', text: `*Energy:*\n${response.stats.energyPattern}` }
          ]
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: response.review }
        }
      ]
    };
  }

  _formatPatternResponse(response) {
    return {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🔍 Your Patterns' }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: response.advice }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: { 
            type: 'mrkdwn', 
            text: `*Data:*\n` +
              `Procrastination: ${response.analysis.procrastinationPatterns.join(', ') || 'none'}\n` +
              `At Risk Goals: ${response.analysis.abandonmentRisk} tasks\n` +
              `Active Goals: ${response.analysis.overcommitment.count} (${response.analysis.overcommitment.warning})`
          }
        }
      ]
    };
  }

  _formatAbandonedResponse(reminders) {
    if (reminders.length === 0) {
      return {
        text: '✨ No abandoned goals! You\'re staying consistent!'
      };
    }

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⏰ Gentle Reminders' }
      }
    ];

    reminders.forEach((reminder, i) => {
      blocks.push({
        type: 'section',
        text: { 
          type: 'mrkdwn', 
          text: `*${reminder.task}*\n${reminder.reminder}` 
        }
      });
      if (i < reminders.length - 1) {
        blocks.push({ type: 'divider' });
      }
    });

    return { blocks };
  }

  // Convert common markdown that Telegram doesn't support into Telegram-compatible format
  _toTelegramMarkdown(text) {
    return text
      .replace(/^#{1,3}\s+(.+)$/gm, '*$1*')       // # Heading → *Heading*
      .replace(/\*\*(.+?)\*\*/g, '*$1*')            // **bold** → *bold*
      .replace(/^>\s*(.+)$/gm, '_$1_')              // > quote → _italic_
      .replace(/^[-*]\s+/gm, '• ')                  // - list → • list
      .replace(/^---+$/gm, '─────────────────');    // --- → visual divider
  }

  _formatTelegramResponse(response, chatId) {
    let text;

    if (typeof response === 'string') {
      text = response;
    } else if (response.enthusiasm) {
      text = `✨ *${response.enthusiasm}*\n\n` +
             `🤔 *Dig Deeper:*\n${response.deeper}\n\n` +
             `💡 *Opportunity:*\n${response.opportunity}\n\n` +
             `🚀 *Next Step:*\n${response.nextStep}`;
    } else if (response.message) {
      text = response.message;
    } else if (response.deeper || response.opportunity || response.nextStep || response.enthusiasm) {
      const lines = [];
      if (response.enthusiasm) lines.push(`✨ *${response.enthusiasm}*`);
      if (response.deeper) lines.push(`🤔 *Dig Deeper:*\n${response.deeper}`);
      if (response.opportunity) lines.push(`💡 *Opportunity:*\n${response.opportunity}`);
      if (response.nextStep) lines.push(`🚀 *Next Step:*\n${response.nextStep}`);
      text = lines.join('\n\n');
    } else if (response && typeof response === 'object') {
      text = Object.values(response).filter(Boolean).join('\n\n');
      if (!text) text = JSON.stringify(response);
    } else {
      text = JSON.stringify(response);
    }

    return {
      chat_id: chatId,
      text: this._toTelegramMarkdown(text),
      parse_mode: 'Markdown'
    };
  }

  // ============================================
  // SEND TO SLACK
  // ============================================

  async sendToSlack(channel, blocks) {
    try {
      await axios.post('https://slack.com/api/chat.postMessage', {
        channel: channel,
        ...blocks
      }, {
        headers: {
          'Authorization': `Bearer ${this.slackToken}`
        }
      });
    } catch (error) {
      console.error('Slack send error:', error.message);
    }
  }

  // ============================================
  // SEND TO TELEGRAM
  // ============================================

  async sendToTelegram(chatId, text, options = {}) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${this.telegramToken}/sendMessage`,
        { chat_id: chatId, text, parse_mode: 'Markdown', ...options }
      );
    } catch (error) {
      console.error('Telegram send error:', error.message);
    }
  }

  async sendTelegramTyping(chatId) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${this.telegramToken}/sendChatAction`,
        { chat_id: chatId, action: 'typing' }
      );
    } catch (error) {
      console.error('Telegram typing action error:', error.message);
    }
  }

  _helpMessage() {
    return `Here are some commands I understand:

• Set a daily commitment:
  "Set a daily commitment to 15 min writing"
• Log progress:
  "I completed 15 min"
• Check streaks:
  "Show my streak"
• Find forgotten tasks:
  "Remind me about forgotten goals"
• Get a review:
  "Give me a weekly review"
• Schedule something:
  "Schedule a meeting tomorrow at 3pm"
• Ask for help again:
  "Help" or "What can I say?"`
  }
}

module.exports = MessagingIntegration;

// ============================================
// USAGE EXAMPLES IN BACKEND
// ============================================

/*
const MessagingIntegration = require('./slack-telegram-integration');

const integration = new MessagingIntegration({
  openrouterKey: process.env.OPENROUTER_API_KEY,
  slackToken: process.env.SLACK_BOT_TOKEN,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN
});

// In your Slack handler:
app.post('/slack/command', async (req, res) => {
  const { command, text, user_id, channel_id } = req.body;
  
  res.send(''); // Acknowledge immediately
  
  const response = await integration.handleSlackCommand(command, text, user_id);
  await integration.sendToSlack(channel_id, response);
});

// In your Telegram handler:
app.post('/telegram/webhook', async (req, res) => {
  const update = req.body;
  const message = update.message;
  
  if (message?.text) {
    const response = await integration.handleTelegramMessage(
      message.text,
      message.from.id,
      message.chat.id
    );
    await integration.sendToTelegram(message.chat.id, response.text);
  }
  
  res.send('OK');
});
*/
