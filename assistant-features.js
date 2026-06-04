// assistant-features.js - Advanced Friend-Like Features
// Enhanced personal assistant that deeply engages with your goals

const axios = require('axios');
const db = require('./db');
const chrono = require('chrono-node');
const GoogleCalendarSync = require('./google-calendar');

class FriendlyAssistant {
  constructor(config) {
    this.openrouterKey = config.openrouterKey;
    this.openrouterModel = config.openrouterModel || process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
    this.openrouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.googleCredentials = config.googleCredentials || null;
    this.userProfiles = new Map(); // In-memory; use DB in production
    this.conversationHistory = new Map(); // Keep context for each user
  }

  _getConversationHistory(userId) {
    return this.conversationHistory.get(userId) || [];
  }

  _addConversationEntry(userId, role, content) {
    if (!this.conversationHistory.has(userId)) {
      this.conversationHistory.set(userId, []);
    }

    const history = this.conversationHistory.get(userId);
    history.push({ role, content });

    if (history.length > 10) {
      history.shift();
    }
  }

  // ============================================
  // 1. IDEA DEEPENING - Push them further
  // ============================================

  async deepenIdea(userMessage, userId) {
    const systemPrompt = `You are an enthusiastic friend who helps people dive deeper into their ideas.
Your job is to:
1. Listen to their initial idea
2. Ask probing questions that make them think bigger but also more clearly about their vision
3. Point out hidden opportunities they haven't considered
4. Encourage exploration of the idea's potential
5. Challenge them to think about next steps
6.  Be informative and inspiring, not vague or generic.

Be conversational, warm, and genuinely curious. Not corporate. Like texting a best friend who believes in them.

Format your response as:
ENTHUSIASM: [one excited sentence about the idea]
DEEPER: [2-3 questions that make them think]
OPPORTUNITY: [one thing they might be missing]
NEXT_STEP: [what they could explore next]`;

    const response = await this._callOpenRouter(userMessage, systemPrompt);
    return this._parseAdvancedResponse(response);
  }

  async scheduleEvent(userMessage, userId) {
    const systemPrompt = `You are a practical scheduling assistant. When a user asks to schedule something, respond with a clear plan for their calendar.
- If the request includes the date/time, summarize the event details and confirm the appointment.
- If details are missing, ask one direct question only.
- If the user message is a follow-up like "yes please" or "sure", infer the task from the prior conversation context.
- Do not ask vague or open-ended questions.
- Always be concise and action-oriented.`;

    const response = await this._callOpenRouter(userMessage, systemPrompt, userId);
    return response;
  }

  async answerQuestion(message, userId) {
    const profile = await this._getOrCreateProfile(userId);
    const profileSummary = this._buildProfileSummary(profile);
    const systemPrompt = `You are a knowledgeable and friendly assistant. Answer the user's question directly and clearly.
- Format for Telegram: use *bold* for titles/headers, _italic_ for tips or notes
- For lists use numbered items (1. 2. 3.) or bullet points starting with •
- Do NOT use markdown headers (#, ##, ###), **double asterisks**, or blockquotes (>)
- Keep responses concise and scannable
- For personal questions use the User Context below; for general questions use your own knowledge

User Context:
${profileSummary}`;
    return this._callOpenRouter(message, systemPrompt, userId);
  }

  async answerDirectly(userMessage, userId) {
    const systemPrompt = `You are a direct assistant. Answer the user's request clearly and helpfully with no vague follow-ups.
- Format for Telegram: use *bold* for titles/headers, _italic_ for tips or notes
- For lists use numbered items (1. 2. 3.) or bullet points starting with •
- Do NOT use markdown headers (#, ##, ###) — they do not render in Telegram
- Do NOT use **double asterisks** — use *single asterisks* for bold
- Do NOT use blockquotes (>)
- Keep responses concise and scannable
- If the user asks for recipes or lists, format each item as: *Name* — description
- If the message is a follow-up like "yes please" or "sure", use previous conversation context to continue.
- Do not respond by asking what the user means if the intent is obvious from context.`;

    const response = await this._callOpenRouter(userMessage, systemPrompt, userId);
    return response;
  }

  // ============================================
  // 2. MINIMUM DAILY COMMITMENT TRACKING
  // ============================================

  async setDailyCommitment(userId, commitment) {
    /*
    commitment = {
      minutes: 15,
      description: "work on side project",
      category: "coding",
      streak: 0
    }
    */
    const profile = await this._getOrCreateProfile(userId);
    profile.dailyCommitment = commitment;
    profile.commitmentHistory = profile.commitmentHistory || {};
    profile.currentStreak = 0;
    await this._saveProfile(userId, profile);

    return {
      message: `✅ Daily commitment set: ${commitment.minutes}min on "${commitment.description}"`,
      commitment: commitment
    };
  }

  async logDailyCommitment(userId, minutesCompleted) {
    const profile = await this._getOrCreateProfile(userId);
    if (!profile.dailyCommitment) {
      return { error: 'No daily commitment set' };
    }

    const today = this._getTodayKey();
    if (!profile.commitmentHistory) profile.commitmentHistory = {};

    const completed = minutesCompleted >= profile.dailyCommitment.minutes;

    profile.commitmentHistory[today] = {
      date: today,
      target: profile.dailyCommitment.minutes,
      completed: minutesCompleted,
      success: completed,
      timestamp: new Date().toISOString()
    };

    // Update streak
    if (completed) {
      profile.currentStreak = (profile.currentStreak || 0) + 1;
    } else {
      profile.currentStreak = 0;
    }

    await this._saveProfile(userId, profile);

    return {
      message: completed 
        ? `🔥 CRUSHED IT! ${minutesCompleted}min completed. Streak: ${profile.currentStreak}` 
        : `⚠️ ${minutesCompleted}/${profile.dailyCommitment.minutes}min today. Keep going!`,
      streak: profile.currentStreak,
      progress: minutesCompleted / profile.dailyCommitment.minutes
    };
  }

  async getStreakStatus(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const today = this._getTodayKey();
    const todayLog = profile.commitmentHistory?.[today];

    return {
      currentStreak: profile.currentStreak || 0,
      dailyCommitment: profile.dailyCommitment,
      todayProgress: todayLog?.completed || 0,
      todayTarget: profile.dailyCommitment?.minutes || 0,
      todayComplete: todayLog?.success || false,
      message: this._buildStreakMessage(profile)
    };
  }

  // ============================================
  // 3. REMINDERS FOR FORGOTTEN GOALS
  // ============================================

  async checkAbandonedGoals(userId) {
    /*
    Looks at tasks they started but abandoned
    Reminds them with encouragement to pick back up
    */
    const profile = await this._getOrCreateProfile(userId);
    if (!profile.allTasks) return [];

    const now = Date.now();
    const abandoned = profile.allTasks.filter(task => {
      // Not completed
      if (task.completed) return false;
      // Not touched in 7+ days
      const lastTouched = new Date(task.lastTouched || task.created).getTime();
      const daysSinceTouch = (now - lastTouched) / (1000 * 60 * 60 * 24);
      return daysSinceTouch > 7;
    });

    if (abandoned.length === 0) return '🎯 *No forgotten goals!*\n\nYou\'re on top of everything — great work.\nWant to add a new goal? Just type what you want to achieve.';

    // Generate personalized reminders
    const reminders = await Promise.all(
      abandoned.slice(0, 3).map(task => this._generateAbandonmentReminder(task, userId))
    );

    return reminders.join('\n\n─────────────────\n\n');
  }

