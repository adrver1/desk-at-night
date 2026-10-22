"""
Shared accessories any character can wear: everyday glasses and a headset.
Each returns a Mesh in its own region; a character passes
{region: "head"} in `rigid` so it follows the head bone.

    glasses(style)   "rect_thick" (dark, chunky), "rect_thin", "thin_metal", "round_brown",
                     "round_thick" (heavy black, rounded), "aviator" (gold
                     teardrop sunglasses, dark lenses, double bridge)
    headset()        over-ear headset with a band over the hair and a cable
    beanie(color)    knitted hat with a turned-up cuff
    goggles()        ski goggles with a wide lens and a strap round the hat
"""
import math

import base_body as base

Vector = base.Vector

EYE_Z = 1.617                       # centre height of the eyes
GLASSES = {
    # style: (frame swatch, lens half width, half height, frame thickness, frame depth)
    "rect_thick": ("plastic_black", 0.027, 0.017, 0.0055, 0.006),
    "thin_metal": ("steel", 0.026, 0.018, 0.0025, 0.003),
    "rect_thin": ("charcoal", 0.027, 0.020, 0.0035, 0.004),   # tall enough not to cut the eyes
    "round_brown": ("leather_brown", 0.025, 0.019, 0.0045, 0.005),
    "round_thick": ("plastic_black", 0.026, 0.020, 0.0065, 0.007),
    "aviator": ("gold", 0.029, 0.022, 0.0022, 0.003),
}
# Aviator teardrop in a unit box: u from the nose (-1) to the temple (+1),
# a flat top and a deep rounded drop on the nose side
AVIATOR = [(-0.95, 0.80), (-0.35, 1.0), (0.55, 1.0), (1.0, 0.70), (0.95, 0.05), (0.62, -0.62),
           (0.0, -1.0), (-0.62, -0.85), (-0.95, -0.25)]


def _front_y(x, z):
    """How far forward the face is at (x, z), from the head rings."""
    a = math.degrees(math.acos(max(-1.0, min(1.0, x / 0.118))))
    return base.head_point(a, z).y


def _rim(m, cx, cz, y, hw, hh, t, d, swatch, region, round_=False, outline=None):
    """A lens frame: a flat loop of t-wide bars round a hole hw x hh,
    d deep, facing +Y. Round frames cut the corners into an octagon;
    `outline` gives any other shape in a unit box."""
    if outline:
        outline = [(u * hw, v * hh) for u, v in outline]
    elif round_:
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
    aviator = style == "aviator"
    for s in (1, -1):
        shape = None
        if aviator:
            # mirror for each side, kept anticlockwise seen from the front
            shape = [(s * u, v) for u, v in AVIATOR]
            area = sum(u0 * v1 - u1 * v0 for (u0, v0), (u1, v1) in zip(shape, shape[1:] + shape[:1]))
            shape = shape if area > 0 else shape[::-1]
        cz = EYE_Z - (0.003 if aviator else 0.0)
        _rim(m, s * cx, cz, y, hw, hh, t, d, swatch, region, round_=style.startswith("round"), outline=shape)
        if aviator:
            # dark lens filling the frame, set just behind its front
            m.face([Vector((s * cx + u * hw, y - d * 0.5, cz + v * hh)) for u, v in reversed(shape)], "lens", region)
        # arm: from the outer edge of the frame back to the top of the ear
        # along the side of the head, clear of the temple, to rest on the ear
        w = max(t * 0.6, 0.0025)
        a = Vector((s * (cx + hw + t), y - d, EYE_Z + hh * 0.6))
        b = Vector((s * 0.127, 0.055, 1.632))
        m.bar(a, b, w, swatch, region)
        m.bar(b, (s * 0.129, -0.022, 1.630), w, swatch, region)
    if aviator:
        # the aviator's straight brow bar over the bridge
        m.bar((cx - hw * 0.4, y - d * 0.5, EYE_Z + hh * 0.95), (-(cx - hw * 0.4), y - d * 0.5, EYE_Z + hh * 0.95),
              t * 0.6, swatch, region)
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
    headband(m, swatch, region, clear, cy)
    # cable from under the left cup to the collar
    m.bar((-0.142, cy + 0.01, cz - 0.034), (-0.09, 0.07, 1.47), 0.0022, swatch, region)
    return m


def headband(m, swatch, region, clear=0.015, cy=-0.012, end=(0.152, 1.636), width=0.011, thick=0.007):
    """A band over the top of the head from one cup to the other, `clear`
    above the scalp, through the plane y = cy."""
    path = []
    for z in (1.635, 1.70, 1.745):
        p = base.head_point(0, z, clear)
        path.append((p.x, z))
    path.append((0.0, base.HEAD[-1][0] + clear * 0.9))
    pts = [(x, z) for x, z in path] + [(-x, z) for x, z in reversed(path[:-1])]
    pts = [end] + pts + [(-end[0], end[1])]

    def out(x, z, k):
        # push a band point outward from the middle of the head
        n = Vector((x, 0, z - 1.62)).normalized() * k
        return x + n.x, z + n.z
    # one bent band: a four-sided section at each point of the path
    return m.loft([[Vector((px, cy + dy, pz)) for k, dy in ((0.0, -width), (thick, -width), (thick, width), (0.0, width))
                    for px, pz in (out(x, z, k),)] for x, z in pts], swatch, region)


def beanie(color, cuff=None, region="beanie"):
    """Knitted beanie pulled down to the brows, with a turned-up cuff."""
    cuff = cuff or color
    rings = []
    for z, zh, off, reg in ((1.655, 1.655, 0.022, "cuff"), (1.70, 1.70, 0.026, "cuff"), (1.702, 1.70, 0.018, "hat"),
                            (1.75, 1.72, 0.018, "hat"), (1.79, 1.74, 0.0, "hat"), (1.805, 1.75, -0.02, "hat")):
        ru, rv, dv = base.ring_at(base.HEAD, zh)
        rings.append((z, ru + off, rv + off, dv, reg))
    return base.Mesh().tube(rings, colors={"cuff": cuff, "hat": color}, cap_start=False)


def goggles(lens="hivis_orange", frame="plastic_black", strap="plastic_black", region="goggles"):
    """Ski goggles over the eyes: one wide lens in a thick frame, and a
    strap round the head."""
    m = base.Mesh()
    y = _front_y(0.06, EYE_Z) + 0.018
    m.hull([Vector((x, yy, z)) for x in (-0.095, 0.095) for yy in (y - 0.03, y) for z in (EYE_Z - 0.03, EYE_Z + 0.03)],
           frame, region)
    m.hull([Vector((x, y + 0.004, z)) for x in (-0.085, 0.085) for z in (EYE_Z - 0.022, EYE_Z + 0.022)]
           + [Vector((x, y - 0.002, z)) for x in (-0.085, 0.085) for z in (EYE_Z - 0.022, EYE_Z + 0.022)], lens, region)
    strap_rings = [(EYE_Z - 0.014, 0.0), (EYE_Z + 0.014, 0.0)]
    rings = []
    for z, _ in strap_rings:
        ru, rv, dv = base.ring_at(base.HEAD, z)
        rings.append((z, ru, rv, dv, region))
    m.tube(rings, swatch=strap, offset=0.026, cap_start=False, cap_end=False)
    return m
