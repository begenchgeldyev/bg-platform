import { describe, expect, test } from 'bun:test';
import { servePublicAsset } from '../site';
import { projectArt } from './project-art';

const WIDTHS = [400, 800, 1200, 1448];

describe('project cover delivery', () => {
  test('known artwork exposes AVIF and WebP srcsets over a working PNG fallback', async () => {
    for (const name of ['pantheon', 'bg-platform', 'interpreter']) {
      const png = `/public/projects/${name}-pixel.png`;
      const base = `/public/projects/${name}-pixel`;
      const candidates = (format: string) => WIDTHS.map((width) => `${base}-${width}.${format} ${width}w`).join(', ');
      expect(projectArt(png)).toEqual({
        image: png,
        width: 1448,
        height: 1086,
        avif: candidates('avif'),
        webp: candidates('webp'),
        motion: { card: `${base}-motion-480.webp`, page: `${base}-motion-960.webp` },
      });
      for (const width of WIDTHS) {
        for (const extension of ['avif', 'webp']) {
          const response = await servePublicAsset(`${base}-${width}.${extension}`);
          expect(response.status).toBe(200);
          const bytes = new Uint8Array(await response.arrayBuffer());
          expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe(extension === 'avif' ? 'avif' : 'WEBP');
          expect(response.headers.get('Content-Type')).toBe(`image/${extension}`);
        }
      }
      const fallback = await servePublicAsset(png);
      expect(fallback.status).toBe(200);
      expect(fallback.headers.get('Content-Type')).toBe('image/png');
      for (const width of [480, 960]) {
        const response = await servePublicAsset(`${base}-motion-${width}.webp`);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/webp');
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
        let frames = 0;
        let duration = 0;
        let loop: number | undefined;
        for (let offset = 12; offset + 8 <= bytes.length; ) {
          const kind = bytes.toString('ascii', offset, offset + 4);
          const size = bytes.readUInt32LE(offset + 4);
          const data = offset + 8;
          if (kind === 'VP8X') {
            expect(bytes.readUIntLE(data + 4, 3) + 1).toBe(width);
            expect(bytes.readUIntLE(data + 7, 3) + 1).toBe((width * 3) / 4);
          }
          if (kind === 'ANIM') loop = bytes.readUInt16LE(data + 4);
          if (kind === 'ANMF') {
            frames++;
            duration += bytes.readUIntLE(data + 12, 3);
          }
          offset = data + size + (size % 2);
        }
        expect(loop).toBe(0);
        expect(frames).toBeGreaterThanOrEqual(name === 'pantheon' ? 90 : 191);
        expect(duration).toBe(name === 'pantheon' ? 5999 : 7999);
        expect(bytes.length).toBeLessThan(width === 480 ? 1_000_000 : 3_000_000);
      }
    }
  });

  test('supports valid uploads and external images without guessing derivative URLs', () => {
    for (const url of ['https://example.com/cover.png', 'data:image/png;base64,AAAA', '/public/other.png']) {
      expect(projectArt(url)).toEqual({ image: url, width: 4, height: 3 });
    }
    for (const url of ['__proto__', '//example.com/image', 'javascript:alert(1)', 'data:text/html,unsafe']) {
      expect(projectArt(url)).toBeNull();
    }
  });
});
