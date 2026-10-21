"""
Shared hair kit: every haircut starts from a close-cropped cap that hugs
the skull from a hairline up to the crown; a style adds blocky volume on
top. Hairlines are a height per head ring angle (base.BOXY8), so receding
temples or a bald crown are just different numbers.

    cap(color, hairline)             the cropped shell on its own (also: under a helmet)
    side_sweep, swept_up, quiff, curly_top, swept_back, curly_mullet, crop_top, buzz
                                      styles; each takes helmet=True to keep
                                      only what shows under a hard hat
"""
import math

import base_body as base

Vector = base.Vector
CROWN = base.HEAD[-1][0]

# Hairline height at each head ring angle: high on the forehead (55, 125),
# at the temples (20, 160), above the ears (200, 340) and low at the nape.
FULL = {20: 1.635, 55: 1.708, 125: 1.708, 160: 1.635, 200: 1.600, 235: 1.578, 305: 1.578, 340: 1.600}
RECEDING = {20: 1.680, 55: 1.735, 125: 1.735, 160: 1.680, 200: 1.600, 235: 1.578, 305: 1.578, 340: 1.600}
HELMET_RIM = 1.655


def hairline_at(hairline, angle):
    """Hairline height at any angle, between the corner values."""
    keys = sorted(hairline)
    a = angle % 360
    for k0, k1 in zip(keys[-1:] + keys, keys + keys[:1]):
        span = (k1 - k0) % 360
        if (a - k0) % 360 <= span:
            t = ((a - k0) % 360) / span
            return hairline[k0] + (hairline[k1] - hairline[k0]) * t
    return hairline[keys[0]]


def on_cap(hairline, angle, f, offset=0.011, lift=0.008):
    """Point on the hair shell: f = 0 at the hairline, 1 at the crown."""
    z = hairline_at(hairline, angle)
    return base.head_point(angle, z + (CROWN - z) * f, offset) + Vector((0, 0, lift))


def cap(color, hairline=FULL, offsets=(0.008, 0.012, 0.016), lifts=(0.0, 0.008, 0.02), region="hair",
        crown=True, fs=(0.0, 0.3, 0.55, 0.8, 1.0)):
    """Close-cropped shell from the hairline to the crown: rows of the
    head's eight facets at fractions fs of the way up, plus a flat crown.
    offsets and lifts are given at the hairline, half way and the crown.
    crown=False leaves the top open (a bald crown)."""
    m = base.Mesh()

    def at(vals, f):
        return vals[0] + (vals[1] - vals[0]) * f / 0.55 if f <= 0.55 else \
            vals[1] + (vals[2] - vals[1]) * (f - 0.55) / 0.45
    rows = []
    for f in fs:
        rows.append([base.head_point(a, z + (CROWN - z) * f, at(offsets, f)) + Vector((0, 0, at(lifts, f)))
                     for a, z in ((a, hairline[a]) for a in base.BOXY8)])
    n = len(base.BOXY8)
    for k in range(len(rows) - 1):
        for i in range(n):
            j = (i + 1) % n
            m.face([rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]], color, region)
    if crown:
        m.face(rows[-1], color, region)
    return m


def side_sweep(color, hairline=FULL, helmet=False):
    """Short sides and one fringe block swept from a parting on the left
    across the top to the right temple."""
    m = cap(color, hairline)
    if helmet:
        return m
    h = hairline
    pts = [on_cap(h, a, f) for a, f in ((20, 0.2), (55, 0.1), (125, 0.35), (20, 0.75), (55, 0.7), (340, 0.6))]
    pts += [Vector((-0.045, 0.10, 1.768)), Vector((-0.04, 0.02, 1.792)), Vector((-0.04, -0.05, 1.775)),
            Vector((0.02, 0.112, 1.77)), Vector((0.07, 0.10, 1.742)), Vector((0.112, 0.06, 1.70)),
            Vector((0.03, 0.03, 1.80)), Vector((0.085, 0.0, 1.765))]
    return m.hull(pts, color, "hair")


