---
status: accepted
date: 2026-10-06
source: docs/superpowers/specs/2026-10-06-terminal-ai-ask-design.md, commit 5023892
---

# The assistant answers from the Resume and read-only site lookups, never from an index

Every request builds its instructions from the Resume page's text, converted to plain text and cached in production, and the model may additionally call four read-only virtual site tools: `whoami`, `ls`, and `cat` over a handful of static virtual documents, plus `projects` over the public project rows — capped at four tool calls and three model steps, with no URL fetching and no shell. The model is called through AI SDK 7 against OpenAI directly rather than through the Vercel AI Gateway, and the whole feature is off when `OPENAI_API_KEY` is unset. Embeddings and a vector store were rejected: the corpus is one page plus a few public project rows, all already present in the process or in Postgres, so an index would be another thing to keep in sync for no gain in answer quality. The consequence is that the assistant's knowledge changes only by editing the Resume page, the static virtual files or the public projects.
