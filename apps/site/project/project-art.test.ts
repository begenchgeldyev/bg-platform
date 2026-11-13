import { describe, expect, test } from 'bun:test';
import { servePublicAsset } from '../site';
import { projectArt } from './project-art';

describe('project cover delivery', () => {
  test('known lossless alternatives exist and are served as WebP, with intact PNG fallbacks', async () => {
    for (const name of ['pantheon', 'bg-platform', 'interpreter']) {
      const png = `/public/projects/${name}-pixel.png`;
      const art = projectArt(png);
      expect(art).toEqual({ image: png, webp: `/public/projects/${name}-pixel.webp`, width: 1448, height: 1086 });
      for (const extension of ['webp', 'png']) {
        const response = await servePublicAsset(`/public/projects/${name}-pixel.${extension}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe(`image/${extension}`);
      }
    }
  });

  test('supports valid uploads and external images without guessing derivative URLs', () => {
    for (const url of ['https://example.com/cover.png', 'data:image/png;base64,AAAA', '/public/other.png']) {
      expect(projectArt(url)).toEqual({ image: url, webp: undefined, width: 4, height: 3 });
    }
    for (const url of ['__proto__', '//example.com/image', 'javascript:alert(1)', 'data:text/html,unsafe']) {
      expect(projectArt(url)).toBeNull();
    }
  });
});
