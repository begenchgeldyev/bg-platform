import { describe, expect, test } from 'bun:test';

describe('approved project covers layout', () => {
  test('both language pages use the same uniform gallery, not ordinal bento spans', async () => {
    for (const name of ['projects.html', 'projects.ru.html']) {
      const html = await Bun.file(new URL(`../pages/${name}`, import.meta.url)).text();
      expect(html).toContain('class="project-gallery"');
      expect(html).toContain('projects/gallery.html');
      expect(html).not.toContain('md:grid-cols-12');
      expect(html).not.toContain('min-h-screen');
    }
  });

  test('covers have native 4:3 space, full-color art and solid readable panels', async () => {
    const html = await Bun.file(new URL('../components/projects/gallery.html', import.meta.url)).text();
    expect(html).toContain('repeat(3, minmax(0, 1fr))');
    expect(html).toContain('aspect-ratio: 4 / 3');
    expect(html).toContain('image-rendering: pixelated');
    expect(html).toContain('.project-card:focus-within');
    expect(html).toContain('/public/projects-motion.js');
    expect(html).not.toMatch(/grayscale|line-clamp|scale\(/);
  });
});
