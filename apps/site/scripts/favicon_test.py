"""Focused asset checks, invoked through bun test favicon.test.ts."""

import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

SITE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("favicon", Path(__file__).with_name("favicon.py"))
favicon = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(favicon)


class PortraitAssets(unittest.TestCase):
    def test_sources(self):
        for filename, size, digest in favicon.SOURCES:
            path = SITE / "assets/favicon" / filename
            with Image.open(path) as image:
                self.assertEqual(image.size, size)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

    def test_eye_only_source_changes_and_sampled_palette(self):
        opened, closed, mask = favicon.frames()
        self.assertEqual(opened.size, (1254, 1254))
        self.assertEqual(mask.mode, "L")
        self.assertEqual(set(mask.get_flattened_data()), {0, 255})
        changed = ImageChops.difference(opened, closed)
        self.assertIsNotNone(changed.getbbox())
        self.assertIsNone(ImageChops.multiply(changed, ImageChops.invert(mask).convert("RGB")).getbbox())
        envelope = Image.new("L", opened.size)
        draw = ImageDraw.Draw(envelope)
        for left, top, right, bottom in [(468, 443, 600, 526), (648, 443, 785, 526)]:
            draw.rectangle((left, top, right - 1, bottom - 1), fill=255)
        self.assertIsNone(ImageChops.subtract(mask, envelope).getbbox())
        palette = set(opened.get_flattened_data())
        self.assertTrue(set(closed.get_flattened_data()).issubset(palette))
        for bounds in [(468, 475, 583, 495), (665, 475, 785, 495)]:
            self.assertEqual(set(closed.crop(bounds).get_flattened_data()), {opened.getpixel((540, 470))})

    def test_sizes_alpha_metadata_and_exact_open_master(self):
        opened, _, _ = favicon.frames()
        for filename, size, state, rounded in favicon.OUTPUTS:
            with self.subTest(filename=filename):
                image = Image.open(SITE / "public" / filename)
                self.assertEqual(image.size, (size, size))
                self.assertEqual(image.info, {})
                if rounded:
                    self.assertEqual(image.mode, "RGBA")
                    expected = Image.new("L", (size, size))
                    ImageDraw.Draw(expected).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 8, fill=255)
                    self.assertEqual(image.getchannel("A").tobytes(), expected.tobytes())
                else:
                    self.assertEqual(image.mode, "RGB")
                    self.assertEqual(image.convert("RGBA").getchannel("A").getextrema(), (255, 255))
                if state == "open":
                    expected = opened.crop((224, 0, 1024, 800)).resize((size, size), Image.Resampling.NEAREST)
                    self.assertEqual(image.convert("RGB").tobytes(), expected.tobytes())

    def test_output_differences_stay_in_scaled_masks(self):
        _, _, mask = favicon.frames()
        for size, prefix in [(32, "favicon"), (192, "icon")]:
            opened = Image.open(SITE / "public" / f"{prefix}-{size}.png")
            closed = Image.open(SITE / "public" / f"{prefix}-{size}-closed.png")
            self.assertEqual(opened.getchannel("A").tobytes(), closed.getchannel("A").tobytes())
            difference = ImageChops.difference(opened.convert("RGB"), closed.convert("RGB"))
            scaled = mask.crop((224, 0, 1024, 800)).resize((size, size), Image.Resampling.NEAREST)
            self.assertIsNotNone(difference.getbbox())
            self.assertIsNone(ImageChops.multiply(difference, ImageChops.invert(scaled).convert("RGB")).getbbox())
            for half in [(0, 0, size // 2, size), (size // 2, 0, size, size)]:
                self.assertIsNotNone(difference.crop(half).getbbox(), "Both eyes must visibly close")

    def test_deterministic_and_committed_outputs_current(self):
        with tempfile.TemporaryDirectory(prefix="favicon-") as first, tempfile.TemporaryDirectory(prefix="favicon-") as second:
            favicon.generate(Path(first))
            favicon.generate(Path(second))
            for filename, *_ in favicon.OUTPUTS:
                a = (Path(first) / filename).read_bytes()
                self.assertEqual(a, (Path(second) / filename).read_bytes())
                self.assertEqual(a, (SITE / "public" / filename).read_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
