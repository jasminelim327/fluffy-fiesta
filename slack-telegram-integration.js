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
  }

  // ============================================
  // TELEGRAM MESSAGE HANDLERS
  // ============================================

  async handleTelegramMessage(message, userId, chatId) {
    let response;
    const text = message.toLowerCase();

    // Parse intent from casual message
    if (text.includes('deepen') || text.includes('idea')) {
      response = await this.assistant.deepenIdea(message, userId);
      return this._formatTelegramResponse(response, chatId);
    }

    if (text.includes('schedule') || text.includes('calendar') || text.includes('meeting') || text.includes('appointment')) {
      response = await this.assistant.scheduleEvent(message, userId);
      return this._formatTelegramResponse(response, chatId);
    }

    if (text.includes('commit') || text.includes('goal')) {
      // Extract: "15 min writing" or "30min coding"
      const match = message.match(/(\d+)\s*(min|minute)/i);
      if (match) {
        const minutes = parseInt(match[1]);
        const desc = message.replace(/\d+\s*min(ute)?/i, '').trim();
        response = await this.assistant.setDailyCommitment(userId, {
          minutes,
          description: desc || 'daily practice'
        });
        return this._formatTelegramResponse(response, chatId);
      }
    }

    if (text.includes('did') || text.includes('completed')) {
      // Extract: "did 45 min" or "completed 30 minutes"
      const match = message.match(/(\d+)\s*(min|minute)/i);
      if (match) {
        response = await this.assistant.logDailyCommitment(userId, parseInt(match[1]));
        return this._formatTelegramResponse(response, chatId);
      }
    }

    if (text.includes('energy') || text.includes('how are you feeling')) {
      // "energy 7 morning" or "feeling great"
      const match = message.match(/(\d+)/);
      if (match) {
        response = await this.assistant.logEnergy(userId, parseInt(match[1]), 'user logged');
        return this._formatTelegramResponse(response, chatId);
      }
    }

    if (text.includes('review') || text.includes('week')) {
      response = await this.assistant.generateWeeklyReview(userId);
      return this._formatTelegramResponse(response, chatId);
    }

    if (text.includes('motivate') || text.includes('stuck') || text.includes('procrastinating')) {
      response = await this.assistant.getMotivatation(userId, 'default');
      return this._formatTelegramResponse(response, chatId);
    }

    if (text.includes('pattern') || text.includes('how do i work')) {
      response = await this.assistant.analyzePatterns(userId);
      return this._formatTelegramResponse(response, chatId);
    }

    if (text.includes('forgot') || text.includes('abandoned')) {
      response = await this.assistant.checkAbandonedGoals(userId);
      return this._formatTelegramResponse(response, chatId);
    }

    if (text.includes('schedule') || text.includes('calendar') || text.includes('appointment') || text.includes('meeting') || text.includes('remind')) {
      response = await this.assistant.scheduleEvent(message, userId);
      console.log('MessagingIntegration assistant schedule response:', response);
      return this._formatTelegramResponse(response, chatId);
    }

    // Default: answer directly instead of just deepening the idea
    response = await this.assistant.answerDirectly(message, userId);
    console.log('MessagingIntegration assistant response:', response);
    return this._formatTelegramResponse(response, chatId);
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
      text: text,
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

  async sendToTelegram(chatId, text) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${this.telegramToken}/sendMessage`,
        { chat_id: chatId, text, parse_mode: 'Markdown' }
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
