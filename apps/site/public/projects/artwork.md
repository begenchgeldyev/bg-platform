# Project covers

User-supplied, approved artwork for Pantheon, bg-platform and Interpreter.

Each `*-pixel.png` is an opaque, metadata-clean **1200 × 900 (4:3)** PNG fallback;
`projects.image` in the database stores that `.png` URL, so it must keep working.
Each format/width derivative is a plain resample of the same 1448 × 1086 source:

- `*-pixel-{400,800,1200,1448}.avif` — AVIF quality 50
- `*-pixel-{400,800,1200,1448}.webp` — WebP quality 82, method 6

The gallery card renders `<picture>` with AVIF, then WebP, then the PNG as the
`<img>` fallback, at `sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 384px"`.
The detail page uses the same set at `sizes="(max-width: 767px) 100vw, 768px"` and
loads eagerly with `fetchpriority="high"`. Card sources stay deferred in
`data-srcset` until the IntersectionObserver in the gallery activates them; on a
decode error every `<source>` is dropped so the PNG (or the icon placeholder)
takes over. No prototype artwork is included here.

Regenerate after replacing the source artwork. The derivatives are resampled from the
1448 × 1086 master, which the committed `.png` no longer is (it is the 1200 px
fallback); restore it first with `git show <rev>:apps/site/.../<name>-pixel.png`.

```bash
for n in pantheon bg-platform interpreter; do
  for w in 400 800 1200 1448; do
    magick "$n-pixel.png" -resize "${w}x" -strip -quality 50 "$n-pixel-$w.avif"
    magick "$n-pixel.png" -resize "${w}x" -strip -quality 82 -define webp:method=6 "$n-pixel-$w.webp"
  done
  magick "$n-pixel.png" -resize 1200x -strip -define png:compression-level=9 -define png:compression-filter=5 "$n-pixel.png"
done
```
