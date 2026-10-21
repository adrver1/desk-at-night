"""
Shared accessories any character can wear: everyday glasses and a headset.
Each returns a Mesh in its own region; a character passes
{region: "head"} in `rigid` so it follows the head bone.

    glasses(style)   "rect_thick" (dark, chunky), "thin_metal", "round_brown"
    headset()        over-ear headset with a band over the hair and a cable
"""
import math

import base_body as base

Vector = base.Vector

EYE_Z = 1.617                       # centre height of the eyes
GLASSES = {
    # style: (frame swatch, lens half width, half height, frame thickness, frame depth)
    "rect_thick": ("plastic_black", 0.027, 0.017, 0.0055, 0.006),
    "thin_metal": ("steel", 0.026, 0.018, 0.0025, 0.003),
    "round_brown": ("leather_brown", 0.025, 0.019, 0.0045, 0.005),
}


def _front_y(x, z):
    """How far forward the face is at (x, z), from the head rings."""
    a = math.degrees(math.acos(max(-1.0, min(1.0, x / 0.118))))
    return base.head_point(a, z).y


def _rim(m, cx, cz, y, hw, hh, t, d, swatch, region, round_=False):
    """A lens frame: a flat loop of t-wide bars round a hole hw x hh,
    d deep, facing +Y. Round frames cut the corners into an octagon."""
    if round_:
        k = 0.42
        outline = [(-hw, -hh * k), (-hw * k, -hh), (hw * k, -hh), (hw, -hh * k),
                   (hw, hh * k), (hw * k, hh), (-hw * k, hh), (-hw, hh * k)]
    else:
        outline = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    n = len(outline)
    # outer loop pushed out by t along each corner's diagonal
    inner = [Vector((cx + u, y, cz + v)) for u, v in outline]
    outer = []
    for u, v in outline:
        ln = math.hypot(u / hw, v / hh)
        outer.append(Vector((cx + u + t * (u / hw) / ln * 1.4, y, cz + v + t * (v / hh) / ln * 1.4)))
    back = Vector((0, -d, 0))
    for i in range(n):
        j = (i + 1) % n
        # front face of the frame, its outer edge and its inner edge (the hole)
        m.face([inner[i], inner[j], outer[j], outer[i]], swatch, region)
        m.face([outer[i], outer[j], outer[j] + back, outer[i] + back], swatch, region)
        m.face([inner[j], inner[i], inner[i] + back, inner[j] + back], swatch, region)


def glasses(style="thin_metal"):
    """Everyday glasses: two lens frames, a bridge and arms to the ears.
    The lenses are open, so the eyes show through."""
    swatch, hw, hh, t, d = GLASSES[style]
    m = base.Mesh()
    region = "glasses"
    cx = 0.045
    y = max(_front_y(cx + hw, EYE_Z), _front_y(cx, EYE_Z)) + 0.010
    for s in (1, -1):
        _rim(m, s * cx, EYE_Z, y, hw, hh, t, d, swatch, region, round_=style == "round_brown")
        # arm: from the outer edge of the frame back to the top of the ear
        m.bar((s * (cx + hw + t), y - d, EYE_Z + hh * 0.6), (s * 0.121, -0.02, 1.628),
              max(t * 0.6, 0.0025), swatch, region)
    # bridge over the nose
    m.bar((cx - hw - t * 0.5, y - d * 0.5, EYE_Z + hh * 0.35), (-(cx - hw - t * 0.5), y - d * 0.5, EYE_Z + hh * 0.35),
          max(t * 0.5, 0.0022), swatch, region)
    return m


def headset(swatch="plastic_black", clear=0.015):
    """Over-ear headset: round cups on the ears, a band arching over the
    hair (`clear` above the scalp) and a cable from the left cup down to
    the collar."""
    m = base.Mesh()
    region = "headset"
    cy, cz = -0.012, 1.600
    for s in (1, -1):
        # cushion and cup, hexagonal pucks
        for x0, x1, r in ((0.128, 0.140, 0.040), (0.140, 0.160, 0.036)):
            pts = []
            for x, k in ((x0, 1.0), (x1, 0.85)):
                for i in range(6):
                    a = math.radians(30 + 60 * i)
                    pts.append(Vector((s * x, cy + k * r * math.cos(a), cz + k * r * math.sin(a))))
            m.hull(pts, swatch, region)
    # band: from the top of each cup up the side of the head and over
    path = []
    for z in (1.635, 1.68, 1.72, 1.745):
        p = base.head_point(0, z, clear)
        path.append((p.x, z))
    path.append((0.0, base.HEAD[-1][0] + clear * 0.9))
    pts = [(x, z) for x, z in path] + [(-x, z) for x, z in reversed(path[:-1])]
    pts = [(0.152, 1.636)] + pts + [(-0.152, 1.636)]
    def out(x, z, k):
        # push a band point outward from the middle of the head
        n = Vector((x, 0, z - 1.62)).normalized() * k
        return x + n.x, z + n.z
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        m.hull([Vector((px, cy + dy, pz)) for x, z in ((x0, z0), (x1, z1)) for k in (0.0, 0.007)
                for px, pz in (out(x, z, k),) for dy in (-0.011, 0.011)], swatch, region)
    # cable from under the left cup to the collar
    m.bar((-0.142, cy + 0.01, cz - 0.034), (-0.09, 0.07, 1.47), 0.0022, swatch, region)
    return m
