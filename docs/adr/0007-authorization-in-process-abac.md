---
status: accepted
date: 2026-10-21
source: docs/superpowers/specs/2026-10-21-admin-projects-design.md, commits 1c3356b and 035710d
---

# Authorization is in-process ABAC, and project writes bypass `enforce()`

Policies live in the database and are evaluated by `evaluate()` — a pure, deny-overrides, default-deny decision function — against a subject resolved from the session, the action, the resource and its attributes. Route-level role checks were rejected because they cannot express a condition on the resource, and would have to be repeated correctly in every route. The deliberate deviation: project writes do not call `enforce()`. `ProjectController` injects `canEditProjects(req)`, which returns false without a database query when there is no session, so a visitor's read never pays for a policy lookup. `enforce()` survives in `packages/core` with no route using it; it is kept, not forgotten.
