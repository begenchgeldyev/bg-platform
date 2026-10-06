import { join } from 'node:path';

const CV_FRAGMENT = join(import.meta.dir, '..', 'pages', 'cv.html');

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(entity: string, name: string): string {
  if (Object.hasOwn(NAMED_ENTITIES, name)) {
    return NAMED_ENTITIES[name];
  }
  if (name.startsWith('#')) {
    const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
      return String.fromCodePoint(code);
    }
  }
  return entity;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();
}

let cached: Promise<string> | undefined;

async function readCvText() {
  return htmlToText(await Bun.file(CV_FRAGMENT).text());
}

export function loadCvText(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    return readCvText();
  }
  cached ??= readCvText();
  return cached;
}
