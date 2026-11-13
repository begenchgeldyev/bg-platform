// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/hero-centering.browser.ts
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
try {
  for (const lang of ['en', 'ru']) {
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({
        baseURL: process.env.SITE_URL || 'http://localhost:8625',
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      await context.addCookies([{ name: 'lang', value: lang, url: process.env.SITE_URL || 'http://localhost:8625' }]);
      const page = await context.newPage();
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const measurements = [];
      for (const title of ['Software', 'AI']) {
        if (title === 'AI') await page.locator('[data-role-switch]').click();
        measurements.push(
          await page.evaluate(() => {
            const word = document.querySelector('[data-role-word]');
            const engineer = word?.nextElementSibling;
            const bounds = [word, engineer].map((element) => {
              const range = document.createRange();
              range.selectNodeContents(element as Node);
              return range.getBoundingClientRect();
            });
            const hero = document.querySelector('[data-hero-role]')?.getBoundingClientRect() as DOMRect;
            const heading = document.querySelector('h1')?.getBoundingClientRect() as DOMRect;
            return {
              title: word?.textContent,
              visibleCenter: (bounds[0].left + bounds[1].right) / 2,
              heroCenter: hero.left + hero.width / 2,
              height: heading.height,
            };
          }),
        );
      }
      console.log(JSON.stringify({ lang, width, measurements }));
      for (const measurement of measurements)
        assert.ok(
          Math.abs(measurement.visibleCenter - measurement.heroCenter) <= 2,
          `${lang}/${width}/${measurement.title}: full visible phrase is centered`,
        );
      assert.equal(measurements[0].height, measurements[1].height);
      assert.equal(await page.locator('[data-role-controls], [data-role-pause]').count(), 0, 'no helper row or reserved spacing');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