  async _generateAbandonmentReminder(task, userId) {
    const systemPrompt = `You are a supportive friend reminding someone about a goal they abandoned.
Be warm, non-judgmental, and encouraging. Write 3-4 natural sentences — no labels or headers.
Cover: acknowledge the gap, why this goal matters, that it's okay to restart, and one tiny first action.`;

    const message = `I noticed you haven't touched "${task.action}" since ${this._daysAgo(task.lastTouched)}. That was important to you.`;

    const response = await this._callOpenRouter(message, systemPrompt);
    return `📌 *${task.action}*\n\n${response.trim()}`;
  }

  // ============================================
  // 4. WEEKLY REVIEWS & REFLECTION
  // ============================================

  async generateWeeklyReview(userId) {
    /*
    Analyze the week:
    - What they completed
    - What they started
    - Patterns (procrastination, energy, focus times)
    - Encouragement for next week
    */
    const profile = await this._getOrCreateProfile(userId);
    const weekStats = this._calculateWeekStats(profile);

    if (weekStats.attempts < 3) {
      return 'Not enough data for a full review yet 📊\n\nKeep logging for a few days — I need at least 3 days of data to spot patterns.\n\nWant to set a daily habit to track? Try _"Set 15 min reading every day"_.';
    }

    const systemPrompt = `You are a thoughtful friend doing a weekly check-in.
Analyze their week with warmth. Celebrate wins, identify patterns, encourage next week.
Be personal, not generic. Show you understand them.

Based on this week's data:
- Completed: ${weekStats.completed}
- Streaks: ${weekStats.streaks}
- Most active: ${weekStats.mostActiveDay}
- Energy pattern: ${weekStats.energyPattern}

Reply in exactly this format (no extra text before or after):
CELEBRATION: [what they did well this week — 2 sentences]
PATTERNS: [what you notice about how they work — 2 sentences]
CHALLENGE: [what tripped them up — 1-2 sentences]
MOMENTUM: [how to build on wins next week — 1-2 sentences]
PERSONAL_NOTE: [warm closing — 1 sentence]`;

    const raw = await this._callOpenRouter('Do my weekly review', systemPrompt);

    const get = (label) => {
      const match = raw.match(new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i'));
      return match ? match[1].trim() : null;
    };

    const lines = [];
    const celebration = get('CELEBRATION');
    const patterns   = get('PATTERNS');
    const challenge  = get('CHALLENGE');
    const momentum   = get('MOMENTUM');
    const note       = get('PERSONAL.?NOTE');

    if (celebration) lines.push(`🎉 *This week*\n${celebration}`);
    if (patterns)    lines.push(`🔍 *Patterns*\n${patterns}`);
    if (challenge)   lines.push(`⚡ *What tripped you up*\n${challenge}`);
    if (momentum)    lines.push(`🚀 *Next week*\n${momentum}`);
    if (note)        lines.push(`💙 ${note}`);

    return lines.length > 0 ? lines.join('\n\n') : raw;
  }

  // ============================================
  // 5. ENERGY TRACKING & SCHEDULING OPTIMIZATION
  // ============================================

  async logEnergy(userId, level, context) {
    /*
    level: 1-10
    context: "morning", "after exercise", "before bed", etc
    */
    const profile = await this._getOrCreateProfile(userId);
    if (!profile.energyLog) profile.energyLog = [];

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
      timeOfDay: this._getTimeOfDay()
    };

    profile.energyLog.push(entry);
    await this._saveProfile(userId, profile);

    // Analyze pattern every 10 entries
    if (profile.energyLog.length % 10 === 0) {
      const pattern = this._analyzeEnergyPattern(profile.energyLog);
      return {
        message: `📊 Tracking your energy. Noticing pattern: You're most energized ${pattern.peak}`,
        pattern: pattern,
        suggestion: `Why not schedule deep work during ${pattern.peak}?`
      };
    }

    return { message: `✅ Energy logged: ${level}/10` };
  }

  async getOptimalWorkSchedule(userId) {
    const profile = await this._getOrCreateProfile(userId);
    if (!profile.energyLog || profile.energyLog.length < 14) {
      return { error: 'Need 2+ weeks of energy data' };
    }

    const pattern = this._analyzeEnergyPattern(profile.energyLog);
    return {
      bestForDeepWork: pattern.peak,
      bestForLightWork: pattern.secondary,
      avoidHeavyWork: pattern.low,
      recommendation: `Schedule your daily ${profile.dailyCommitment?.description || 'commitment'} during ${pattern.peak}`
    };
  }

  // ============================================
  // 6. LONG-TERM GOAL PROGRESSION
  // ============================================

