import { describe, expect, test } from 'bun:test';
import {
  CONTRIBUTION_LIMIT,
  type Contribution,
  type ContributionsCache,
  contributionsQuery,
  contributionsUrl,
  createContributionsCache,
  createGitHubContributionsFetcher,
  formatContributionsSummary,
  GITHUB_USER,
  normalizeContributions,
} from './contributions';
import { ContributionsController } from './contributions.controller';

function rawOpen(overrides: Record<string, unknown> = {}) {
  return {
    number: 123,
    title: 'fix(http): close idle connections',
    html_url: 'https://github.com/oven-sh/bun/pull/123',
    repository_url: 'https://api.github.com/repos/oven-sh/bun',
    state: 'open',
    created_at: '2026-11-20T09:00:00Z',
    pull_request: { merged_at: null },
    ...overrides,
  };
}

function rawMerged(overrides: Record<string, unknown> = {}) {
  return rawOpen({
    state: 'closed',
    created_at: '2026-09-10T09:00:00Z',
    pull_request: { merged_at: '2026-09-14T10:00:00Z' },
    ...overrides,
  });
}

function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    repo: 'oven-sh/bun',
    title: 'fix(http): close idle connections',
    url: 'https://github.com/oven-sh/bun/pull/123',
    number: 123,
    date: '2026-11-20T09:00:00Z',
    status: 'open',
    ...overrides,
  };
}

function contributionsFor(prCount: number, repoCount: number): Contribution[] {
  return Array.from({ length: prCount }, (_, index) => contribution({ number: index + 1, repo: `owner/repo-${index % repoCount}` }));
}

describe('contributionsUrl', () => {
  test('asks GitHub search for open and merged PRs by the owner outside their own repositories', () => {
    const url = new URL(contributionsUrl(GITHUB_USER));
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/issues');
    expect(url.searchParams.get('q')).toBe(contributionsQuery(GITHUB_USER));
    expect(url.searchParams.get('q')).toBe('author:begenchgeldyev is:pr -user:begenchgeldyev');
    expect(url.searchParams.get('q')).toContain('is:pr');
    expect(url.searchParams.get('q')).toContain('-user:begenchgeldyev');
    expect(url.searchParams.get('q')).not.toContain('is:merged');
    expect(url.searchParams.get('sort')).toBe('updated');
    expect(url.searchParams.get('order')).toBe('desc');
    expect(url.searchParams.get('per_page')).toBe('100');
  });
});

describe('normalizeContributions', () => {
  test('returns an empty list when items is missing or not an array', () => {
    for (const payload of [null, undefined, {}, { items: 'nope' }, []]) {
      expect(normalizeContributions(payload)).toEqual([]);
    }
  });

  test('keeps open pull requests with their creation date', () => {
    expect(normalizeContributions({ items: [rawOpen()] })).toEqual([contribution()]);
  });

  test('keeps merged pull requests with their merge date', () => {
    expect(normalizeContributions({ items: [rawMerged()] })).toEqual([contribution({ date: '2026-09-14T10:00:00Z', status: 'merged' })]);
  });

  test('drops closed pull requests that were never merged', () => {
    const closed = rawOpen({ state: 'closed', created_at: '2023-04-02T09:00:00Z' });
    expect(normalizeContributions({ items: [closed] })).toEqual([]);
  });

  test('drops items without a usable date, and malformed items', () => {
    const items = normalizeContributions({
      items: [
        rawOpen({ created_at: undefined }),
        rawOpen({ created_at: '' }),
        rawOpen({ state: 'closed' }),
        rawOpen({ pull_request: {}, state: 'closed' }),
        rawOpen({ pull_request: null, state: 'closed' }),
        rawOpen({ title: '' }),
        rawOpen({ html_url: 'https://example.com/oven-sh/bun/pull/1' }),
        rawOpen({ html_url: undefined }),
        rawOpen({ number: 0 }),
        rawOpen({ number: 1.5 }),
        rawOpen({ number: '7' }),
        rawOpen({ repository_url: 'https://api.github.com/repos/bun' }),
        rawOpen({ repository_url: undefined }),
        'not an object',
        null,
      ],
    });

    expect(items).toEqual([]);
  });

  test('extracts owner/name from the repository url', () => {
    const [item] = normalizeContributions({ items: [rawMerged()] });
    expect(item.repo).toBe('oven-sh/bun');
  });

  test('sorts newest first across merged and open dates and slices to the limit', () => {
    const items = normalizeContributions(
      {
        items: [
          rawMerged({ number: 1, pull_request: { merged_at: '2026-09-14T00:00:00Z' } }),
          rawOpen({ number: 2, created_at: '2026-11-20T00:00:00Z' }),
          rawOpen({ number: 3, created_at: '2026-10-01T00:00:00Z' }),
        ],
      },
      2,
    );

    expect(items.map((item) => item.number)).toEqual([2, 3]);
    expect(items.map((item) => item.status)).toEqual(['open', 'open']);
    expect(normalizeContributions({ items: [rawOpen()] }, 0)).toEqual([]);
  });

  test('exports a default cap', () => {
    expect(CONTRIBUTION_LIMIT).toBe(12);
  });
});

