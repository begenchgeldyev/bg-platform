# Terminal Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public header `>_` open the existing portfolio Terminal in a VS Code–style bottom panel with native fullscreen and a viewport fallback.

**Architecture:** The site renderer opts eligible documents into one Terminal, sharing the prompt markup and emulator with the inline home presentation. A deferred Terminal controller owns the dock and uses the existing native fullscreen path; panel-only styles and fallback state stay outside the home layout.

**Tech Stack:** Bun, TypeScript SSR, HTML/CSS, browser DOM and Fullscreen API, Bun tests and Playwright.

**Spec:** [`docs/superpowers/specs/2026-11-26-terminal-panel-design.md`](../specs/2026-11-26-terminal-panel-design.md)

## Global Constraints

- The home page keeps its inline Terminal and current fullscreen behavior. Admin keeps its current header and does not get a panel.
- Enable it on Resume, Logs, Projects, and individual Project pages. Localize the title and control labels in English and Russian.
- Commands, completion, transcript, and assistant requests keep their existing behavior. Do not store Terminal content in browser storage.
- No new routes, dependencies, authorization changes, assistant configuration, VS Code–style tabs, resize handles, or terminal sessions are part of this change.
- Do not access production or make Admin writes for verification. Exercise the local `help` command, not the AI endpoint.

## Review Focus

- A touch user can find and open the header button without losing the whole view to an automatically opened keyboard (Task 1).
- Without JavaScript, the page stays usable and never exposes an inert launcher (Task 1).
- A short viewport still lets visitors reach the final page content above the opened panel (Task 1).
- Closing while a native fullscreen request is pending cannot leave a fullscreen or fallback panel open afterward (Task 2).
- Closing native fullscreen does not let the fullscreen-change handler steal focus back from the launcher (Task 2).

## File Map

| Path | Responsibility |
| --- | --- |
| `apps/site/site.ts`, `apps/site/components/document.html`, `apps/site/i18n.ts` | Route eligibility, panel slot, localized SSR values |
| `apps/site/pages/index.html`, `apps/site/pages/index.ru.html`, new `apps/site/components/terminal-body.html` | Shared transcript and prompt, with unchanged inline home layout |
| New `apps/site/components/terminal-panel.html`, new `apps/site/public/terminal-panel.css` | Dock toolbar, layout, scrolling, viewport fallback |
| `apps/site/components/terminal-chrome.html`, new `apps/site/components/terminal-fullscreen-button.html` | Home toolbar and the single shared four-corner/restore button |
| `apps/site/public/terminal-fullscreen.js`, `apps/site/components/terminal-emulator.html` | Open/close and expansion controller; existing commands and assistant wiring |
| `apps/site/site.test.ts`, new `apps/site/tests/terminal-panel.browser.ts` | SSR and dock behavior coverage; `apps/site/tests/fullscreen.browser.ts` guards home behavior |
| `GLOSSARY.md`, `docs/architecture.md`, `apps/site/tests/README.md` | Updated Terminal scope, SSR placement, and verification instructions |

## Task 1: Mount and toggle the shared Terminal dock

**Interfaces:** Keep `renderPage(pathname, lang, req?)` and `renderDynamicPage(req, page)` unchanged. Replace the layout icon boolean with `headerTerminal?: 'decorative' | 'panel'`: Admin gets `'decorative'`, home omits it, and eligible public presets use `'panel'`. The dock DOM contract is `[data-terminal-launcher]` (`aria-controls="terminal-wrap"`, `aria-expanded="false"`), `#terminal-wrap[data-terminal-panel]`, `[data-terminal-close]`, and the existing `#terminal-body` and `#terminal-input`. The controller toggles `hidden`, `aria-expanded`, and `data-terminal-panel-open` on `document.body`; it leaves the mounted Terminal intact.