  async createLongTermGoal(userId, goal) {
    /*
    goal = {
      title: "Build SaaS product",
      why: "Create passive income",
      timeline: "6 months",
      milestones: [
        { name: "MVP done", daysUntil: 60 },
        { name: "First user", daysUntil: 90 },
        { name: "Revenue target", daysUntil: 180 }
      ]
    }
    */
    const profile = await this._getOrCreateProfile(userId);
    if (!profile.longTermGoals) profile.longTermGoals = [];

    const goalId = this._generateId();
    const fullGoal = {
      id: goalId,
      ...goal,
      created: new Date().toISOString(),
      status: 'active',
      milestonesProgress: goal.milestones.map(m => ({ ...m, completed: false }))
    };

    profile.longTermGoals.push(fullGoal);
    await this._saveProfile(userId, profile);

    const systemPrompt = `You are their dream coach. They just set a big goal.
Acknowledge it, break it down into first steps, and remind them why it matters.
Be inspiring but realistic.

Their goal: ${goal.title}
Why they want it: ${goal.why}
Timeline: ${goal.timeline}

Format:
BELIEF: [show you believe they can do this]
BREAKDOWN: [3-5 concrete milestones in order]
FIRST_STEP: [what to do THIS WEEK]
MOTIVATION: [why this matters beyond money/status]`;

    const raw = await this._callOpenRouter(`Help me start: ${goal.title}`, systemPrompt);

    const get = (label) => {
      const match = raw.match(new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i'));
      return match ? match[1].trim() : null;
    };
    const belief = get('BELIEF');
    const firstStep = get('FIRST.?STEP');
    const motivation = get('MOTIVATION');

    const lines = [];
    if (belief) lines.push(`🚀 *${belief}*`);
    if (firstStep) lines.push(`\n🗓 *This week*\n${firstStep}`);
    if (motivation) lines.push(`\n💙 ${motivation}`);
    const coachResponse = lines.join('\n') || raw;

    return { goalId, goal: fullGoal, coachResponse };
  }

  async progressMilestone(userId, goalId, milestoneIndex) {
    const profile = await this._getOrCreateProfile(userId);
    const goal = profile.longTermGoals?.find(g => g.id === goalId);
    
    if (!goal) return { error: 'Goal not found' };

    goal.milestonesProgress[milestoneIndex].completed = true;
    goal.milestonesProgress[milestoneIndex].completedDate = new Date().toISOString();
    await this._saveProfile(userId, profile);

    const completedCount = goal.milestonesProgress.filter(m => m.completed).length;
    const totalCount = goal.milestonesProgress.length;
    const percentage = Math.round((completedCount / totalCount) * 100);

    return {
      message: `🎯 Milestone reached! ${completedCount}/${totalCount} (${percentage}% toward ${goal.title})`,
      progress: percentage,
      nextMilestone: goal.milestonesProgress.find(m => !m.completed)?.name || 'Goal complete!'
    };
  }

  // ============================================
  // 7. HABIT & PATTERN RECOGNITION
  // ============================================

  async analyzePatterns(userId) {
    /*
    What times do they work best?
    When do they procrastinate?
    Which goals are they avoiding?
    Are they spreading too thin?
    */
    const profile = await this._getOrCreateProfile(userId);

    const analysis = {
      procrastinationPatterns: this._findProcrastinationPatterns(profile),
      focusWindows: this._findFocusWindows(profile),
      abandonmentRisk: this._findAtRiskGoals(profile),
      overcommitment: this._checkOvercommitment(profile),
      energyDrain: this._identifyEnergyDrains(profile)
    };

    const systemPrompt = `You are a behavioral coach analyzing someone's patterns.
Be insightful but kind. Show you see the person behind the data.

${JSON.stringify(analysis, null, 2)}

Reply in exactly this format (no extra text before or after):
INSIGHT: [what you notice about how they work — 2-3 sentences]
GOOD_NEWS: [what they're doing right — 2-3 sentences]
GENTLE_CHALLENGE: [what might be holding them back — 2-3 sentences]
EXPERIMENT: [one concrete small behavior change to try this week — 1-2 sentences]`;

    const raw = await this._callOpenRouter('Analyze my patterns', systemPrompt);

    // Parse the labelled sections and format for Telegram
    const get = (label) => {
      const match = raw.match(new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i'));
      return match ? match[1].trim() : null;
    };
    const insight = get('INSIGHT');
    const goodNews = get('GOOD.?NEWS');
    const challenge = get('GENTLE.?CHALLENGE');
    const experiment = get('EXPERIMENT');

    const lines = [];
    if (insight)    lines.push(`🔍 *Insight*\n${insight}`);
    if (goodNews)   lines.push(`✅ *Good news*\n${goodNews}`);
    if (challenge)  lines.push(`🎯 *Gentle challenge*\n${challenge}`);
    if (experiment) lines.push(`🧪 *Try this week*\n${experiment}`);

    return lines.length > 0 ? lines.join('\n\n') : raw;
  }

  // ============================================
  // 8. MOTIVATION ON DEMAND - Different flavors
  // ============================================

  async getMotivatation(userId, flavor = 'default') {
    const profile = await this._getOrCreateProfile(userId);

    // Cycle through flavors so repeated taps feel fresh
    if (flavor === 'default') {
      const flavors = ['default', 'humorous', 'scientific', 'poetic', 'tough-love'];
      const lastIdx = flavors.indexOf(profile.lastMotivationFlavor || 'tough-love');
      flavor = flavors[(lastIdx + 1) % flavors.length];
      await this.updateProfileMeta(userId, { lastMotivationFlavor: flavor });
    }

    let systemPrompt;

    switch(flavor) {
      case 'tough-love':
        systemPrompt = `You're their no-nonsense friend. They're stalling.
Tell them hard truths with love. Make them laugh at themselves.
Keep it real, not mean. One paragraph.`;
        break;

      case 'poetic':
        systemPrompt = `You're their wise mentor. Use metaphors and deep insight.
Make them feel like heroes on a journey. One poetic paragraph.`;
        break;

      case 'scientific':
        systemPrompt = `Explain why what they're doing matters through neuroscience/biology.
Make the science accessible. Show them they're literally rewiring their brain.`;
        break;

      case 'humorous':
        systemPrompt = `Make them laugh. Show the absurdity of procrastination.
Be self-aware, witty, not condescending. One funny paragraph.`;
        break;

      default:
        systemPrompt = `You're their best friend checking in.
Show you care about their growth. Be warm and real. One paragraph.`;
    }

    const message = `I need motivation right now. I'm working on: ${profile.dailyCommitment?.description || 'my goals'}`;
    const response = await this._callOpenRouter(message, systemPrompt);

    return response;
  }

  // ============================================
  // 9. ACCOUNTABILITY PARTNERS - Track with others
  // ============================================

  async addAccountabilityPartner(userId, partnerId, sharedGoals) {
    const profile = await this._getOrCreateProfile(userId);
    if (!profile.partners) profile.partners = [];

    profile.partners.push({
      partnerId,
      sharedGoals,
      joined: new Date().toISOString(),
      checkIns: []
    });

    await this._saveProfile(userId, profile);

    return {
      message: `🤝 Added accountability partner!`,
      tip: `Share your daily commits. "Show up for each other" creates magic.`
    };
  }

  async checkInWithPartner(userId, partnerId, message) {
    // Both update each other on progress
    const profile = await this._getOrCreateProfile(userId);
    const partner = profile.partners?.find(p => p.partnerId === partnerId);

    if (partner) {
      partner.checkIns.push({
        message,
        timestamp: new Date().toISOString()
      });
      await this._saveProfile(userId, profile);
    }

    return {
      message: `✅ Check-in logged. Your partner will see you showed up.`,
      reminder: `Keep these regular - consistency beats perfection.`
    };
  }

  // ============================================
  // 10. FUTURE: AI COACH PERSONAL INSIGHTS
  // ============================================

  async getPersonalInsight(userId) {
    /*
    Deep analysis of their personality as a worker/creator:
    - How do they respond to deadlines vs freedom?
    - Do they prefer incremental or big-bang progress?
    - Are they motivated by external validation or internal growth?
    - How does their identity relate to their goals?
    */
    const profile = await this._getOrCreateProfile(userId);
    
    const systemPrompt = `You are a therapist + coach + best friend.
Based on their behavior patterns, tell them something true about how they work best.
Something that helps them understand themselves, not judge themselves.

Their data: ${JSON.stringify(profile, null, 2)}

Format:
WHO_THEY_ARE: [describe their working style]
SUPERPOWER: [what comes naturally to them]
KRYPTONITE: [what trips them up (without judgment)]
REFRAME: [how to think about their challenges]
PATH_FORWARD: [how to work WITH their nature, not against it]`;

    const response = await this._callOpenRouter('Who am I as a creator?', systemPrompt);
    return response;
  }

  // ============================================
  // INTENT CLASSIFICATION
  // ============================================

  async classifyIntent(message) {
    const normalized = (message || '').trim();
    // Fast-path: greetings and short confirmations skip the API
    if (/^(hi|hello|hey|yo|hola|sup|good morning|good afternoon|good evening|ok|okay|yes|sure|ready|yep|yeah|nope|nah|fine|thanks?)$/i.test(normalized.replace(/[^\w\s]/g, '').trim())) {
      return 'chat';
    }
    if (/\b(remind(er)?|recurring|every day|daily reminder|repeat)\b/i.test(normalized)) return 'task';
    if (/\b(streak|how many days)\b/i.test(normalized)) return 'streak';
    if (/\b(long.?term goal|big goal|set a goal|my goals|my long.?term)\b/i.test(normalized)) return 'longterm';
    if (/\b(milestone done|finished the|completed the|i finished|i completed)\b/i.test(normalized)) return 'milestonedone';
    if (/\b(my stats|show stats|total tasks|how many tasks|tasks completed)\b/i.test(normalized)) return 'stats';
    if (/\b(my settings|show settings|current settings|what time|when do you|my config)\b/i.test(normalized)) return 'settings';
    if (/\b(peak hours|best time to work|optimal schedule|when should i work|most productive time)\b/i.test(normalized)) return 'peakhours';
    if (/\b(personal insight|coach me|who am i|how do i work best|deep analysis)\b/i.test(normalized)) return 'insight';
    if (/\b(reschedule|rename|change.*task|move.*task|update.*task|edit.*task)\b/i.test(normalized)) return 'edit';

    const systemPrompt = `Classify the user message into exactly one intent word from this list:
task - adding a to-do, reminder, or chore ("buy milk", "remind me to call", "don't forget...", "set reminder", "recurring reminder")
schedule - booking an event at a specific date/time ("meeting tomorrow 3pm", "dentist on Friday")
idea - exploring or developing an idea ("I'm thinking about...", "what if I...", "I have an idea for...")
commit - setting or logging a daily habit ("15 min writing", "I want to do 30min coding", "I completed 20min")
energy - logging energy level ("energy 7", "feeling tired", "I'm drained today")
review - requesting a weekly summary or progress ("how did I do", "weekly review", "show my progress")
motivation - asking for encouragement ("I'm stuck", "motivate me", "I'm procrastinating")
pattern - asking about work patterns ("how do I work", "show my patterns", "when am I most productive")
abandoned - asking about forgotten goals ("what did I forget", "remind me abandoned goals")
help - asking for available commands ("help", "what can you do", "commands")
connect - linking or connecting a service account ("connect google", "link calendar", "sign in with google")
question - any direct question OR request for information ("what is X?", "how do I...", "give me a recipe", "tell me about...", "explain...")
list - viewing saved tasks ("show my tasks", "what do I have today", "list tasks", "what's on my plate")
complete - marking a task as done ("done with X", "finished X", "mark X done", "completed the X task")
delete - removing a task entirely ("remove X", "delete X task", "cancel X", "get rid of X")
edit - editing a task ("reschedule X to Friday", "rename X to Y", "change deadline of X")
streak - checking habit streak ("show my streak", "what's my streak", "streak status", "my streak")
stats - viewing productivity statistics ("my stats", "show my stats", "how many tasks have I done")
settings - viewing current configuration ("my settings", "what time is my morning brief", "show my config")
peakhours - viewing optimal work schedule ("when should I work", "my peak hours", "best time to work")
insight - requesting deep personal coaching ("coach me", "personal insight", "who am I as a creator")
longterm - setting or viewing long-term goals ("I want to build X", "my long-term goals", "big goal", "set a big goal", "show my goals")
milestonedone - completing a milestone of a long-term goal ("I finished the MVP", "milestone done", "I completed X")
dailyconfig - setting message times ("send my daily message at 7am", "habit nudge at 9pm", "morning brief off")
chat - anything else (casual talk, follow-ups that are not questions)

Reply with ONLY the single intent word. No punctuation, no explanation.`;

    try {
      const result = await this._callOpenRouter(message, systemPrompt);
      const intent = (result || '').trim().toLowerCase().replace(/[^a-z]/g, '');
      const valid = ['task','schedule','idea','commit','energy','review','motivation','pattern','abandoned','help','connect','question','list','complete','delete','edit','streak','stats','settings','peakhours','insight','longterm','milestonedone','dailyconfig','chat'];
      return valid.includes(intent) ? intent : 'chat';
    } catch {
      return 'chat';
    }
  }

  // ============================================
  // TASK PARSING
  // ============================================

  async parseTask(message) {
    const systemPrompt = `You are a personal assistant. Extract structured task info from the user message.

Rules:
- ACTION must be ONLY the core activity (e.g. "eat breakfast", "call dentist", "buy milk") — strip scheduling phrases like "set reminder", "remind me to", "schedule", "recurring", "at 10am", "tomorrow", etc.
- DEADLINE: extract the specific time/date if mentioned (e.g. "10:00 AM", "tomorrow at 3pm", "today"), else "today"
- PRIORITY: high/medium/low
- MOTIVATION: one short encouraging phrase
- RECURRING: yes if the user says "recurring", "every day", "daily", "repeat", else no

Format EXACTLY as:
ACTION: [core activity only]
DEADLINE: [when]
PRIORITY: [high/medium/low]
MOTIVATION: [one short encouraging phrase]
RECURRING: [yes/no]`;

    const response = await this._callOpenRouter(message, systemPrompt);
    const lines = (response || '').split(/\r?\n/);
    const result = { action: '', deadline: 'today', priority: 'medium', motivation: 'You got this!', recurring: false };

    lines.forEach(line => {
      const m = line.match(/^\s*(ACTION|DEADLINE|PRIORITY|MOTIVATION|RECURRING)\s*:\s*(.+)$/i);
      if (!m) return;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'recurring') {
        result.recurring = /^yes$/i.test(val);
      } else {
        result[key] = val;
      }
    });

    // Regex override — never miss "recurring" even if the AI doesn't flag it
    if (/\b(recurring|every day|daily reminder|repeat daily)\b/i.test(message)) {
      result.recurring = true;
    }

    return result;
  }

  // ============================================
  // TASK MANAGEMENT - Save, list, complete, delete
  // ============================================

  async saveTask(userId, taskData) {
    if (!taskData.action) return;
    const profile = await this._getOrCreateProfile(userId);
    if (!profile.allTasks) profile.allTasks = [];
    const userTimezone = profile.timezone || 'Asia/Singapore';
    const deadlineMs = this._parseDeadlineMs(taskData.deadline, userTimezone);
    // Resolve natural-language deadline to a real date so it doesn't go stale
    let resolvedDeadline = taskData.deadline || 'today';
    try {
      const parsed = chrono.parseDate(taskData.deadline, new Date(), { timezone: userTimezone });
      if (parsed) {
        resolvedDeadline = parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      }
    } catch { /* keep original */ }
    profile.allTasks.push({
      id: this._generateId(),
      action: taskData.action,
      deadline: resolvedDeadline,
      priority: taskData.priority || 'medium',
      recurring: taskData.recurring || false,
      completed: false,
      deadlineMs: deadlineMs || null,
      remindedAt: null,
      created: new Date().toISOString(),
      lastTouched: new Date().toISOString()
    });
    await this._saveProfile(userId, profile);
  }

  async listTasks(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const tasks = (profile.allTasks || []).filter(t => !t.completed);
    if (tasks.length === 0) {
      return '✨ *No tasks yet!*\n─────────────────\nTry typing one of these to get started:\n\n• _"Call dentist Friday"_\n• _"Submit report by Monday"_\n• _"Buy groceries today"_\n\nOr just tell me what you need to do!';
    }
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...tasks].sort((a, b) =>
      (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
    );
    const lines = ['📋 *Your tasks:*', '─────────────────'];
    sorted.forEach((t, i) => {
      const prefix = t.priority === 'high' ? '⚡ ' : '';
      const recurTag = t.recurring ? ' ⟳' : '';
      lines.push(`${i + 1}. ${prefix}${t.action}${recurTag} — _${t.deadline}_`);
    });
    lines.push('', '💡 Tap ✅ to complete · ⏰ to snooze 30min');
    return lines.join('\n');
  }

  async listTodayTasks(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    const tz = profile.timezone || 'UTC';
    const todayFormatted = new Date().toLocaleDateString('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric'
    });
    const tasks = (profile.allTasks || []).filter(t => {
      if (t.completed) return false;
      if (t.deadlineMs) return t.deadlineMs >= now && t.deadlineMs < in24h;
      return t.deadline === 'today' || t.deadline === todayFormatted;
    });
    if (tasks.length === 0) {
      return `✨ *Nothing due today!* You're all clear.\n\n_Say "show all tasks" to see everything on your list._`;
    }
    const lines = [`📅 *Due today — ${todayFormatted}:*`, '─────────────────'];
    tasks.forEach((t, i) => {
      const prefix = t.priority === 'high' ? '⚡ ' : '';
      const recurTag = t.recurring ? ' ⟳' : '';
      lines.push(`${i + 1}. ${prefix}${t.action}${recurTag}`);
    });
    lines.push('', '💡 Tap ✅ to complete · ⏰ to snooze 30min');
    return lines.join('\n');
  }

