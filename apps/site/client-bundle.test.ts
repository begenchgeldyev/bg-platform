import { describe, expect, spyOn, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildClientBundle, serveClientBundle } from './client-bundle';

const BUNDLE_URL = 'http://localhost/assets/ask-chat.js';

describe('client bundle', () => {
  test('stable alias ignores Range and stale If-Range while preserving full responses and revalidation', async () => {
    const bundle = await buildClientBundle();
    if (!bundle) throw new Error('client build failed');
    for (const method of ['GET', 'HEAD']) {
      for (const range of ['bytes=0-9', 'bytes=999999999-']) {
        const request = new Request(BUNDLE_URL, { method, headers: { range, 'if-range': '"old-revision"' } });
        const response = serveClientBundle(request, bundle);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-range')).toBeNull();
        expect(response.headers.get('accept-ranges')).toBeNull();
        expect(response.headers.get('cache-control')).toBe('no-cache');
        expect(await response.text()).toBe(method === 'HEAD' ? '' : bundle.code);
        if (method === 'HEAD') expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(bundle.code)));
        request.headers.set('if-none-match', bundle.etag);
        const cached = serveClientBundle(request, bundle);
        expect(cached.status).toBe(304);
        expect(await cached.text()).toBe('');
      }
    }
  });

  test('bundle revisions get different URLs and a stale URL never returns new code', async () => {
    const entry = join(import.meta.dir, 'client/performance-test-entry.ts');
    try {
      await Bun.write(entry, 'console.log("revision one");');
      const first = await buildClientBundle(entry);
      await Bun.write(entry, 'console.log("revision two");');
      const second = await buildClientBundle(entry);
      if (!first || !second) throw new Error('fixture bundle failed');
      expect(second.url).not.toBe(first.url);
      expect(serveClientBundle(new Request(`http://localhost${first.url}`), second).status).toBe(404);
      expect(await serveClientBundle(new Request(`http://localhost${first.url}`), first).text()).toContain('revision one');
    } finally {
      await rm(entry, { force: true });
    }
  });

  test('serves exact content-addressed bytes with HEAD, revalidation and ranges, never aliases a different hash', async () => {
    const bundle = await buildClientBundle();
    expect(bundle).not.toBeNull();
    if (!bundle) throw new Error('client build failed');
    const hash = new Bun.CryptoHasher('sha256').update(bundle.code).digest('hex');
    expect(bundle.url).toBe(`/assets/ask-chat.${hash}.js`);
    const request = (method = 'GET', headers: Record<string, string> = {}) =>
      new Request(`http://localhost${bundle.url}`, { method, headers });
    const get = serveClientBundle(request(), bundle);
    expect(get.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await get.text()).toBe(bundle.code);
    for (const method of ['GET', 'HEAD']) {
      const cached = serveClientBundle(request(method, { 'if-none-match': `"old", W/${bundle.etag}` }), bundle);
      expect(cached.status).toBe(304);
      expect(cached.headers.get('content-type')).toContain('text/javascript');
      expect(await cached.text()).toBe('');
      const range = serveClientBundle(request(method, { range: 'bytes=0-9' }), bundle);
      expect(range.status).toBe(206);
      expect(await range.text()).toBe(method === 'HEAD' ? '' : bundle.code.slice(0, 10));
      const head = serveClientBundle(request('HEAD'), bundle);
      expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(bundle.code)));
      expect(await head.text()).toBe('');
    }
    const forged = serveClientBundle(
      new Request(`http://localhost/assets/ask-chat.${'0'.repeat(64)}.js`, { headers: { 'if-none-match': '*' } }),
      bundle,
    );
    expect(forged.status).toBe(404);
    expect(forged.headers.get('cache-control') ?? '').not.toContain('immutable');
  });

  test('bundles the chat client and revalidates with its ETag', async () => {
    const bundle = await buildClientBundle();
    expect(bundle).not.toBeNull();
    const first = serveClientBundle(new Request(BUNDLE_URL), bundle);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/javascript');
    expect(first.headers.get('cache-control')).toBe('no-cache');
    expect(await first.text()).toContain('/api/ask');
    const again = serveClientBundle(new Request(BUNDLE_URL, { headers: { 'If-None-Match': first.headers.get('etag') ?? '' } }), bundle);
    expect(again.status).toBe(304);
  });

  test('answers 503 and logs the failure when the bundle cannot be built', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await buildClientBundle('/nonexistent/entry.ts')).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
    expect(serveClientBundle(new Request(BUNDLE_URL), null).status).toBe(503);
  });
});
