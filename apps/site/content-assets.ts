import { extname, join, normalize, sep } from 'node:path';

export const CONTENT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

type AssetBody = Blob & { slice(start?: number, end?: number): Blob };
type ContentAsset = { url: string; body: Blob; etag: string };

function hasSlice(body: Blob): body is AssetBody {
  return 'slice' in body && typeof body.slice === 'function';
}

export function contentHash(bytes: string | Uint8Array) {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

export function hashedUrl(path: string, hash: string) {
  return path.replace(/\.(css|js)$/, `.${hash}.$1`);
}

export class ContentAssets {
  private readonly assets = new Map<string, Promise<ContentAsset>>();

  constructor(private readonly root: string) {}

  private async load(path: string): Promise<ContentAsset | null> {
    if (!/^\/public\/[\w./-]+\.(css|js)$/.test(path)) return null;
    const relative = path.slice('/public/'.length);
    const filePath = normalize(join(this.root, relative));
    if (!filePath.startsWith(`${this.root}${sep}`) || normalize(relative) !== relative || relative.split('/').includes('..')) return null;
    const cached = this.assets.get(path);
    if (cached) return cached;
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    const pending = file.bytes().then((bytes) => {
      const hash = contentHash(bytes);
      const type = extname(path) === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
      return { url: hashedUrl(path, hash), body: new Blob([bytes], { type }), etag: `"${hash}"` };
    });
    this.assets.set(path, pending);
    return pending;
  }

  async url(path: string): Promise<string> {
    return (await this.load(path))?.url ?? path;
  }

  async get(path: string): Promise<ContentAsset | null> {
    const match = /^(\/public\/.+)\.([a-f0-9]{64})\.(css|js)$/.exec(path);
    if (!match) return null;
    const asset = await this.load(`${match[1]}.${match[3]}`);
    return asset?.url === path ? asset : null;
  }
}

export async function rewriteAssetUrls(html: string, resolve: (path: string) => Promise<string>): Promise<string> {
  return new HTMLRewriter()
    .on('script[src], link[rel="stylesheet"][href]', {
      async element(element) {
        const attribute = element.tagName === 'script' ? 'src' : 'href';
        const value = element.getAttribute(attribute);
        const match = value?.match(/^(\/public\/[^?#]+\.(?:css|js)|\/assets\/ask-chat\.js)([?#].*)?$/);
        if (!match) return;
        const resolved = await resolve(match[1]);
        if (resolved !== match[1]) element.setAttribute(attribute, resolved + (match[2] ?? ''));
      },
    })
    .transform(new Response(html))
    .text();
}

export function isNotModified(req: Request | undefined, etag: string) {
  return (
    req?.headers
      .get('if-none-match')
      ?.split(',')
      .some((candidate) => {
        const tag = candidate.trim();
        return tag === '*' || tag === etag || tag === `W/${etag}`;
      }) ?? false
  );
}

function parseSingleRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

export function assetResponse(body: Blob, headers: Headers, req?: Request): Response {
  headers.set('Accept-Ranges', 'bytes');
  if (isNotModified(req, headers.get('etag') ?? '')) return new Response(null, { status: 304, headers });
  const rangeHeader = req?.headers.get('range');
  if (rangeHeader && body.size > 0) {
    const range = parseSingleRange(rangeHeader, body.size);
    if (range === 'unsatisfiable') {
      headers.set('Content-Range', `bytes */${body.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      if (!hasSlice(body)) throw new TypeError('Asset body does not support byte ranges');
      headers.set('Content-Length', String(range.end - range.start + 1));
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${body.size}`);
      return new Response(req?.method === 'HEAD' ? null : body.slice(range.start, range.end + 1), { status: 206, headers });
    }
  }
  if (req?.method === 'HEAD') {
    headers.set('Content-Length', String(body.size));
    return new Response(null, { headers });
  }
  return new Response(body, { headers });
}
