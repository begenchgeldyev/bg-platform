# Browser motion checks

Run the site on a free port, then use the existing Playwright and Chromium installation.
These scripts intentionally do not add a workspace dependency or install browsers.

```sh
PORT=8625 bun --hot apps/site/server.ts
export SITE_URL=http://localhost:8625
export PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
export CHROMIUM_PATH=/usr/bin/chromium
export EVIDENCE_DIR=/tmp/opencode/page-transitions

bun apps/site/tests/motion.browser.ts
bun apps/site/tests/hero.browser.ts
bun apps/site/tests/hero-centering.browser.ts
bun apps/site/tests/hero-directions.browser.ts
bun apps/site/tests/fullscreen.browser.ts
```

- `motion`: real native navigation/animation samples, EN/RU desktop/mobile, history,
  language, terminal, reduced motion, links/forms/downloads, admin exclusion.
  The project-list API has an explicit empty fixture because local Postgres is optional.
  Existing missing `/api/logs` and favicon responses are recorded in the report.
  Unsupported transitions are simulated by ignoring the opt-in CSS rule, **not** by
  claiming that current Chromium is an unsupported browser.
- `hero`: actual scrambling, keyboard/mouse, persistent Escape pause, hover/focus,
  rapid requests, stable layout, real offscreen and pagehide/BFCache lifecycle,
  reduced motion and static no-JS fallback. The hidden-tab event boundary is synthetic
  because headless Chromium does not reliably reproduce tab visibility.
- `hero-centering`: visible text-run centers and unchanged height for both titles at
  320/390/768/1440px in both locales.
- `hero-directions`: timestamped real frames/widths for both directions and CDP PNG
  frame captures. This avoids requiring Playwright's optional video encoder.
- `fullscreen`: real Fullscreen API entry/restore, Escape/Enter/Space, desktop/touch
  emulation, focus/scroll, Tab completion, unsupported and rejected-request boundaries.

Screenshots/JSON stay in `EVIDENCE_DIR`, never in the repository. Transition frame
screenshots pause the actual CSS animations at 0/70/160ms; a separate unpaused run
asserts intermediate opacity/movement and normal completion. Hero PNG frames use
the real running animation, not substituted text or slowed production timers.
