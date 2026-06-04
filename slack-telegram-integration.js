// telegram-integration.js - Telegram messaging integration

const FriendlyAssistant = require('./assistant-features');
const axios = require('axios');

class MessagingIntegration {
  constructor(config) {
    this.assistant = new FriendlyAssistant({
      openrouterKey: config.openrouterKey,
      openrouterModel: config.openrouterModel
    });
    this.telegramToken = config.telegramToken;
    this.calendarSync = config.calendarSync;
    this.onTaskCreated = config.onTaskCreated || null;
    this.onGoogleConnect = config.onGoogleConnect || null;
  }

  _persistentKeyboard() {
    return {
      keyboard: [
        [{ text: '📋 My Tasks' }, { text: '🔥 My Streak' }, { text: '💪 Motivate Me' }],
        [{ text: '📊 Patterns' }, { text: '📅 Weekly Review' }, { text: '❓ Help' }]
      ],
      resize_keyboard: true,
      persistent: true
    };
  }

  _resolveKeyboardShortcut(text) {
    const map = {
      '📋 My Tasks': 'list',
      '🔥 My Streak': 'streak',
      '💪 Motivate Me': 'motivation',
      '📊 Patterns': 'pattern',
      '📅 Weekly Review': 'review',
      '❓ Help': 'help'
    };
    return map[text] || null;
  }

  // ============================================
  // TELEGRAM MESSAGE HANDLERS
  // ============================================

  async handleTelegramMessage(message, userId, chatId) {
    const welcome = await this.assistant.getWelcomeIfNew(userId);
    if (welcome) {
      await this.sendToTelegram(chatId, welcome).catch(err =>
        console.error('Welcome message failed:', err.message)
      );
    }

    const intent = await this.assistant.classifyIntent(message);
    console.log(`Intent classified as "${intent}" for message:`, message);

    switch (intent) {
      case 'help':
        return this._formatTelegramResponse(this._helpMessage(), chatId);

      case 'task':
      case 'schedule': {
        const taskData = await this.assistant.parseTask(message);
        await this.assistant.saveTask(userId, taskData).catch(err =>
          console.error('Task save failed:', err.message)
        );
        if (this.onTaskCreated) {
          await this.onTaskCreated(taskData, userId).catch(err =>
            console.error('Task sync failed:', err.message)
          );
        }
        if (!taskData.action) {
          return { chat_id: chatId, text: 'I need a clearer task. Try something like "Buy milk tomorrow" or "Call dentist on Friday".', parse_mode: 'Markdown' };
        }
        const recurringLine = taskData.recurring ? '🔁 Recurring daily (30 days)' : null;
        const msg = [
          '✅ *Task saved!*',
          '─────────────────',
          `📌 *${taskData.action}*`,
          `📅 ${taskData.deadline}`,
          recurringLine,
          '',
          `💬 _${taskData.motivation}_`
        ].filter(line => line !== null).join('\n');
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

      case 'question':
        return this._formatTelegramResponse(await this.assistant.answerQuestion(message, userId), chatId);

      case 'list':
        return this._formatTelegramResponse(await this.assistant.listTasks(userId), chatId);

      case 'complete':
        return this._formatTelegramResponse(await this.assistant.completeTask(userId, message), chatId);

      case 'delete':
        return this._formatTelegramResponse(await this.assistant.deleteTask(userId, message), chatId);

      case 'streak':
        return this._formatTelegramResponse(await this.assistant.formatStreakMessage(userId), chatId);

      case 'dailyconfig':
        return this._formatTelegramResponse(await this.assistant.setDailyMessageTime(userId, message), chatId);

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
    return `*Here's what I can do for you:*
─────────────────
📌 *Tasks & Reminders*
• "Buy milk tomorrow"
• "Call dentist on Friday at 3pm"
• "Recurring reminder at 10am to drink water"

🔥 *Daily Habits*
• "Set a daily commitment to 15 min reading"
• "I completed 20 min" _(log progress)_
• "Show my streak"

❓ *Ask Me Anything*
• "Give me a pasta recipe"
• "How do I improve my sleep?"
• "What are my tasks today?"

📊 *Tracking & Insights*
• "Energy 7" _(log your energy level 1–10)_
• "Show my patterns"
• "Give me a weekly review"
• "Remind me about forgotten goals"

💪 *Motivation*
• "Motivate me"

📅 *Google Calendar*
• "Connect Google" _(link your calendar)_

─────────────────
Just type naturally — no commands needed!`
  }
}

module.exports = MessagingIntegration;