describe('createGitHubContributionsFetcher', () => {
  test('sends the GitHub headers, adds auth only with a token, and normalizes the response', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string> });
      return Response.json({ items: [rawOpen()] });
    }) as typeof fetch;

    const anonymous = createGitHubContributionsFetcher({ fetchImpl });
    expect(await anonymous()).toEqual([contribution()]);
    expect(calls[0].headers).toEqual({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'begenchgeldyev-site',
      'X-GitHub-Api-Version': '2026-03-10',
    });

    const authorized = createGitHubContributionsFetcher({ fetchImpl, token: 'secret' });
    await authorized();
    expect(calls[1].headers.Authorization).toBe('Bearer secret');
  });

  test('fails loudly on a non-ok response', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch;
    const fetchContributions = createGitHubContributionsFetcher({ fetchImpl });
    await expect(fetchContributions()).rejects.toThrow('GitHub search failed: 403');
  });

  test('bounds the request with an abort timeout', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Response.json({ items: [rawOpen()] });
    }) as typeof fetch;

    await createGitHubContributionsFetcher({ fetchImpl, timeoutMs: 10_000 })();

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  test('rejects when the request outlives the timeout', async () => {
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })) as unknown as typeof fetch;

    await expect(createGitHubContributionsFetcher({ fetchImpl, timeoutMs: 10 })()).rejects.toThrow('The operation timed out.');
  });

  test('lets the cache keep serving stale data when the fetcher times out', async () => {
    const state = { now: 1_000, timedOut: false };
    const cache = createContributionsCache({
      fetch: async () => {
        if (!state.timedOut) return [contribution()];
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
      ttlMs: 1_000,
      now: () => state.now,
    });

    await cache.get();
    state.now += 5_000;
    state.timedOut = true;

    expect(await cache.get()).toEqual([contribution()]);
  });
});

describe('createContributionsCache', () => {
  function setup(options: { ttlMs?: number; fetch?: () => Promise<Contribution[]> } = {}) {
    const state = { now: 1_000, calls: 0 };
    let behaviour = options.fetch ?? (async () => [contribution()]);
    const cache = createContributionsCache({
      fetch: () => {
        state.calls += 1;
        return behaviour();
      },
      ttlMs: options.ttlMs ?? 1_000,
      now: () => state.now,
    });

    return {
      cache,
      state,
      setBehaviour(next: () => Promise<Contribution[]>) {
        behaviour = next;
      },
    };
  }

  test('serves the cached list inside the TTL and refetches once it expires', async () => {
    const { cache, state } = setup({ ttlMs: 1_000 });

    expect(await cache.get()).toEqual([contribution()]);
    state.now += 999;
    await cache.get();
    expect(state.calls).toBe(1);

    state.now += 1;
    await cache.get();
    expect(state.calls).toBe(2);
  });

  test('coalesces concurrent misses into a single fetch', async () => {
    const deferred = setup();
    let release: (items: Contribution[]) => void = () => {};
    deferred.setBehaviour(
      () =>
        new Promise<Contribution[]>((resolve) => {
          release = resolve;
        }),
    );

    const results = Promise.all([deferred.cache.get(), deferred.cache.get(), deferred.cache.get()]);
    release([contribution()]);

    expect(await results).toEqual([[contribution()], [contribution()], [contribution()]]);
    expect(deferred.state.calls).toBe(1);
  });

  test('serves stale data on a failed refresh and throttles the next retry', async () => {
    const { cache, state, setBehaviour } = setup({ ttlMs: 1_000 });
    await cache.get();
    state.now += 5_000;
    setBehaviour(async () => {
      throw new Error('boom');
    });

    expect(await cache.get()).toEqual([contribution()]);
    expect(state.calls).toBe(2);

    await cache.get();
    expect(state.calls).toBe(2);
  });

  test('rethrows when the cache is cold and the fetch fails', async () => {
    const { cache } = setup({
      fetch: async () => {
        throw new Error('cold');
      },
    });

    await expect(cache.get()).rejects.toThrow('cold');
  });
});

