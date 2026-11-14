# Packages are deep modules

Keep substantial behavior behind small public entry points:

```text
packages/<name>/
  index.ts               # public entry point
  client.ts              # optional, separate public entry point
  lib/                   # private implementation
  tests/                 # public-behavior tests and private fixtures
```

**Entry points.** Apps and other packages import only files at a package's root (`index.ts`, `client.ts`, etc.). Every subfolder is private, regardless of its name. Prefer a few small root entry points over giant barrels or subtree barrels that expose implementation structure. Existing core folders remain in place; they are private too.

**Internal freedom.** Implementation files may import freely within their own package, but reach other packages only through root entry points. Do not import another package's implementation.

**Tests and fixtures.** Put package tests in `tests/` and exercise behavior through root entry points (for example, `../index`), never implementation imports. Tests may import their own `tests/` fixtures; nothing outside that package's tests may import those fixtures. Existing site tests are outside this package convention and are not migrated here.

**Cycles and layering.** Dependency cycles are forbidden across the scanned apps and packages. Layering rules (which packages may depend on which) are separate from entry-point boundaries; the config includes a commented stub for future layering policies.

`example/` is a copy/delete template, not a runtime dependency: copy it to start a package, replace its tag-normalization behavior and tests, or delete it when no longer useful. Add workspace metadata only when the new package needs it.

Run `bun run lint:boundaries` from the repository root to check both `apps` and `packages`. There is no umbrella typecheck command to attach it to today. **CI follow-up:** run this command alongside the existing checks when CI validation is wired up; do not rely on local checks alone.
