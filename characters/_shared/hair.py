"""
Shared hair kit: every haircut starts from a close-cropped cap that hugs
the skull from a hairline up to the crown; a style adds blocky volume on
top. Hairlines are a height per head ring angle (base.BOXY8), so receding
temples or a bald crown are just different numbers.

    cap(color, hairline)             the cropped shell on its own (also: under a helmet)
    side_sweep, swept_up, quiff, curly_top, swept_back, curly_mullet, crop_top, buzz,
    ponytail
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
FADE_DARK = "hair_fade_dark"


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


# How far up the shell a top block starts, per head angle: low at the
# forehead, high at the back, so the block thins out into the crown instead
# of sitting on the cap as a ring.
BLEND = {55: 0.3, 125: 0.3, 20: 0.45, 160: 0.45, 340: 0.72, 200: 0.72, 305: 0.9, 235: 0.9}


CAP_OFFSETS, CAP_LIFTS = (0.008, 0.012, 0.016), (0.0, 0.008, 0.02)


def _at(vals, f):
    """Value at fraction f from three given at the hairline, half way (0.55)
    and the crown: how cap() spreads its offsets and lifts."""
    return vals[0] + (vals[1] - vals[0]) * f / 0.55 if f <= 0.55 else \
        vals[1] + (vals[2] - vals[1]) * (f - 0.55) / 0.45


def flush(hairline, angle, f, offsets=CAP_OFFSETS, lifts=CAP_LIFTS, extra=0.003):
    """Point just outside a cap built with these offsets and lifts: a block
    whose edge sits here meets the cap without a step."""
    return on_cap(hairline, angle, f, _at(offsets, f) + extra, _at(lifts, f))


def blend_ring(hairline, offset, lift=0.0):
    """Base points for a top block that tapers into the cap at the back."""
    return [on_cap(hairline, a, f, offset, lift) for a, f in BLEND.items()]


def cap(color, hairline=FULL, offsets=CAP_OFFSETS, lifts=CAP_LIFTS, region="hair",
        crown=True, fs=(0.0, 0.3, 0.55, 0.8, 1.0), row_colors=None):
    """Close-cropped shell from the hairline to the crown: rows of the
    head's eight facets at fractions fs of the way up, plus a flat crown.
    offsets and lifts are given at the hairline, half way and the crown.
    crown=False leaves the top open (a bald crown). row_colors: a swatch per band
    of rows from the bottom up, for a fade that darkens towards the top."""
    m = base.Mesh()

    at = _at
    shades = list(row_colors or []) + [color] * len(fs)
    rows = []
    for f in fs:
        rows.append([base.head_point(a, z + (CROWN - z) * f, at(offsets, f)) + Vector((0, 0, at(lifts, f)))
                     for a, z in ((a, hairline[a]) for a in base.BOXY8)])
    n = len(base.BOXY8)
    for k in range(len(rows) - 1):
        for i in range(n):
            j = (i + 1) % n
            m.face([rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]], shades[k], region)
    if crown:
        m.face(rows[-1], shades[len(fs) - 2], region)   # same as the top band
    return m


# ------------------------------------------------------------ hair shells
# A styled cut as one quad shell over the head's eight facets: rows from the
# hairline up, each a fraction f of the way to the crown, an offset off the
# skull and a lift, given per facet group. A short-sides-long-top cut is
# the same grid with a step row where the top starts, so the two colours
# meet on an edge instead of one block poking through another.
GROUPS = {"front": (55, 125), "temple": (20, 160), "side": (200, 340), "back": (235, 305)}


def per(front, temple, side, back):
    """A value per head angle from one per facet group."""
    vals = {"front": front, "temple": temple, "side": side, "back": back}
    return {a: vals[g] for g, angles in GROUPS.items() for a in angles}


def _val(v, a):
    return v[a] if isinstance(v, dict) else v


def shell(hairline, rows, colors, peak, region="hair"):
    """rows: (f, offset, lift) with each a number or a per() dict; colors: a
    swatch (or per() dict, by the facet's first angle) for each band between
    rows; the top row closes in a fan to the peak point in the last colour."""
    m = base.Mesh()
    angles = base.BOXY8
    pts = []
    for f, off, lift in rows:
        ring = []
        for a in angles:
            fa = _val(f, a)
            z = hairline_at(hairline, a)
            ring.append(base.head_point(a, z + (CROWN - z) * fa, _val(off, a)) + Vector((0, 0, _val(lift, a))))
        pts.append(ring)
    n = len(angles)
    def pick(c, i, j):
        # a facet between two groups takes the colour of the one further
        # from the forehead, the same on both sides
        far = lambda a: abs((a - 90 + 180) % 360 - 180)  # noqa: E731
        return _val(c, max(angles[i], angles[j], key=far))
    for k in range(len(rows) - 1):
        for i in range(n):
            j = (i + 1) % n
            m.face([pts[k][i], pts[k][j], pts[k + 1][j], pts[k + 1][i]], pick(colors[k], i, j), region)
    for i in range(n):
        j = (i + 1) % n
        m.face([pts[-1][i], pts[-1][j], Vector(peak)], pick(colors[-1], i, j), region)
    return m


def short_sides(base_f, top_rows):
    """Rows for a shell with close-cut sides up to base_f (per angle) and a
    longer top: the hairline, a mid row, the top of the sides, then the
    top's rows (the first should sit a little above base_f, further out:
    the step where the longer hair starts)."""
    return [(0.0, 0.006, 0.0),
            ({a: f / 2 for a, f in base_f.items()}, per(0.007, 0.008, 0.009, 0.009), per(0.0, 0.001, 0.001, 0.0)),
            (base_f, per(0.008, 0.009, 0.010, 0.010), per(0.0, 0.002, 0.003, 0.002))] + top_rows


def _above(base_f, df):
    return {a: f + df for a, f in base_f.items()}


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
    """Short sides and a longer top swept up from the forehead and over to
    one side (lean=1 to the right, -1 to the left), as one shell."""
    if helmet:
        return cap(color, hairline)
    lead, trail = (55, 125) if lean > 0 else (125, 55)
    base_f = per(0.03, 0.36, 0.42, 0.5)
    rows = short_sides(base_f, [
        (_above(base_f, 0.08), per(0.018, 0.015, 0.014, 0.013), per(0.012, 0.005, 0.004, 0.003)),
        (per(0.42, 0.64, 0.7, 0.76), per(0.024, 0.02, 0.017, 0.015),
         {**per(0.032, 0.016, 0.012, 0.010), lead: 0.040, trail: 0.026}),
        (per(0.82, 0.9, 0.92, 0.94), per(0.017, 0.016, 0.013, 0.011),
         {**per(0.050, 0.034, 0.024, 0.019), lead: 0.056, trail: 0.044})])
    return shell(hairline, rows, [color] * 6, (lean * 0.025, 0.03, CROWN + 0.055))


def swept_up_hull(color, hairline=FULL, helmet=False, lean=1):
    """Earlier swept_up: a hull block over the cap. Short sides and a tapered block swept up and over to one side
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
    """Short sides and a tall quiff pushed up from the forehead and back
    over the crown, as one shell."""
    if helmet:
        return cap(color, hairline)
    base_f = per(0.03, 0.36, 0.42, 0.5)
    rows = short_sides(base_f, [
        (_above(base_f, 0.08), per(0.020, 0.016, 0.015, 0.014), per(0.016, 0.006, 0.005, 0.004)),
        (per(0.4, 0.62, 0.68, 0.74), per(0.030, 0.023, 0.019, 0.016), per(0.068, 0.026, 0.016, 0.011)),
        (per(0.8, 0.88, 0.9, 0.93), per(0.022, 0.019, 0.015, 0.012), per(0.098, 0.058, 0.036, 0.022))])
    return shell(hairline, rows, [color] * 6, (0.0, 0.04, CROWN + 0.088))


