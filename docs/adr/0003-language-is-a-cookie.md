---
status: accepted
date: 2026-09-23
source: docs/superpowers/specs/2026-09-22-i18n-language-switching-design.md, commit 80d1c3d
---

# The visitor's language lives in a cookie, never in the URL

`resolveLang()` reads one `lang` cookie and falls back to English; the toggle posts to `/api/lang`, which sets the cookie and reloads. URLs, page paths and SEO shape are identical in both languages. `Accept-Language` sniffing was rejected: the spec preferred predictability, and a header-derived language would make the same URL render differently for two visitors with no visible cause. The cost is that a Russian page cannot be linked to someone else — which is accepted, because the content is the same content in two readings, not two documents.