  async getStats(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const allTasks = profile.allTasks || [];
    const created = allTasks.length;
    const completed = allTasks.filter(t => t.completed).length;
    const pct = created > 0 ? Math.round((completed / created) * 100) : 0;
    const energyLog = profile.energyLog || [];
    const avgEnergy = energyLog.length > 0
      ? (energyLog.slice(-30).reduce((s, e) => s + e.level, 0) / Math.min(energyLog.length, 30)).toFixed(1)
      : null;
    const history = Object.values(profile.commitmentHistory || {});
    const longestStreak = history.reduce((best, _, i, arr) => {
      let run = 0;
      for (let j = i; j < arr.length && arr[j].success; j++) run++;
      return Math.max(best, run);
    }, 0);
    const memberSince = profile.created
      ? new Date(profile.created).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : 'unknown';

    const lines = [
      '📊 *Your Stats*',
      '─────────────────',
      `📌 Tasks created: ${created}`,
      `✅ Tasks completed: ${completed}${created > 0 ? ` (${pct}%)` : ''}`,
      `🔥 Current streak: ${profile.currentStreak || 0} day(s)`,
      longestStreak > 0 ? `🏆 Longest streak: ${longestStreak} day(s)` : null,
      avgEnergy ? `⚡ Avg energy (last 30): ${avgEnergy}/10` : null,
      `📅 Member since: ${memberSince}`
    ].filter(Boolean);
    return lines.join('\n');
  }

