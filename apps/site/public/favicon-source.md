# Portrait icons

Derived from the owner-provided 1086 × 1448 pixel-art portrait; the original is not included.

- Source SHA-256: `a56f8e9a3cb7f9dc566b0798ad928c1d3599c926469a0844254c1e41f7be56de`.
- Square face/hair crop: `(207, 64, 879, 736)` in source pixels (left, top, right, bottom; right/bottom exclusive).
- Convert to RGB, then resize the 672 × 672 crop with Pillow `Image.Resampling.NEAREST`.
- Outputs: `favicon-16.png` (16²), `favicon-32.png` (32²), `icon-192.png` (192²), `apple-touch-icon.png` (180²).
- For the 16/32/192px favicons, convert to RGBA and apply a pixel-aligned rounded alpha mask with radius `size // 8` (2/4/24px). Pillow recipe: start with an all-zero `L` mask, then `ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 8, fill=255)` and `image.putalpha(mask)`. Exterior pixels are transparent, not painted a background color; portrait RGB pixels remain unchanged.
- Keep `apple-touch-icon.png` square and opaque for platform masking.
- Save as optimized PNG without source metadata. No portrait drawing, recoloring, or smoothing; the alpha mask is not resampled.

Explicit PNG links in the shared document head cover public and admin pages; no ICO or additional route is required.
