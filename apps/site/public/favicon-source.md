# Portrait site icons

## Rebuild and check

From the repository root:

```sh
bun apps/site/scripts/favicon.ts
bun test apps/site/scripts/favicon.test.ts
# Also produce local acceptance evidence (not public assets):
bun apps/site/scripts/favicon.ts --proof
```

The Bun entry invokes local `python3` with **Pillow 13.0.0**, and rejects other Pillow versions to avoid silent image-processing changes. Development environment: Bun 1.3.14. Install Pillow 13.0.0 in your chosen Python environment if absent; no application dependencies or runtime image processing are required. Python is only needed to rebuild/check these committed PNGs. The generator is independent of the working directory; proof goes to `.slim/deepwork/animated-favicon/paired-preview.png`. Its labeled proof uses Pillow's bundled default font.

## Inputs (outside public)

Both owner-supplied originals are retained in `apps/site/assets/favicon/`:

| File | Dimensions | SHA-256 |
| --- | --- | --- |
| `open-master.png` | 1254 × 1254 | `2cc2e8f44044f6c45eb0390ea0dff0cf2749565526ee6c35bb97238891511772` |
| `closed-reference.png` | 1086 × 1448 | `f116d5b4eed73f7b91ec3ee20c95f78c33a1812a6fc5c9823227dffc78f2bfaf` |

The smiling open portrait is the sole pixel master. The closed portrait supplies the straight eyelid design reference only; its face, mouth, hair, background and framing are never pasted into the closed frame. Both input hashes are checked before generation.

## Exact crop and approved eye-only exception

All coordinates are uncropped open-master pixels, `(left, top, right, bottom)`, right/bottom exclusive.

- Square face/hair crop: **`(224, 0, 1024, 800)`**, 800 × 800. Same crop for every state and size; complete hair, ears and chin with a small neck margin.
- Editable envelopes: left `(468, 443, 600, 526)`; right `(648, 443, 785, 526)` (viewer orientation).
- Exact hard-edged masks are unions of two rectangles per eye: left `(468, 443, 600, 504)` + `(468, 504, 583, 526)`; right `(648, 443, 785, 504)` + `(665, 504, 785, 526)`. The lower steps cover eye-white edge pixels without extending beyond the approved envelopes.
- Fill the masks with skin sampled from master `(590, 510)`: RGB `(254, 179, 131)`. The upper band, y=443–474, uses master `(600, 500)`: RGB `(246, 163, 117)` to retain a simple lid shadow.
- Square-ended horizontal lids: left `(468, 475, 583, 495)`; right `(665, 475, 785, 495)`. Color sampled from master `(540, 470)`: RGB `(16, 9, 13)`.
- This is the narrow owner-approved exception to no portrait drawing: only closing the eyes. No smoothing, new palette colors, eyebrow edits, mouth edits or whole-image recoloring. Build the closed frame by compositing through the binary eye masks over a copy of the master; **every pixel outside them is identical**.

## Output conventions

Convert source to RGB, crop, then resize with Pillow `Image.Resampling.NEAREST`. Save optimized PNG without source metadata.

| Output | Size | State | Alpha |
| --- | --- | --- | --- |
| `favicon-16.png` | 16² | Static open | Rounded |
| `favicon-32.png` | 32² | Open | Rounded |
| `favicon-32-closed.png` | 32² | Closed | Rounded |
| `icon-192.png` | 192² | Open | Rounded |
| `icon-192-closed.png` | 192² | Closed | Rounded |
| `apple-touch-icon.png` | 180² | Static open | Opaque RGB |

For rounded outputs, convert to RGBA and apply the existing final-size pixel-aligned alpha mask: start with an all-zero `L` mask, then `ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 8, fill=255)`. Do not resize the mask. Exterior pixels are transparent, not repainted; RGB remains the portrait's. Open and closed frames have identical alpha. Apple remains square and opaque for platform masking. No ICO or animated WebP is generated.

The focused checks cover source hashes/dimensions, binary masks inside approved bounds, exact outside-mask identity at source/output resolutions, sampled palette, both lids, output dimensions, exact rounded alpha, opaque Apple output, absent metadata, untouched open-master RGB, deterministic generation, and agreement with committed outputs. Runtime scheduling and browser repaint are separate integration checks; PNG checks do not establish browser animation support.