- [ ] **Write failing tests.** In `apps/site/site.test.ts`, add `renders one hidden Terminal panel on eligible public pages ($lang)` and `leaves the home Terminal inline and Admin decorative`. Use `renderPage()` for `/resume`, `/logs`, `/projects`, and `/`, and `renderDynamicPage()` with fixture HTML and a language cookie for `/projects/7`. For Admin, render an English fixture with a Russian cookie. Inspect element attributes with `HTMLRewriter` or a selector-specific match, not whole-document text for selectors used by scripts. Core assertions:

  ```ts
  expect(launcher).toMatchObject({ hidden: true, controls: 'terminal-wrap', expanded: 'false', label: expected.toggle });
  expect(panel).toMatchObject({ hidden: true, label: expected.title });
  expect(closeLabel).toBe(expected.close);
  expect(inputCount).toBe(1);
  expect(assistantAssetCount).toBe(1);
  // Home: no launcher or dock; one inline input. Admin: neither launcher nor input nor assistant asset.
  ```

- [ ] **Write failing browser checks** in `apps/site/tests/terminal-panel.browser.ts`. Use the existing Playwright entry pattern (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `SITE_URL`); use `/resume` for interactions and abort and count every `/api/ask` request. Desktop asserts a click opens without navigation, keyboard Enter/Space toggles, focus moves to the prompt then returns to the launcher on close, and button events fire only once. On the first open run `help`, fill `cat phi`, close and reopen, then assert one `[data-user-message]`, the retained draft, Tab completion to `cat philosophy.txt`, and ArrowUp recalls `help`. Assert `Escape` does not close the regular dock, and `Shift+Tab` can leave it. At `320 × 568` with touch emulation and the Russian cookie, tap the launcher, assert focus on the close control rather than the prompt and the dock stays within the viewport without horizontal overflow. Scroll the page to the end and assert `footer.bottom <= panel.top + 1` and `panel.bottom` matches the viewport bottom within one pixel. With `javaScriptEnabled: false` both launcher and dock are hidden and the page heading remains visible. Reload an open desktop dock to assert it starts closed and its prior draft/output is gone. Assert zero AI requests and page errors.

- [ ] **Run red.** From the root, run `bun test apps/site/site.test.ts` and the new browser file with the environment documented in `apps/site/tests/README.md` and a local server; expect missing launcher/panel assertions, not a missing browser or server.

- [ ] **Render the shared Terminal.** Move the identical body markup to `terminal-body.html`, keeping existing element IDs, classes, and both exact intro/prompt translations from the home fragments. Add `resolveIncludes` values for the body used by both home fragments and use the same rendered partial for the dock. Use `renderTerminalPanel(lang: Lang): Promise<string>` from `renderLayout()` to populate `{{ terminalPanel }}` after the footer only for `'panel'`; don't rely on recursive includes. Mount the existing emulator partial once after the corresponding markup. Add these `StringKey` values:

  | Key | English | Russian |
  | --- | --- | --- |
  | `terminalTitle` | Terminal | Терминал |
  | `terminalToggleLabel` | Toggle terminal | Переключить терминал |
  | `terminalCloseLabel` | Close terminal | Закрыть терминал |

  Render a real hidden header button and a hidden labelled dock region; preserve the decorative Admin span. Ensure both render from the same eligibility preset.

- [ ] **Wire the dock in `apps/site/public/terminal-fullscreen.js`.** For the panel presentation, register before revealing the launcher. Primary `mousedown` plus activation `click` (`detail === 0` or a touch/pen pointer) must produce one action; ignore non-primary mouse buttons. Focus the prompt with `{ preventScroll: true }` for fine-pointer/keyboard opens and the panel close control for touch opens; closing returns focus to the launcher. In the emulator, skip automatic prompt focus while the Terminal is hidden and keep dock toolbar clicks from focusing the prompt. Keep command completion and the existing keyboard contract, including `Shift+Tab` to reach the dock controls. Keep close/dock initialization independent of fullscreen support.

- [ ] **Lay out the dock in `apps/site/public/terminal-panel.css`.** Set the dock height to `min(24rem, 45dvh)`, fix it to the viewport bottom, and use the same height for an open-only body scroll reserve. Keep chrome compact with 44px controls; use a flex, independently scrollable transcript with `min-height: 0`, retaining the existing prompt. Use site token colors; ensure panel/launcher `hidden` is not overridden by utility display rules. No overlay or focus trap. The fullscreen control is added in Task 2.

