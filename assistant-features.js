// assistant-features.js - Advanced Friend-Like Features
// Enhanced personal assistant that deeply engages with your goals

const axios = require('axios');

class FriendlyAssistant {
  constructor(config) {
    this.openrouterKey = config.openrouterKey;
    this.openrouterModel = config.openrouterModel || process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
    this.openrouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
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
2. Ask probing questions that make them think bigger
3. Point out hidden opportunities they haven't considered
4. Encourage exploration of the idea's potential
5. Challenge them to think about next steps

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

  async answerDirectly(userMessage, userId) {
    const systemPrompt = `You are a direct assistant. Answer the user's request clearly and helpfully with no vague follow-ups.
- If the user asks for recipes, give recipe ideas.
- If the user asks for help planning or scheduling, provide concrete next steps.
- If the message is a follow-up like "yes please" or "sure", use previous conversation context to continue.
- Do not respond by asking what the user means if the intent is obvious from context.
- Keep it short, useful, and on point.`;

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
    const profile = this._getOrCreateProfile(userId);
    profile.dailyCommitment = commitment;
    profile.commitmentHistory = profile.commitmentHistory || [];
    profile.currentStreak = 0;

    return {
      message: `✅ Daily commitment set: ${commitment.minutes}min on "${commitment.description}"`,
      commitment: commitment
    };
  }

  async logDailyCommitment(userId, minutesCompleted) {
    const profile = this._getOrCreateProfile(userId);
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

    return {
      message: completed 
        ? `🔥 CRUSHED IT! ${minutesCompleted}min completed. Streak: ${profile.currentStreak}` 
        : `⚠️ ${minutesCompleted}/${profile.dailyCommitment.minutes}min today. Keep going!`,
      streak: profile.currentStreak,
      progress: minutesCompleted / profile.dailyCommitment.minutes
    };
  }

  async getStreakStatus(userId) {
    const profile = this._getOrCreateProfile(userId);
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
    const profile = this._getOrCreateProfile(userId);
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

    if (abandoned.length === 0) return [];

    // Generate personalized reminders
    const reminders = await Promise.all(
      abandoned.slice(0, 3).map(task => this._generateAbandonmentReminder(task, userId))
    );

    return reminders;
  }

  async _generateAbandonmentReminder(task, userId) {
    const systemPrompt = `You are a supportive friend reminding someone about a goal they abandoned.
Be warm, non-judgmental, and encouraging. Show you understand it's hard to keep going.
Offer perspective on why this matters and how to restart without shame.

Format:
WARM_OPENING: [acknowledge the gap with empathy]
WHY_IT_MATTERS: [remind them why this goal was important to them]
NO_SHAME: [it's okay they stepped back, here's how to restart]
SMALL_RESTART: [one tiny action to get momentum back]`;

    const message = `I noticed you haven't touched "${task.action}" since ${this._daysAgo(task.lastTouched)}. That was important to you.`;
    
    const response = await this._callOpenRouter(message, systemPrompt);
    return {
      task: task.action,
      reminder: response,
      taskId: task.id
    };
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
    const profile = this._getOrCreateProfile(userId);
    const weekStats = this._calculateWeekStats(profile);

    const systemPrompt = `You are a thoughtful friend doing a weekly check-in.
Analyze their week with warmth. Celebrate wins, identify patterns, encourage next week.
Be personal, not generic. Show you understand them.

Based on this week's data:
- Completed: ${weekStats.completed}
- Streaks: ${weekStats.streaks}
- Most active: ${weekStats.mostActiveDay}
- Energy pattern: ${weekStats.energyPattern}

Format:
CELEBRATION: [what they did well this week]
PATTERNS: [what you notice about how they work]
CHALLENGE: [what tripped them up]
MOMENTUM: [how to build on wins next week]
PERSONAL_NOTE: [warm closing about their potential]`;

    const response = await this._callOpenRouter('Do my weekly review', systemPrompt);
    return {
      stats: weekStats,
      review: response,
      nextWeekTips: await this._suggestNextWeek(userId, weekStats)
    };
  }

  // ============================================
  // 5. ENERGY TRACKING & SCHEDULING OPTIMIZATION
  // ============================================

  async logEnergy(userId, level, context) {
    /*
    level: 1-10
    context: "morning", "after exercise", "before bed", etc
    */
    const profile = this._getOrCreateProfile(userId);
    if (!profile.energyLog) profile.energyLog = [];

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
      timeOfDay: this._getTimeOfDay()
    };

    profile.energyLog.push(entry);

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
    const profile = this._getOrCreateProfile(userId);
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
    const profile = this._getOrCreateProfile(userId);
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

    const response = await this._callOpenRouter(`Help me start: ${goal.title}`, systemPrompt);

    return {
      goalId,
      goal: fullGoal,
      coachResponse: response
    };
  }

  async progressMilestone(userId, goalId, milestoneIndex) {
    const profile = this._getOrCreateProfile(userId);
    const goal = profile.longTermGoals?.find(g => g.id === goalId);
    
    if (!goal) return { error: 'Goal not found' };

    goal.milestonesProgress[milestoneIndex].completed = true;
    goal.milestonesProgress[milestoneIndex].completedDate = new Date().toISOString();

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
    const profile = this._getOrCreateProfile(userId);

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

Format:
INSIGHT: [what you notice about how they work]
GOOD_NEWS: [what they're doing right]
GENTLE_CHALLENGE: [what might be holding them back]
EXPERIMENT: [one small behavior change to test]`;

    const response = await this._callOpenRouter('Analyze my patterns', systemPrompt);

    return {
      analysis,
      advice: response
    };
  }

  // ============================================
  // 8. MOTIVATION ON DEMAND - Different flavors
  // ============================================

  async getMotivatation(userId, flavor = 'default') {
    const profile = this._getOrCreateProfile(userId);
    
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
    const profile = this._getOrCreateProfile(userId);
    if (!profile.partners) profile.partners = [];

    profile.partners.push({
      partnerId,
      sharedGoals,
      joined: new Date().toISOString(),
      checkIns: []
    });

    return {
      message: `🤝 Added accountability partner!`,
      tip: `Share your daily commits. "Show up for each other" creates magic.`
    };
  }

  async checkInWithPartner(userId, partnerId, message) {
    // Both update each other on progress
    const profile = this._getOrCreateProfile(userId);
    const partner = profile.partners?.find(p => p.partnerId === partnerId);

    if (partner) {
      partner.checkIns.push({
        message,
        timestamp: new Date().toISOString()
      });
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
    const profile = this._getOrCreateProfile(userId);
    
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

  _getOrCreateProfile(userId) {
    if (!this.userProfiles.has(userId)) {
      this.userProfiles.set(userId, {
        userId,
        created: new Date().toISOString(),
        allTasks: [],
        currentStreak: 0,
        commitmentHistory: {},
        energyLog: [],
        longTermGoals: [],
        partners: []
      });
    }
    return this.userProfiles.get(userId);
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
