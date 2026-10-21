import { describe, expect, test } from 'bun:test';
import { readJsonWithin, refuseCrossSite, refuseNonJson } from './requests';

function post(headers: Record<string, string>, body?: BodyInit): Request {
  return new Request('http://localhost/api/thing', { method: 'POST', headers, body });
}

describe('refuseCrossSite', () => {
  test('refuses a cross-site request', async () => {
    const res = refuseCrossSite(post({ 'sec-fetch-site': 'cross-site' }));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: 'cross-site requests are not allowed' });
  });

  test('allows a same-origin request', () => {
    expect(refuseCrossSite(post({ 'sec-fetch-site': 'same-origin' }))).toBeNull();
  });

  test('allows a request without the header', () => {
    expect(refuseCrossSite(post({}))).toBeNull();
  });
});

describe('refuseNonJson', () => {
  test('allows a JSON content type with parameters', () => {
    expect(refuseNonJson(post({ 'content-type': 'application/json; charset=utf-8' }))).toBeNull();
  });

  test('refuses a plain text content type', async () => {
    const res = refuseNonJson(post({ 'content-type': 'text/plain' }));
    expect(res?.status).toBe(415);
    expect(await res?.json()).toEqual({ error: 'requests must be JSON' });
  });

  test('refuses a request without a content type', () => {
    expect(refuseNonJson(post({}))?.status).toBe(415);
  });
});

describe('readJsonWithin', () => {
  test('parses a JSON body within the limit', async () => {
    const result = await readJsonWithin(post({ 'content-type': 'application/json' }, '{"a":1}'), 10);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  test('refuses a declared content length over the limit', async () => {
    const result = await readJsonWithin(post({ 'content-type': 'application/json', 'content-length': '999999' }, '{"a":1}'), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({ error: 'request is too large' });
    }
  });

  test('refuses a streamed body over the limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('x'.repeat(20)));
        stream.close();
      },
    });
    const result = await readJsonWithin(post({ 'content-type': 'application/json' }, body), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({ error: 'request is too large' });
    }
  });

  test('refuses unparsable JSON', async () => {
    const result = await readJsonWithin(post({ 'content-type': 'application/json' }, '{oops'), 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({ error: 'request body must be JSON' });
    }
  });
});