- [ ] **Run green.** Run `bun test apps/site/site.test.ts apps/site/terminal-completion.test.ts`; rerun `terminal-panel.browser.ts` locally. Expect zero failures and no AI requests.

- [ ] **Commit** the dock and shared rendering with `git commit -m "feat(site): open the shared Terminal in a bottom panel"` (stage only Task 1 files).

## Task 2: Share fullscreen and finish acceptance

**Interfaces:** Share `terminal-fullscreen-button.html` between home and panel, preserving `[data-terminal-fullscreen]`, `[data-expand-icon]`, `[data-restore-icon]`, `[data-fullscreen-status]`, `aria-pressed`, and the current English/Russian expand/restore labels. The controller uses `document.fullscreenElement === terminal` for native mode and `data-terminal-viewport` on the panel for fallback. The public open-state contract from Task 1 does not change.

- [ ] **Extend the failing checks.** Add an SSR assertion for the pane's Expand label (`Expand terminal` / `Развернуть терминал`). In `terminal-panel.browser.ts`, cover native entry via the four-corner control, exit via Escape and Restore, and close while native fullscreen is active. Keep the draft through entry/exit and assert `launcher.aria-expanded === 'true'` until a close, then `launcher.aria-expanded === 'false'` and launcher focus. In distinct contexts simulate unsupported fullscreen by defining `document.fullscreenEnabled` as false and simulate denial with a rejected `requestFullscreen()`. In both, assert no native fullscreen element, `data-terminal-viewport` present when expanded, bounds match the viewport, `aria-pressed === 'true'`, and Escape and Restore (`Restore terminal` / `Свернуть терминал`) remove the fallback while leaving the dock open. For the pending race, defer a mocked rejection of `requestFullscreen()`, close before delivering it, release the promise, then assert the panel is hidden, no viewport fallback is applied, focus is on the launcher, and reopening starts docked. Keep checking zero AI calls and page errors.

- [ ] **Run red.** Run `bun test apps/site/site.test.ts` and the focused `terminal-panel.browser.ts` against the local site; expect fullscreen assertions to fail (Task 1 dock checks still pass).

- [ ] **Implement shared fullscreen behavior.** Extract the existing button SVGs to the shared control template and supply localized `terminalExpandLabel` and `terminalRestoreLabel` from `i18n.ts` to both presentations. Keep the home toolbar hidden when native fullscreen is unavailable and keep its existing rejected-request status. In `terminal-fullscreen.js`, distinguish panel mode from home. The panel attempts `requestFullscreen()` under user activation and falls back only on unavailability or rejection; apply `data-terminal-viewport` for that mode and style the fixed panel to fill the viewport. Derive Restore labels, `aria-pressed`, and icon visibility from either active mode. Escape restores only an expanded Terminal; native external exits update state via `fullscreenchange`. Keep the dock mounted across transitions and use the existing native focus rules unless closing. For close during expansion, mark closure before awaiting any native operation and suppress fallback and fullscreen-related refocus while closing. If native exit fails and the Terminal is still fullscreen, keep the panel available, announce the existing error, and clear the closing flag so the user can retry. Otherwise close and return focus to the launcher exactly once.

- [ ] **Update the repository docs.** Extend the Terminal definition in `GLOSSARY.md` to cover inline home and docked public presentations; update the SSR/assistant description in `docs/architecture.md` and list `terminal-panel.browser.ts` in `apps/site/tests/README.md`.

- [ ] **Run green and verify.** Run `bun run test`, `bun run lint`, and `bun run lint:boundaries`. Start the canonical local preview with `bun run preview` and run `bun run test:browser`, including the existing `fullscreen` and new `terminal-panel` checks. Expect both focused browser checks to pass; identify any unrelated suite failures separately. Follow the repo's preview handoff: share `http://localhost:8613` if that preview is still serving this checkout, and note production remains unchanged until merge.

- [ ] **Commit** the fullscreen and documentation changes with `git commit -m "feat(site): expand and restore the docked Terminal"` (stage only Task 2 files).
