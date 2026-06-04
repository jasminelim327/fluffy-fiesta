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
