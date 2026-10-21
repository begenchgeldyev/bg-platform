# Project Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-protected `/admin` page where the owner creates, edits, hides and deletes projects (name, description, full text, tags, icon, photo). It is backed by a signed session that replaces today's forgeable email header and cookie.

**Architecture:**
- **Login:** `ADMIN_SECRET` mints an HMAC-signed `bg_session` cookie. `resolveEmail()` in `@bg/core` now reads only that cookie, so the existing ABAC (`canAccess`/`enforce`) keeps working unchanged.
- **Data:** projects gain `icon` and `tags` columns. Existing `Stack:` lines move into `tags` with a one-time SQL migration.
- **Controllers:** `ProjectController` authorizes its own writes through an injected `canEditProjects` check. Visitors never see hidden projects.
- **Admin page:** server-rendered with an inline client script, like the existing click-to-edit editor.

**Tech Stack:** Bun (`Bun.serve`, `bun:test`, `node:crypto` HMAC), Drizzle ORM + drizzle-kit (Postgres), htmx 4, Tailwind CDN. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-admin-projects-design.md`

## Global Constraints

- **Session cookie:** named `bg_session`, with `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, plus `; Secure` when `NODE_ENV === 'production'`.
- **Owner:** the email is `begenchgeldyev@gmail.com`. The password is `ADMIN_SECRET`; the session signing key is `ADMIN_SECRET`. With an unset or empty `ADMIN_SECRET`, every login fails and no session is valid.
- **Login rate limit:** 5 attempts per 15 minutes per client IP. Every attempt counts, and the limit is checked before the password, so a blocked client never learns whether a guess was right. This is stricter than the spec's "failed attempts".
- **Write guards:**
  - Cross-site (`sec-fetch-site: cross-site`) → 403 `cross-site requests are not allowed`.
  - Non-JSON → 415 `requests must be JSON`. DELETE has no body, so it gets the cross-site check only.
- **Write sizes:** body cap 4 MB; photo at most 2 MB decoded.
- **Error bodies:** always `{ "error": "<short message>" }`.
- **Photo values:** `null`/`''` (no photo), a `/public/…` path without `..`, or `data:image/(png|jpeg|webp|gif);base64,…`.
- **Icon:** `null` (Automatic) or one of the 20 names in `PROJECT_ICONS` (Task 6).
- **Hidden projects:** visitors never see them. They are left out of the HTML list and the JSON list, and their page is 404. The owner sees them everywhere.
- **Admin UI:** English only. Public pages keep EN/RU unchanged.
- **Approved visuals:** the `/projects` cards stay as approved. Only their tag and icon data sources change.
- **Repo conventions (CLAUDE.md):**
  - Bun APIs; htmx 4 syntax.
  - `onMouseDown` for controls, keeping keyboard access.
  - Biome clean on every touched or new file. Two files keep their existing tabs-vs-spaces diagnostic and must not be reformatted: `index*.html` and the old untouched pages.
- **Production:**
  - The database password was rotated on 2026-10-21 and lives only in the VPS's `infra/site.env`.
  - Postgres listens on the VPS's loopback only.
  - Never run the seed in production before Task 10 step 4.

## Review Focus

1. **Click-to-edit save after the change.** `components/projects/editor-script.html` sends `{name, description, image, content, isHidden}`, and that must leave `icon` and `tags` untouched. Pinned in Task 7 ("PATCH changes only the fields it receives").
2. **Logged in, but the `owner-full-access` policy is missing.** This is production between deploy and seed. `/admin` must say so instead of showing the login form again. Pinned in Task 8 ("explains a session without edit rights").
3. **Oversized photo or body.** It is refused with a readable 400, nothing is saved and nothing crashes. Pinned in Task 6 (2 MB photo) and Task 7 (photo over 2 MB, nothing saved).
4. **Forged, expired or garbage `bg_session` cookie.** It is treated as logged out and never errors. Pinned in Task 2.
5. **Patching or deleting a project that is already gone.** The response is 404 `project not found`, and the admin UI shows it. Pinned in Task 7.

---

### Task 1: Shared request helpers

**Files:**
- Create: `apps/site/http/requests.ts`, `apps/site/http/requests.test.ts`
- Move (`git mv`): `apps/site/ask/rate-limit.ts` → `apps/site/http/rate-limit.ts`, and `apps/site/ask/rate-limit.test.ts` → `apps/site/http/rate-limit.test.ts`
- Modify:
  - `apps/site/ask/ask.controller.ts`: import the helpers below. Delete its local `errorResponse` and `readBodyWithin` (lines 26–50), and replace its inline cross-site and JSON checks (lines 99–104) with `refuseCrossSite` and `refuseNonJson` in the same order. Behavior stays identical.
  - `apps/site/ask/ask.controller.test.ts` and `apps/site/app-container.ts`: update the rate-limit import path.

