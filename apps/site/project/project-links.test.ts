import { describe, expect, test } from 'bun:test';
import { PROJECT_URL_MAX_CHARS, parseProjectUrl } from './project-links';

describe('parseProjectUrl shared save/render contract', () => {
  test('exports the cap and defaults missing or empty destinations to null', () => {
    expect(PROJECT_URL_MAX_CHARS).toBe(2048);
    for (const field of ['githubUrl', 'liveUrl'] as const) {
      for (const value of [undefined, null, '', '   ']) {
        expect(parseProjectUrl(value, field)).toEqual({ ok: true, value: null });
      }
    }
  });

  test('rejects encoded controls, empty credentials, malformed authorities and dot-segment GitHub paths', () => {
    for (const liveUrl of [
      'https://@example.com',
      'https://example.com/%00',
      'https://example.com/%0A',
      'https://example.com/%7f',
      'https://[::1',
      'https://example.com:bad',
      'https://example.com:99999',
    ]) {
      expect(parseProjectUrl(liveUrl, 'liveUrl').ok).toBe(false);
    }
    for (const githubUrl of [
      'https://github.com/owner/./repo',
      'https://github.com/owner/repo/../other',
      'https://github.com/owner/repo/.%2e/other',
      'https://github.com/owner/repo/%2e./other',
    ]) {
      expect(parseProjectUrl(githubUrl, 'githubUrl').ok).toBe(false);
    }
  });

  test('keeps trimmed copy including escaped path and query values rather than normalizing it', () => {
    const value = 'HTTPS://Example.com/app%20name?x="quoted"&y=2';
    expect(parseProjectUrl(` ${value} `, 'liveUrl')).toEqual({ ok: true, value });
  });

  test.each(['%80', '%9F', '%C2%80', '%C2%9F'])('rejects invalid UTF-8 or decoded C1 control %s in either destination', (encoded) => {
    for (const field of ['githubUrl', 'liveUrl'] as const) {
      const base = field === 'githubUrl' ? 'https://github.com/owner/repo' : 'https://example.com';
      for (const suffix of [`/${encoded}`, `?value=${encoded}`, `#${encoded}`]) {
        expect(parseProjectUrl(base + suffix, field).ok).toBe(false);
      }
    }
  });

  test('preserves valid encoded Cyrillic and separators in paths, queries and fragments', () => {
    const encoded = '%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82';
    for (const field of ['githubUrl', 'liveUrl'] as const) {
      const base = field === 'githubUrl' ? 'https://github.com/owner/repo' : 'https://example.com';
      const value = `${base}/${encoded}%2Ffile?name=${encoded}%3Fvalue#${encoded}%23part`;
      expect(parseProjectUrl(value, field)).toEqual({ ok: true, value });
    }
  });
});
