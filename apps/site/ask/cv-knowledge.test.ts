import { describe, expect, test } from 'bun:test';
import { htmlToText, loadCvText } from './cv-knowledge';

describe('htmlToText', () => {
  test('keeps the text and drops comments, scripts, styles and tags', () => {
    const html =
      '<!--#include header.html--><h1>Fullstack&nbsp;Developer</h1><script>alert(1)</script><style>p{}</style><p>R&amp;D &#8212; Tomsk</p>';
    expect(htmlToText(html)).toBe('Fullstack Developer R&D — Tomsk');
  });
});

describe('loadCvText', () => {
  test('returns the CV page as plain text', async () => {
    const text = await loadCvText();
    expect(text).toContain('Synecta');
    expect(text).toContain('Fullstack Developer');
    expect(text).not.toMatch(/[<>]/);
  });
});
