import { join } from 'node:path';
import { assetResponse, CONTENT_CACHE_CONTROL, contentHash, hashedUrl, isNotModified } from './content-assets';

export type ClientBundle = { code: string; etag: string; url: string };

const ENTRY = join(import.meta.dir, 'client', 'main.ts');
let currentBundle: Promise<ClientBundle | null> | undefined;

export function getClientBundle() {
  currentBundle ??= buildClientBundle();
  return currentBundle;
}

export async function buildClientBundle(entry = ENTRY): Promise<ClientBundle | null> {
  try {
    const result = await Bun.build({ entrypoints: [entry], target: 'browser', minify: true });
    const [output] = result.outputs;
    if (!output) {
      console.error('ask-chat: the client bundle has no output');
      return null;
    }
    const code = await output.text();
    const hash = contentHash(code);
    return { code, etag: `"${hash}"`, url: hashedUrl('/assets/ask-chat.js', hash) };
  } catch (error) {
    console.error('ask-chat: building the client bundle failed', error);
    return null;
  }
}

export function serveClientBundle(req: Request, bundle: ClientBundle | null): Response {
  const path = new URL(req.url).pathname;
  const stable = path === '/assets/ask-chat.js';
  if (!stable && path !== bundle?.url) return new Response('Not Found', { status: 404 });
  if (!bundle) {
    return new Response('assistant is unavailable', { status: 503 });
  }
  const headers = new Headers({
    'Cache-Control': stable ? 'no-cache' : CONTENT_CACHE_CONTROL,
    'Content-Type': 'text/javascript; charset=utf-8',
    ETag: bundle.etag,
  });
  if (stable) {
    if (isNotModified(req, bundle.etag)) return new Response(null, { status: 304, headers });
    if (req.method === 'HEAD') {
      headers.set('Content-Length', String(Buffer.byteLength(bundle.code)));
      return new Response(null, { headers });
    }
    return new Response(bundle.code, { headers });
  }
  return assetResponse(new Blob([bundle.code]), headers, req);
}