  async showSettings(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const fmt = (h) => {
      if (h === null || h === undefined) return 'off';
      return h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
    };
    const habit = profile.dailyCommitment
      ? `${this._formatHabit(profile.dailyCommitment)}`
      : 'not set';
    const morningHour = profile.morningBriefTime ?? profile.preferredHour ?? 8;
    const lines = [
      '⚙️ *Your Settings*',
      '─────────────────',
      `🔥 Daily habit: ${habit}`,
      `🌍 Timezone: ${profile.timezone || 'not set — share location to fix'}`,
      '',
      '*Scheduled messages:*',
      `☀️ Morning brief: ${fmt(morningHour)}`,
      `🔔 Habit nudge: ${fmt(profile.habitNudgeTime ?? 20)}`,
      `⚡ Energy check-in: ${fmt(profile.energyCheckTime ?? 21)}`,
      `📊 Weekly review: Sundays at ${fmt(profile.weeklyReviewTime ?? 18)}`,
      '',
      '_Say "morning brief at 7am" or "habit nudge off" to change any time._'
    ];
    return lines.join('\n');
  }

  async editTask(userId, message) {
    const profile = await this._getOrCreateProfile(userId);
    const openTasks = (profile.allTasks || []).filter(t => !t.completed);
    if (openTasks.length === 0) {
      return "You don't have any open tasks to edit.";
    }

    const taskList = openTasks.map((t, i) => `${i + 1}. ${t.action}`).join('\n');
    const systemPrompt = `The user wants to edit a task. Extract the edit details.

Open tasks:
${taskList}

Reply in EXACTLY this format:
TASK_NAME: [the task name from the list above, or closest match]
EDIT_TYPE: reschedule | rename | reprioritize
NEW_VALUE: [new deadline (e.g. "Fri, Jun 7"), new task name, or priority: high/medium/low]

Reply ONLY with these 3 lines. No other text.`;

    const raw = await this._callOpenRouter(message, systemPrompt);
    const taskNameMatch = raw.match(/TASK_NAME:\s*(.+)/i);
    const editTypeMatch = raw.match(/EDIT_TYPE:\s*(reschedule|rename|reprioritize)/i);
    const newValueMatch = raw.match(/NEW_VALUE:\s*(.+)/i);

    if (!taskNameMatch || !editTypeMatch || !newValueMatch) {
      return "I couldn't understand that edit. Try: _\"reschedule [task] to Friday\"_ or _\"rename [task] to [new name]\"_.";
    }

    const taskName = taskNameMatch[1].trim().toLowerCase();
    const editType = editTypeMatch[1].trim().toLowerCase();
    const newValue = newValueMatch[1].trim();

    const task = openTasks.find(t =>
      t.action.toLowerCase().includes(taskName) || taskName.includes(t.action.toLowerCase())
    );
    if (!task) {
      return `I couldn't find a task matching "${taskName}". Tap 📋 *My Tasks* to see your list.`;
    }

    if (editType === 'reschedule') {
      const userTimezone = profile.timezone || 'Asia/Singapore';
      const parsed = chrono.parseDate(newValue, new Date(), { timezone: userTimezone });
      task.deadline = parsed
        ? parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : newValue;
      task.deadlineMs = parsed ? parsed.getTime() : null;
      task.lastTouched = new Date().toISOString();
      await this._saveProfile(userId, profile);
      return `📅 *Updated!* "${task.action}" is now due _${task.deadline}_.`;
    }

    if (editType === 'rename') {
      const oldName = task.action;
      task.action = newValue;
      task.lastTouched = new Date().toISOString();
      await this._saveProfile(userId, profile);
      return `✏️ *Renamed!* "${oldName}" → "${task.action}".`;
    }

    if (editType === 'reprioritize') {
      const p = newValue.toLowerCase().trim();
      const priority = p.includes('high') ? 'high' : p.includes('low') ? 'low' : 'medium';
      task.priority = priority;
      task.lastTouched = new Date().toISOString();
      await this._saveProfile(userId, profile);
      const emoji = priority === 'high' ? '⚡' : priority === 'low' ? '○' : '●';
      return `${emoji} *Priority updated!* "${task.action}" is now *${priority}* priority.`;
    }

    return "I couldn't apply that edit. Try: _\"reschedule [task] to Friday\"_, _\"rename [task] to [name]\"_, or _\"set [task] to high priority\"_.";
  }

  async completeTask(userId, message) {
    const profile = await this._getOrCreateProfile(userId);
    const lower = message.toLowerCase();
    const task = (profile.allTasks || []).find(t =>
      !t.completed && (lower.includes(t.action.toLowerCase()) || t.action.toLowerCase().includes(lower))
    );
    if (!task) {
      return "Hmm, I couldn't find that task. Say *\"show my tasks\"* to see what's on your list.";
    }
    task.completed = true;
    task.lastTouched = new Date().toISOString();
    await this._saveProfile(userId, profile);
    return `✅ *Done!* "${task.action}" marked as complete.\n🔥 Keep the momentum going!`;
  }

  async deleteTask(userId, message) {
    const profile = await this._getOrCreateProfile(userId);
    const lower = message.toLowerCase();
    const index = (profile.allTasks || []).findIndex(t =>
      !t.completed && (lower.includes(t.action.toLowerCase()) || t.action.toLowerCase().includes(lower))
    );
    if (index === -1) {
      return "Hmm, I couldn't find that task. Say *\"show my tasks\"* to see what's on your list.";
    }
    const [removed] = profile.allTasks.splice(index, 1);
    await this._saveProfile(userId, profile);
    return `🗑 *Removed* "${removed.action}" from your tasks.`;
  }

