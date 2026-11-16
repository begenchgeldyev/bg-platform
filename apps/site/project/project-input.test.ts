import { describe, expect, test } from 'bun:test';
import { PROJECT_LIMITS, parseNewProject, parseProjectChanges } from './project-input';

describe('parseNewProject', () => {
  test('requires a name', () => {
    expect(parseNewProject({})).toEqual({ ok: false, error: 'name is required' });
  });

  test('trims the name and fills the other fields', () => {
    expect(parseNewProject({ name: '  Demo ' })).toEqual({
      ok: true,
      value: {
        name: 'Demo',
        description: null,
        content: null,
        image: null,
        isHidden: false,
        icon: null,
        tags: [],
        githubUrl: null,
        liveUrl: null,
      },
    });
  });

  test('refuses a body that is not a JSON object', () => {
    expect(parseNewProject('x')).toEqual({ ok: false, error: 'body must be a JSON object' });
  });

  test('refuses a name over 120 characters', () => {
    expect(parseNewProject({ name: 'a'.repeat(121) })).toEqual({ ok: false, error: 'name is too long' });
  });

  test('refuses a description over 600 characters', () => {
    expect(parseNewProject({ name: 'Demo', description: 'a'.repeat(601) })).toEqual({ ok: false, error: 'description is too long' });
  });
});

describe('parseProjectChanges', () => {
  test('turns a whitespace-only description into null', () => {
    expect(parseProjectChanges({ description: '  ' })).toEqual({ ok: true, value: { description: null } });
  });

  test('refuses an empty change set', () => {
    expect(parseProjectChanges({})).toEqual({ ok: false, error: 'nothing to update' });
  });

  test('refuses an empty name', () => {
    expect(parseProjectChanges({ name: '' })).toEqual({ ok: false, error: 'name is required' });
  });
});

describe('tags', () => {
  test('trims, drops empty tags and removes case-insensitive duplicates', () => {
    expect(parseProjectChanges({ tags: ['  Bun ', '', 'bun', 'HTMX'] })).toEqual({ ok: true, value: { tags: ['Bun', 'HTMX'] } });
  });

  test('refuses more than 12 tags', () => {
    const tags = Array.from({ length: 13 }, (_, index) => `tag-${index}`);
    expect(parseProjectChanges({ tags })).toEqual({ ok: false, error: 'at most 12 tags' });
  });

  test('refuses tags that are not a list', () => {
    expect(parseProjectChanges({ tags: 'Bun' })).toEqual({ ok: false, error: 'tags must be a list' });
  });
});

describe('icon', () => {
  test('keeps a known icon', () => {
    expect(parseProjectChanges({ icon: 'database' })).toEqual({ ok: true, value: { icon: 'database' } });
  });

  test('refuses an unknown icon', () => {
    expect(parseProjectChanges({ icon: 'rocket' })).toEqual({ ok: false, error: 'unknown icon' });
  });
});

describe('image', () => {
  test('keeps a public path', () => {
    expect(parseProjectChanges({ image: '/public/projects/telegram-bot.jpg' })).toEqual({
      ok: true,
      value: { image: '/public/projects/telegram-bot.jpg' },
    });
  });

  test('refuses a public path that climbs out of the folder', () => {
    expect(parseProjectChanges({ image: '/public/../server.ts' })).toEqual({ ok: false, error: 'photo must be an uploaded image' });
  });

  test('refuses any other URL', () => {
    expect(parseProjectChanges({ image: 'javascript:alert(1)' })).toEqual({ ok: false, error: 'photo must be an uploaded image' });
  });

  test('refuses a data URL over 2 MB', () => {
    expect(parseProjectChanges({ image: `data:image/png;base64,${'A'.repeat(2_796_204)}` })).toEqual({
      ok: false,
      error: 'photo must be 2 MB or smaller',
    });
  });

  test('keeps a small data URL', () => {
    expect(parseProjectChanges({ image: 'data:image/png;base64,iVBORw0KGgo=' })).toEqual({
      ok: true,
      value: { image: 'data:image/png;base64,iVBORw0KGgo=' },
    });
  });
});

describe('isHidden', () => {
  test('refuses a value that is not a boolean', () => {
    expect(parseProjectChanges({ isHidden: 'yes' })).toEqual({ ok: false, error: 'isHidden must be true or false' });
  });
});

