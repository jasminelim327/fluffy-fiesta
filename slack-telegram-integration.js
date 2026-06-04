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
      '❓ Help': 'help',
      // Shortcut callback strings — bypass LLM for these too
      'show my patterns': 'pattern',
      'check abandoned goals': 'abandoned'
    };
    return map[text] || null;
  }

  _maybeAddTimezonePrompt(profile) {
    if (profile.timezone || profile.askedTimezone) return null;
    return '\n\n📍 _Tip: share your location so I can send reminders at the right time for you. Tap the 📎 icon → Location._';
  }

  async _appendDailySnapshot(response, userId) {
    try {
      const profile = await this.assistant._getOrCreateProfile(userId);
      const tz = profile.timezone || 'UTC';
      const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      if (profile.lastSnapshotDate === todayKey) return response;
      const snapshot = this.assistant._buildDailySnapshot(profile);
      if (response && typeof response.text === 'string') {
        await this.assistant.updateProfileMeta(userId, { lastSnapshotDate: todayKey });
        return { ...response, text: response.text + '\n\n' + snapshot };
      }
    } catch (err) {
      console.error('Daily snapshot failed:', err.message);
    }
    return response;
  }

  // ============================================
  // TELEGRAM MESSAGE HANDLERS
  // ============================================

  async handleTelegramMessage(message, userId, chatId) {
    // Handle onboarding habit capture
    const profile = await this.assistant._getOrCreateProfile(userId);
    if (profile.onboardingStep === 'awaiting_habit' && !this._resolveKeyboardShortcut(message)) {
      return this._handleOnboardingReply(message, userId, chatId);
    }

    const welcome = await this.assistant.getWelcomeIfNew(userId);
    if (welcome) {
      await this.sendToTelegram(chatId, welcome).catch(err =>
        console.error('Welcome message failed:', err.message)
      );
    }

    const shortcutIntent = this._resolveKeyboardShortcut(message);
    const intent = shortcutIntent || await this.assistant.classifyIntent(message);
    console.log(`Intent classified as "${intent}" for message:`, message);

    let response;
    switch (intent) {
      case 'help':
        response = this._formatTelegramResponse(this._helpMessage(), chatId);
        break;

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
          response = { chat_id: chatId, text: 'I need a clearer task. Try something like "Buy milk tomorrow" or "Call dentist on Friday".', parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
          break;
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
        // Append habit nudge if habit not logged today
        const todayKey = new Intl.DateTimeFormat('en-CA', {
          timeZone: profile.timezone || 'UTC'
        }).format(new Date());
        const habitLoggedToday = profile.commitmentHistory?.[todayKey]?.success;
        let taskText = msg;
        if (profile.dailyCommitment && !habitLoggedToday) {
          taskText += `\n\n💬 _Don't forget your ${profile.dailyCommitment.minutes}min ${profile.dailyCommitment.description} today — you're on a ${profile.currentStreak || 0}-day streak!_`;
        }
        const tzPrompt = this._maybeAddTimezonePrompt(profile);
        if (tzPrompt) {
          taskText += tzPrompt;
          this.assistant.updateProfileMeta(userId, { askedTimezone: true }).catch(() => {});
        }
        response = { chat_id: chatId, text: taskText, parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
        break;
      }

      case 'idea':
        response = this._formatTelegramResponse(await this.assistant.deepenIdea(message, userId), chatId);
        break;

      case 'commit': {
        const minMatch = message.match(/(\d+)\s*min/i);
        if (minMatch || /set|track|commit|habit|daily/i.test(message)) {
          const { minutes, description: desc } = this.assistant._extractHabitFromMessage(message);
          const commitResponse = await this.assistant.setDailyCommitment(userId, { minutes, description: desc });
          if (this.calendarSync && commitResponse.commitment) {
            this.calendarSync.addRecurringEvent({
              action: `Daily habit: ${commitResponse.commitment.description}`,
              deadline: 'tomorrow',
              priority: 'medium',
              motivation: `Daily habit reminder for ${commitResponse.commitment.description}`
            }, 30, commitResponse.commitment.minutes || 30).catch(err =>
              console.error('Calendar habit event failed:', err.message)
            );
          }
          response = this._formatTelegramResponse(commitResponse, chatId);
          break;
        }
        const numMatch2 = message.match(/(\d+)/);
        if (numMatch2) {
          response = this._formatTelegramResponse(
            await this.assistant.logDailyCommitment(userId, parseInt(numMatch2[1])), chatId
          );
          break;
        }
        response = this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
        break;
      }

      case 'energy': {
        const numMatch = message.match(/(\d+)/);
        if (numMatch) {
          response = this._formatTelegramResponse(
            await this.assistant.logEnergy(userId, parseInt(numMatch[1]), 'user logged'), chatId
          );
          const energyLevel = parseInt(numMatch[1]);
          if (energyLevel <= 4) {
            response.followUpButtons = [[
              { text: '💪 Motivate Me', callback_data: `shortcut:${userId}:motivation` },
              { text: '📋 My Tasks', callback_data: `shortcut:${userId}:list` }
            ]];
          }
          break;
        }
        response = {
          chat_id: chatId,
          text: '⚡ How\'s your energy today?\n\nReply with a number: *1* (exhausted) → *10* (on fire)',
          parse_mode: 'Markdown',
          reply_markup: this._persistentKeyboard()
        };
        break;
      }

      case 'review':
        response = this._formatTelegramResponse(await this.assistant.generateWeeklyReview(userId), chatId);
        response.followUpButtons = [[
          { text: '📊 See Patterns', callback_data: `shortcut:${userId}:patterns` },
          { text: '🎯 Revisit Goals', callback_data: `shortcut:${userId}:goals` }
        ]];
        break;

      case 'motivation':
        response = this._formatTelegramResponse(await this.assistant.getMotivatation(userId, 'default'), chatId);
        break;

      case 'pattern':
        response = this._formatTelegramResponse(await this.assistant.analyzePatterns(userId), chatId);
        break;

      case 'abandoned':
        response = this._formatTelegramResponse(await this.assistant.checkAbandonedGoals(userId), chatId);
        break;

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
        return { chat_id: chatId, text: 'Google Calendar connection is not configured on this server.', parse_mode: 'Markdown', reply_markup: this._persistentKeyboard() };
      }

      case 'question':
        response = this._formatTelegramResponse(await this.assistant.answerQuestion(message, userId), chatId);
        break;

      case 'list': {
        const listText = await this.assistant.listTasks(userId);
        const openTasks = (profile.allTasks || []).filter(t => !t.completed);
        if (openTasks.length > 0) {
          response = {
            chat_id: chatId,
            text: this._toTelegramMarkdown(listText),
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: openTasks.slice(0, 8).map(t => [{
                text: `✅ ${t.action.slice(0, 40)}`,
                callback_data: `done:${userId}:${t.id}`
              }])
            }
          };
        } else {
          response = this._formatTelegramResponse(listText, chatId);
        }
        break;
      }

      case 'complete':
        response = this._formatTelegramResponse(await this.assistant.completeTask(userId, message), chatId);
        response.followUpButtons = [[
          { text: '📋 Remaining Tasks', callback_data: `shortcut:${userId}:list` },
          { text: '🔥 My Streak', callback_data: `shortcut:${userId}:streak` }
        ]];
        break;

      case 'delete':
        response = this._formatTelegramResponse(await this.assistant.deleteTask(userId, message), chatId);
        break;

      case 'streak':
        response = this._formatTelegramResponse(await this.assistant.formatStreakMessage(userId), chatId);
        break;

      case 'dailyconfig':
        response = this._formatTelegramResponse(await this.assistant.setDailyMessageTime(userId, message), chatId);
        break;

      default:
        response = this._formatTelegramResponse(await this.assistant.answerDirectly(message, userId), chatId);
    }

    return this._appendDailySnapshot(response, userId);
  }

  async handleStart(userId, chatId) {
    const profile = await this.assistant._getOrCreateProfile(userId);

    if (profile.welcomed && profile.onboardingStep !== 'awaiting_habit') {
      // Returning user — short re-orientation
      const streak = profile.currentStreak || 0;
      const commitment = profile.dailyCommitment;
      const openTasks = (profile.allTasks || []).filter(t => !t.completed).length;
      const lines = [
        '👋 *Welcome back!* You\'re all set up.',
        '',
        `🔥 Streak: ${streak} day(s)  |  📌 Open tasks: ${openTasks}`
      ];
      if (commitment) lines.push(`🎯 Daily habit: ${commitment.minutes}min ${commitment.description}`);
      lines.push('', 'Use the buttons below or just type naturally. /help to see everything.');
      await this.sendToTelegram(chatId, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: this._persistentKeyboard()
      });
      return;
    }

    // New user — 2-message onboarding
    await this.sendToTelegram(chatId,
      '👋 *Hey! I\'m your personal productivity companion.*\n\n' +
      'Here\'s what I do:\n' +
      '• 📌 Remember your tasks and remind you before deadlines\n' +
      '• 🔥 Track your daily habits and keep your streak alive\n' +
      '• 💪 Motivate you and help you reflect on your progress\n\n' +
      'Let\'s get you set up in 30 seconds.',
      { parse_mode: 'Markdown' }
    );

    await this.sendToTelegram(chatId,
      '*What\'s one thing you want to do every day?*\n\n' +
      'For example:\n' +
      '• 15 min reading\n' +
      '• 30 min workout\n' +
      '• 10 min journaling\n\n' +
      'Just type it below 👇',
      { parse_mode: 'Markdown' }
    );

    await this.assistant.updateProfileMeta(userId, { welcomed: true, onboardingStep: 'awaiting_habit' });
  }

  async _handleOnboardingReply(message, userId, chatId) {
    const { minutes, description } = this.assistant._extractHabitFromMessage(message);
    await this.assistant.setDailyCommitment(userId, { minutes, description });
    await this.assistant.updateProfileMeta(userId, { onboardingStep: 'none' });
    const habitDisplay = minutes === 10 && !message.match(/10/) ? description : `${minutes}min ${description}`;
    return {
      chat_id: chatId,
      text: `🔥 *Done! I'll track your ${habitDisplay} streak every day.*\n\nYou're all set. Just type naturally — or use the buttons below.\nType /help anytime to see what I can do.`,
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
    };
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
      parse_mode: 'Markdown',
      reply_markup: this._persistentKeyboard()
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
• "15 min reading every day" _(set a habit)_
• "I did 20 min" _(log progress)_
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

💪 *Motivation* — tap the button below or say "Motivate me"

📅 *Google Calendar* — /connect to link your calendar

─────────────────
*Slash commands:*
/tasks · /streak · /review · /patterns
/motivation · /energy · /goals · /connect

Or just type naturally — the buttons below are shortcuts too!`
  }
}

module.exports = MessagingIntegration;