  async getTodayCalendarEvents(userId) {
    if (!this.googleCredentials) return [];
    try {
      const token = await db.getGoogleToken(userId);
      if (!token) return [];
      const profile = await this._getOrCreateProfile(userId);
      const tz = profile.timezone || 'Asia/Singapore';
      const cal = new GoogleCalendarSync({
        credentials: this.googleCredentials,
        tokenJson: token,
        calendarId: 'primary',
        timezone: tz
      });
      const ok = await cal.initialize();
      if (!ok) return [];
      return await cal.getTodayEvents(tz);
    } catch (err) {
      console.error(`getTodayCalendarEvents(${userId}) failed:`, err.message);
      return [];
    }
  }

  async deleteCalendarEvent(userId, eventId) {
    if (!this.googleCredentials) return false;
    try {
      const token = await db.getGoogleToken(userId);
      if (!token) return false;
      const profile = await this._getOrCreateProfile(userId);
      const tz = profile.timezone || 'Asia/Singapore';
      const cal = new GoogleCalendarSync({
        credentials: this.googleCredentials,
        tokenJson: token,
        calendarId: 'primary',
        timezone: tz
      });
      await cal.initialize();
      await cal.deleteEvent(eventId);
      return true;
    } catch (err) {
      console.error(`deleteCalendarEvent(${userId}, ${eventId}) failed:`, err.message);
      return false;
    }
  }

  async completeTaskById(userId, taskId) {
    const profile = await this._getOrCreateProfile(userId);
    const task = (profile.allTasks || []).find(t => t.id === taskId);
    if (!task) return null;
    task.completed = true;
    task.lastTouched = new Date().toISOString();
    await this._saveProfile(userId, profile);
    return task;
  }

  async snoozeTask(userId, taskId, minutes) {
    const profile = await this._getOrCreateProfile(userId);
    const task = (profile.allTasks || []).find(t => t.id === taskId);
    if (!task) return null;
    task.deadlineMs = Date.now() + minutes * 60 * 1000;
    task.remindedAt = null;
    task.lastTouched = new Date().toISOString();
    await this._saveProfile(userId, profile);
    return task;
  }

  async formatStreakMessage(userId) {
    const s = await this.getStreakStatus(userId);
    if (!s.dailyCommitment) {
      return 'No daily habit set yet 🌱\n─────────────────\nTell me what you want to do every day, for example:\n\n• _"Set 15 min reading every day"_\n• _"30 min workout daily"_\n\nI\'ll track your streak automatically.';
    }
    const todayLine = s.todayComplete ? '✅ Today: completed' : '⏳ Today: not yet';
    return [
      `🔥 *Your streak: ${s.currentStreak} day(s)*`,
      '─────────────────',
      `🎯 Daily goal: ${this._formatHabit(s.dailyCommitment)}`,
      todayLine,
      '💪 Keep it going!'
    ].join('\n');
  }

  async setDailyMessageTime(userId, message) {
    const lower = message.toLowerCase();

    // Detect "off" / "disable"
    const isOff = /\b(off|disable|stop|never)\b/.test(lower);

    // Parse hour
    const hourMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    let hour = null;
    if (hourMatch && !isOff) {
      hour = parseInt(hourMatch[1]);
      const meridiem = (hourMatch[3] || '').toLowerCase();
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (hour < 0 || hour > 23) {
        return 'Please give a valid hour between 0 and 23.';
      }
    }

    // Detect which job to configure
    let field, jobName;
    if (/habit|nudge|streak reminder/i.test(lower)) {
      field = 'habitNudgeTime'; jobName = 'habit nudge';
    } else if (/energy|check.?in/i.test(lower)) {
      field = 'energyCheckTime'; jobName = 'energy check-in';
    } else if (/weekly|review|sunday/i.test(lower)) {
      field = 'weeklyReviewTime'; jobName = 'weekly review';
    } else {
      // Default: morning brief
      field = 'morningBriefTime'; jobName = 'morning brief';
    }

    const profile = await this._getOrCreateProfile(userId);

    if (isOff) {
      profile[field] = null;
      await this._saveProfile(userId, profile);
      return `⏰ Got it! Your ${jobName} has been turned off.`;
    }

    if (hour === null) {
      return 'I couldn\'t parse that time. Try something like *"morning brief at 7am"* or *"energy check at 9pm"*.';
    }

    profile[field] = hour;
    // Keep preferredHour in sync for backwards compatibility with the existing morning cron
    if (field === 'morningBriefTime') profile.preferredHour = hour;
    await this._saveProfile(userId, profile);

    const display = hour === 0 ? '12:00 AM' : hour < 12 ? `${hour}:00 AM` : hour === 12 ? '12:00 PM' : `${hour - 12}:00 PM`;
    return `⏰ Got it! Your ${jobName} is now set to *${display}* every day.`;
  }

  async getWelcomeIfNew(userId) {
    const profile = await this._getOrCreateProfile(userId);
    if (profile.welcomed) return null;
    profile.welcomed = true;
    await this._saveProfile(userId, profile);
    return '👋 *Welcome to Fluffy Fiesta!*\n\nI\'m your personal productivity companion. Just type naturally to add tasks, track habits, or ask me anything.\n\nTip: type */start* for a quick guided setup, or */help* to see what I can do.\n─────────────────';
  }

  // ============================================
  // PROFILE METADATA - Store chatId, platform, etc.
  // ============================================

  async updateProfileMeta(userId, meta) {
    // Always read fresh from DB — the in-memory cache may be stale if an
    // external process (e.g. OAuth callback) updated the profile since last load.
    const persisted = await db.getUserProfile(userId);
    const profile = persisted || this.userProfiles.get(userId) || {
      userId,
      created: new Date().toISOString(),
      allTasks: [],
      currentStreak: 0,
      commitmentHistory: {},
      energyLog: [],
      longTermGoals: [],
      partners: []
    };
    Object.assign(profile, meta);
    this.userProfiles.set(userId, profile); // keep cache in sync
    await db.saveUserProfile(userId, profile);
  }

  // ============================================
  // DAILY MORNING MESSAGE
  // ============================================

  async buildDailyMessage(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const commitment = profile.dailyCommitment;
    const systemPrompt = `You are a warm, encouraging personal assistant sending a short morning message.
Write ONE sentence of motivation relevant to someone working on: ${commitment?.description || 'their goals'}.
Keep it under 20 words. No emojis. Just the sentence.`;
    const motivationLine = await this._callOpenRouter('morning motivation', systemPrompt);
    return `☀️ *Good morning!*\n\n${this._buildDailySnapshot(profile)}\n\n💬 _${motivationLine.trim()}_`;
  }

  _extractHabitFromMessage(message) {
    const minMatch = message.match(/(\d+)\s*min/i);
    if (minMatch) {
      const minutes = parseInt(minMatch[1]);
      const afterMin = message.replace(/.*?(\d+)\s*min(ute)?s?\s*/i, '').trim();
      const desc = afterMin
        .replace(/^(of|for|on|doing|to do)\s+/i, '')
        .replace(/\b(daily|every day|everyday)\b/gi, '')
        .trim() || 'daily practice';
      return { minutes, description: desc, isTimeBased: true };
    }
    const numDescMatch = message.match(/(\d+)\s+(.+)/);
    if (numDescMatch) {
      const desc = numDescMatch[2]
        .replace(/\b(daily|every day|everyday)\b/gi, '')
        .trim();
      return { minutes: parseInt(numDescMatch[1]), description: desc || 'daily practice', isTimeBased: false };
    }
    // Pure description without number — e.g. "meditation"
    const desc = message
      .replace(/^(do|set|track|start|begin)\s+/i, '')
      .replace(/\b(daily|every day|everyday)\b/gi, '')
      .trim() || 'daily practice';
    return { minutes: 10, description: desc, isTimeBased: false };
  }

