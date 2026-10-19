"""Compare the live WebGL frame with the Cycles reference render.

    python qa/diff.py   (after qa/check.mjs)

Prints mean absolute error per channel (0-255) and writes a heatmap of
where the two disagree. Small, smooth differences are expected (AgX in
Three.js vs Blender, specular highlights that a diffuse bake can't hold);
a big or sharp-edged hotspot means a broken bake, UV or shader.
"""
import os
import sys

import numpy as np
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
live_path = os.path.join(here, "shots", "home-lamp-on.png")
ref_path = os.path.join(here, "..", "public", "scene", "reference.png")

live = Image.open(live_path).convert("RGB")
ref = Image.open(ref_path).convert("RGB").resize(live.size, Image.LANCZOS)
a = np.asarray(live, np.float32)
b = np.asarray(ref, np.float32)
err = np.abs(a - b)

mae = err.mean(axis=(0, 1))
print(f"size {live.size}  MAE R {mae[0]:.1f}  G {mae[1]:.1f}  B {mae[2]:.1f}  (0-255)")
print(f"mean luminance  live {a.mean():.1f}  cycles {b.mean():.1f}")

heat = np.clip(err.mean(axis=2) * 4, 0, 255).astype(np.uint8)
Image.fromarray(heat).save(os.path.join(here, "shots", "diff-heatmap.png"))
sys.exit(0 if mae.mean() < 25 else 1)
