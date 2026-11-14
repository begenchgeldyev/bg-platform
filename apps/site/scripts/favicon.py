"""Deterministic portrait processing; public entry point is favicon.ts."""

import argparse
import hashlib
from pathlib import Path

import PIL
from PIL import Image, ImageDraw, ImageFont

SITE = Path(__file__).resolve().parents[1]
ROOT = SITE.parents[1]
CROP = (224, 0, 1024, 800)
SOURCES = (
    ("open-master.png", (1254, 1254), "2cc2e8f44044f6c45eb0390ea0dff0cf2749565526ee6c35bb97238891511772"),
    ("closed-reference.png", (1086, 1448), "f116d5b4eed73f7b91ec3ee20c95f78c33a1812a6fc5c9823227dffc78f2bfaf"),
)
# Half-open rectangles form stepped masks; nothing outside them is rewritten.
EYE_RECTS = ((468, 443, 600, 504), (468, 504, 583, 526),
             (648, 443, 785, 504), (665, 504, 785, 526))
LIDS = ((468, 475, 583, 495), (665, 475, 785, 495))
OUTPUTS = (
    ("favicon-16.png", 16, "open", True),
    ("favicon-32.png", 32, "open", True),
    ("favicon-32-closed.png", 32, "closed", True),
    ("icon-192.png", 192, "open", True),
    ("icon-192-closed.png", 192, "closed", True),
    ("apple-touch-icon.png", 180, "open", False),
)


def rectangle(draw, bounds, fill):
    left, top, right, bottom = bounds
    draw.rectangle((left, top, right - 1, bottom - 1), fill=fill)


def frames():
    if PIL.__version__ != "13.0.0":
        raise RuntimeError(f"Use Pillow 13.0.0 for reproducible output; found {PIL.__version__}")
    for filename, size, digest in SOURCES:
        path = SITE / "assets/favicon" / filename
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Source hash mismatch: {filename}")
        with Image.open(path) as image:
            if image.size != size:
                raise ValueError(f"Source dimensions mismatch: {filename}")
    with Image.open(SITE / "assets/favicon/open-master.png") as source:
        opened = source.convert("RGB")
    mask = Image.new("L", opened.size)
    for bounds in EYE_RECTS:
        rectangle(ImageDraw.Draw(mask), bounds, 255)
    # Sample actual master pixels, not invented or averaged colors.
    skin = opened.getpixel((590, 510))
    upper_skin = opened.getpixel((600, 500))
    lid = opened.getpixel((540, 470))
    treatment = opened.copy()
    draw = ImageDraw.Draw(treatment)
    for bounds in EYE_RECTS:
        rectangle(draw, bounds, skin)
    for left, top, right, _ in (EYE_RECTS[0], EYE_RECTS[2]):
        rectangle(draw, (left, top, right, 475), upper_skin)
    for bounds in LIDS:
        rectangle(draw, bounds, lid)
    closed = Image.composite(treatment, opened, mask)
    return opened, closed, mask


def generate(destination):
    opened, closed, _ = frames()
    destination.mkdir(parents=True, exist_ok=True)
    for filename, size, state, rounded in OUTPUTS:
        source = opened if state == "open" else closed
        image = source.crop(CROP).resize((size, size), Image.Resampling.NEAREST)
        if rounded:
            image = image.convert("RGBA")
            alpha = Image.new("L", image.size)
            ImageDraw.Draw(alpha).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 8, fill=255)
            image.putalpha(alpha)
        image.info.clear()
        image.save(destination / filename, optimize=True)


def proof():
    destination = ROOT / ".slim/deepwork/animated-favicon"
    destination.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=22)
    small = ImageFont.load_default(size=17)
    canvas = Image.new("RGB", (1100, 1190), "#eeeeee")
    draw = ImageDraw.Draw(canvas)
    draw.text((30, 20), "OPEN MASTER  /  CLOSED EYELIDS", font=font, fill="#171717")
    draw.text((30, 55), "192px assets at 2x; nearest-neighbor. Smile, hair and all non-eye pixels stay fixed.", font=small, fill="#333333")
    for x, suffix, label in [(100, "", "OPEN"), (616, "-closed", "CLOSED")]:
        draw.text((x, 97), label, font=font, fill="#171717")
        icon = Image.open(SITE / "public" / f"icon-192{suffix}.png").convert("RGBA")
        icon = icon.resize((384, 384), Image.Resampling.NEAREST)
        canvas.paste(icon, (x, 135), icon)
        draw.text((x, 550), "32px asset at 10x", font=small, fill="#333333")
        icon = Image.open(SITE / "public" / f"favicon-32{suffix}.png").convert("RGBA")
        large = icon.resize((320, 320), Image.Resampling.NEAREST)
        canvas.paste(large, (x, 588), large)
        draw.text((x, 936), "Actual size: 32px / 192px", font=small, fill="#333333")
        canvas.paste(icon, (x, 980), icon)
        full = Image.open(SITE / "public" / f"icon-192{suffix}.png").convert("RGBA")
        canvas.paste(full, (x + 65, 980), full)
    canvas.save(destination / "paired-preview.png", optimize=True)
    opened, closed, mask = frames()
    # Source-resolution evidence, not shipped assets.
    opened.crop(CROP).save(destination / "open-crop.png", optimize=True)
    closed.crop(CROP).save(destination / "closed-crop.png", optimize=True)
    mask.crop(CROP).save(destination / "eye-mask.png", optimize=True)
    print(f"Proof: {destination / 'paired-preview.png'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--proof", action="store_true")
    args = parser.parse_args()
    generate(SITE / "public")
    for filename, *_ in OUTPUTS:
        path = SITE / "public" / filename
        print(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {filename}")
    if args.proof:
        proof()
