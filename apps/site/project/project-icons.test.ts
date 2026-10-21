import { describe, expect, test } from 'bun:test';
import { guessProjectIcon, PROJECT_ICONS, projectIcon } from './project-icons';

describe('PROJECT_ICONS', () => {
  test('offers 20 unique icon names', () => {
    expect(PROJECT_ICONS).toHaveLength(20);
    expect(new Set(PROJECT_ICONS).size).toBe(20);
  });
});

describe('guessProjectIcon', () => {
  test('picks web for a website', () => {
    expect(guessProjectIcon('This Website', 'Personal portfolio & blog.')).toBe('web');
  });

  test('picks smart_toy for a bot', () => {
    expect(guessProjectIcon('Telegram Bot', null)).toBe('smart_toy');
  });

  test('falls back to terminal', () => {
    expect(guessProjectIcon('Tool', 'works for both sides')).toBe('terminal');
  });
});

describe('projectIcon', () => {
  test('keeps a stored icon', () => {
    expect(projectIcon({ icon: 'database', name: 'This Website', description: null })).toBe('database');
  });

  test('guesses when the stored icon is not in the set', () => {
    expect(projectIcon({ icon: 'not-an-icon', name: 'Interpreter', description: null })).toBe('terminal');
  });
});
