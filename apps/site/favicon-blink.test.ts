import { describe, expect, test } from 'bun:test';
import { AdminController } from './admin/admin.controller';
import { renderPage } from './site';

const scriptFile = new URL('./public/favicon-blink.js', import.meta.url);
const headFile = new URL('./components/shared-head.html', import.meta.url);
const IMAGE_VERSION = 'portrait-blink-1';
const OPEN = [`/public/favicon-32.png?v=${IMAGE_VERSION}`, `/public/icon-192.png?v=${IMAGE_VERSION}`];
const CLOSED = [`/public/favicon-32-closed.png?v=${IMAGE_VERSION}`, `/public/icon-192-closed.png?v=${IMAGE_VERSION}`];
type Callback = () => void;

class Clock {
  now = 0;
  nextId = 0;
  maximumPending = 0;
  pending = new Map<number, { at: number; callback: Callback }>();

  setTimeout = (callback: Callback, delay: number) => {
    const id = ++this.nextId;
    this.pending.set(id, { at: this.now + delay, callback });
    this.maximumPending = Math.max(this.maximumPending, this.pending.size);
    return id;
  };

  clearTimeout = (id: number) => {
    this.pending.delete(id);
  };

  advance(ms: number) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.now = next[1].at;
      this.pending.delete(next[0]);
      next[1].callback();
    }
    this.now = end;
  }

  next() {
    expect(this.pending.size).toBe(1);
    const next = [...this.pending.values()][0];
    if (!next) throw new Error('Expected a pending timer');
    return next;
  }
}

class Link {
  constructor(public attributes: Record<string, string>) {}

  get dataset() {
    return {
      siteIconOpen: this.attributes['data-site-icon-open'],
      siteIconClosed: this.attributes['data-site-icon-closed'],
    };
  }

  get href() {
    return this.attributes.href;
  }

  set href(value: string) {
    this.attributes.href = value;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
}

function linksFrom(html: string) {
  return [...html.matchAll(/<link\b[^>]*>/g)].map(
    ([tag]) => new Link(Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))),
  );
}

async function runtime(options: { hidden?: boolean; reduced?: boolean; random?: number[]; preload?: boolean; noLinks?: boolean } = {}) {
  const clock = new Clock();
  const links = options.noLinks ? [] : linksFrom(await Bun.file(headFile).text());
  // Even marked non-icon links must not be mutated.
  links.push(new Link({ rel: 'stylesheet', href: '/unrelated.css', 'data-site-icon-open': '/x', 'data-site-icon-closed': '/y' }));
  links.push(new Link({ rel: 'icon', href: '/unrelated.png' }));
  const listeners = new Map<string, Callback>();
  const motionListeners = new Map<string, Callback>();
  const document = {
    hidden: options.hidden ?? false,
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('link[rel="icon"][data-site-icon-open][data-site-icon-closed]');
      return links.filter((link) => link.attributes.rel === 'icon' && link.dataset.siteIconOpen && link.dataset.siteIconClosed);
    },
    addEventListener: (event: string, callback: Callback) => listeners.set(event, callback),
  };
  const motion = {
    matches: options.reduced ?? false,
    addEventListener: (event: string, callback: Callback) => motionListeners.set(event, callback),
  };
  const images: FakeImage[] = [];
  class FakeImage {
    src = '';
    onload: Callback | null = null;
    onerror: Callback | null = null;
    constructor() {
      images.push(this);
    }
  }
  const randomValues = [...(options.random ?? [])];
  const fakeMath = Object.create(Math);
  fakeMath.random = () => randomValues.shift() ?? 0.5;
  const run = new Function('document', 'matchMedia', 'Image', 'setTimeout', 'clearTimeout', 'Math', await Bun.file(scriptFile).text());
  run(
    document,
    (query: string) => {
      expect(query).toBe('(prefers-reduced-motion: reduce)');
      return motion;
    },
    FakeImage,
    clock.setTimeout,
    clock.clearTimeout,
    fakeMath,
  );
  if (options.preload !== false) for (const image of images) image.onload?.();
  return {
    clock,
    links,
    images,
    listeners,
    motionListeners,
    icons: () => links.filter((link) => link.attributes.rel === 'icon' && link.dataset.siteIconOpen).map((link) => link.href),
    visibility(hidden: boolean) {
      document.hidden = hidden;
      listeners.get('visibilitychange')?.();
    },
    preference(reduced: boolean) {
      motion.matches = reduced;
      motionListeners.get('change')?.();
    },
  };
}

