"""
sloth_baby: a baby three-toed sloth for a character to hug and cuddle. A
prop on the shared palette and material, not on the crew rig: a player
parents it to the holder's chest bone while the `hug` clip plays (see
anims.HUG_HOLD for where it sits).

Two looks, both kept (STYLE picks the live one, sloth_baby.glb):

    plush    a round cuddly toy: big head, short stubby limbs
    baby     a real baby sloth: smaller head, long arms with three
             cream claws, shaggy tufts on the back

Every look has the three-toed sloth's face: a pale mask, dark stripes
running back from the eyes, a dark nose and a little smile.

    python characters/sloth_baby/build_sloth_baby.py [--style plush|baby|all]

Modelled sitting upright, origin under its bottom, facing +Y like the
cast, about 0.3 m tall.
"""
import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import base_body as base  # noqa: E402  (imports bpy)
import bpy  # noqa: E402

Vector, X, Y, Z = base.Vector, base.X, base.Y, base.Z
FUR, DARK, FACE, MASK, CLAW = "sloth_fur", "sloth_fur_dark", "sloth_face", "sloth_mask", "claw"
STYLE = "plush"

STYLES = {
    # head rings scale, head height, limb length, limb thickness, tufts
    "plush": dict(head=1.25, neck=0.17, arm=0.10, limb=0.026, tufts=False, claws=False),
    "baby": dict(head=1.0, neck=0.18, arm=0.16, limb=0.019, tufts=True, claws=True),
}


def head_point(rings, angle, z, offset=0.0):
    """Point on the head tube at a ring angle and height (between rings)."""
    for (z0, u0, v0, d0, _), (z1, u1, v1, d1, _) in zip(rings, rings[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            ru, rv, dv = u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, d0 + (d1 - d0) * t
            a = math.radians(angle)
            return Vector(((ru + offset) * math.cos(a), dv + (rv + offset) * math.sin(a), z))
    raise ValueError(z)


def limb(m, a, b, r, swatch, claws, region):
    """A tapered hexagonal limb from a to b, with three claws past b."""
    d = (b - a)
    u, v, w = base.frame(d, Z)
    L = d.length
    m.tube([(0.0, r, r, 0.0, region), (L * 0.6, r * 0.95, r * 0.9, 0.0, region), (L, r * 0.75, r * 0.7, 0.0, region)],
           origin=a, axes=(u, v, w), angles=base.HEX6, swatch=swatch)
    if claws:
        for k in (-1, 0, 1):
            s = b + u * (k * r * 0.55)
            m.bar(s, s + w * 0.035 - v * 0.012 + u * k * 0.004, 0.006, CLAW, "claw")
    else:  # plush: a pale paw pad
        m.hull([b - w * 0.002 + u * x + v * y for x in (-r * 0.5, r * 0.5) for y in (-r * 0.5, r * 0.5)]
               + [b + w * 0.006], FACE, "paw")


def sloth(style):
    st = STYLES[style]
    m = base.Mesh()
    # body: a pear sitting on its bottom
    m.tube([(0.0, 0.040, 0.036, 0.0, "body"), (0.03, 0.068, 0.060, 0.0, "body"), (0.08, 0.075, 0.066, 0.004, "body"),
            (0.13, 0.064, 0.056, 0.0, "body"), (st["neck"], 0.040, 0.036, -0.004, "body")],
           colors={"body": FUR})
    k, z0 = st["head"], st["neck"] - 0.02
    rings = [(z0, 0.040 * k, 0.036 * k, 0.004, "head"), (z0 + 0.025 * k, 0.062 * k, 0.056 * k, 0.010, "head"),
             (z0 + 0.065 * k, 0.066 * k, 0.058 * k, 0.010, "head"), (z0 + 0.095 * k, 0.052 * k, 0.046 * k, 0.004, "head"),
             (z0 + 0.110 * k, 0.026 * k, 0.024 * k, 0.0, "head")]
    head = base.Mesh().tube(rings, colors={"head": FUR})
    zc = z0 + 0.052 * k                      # eye line
    # pale face mask: a thin shell over the front of the head (a decal this
    # big would sink under the head's bulge), then the dark stripes back
    # from the eyes, nose and smile on top of it
    rows = [zc + dz * k for dz in (-0.040, -0.022, -0.004, 0.014, 0.030)]
    cols = (28, 55, 90, 125, 152)
    grid = [[head_point(rings, a, z, 0.0015) for a in cols] for z in rows]
    for i in range(len(rows) - 1):
        for j in range(len(cols) - 1):
            head.face([grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]], FACE, "face")
    bvh = head.bvh()
    for s in (1, -1):
        # the stripe runs from the eye down and back, so the face looks gentle
        stripe = [(s * 0.010 * k, zc + 0.005 * k), (s * 0.028 * k, zc + 0.007 * k), (s * 0.054 * k, zc - 0.010 * k),
                  (s * 0.050 * k, zc - 0.019 * k), (s * 0.026 * k, zc - 0.009 * k), (s * 0.010 * k, zc - 0.005 * k)]
        head.decal_poly(bvh, stripe, MASK, "mask", lift=0.002)
        head.decal(bvh, s * 0.021 * k, zc, 0.010 * k, 0.010 * k, "eye", "eye", lift=0.0035)
        head.decal(bvh, s * 0.018 * k, zc + 0.003 * k, 0.0035 * k, 0.0035 * k, "white", "glint", lift=0.004)
    head.decal(bvh, 0.0, zc - 0.019 * k, 0.018 * k, 0.011 * k, MASK, "nose", lift=0.002)
    for s in (1, -1):
        head.decal(bvh, s * 0.008 * k, zc - 0.031 * k, 0.014 * k, 0.003 * k, "lip_dark", "mouth", tilt=-s * 18, lift=0.002)
    m.extend(head)
    # arms reach forward and up, as if hugging the holder's arm; legs forward
    r = st["limb"]
    for s in (1, -1):
        sh = Vector((s * 0.052, 0.012, 0.125))
        limb(m, sh, sh + Vector((s * 0.035, 0.7, -0.35)).normalized() * st["arm"], r, FUR, st["claws"], "arm")
        hip = Vector((s * 0.040, 0.025, 0.035))
        limb(m, hip, hip + Vector((s * 0.4, 0.85, 0.1)).normalized() * st["arm"] * 0.75, r * 1.05, FUR, st["claws"], "leg")
    if st["tufts"]:  # shaggy fur on the back and shoulders
        for x, y, z in ((0.03, -0.055, 0.10), (-0.035, -0.05, 0.07), (0.0, -0.06, 0.04), (0.05, -0.03, 0.14),
                        (-0.05, -0.03, 0.14)):
            m.hull(_tuft(x, y, z), DARK, "tuft")
    return m


def _tuft(x, y, z, r=0.022):
    c = Vector((x, y, z))
    out = Vector((x, y, 0)).normalized()
    return [c + out * r * 0.9 + Z * r * 0.2, c + Z * r * 0.5, c - Z * r * 0.9 + out * r * 0.3,
            c + out.cross(Z) * r * 0.6, c - out.cross(Z) * r * 0.6, c - out * r * 0.3]


def build(style, out):
    base.reset()
    ob = sloth(style).to_object("sloth_baby" + ("" if style == STYLE else f"_{style}"))
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    path = os.path.join(out, ob.name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True)
    print(f"{ob.name}: {tris} triangles -> {path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="all", choices=[*STYLES, "all"])
    ap.add_argument("--out", default=HERE)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    for s in (STYLES if args.style == "all" else [args.style]):
        build(s, args.out)