**Interfaces:**
- Produces, in `apps/site/http/requests.ts`:
  - `errorResponse(status: number, error: string, headers?: Record<string, string>): Response`, moved verbatim.
  - `readBodyWithin(req: Request, maxBytes: number): Promise<string | null>`, moved verbatim.
  - `refuseCrossSite(req: Request): Response | null`
  - `refuseNonJson(req: Request): Response | null`. It accepts any `content-type` that starts with `application/json`, case-insensitive.
  - `readJsonWithin(req: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }>`:
    - a declared `content-length` above the cap, or a streamed body above it → 400 `request is too large`;
    - unparsable JSON → 400 `request body must be JSON`.
- Produces, in `apps/site/http/rate-limit.ts`: `createRateLimiter` and `RateLimiter`, with the API unchanged.

- [ ] **Step 1: Write the failing tests** in `apps/site/http/requests.test.ts`:
  - `refuseCrossSite`: `sec-fetch-site: cross-site` → status 403 and body `{ error: 'cross-site requests are not allowed' }`; `same-origin` → `null`; header missing → `null`.
  - `refuseNonJson`: `application/json; charset=utf-8` → `null`; `text/plain` → 415 `{ error: 'requests must be JSON' }`; header missing → 415.
  - `readJsonWithin`:
    - `{"a":1}` → `{ ok: true, value: { a: 1 } }`;
    - `content-length: 999999` with cap 10 → 400 `request is too large`;
    - a streamed 20-byte body with no content-length and cap 10 → 400 `request is too large`;
    - `{oops` → 400 `request body must be JSON`.
- [ ] **Step 2: Run them and confirm they fail:** `bun test apps/site/http/requests.test.ts` should report that the module is not found.
- [ ] **Step 3: Implement** `apps/site/http/requests.ts`. Move rate-limit, then update the ask controller, its test and app-container.
- [ ] **Step 4: Run all tests:** `bun test` passes, at 62 + the new ones. The ask tests are unchanged and still pass.
- [ ] **Step 5: Lint:** `bunx biome check apps/site/http apps/site/ask apps/site/app-container.ts` is clean.
- [ ] **Step 6: Commit:** `git commit -m "refactor: share request guards and the rate limiter"`

### Task 2: Owner session and identity

**Files:**
- Create: `packages/core/auth/session.ts`, `packages/core/auth/session.test.ts`, `packages/core/abac/pep.test.ts`
- Modify:
  - `packages/core/abac/pep.ts`: `resolveEmail` returns `sessionEmail(req)` and nothing else.
  - `packages/core/index.ts`: add `export * from './auth/session';`.

**Interfaces:**
- Produces, in `packages/core/auth/session.ts`:
  - `SESSION_COOKIE = 'bg_session'`, `SESSION_MAX_AGE_SECONDS = 2_592_000`, `OWNER_EMAIL = 'begenchgeldyev@gmail.com'`.
  - `createSessionToken(secret: string, now?: number): string`:
    - format: `<expiresAtMs>.<hex HMAC-SHA256(key = secret, message = "owner:" + expiresAtMs)>`;
    - `expiresAtMs = now + SESSION_MAX_AGE_SECONDS * 1000`;
    - `now` defaults to `Date.now()`.
  - `isValidSessionToken(token: string, secret: string | undefined, now?: number): boolean`. It returns false when the secret is empty or undefined, the token is malformed, it has expired (`expiresAtMs <= now`), or the signature doesn't match. Compare signatures with `timingSafeEqual` on equal-length buffers.
  - `sessionEmail(req: Request, secret?: string): string | null`:
    - `secret` defaults to `process.env.ADMIN_SECRET`;
    - it reads `bg_session` from the `cookie` header;
    - it returns `OWNER_EMAIL` when the token is valid, otherwise `null`.
- Changes `resolveEmail(req: Request): string | null` so it equals `sessionEmail(req)`. The `x-user-email` header and the `dev-user-email` cookie are no longer read.

- [ ] **Step 1: Write the failing tests:**
  - `session.test.ts`:
    - 'accepts a fresh token': `isValidSessionToken(createSessionToken('s3cret', 1000), 's3cret', 2000)` is `true`.
    - 'rejects an expired token': with `now = 1000 + 2_592_000_000` it is `false`.
    - 'rejects a tampered signature': flip the last hex character → `false`.
    - 'rejects a token signed with another secret' → `false`.
    - 'never accepts anything without a secret': `isValidSessionToken(createSessionToken(''), '')` and `isValidSessionToken(createSessionToken('x'), undefined)` are both `false`.
    - 'rejects garbage': `''`, `'abc'`, `'123.'` and `'.deadbeef'` are all `false`.
    - 'sessionEmail reads the cookie among others': cookie `lang=ru; bg_session=<token>` with matching secret → `'begenchgeldyev@gmail.com'`; no cookie → `null`.
  - `pep.test.ts`. Set `process.env.ADMIN_SECRET = 'test-secret'` before the assertions.
    - 'ignores a spoofed x-user-email header': `resolveEmail(new Request('http://x/', { headers: { 'x-user-email': 'begenchgeldyev@gmail.com' } }))` is `null`.
    - 'ignores the old dev-user-email cookie': cookie `dev-user-email=begenchgeldyev%40gmail.com` → `null`.
    - 'returns the owner for a valid session': cookie `bg_session=${createSessionToken('test-secret')}` → `'begenchgeldyev@gmail.com'`.

  Importing `@bg/core` without `DATABASE_URL` is safe, because the connection is lazy.
