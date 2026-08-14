#!/usr/bin/env python3
"""
Synthetic test image for the rmbg runner: an ellipse 'subject' on a
two-tone background. Deterministic (seeded), so verification is
repeatable even without the upstream demo clip.

Usage: make_fixture.py <output.png>
"""
import sys

import numpy as np
from PIL import Image, ImageDraw


def main():
    width, height = 640, 480
    rng = np.random.default_rng(7)
    base = np.zeros((height, width, 3), dtype=np.uint8)
    base[:, : width // 2] = [235, 233, 228]  # warm white
    base[:, width // 2 :] = [188, 202, 214]  # cool blue-grey
    # Texture the background so it is not trivially flat.
    noise = rng.integers(0, 10, size=(height, width), dtype=np.uint8)
    for c in range(3):
        base[:, :, c] = np.clip(base[:, :, c].astype(np.int16) + noise.astype(np.int16), 0, 255).astype(np.uint8)
    img = Image.fromarray(base)
    draw = ImageDraw.Draw(img)
    draw.ellipse((150, 60, 490, 430), fill=(120, 74, 58), outline=(86, 52, 40), width=6)
    draw.ellipse((240, 110, 400, 250), fill=(224, 196, 168))  # face-ish inner
    img.save(sys.argv[1], "PNG")


if __name__ == "__main__":
    main()