describe('site icon shared head and no-JavaScript fallback', () => {
  function checkHead(html: string) {
    const links = linksFrom(html);
    const icons = links.filter((link) => link.dataset.siteIconOpen);
    expect(icons.map((link) => link.href)).toEqual(OPEN);
    expect(icons.map((link) => link.dataset.siteIconOpen)).toEqual(OPEN);
    expect(icons.map((link) => link.dataset.siteIconClosed)).toEqual(CLOSED);
    expect(links.find((link) => link.attributes.sizes === '16x16')?.attributes).toEqual({
      rel: 'icon',
      type: 'image/png',
      sizes: '16x16',
      href: `/public/favicon-16.png?v=${IMAGE_VERSION}`,
    });
    expect(links.find((link) => link.attributes.rel === 'apple-touch-icon')?.attributes).toEqual({
      rel: 'apple-touch-icon',
      type: 'image/png',
      sizes: '180x180',
      href: `/public/apple-touch-icon.png?v=${IMAGE_VERSION}`,
    });
    expect(html).toContain('<script src="/public/favicon-blink.js" defer></script>');
  }

  test('keeps static open links without JavaScript', async () => {
    checkHead(await Bun.file(headFile).text());
  });

  test('versions all six image URLs consistently across static hrefs and runtime data references', async () => {
    const icons = linksFrom(await Bun.file(headFile).text()).filter((link) => ['icon', 'apple-touch-icon'].includes(link.attributes.rel));
    const references = icons.flatMap((link) =>
      [link.href, link.dataset.siteIconOpen, link.dataset.siteIconClosed].filter((value): value is string => Boolean(value)),
    );
    expect(references).toHaveLength(8);
    expect(new Set(references).size).toBe(6);
    for (const reference of references) {
      expect(new URL(reference, 'http://localhost').search).toBe(`?v=${IMAGE_VERSION}`);
    }
    for (const icon of icons.filter((link) => link.dataset.siteIconOpen)) {
      expect(icon.href).toBe(icon.dataset.siteIconOpen);
    }
  });

  test('includes the same contract on public pages in both languages and admin', async () => {
    for (const language of ['en', 'ru'] as const) {
      const response = await renderPage('/resume', language);
      expect(response?.status).toBe(200);
      checkHead(await (response as Response).text());
    }
    const controller = new AdminController({
      projectsRepository: { list: async () => [] },
      projectAccess: async () => 'visitor',
    });
    checkHead(await (await controller.page(new Request('http://localhost/admin'))).text());
  });
});

