# Design tokens

The visual vocabulary of the site. Read it before changing anything visual; it exists because the same choices kept getting re-invented by guesswork. Values are defined in `apps/site/tailwind.config.js` and `apps/site/styles/tailwind.css`; this page names them and when to reach for which.

## Colour

One accent for the whole site: neon green `--accent-rgb: 0 255 65` (`--accent: rgb(var(--accent-rgb))`). Tailwind maps it to `primary`, `primary-container`, `tertiary`, `surface-tint` and the `primary-fixed*` names, so `text-primary-container` and `bg-primary-container` are the normal way to use it. In hand-written CSS, use `var(--accent)`.

- Colour the accent through the token. A hardcoded green (`#65c77c`, `#00ff41`) is the recurring bug: it drifts from the accent in the word **Engineer**, which is the reference green.
- Text on an accent fill is `#0a0a0a` (`on-primary-container`).
- Surfaces, darkest first: `background` `#0a0a0a`, `surface-container-lowest` `#0e0e0e`, `surface` `#131313`, `surface-container` `#201f1f`, `surface-container-high` `#2a2a2a`, `surface-variant` `#353534`.
- Text: `on-surface` `#f2f1f0`, muted `on-surface-variant` `#d1d1d1`, borders `outline` `#aaaaaa` and `outline-variant` `#505050`. Most borders are `border-outline-variant/30`.
- Secondary (dates, hints) is warm `#ffd393`; error `#ffb4ab` on `error-container` `#93000a`.

## Shape

- `rounded` and the default are `0.125rem`; `rounded-lg` is `0.25rem`.
- Terminal cards, code blocks and the hero call-to-action buttons all use the `rounded-lg` 4px radius. A control next to the terminal copies the terminal's radius.
- `rounded-full` is for pills and status chips only.

## Type

One monospace stack everywhere: OpenTUI Mono, then Noto Sans Mono for Cyrillic. All four Tailwind families (`headline`, `body`, `label`, `mono`) resolve to it, so the site never mixes a second typeface.

- Body and navigation: `text-[15px]`. Labels and metadata: `text-[11px]` to `text-[13px]`. Tiny chrome: `text-[9px]` to `text-[10px]`.
- Headings: `text-2xl` on mobile, `md:text-[22px]` in page headers. The hero name is `clamp(1.5rem, 7.6vw, 6rem)`.
- Weights: 400 for prose, 700 for labels, buttons and names.

## Layout

- The header and footer share one container: `max-w-7xl mx-auto px-5 sm:px-8`. Anything that should line up with them uses the same three classes.
- `main` is full width (`[&>main]:w-full`); pages own their inner measure (`max-w-3xl`, `max-w-5xl`).
- The document is `min-h-dvh flex flex-col` and `main` is `flex-1`, so the footer sits at the bottom of short pages. Do not add page-specific offsets to fix a footer that looks high; fix the content height.
- There is exactly one footer, `apps/site/components/footer.html`, `py-2 md:py-4`. It has no variants.

## Motion

- Colour and opacity transitions: 150ms ease. Transforms on controls: 180ms ease.
- Interactive lists that animate text (skill tags) wait `HOVER_DELAY_MS = 200` before starting, so a mouse passing through does nothing.
- Every animation sits behind `prefers-reduced-motion` (Tailwind `motion-reduce:` or a media query). Reduced motion removes the movement, not the state change.

