import { join } from 'node:path';

export type ClientBundle = { code: string; etag: string };

const ENTRY = join(import.meta.dir, 'client', 'main.ts');

export async function buildClientBundle(entry = ENTRY): Promise<ClientBundle | null> {
  try {
    const result = await Bun.build({ entrypoints: [entry], target: 'browser', minify: true });
    const [output] = result.outputs;
    if (!output) {
      console.error('ask-chat: the client bundle has no output');
      return null;
    }
    const code = await output.text();
    return { code, etag: `"${Bun.hash(code).toString(36)}"` };
  } catch (error) {
    console.error('ask-chat: building the client bundle failed', error);
    return null;
  }
}

export function serveClientBundle(req: Request, bundle: ClientBundle | null): Response {
  if (!bundle) {
    return new Response('assistant is unavailable', { status: 503 });
  }
  const headers = { 'Cache-Control': 'no-cache', ETag: bundle.etag };
  if (req.headers.get('if-none-match') === bundle.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(bundle.code, { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } });
}
