# Project scenes

These are animated WebP derivatives of the owner's supplied scenes, not generated
effects. Existing `*-pixel.png`, AVIF and static WebP files remain the static image
pipeline. The explicit mapping in `project-art.ts` opts in only those three PNG
URLs. Uploads and owner-editable image previews are not enhanced.

| Project | Supplied original | Original bytes | Card, 480×360 | Page, 960×720 | Loop duration |
| --- | --- | ---: | ---: | ---: | ---: |
| Pantheon | `Desktop/download.webp` (preferred first version) | 4,686,800 | 213,098 | 444,220 | 5,999 ms |
| bg-platform | `Desktop/bg-platform.webp` | 4,501,196 | 192,066 | 885,650 | 7,999 ms |
| Interpreter | `Desktop/interpreter.webp` | 27,873,922 | 595,824 | 1,382,350 | 7,999 ms |

Originals are 1448×1086; keep them outside the repository. Pantheon has 90 frames
at 15 fps; the other sources have 192 frames at 24 fps. All outputs loop forever
(`ANIM` loop count 0). The encoder merges one identical bg-platform card frame
into an 83 ms hold (191 frames total); the other frame counts are unchanged.
FFmpeg's millisecond timebase makes the two 8-second scenes 1 ms shorter.

## Encoding

No app dependencies or runtime encoder are required. For a future re-encode, use
Pillow's animated WebP decoder to stream each composited RGB frame into FFmpeg
(FFmpeg's installed WebP decoder does not reliably accept animated WebP input).
Use 15 fps for Pantheon, 24 fps otherwise. Do not feed a single first frame.

```sh
ffmpeg -hide_banner -loglevel error -y \
  -f rawvideo -pixel_format rgb24 -video_size 1448x1086 -framerate "$FPS" -i pipe:0 \
  -vf "scale=$WIDTH:-1:flags=lanczos" -c:v libwebp_anim \
  -quality "$QUALITY" -compression_level 6 -loop 0 "$OUTPUT"
```

`WIDTH=480 QUALITY=78` for cards; `WIDTH=960 QUALITY=82` for pages. Iterate the
source's `n_frames` with `seek(index)` and write `convert('RGB').tobytes()` to the
process stdin. Check frame count, dimensions, duration and loop count with Pillow
after encoding, and compare decoded samples against the source at the same size.
The delivery test also parses the actual RIFF animation chunks and enforces byte
budgets (1 MB/card, 3 MB/page).

## Playback

Animation URLs are inert data attributes until the static image is decoded and
the existing interaction is eligible: hover/focus on fine-pointer cards, visible
project pages. Reduced motion disables both; touch cards stay static. Static
sources and layout are never changed. A decorative, absolute image displays only
after successful decoding; there are no sweep/corner effects. Leaving the card,
scrolling offscreen, hiding the document, enabling reduced motion or replacing
the image removes the animated source and node, not merely its visibility.
Reactivation creates a fresh image (encoded bytes may come from browser cache).
Errors retain static art without repeated retries until a fresh frame is mounted.