describe('text caps', () => {
  test('counts trailing whitespace against the description cap', () => {
    expect(parseProjectChanges({ description: `${'a'.repeat(600)} ` })).toEqual({ ok: false, error: 'description is too long' });
  });

  test('counts trailing whitespace against the content cap', () => {
    expect(parseProjectChanges({ content: `${'a'.repeat(100_000)} ` })).toEqual({ ok: false, error: 'content is too long' });
  });

  test('keeps whitespace-only text as null', () => {
    expect(parseProjectChanges({ content: '   \n  ' })).toEqual({ ok: true, value: { content: null } });
  });
});

describe('photo paths', () => {
  test('refuses an encoded traversal', () => {
    expect(parseProjectChanges({ image: '/public/%2e%2e/server.ts' })).toEqual({ ok: false, error: 'photo must be an uploaded image' });
    expect(parseProjectChanges({ image: '/public/%2E%2E/server.ts' })).toEqual({ ok: false, error: 'photo must be an uploaded image' });
  });

  test('refuses a traversal that escapes once the browser resolves the URL', () => {
    for (const image of ['/public/%2e%2e?x', '/public/..\t/server.ts', '/public/..?x', '/public/../server.ts', '/public/.%2e/server.ts']) {
      expect(parseProjectChanges({ image })).toEqual({ ok: false, error: 'photo must be an uploaded image' });
    }
  });

  test('keeps valid public filenames, including a literal percent', () => {
    for (const image of ['/public/a%25.png', '/public/projects/telegram-bot.jpg']) {
      expect(parseProjectChanges({ image })).toEqual({ ok: true, value: { image } });
    }
  });

  test('refuses a parent segment after the server decodes once', () => {
    for (const image of ['/public/..%2Fserver.ts', '/public/%2e%2e%2fserver.ts', '/public/projects/../photo.png']) {
      expect(parseProjectChanges({ image })).toEqual({ ok: false, error: 'photo must be an uploaded image' });
    }
  });

  test('refuses a payload that is not real base64', () => {
    for (const payload of ['A', '=', 'A==', 'AAAA=']) {
      expect(parseProjectChanges({ image: `data:image/png;base64,${payload}` })).toEqual({
        ok: false,
        error: 'photo must be an uploaded image',
      });
    }
  });
});

describe('body shape', () => {
  test('refuses a date instead of a JSON object', () => {
    expect(parseNewProject(new Date())).toEqual({ ok: false, error: 'body must be a JSON object' });
  });

  test('refuses an object with a custom prototype', () => {
    const inherited = Object.create({ name: 'Demo' }) as Record<string, unknown>;
    expect(parseProjectChanges(inherited)).toEqual({ ok: false, error: 'body must be a JSON object' });
  });

  test('refuses an array', () => {
    expect(parseNewProject([])).toEqual({ ok: false, error: 'body must be a JSON object' });
  });
});

