# Noto Sans Mono (Cyrillic subsets)

`NotoSansMono-Cyrillic.woff2` and `NotoSansMono-CyrillicExt.woff2` are the
variable-weight (100–900) Cyrillic and Cyrillic-extended subsets that Google Fonts
serves for Noto Sans Mono. They are self-hosted so the site no longer needs a
render-blocking `fonts.googleapis.com` stylesheet.

OpenTUI Mono covers Latin, so only the Cyrillic subsets are vendored; Latin,
Greek, Vietnamese and symbol subsets are intentionally omitted.

Downloaded on 2026-11-13 from this Google Fonts CSS request (desktop Chrome UA):

```
https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wght@100..900&display=swap
```

- `NotoSansMono-Cyrillic.woff2` — 18,616 B, `unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`
  (`...AZ2fvCj7dc.woff2`)
- `NotoSansMono-CyrillicExt.woff2` — 65,916 B, `unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F`
  (`...AZ2d_Cj7dc.woff2`)

The matching `@font-face` blocks live in `apps/site/components/shared-head.html`
and keep Google's `unicode-range` values, so the browser only downloads a subset
when the page actually contains those characters.

Upstream: https://github.com/notofonts/latin-greek-cyrillic
License: SIL Open Font License 1.1 — see `NotoSansMono-OFL.txt`
(`https://raw.githubusercontent.com/google/fonts/main/ofl/notosansmono/OFL.txt`)
