---
status: accepted
date: 2026-10-06
source: docs/superpowers/specs/2026-10-06-terminal-ai-ask-design.md, commit 5023892
---

# The assistant is grounded in the CV page text and calls the provider directly

Every answer is built from one document: the CV page, converted to plain text, cached in production and prepended to the instructions. The model is called through AI SDK 7 against OpenAI directly rather than through the Vercel AI Gateway, and the whole request is refused when `OPENAI_API_KEY` is unset. Embeddings and a vector store were rejected — there is one short document, and retrieval would add an index to keep in sync for no gain in answer quality. The consequence is that the CV page is the single source of truth: editing that page changes what the assistant knows, and there is nowhere else to add knowledge.
