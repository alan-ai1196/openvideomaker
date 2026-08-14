#!/usr/bin/env python3
"""
Objective quality measurement for the upscale runner. Real-ESRGAN is a
GAN restoration model: it trades pixel fidelity for perceived detail, so
PSNR against the ground truth is the WRONG metric (bicubic usually wins
it). Instead we measure what the model actually promises: restored
high-frequency detail.

- sharpness: mean Laplacian energy of the image (higher = sharper).
- edge energy: mean gradient magnitude.
The 4x output must be sharper than the bicubic baseline on both, and
must approach the true reference's sharpness.

Usage: analyze.py <candidate.png> <reference.png>
Prints one JSON line.
"""
import json
import sys

import numpy as np
from PIL import Image


def laplacian_sharpness(gray):
    laplacian = (
        -4 * gray.astype(np.float64)
        + np.roll(gray.astype(np.float64), 1, 1)
        + np.roll(gray.astype(np.float64), -1, 1)
        + np.roll(gray.astype(np.float64), 1, 0)
        + np.roll(gray.astype(np.float64), -1, 0)
    )
    return float(np.var(laplacian))


def edge_energy(gray):
    gx = np.diff(gray.astype(np.float64), axis=1)
    gy = np.diff(gray.astype(np.float64), axis=0)
    return float(np.mean(np.sqrt(gx[:-1, :] ** 2 + gy[:, :-1] ** 2)))


def gray_of(image):
    return np.asarray(image.convert("L"))


def main():
    candidate_path = sys.argv[1]
    reference_path = sys.argv[2]
    candidate = Image.open(candidate_path).convert("RGB")
    reference = Image.open(reference_path).convert("RGB")
    if candidate.size != reference.size:
        raise RuntimeError("size mismatch: " + str(candidate.size) + " vs " + str(reference.size))
    low = candidate.resize((reference.width // 4, reference.height // 4), Image.Resampling.BICUBIC)
    bicubic = low.resize(reference.size, Image.Resampling.BICUBIC)
    result = {
        "width": candidate.width,
        "height": candidate.height,
        "modelSharpness": round(laplacian_sharpness(gray_of(candidate)), 2),
        "bicubicSharpness": round(laplacian_sharpness(gray_of(bicubic)), 2),
        "referenceSharpness": round(laplacian_sharpness(gray_of(reference)), 2),
        "modelEdgeEnergy": round(edge_energy(gray_of(candidate)), 3),
        "bicubicEdgeEnergy": round(edge_energy(gray_of(bicubic)), 3),
        "referenceEdgeEnergy": round(edge_energy(gray_of(reference)), 3),
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
