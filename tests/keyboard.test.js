const MessagingIntegration = require('../slack-telegram-integration');

const integration = new MessagingIntegration({
  openrouterKey: 'test',
  openrouterModel: 'test',
  telegramToken: 'test'
});

test('_persistentKeyboard returns 2 rows of 3 buttons', () => {
  const kb = integration._persistentKeyboard();
  expect(kb.keyboard).toHaveLength(2);
  expect(kb.keyboard[0]).toHaveLength(3);
  expect(kb.keyboard[1]).toHaveLength(3);
  expect(kb.persistent).toBe(true);
  expect(kb.resize_keyboard).toBe(true);
});

test('_resolveKeyboardShortcut maps My Tasks to list', () => {
  expect(integration._resolveKeyboardShortcut('📋 My Tasks')).toBe('list');
});

test('_resolveKeyboardShortcut maps My Streak to streak', () => {
  expect(integration._resolveKeyboardShortcut('🔥 My Streak')).toBe('streak');
});

test('_resolveKeyboardShortcut maps Motivate Me to motivation', () => {
  expect(integration._resolveKeyboardShortcut('💪 Motivate Me')).toBe('motivation');
});

test('_resolveKeyboardShortcut maps Patterns to pattern', () => {
  expect(integration._resolveKeyboardShortcut('📊 Patterns')).toBe('pattern');
});

test('_resolveKeyboardShortcut maps Weekly Review to review', () => {
  expect(integration._resolveKeyboardShortcut('📅 Weekly Review')).toBe('review');
});

test('_resolveKeyboardShortcut maps Help to help', () => {
  expect(integration._resolveKeyboardShortcut('❓ Help')).toBe('help');
});

test('_resolveKeyboardShortcut returns null for unknown text', () => {
  expect(integration._resolveKeyboardShortcut('buy milk tomorrow')).toBeNull();
});