describe('formatContributionsSummary', () => {
  test.each([
    [1, 1, '1 PR / 1 repository'],
    [4, 4, '4 PRs / 4 repositories'],
    [5, 5, '5 PRs / 5 repositories'],
    [21, 21, '21 PRs / 21 repositories'],
    [22, 22, '22 PRs / 22 repositories'],
    [7, 4, '7 PRs / 4 repositories'],
  ])('formats %i PRs over %i repositories in English', (prs, repos, expected) => {
    expect(formatContributionsSummary(contributionsFor(prs, repos), 'en')).toBe(expected);
  });

  test.each([
    [1, 1, '1 PR / 1 репозиторий'],
    [4, 4, '4 PR / 4 репозитория'],
    [5, 5, '5 PR / 5 репозиториев'],
    [21, 21, '21 PR / 21 репозиторий'],
    [22, 22, '22 PR / 22 репозитория'],
    [11, 11, '11 PR / 11 репозиториев'],
    [7, 4, '7 PR / 4 репозитория'],
  ])('uses Russian plurals for %i PRs over %i repositories', (prs, repos, expected) => {
    expect(formatContributionsSummary(contributionsFor(prs, repos), 'ru')).toBe(expected);
  });
});

describe('ContributionsController', () => {
  function controller(items: Contribution[] | Error) {
    const cache: ContributionsCache = {
      get: async () => {
        if (items instanceof Error) throw items;
        return items;
      },
    };
    return new ContributionsController(cache);
  }

  test('renders both statuses, the command bar, and escapes the payload', async () => {
    const items = [
      contribution({ repo: 'oven-sh/bun', title: 'fix: use <T> & "quotes"', date: '2026-11-20T09:00:00Z', status: 'open' }),
      contribution({
        number: 9,
        repo: 'honojs/hono',
        url: 'https://github.com/honojs/hono/pull/9',
        date: '2026-09-14T10:00:00Z',
        status: 'merged',
      }),
    ];
    const response = await controller(items).get(new Request('http://localhost/api/contributions', { headers: { 'HX-Request': 'true' } }));

    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const html = await response.text();
    expect(html).toStartWith('<div class="log">');
    expect(html).toContain('<code><span>$</span> gh search prs --author=begenchgeldyev</code>');
    expect(html).toContain('2 PRs / 2 repositories');
    expect(html).toContain('<span class="status status-open">open</span>');
    expect(html).toContain('<span class="status status-merged">merged</span>');
    expect(html).toContain('fix: use &lt;T&gt; &amp; &quot;quotes&quot;');
    expect(html).not.toContain('<T>');
    expect(html).toContain('<time datetime="2026-11-20T09:00:00Z">2026-11-20</time>');
    expect(html).not.toContain('log-dot');
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  test('renders the Russian labels and the localized summary', async () => {
    const items = [contribution({ status: 'open' }), contribution({ number: 2, status: 'merged', date: '2026-09-14T10:00:00Z' })];
    const ru = await controller(items).get(
      new Request('http://localhost/api/contributions', { headers: { 'HX-Request': 'true', cookie: 'lang=ru' } }),
    );
    const html = await ru.text();
    expect(html).toContain('<span class="status status-open">открыт</span>');
    expect(html).toContain('<span class="status status-merged">смержен</span>');
    expect(html).toContain('2 PR / 1 репозиторий');
  });

  test('renders the localized empty state', async () => {
    const empty = await controller([]).get(new Request('http://localhost/api/contributions', { headers: { 'HX-Request': 'true' } }));
    expect(await empty.text()).toBe('<p class="contributions-empty" role="status">No contributions yet.</p>');

    const emptyRu = await controller([]).get(
      new Request('http://localhost/api/contributions', { headers: { 'HX-Request': 'true', cookie: 'lang=ru' } }),
    );
    expect(await emptyRu.text()).toBe('<p class="contributions-empty" role="status">Пока нет контрибуций.</p>');
  });

  test('answers plain requests with JSON', async () => {
    const response = await controller([contribution()]).get(new Request('http://localhost/api/contributions'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contributions: [contribution()] });
  });

  test('answers 502 when the cache rejects', async () => {
    const response = await controller(new Error('cold')).get(new Request('http://localhost/api/contributions'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'contributions unavailable' });
  });
});
