import { describe, expect, test } from 'bun:test';
import { extractStackTags } from './stack-tags';

describe('extractStackTags', () => {
  test('reads the tags from a Stack paragraph', () => {
    const content =
      '<p>Stack: Python, MongoDB, Telegram API.</p><p>Open the bot in Telegram: <a href="https://t.me/adhavenBot">t.me/adhavenBot</a></p>';
    expect(extractStackTags(content)).toEqual(['Python', 'MongoDB', 'Telegram API']);
  });

  test('reads a Stack line from plain-text content', () => {
    expect(extractStackTags('A small tool.\nstack: Go, SQLite\nMore notes.')).toEqual(['Go', 'SQLite']);
  });

  test('keeps dots inside tag names and drops only the closing one', () => {
    expect(extractStackTags('<p>Stack: Next.js, Node.js.</p>')).toEqual(['Next.js', 'Node.js']);
  });

  test('decodes HTML entities so the card can escape the text once', () => {
    expect(extractStackTags('<p>Stack: R&amp;D&nbsp;kit, &lt;canvas&gt;</p>')).toEqual(['R&D kit', '<canvas>']);
  });

  test('returns no tags without a Stack line', () => {
    expect(extractStackTags('Interpreter is a C++ project. My stack: none here.')).toEqual([]);
    expect(extractStackTags(null)).toEqual([]);
    expect(extractStackTags('')).toEqual([]);
  });
});