def swept_up(color, hairline=FULL, helmet=False, lean=1):
    """Short sides and a tapered block swept up and over to one side
    (lean=1 to the right, -1 to the left)."""
    m = cap(color, hairline)
    if helmet:
        return m
    h, s = hairline, lean
    pts = [on_cap(h, a, 0.12, 0.010) for a in (55, 125)] + [on_cap(h, a, 0.6) for a in (20, 55, 125, 160)]
    pts += [Vector((s * 0.045, 0.112, 1.775)), Vector((-s * 0.04, 0.110, 1.768)),
            Vector((s * 0.06, 0.07, 1.805)), Vector((-s * 0.01, 0.075, 1.81)),
            Vector((s * 0.05, -0.01, 1.796)), Vector((-s * 0.04, -0.015, 1.79)),
            Vector((0.0, -0.075, 1.772))]
    return m.hull(pts, color, "hair")


def quiff(color, hairline=FULL, helmet=False):
    """Short sides and a tall quiff: a block pushed up from the forehead and
    back over the crown."""
    m = cap(color, hairline)
    if helmet:
        return m
    h = hairline
    pts = [on_cap(h, a, 0.1, 0.010) for a in (55, 125)] + [on_cap(h, a, 0.55) for a in (20, 160, 200, 340)]
    pts += [Vector(p) for p in ((0.05, 0.118, 1.79), (-0.05, 0.116, 1.785), (0.04, 0.10, 1.835),
                                (-0.04, 0.095, 1.83), (0.055, 0.02, 1.83), (-0.055, 0.02, 1.826),
                                (0.05, -0.06, 1.795), (-0.05, -0.06, 1.795), (0.0, -0.095, 1.765))]
    return m.hull(pts, color, "hair")


def curly_top(color, fade, hairline=FULL, helmet=False, height=1.0):
    """Skin fade: the sides are a tight cap in the fade colour, the top is a
    block of curls, highest at the front. height < 1 crops the top shorter."""
    m = cap(fade, hairline, offsets=(0.004, 0.007, 0.012), lifts=(0.0, 0.004, 0.01))
    if helmet:
        return m
    h = hairline
    mass = [on_cap(h, a, 0.4, 0.010, 0.004) for a in base.BOXY8]
    def up(z):
        return CROWN + (z - CROWN) * height
    mass += [Vector((x, y, up(z))) for x, y, z in ((0.06, 0.10, 1.80), (-0.06, 0.10, 1.80), (0.0, 0.115, 1.81),
                                                   (0.07, 0.0, 1.81), (-0.07, 0.0, 1.81), (0.05, -0.07, 1.79),
                                                   (-0.05, -0.07, 1.79), (0.02, 0.06, 1.835), (-0.03, 0.0, 1.835))]
    m.hull(mass, color, "hair")
    # lumps half sunk into the block break up its outline into curls
    for x, y, z in ((0.055, 0.09, 1.815), (-0.045, 0.095, 1.82), (0.005, 0.06, 1.84), (0.075, 0.02, 1.81),
                    (-0.07, 0.03, 1.815), (0.03, -0.035, 1.83), (-0.035, -0.06, 1.815)):
        m.hull(lump(x, y, up(z) - 0.006 * (1 - height), 0.024 * (0.6 + 0.4 * height)), color, "hair")
    return m


def lump(x, y, z, r):
    """A chunky curl: an irregular eight-point blob, the same every build."""
    c = Vector((x, y, z))
    return [c + Vector(d) * r for d in ((1, 0.2, 0.1), (-0.9, 0.3, 0.0), (0.2, 1, -0.2), (-0.3, -0.9, 0.2),
                                        (0.1, 0.2, 0.9), (0.3, -0.2, -0.8), (0.6, 0.6, 0.5), (-0.6, -0.5, -0.5))]