- [ ] **Step 2: Run and confirm they fail:** `bun test packages/core` → FAIL.
- [ ] **Step 3: Implement** `session.ts`. Change `resolveEmail` and add the export.
- [ ] **Step 4: Run all tests:** `bun test` → all pass.
- [ ] **Step 5: Lint:** `bunx biome check packages/core/auth packages/core/abac packages/core/index.ts` is clean.
- [ ] **Step 6: Commit:** `git commit -m "fix(auth): trust only a signed owner session, not a client-set email"`

### Task 3: Login and logout endpoints

**Files:**
- Create: `apps/site/auth/auth.controller.ts`, `apps/site/auth/auth.controller.test.ts`
- Modify:
  - `apps/site/server.ts`:
    - `'/auth/login'` POST → `container.resolve(AuthController).login(req, clientIp(req, server))`;
    - `'/auth/logout'` POST → `.logout(req)`;
    - delete the old inline handlers at lines 40–56 and 66–71.
  - `apps/site/app-container.ts`: register `AuthController` with `{ adminSecret: process.env.ADMIN_SECRET, rateLimiter: createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }), secureCookies: process.env.NODE_ENV === 'production' }`.

**Interfaces:**
- Consumes:
  - Task 1: `refuseCrossSite`, `refuseNonJson`, `readJsonWithin`, `errorResponse`, `RateLimiter`.
  - Task 2: `createSessionToken`, `SESSION_COOKIE`, `SESSION_MAX_AGE_SECONDS`.