describe('site icon runtime', () => {
  test.each([0, 0.5, 0.9999])('randomizes the idle within 4–7s (random %s), holds closed for 150ms', async (random) => {
    const app = await runtime({ random: [random, 0.1, 0] });
    const idle = 4000 + random * 3000;
    expect(app.clock.next().at).toBe(idle);
    expect(app.icons()).toEqual(OPEN);
    app.clock.advance(idle - 1);
    expect(app.icons()).toEqual(OPEN);
    app.clock.advance(1);
    expect(app.icons()).toEqual(CLOSED);
    app.clock.advance(149);
    expect(app.icons()).toEqual(CLOSED);
    app.clock.advance(1);
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.next().at - app.clock.now).toBeCloseTo(4000);
    expect(app.clock.maximumPending).toBe(1);
  });

  test.each([0, 0.099999])('double blinks only below the 10%% threshold (%s), with a 150ms open gap', async (chance) => {
    const app = await runtime({ random: [0, chance, 0] });
    app.clock.advance(4000);
    expect(app.icons()).toEqual(CLOSED);
    app.clock.advance(150);
    expect(app.icons()).toEqual(OPEN);
    app.clock.advance(149);
    expect(app.icons()).toEqual(OPEN);
    app.clock.advance(1);
    expect(app.icons()).toEqual(CLOSED);
    app.clock.advance(149);
    expect(app.icons()).toEqual(CLOSED);
    app.clock.advance(1);
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.next().at - app.clock.now).toBe(4000);
    expect(app.clock.maximumPending).toBe(1);
  });

  test.each([
    0, 4000, 4150, 4300,
  ])('hiding cancels idle/closed/gap/second-closed timers at %sms, including already queued callbacks', async (elapsed) => {
    const app = await runtime({ random: [0, 0] });
    app.clock.advance(elapsed);
    const stale = app.clock.next().callback;
    app.visibility(true);
    expect(app.icons()).toEqual(CLOSED);
    expect(app.clock.pending.size).toBe(0);
    stale();
    app.clock.advance(60_000);
    expect(app.icons()).toEqual(CLOSED);
    expect(app.clock.pending.size).toBe(0);
    app.visibility(false);
    expect(app.icons()).toEqual(OPEN);
    const fresh = app.clock.next();
    stale();
    expect(app.clock.next()).toBe(fresh);
    expect(app.icons()).toEqual(OPEN);
    expect(fresh.at - app.clock.now).toBeGreaterThanOrEqual(4000);
    app.clock.advance(1000);
    expect(app.icons()).toEqual(OPEN);
  });

  test('repeated visibility events never accumulate timer chains and use only visibilitychange', async () => {
    const app = await runtime();
    expect([...app.listeners.keys()]).toEqual(['visibilitychange']);
    expect([...app.motionListeners.keys()]).toEqual(['change']);
    for (let i = 0; i < 20; i++) {
      const stale = app.clock.next().callback;
      app.visibility(false);
      stale();
      expect(app.clock.pending.size).toBe(1);
    }
    for (let i = 0; i < 20; i++) app.visibility(true);
    expect(app.icons()).toEqual(CLOSED);
    expect(app.clock.pending.size).toBe(0);
    app.visibility(false);
    app.clock.advance(60_000);
    expect(app.clock.maximumPending).toBe(1);
  });

  test('initial hidden load stays closed with no timers and opens immediately on return', async () => {
    const app = await runtime({ hidden: true });
    expect(app.icons()).toEqual(CLOSED);
    expect(app.clock.pending.size).toBe(0);
    app.visibility(false);
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.next().at).toBe(5500);
  });

  test.each([0, 4000, 4150, 4300])('live reduced motion cancels every phase at %sms without stale callbacks', async (elapsed) => {
    const app = await runtime({ random: [0, 0] });
    app.clock.advance(elapsed);
    const stale = app.clock.next().callback;
    app.preference(true);
    stale();
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.pending.size).toBe(0);
    app.visibility(true);
    app.preference(true);
    expect(app.icons()).toEqual(CLOSED);
    app.preference(false);
    expect(app.clock.pending.size).toBe(0);
    app.visibility(false);
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.next().at - app.clock.now).toBeGreaterThanOrEqual(4000);
    stale();
    expect(app.clock.pending.size).toBe(1);
  });

  test('initial reduced motion retains visibility changes; disabling it starts a fresh idle', async () => {
    const app = await runtime({ reduced: true });
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.pending.size).toBe(0);
    app.visibility(true);
    expect(app.icons()).toEqual(CLOSED);
    app.visibility(false);
    expect(app.icons()).toEqual(OPEN);
    app.preference(false);
    const stale = app.clock.next().callback;
    app.preference(false);
    stale();
    expect(app.clock.pending.size).toBe(1);
    expect(app.clock.next().at).toBe(5500);
  });

  test('preloads both closed frames before changing valid links, then uses current visibility/preference', async () => {
    const app = await runtime({ preload: false });
    expect(app.images.map((image) => image.src)).toEqual(CLOSED);
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.pending.size).toBe(0);
    app.images[0].onload?.();
    app.visibility(true);
    app.preference(true);
    expect(app.icons()).toEqual(OPEN);
    app.images[1].onload?.();
    expect(app.icons()).toEqual(CLOSED);
    expect(app.clock.pending.size).toBe(0);
    app.visibility(false);
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.pending.size).toBe(0);
  });

  test.each([0, 1])('a failed closed preload (%s) permanently preserves static open icons', async (failed) => {
    const app = await runtime({ preload: false, hidden: true });
    app.images[failed].onerror?.();
    for (const image of app.images) image.onload?.();
    app.visibility(false);
    app.preference(true);
    app.visibility(true);
    app.preference(false);
    app.clock.advance(60_000);
    expect(app.icons()).toEqual(OPEN);
    expect(app.clock.pending.size).toBe(0);
  });

  test('duplicate preload events cannot start early or accumulate timers', async () => {
    const app = await runtime({ preload: false });
    app.images[0].onload?.();
    app.images[0].onload?.();
    expect(app.clock.pending.size).toBe(0);
    app.visibility(true);
    app.visibility(false);
    app.images[1].onload?.();
    const fresh = app.clock.next();
    app.images[1].onload?.();
    expect(app.clock.next()).toBe(fresh);
    expect(app.icons()).toEqual(OPEN);
    expect(fresh.at - app.clock.now).toBe(5500);
  });

  test('never changes 16px, Apple, stylesheet, preload, or unrelated icon links', async () => {
    const app = await runtime();
    const others = app.links.filter((link) => !OPEN.includes(link.href));
    const original = others.map((link) => ({ ...link.attributes }));
    app.clock.advance(5500);
    expect(app.icons()).toEqual(CLOSED);
    app.visibility(true);
    app.visibility(false);
    expect(others.map((link) => link.attributes)).toEqual(original);
  });

  test('does nothing when no icon links are marked', async () => {
    const app = await runtime({ noLinks: true });
    expect(app.images).toEqual([]);
    expect(app.clock.pending.size).toBe(0);
    expect(app.listeners.size).toBe(0);
  });
});
