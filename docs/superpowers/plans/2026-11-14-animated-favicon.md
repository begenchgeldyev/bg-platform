# Animated Favicon Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement the bounded tasks below. Track steps with checkboxes. Do not commit until checks pass.

**Goal:** Animate the portrait with stable blinks and a closed-eye hidden-tab state.

**Architecture:** Generate PNG states from one master portrait. A shared deferred script uses visibilitychange and cancellable timers to select open/closed 32px and 192px links, leaving the 16px icon static. No animated WebP is shipped.

**Tech Stack:** Bun, plain browser JavaScript, PNG asset processing using a pinned/documented local image tool if necessary.

**Spec:** User decisions in this conversation; the requirements below are the consolidated specification.

## Global Constraints
- Public pages and admin use the shared head. Apple touch icon stays static and opaque.
- Visible: blink every randomized 4–7 seconds, with an occasional double blink; closed hold 150ms, double-blink gap 150ms, double probability 10%.
- Hidden: immediately hold closed eyes and cancel all timers. Return: immediately open; restart blinking after a fresh 4–7s idle, with no blink during the first second.
- Reduced motion: disable timed blinks, retain visibility-driven open/closed state; react to preference changes.
- Use visibilitychange only, never window blur. No JavaScript means static open-eye links.
- Animate only 32px and 192px. Keep 16px static; actual browser icon selection and repaint are browser-dependent, not guaranteed.
- Preserve master pixels outside eye masks exactly. User approved eye-only derivation from the supplied closed reference rather than toggling mismatched portraits.
- Add Site icon to GLOSSARY.md and amend favicon-source.md. Commit the generator with the feature after verification; no push.

## Review Focus
- Tab hidden mid-blink: old callbacks must not reopen the hidden portrait.
- Repeated visibility events: never accumulate timer chains.
- Live reduced-motion changes: cancel a pending blink and restore the appropriate state.
- Missing assets or no JavaScript: retain a valid static icon, with no missing HTTP resources.
- Browser favicon repaint: inspect the real tab strip; DOM updates do not establish animation support.

## Task 1: Stable source frames and reproducible outputs
**Owner:** designer; coordinator validates generated artifacts.
**Files:** create `apps/site/scripts/favicon.ts` and asset tests; source inputs outside public in `apps/site/assets/favicon/`; generate public open/closed PNGs; update `apps/site/public/favicon-source.md`.
**Interfaces:** open URLs `/public/favicon-32.png`, `/public/icon-192.png`; closed URLs `/public/favicon-32-closed.png`, `/public/icon-192-closed.png`; static `/public/favicon-16.png` and `/public/apple-touch-icon.png`.
- [ ] Record dimensions and SHA-256 for open `/home/begench/Desktop/7c3b71d4-9f60-4c46-97b2-1aebe295a8a0.png` and closed reference `/home/begench/Desktop/27fa4243-92ec-43bc-83a2-fa3dac25251c.png`. Store reproducible input(s) outside public.
- [ ] Write failing checks for output sizes, rounded alpha, opaque Apple icon, and eye-only differences.
- [ ] Implement `bun apps/site/scripts/favicon.ts` with documented dependencies. Proposed master crop `(224,0,1024,800)`. Editable eye envelopes `(468,443,600,526)` and `(648,443,785,526)` in uncropped source coordinates. Proposed lids `(468,475,583,495)` and `(665,475,785,495)`. Designer may refine within these bounds after inspecting magnified proof; document exact treatment.
- [ ] Use master skin palette, hard-edged edits, nearest-neighbor scaling, final-size radius `size // 8`, metadata-free outputs. No new colors outside sampled palette.
- [ ] Run generator twice and compare hashes; run asset checks; produce magnified open/closed proof for user acceptance.

## Task 2: Shared visibility and blink controller
**Owner:** fixer after asset URL contract; coordinator validates behavior.
**Files:** create `apps/site/public/favicon-blink.js` and focused tests following existing test conventions; modify `apps/site/components/shared-head.html`.
**Interfaces:** mark only 32/192 icon links with explicit data attributes for their open and closed URLs. Load `/public/favicon-blink.js` with defer; 16 and apple links untouched by script.
- [ ] Write deterministic tests with controlled timers/randomness for the exact timing and state requirements above. Include all five Review Focus cases where automatable, initial hidden load, and unrelated link preservation.
- [ ] Confirm tests fail before implementing the controller.
- [ ] Implement one cancellable timer chain, visibility and matchMedia listeners, and state application to the marked links. Preload closed assets without replacing valid open links on load failure. No UA sniffing or framework.
- [ ] Run focused tests; confirm shared-head inclusion for public and admin responses and 200/image/png responses for every referenced image. Test no-JS open links.

## Task 3: Documentation and integrated acceptance
**Owner:** coordinator with bounded fixer follow-up if required.
**Files:** `GLOSSARY.md`, `apps/site/tests/README.md` if needed, job evidence files.
- [ ] Define Site icon separately from the project Icon field. Document generator command, hashes/crop, narrow eye-edit exception, timing, visibility and reduced-motion policy, and honest browser limits.
- [ ] Run `bun run lint`, repository tests using scripts discovered in package.json, focused asset/runtime checks, and HTTP checks. Record commands, exit statuses and base/commit in job evidence.
- [ ] Inspect magnified assets and actual Chrome/Firefox/Safari tab-strip behavior where browsers are available; keep unavailable browser checks explicitly open. Do not claim DOM tests prove repaint.
- [ ] Get user acceptance of the proof. Commit scoped feature files only after verified checks; record commit SHA and any explicitly accepted limitations.
