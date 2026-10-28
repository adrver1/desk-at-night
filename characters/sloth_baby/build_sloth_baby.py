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


def on_head(rings, x, z, offset):
    """Point on (or `offset` off) the front of the head at (x, z)."""
    ru = head_point(rings, 0, z).x
    a = math.degrees(math.acos(max(-0.98, min(0.98, x / ru))))
    return head_point(rings, a, z, offset)


def patch(m, rings, outline, centre, offset, swatch, region):
    """A flat-coloured piece on the head: a fan from `centre` to an outline
    of (x, z) points, every corner lifted onto the head so a piece of any
    size hugs the curve instead of sinking under it."""
    c = on_head(rings, *centre, offset)
    pts = [on_head(rings, x, z, offset) for x, z in outline]
    for i in range(len(pts)):   # wound to face out: x runs to the viewer's left
        m.face([c, pts[(i + 1) % len(pts)], pts[i]], swatch, region)


def ellipse(cx, cz, a, b, tilt=0.0, n=10, bulge=0.0):
    """Outline of an ellipse (half axes a along the tilted axis, b across);
    bulge > 0 widens the end the axis points to: a teardrop."""
    t = math.radians(tilt)
    out = []
    for i in range(n):
        p = 2 * math.pi * i / n
        u, v = a * math.cos(p), b * math.sin(p) * (1 + bulge * math.cos(p))
        out.append((cx + u * math.cos(t) - v * math.sin(t), cz + u * math.sin(t) + v * math.cos(t)))
    return out


# Face layout in head units (times the head scale k), from the eye line:
# eye patch centre, half axes, droop (degrees, outer end down), eye size
EYES = dict(x=0.027, z=-0.002, a=0.020, b=0.0125, droop=22, eye=0.0085)


def face(m, rings, zc, k):
    """The three-toed sloth's face, drawn cute: a cream mask with a fringe of
    fur dipping into it at the top, dark drooping teardrop patches round big
    shiny eyes, a round dark nose and a little smile, pink cheeks."""
    # cream mask: one piece over the whole front, its top edge dipping in a
    # point at the middle where the head fur comes down (the fringe)
    mask = []
    for i in range(16):
        p = 2 * math.pi * i / 16
        x, z = 0.060 * math.cos(p), (0.036 if p < math.pi else 0.030) * math.sin(p)   # flatter under the chin
        if z > 0:
            z -= 0.012 * max(0.0, 1 - abs(x) / 0.025)   # fringe point
        mask.append((x * k, zc + (z - 0.008) * k))
    patch(m, rings, mask, (0, zc - 0.008 * k), 0.0015, FACE, "face")
    e = EYES
    for s in (1, -1):
        cx, cz = s * e["x"] * k, zc + e["z"] * k
        patch(m, rings, ellipse(cx, cz, e["a"] * k, e["b"] * k, -s * e["droop"] if s > 0 else 180 + e["droop"],
                                n=12, bulge=0.25), (cx, cz), 0.003, MASK, "mask")
        # the eye sits towards the inner, upper end of its patch
        ex, ez = cx - s * 0.004 * k, cz + 0.002 * k
        patch(m, rings, ellipse(ex, ez, e["eye"] * k, e["eye"] * k * 1.1, n=10), (ex, ez), 0.0045, "eye", "eye")
        gx, gz = ex - s * 0.0025 * k, ez + 0.003 * k
        patch(m, rings, ellipse(gx, gz, 0.0028 * k, 0.0028 * k, n=6), (gx, gz), 0.006, "white", "glint")
        bx, bz = s * 0.042 * k, zc - 0.024 * k
        patch(m, rings, ellipse(bx, bz, 0.009 * k, 0.005 * k, n=8), (bx, bz), 0.0025, "blush", "blush")
    # nose: a small rounded bump, wider than tall
    n0 = on_head(rings, 0, zc - 0.016 * k, 0.0)
    nose = [n0 + Vector((dx * k, dy * k, dz * k)) for dx, dy, dz in
            ((-0.010, 0.002, 0.0), (0.010, 0.002, 0.0), (-0.007, 0.002, 0.006), (0.007, 0.002, 0.006),
             (-0.006, 0.002, -0.006), (0.006, 0.002, -0.006), (0.0, 0.009, 0.001), (-0.005, 0.008, 0.003),
             (0.005, 0.008, 0.003))]
    m.hull(nose, MASK, "nose")
    # smile: a shallow U under the nose, as a thin strip
    pts = [(x * k, zc + (-0.030 + 28 * x * x) * k) for x in (-0.011, -0.0055, 0.0, 0.0055, 0.011)]
    lo = [on_head(rings, x, z - 0.0013 * k, 0.003) for x, z in pts]
    hi = [on_head(rings, x, z + 0.0013 * k, 0.003) for x, z in pts]
    for i in range(len(pts) - 1):
        m.face([hi[i], hi[i + 1], lo[i + 1], lo[i]], "lip_dark", "mouth")


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
    face(head, rings, zc, k)
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
