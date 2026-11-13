---
status: accepted
date: 2026-09-23
source: docs/superpowers/specs/2026-09-22-i18n-language-switching-design.md
---

# Russian lives in parallel `*.ru.html` fragments, not a key catalogue

Every public page has a Russian sibling fragment next to the English one, chosen by `localizedFragmentFile()`; only a short UI string table goes through `t()`. Key-based extraction into a translation catalogue was rejected because the pages are prose, and prose does not survive being chopped into keys, reviewed as a diff of one-line strings, or read by a writer. The consequence is two files per page that must be kept in step by hand, and a database whose project content stays English-only: the catalog is authored, not translated.
