import { describe, expect, test } from 'bun:test';
import { normalizeTags } from '../index';

describe('normalizeTags', () => {
  test('normalizes whitespace and case, drops blanks, and keeps distinct tags in first-seen order', () => {
    expect(normalizeTags(['  Bun  ', '', 'TypeScript', 'bun', '  web   tools ', '\t', 'WEB TOOLS'])).toEqual([
      'bun',
      'typescript',
      'web tools',
    ]);
  });

  test('leaves the caller’s tags unchanged and handles empty input', () => {
    const tags = Object.freeze(['  Bun ', 'BUN']);
    expect(normalizeTags(tags)).toEqual(['bun']);
    expect(tags).toEqual(['  Bun ', 'BUN']);
    expect(normalizeTags([])).toEqual([]);
  });
});
