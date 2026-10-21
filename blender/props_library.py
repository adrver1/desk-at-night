"""Save every prop, in every variant, side by side in one .blend: a library
to open in Blender or append from, next to the code that builds them.

    python blender/props_library.py [--out blender/build/props_library.blend]
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import props  # noqa: E402

bpy = b.bpy

p = argparse.ArgumentParser()
p.add_argument("--out", default=os.path.join(b.BUILD, "props_library.blend"))
args = p.parse_args()

bpy.ops.wm.read_factory_settings(use_empty=True)
m = props.materials()
makers = [f for f in props.ALL if f is not props.make_wall_clock]
items = [(f.__name__[5:], f(m)) for f in makers]
for style in ("station", "office", "dark"):
    items.append((f"wall_clock_{style}", props.make_wall_clock(m, f"WallClock_{style}", style)))
x = 0.0
for name, o in items:  # in a row along X, a gap after each
    lo = min((o.matrix_world @ b.Vector(c)).x for c in o.bound_box)
    hi = max((o.matrix_world @ b.Vector(c)).x for c in o.bound_box)
    props.place(o, x - lo, 0.0, 1.0 if name.startswith("wall_clock") else 0.0)
    x += hi - lo + 0.3
    o["library_name"] = name
os.makedirs(os.path.dirname(args.out), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=args.out)
print("wrote", args.out, len(items), "props", flush=True)