  _formatHabit(commitment) {
    if (!commitment) return '';
    if (commitment.isTimeBased === false) return `${commitment.minutes} ${commitment.description}`;
    return `${commitment.minutes}min ${commitment.description}`;
  }

  _goalProgressBar(milestonesProgress) {
    const total = milestonesProgress.length;
    const done = milestonesProgress.filter(m => m.completed).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const filled = Math.round(pct / 10);
    const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
    const next = milestonesProgress.find(m => !m.completed)?.name || 'All done! 🎉';
    return { bar, pct, done, total, next };
  }

  async listLongTermGoals(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const goals = (profile.longTermGoals || []).filter(g => g.status === 'active');
    if (goals.length === 0) {
      return 'No long-term goals yet.\n\nSay something like _"I want to build a SaaS product"_ to set one.';
    }
    const lines = ['🎯 *Your Long-term Goals*', '─────────────────'];
    goals.forEach((g, i) => {
      const { bar, pct, done, total, next } = this._goalProgressBar(g.milestonesProgress || []);
      lines.push(`\n${i + 1}. *${g.title}* _(${g.timeline})_`);
      lines.push(`   ${bar} ${pct}% · ${done}/${total} milestones`);
      lines.push(`   Next: ${next}`);
    });
    return lines.join('\n');
  }

  getLongTermGoalDetail(profile, goalId) {
    const goal = (profile.longTermGoals || []).find(g => g.id === goalId);
    if (!goal) return null;
    const { pct } = this._goalProgressBar(goal.milestonesProgress || []);
    const lines = [
      `🎯 *${goal.title}*`,
      `Timeline: ${goal.timeline} · ${pct}% complete`,
      '─────────────────'
    ];
    (goal.milestonesProgress || []).forEach(m => {
      const dateStr = m.completed && m.completedDate
        ? ` _(${new Date(m.completedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})_`
        : '';
      lines.push(`${m.completed ? '✅' : '⬜'} ${m.name}${dateStr}`);
    });
    return { goal, text: lines.join('\n') };
  }

