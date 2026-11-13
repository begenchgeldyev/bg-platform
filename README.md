# Project gallery A/B study — selected B

The user chose **B · Project covers**. A is preserved only as the comparison study.
This standalone branch captures the original approved throwaway source, not an app
route, database snapshot, production bundle or alternative implementation.

`gallery-options-v3.html` and the three briefs are preserved byte-for-byte. The two
local OpenTUI font files are the same files already used by the website. Artwork
inside this historical HTML consists of clearly labeled temporary original SVG
placement studies, not the final user-supplied artwork.

The original prompt briefs describe 1280×720 masters and a centered 4:3 safe crop.
The later supplied final images are native 1448×1086 (4:3); production uses them
uncropped. The old brief/source wording is retained as historical design evidence,
not as current production instructions. No Interpreter repository URL is invented.

## Keyless local replay

With an existing Bun installation, run from this branch's root:

```sh
bun server.ts
```

Open http://localhost:8677; `?variant=A` or `?variant=B` selects a study. `PORT` may
override the port. The helper binds only to loopback, serves just the study/fonts,
and injects a tiny local `toggleSelect` shim into the response without changing the
captured source file. Selection updates local presentation only: no vote endpoint,
session, token, network service, AI call or application mutation.

The original companion's private bootstrap/state/server information is deliberately
absent. No generated production covers or website backend are required for replay.
