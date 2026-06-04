const FriendlyAssistant = require('../assistant-features');

const assistant = new FriendlyAssistant({ openrouterKey: 'test', openrouterModel: 'test' });

test('_buildDailySnapshot shows no tasks when list is empty', () => {
  const profile = { allTasks: [], dailyCommitment: null, currentStreak: 0, energyLog: [], timezone: 'UTC' };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('No tasks due today');
  expect(snapshot).toContain('No habit set yet');
  expect(snapshot).toContain('Energy not logged yet');
});

test('_buildDailySnapshot shows streak and habit name', () => {
  const profile = {
    allTasks: [],
    dailyCommitment: { minutes: 15, description: 'reading' },
    currentStreak: 7,
    energyLog: [],
    timezone: 'UTC'
  };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('7 day');
  expect(snapshot).toContain('reading');
});

test('_buildDailySnapshot shows last energy level', () => {
  const profile = {
    allTasks: [],
    dailyCommitment: null,
    currentStreak: 0,
    energyLog: [{ level: 8, timestamp: new Date().toISOString() }],
    timezone: 'UTC'
  };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('8/10');
});

test('_extractHabitFromMessage parses "15 min reading" as time-based', () => {
  const r = assistant._extractHabitFromMessage('15 min reading');
  expect(r).toMatchObject({ minutes: 15, description: 'reading', isTimeBased: true });
});

test('_extractHabitFromMessage strips "of" from "15 min of reading"', () => {
  const r = assistant._extractHabitFromMessage('15 min of reading');
  expect(r).toMatchObject({ minutes: 15, description: 'reading', isTimeBased: true });
});

test('_extractHabitFromMessage handles sentence form "I want to do 15 min of reading"', () => {
  const r = assistant._extractHabitFromMessage('I want to do 15 min of reading');
  expect(r.minutes).toBe(15);
  expect(r.description).toBe('reading');
  expect(r.isTimeBased).toBe(true);
});

test('_extractHabitFromMessage handles non-time habit "30 pushups" as not time-based', () => {
  const r = assistant._extractHabitFromMessage('30 pushups');
  expect(r).toMatchObject({ minutes: 30, description: 'pushups', isTimeBased: false });
});

test('_extractHabitFromMessage handles pure description "meditation" as not time-based', () => {
  const r = assistant._extractHabitFromMessage('meditation');
  expect(r.minutes).toBe(10);
  expect(r.description).toBe('meditation');
  expect(r.isTimeBased).toBe(false);
});

test('_buildDailySnapshot counts tasks due in next 24h', () => {
  const profile = {
    allTasks: [
      { completed: false, deadline: 'today', deadlineMs: null, action: 'Buy milk' },
      { completed: false, deadline: 'next week', deadlineMs: Date.now() + 8 * 24 * 60 * 60 * 1000, action: 'Tax return' },
      { completed: true, deadline: 'today', deadlineMs: null, action: 'Done thing' }
    ],
    dailyCommitment: null,
    currentStreak: 0,
    energyLog: [],
    timezone: 'UTC'
  };
  const snapshot = assistant._buildDailySnapshot(profile);
  expect(snapshot).toContain('1 task');
});

test('_goalProgressBar shows 0% for no completed milestones', () => {
  const ms = [{ name: 'MVP', completed: false }, { name: 'Launch', completed: false }];
  const result = assistant._goalProgressBar(ms);
  expect(result.pct).toBe(0);
  expect(result.done).toBe(0);
  expect(result.total).toBe(2);
  expect(result.bar).toBe('░░░░░░░░░░');
  expect(result.next).toBe('MVP');
});

test('_goalProgressBar shows 50% when half complete', () => {
  const ms = [{ name: 'MVP', completed: true }, { name: 'Launch', completed: false }];
  const result = assistant._goalProgressBar(ms);
  expect(result.pct).toBe(50);
  expect(result.done).toBe(1);
  expect(result.next).toBe('Launch');
});

test('_goalProgressBar shows 100% and done message when all complete', () => {
  const ms = [{ name: 'MVP', completed: true }];
  const result = assistant._goalProgressBar(ms);
  expect(result.pct).toBe(100);
  expect(result.bar).toBe('▓▓▓▓▓▓▓▓▓▓');
  expect(result.next).toBe('All done! 🎉');
});
