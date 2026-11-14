# Glossary

The vocabulary of `begenchgeldyev`: a personal portfolio site whose project catalog the owner edits from a browser. These are the canonical words. Code, UI copy and future documents should use them, and the `_Avoid_` lists name the words that previously meant the same thing.

## Language

### Product

**Resume**:
The owner's professional summary for prospective employers, presented as a web page and a downloadable PDF. Both are formats of the same summary. Russian: «Резюме».
_Avoid_: CV, curriculum vitae

**Project**:
One entry in the portfolio catalog: a name, and optionally a description, a body, an image, an icon and tags. Only the name is required.
_Avoid_: entry, portfolio entry, work, works, item

**Hidden**:
A project the owner has switched off. A hidden project is absent from the public list and JSON, and its page answers 404. The admin form shows the inverse of this flag as a visibility toggle, so "published" means "not hidden".
_Avoid_: unpublished, draft, private, visibility (as a stored property)

**Image**:
The picture on a project's card and page, stored with the project as a data URL.
_Avoid_: photo, thumbnail, cover, screenshot

**Icon**:
The Material Symbol name stored on a project. When it is empty the icon is Automatic: guessed from the project's name and description when the page is rendered.
_Avoid_: logo, glyph, symbol

**Site icon**:
The portrait identifying the site in browser tabs and bookmarks, distinct from a project's Icon.
_Avoid_: project icon (when referring to the site), logo

**Tags**:
Free-text labels on a project, stored on the project itself and shown on its card.
_Avoid_: stack, stack lines, skills, keywords, topics

**Language**:
The visitor's reading language: English, the default, or Russian. It belongs to the visitor, not to a page, and it never appears in the URL.
_Avoid_: locale, lang code, translation

**Owner**:
The one person allowed to edit projects, and the only identity the site authenticates.
_Avoid_: user, admin

**Terminal**:
The home page's assistant prompt: an intro line, a `>` prompt and a text input, plus the transcript of what has been asked. It is the only place a visitor talks to the assistant.
_Avoid_: console, chat window, shell, REPL

**Prompt line**:
The terminal's single input line: the `>` prompt followed by the text input. Typing goes there, and replies are appended above it.
_Avoid_: command bar, input field, textbox, composer

### Architecture

**Admin**:
The owner-only editing page at `/admin`. English only, never cached, never indexed.
_Avoid_: dashboard, CMS, back office, panel

**Session**:
The owner's signed `bg_session` cookie. Its claims are the owner's identity and an expiry, and there is no server-side session store.
_Avoid_: login token, JWT, auth cookie, token store

**Secret**:
`ADMIN_SECRET`, the owner's password and the session signing key at once. Rotating it invalidates every existing session.
_Avoid_: password (when the signing role is meant), API key

**Policy**:
A stored rule that allows or denies an action on a resource for a subject that matches a condition. Its effect is allow or deny; deny wins, and no match means deny.
_Avoid_: rule, permission, ACL entry, grant

**Subject**:
The identity a policy is evaluated against: the session's owner, with its role and attributes. A request without a session evaluates as a viewer.
_Avoid_: user, principal, actor

**PEP / PDP / PIP**:
The three parts of authorization. The PEP asks (`canAccess`, `enforce`), resolving the subject and loading policies; the PDP decides (`evaluate`) as a pure function; the PIP loads subjects and policies from the database.
_Avoid_: auth middleware, guard, gatekeeper, interceptor

**Virtual tools**:
The `whoami`, `ls`, `cat` and `projects` commands the assistant may run. They read the site, not a shell and not a filesystem.
_Avoid_: shell, sandbox, tool calls, commands

**Grounding**:
The Resume page's text, plus the read-only virtual site lookups the assistant may make. Nothing comes from an index and nothing is fetched from the web.
_Avoid_: knowledge base, RAG, index, training data, embeddings
