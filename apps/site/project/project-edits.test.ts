import { afterEach, describe, expect, test } from 'bun:test';

const sourceFile = Bun.file(new URL('../public/project-edits.js', import.meta.url));
const originalFetch = globalThis.fetch;
const originalReader = globalThis.FileReader;
const initial = {
  id: 7,
  name: 'Demo',
  description: null,
  content: '<p>Saved</p>',
  image: null,
  isHidden: false,
  icon: 'database',
  tags: ['Bun'],
};

async function session(project: typeof initial | null = initial) {
  // Loading a classic browser script this way also exercises the shipped artifact.
  const source = (await sourceFile.exists()) ? await sourceFile.text() : '';
  const create = new Function('window', `${source}; return window.createProjectEdits;`)({});
  expect(create).toBeFunction();
  return create({ project, limits: { maxImageBytes: 4 } });
}

function respond(value = initial, status = 200) {
  globalThis.fetch = (async () => Response.json({ project: value }, { status })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.FileReader = originalReader;
});

describe('project edits lifecycle', () => {
  test('fetch rejection is safe, keeps persisted state, and releases for retry', async () => {
    const edits = await session();
    globalThis.fetch = (async () => {
      throw new Error('private transport detail');
    }) as typeof fetch;
    const result = await edits.save({ name: 'Draft' });
    expect(result).toMatchObject({ ok: false, reason: 'network' });
    expect(result.message).not.toContain('private');
    expect(edits.project).toEqual(initial);
    respond({ ...initial, name: 'Normalized' });
    expect(await edits.save({ name: ' Draft ' })).toEqual({ ok: true, value: { ...initial, name: 'Normalized' } });
    expect(edits.project.name).toBe('Normalized');
  });

  test.each([
    'not json',
    '{}',
    '{"project":{"id":7}}',
    '{"project":{"id":8,"name":"Wrong"}}',
  ])('malformed success %s cannot commit and releases', async (body) => {
    const edits = await session();
    globalThis.fetch = (async () => new Response(body)) as typeof fetch;
    expect(await edits.save({ isHidden: true })).toMatchObject({ ok: false, reason: 'invalid-response' });
    expect(edits.project).toEqual(initial);
    respond();
    expect((await edits.save({ isHidden: false })).ok).toBe(true);
  });

  test('HTTP refusal has bounded safe copy and can retry', async () => {
    const edits = await session();
    globalThis.fetch = (async () => Response.json({ error: '<script>secret</script>'.repeat(1000) }, { status: 403 })) as typeof fetch;
    const result = await edits.save({ name: 'Draft' });
    expect(result).toMatchObject({ ok: false, reason: 'http' });
    expect(result.message.length).toBeLessThan(200);
    expect(result.message).not.toContain('secret');
    respond();
    expect((await edits.save({ name: 'Retry' })).ok).toBe(true);
  });

  test('reservation rejects overlapping save, delete and image read without stale commits', async () => {
    const edits = await session();
    let finish!: (response: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })) as typeof fetch;
    const saving = edits.save({ isHidden: true });
    expect(await edits.save({ name: 'Overlap' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await edits.remove()).toMatchObject({ ok: false, reason: 'busy' });
    expect(await edits.readImage(new File(['a'], 'a.png'))).toMatchObject({ ok: false, reason: 'busy' });
    finish(Response.json({ project: { ...initial, isHidden: true } }));
    expect((await saving).ok).toBe(true);
    expect(edits.project.isHidden).toBe(true);
  });

  test('PATCH sends only supplied fields and commits the server result, not the draft', async () => {
    const edits = await session();
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return Response.json({ project: { ...initial, isHidden: true, name: 'Canonical' } });
    }) as typeof fetch;
    const result = await edits.save({ isHidden: true });
    expect(request?.url).toBe('/api/projects/7');
    expect(request?.init?.method).toBe('PATCH');
    expect(JSON.parse(String(request?.init?.body))).toEqual({ isHidden: true });
    expect(result.value.name).toBe('Canonical');
    result.value.name = 'External mutation';
    expect(edits.project.name).toBe('Canonical');
  });

  test('new-project session switches to its returned id and deletion ends the session', async () => {
    const edits = await session(null);
    const requests: string[] = [];
    globalThis.fetch = (async (url, init) => {
      requests.push(`${init?.method} ${url}`);
      return init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({ project: initial }, { status: init?.method === 'POST' ? 201 : 200 });
    }) as typeof fetch;
    expect((await edits.save({ name: 'Demo' })).ok).toBe(true);
    expect((await edits.save({ name: 'Demo' })).ok).toBe(true);
    expect(await edits.remove()).toEqual({ ok: true, value: null });
    expect(await edits.save({ name: 'After delete' })).toMatchObject({ ok: false, reason: 'removed' });
    expect(requests).toEqual(['POST /api/projects', 'PATCH /api/projects/7', 'DELETE /api/projects/7']);
  });

  test('delete failures preserve persisted state and release for retry', async () => {
    const edits = await session();
    globalThis.fetch = (async () => {
      throw new Error('private detail');
    }) as typeof fetch;
    expect(await edits.remove()).toMatchObject({ ok: false, reason: 'network' });
    globalThis.fetch = (async () => new Response('no', { status: 403 })) as typeof fetch;
    expect(await edits.remove()).toMatchObject({ ok: false, reason: 'http' });
    expect(edits.project).toEqual(initial);
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    expect(await edits.remove()).toEqual({ ok: true, value: null });
  });

  test('oversized image is rejected before constructing FileReader for draft and immediate save', async () => {
    const edits = await session();
    let readers = 0;
    globalThis.FileReader = class {
      constructor() {
        readers++;
      }
    } as unknown as typeof FileReader;
    expect(await edits.readImage(new File(['12345'], 'large.png'))).toMatchObject({ ok: false, reason: 'image-size' });
    expect(await edits.save({ image: new File(['12345'], 'large.png') })).toMatchObject({ ok: false, reason: 'image-size' });
    expect(readers).toBe(0);
    respond();
    expect((await edits.save({ isHidden: true })).ok).toBe(true);
  });

  test('image reading reserves the session through immediate persistence and releases on abort', async () => {
    const edits = await session();
    let reader!: { result: string; onload: () => void; onabort: () => void };
    globalThis.FileReader = class {
      result = 'data:image/png;base64,YQ==';
      constructor() {
        reader = this as unknown as typeof reader;
      }
      readAsDataURL() {}
    } as unknown as typeof FileReader;
    const reading = edits.readImage(new File(['a'], 'a.png'));
    expect(await edits.remove()).toMatchObject({ ok: false, reason: 'busy' });
    reader.onabort();
    expect(await reading).toMatchObject({ ok: false, reason: 'image-read' });
    let finish!: (response: Response) => void;
    globalThis.fetch = ((_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ image: 'data:image/png;base64,YQ==' });
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as typeof fetch;
    const uploading = edits.save({ image: new File(['a'], 'a.png') });
    expect(await edits.save({ isHidden: true })).toMatchObject({ ok: false, reason: 'busy' });
    reader.onload();
    await Promise.resolve();
    await Promise.resolve();
    expect(await edits.remove()).toMatchObject({ ok: false, reason: 'busy' });
    finish(Response.json({ project: { ...initial, image: 'data:image/png;base64,YQ==' } }));
    expect((await uploading).ok).toBe(true);
  });
});
