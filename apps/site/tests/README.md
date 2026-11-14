# Site icon runtime checks

The shared head serves static open-eye PNGs without JavaScript. With JavaScript,
only the 32px and 192px links blink after a randomized 4–7-second idle: eyes close
for 150ms, with a 10% chance of a second blink after a 150ms open gap. Hidden tabs
hold closed eyes and cancel timers; returning opens the eyes immediately and
starts a fresh idle. Reduced motion disables timed blinks, including when the
preference changes, but retains visibility-driven states. Closed frames are
preloaded; a failed preload preserves the static open-eye links. The 16px and
opaque Apple touch icons stay static. Browser icon selection and tab-strip repaint
are browser-dependent, so link updates do not guarantee visible animation.

All six site icon image URLs share `?v=portrait-blink-1`, including static hrefs
and runtime open/closed data references. This bypasses older cached portraits so
returning visitors do not blink between different portrait generations. Bump the
version consistently across all six URLs when replacing the portrait assets.

```sh
bun test apps/site/favicon-blink.test.ts
```

These deterministic Bun tests execute the shipped deferred script with controlled
timers, randomness, image preloads, visibility and reduced-motion preferences.
They cover single/double blink timing, cancellation at every phase, stale callbacks,
repeated events, initial hidden/reduced-motion state, preload failure, unrelated
links, and static no-JavaScript markup shared by public pages and admin. They do
not establish actual browser tab-strip repaint or image HTTP availability; those
require separate HTTP checks and real-browser visual acceptance. The 16px icon and
Apple touch icon remain static even when the runtime is enabled.

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
