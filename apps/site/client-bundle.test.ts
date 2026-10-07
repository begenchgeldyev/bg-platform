import { describe, expect, spyOn, test } from 'bun:test';
import { buildClientBundle, serveClientBundle } from './client-bundle';

const BUNDLE_URL = 'http://localhost/assets/ask-chat.js';

describe('client bundle', () => {
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