  async _generateMilestones(title, why, timeline) {
    const monthMatch = timeline.match(/(\d+)\s*month/i);
    const weekMatch = timeline.match(/(\d+)\s*week/i);
    const totalDays = monthMatch ? parseInt(monthMatch[1]) * 30
      : weekMatch ? parseInt(weekMatch[1]) * 7
      : 90;

    const systemPrompt = `Generate 4-5 concrete, measurable milestones for this goal. Each milestone should be a clear checkpoint.

Goal: ${title}
Why it matters: ${why}
Timeline: ${timeline}

Reply with ONLY a numbered list, one milestone per line:
1. [milestone name]
2. [milestone name]
...

Milestones must be specific, achievable, and in chronological order. No explanations.`;

    const raw = await this._callOpenRouter(`Milestones for: ${title}`, systemPrompt);
    const milestones = [];
    raw.split('\n').forEach(line => {
      const match = line.match(/^\d+[.)]\s*(.+)/);
      if (match && milestones.length < 5) {
        milestones.push({
          name: match[1].trim(),
          daysUntil: Math.round(totalDays * (milestones.length + 1) / 5)
        });
      }
    });
    return milestones.length > 0 ? milestones : [{ name: 'First milestone', daysUntil: 30 }];
  }

  async _reviseMilestones(currentMilestones, feedback) {
    const systemPrompt = `Update this milestone list based on user feedback. Keep changes minimal.

Current milestones:
${currentMilestones.map((m, i) => `${i + 1}. ${m.name}`).join('\n')}

User feedback: "${feedback}"

Reply with ONLY the updated numbered list:
1. [milestone name]
2. [milestone name]
...`;

    const raw = await this._callOpenRouter('Update milestones', systemPrompt);
    const updated = [];
    raw.split('\n').forEach(line => {
      const match = line.match(/^\d+[.)]\s*(.+)/);
      if (match) updated.push({ name: match[1].trim(), daysUntil: 30 });
    });
    return updated.length > 0 ? updated : currentMilestones;
  }

  async markMilestoneByText(userId, message) {
    const profile = await this._getOrCreateProfile(userId);
    const goals = (profile.longTermGoals || []).filter(g => g.status === 'active');
    if (goals.length === 0) {
      return "You don't have any active long-term goals. Say _\"I want to...\"_ to set one.";
    }

    const candidates = goals.flatMap(g =>
      (g.milestonesProgress || []).map((m, i) => ({
        goalId: g.id, goalTitle: g.title, milestoneIndex: i, name: m.name, completed: m.completed
      }))
    ).filter(m => !m.completed);

    if (candidates.length === 0) return 'All your milestones are already done! 🎉';

    const systemPrompt = `Match the user message to the most likely milestone being completed.

Message: "${message}"

Incomplete milestones:
${candidates.map((m, i) => `${i}: [${m.goalTitle}] ${m.name}`).join('\n')}

Reply with ONLY the index number (0, 1, 2…) of the best match. If no match, reply "none".`;

    const raw = await this._callOpenRouter(message, systemPrompt);
    const trimmed = raw.trim().toLowerCase();
    const idx = parseInt(trimmed);
    if (trimmed === 'none' || isNaN(idx) || !candidates[idx]) {
      return "I couldn't match that to a milestone. Tap 📍 on your goals to see and complete milestones.";
    }

    const match = candidates[idx];
    const result = await this.progressMilestone(userId, match.goalId, match.milestoneIndex);
    return typeof result === 'object' ? result.message : result;
  }

  // ============================================
  // UPCOMING REMINDERS - Tasks due soon
  // ============================================

  async getUpcomingReminders(userId) {
    const profile = await this._getOrCreateProfile(userId);
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;

    return (profile.allTasks || []).filter(task => {
      if (task.completed) return false;
      if (!task.deadlineMs) return false;
      return task.deadlineMs > now && task.deadlineMs <= in24h;
    });
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  async _callOpenRouter(userMessage, systemPrompt, userId) {
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...this._getConversationHistory(userId),
        { role: 'user', content: userMessage }
      ];

      const response = await axios.post(this.openrouterUrl, {
        model: this.openrouterModel,
        messages,
        max_tokens: 800
      }, {
        headers: {
          'Authorization': `Bearer ${this.openrouterKey}`,
          'HTTP-Referer': 'https://personal-assistant.local',
          'X-Title': 'Personal Assistant Bot'
        }
      });

      const content = response.data.choices[0].message.content;
      this._addConversationEntry(userId, 'user', userMessage);
      this._addConversationEntry(userId, 'assistant', content);
      return content;
    } catch (error) {
      console.error('OpenRouter error:', error.response?.status, error.response?.data || error.message);
      return 'Had a moment there, but I believe in you. Try again!';
    }
  }

  async _getOrCreateProfile(userId) {
    if (this.userProfiles.has(userId)) return this.userProfiles.get(userId);

    const persisted = await db.getUserProfile(userId);
    const profile = persisted || {
      userId,
      created: new Date().toISOString(),
      allTasks: [],
      currentStreak: 0,
      commitmentHistory: {},
      energyLog: [],
      longTermGoals: [],
      partners: []
    };

    this.userProfiles.set(userId, profile);
    return profile;
  }

  async _saveProfile(userId, profile) {
    this.userProfiles.set(userId, profile);
    await db.saveUserProfile(userId, profile);
  }

  _parseAdvancedResponse(response) {
    const lines = response.split('\n');
    const result = {};
    
    lines.forEach(line => {
      if (line.startsWith('ENTHUSIASM:')) result.enthusiasm = line.replace('ENTHUSIASM:', '').trim();
      if (line.startsWith('DEEPER:')) result.deeper = line.replace('DEEPER:', '').trim();
      if (line.startsWith('OPPORTUNITY:')) result.opportunity = line.replace('OPPORTUNITY:', '').trim();
      if (line.startsWith('NEXT_STEP:')) result.nextStep = line.replace('NEXT_STEP:', '').trim();
    });

    return result;
  }

  _parseDeadlineMs(deadline, timezone) {
    if (!deadline) return null;
    const hasExplicitTime = /\d+\s*(am|pm)|at\s+\d|\d+:\d+|\bin\s+\d+\s*(hour|min)/i.test(deadline);
    if (!hasExplicitTime) return null;
    try {
      const parsed = chrono.parseDate(deadline, new Date(), { timezone: timezone || 'Asia/Singapore' });
      return parsed ? parsed.getTime() : null;
    } catch {
      return null;
    }
  }

  _buildProfileSummary(profile) {
    const lines = [];
    if (profile.currentStreak) lines.push(`Streak: ${profile.currentStreak} day(s)`);
    if (profile.dailyCommitment) {
      lines.push(`Daily commitment: ${profile.dailyCommitment.minutes}min on "${profile.dailyCommitment.description}"`);
    }
    const incompleteTasks = (profile.allTasks || []).filter(t => !t.completed).slice(0, 10);
    if (incompleteTasks.length > 0) {
      lines.push(`Tasks: ${incompleteTasks.map(t => `${t.action} (${t.deadline || 'no deadline'})`).join(', ')}`);
    }
    if (profile.energyLog && profile.energyLog.length > 0) {
      const last = profile.energyLog[profile.energyLog.length - 1];
      lines.push(`Last energy level: ${last.level}/10`);
    }
    return lines.length > 0 ? lines.join('\n') : 'No personal data available yet.';
  }

  _getTodayKey() {
    return new Date().toISOString().split('T')[0];
  }

  _buildStreakMessage(profile) {
    const streak = profile.currentStreak || 0;
    if (streak === 0) return `You haven't started today's ${profile.dailyCommitment?.minutes}min yet. Let's go!`;
    if (streak === 1) return `1 day! 🔥 Keep it going!`;
    if (streak < 7) return `${streak} days! 🔥 Building momentum!`;
    if (streak < 30) return `${streak} days! 🚀 You're unstoppable!`;
    return `${streak} days! 🏆 You're a legend!`;
  }

  _buildDailySnapshot(profile) {
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    const tz = profile.timezone || 'UTC';
    const todayFormatted = new Date().toLocaleDateString('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric'
    });
    const tasksDue = (profile.allTasks || []).filter(t => {
      if (t.completed) return false;
      if (t.deadlineMs) return t.deadlineMs >= now && t.deadlineMs < in24h;
      return t.deadline === 'today' || t.deadline === todayFormatted;
    });
    const tasksLine = tasksDue.length > 0
      ? `• 📌 ${tasksDue.length} task(s) due today`
      : '• No tasks due today';

    const streakLine = profile.dailyCommitment
      ? `• 🔥 Streak: ${profile.currentStreak || 0} day(s) (${profile.dailyCommitment.description})`
      : '• No habit set yet';

    const lastEnergy = (profile.energyLog || []).slice(-1)[0] || null;
    const energyLine = lastEnergy
      ? `• ⚡ Last energy: ${lastEnergy.level}/10`
      : '• ⚡ Energy not logged yet';

    return ['─────────────────', '📅 *Today\'s snapshot*', tasksLine, streakLine, energyLine].join('\n');
  }

  _daysAgo(date) {
    const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  }

  _calculateWeekStats(profile) {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const weekHistory = Object.values(profile.commitmentHistory || {})
      .filter(h => new Date(h.date) >= weekAgo);

    return {
      completed: weekHistory.filter(h => h.success).length,
      attempts: weekHistory.length,
      streaks: profile.currentStreak || 0,
      mostActiveDay: this._findMostActiveDay(weekHistory),
      energyPattern: profile.energyLog ? this._analyzeEnergyPattern(profile.energyLog).peak : 'unknown'
    };
  }

  _analyzeEnergyPattern(energyLog) {
    if (!energyLog || energyLog.length === 0) return { peak: 'afternoon', secondary: 'morning', low: 'evening' };

    const timeGroups = {};
    energyLog.forEach(entry => {
      const time = entry.timeOfDay;
      if (!timeGroups[time]) timeGroups[time] = [];
      timeGroups[time].push(entry.level);
    });

    const averaged = {};
    Object.entries(timeGroups).forEach(([time, levels]) => {
      averaged[time] = levels.reduce((a, b) => a + b, 0) / levels.length;
    });

    const sorted = Object.entries(averaged).sort((a, b) => b[1] - a[1]);

    return {
      peak: sorted[0]?.[0] || 'afternoon',
      secondary: sorted[1]?.[0] || 'morning',
      low: sorted[2]?.[0] || 'evening',
      scores: averaged
    };
  }

  _findProcrastinationPatterns(profile) {
    // Incomplete tasks started days ago
    const now = Date.now();
    return (profile.allTasks || [])
      .filter(t => !t.completed && (now - new Date(t.created).getTime()) > 3 * 24 * 60 * 60 * 1000)
      .map(t => t.action);
  }

  _findFocusWindows(profile) {
    // Times when they complete most
    const history = Object.values(profile.commitmentHistory || {})
      .filter(h => h.success);
    
    if (history.length === 0) return ['morning', 'afternoon'];
    return history.map(h => new Date(h.date).toLocaleTimeString('en-US', { hour: '2-digit' }));
  }

  _findAtRiskGoals(profile) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return (profile.allTasks || [])
      .filter(t => !t.completed && new Date(t.lastTouched || t.created).getTime() < sevenDaysAgo)
      .length;
  }

  _checkOvercommitment(profile) {
    const activeGoals = (profile.longTermGoals || []).filter(g => g.status === 'active').length;
    return {
      count: activeGoals,
      warning: activeGoals > 5 ? 'Consider focusing on fewer goals' : 'Good focus'
    };
  }

  _identifyEnergyDrains(profile) {
    // Tasks that keep getting pushed back
    return (profile.allTasks || [])
      .filter(t => !t.completed && (t.postponeCount || 0) > 2)
      .map(t => t.action);
  }

  _findMostActiveDay(weekHistory) {
    if (!weekHistory || weekHistory.length === 0) return 'unknown';
    const dayGroups = {};
    weekHistory.forEach(h => {
      const day = new Date(h.date).toLocaleDateString('en-US', { weekday: 'long' });
      dayGroups[day] = (dayGroups[day] || 0) + 1;
    });
    return Object.entries(dayGroups).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
  }

  _getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
  }

  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _suggestNextWeek(userId, weekStats) {
    return `Focus on your ${weekStats.completed} wins this week. Next week, aim for one more completion.`;
  }
}

module.exports = FriendlyAssistant;
