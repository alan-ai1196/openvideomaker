#!/usr/bin/env python3
"""
Alpha-matte statistics for a cutout PNG, used by verify.mjs to turn
'it produced a file' into objective evidence: the subject region must
be opaque and the background corners must be transparent.

Usage: analyze.py <cutout.png> <mode>
mode 'face': subject box is the central 40%; 'synthetic': central 35%.
Prints one JSON line with the measurements.
"""
import json
import sys

import numpy as np
from PIL import Image


def region_mean(alpha, box):
    x0, y0, x1, y1 = box
    return float(np.mean(alpha[y0:y1, x0:x1]))


def main():
    path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "face"
    img = Image.open(path)
    if img.mode != "RGBA":
        raise RuntimeError("expected RGBA cutout, got " + img.mode)
    width, height = img.size
    alpha = np.asarray(img)[:, :, 3].astype(np.float32) / 255.0
    cx0 = int(width * 0.5) - int(width * 0.20)
    cx1 = int(width * 0.5) + int(width * 0.20)
    cy0 = int(height * 0.5) - int(height * 0.20)
    cy1 = int(height * 0.5) + int(height * 0.20)
    subject = region_mean(alpha, (cx0, cy0, cx1, cy1))
    corner = min(int(width * 0.1), int(height * 0.1))
    corners = [
        region_mean(alpha, (0, 0, corner, corner)),
        region_mean(alpha, (width - corner, 0, width, corner)),
        region_mean(alpha, (0, height - corner, corner, height)),
        region_mean(alpha, (width - corner, height - corner, width, height)),
    ]
    background = float(np.mean(corners))
    result = {
        "mode": mode,
        "width": width,
        "height": height,
        "subjectAlpha": round(subject, 4),
        "backgroundAlpha": round(background, 4),
        "alphaGap": round(subject - background, 4),
        "subjectOpaqueFraction": round(float(np.mean(alpha[cy0:cy1, cx0:cx1] > 0.5)), 4),
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