- Produces: `class AuthController`, with `constructor(deps: { adminSecret: string | undefined; rateLimiter: RateLimiter; secureCookies: boolean; now?: () => number })`.
  - `login(req: Request, clientIp: string): Promise<Response>`:
    1. Order: `refuseCrossSite` → `refuseNonJson` → `rateLimiter.take(clientIp)`. Over the limit: 429 `too many login attempts, try again later` with `Retry-After` in seconds.
    2. `readJsonWithin(req, 4096)`. The body's `secret` must be a string, otherwise 400 `secret is required`.
    3. A constant-time comparison against `adminSecret` (compare SHA-256 digests with `timingSafeEqual`). A mismatch, or a missing `adminSecret`, gives 403 `wrong password`.
    4. On success: 200 `{ ok: true }` with `Set-Cookie: bg_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, plus `; Secure` when `secureCookies`.
  - `logout(req: Request): Response`: `refuseCrossSite`, then 200 `{ ok: true }` with `Set-Cookie: bg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`, plus `; Secure` when `secureCookies`.

- [ ] **Step 1: Write the failing tests** in `auth.controller.test.ts`. JSON requests use `content-type: application/json`.
  - 'logs in with the right password': status 200. The `set-cookie` contains `bg_session=`, `HttpOnly`, `SameSite=Lax`, `Max-Age=2592000` and `Path=/`, and does not contain `Secure`. The cookie value passes `isValidSessionToken(value, 'pw')`.
  - 'marks the cookie Secure in production': with `secureCookies: true`, `set-cookie` contains `Secure`.
  - 'refuses a wrong password': 403 `{ error: 'wrong password' }`, and no `set-cookie`.
  - 'refuses every password when ADMIN_SECRET is unset': with `adminSecret: undefined` and secret `''` → 403.
  - 'blocks the sixth attempt, even with the right password': 5 wrong attempts from `1.2.3.4`, then the right one → 429. A `retry-after` header is present and there is no `set-cookie`.
  - 'refuses cross-site and non-JSON logins' → 403 and 415.
  - 'logout clears the cookie': `set-cookie` contains `bg_session=;` and `Max-Age=0`.
- [ ] **Step 2: Run and confirm they fail:** `bun test apps/site/auth` → FAIL.
- [ ] **Step 3: Implement** the controller, the routes and the registration.
- [ ] **Step 4: Run all tests:** `bun test` → all pass.
- [ ] **Step 5: Lint:** `bunx biome check apps/site/auth apps/site/server.ts apps/site/app-container.ts` is clean.
- [ ] **Step 6: Commit:** `git commit -m "feat(auth): log in with the admin password and a signed session cookie"`

### Task 4: Remove the client-side identity script

**Files:**
- Modify:
  - `apps/site/components/shared-head.html`: delete the `<script data-dev-user-email=…>` block, lines 14–37.
  - `apps/site/site.ts`: `renderSharedHead()` takes no argument. Drop the `userEmail` parameter from `renderLayout`, `renderDocument` and `renderPage`, and delete `serializeForInlineScript` if nothing uses it.
  - Callers: `apps/site/server.ts` and `apps/site/project/project.controller.ts`.
  - `apps/site/site.test.ts`.

**Interfaces:**
- Produces:
  - `renderDocument(config: PageConfig, content: string, lang: Lang): Promise<string>`
  - `renderPage(pathname: string, lang: Lang): Promise<Response | null>`

- [ ] **Step 1: Write the failing test** in `site.test.ts`, 'no page ships client-side identity hooks'. For each of `'/'`, `'/projects'` and `'/cv'`, rendered with `'en'`, the HTML contains none of `x-user-email`, `__DEV_USER_EMAIL__` and `dev-user-email`.
- [ ] **Step 2: Run and confirm it fails:** `bun test apps/site/site.test.ts` → FAIL.
- [ ] **Step 3: Implement** the deletions and signature changes. `editor-script.html` needs no change, because same-origin `fetch` already sends the session cookie.
- [ ] **Step 4: Run all tests:** `bun test` → all pass.
- [ ] **Step 5: Lint:** `bunx biome check apps/site/site.ts apps/site/server.ts apps/site/project/project.controller.ts apps/site/components/shared-head.html` must report no more errors than before. `shared-head.html` was already on the baseline list, so the bar there is no new diagnostics.
- [ ] **Step 6: Commit:** `git commit -m "fix(auth): stop sending a browser-set email with every request"`

### Task 5: Icon and tags columns, repository, seed

**Files:**
- Modify:
  - `packages/core/db/schema.ts`: on `projects`, add `icon: text('icon')` and `tags: text('tags').array().notNull().default(sql\`'{}'::text[]\`)`.
  - `packages/core/project/project.repository.ts`
  - `packages/core/db/seed.ts`
  - `packages/core/index.ts`: export `type ProjectInput`.
- Create:
  - `packages/core/drizzle/migrations/0001_*.sql` plus the meta files, via `bun run db:generate`;
  - `packages/core/drizzle/migrations/0002_move_stack_lines_to_tags.sql`, via `cd packages/core && bunx drizzle-kit generate --custom --name=move_stack_lines_to_tags`.

**Interfaces:**
- Produces, in `@bg/core`:
  - `type ProjectInput = { name: string; description: string | null; content: string | null; image: string | null; isHidden: boolean; icon: string | null; tags: string[] }`
  - The `ProjectsRepository` methods:
    - `list(options: { includeHidden: boolean }): Promise<Project[]>`: newest first. It filters `is_hidden = false` unless `includeHidden`.
    - `findById(id: number): Promise<Project | null>`: unchanged.
    - `create(input: ProjectInput): Promise<Project>`: returns the row, not an array.
    - `updateById(id: number, changes: Partial<ProjectInput>): Promise<Project | null>`: sets only the given keys, plus `updatedAt`.
    - `deleteById(id: number): Promise<boolean>`

- [ ] **Step 1: Generate the schema migration.** Edit `schema.ts`, then run `bun run db:generate`. Expected SQL in `0001_*.sql`:
  - `ALTER TABLE "projects" ADD COLUMN "icon" text;`
  - `ALTER TABLE "projects" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;`
- [ ] **Step 2: Write the data move into `0002_move_stack_lines_to_tags.sql`.** The SQL is given exactly, because no test determines it:

```sql
UPDATE "projects" AS p
SET "tags" = ARRAY(
      SELECT btrim(t.tag)
      FROM unnest(string_to_array(regexp_replace(s.m[1], '\.\s*$', ''), ',')) WITH ORDINALITY AS t(tag, ord)
      WHERE btrim(t.tag) <> ''
      ORDER BY t.ord
    ),
    "content" = NULLIF(btrim(regexp_replace(p."content", '<p>\s*Stack:[^<]*</p>', '', 'i')), '')
FROM (SELECT "id", regexp_match("content", '<p>\s*Stack:\s*([^<]*)</p>', 'i') AS m FROM "projects") AS s
WHERE p."id" = s."id" AND s.m IS NOT NULL AND cardinality(p."tags") = 0;
```

- [ ] **Step 3: Apply both migrations to the local database and check the data.** The local database is the one the dev server uses: Docker container `bg-local-pg`, seeded with the old seed.
  - Run: `DATABASE_URL=postgres://begench:begench@127.0.0.1:55432/begenchgeldyev bun run db:migrate`
  - Check with `docker exec bg-local-pg psql -U begench -d begenchgeldyev -At -c "select name, tags, coalesce(content,'<null>') from projects order by id"`. Expected:
    - Interpreter: `{}` and its original text, 1077 characters;
    - This Website: `{HTMX,"Tailwind CSS",Bun}` and `<null>`;
    - Telegram Bot: `{Python,MongoDB,"Telegram API"}` and `<p>Open the bot in Telegram: <a href="https://t.me/adhavenBot" target="_blank" rel="noopener noreferrer">t.me/adhavenBot</a></p>`.
- [ ] **Step 4: Update the repository** to the interfaces above. Update the callers in `apps/site/project/project.controller.ts` so they compile: `list({ includeHidden: true })` for now (Task 7 sets the real rule), `create` returns a row, and `updateById` takes a partial.
- [ ] **Step 5: Update the seed.**
  - This Website: `tags: ['HTMX', 'Tailwind CSS', 'Bun']`, `content: null`.
  - Telegram Bot: `tags: ['Python', 'MongoDB', 'Telegram API']`, `content: '<p>Open the bot in Telegram: <a href="https://t.me/adhavenBot" target="_blank" rel="noopener noreferrer">t.me/adhavenBot</a></p>'`.
  - Interpreter: unchanged, `tags: []`.
  - It stays safe to re-run.
- [ ] **Step 6: Verify the seed on a fresh database:**

```bash
docker exec bg-local-pg psql -U begench -d begenchgeldyev -qc "drop database if exists fresh" -c "create database fresh"
DATABASE_URL=postgres://begench:begench@127.0.0.1:55432/fresh bun run db:migrate
DATABASE_URL=postgres://begench:begench@127.0.0.1:55432/fresh bun run db:seed
docker exec bg-local-pg psql -U begench -d fresh -At -c "select name, tags from projects order by id"
docker exec bg-local-pg psql -U begench -d begenchgeldyev -qc "drop database fresh"
```

  Expected: the three rows with the tags from Step 5. A second seed run prints three `Skipped project` lines.
- [ ] **Step 7: Run all tests:** `bun test` → all pass.
- [ ] **Step 8: Lint:** `bunx biome check packages/core` → clean.
- [ ] **Step 9: Commit:** `git commit -m "feat(projects): store icon and tags on each project"`

### Task 6: Project input validation and the icon set

**Files:**
- Create: `apps/site/project/project-icons.ts`, `apps/site/project/project-icons.test.ts`, `apps/site/project/project-input.ts`, `apps/site/project/project-input.test.ts`

**Interfaces:**
- Consumes: Task 5's `ProjectInput`.
- Produces, in `project-icons.ts`:
  - `PROJECT_ICONS = ['terminal', 'code', 'web', 'smart_toy', 'database', 'cloud', 'api', 'dns', 'memory', 'developer_board', 'hub', 'storage', 'bolt', 'rocket_launch', 'extension', 'sports_esports', 'phone_iphone', 'analytics', 'security', 'school'] as const`
  - `guessProjectIcon(name: string, description: string | null): string`: moved from `getProjectIcon` in `project.controller.ts`, with the same regexes.
  - `projectIcon(project: { icon: string | null; name: string; description: string | null }): string`: the stored icon when it is in `PROJECT_ICONS`, otherwise the guess.
- Produces, in `project-input.ts`:
  - `PROJECT_LIMITS = { maxBodyBytes: 4 * 1024 * 1024, maxImageBytes: 2 * 1024 * 1024, maxNameChars: 120, maxDescriptionChars: 600, maxContentChars: 100_000, maxTags: 12, maxTagChars: 40 } as const`
  - `type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }`
  - `parseNewProject(body: unknown): ParseResult<ProjectInput>`: requires `name`. The other fields default to description `null`, content `null`, image `null`, isHidden `false`, icon `null`, tags `[]`.
  - `parseProjectChanges(body: unknown): ParseResult<Partial<ProjectInput>>`: returns only the keys present. An empty object gives `nothing to update`.
  - Field rules, shared by both and checked in this order:
    - **body:** must be a plain object, otherwise `body must be a JSON object`.
    - **name:** a trimmed string of 1–120 characters, otherwise `name is required` or `name is too long`.
    - **description, content:** a string or null. Whitespace-only becomes null. Over the cap: `description is too long` or `content is too long`.
    - **image:**
      - `null`/`''` → null;
      - a `/public/` path without `..` → kept;
      - a `data:image/(png|jpeg|webp|gif);base64,` URL → kept if its decoded size is ≤ 2 MB, otherwise `photo must be 2 MB or smaller`;
      - anything else → `photo must be an uploaded image`.
    - **icon:** `null`/`''` → null; a name in `PROJECT_ICONS` → kept; anything else → `unknown icon`.
    - **tags:**
      - must be an array of strings, otherwise `tags must be a list`;
      - each tag is trimmed, empty ones are dropped, and duplicates are removed case-insensitively, keeping the first;
      - more than 12 → `at most 12 tags`;
      - a tag over 40 characters → `tags are limited to 40 characters`.
    - **isHidden:** a boolean when present, otherwise `isHidden must be true or false`.

- [ ] **Step 1: Write the failing tests:**
  - `project-icons.test.ts`:
    - `PROJECT_ICONS` has 20 unique names.
    - `guessProjectIcon('This Website', 'Personal portfolio & blog.')` is `'web'`.
    - `guessProjectIcon('Telegram Bot', null)` is `'smart_toy'`.
    - `guessProjectIcon('Tool', 'works for both sides')` is `'terminal'`.
    - `projectIcon({ icon: 'database', … })` is `'database'`.
    - `projectIcon({ icon: 'not-an-icon', name: 'Interpreter', description: null })` is `'terminal'`.
  - `project-input.test.ts`, one test per rule:
    - `parseNewProject({})` gives `{ ok: false, error: 'name is required' }`.
    - `parseNewProject({ name: '  Demo ' })` gives `{ ok: true, value: { name: 'Demo', description: null, content: null, image: null, isHidden: false, icon: null, tags: [] } }`.
    - `parseProjectChanges({ description: '  ' })` gives `{ ok: true, value: { description: null } }`.
    - `parseProjectChanges({})` gives `nothing to update`.
    - `parseProjectChanges({ name: '' })` gives `name is required`.
    - `tags: ['  Bun ', '', 'bun', 'HTMX']` gives `['Bun', 'HTMX']`.
    - 13 tags give `at most 12 tags`.
    - `tags: 'Bun'` gives `tags must be a list`.
    - `icon: 'database'` is kept, and `icon: 'rocket'` gives `unknown icon`.
    - `image: '/public/projects/telegram-bot.jpg'` is kept, and `image: '/public/../server.ts'` gives `photo must be an uploaded image`.
    - `image: 'javascript:alert(1)'` gives `photo must be an uploaded image`.
    - `image: 'data:image/png;base64,' + 'A'.repeat(2_796_204)` gives `photo must be 2 MB or smaller`.
    - A small valid `data:image/png;base64,iVBORw0KGgo=` is kept.
    - `isHidden: 'yes'` gives `isHidden must be true or false`.
    - `parseNewProject('x')` gives `body must be a JSON object`.
- [ ] **Step 2: Run and confirm they fail:** `bun test apps/site/project` → FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run all tests:** `bun test` → all pass.
- [ ] **Step 5: Lint** the four new files; they must be clean.
- [ ] **Step 6: Commit:** `git commit -m "feat(projects): validate project fields and define the icon set"`

### Task 7: Project API, hidden projects, cards from the new fields

**Files:**
- Modify:
  - `apps/site/project/project.controller.ts`
  - `apps/site/server.ts`:
    - `'/projects'` GET and POST → the controller, with no `enforce` wrapper;
    - in `fetch()`, `/api/projects/:id` PATCH → `patch` and DELETE → `delete`;
    - remove the `canAccess` and `enforce` imports.
  - `apps/site/app-container.ts`: `new ProjectController(c.resolve(ProjectsRepository), canEditProjects)`, where `canEditProjects(req)` resolves `false` without touching the database when `resolveEmail(req)` is `null`. Otherwise it returns `canAccess(req, { actions: 'update', resource: 'project' })`. Public page views then cost no policy query.
- Create: `apps/site/project/project.controller.test.ts`
- Delete: `apps/site/project/stack-tags.ts`, `apps/site/project/stack-tags.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: guards and `readJsonWithin`.
  - Task 5: repository methods and `ProjectInput`.
  - Task 6: `parseNewProject`, `parseProjectChanges`, `PROJECT_LIMITS`, `projectIcon`.
- Produces:
  - `type CanEditProjects = (req: Request) => Promise<boolean>`, exported.
  - `class ProjectController`, with `constructor(projectsRepository: ProjectsRepository, canEditProjects: CanEditProjects)` and these methods:
    - `get(req)`: `includeHidden` is the result of `canEditProjects(req)`. With HX it returns the cards fragment, otherwise `{ projects }`.
    - `getPageById(req, id)`: 404 when the project is missing, or hidden and the caller can't edit. The same `canEditProjects(req)` result drives the click-to-edit controls; the per-project `canAccess` call goes away.
    - `post(req)`, in this order:
      1. `refuseCrossSite`;
      2. `canEditProjects`, else 403 `not allowed`;
      3. `refuseNonJson`;
      4. `readJsonWithin(req, PROJECT_LIMITS.maxBodyBytes)`;
      5. `parseNewProject`, else 400 `{error}`;
      6. `create` → 201 `{ project }`.
    - `patch(req, id)`: the same order with `parseProjectChanges` → `updateById`. That gives 404 `project not found`, or 200 `{ project }`.
    - `delete(req, id)`: `refuseCrossSite` → `canEditProjects`, else 403 → `deleteById`. That gives 204, or 404 `project not found`.
  - Cards: tags come from `project.tags` through the existing `renderPhotoTags`/`renderPlainTags`, and the icon from `projectIcon(project)`. Delete the `extractStackTags` import and `getProjectIcon`.

- [ ] **Step 1: Write the failing tests** with an in-memory fake repository that implements the five methods, plus a `canEdit` stub:
  - 'hides hidden projects from visitors': with HX `get` as a visitor, the hidden project's name is absent. As the owner it is present, with the `Hidden` badge.
  - 'the JSON list follows the same rule'.
  - "a hidden project's page is 404 for visitors and 200 for the owner".
  - 'refuses writes from visitors': `post`, `patch` and `delete` → 403 `not allowed`, and the fake repository records no calls.
  - 'refuses cross-site writes before anything else': 403 `cross-site requests are not allowed`, and `canEdit` is not called.
  - 'creates a project from valid input': 201. `create` receives `{ name: 'Demo', description: null, content: null, image: null, isHidden: false, icon: null, tags: ['Go'] }`.
  - 'rejects invalid input readably': `{}` → 400 `name is required`.
  - 'PATCH changes only the fields it receives': the editor-shaped body `{ name, description, image: '', content, isHidden: false }` reaches `updateById` with exactly those 5 keys, so no `icon` or `tags`.
  - 'a photo over 2 MB is refused and nothing is saved': 400 `photo must be 2 MB or smaller`, and there is no `updateById` call.
  - 'patching or deleting a missing project is 404 `project not found`'.
  - 'deletes a project': 204.
  - 'cards use the tags field and the chosen icon': a project with no image, `tags: ['Go']` and `icon: 'database'` renders a fragment containing `>Go<` and `database`. With `icon: null` and name `Telegram Bot` it contains `smart_toy`.
- [ ] **Step 2: Run and confirm they fail:** `bun test apps/site/project/project.controller.test.ts` → FAIL.
- [ ] **Step 3: Implement** the controller, the routes and the container changes, and delete the stack-tags files.
- [ ] **Step 4: Run all tests:** `bun test` → all pass.
- [ ] **Step 5: Check the approved cards are unchanged.** Card markup must be identical except for the data source. With the dev server on `bg-local-pg`, which Task 5 migrated, `curl -s -H 'HX-Request: true' http://localhost:8613/api/projects` shows the same three cards in the same order. Telegram Bot and This Website still show their tags.
- [ ] **Step 6: Lint:** `bunx biome check apps/site/project apps/site/server.ts apps/site/app-container.ts` is clean.
- [ ] **Step 7: Commit:** `git commit -m "feat(projects): owner-only writes, partial updates, delete, and hidden projects"`

### Task 8: Admin page, and tags on the project page

This is the designer's lane. The visual layout belongs to the designer, in the site's terminal look; the behavior below is fixed.

**Files:**
- Create:
  - `apps/site/admin/admin.controller.ts` and `apps/site/admin/admin.controller.test.ts`
  - `apps/site/components/admin/login.html`, `apps/site/components/admin/page.html` and `apps/site/components/admin/script.html` (an inline script, following the `components/projects/editor-script.html` pattern)
- Modify:
  - `apps/site/server.ts`: add `'/admin'` GET → `container.resolve(AdminController).page(req)`.
  - `apps/site/app-container.ts`
  - `apps/site/components/projects/page.html`, plus `renderProjectPage` in `project.controller.ts`: tag chips from `project.tags`, rendering nothing when the list is empty.

**Interfaces:**
- Consumes:
  - `ProjectsRepository.list({ includeHidden: true })`
  - Task 7's `CanEditProjects`
  - Task 2's `sessionEmail`
  - Task 6's `PROJECT_ICONS` and `PROJECT_LIMITS`
  - `renderDocument` and `renderComponentTemplate` from `site.ts`
- Produces: `class AdminController`, with `constructor(deps: { projectsRepository: ProjectsRepository; canEditProjects: CanEditProjects; sessionEmail: (req: Request) => string | null })` and `page(req: Request): Promise<Response>`. It renders one of three states:
  - **No session:** the login page, with a form marked `data-admin-login`. It POSTs `{ secret }` to `/api/auth/login`, reloads on 200, and otherwise shows the `error`, including the 429 text.
  - **Session without edit rights:** the text "You're logged in, but this account can't edit projects yet." plus a log-out button.
  - **Owner:** the app, marked `data-admin-app`. The projects come from `list({ includeHidden: true })` and are serialized with `JSON.stringify(...).replaceAll('<', '\\u003c')` into a data attribute or JSON script, along with `PROJECT_ICONS`.

  All three answer with `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store` and `X-Robots-Tag: noindex`. The document config is title `ADMIN — BEGENCH_GELDYEV@ROOT:~$` for both languages, `brandIsLink: true`, `footerVariant: 'default'` and `showTerminalIcon: true`.
- Client behavior in `script.html`:
  - **Layout:** the project list shows each project's name and whether it is hidden, plus "New project".
  - **Form:**
    - name, short description, full text (an HTML code-style textarea), tags (comma-separated), and hidden/visible;
    - icon: a grid of `PROJECT_ICONS` plus "Automatic";
    - photo: upload, preview and remove. Refuse files over 2 MB before reading them, and read them as a data URL.
  - **Saving:** a new project is a POST; an existing one is a PATCH of all form fields. Delete asks for confirmation and sends a DELETE. Log out POSTs `/api/auth/logout` and reloads.
  - **Errors:** show every `{ error }` from the server, including a 404 `project not found` after a delete in another tab.

- [ ] **Step 1: Write the failing server-side tests:**
  - 'shows the login form without a session': contains `data-admin-login` and no project names. The headers include `cache-control: no-store` and `x-robots-tag: noindex`.
  - 'explains a session without edit rights': with `sessionEmail` returning the owner and `canEditProjects` returning false, the page contains `can't edit projects yet` and no `data-admin-login`.
  - 'lists every project, hidden ones too, for the owner': contains `data-admin-app`, all project names including a hidden one, and `rocket_launch`, one of the icons.
  - 'escapes project data embedded in the page': a project named `</script><img src=x onerror=alert(1)>` never appears unescaped. Assert that the HTML has no `</script><img`.
- [ ] **Step 2: Run and confirm they fail:** `bun test apps/site/admin` → FAIL.
- [ ] **Step 3: Implement** the controller, the templates and the client script, the route and registration, and the tags on the project page.
- [ ] **Step 4: Run all tests:** `bun test` → all pass.
- [ ] **Step 5: Check it by hand on localhost.** Restart the dev server with a local-only secret: `ADMIN_SECRET=local-admin-secret DATABASE_URL=postgres://begench:begench@127.0.0.1:55432/begenchgeldyev bun run dev`. The local DB still has the owner policy. On http://localhost:8613/admin:
  1. A wrong password gives an error; the right one gets you in.
  2. Create a project with tags, an icon and a photo.
  3. Edit the name and switch the icon to Automatic.
  4. Hide it, and check that `/projects` in a private window doesn't list it and its page is 404.
  5. Delete it.
  6. Log out.

  Also check that a click-to-edit save on `/projects/3` keeps its tags. Take screenshots of `/admin` at 1440 and 390 widths.
- [ ] **Step 6: Lint:** `bunx biome check apps/site/admin apps/site/components/admin apps/site/components/projects/page.html apps/site/project apps/site/server.ts apps/site/app-container.ts` is clean.
- [ ] **Step 7: Commit:** `git commit -m "feat(admin): add the project admin page"`

### Task 9: Docs and full verification

**Files:**
- Modify: `CLAUDE.md`
  - **Request flow:** list `/api/auth/login`, `/api/auth/logout` and the `/admin` page.
  - **ABAC section:** the PEP now takes the user from the signed `bg_session` cookie set by the admin login; drop the `x-user-email` wording.
  - **Database section:**
    - projects have `icon` and `tags`, edited on `/admin`;
    - hidden projects are owner-only;
    - remove the `Stack:` sentence;
    - the seed restores the owner's `owner-full-access` policy.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run all tests:** `bun test` → all pass, with 0 failures.
- [ ] **Step 3: Lint:** biome on every file the branch touched, from `git diff --name-only 4aaedb9`. Everything is clean except the existing baseline diagnostics in untouched-format HTML pages.
- [ ] **Step 4: Check the forgeries are refused on localhost:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -H 'x-user-email: begenchgeldyev@gmail.com' -d '{"name":"x"}' http://localhost:8613/api/projects
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -b 'dev-user-email=begenchgeldyev%40gmail.com' -d '{"name":"x"}' http://localhost:8613/api/projects
```

  Expected: `403` both times.
- [ ] **Step 5: Commit:** `git commit -m "docs: describe the admin page and the owner login"`
- [ ] **Step 6: Show the owner `/admin` on localhost, and wait for their go-ahead before Task 10.**

### Task 10: Go live

Only after the owner's go-ahead. The site deploys on push to `main`, and nothing migrates or seeds on deploy.

- [ ] **Step 1: Apply the migrations to production while the old code still runs.** The old code ignores the new columns. Through an SSH tunnel, with the URL taken from the server and never printed:

```bash
ssh -f -N -o ExitOnForwardFailure=yes -L 55433:127.0.0.1:5432 kz
DATABASE_URL="$(ssh kz "grep -m1 '^DATABASE_URL=' /opt/apps/begenchgeldyev-website/infra/site.env | cut -d= -f2- | sed 's#@postgres:5432/#@127.0.0.1:55433/#'")" bun run db:migrate
```

  Expected: `migrations applied successfully`. Check the result through `ssh kz` with `docker compose -f infra/compose.yml exec -T postgres psql -U begench -d begenchgeldyev -At -c "select name, tags from projects order by id"`: Telegram Bot and This Website have their tags. Close the tunnel afterwards with `pkill -f 'L 55433:127.0.0.1:5432'`.
- [ ] **Step 2: Push** with `git push origin main`, and wait until `https://begenchgeldyev.com/api/version` shows the new SHA.
- [ ] **Step 3: Check the forgeries are refused in production.** Run Task 9 Step 4's two `curl`s against `https://begenchgeldyev.com`; both should give `403`.
- [ ] **Step 4: Restore the owner policy** with `ssh kz 'cd /opt/apps/begenchgeldyev-website && docker compose -f infra/compose.yml exec -T site bun /usr/src/app/packages/core/db/seed.ts </dev/null'`. Expected: three `Skipped project` lines and `Seeded successfully`.
- [ ] **Step 5: Check production:**
  - Task 9 Step 4's `curl`s still give `403` after the policy is back;
  - `/projects` shows three cards with tags;
  - `/admin` shows the login form;
  - the owner logs in with the production `ADMIN_SECRET` and sees the app.
- [ ] **Step 6: Tell the owner** to make sure the production `ADMIN_SECRET` is long and random.