describe('project destination URLs', () => {
  test.each(['%80', '%9F', '%C2%80', '%C2%9F'])('rejects invalid UTF-8 or decoded C1 control %s on create and PATCH', (encoded) => {
    for (const field of ['githubUrl', 'liveUrl'] as const) {
      const base = field === 'githubUrl' ? 'https://github.com/owner/repo' : 'https://example.com';
      for (const suffix of [`/${encoded}`, `?value=${encoded}`, `#${encoded}`]) {
        const body = { [field]: base + suffix };
        expect(parseNewProject({ name: 'Demo', ...body }).ok).toBe(false);
        expect(parseProjectChanges(body).ok).toBe(false);
      }
    }
  });

  test('accepts encoded Cyrillic destinations without rewriting their percent escapes', () => {
    const encoded = '%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82';
    const destinations = { githubUrl: `https://github.com/owner/repo/${encoded}`, liveUrl: `https://example.com/${encoded}` };
    expect(parseNewProject({ name: 'Demo', ...destinations })).toMatchObject({ ok: true, value: destinations });
    expect(parseProjectChanges(destinations)).toEqual({ ok: true, value: destinations });
  });

  test('creates both trimmed destinations and defaults null or blank destinations', () => {
    expect(
      parseNewProject({
        name: 'Demo',
        githubUrl: ' https://github.com/owner/repo/tree/main ',
        liveUrl: ' http://example.com/app?a=1&b=2 ',
      }),
    ).toMatchObject({
      ok: true,
      value: { githubUrl: 'https://github.com/owner/repo/tree/main', liveUrl: 'http://example.com/app?a=1&b=2' },
    });
    expect(parseNewProject({ name: 'Demo', githubUrl: null, liveUrl: '  ' })).toMatchObject({
      ok: true,
      value: { githubUrl: null, liveUrl: null },
    });
  });

  test('PATCH omission preserves destinations, while null and blank clear independently', () => {
    expect(parseProjectChanges({ name: 'Rename' })).toEqual({ ok: true, value: { name: 'Rename' } });
    expect(parseProjectChanges({ githubUrl: null })).toEqual({ ok: true, value: { githubUrl: null } });
    expect(parseProjectChanges({ liveUrl: '  ' })).toEqual({ ok: true, value: { liveUrl: null } });
    expect(parseProjectChanges({ githubUrl: ' https://github.com/owner/repo ' })).toEqual({
      ok: true,
      value: { githubUrl: 'https://github.com/owner/repo' },
    });
  });

  test('accepts exactly 2,048 trimmed characters and rejects more', () => {
    expect(PROJECT_LIMITS.maxUrlChars).toBe(2048);
    for (const field of ['githubUrl', 'liveUrl'] as const) {
      const prefix = field === 'githubUrl' ? 'https://github.com/owner/repo/' : 'https://example.com/';
      const url = prefix + 'a'.repeat(2048 - prefix.length);
      expect(parseProjectChanges({ [field]: ` ${url} ` })).toEqual({ ok: true, value: { [field]: url } });
      expect(parseProjectChanges({ [field]: `${url}a` })).toEqual({ ok: false, error: `${field} must be 2048 characters or fewer` });
    }
  });

  test('rejects nonstrings and unsafe or malformed destinations in create and PATCH', () => {
    const commonInvalid = [
      false,
      42,
      {},
      [],
      'javascript:alert(1)',
      'data:text/html,hi',
      '//example.com/path',
      '/relative',
      'https:example.com',
      'https:///example.com',
      'https://',
      'https://user:pass@example.com',
      'https://user@example.com',
      'https://example.com/\npath',
      '\thttps://example.com',
      'https://example.com/\u0000',
      'https://example.com/\u007f',
      'https://example.com/has space',
      'https://example.com/%GG',
      'https://example.com\\@evil.com',
    ];
    for (const field of ['githubUrl', 'liveUrl'] as const) {
      for (const value of commonInvalid) {
        expect(parseNewProject({ name: 'Demo', [field]: value }).ok).toBe(false);
        expect(parseProjectChanges({ [field]: value }).ok).toBe(false);
      }
    }
  });

  test('GitHub requires HTTPS, the exact host, and an owner/repository path', () => {
    for (const githubUrl of [
      'http://github.com/owner/repo',
      'https://www.github.com/owner/repo',
      'https://github.com.evil.test/owner/repo',
      'https://github.com:444/owner/repo',
      'https://github.com/',
      'https://github.com/owner',
      'https://github.com//repo',
      'https://github.com/owner/..',
      'https://github.com/owner/%2e%2e/repo',
      'https://github.com/owner%2frepo/project',
      'https://github.com/owner/repo%2fother',
    ]) {
      expect(parseProjectChanges({ githubUrl }).ok).toBe(false);
    }
    for (const githubUrl of ['https://github.com/owner/repo', 'https://GITHUB.com/owner-name/repo.git/issues/1?x=1#top']) {
      expect(parseProjectChanges({ githubUrl })).toEqual({ ok: true, value: { githubUrl } });
    }
  });

  test('Live app accepts HTTP or HTTPS without inferring or fetching a destination', () => {
    for (const liveUrl of [
      'http://localhost:8613/app',
      'https://example.com',
      'https://example.com/path?x="quoted"&y=1#top',
      'http://127.0.0.1:8080/',
    ]) {
      expect(parseProjectChanges({ liveUrl })).toEqual({ ok: true, value: { liveUrl } });
    }
    expect(parseProjectChanges({ liveUrl: 'ftp://example.com' }).ok).toBe(false);
  });
});