def swept_back(color, temples, hairline=FULL, helmet=False):
    """Wavy hair, longer on top and swept back from the forehead to the
    crown and down to the nape, greyer at the temples (the cap colour)."""
    m = cap(temples, hairline)
    if helmet:
        return m
    h = hairline
    pts = [on_cap(h, a, 0.25, 0.012) for a in (20, 55, 125, 160)]
    pts += [on_cap(h, a, 0.4, 0.016) for a in (200, 235, 305, 340)]
    pts += [Vector((0.05, 0.112, 1.77)), Vector((-0.05, 0.112, 1.765)), Vector((0.0, 0.118, 1.778)),
            Vector((0.06, 0.06, 1.80)), Vector((-0.06, 0.06, 1.80)), Vector((0.0, 0.02, 1.815)),
            Vector((0.06, -0.05, 1.79)), Vector((-0.06, -0.05, 1.79)), Vector((0.0, -0.10, 1.76)),
            Vector((0.05, -0.12, 1.70)), Vector((-0.05, -0.12, 1.70))]
    m.hull(pts, color, "hair")
    # Two waves breaking over the forehead, one to each side
    for s, y in ((1, 0.10), (-1, 0.095)):
        m.hull([Vector((s * 0.015, y + 0.016, 1.79)), Vector((s * 0.085, y - 0.01, 1.775)),
                Vector((s * 0.06, y - 0.03, 1.80)), Vector((s * 0.03, y - 0.03, 1.81)),
                Vector((s * 0.05, y + 0.012, 1.765))], color, "hair")
    return m


def curly_mullet(color, hairline=RECEDING, helmet=False):
    """Receding on top with a thin layer of curls on the crown, full curly
    sides and a curly mullet down the back of the neck."""
    m = cap(color, hairline, offsets=(0.006, 0.009, 0.012), lifts=(0.0, 0.004, 0.01))
    h = hairline
    # The full part: from above the ears round the back and down the nape
    back = [on_cap(h, a, f, 0.03, 0.0) for a in (200, 235, 305, 340) for f in (0.0, 0.45)]
    back += [on_cap(h, a, 0.1, 0.022, 0.0) for a in (20, 160)]
    back += [Vector(p) for p in ((0.10, -0.09, 1.50), (-0.10, -0.09, 1.50), (0.05, -0.115, 1.44),
                                 (-0.05, -0.115, 1.44), (0.0, -0.135, 1.53), (0.0, -0.14, 1.64),
                                 (0.125, -0.04, 1.53), (-0.125, -0.04, 1.53))]
    if helmet:
        back = [p for p in back if p.z < HELMET_RIM + 0.01]
    m.hull(back, color, "hair")
    curls = [Vector(p) for p in ((0.128, -0.035, 1.64), (-0.128, -0.035, 1.64), (0.13, -0.05, 1.555),
                                 (-0.13, -0.05, 1.555), (0.11, -0.08, 1.585), (-0.11, -0.08, 1.585),
                                 (0.075, -0.11, 1.49), (-0.075, -0.11, 1.49), (0.0, -0.13, 1.46),
                                 (0.0, -0.14, 1.58))]
    # thinner curls over the crown sit on the cap; a helmet hides them
    top = [on_cap(h, a, f, 0.006, 0.0) for a, f in ((55, 0.35), (125, 0.35), (90, 0.75), (20, 0.5), (160, 0.5),
                                                    (270, 0.7))]
    for c in curls + ([] if helmet else top):
        if helmet and c.z > HELMET_RIM:
            continue
        m.hull(lump(c.x, c.y, c.z, 0.024), color, "hair")
    return m


def crop_top(color, temples, hairline=FULL, helmet=False):
    """Short textured crop: greyer close-cut sides (the cap colour) and a
    low block on top, lifted a little at the front."""
    m = cap(temples, hairline, offsets=(0.007, 0.010, 0.012), lifts=(0.0, 0.004, 0.01))
    if helmet:
        return m
    h = hairline
    pts = [on_cap(h, a, 0.05, 0.012) for a in (55, 125)] + [on_cap(h, a, 0.45, 0.014) for a in base.BOXY8]
    pts += [Vector(p) for p in ((0.045, 0.112, 1.775), (-0.045, 0.11, 1.772), (0.0, 0.115, 1.782),
                                (0.05, 0.03, 1.795), (-0.05, 0.03, 1.792), (0.0, -0.06, 1.785))]
    return m.hull(pts, color, "hair")


def buzz(color, hairline=RECEDING, helmet=False):
    """Very short all over: just the cap, close to the scalp."""
    return cap(color, hairline, offsets=(0.009, 0.009, 0.010), lifts=(0.0, 0.003, 0.008))
