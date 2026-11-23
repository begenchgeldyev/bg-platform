import type { Lang } from '../i18n';

export type ContributionStatus = 'merged' | 'open';

export type Contribution = {
  repo: string;
  title: string;
  url: string;
  number: number;
  date: string;
  status: ContributionStatus;
};

export const GITHUB_USER = 'begenchgeldyev';
export const CONTRIBUTION_LIMIT = 12;

export function contributionsQuery(user: string) {
  return `author:${user} is:pr is:public -user:${user}`;
}

export function contributionsUrl(user: string) {
  const params = new URLSearchParams({
    q: contributionsQuery(user),
    sort: 'updated',
    order: 'desc',
    per_page: '100',
  });
  return `https://api.github.com/search/issues?${params}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

const REPOSITORY_PATH = /\/repos\/([^/]+\/[^/]+)$/;

function toContribution(item: unknown): Contribution | null {
  if (!isRecord(item)) return null;

  const pullRequest = item.pull_request;
  const mergedAt = isRecord(pullRequest) ? nonEmptyString(pullRequest.merged_at) : null;
  const title = nonEmptyString(item.title);
  const url = nonEmptyString(item.html_url);
  const number = item.number;
  const repositoryUrl = nonEmptyString(item.repository_url);
  const repo = repositoryUrl?.match(REPOSITORY_PATH)?.[1];

  if (!title || !url) return null;
  if (!url.startsWith('https://github.com/')) return null;
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return null;
  if (!repo) return null;

  // Merged wins over open: a merged pull request is closed, so state alone cannot tell them apart.
  if (mergedAt) {
    return { repo, title, url, number, date: mergedAt, status: 'merged' };
  }

  const createdAt = item.state === 'open' ? nonEmptyString(item.created_at) : null;
  if (!createdAt) return null;

  return { repo, title, url, number, date: createdAt, status: 'open' };
}

export function normalizeContributions(payload: unknown, limit = CONTRIBUTION_LIMIT): Contribution[] {
  const items = isRecord(payload) ? payload.items : null;
  if (!Array.isArray(items)) return [];

  return items
    .map(toContribution)
    .filter((item): item is Contribution => item !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export type ContributionsFetcher = () => Promise<Contribution[]>;

export const GITHUB_TIMEOUT_MS = 8000;

type FetcherOptions = {
  user?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createGitHubContributionsFetcher({
  user = GITHUB_USER,
  token,
  fetchImpl = fetch,
  timeoutMs = GITHUB_TIMEOUT_MS,
}: FetcherOptions = {}): ContributionsFetcher {
  return async () => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'begenchgeldyev-site',
      'X-GitHub-Api-Version': '2026-03-10',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    // A stalled GitHub would otherwise hold the cache's single in-flight promise forever.
    const response = await fetchImpl(contributionsUrl(user), { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(`GitHub search failed: ${response.status}`);
    }

    const payload: unknown = await response.json();
    // A partial result set would silently drop contributions; the cache serves the previous list instead.
    if (isRecord(payload) && payload.incomplete_results === true) {
      throw new Error('GitHub search incomplete');
    }

    return normalizeContributions(payload);
  };
}

export type ContributionsCache = {
  get: () => Promise<Contribution[]>;
};

type CacheOptions = {
  fetch: ContributionsFetcher;
  ttlMs: number;
  now?: () => number;
};

export function createContributionsCache({ fetch, ttlMs, now = Date.now }: CacheOptions): ContributionsCache {
  let cached: { data: Contribution[]; fetchedAt: number } | null = null;
  let inFlight: Promise<Contribution[]> | null = null;

  function refresh() {
    const pending = fetch()
      .then((data) => {
        cached = { data, fetchedAt: now() };
        return data;
      })
      .catch((error: unknown) => {
        // Serving stale data with a fresh timestamp throttles retries of a failing API.
        if (cached) {
          cached = { data: cached.data, fetchedAt: now() };
          return cached.data;
        }
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    inFlight = pending;
    return pending;
  }

  return {
    async get() {
      if (cached && now() - cached.fetchedAt < ttlMs) return cached.data;
      if (inFlight) return inFlight;
      return refresh();
    },
  };
}

function russianPlural(count: number, forms: readonly [string, string, string]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const RU_REPO_FORMS = ['репозиторий', 'репозитория', 'репозиториев'] as const;

export function formatContributionsSummary(items: Contribution[], lang: Lang) {
  const prCount = items.length;
  const repoCount = new Set(items.map((item) => item.repo)).size;

  if (lang === 'ru') {
    return `${prCount} PR / ${repoCount} ${russianPlural(repoCount, RU_REPO_FORMS)}`;
  }

  const prs = prCount === 1 ? '1 PR' : `${prCount} PRs`;
  const repos = repoCount === 1 ? '1 repository' : `${repoCount} repositories`;
  return `${prs} / ${repos}`;
}
