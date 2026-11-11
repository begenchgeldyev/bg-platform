// Records real animation frames in both directions, including the changing word width.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/page-transitions';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const report = [];
try {
  const context = await browser.newContext({
    baseURL: process.env.SITE_URL || 'http://localhost:8625',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  let phase = 'dwell';
  const captures: { phase: string; timestamp: number; data: string }[] = [];
  cdp.on('Page.screencastFrame', (event: { sessionId: number; data: string; metadata: { timestamp: number } }) => {
    if (phase !== 'dwell') captures.push({ phase, timestamp: event.metadata.timestamp, data: event.data });
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  for (const title of ['AI Engineer', 'Software Engineer']) {
    phase = title === 'AI Engineer' ? 'software-to-ai' : 'ai-to-software';
    const frames = await page.evaluate(async (target: string) => {
      const word = document.querySelector('[data-role-word]') as HTMLElement;
      const label = document.querySelector('[data-role-label]') as HTMLElement;
      const button = document.querySelector('[data-role-switch]') as HTMLButtonElement;
      const width = () => {
        const range = document.createRange();
        range.selectNodeContents(word);
        return word.getBoundingClientRect().width || range.getBoundingClientRect().width;
      };
      const start = performance.now();
      const frames = [{ time: 0, word: word.textContent, width: width() }];
      button.focus();
      button.click();
      await new Promise<void>((resolve) => {
        function sample(now: number) {
          frames.push({ time: now - start, word: word.textContent, width: width() });
          if (label.textContent === target) resolve();
          else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      return frames;
    }, title);
    report.push({ title, frames });
    phase = 'dwell';
    await page.waitForTimeout(500);
  }
  await Bun.write(`${output}/hero-directions.json`, JSON.stringify(report, null, 2));
  for (const direction of report) {
    const frames = direction.frames;
    const first = frames[0];
    const last = frames.at(-1);
    assert.ok(last.time >= 550 && last.time <= 850, `${direction.title}: a visible, consistent scramble duration`);
    const early = frames.find((frame: { time: number }) => frame.time >= 40);
    assert.ok(Math.abs(early.width - first.width) < Math.abs(last.width - first.width) / 2, `${direction.title}: no immediate width jump`);
    assert.ok(new Set(frames.map((frame: { word: string }) => frame.word)).size >= 8);
    const glyphWidth = last.width / direction.title.split(' ')[0].length;
    assert.ok(
      frames.every((frame: { word: string; width: number }) => frame.word.length >= Math.round(frame.width / glyphWidth) - 1),
      'scramble fills the changing slot instead of leaving a large blank gap',
    );
  }
  console.log('PASS both scramble directions have gradual width and comparable visible duration');
  await cdp.send('Page.stopScreencast');
  const frameIndex = [];
  for (const [index, capture] of captures.entries()) {
    const path = `${output}/hero-${capture.phase}-${String(index).padStart(3, '0')}.png`;
    await Bun.write(path, Buffer.from(capture.data, 'base64'));
    frameIndex.push({ path, phase: capture.phase, timestamp: capture.timestamp });
  }
  await Bun.write(`${output}/hero-frame-index.json`, JSON.stringify(frameIndex, null, 2));
  assert.ok(captures.some((frame) => frame.phase === 'software-to-ai'));
  assert.ok(captures.some((frame) => frame.phase === 'ai-to-software'));
  await context.close();
} finally {
  await browser.close();
}