def quiff_hull(color, hairline=FULL, helmet=False):
    """Earlier quiff: a hull block over the cap. Short sides and a tall quiff: a block pushed up from the forehead and
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
    # the fade darkens in steps up to the curls: light at the ears, a
    # darker band, then the hair colour under the block
    m = cap(fade, hairline, offsets=(0.004, 0.007, 0.012), lifts=(0.0, 0.004, 0.01),
            fs=(0.0, 0.22, 0.42, 0.6, 0.8, 1.0), row_colors=(fade, FADE_DARK, color, color, color))
    if helmet:
        return m
    h = hairline
    mass = blend_ring(h, 0.010, 0.006)
    def up(z):
        return CROWN + (z - CROWN) * height
    mass += [Vector((x, y, up(z))) for x, y, z in ((0.06, 0.10, 1.80), (-0.06, 0.10, 1.80), (0.0, 0.115, 1.81),
                                                   (0.065, 0.01, 1.81), (-0.065, 0.01, 1.81),
                                                   (0.02, 0.06, 1.835), (-0.03, 0.0, 1.835))]
    n_cap = len(m.faces)
    m.hull(mass, color, "hair")
    block = range(n_cap, len(m.faces))
    # lumps half sunk into the block break up its outline into curls
    for x, y, z in ((0.055, 0.09, 1.815), (-0.045, 0.095, 1.82), (0.005, 0.06, 1.84), (0.075, 0.02, 1.81),
                    (-0.07, 0.03, 1.815), (0.03, -0.03, 1.83), (-0.03, -0.035, 1.825)):
        m.hull(lump(x, y, up(z) - 0.006 * (1 - height), 0.024 * (0.6 + 0.4 * height)), color, "hair")
    # the cap under the block and the sunk halves of the curls never show
    return m.cull_inside(block, [*range(n_cap), *range(block.stop, len(m.faces))])


def lump(x, y, z, r):
    """A chunky curl: an irregular eight-point blob, the same every build."""
    c = Vector((x, y, z))
    return [c + Vector(d) * r for d in ((1, 0.2, 0.1), (-0.9, 0.3, 0.0), (0.2, 1, -0.2), (-0.3, -0.9, 0.2),
                                        (0.1, 0.2, 0.9), (0.3, -0.2, -0.8), (0.6, 0.6, 0.5), (-0.6, -0.5, -0.5))]


def swept_back(color, temples, hairline=FULL, helmet=False):
    """Hair longer on top, swept back from the forehead over the crown and
    down to the nape as one shell, greyer at the temples and above the ears
    (temples), with a little more lift on the right at the front."""
    if helmet:
        return cap(temples, hairline)
    base_f = per(0.03, 0.34, 0.26, 0.05)
    rows = short_sides(base_f, [
        (_above(base_f, 0.1), per(0.020, 0.016, 0.018, 0.020), per(0.014, 0.006, 0.005, 0.002)),
        (per(0.45, 0.62, 0.55, 0.45), per(0.025, 0.021, 0.022, 0.022), {**per(0.032, 0.016, 0.013, 0.010), 55: 0.036}),
        (per(0.84, 0.9, 0.88, 0.85), per(0.018, 0.016, 0.016, 0.017), per(0.042, 0.031, 0.027, 0.024))])
    colors = [per(color, temples, temples, color)] * 2 + [color] * 4
    return shell(hairline, rows, colors, (0.0, 0.0, CROWN + 0.042))


def swept_back_hull(color, temples, hairline=FULL, helmet=False):
    """Earlier swept_back: a hull block and two wave blocks over the cap.
    Wavy hair, longer on top and swept back from the forehead to the
    crown and down to the nape, greyer at the temples (the cap colour)."""
    m = cap(temples, hairline)
    if helmet:
        return m
    h = hairline
    # the base sits flush on the cap: grey shows at the temples and sides,
    # and at the back the top hair runs smoothly down to the nape
    pts = [flush(h, a, f) for a, f in ((55, 0.2), (125, 0.2), (20, 0.4), (160, 0.4),
                                       (340, 0.3), (200, 0.3), (305, 0.06), (235, 0.06))]
    pts += [flush(h, a, f, extra=0.012) for a, f in ((305, 0.5), (235, 0.5), (340, 0.7), (200, 0.7))]
    pts += [Vector((0.05, 0.112, 1.77)), Vector((-0.05, 0.112, 1.765)), Vector((0.0, 0.118, 1.778)),
            Vector((0.06, 0.06, 1.80)), Vector((-0.06, 0.06, 1.80)), Vector((0.0, 0.02, 1.815)),
            Vector((0.055, -0.05, 1.79)), Vector((-0.055, -0.05, 1.79))]
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
    n_cap = len(m.faces)
    m.hull(back, color, "hair")
    block = range(n_cap, len(m.faces))
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
    # cap and curl faces buried in the back block never show
    return m.cull_inside(block, [*range(n_cap), *range(block.stop, len(m.faces))])


def crop_top_hull(color, temples, hairline=FULL, helmet=False):
    """Earlier crop_top: a hull block over the cap (its edge steps where
    the two meet). Short textured crop: greyer close-cut sides (the cap colour) and a
    low block on top, lifted a little at the front."""
    m = cap(temples, hairline, offsets=(0.007, 0.010, 0.012), lifts=(0.0, 0.004, 0.01))
    if helmet:
        return m
    h = hairline
    offsets, lifts = (0.007, 0.010, 0.012), (0.0, 0.004, 0.01)
    pts = [flush(h, a, f, offsets, lifts) for a, f in BLEND.items()]
    pts += [flush(h, a, 0.05, offsets, lifts, 0.006) for a in (55, 125)]
    pts += [Vector(p) for p in ((0.045, 0.112, 1.775), (-0.045, 0.11, 1.772), (0.0, 0.115, 1.782),
                                (0.05, 0.03, 1.795), (-0.05, 0.03, 1.792))]
    return m.hull(pts, color, "hair")


def crop_top(color, temples, hairline=FULL, helmet=False):
    """Short textured crop as one shell: greyer close-cut sides (temples)
    up to a step, then a low top lifted a little at the front."""
    if helmet:
        return cap(temples, hairline, offsets=(0.007, 0.010, 0.012), lifts=(0.0, 0.004, 0.01))
    base_f = per(0.03, 0.30, 0.36, 0.44)
    rows = short_sides(base_f, [
        (_above(base_f, 0.10), per(0.016, 0.014, 0.014, 0.013), per(0.010, 0.006, 0.006, 0.006)),
        (per(0.5, 0.7, 0.76, 0.82), per(0.019, 0.018, 0.017, 0.016), per(0.020, 0.012, 0.011, 0.010)),
        (per(0.86, 0.92, 0.94, 0.96), per(0.014, 0.012, 0.011, 0.010), per(0.028, 0.022, 0.019, 0.017))])
    colors = [per(color, temples, temples, temples)] * 2 + [color] * 4
    return shell(hairline, rows, colors, (0.0, 0.012, CROWN + 0.032))


def buzz(color, hairline=RECEDING, helmet=False):
    """Very short all over: just the cap, close to the scalp."""
    return cap(color, hairline, offsets=(0.009, 0.009, 0.010), lifts=(0.0, 0.003, 0.008))


TIE = "charcoal"
# The ponytail's path down the back of the head, (y, z, half width, half
# depth) from inside the tie down to the tip between the shoulder blades
TAIL = [(-0.108, 1.668, 0.024, 0.021), (-0.142, 1.648, 0.036, 0.030), (-0.160, 1.592, 0.040, 0.032),
        (-0.160, 1.510, 0.036, 0.028), (-0.150, 1.425, 0.028, 0.021), (-0.140, 1.350, 0.016, 0.013),
        (-0.134, 1.300, 0.004, 0.004)]


def ponytail(color, tie=TIE, hairline=FULL, helmet=False, length=1.0):
    """Long hair pulled back smooth from the forehead into a ponytail: one
    shell over the head with a little lift on top, a hair tie at the back
    of the head and a tapered tail hanging to between the shoulder blades
    (length < 1 cuts it shorter). Under a helmet only the shell's lowest
    rows stay and the tail still hangs out at the back."""
    rows = [(0.0, 0.007, 0.0),
            (per(0.25, 0.3, 0.3, 0.3), per(0.012, 0.012, 0.012, 0.013), per(0.003, 0.002, 0.002, 0.002)),
            (per(0.55, 0.6, 0.6, 0.62), per(0.016, 0.015, 0.015, 0.016), per(0.010, 0.008, 0.007, 0.006)),
            (per(0.85, 0.88, 0.88, 0.9), per(0.015, 0.014, 0.014, 0.014), per(0.018, 0.015, 0.013, 0.012))]
    m = cap(color, hairline) if helmet else shell(hairline, rows, [color] * 4, (0.0, -0.01, CROWN + 0.024))
    # hair tie: a short band round the root of the tail
    y0, z0 = TAIL[0][:2]
    y1, z1 = TAIL[1][:2]
    c0, c1 = Vector((0, y0, z0)), Vector((0, y1, z1))
    axis = (c1 - c0).normalized()
    u, v, w = base.frame(axis, base.X)
    tie_at = (c0 + (c1 - c0) * 0.25, c0 + (c1 - c0) * 0.5)
    m.loft([[p + v * math.cos(math.radians(a)) * 0.032 + u * math.sin(math.radians(a)) * 0.028
             for a in base.HEX6] for p in tie_at], tie, "hair_tie")
    # the tail: hexagonal sections along the path, wider than deep
    keep = max(3, round(len(TAIL) * length))
    path = TAIL[:keep - 1] + TAIL[-1:] if keep < len(TAIL) else TAIL
    if keep < len(TAIL):  # pull the tip up to the shorter end
        path[-1] = (path[-2][0] + 0.006, path[-2][1] - 0.05, 0.003, 0.003)
    secs = []
    for k, (y, z, hw, hd) in enumerate(path):
        c = Vector((0, y, z))
        a = Vector((0, *path[max(k - 1, 0)][:2])), Vector((0, *path[min(k + 1, len(path) - 1)][:2]))
        u, v, w = base.frame(a[1] - a[0], base.X)
        secs.append([c + v * math.cos(math.radians(t)) * hw + u * math.sin(math.radians(t)) * hd
                     for t in base.HEX6])
    m.loft(secs, color, "ponytail")
    return m
