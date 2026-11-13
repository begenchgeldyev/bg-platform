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

Regenerate after replacing the source artwork. Every derivative is resampled from the
1448 × 1086 master, and the committed `.png` is only the 1200 px fallback, so restore
the master into `<name>-master.png` first:

```bash
# <rev> is any commit that still has the 1448 × 1086 original, e.g. the parent of the
# commit that re-encoded the fallback.
git show <rev>:apps/site/public/projects/pantheon-pixel.png > pantheon-master.png
```

Then, from `apps/site/public/projects`, resample the master into the derivative set and
the fallback (never resize the fallback itself — upscaling it would soften every cover):

```bash
for n in pantheon bg-platform interpreter; do
  for w in 400 800 1200 1448; do
    magick "$n-master.png" -resize "${w}x" -strip -quality 50 "$n-pixel-$w.avif"
    magick "$n-master.png" -resize "${w}x" -strip -quality 82 -define webp:method=6 "$n-pixel-$w.webp"
  done
  magick "$n-master.png" -resize 1200x -strip -define png:compression-level=9 -define png:compression-filter=5 "$n-pixel.png"
done
```
