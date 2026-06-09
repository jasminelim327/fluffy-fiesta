// telegram-integration.js - Telegram messaging integration

const FriendlyAssistant = require('./assistant-features');
const axios = require('axios');

class MessagingIntegration {
  constructor(config) {
    this.assistant = new FriendlyAssistant({
      openrouterKey: config.openrouterKey,
      openrouterModel: config.openrouterModel,
      googleCredentials: config.googleCredentials || null
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
      const calEvents = await this.assistant.getTodayCalendarEvents(userId);
      const snapshot = this.assistant._buildDailySnapshot(profile, calEvents);
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
    if (profile.goalDraft?.step && !this._resolveKeyboardShortcut(message)) {
      return this._handleGoalDraft(message, userId, chatId, profile);
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
          const habitStr = this.assistant._formatHabit(profile.dailyCommitment);
          taskText += `\n\n💬 _Don't forget your ${habitStr} today — you're on a ${profile.currentStreak || 0}-day streak!_`;
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
        const isLogging = /\b(completed?|did|done|logged?|finished?|i did|i do)\b/i.test(message);
        const numOnly = message.match(/^(\d+)$/);
        if (isLogging || numOnly) {
          // Logging progress: "I completed 20 min", "done 30 min", "45"
          const numMatch2 = message.match(/(\d+)/);
          if (numMatch2) {
            response = this._formatTelegramResponse(
              await this.assistant.logDailyCommitment(userId, parseInt(numMatch2[1])), chatId
            );
            break;
          }
        }
        // Setting a habit: "15 min reading", "30 pushups", "meditation daily"
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

      case 'energy': {
        const numMatch = message.match(/(\d+)/);
        if (numMatch) {
          const energyLevel = parseInt(numMatch[1]);
          const energyText = await this.assistant.logEnergy(userId, energyLevel, 'user logged');
          response = this._formatTelegramResponse(energyText, chatId);
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
        const isTodayQuery = /\btoday\b/i.test(message);
        const listText = isTodayQuery
          ? await this.assistant.listTodayTasks(userId)
          : await this.assistant.listTasks(userId);
        const openTasks = (profile.allTasks || []).filter(t => {
          if (t.completed) return false;
          if (isTodayQuery) {
            const now = Date.now();
            const in24h = now + 24 * 60 * 60 * 1000;
            const tz = profile.timezone || 'UTC';
            const todayFormatted = new Date().toLocaleDateString('en-US', {
              timeZone: tz, weekday: 'short', month: 'short', day: 'numeric'
            });
            if (t.deadlineMs) return t.deadlineMs >= now && t.deadlineMs < in24h;
            return t.deadline === 'today' || t.deadline === todayFormatted;
          }
          return true;
        });
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const sortedTasks = [...openTasks].sort((a, b) =>
          (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
        );
        const calEvents = await this.assistant.getTodayCalendarEvents(userId);
        const taskButtons = sortedTasks.slice(0, 6).map(t => [
          { text: `✅ ${t.action.slice(0, 28)}`, callback_data: `done:${userId}:${t.id}` },
          { text: '⏰ Snooze', callback_data: `snooze:${userId}:${t.id}` }
        ]);
        // Cache event IDs in profile — callback_data is limited to 64 bytes
        // so we use the index instead of the full Google Calendar event ID
        if (calEvents.length > 0) {
          this.assistant.updateProfileMeta(userId, {
            calEventCache: calEvents.slice(0, 4).map(e => e.id)
          }).catch(() => {});
        }
        const calButtons = calEvents.slice(0, 4).map((e, i) => [{
          text: `✅ ${(e.title || 'Event').slice(0, 40)}`,
          callback_data: `cal_done:${userId}:${i}`
        }]);
        const allButtons = [...taskButtons, ...calButtons];
        if (allButtons.length > 0) {
          response = {
            chat_id: chatId,
            text: this._toTelegramMarkdown(listText),
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: allButtons }
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

      case 'edit':
        response = this._formatTelegramResponse(await this.assistant.editTask(userId, message), chatId);
        break;

      case 'stats':
        response = this._formatTelegramResponse(await this.assistant.getStats(userId), chatId);
        break;

      case 'settings':
        response = this._formatTelegramResponse(await this.assistant.showSettings(userId), chatId);
        break;

      case 'timezone': {
        const tzMatch = message.match(/(?:timezone is|timezone|location is|location|i'?m in|i am in)\s+(.+)/i);
        const tzInput = tzMatch ? tzMatch[1].trim() : message.trim();
        response = this._formatTelegramResponse(await this.assistant.setTimezoneByName(userId, tzInput), chatId);
        break;
      }

      case 'peakhours':
        response = this._formatTelegramResponse(await this.assistant.getOptimalWorkSchedule(userId), chatId);
        break;

      case 'insight':
        response = this._formatTelegramResponse(await this.assistant.getPersonalInsight(userId), chatId);
        break;

      case 'longterm': {
        const goals = (profile.longTermGoals || []).filter(g => g.status === 'active');
        if (goals.length === 0) {
          // No goals — start creation flow
          await this.assistant.updateProfileMeta(userId, {
            goalDraft: { step: 'awaiting_title', title: null, why: null, timeline: null, proposedMilestones: [] }
          });
          response = {
            chat_id: chatId,
            text: '🎯 *Let\'s set a big goal.*\n\nWhat\'s the goal? Just the name — keep it short.\n\nFor example:\n• "Build a SaaS product"\n• "Run a marathon"\n• "Write a book"',
            parse_mode: 'Markdown',
            reply_markup: this._persistentKeyboard()
          };
        } else {
          const listText = await this.assistant.listLongTermGoals(userId);
          const buttons = goals.map(g => [{
            text: `📍 ${g.title.slice(0, 35)}`,
            callback_data: `goal_view:${userId}:${g.id}`
          }]);
          buttons.push([{ text: '➕ Add new goal', callback_data: `longterm_new:${userId}` }]);
          response = {
            chat_id: chatId,
            text: this._toTelegramMarkdown(listText),
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
          };
        }
        break;
      }

      case 'milestonedone':
        response = this._formatTelegramResponse(
          await this.assistant.markMilestoneByText(userId, message), chatId
        );
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

  async _handleGoalDraft(message, userId, chatId, profile) {
    const draft = profile.goalDraft;

    // Allow cancellation at any step
    if (/^(cancel|stop|restart|start over|never mind|abort)\b/i.test(message.trim())) {
      await this.assistant.updateProfileMeta(userId, { goalDraft: null });
      return this._formatTelegramResponse(
        'Goal draft cancelled. Say _"I want to..."_ whenever you\'re ready to set a big goal.',
        chatId
      );
    }

    if (draft.step === 'awaiting_title') {
      const title = message.trim();
      await this.assistant.updateProfileMeta(userId, {
        goalDraft: { step: 'awaiting_why', title, why: null, timeline: null, proposedMilestones: [] }
      });
      return {
        chat_id: chatId,
        text: `✨ *${title}* — love it.\n\nWhy does this matter to you? What's the real reason behind it?`,
        parse_mode: 'Markdown',
        reply_markup: this._persistentKeyboard()
      };
    }

    if (draft.step === 'awaiting_why') {
      const why = message.trim();
      await this.assistant.updateProfileMeta(userId, {
        goalDraft: { ...draft, step: 'awaiting_timeline', why }
      });
      return {
        chat_id: chatId,
        text: 'Got it. How long are you giving yourself?\n\nFor example: _"3 months"_, _"by December"_, _"6 months"_',
        parse_mode: 'Markdown',
        reply_markup: this._persistentKeyboard()
      };
    }

    if (draft.step === 'awaiting_timeline') {
      const timeline = message.trim();
      const milestones = await this.assistant._generateMilestones(draft.title, draft.why, timeline);
      await this.assistant.updateProfileMeta(userId, {
        goalDraft: { ...draft, step: 'confirming_milestones', timeline, proposedMilestones: milestones }
      });
      const list = milestones.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
      return {
        chat_id: chatId,
        text: `📍 *Here's a milestone plan for ${draft.title}:*\n\n${list}\n\nDoes this look right? Say *"yes"* to save, or tell me what to change.`,
        parse_mode: 'Markdown',
        reply_markup: this._persistentKeyboard()
      };
    }

    if (draft.step === 'confirming_milestones') {
      const confirmed = /^(yes|yep|yeah|looks good|perfect|great|ok|okay|sure|save|that('s| is) (good|right|perfect))/i.test(message.trim());
      if (confirmed) {
        const result = await this.assistant.createLongTermGoal(userId, {
          title: draft.title,
          why: draft.why,
          timeline: draft.timeline,
          milestones: draft.proposedMilestones
        });
        await this.assistant.updateProfileMeta(userId, { goalDraft: null });
        return {
          chat_id: chatId,
          text: result.coachResponse,
          parse_mode: 'Markdown',
          reply_markup: this._persistentKeyboard()
        };
      }
      // Revision requested
      const updated = await this.assistant._reviseMilestones(draft.proposedMilestones, message);
      await this.assistant.updateProfileMeta(userId, {
        goalDraft: { ...draft, proposedMilestones: updated }
      });
      const list = updated.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
      return {
        chat_id: chatId,
        text: `📍 *Updated plan:*\n\n${list}\n\nDoes this look right? Say *"yes"* to save.`,
        parse_mode: 'Markdown',
        reply_markup: this._persistentKeyboard()
      };
    }

    // Unknown step — clear draft
    await this.assistant.updateProfileMeta(userId, { goalDraft: null });
    return this._formatTelegramResponse('Something went wrong with your goal draft. Let\'s start fresh — say "I want to..." to begin.', chatId);
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

  _splitMessage(text, limit = 4000) {
    if (text.length <= limit) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > limit) {
      // Split at last newline before limit to avoid cutting mid-sentence
      let cut = remaining.lastIndexOf('\n', limit);
      if (cut < limit * 0.5) cut = limit; // no good newline — hard cut
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  async sendToTelegram(chatId, text, options = {}) {
    const chunks = this._splitMessage(text || '');
    // Send all chunks except last without reply_markup; last chunk gets the keyboard
    for (let i = 0; i < chunks.length - 1; i++) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${this.telegramToken}/sendMessage`,
          { chat_id: chatId, text: chunks[i], parse_mode: 'Markdown' }
        );
      } catch { /* best-effort — continue to next chunk */ }
    }
    text = chunks[chunks.length - 1];
    try {
      await axios.post(
        `https://api.telegram.org/bot${this.telegramToken}/sendMessage`,
        { chat_id: chatId, text, parse_mode: 'Markdown', ...options }
      );
    } catch (error) {
      // Telegram rejects bad Markdown — retry as plain text so message is never silently dropped
      const desc = error.response?.data?.description || '';
      if (error.response?.status === 400 && (desc.includes('parse entities') || desc.includes('markup') || desc.includes('BUTTON_DATA_INVALID'))) {
        try {
          // Retry without parse_mode and without reply_markup
          await axios.post(
            `https://api.telegram.org/bot${this.telegramToken}/sendMessage`,
            { chat_id: chatId, text: text.replace(/[*_`[\]]/g, '') }
          );
        } catch (fallbackErr) {
          console.error('Telegram send fallback error:', fallbackErr.message);
        }
      } else {
        console.error('Telegram send error:', error.response?.status, desc || error.message);
      }
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
• "Call dentist Friday at 3pm"
• "Recurring reminder at 10am to drink water"
• "Reschedule dentist to next Monday" _(edit a task)_

🔥 *Daily Habits*
• "15 min reading every day" _(set a habit)_
• "30 pushups daily" _(non-time habits work too)_
• "I did it" _(log progress)_

💡 *Ideas*
• "I have an idea for a side project…" _(I'll help you think it through)_

📊 *Tracking & Insights*
• "Energy 7" _(log your energy 1–10)_
• "Show my patterns"
• "Give me a weekly review"
• "My peak hours" _(best time to work based on your energy)_
• "Personal insight" _(deep AI coaching on how you work)_
• "My stats" _(tasks, streak, energy averages)_
• "Remind me about forgotten goals"

⚙️ *Settings*
• "My settings" _(view habit, timezone, cron times)_
• "Morning brief at 7am" · "Habit nudge off"

💪 *Motivation* — tap the button or say "Motivate me"
📅 *Google Calendar* — /connect

─────────────────
*Slash commands:*
/tasks · /streak · /stats · /insights
/review · /patterns · /motivation · /energy
/goals · /settings · /coach · /connect

Just type naturally — buttons below are shortcuts too!`
  }
}

module.exports = MessagingIntegration;

