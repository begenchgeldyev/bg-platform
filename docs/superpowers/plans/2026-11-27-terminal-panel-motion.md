# Terminal Panel Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing dock a short slide and fade without delaying its controls or changing fullscreen.

**Architecture:** Let CSS transition `transform`, `opacity`, and discrete `display` where supported. Let the existing controller continue setting logical open state synchronously and use `inert` to keep a closing panel non-interactive.

**Tech Stack:** Bun, CSS transitions, DOM, Playwright.

**Spec:** [Terminal dock motion](../specs/2026-11-26-terminal-panel-motion-design.md)

## Global Constraints

- Use `180ms ease` for the transform and `150ms ease` for opacity, gated by reduced-motion preference.
- Do not animate page layout, the home Terminal, or fullscreen entry and restore. Do not send AI requests.

## Review Focus

- Open and close reach intermediate physical positions and final states.
- Closing returns focus and disables interaction immediately, even while visible.
- Reopening in flight keeps the existing prompt, draft and transcript.
- Reduced motion shows and hides immediately without tying focus to transition events.
- Fullscreen and mobile behavior keep their existing coverage.

## Task 1: Animate the existing dock

**Files:** `apps/site/public/terminal-panel.css` (motion), `apps/site/public/terminal-fullscreen.js` and `apps/site/components/terminal-panel.html` (interaction state), `apps/site/tests/terminal-panel.browser.ts` (regressions).

**Interfaces:** Preserve `[data-terminal-panel]`, `hidden`, `aria-expanded`, and `[data-terminal-panel-open]`. Add `inert` while closed; keep dock transition selectors out of native and viewport fullscreen.

- [ ] Add Playwright checks that sample a running open and close transform at its midpoint, assert the launcher has focus and the panel is inert during close, reverse an in-flight close and assert draft/transcript retention, and assert reduced-motion openings/closings produce no transition. Use the existing `help` command and AI request guard.
- [ ] Run `terminal-panel.browser.ts` against the local preview and confirm it fails because the dock has no transitions.
- [ ] Keep the dock positioned while hidden and conditionally enable CSS discrete display with a `@starting-style` entry. Toggle `inert` along with the existing open state; do not add timers or transition-event dependencies. Make existing tests that require a final resting position wait for it.
- [ ] Rerun `terminal-panel.browser.ts`, `fullscreen.browser.ts`, `bun run test`, and `bun run lint`. Expect both browser suites and both Bun commands to pass.
- [ ] Commit as `feat(site): animate the Terminal dock`.
