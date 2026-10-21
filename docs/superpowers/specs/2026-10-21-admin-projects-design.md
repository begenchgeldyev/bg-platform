# Project admin page (`/admin`) with a real login

Date: 2026-10-21
Status: draft, awaiting the owner's approval

## Why

The owner wants one page where he can change his projects: icon, text, name,
tags, photo and so on, and add or delete projects. Today the only editing is
click-to-edit on each project page (`/projects/:id`), with no way to set an
icon or tags, create or delete a project, or see hidden projects in one place.

Editing is also unsafe today. `resolveEmail()` in `packages/core/abac/pep.ts`
trusts an `x-user-email` header or a `dev-user-email` cookie, and anyone can
set either. The owner's email is public on the home page and the code is in a
public GitHub repo. Production was open from the seed run on 2026-10-21 until
the `owner-full-access` policy row was deleted the same day. All edits are
refused now. The login must be fixed before editing is switched back on.

## Decisions

The owner made these:

- A password-protected `/admin` page that lists every project, including hidden
  ones, with "New project".
- Each project can be edited there: name, short description, full text, tags,
  icon, photo and hidden/visible. It can also be deleted, with a confirm step.
- Click-to-edit on project pages stays, behind the same login.
- Log in with the existing `ADMIN_SECRET` (already set in production's
  `infra/site.env`).

The orchestrator made these, and the owner accepted them in chat:

- **Session:** 30 days, with a log-out control. Repeated wrong passwords are
  rate limited per client IP.
- **Full text:** edited as HTML in a code-style text box on `/admin`.
  Click-to-edit stays as the visual way.
- **Tags:** a real field, an ordered list of strings. Existing `Stack: A, B, C`
  lines in project content move into the field and are removed from the text,
  once. After that, card tags come only from the field, and
  `apps/site/project/stack-tags.ts` goes away. The project page shows the tags
  too, because the text no longer carries them.
- **Icon:** pick one Material Symbol from a grid of about 20 that fit software
  projects, or "Automatic". Automatic is the current guess from the name and
  description, `getProjectIcon` in `project.controller.ts`. Cards with a photo
  keep showing the photo.
- **Photo:** upload or remove. It is stored in the `image` column as a data URL,
  as the current editor already does. The limit is 2 MB per image. The existing
  `/public/...` path (Telegram Bot) keeps working.
- **Hidden means hidden:** hidden projects are left out of the public list,
  `GET /api/projects` and their own page (404) for visitors. They stay visible
  to the logged-in owner, on `/admin` and on the site with the existing Hidden
  badge. Today visitors still see hidden projects, just with a badge.
- **Admin UI language:** English only. Public pages keep EN/RU as they are.

## Login and authorization

- **Login:** `/admin` shows a password form when logged out. A correct
  `ADMIN_SECRET` creates a session for the owner (`begenchgeldyev@gmail.com`,
  the email the current login already defaults to).
- **Session cookie:** HttpOnly, SameSite=Lax, Secure in production, Path=/,
  30 days. It is signed or random on the server, so it can't be forged from
  the browser. Deriving the signing key from `ADMIN_SECRET` is fine: rotating
  the password then logs every session out.
- **Log out** clears the cookie.
- **One source of identity:** `resolveEmail()` (or its replacement) returns the
  owner's email only for a valid session. Remove these entirely:
  - the `x-user-email` header path;
  - the `dev-user-email` cookie;
  - the `shared-head.html` script that writes that cookie and adds the header
    to `fetch` and htmx requests.
- **ABAC stays as it is.** Session email → `users` row (role `owner`) →
  `policies`. `canAccess` and `enforce` keep their contract; only where the
  email comes from changes.
- **Mutating requests** (login, logout, create, update, delete) refuse
  cross-site requests with 403 and non-JSON bodies with 415, the same guard as
  `apps/site/ask/ask.controller.ts`. They cap the body size so a 2 MB image
  fits, with JSON overhead.
- **Login rate limit:** at most 5 failed attempts per 15 minutes per client IP,
  using `createRateLimiter` from `apps/site/ask/rate-limit.ts`. Over the limit,
  answer 429 with `Retry-After`.
- **Regression tests:** a spoofed `x-user-email` header and a spoofed
  `dev-user-email` cookie must not grant anything.

## Data

- **New columns on `projects`:**
  - `icon`: text, nullable; null means Automatic;
  - `tags`: text[], not null, default empty.
  Add a Drizzle migration with `bun run db:generate`.
- **One-time move:** existing `Stack:` lines become `tags` and are removed from
  `content`. Seeded data has them for Telegram Bot ("Python, MongoDB, Telegram
  API") and This Website ("HTMX, Tailwind CSS, Bun"); Interpreter has none.
- **Seed:** `packages/core/db/seed.ts` writes tags into the field and no longer
  puts `Stack:` lines into content. It stays safe to re-run.

## API

- **`GET /api/projects`:** leaves hidden projects out unless the owner is
  logged in. The HTML fragment and the JSON both follow this rule.
- **`POST /api/projects`:** creates a project with any of the fields; only
  name is required.
- **`PATCH /api/projects/:id`:** a partial update. Only the fields in the body
  change. Today a missing field is reset to null/false, and the click-to-edit
  save would then wipe icon and tags.
- **`DELETE /api/projects/:id`:** new.
- **Validation:**
  - name: required, trimmed, not empty;
  - tags: an array of trimmed, non-empty strings with reasonable limits;
  - icon: one of the offered names, or null;
  - image: one of these:
    - a `/public/` path;
    - a `data:image/(png|jpeg|webp|gif);base64,` URL within the 2 MB limit;
    - empty or null, which removes the photo.

  Anything else gets 400 with `{ "error": "<short message>" }`.

## Pages

- **`/admin`:** the list, the create/edit form, delete with confirmation, the
  icon grid, photo upload with a preview, and a visible-or-hidden switch. The
  layout and visual design belong to the designer, in the site's existing
  terminal look. htmx 4 conventions from CLAUDE.md apply.
- **Project cards on `/projects`:**
  - tags come from the field;
  - the icon comes from the field, with Automatic falling back to
    `getProjectIcon`;
  - the approved card design stays.
- **Project page:** shows the tags. Click-to-edit keeps working through the
  new session, and its save sends only the fields it edits.

## Not included

- Reordering projects; the list stays newest first.
- Russian versions of project text.
- More than one admin, or user management.
- Storing photos as files.

## Going live

The site deploys on push to `main` (`.github/workflows/deploy.yml`). Nothing
migrates or seeds on deploy. The live site must not error at any point:

1. Apply the migration to production before the new code goes live. Old code
   ignores the new columns. One way: `drizzle-kit migrate` over an SSH tunnel to
   the VPS (host alias `kz`; Postgres is published on the host's 5432). The
   builder may pick another way that keeps the site up.
2. Push and wait until `/api/version` shows the new commit.
3. Run the seed in the container to restore the `owner-full-access` policy:
   `docker compose -f infra/compose.yml exec -T site bun /usr/src/app/packages/core/db/seed.ts`.
   Do this only after the new login is live.
4. Check production:
   - spoofed header and cookie are refused;
   - logging in with the real password works;
   - the projects show their tags;
   - a hidden project 404s for visitors.

Recommend the owner check that the production `ADMIN_SECRET` is long and
random, since it is now the only key.

## Left to the builder

The session mechanism (signed vs. server-side store) and where its code lives.
The exact icon set, how the one-time `Stack:` move is written (SQL in the
migration or a script), the admin page's route and fragment structure, and how
tests are organized.
