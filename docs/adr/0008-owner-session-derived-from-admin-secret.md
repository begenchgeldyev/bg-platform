---
status: accepted
date: 2026-10-21
source: docs/superpowers/specs/2026-10-21-admin-projects-design.md, commit 1c3356b
---

# The only identity is a signed owner cookie derived from `ADMIN_SECRET`

`POST /api/auth/login` compares the submitted secret with `ADMIN_SECRET` and sets `bg_session`, an HttpOnly `SameSite=Lax` cookie whose token is `<expiry>.<HMAC-SHA256>`, signed with that same secret. There is no server-side session store, no user lookup at login and no user management: `users` exists for ABAC subject attributes and holds one seeded owner. Client-supplied identity — the `x-user-email` header and the `dev-user-email` cookie — was removed, because any client could claim to be the owner. The accepted consequence is that `ADMIN_SECRET` is both the password and the signing key: it must be long and random, and rotating it logs every session out at once.
