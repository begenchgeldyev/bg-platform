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
