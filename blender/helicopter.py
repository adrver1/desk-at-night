"""
Low-poly twin-engine offshore helicopter in the 8-tonne class (AW189-like),
parked with its rotors stopped, for the platform's helideck.

Proportions follow the public type figures: 17.6 m long with the rotors
turning, a 14.6 m five-blade main rotor, a 2.9 m four-blade tail rotor,
5.06 m high and 3.02 m across the sponsons. The fuselage is a loft of
14-point cross sections, so the paint lines of a livery follow its shape
the way real cheat lines do; every livery band is a ring of faces, not a
texture.

    python blender/helicopter.py                    # preview stills, every livery
    python blender/helicopter.py --samples 16       # faster, noisier
    python blender/helicopter.py --only deck-navy   # one shot

Like the platform, everything is merged into one mesh per material and no
textures are used. Origin is the ground under the main rotor mast, +X points
to the nose and +Z up. Liveries are kept side by side in LIVERIES (the asset
library); LIVERY picks the one the scene uses.

Renders go to blender/build/helicopter/, and the .blend is saved next to them.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import offshore_platform as op  # noqa: E402

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402


def srgb(h):
    """'#rrggbb' to linear RGB, so colours can be copied from a palette."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


NAVY, SLATE, SAND, WHITE = srgb("#02293c"), srgb("#73838d"), srgb("#d2ccb3"), srgb("#eceeee")
SIGNAL, DEEP_BLUE = srgb("#d8261c"), srgb("#1b2a6b")

# Paint bands of the cross section, bottom to top (see PROFILE): belly,
# lower side, stripe, pinstripe, upper side, window band, shoulder, roof. A
# livery names a colour key for each band, separately for the cabin and the
# tail boom, plus the fin, the engine cowling, the sponsons, the window
# frames (None for none) and the tail rotor blade and tip colours.
BANDS = ("belly", "lower", "stripe", "pin", "upper", "windows", "shoulder", "roof")
LIVERIES = {
    # Navy below, white above, a sand cheat line between, navy tail
    "navy": {"cabin": ("navy", "navy", "sand", "white", "white", "white", "white", "white"),
             "boom": ("navy", "navy", "sand", "navy", "navy", "navy", "navy", "navy"),
             "fin": "navy", "cowl": "white", "sponson": "navy"},
    # Navy all over with a white roof and cowling, slate tail, sand stripe
    "dark": {"cabin": ("navy", "navy", "sand", "navy", "navy", "navy", "white", "white"),
             "boom": ("slate", "slate", "sand", "slate", "slate", "slate", "slate", "slate"),
             "fin": "slate", "cowl": "white", "sponson": "navy"},
    # White with a slate belly, a navy band that widens along the boom, navy fin
    "white": {"cabin": ("slate", "white", "navy", "white", "white", "white", "white", "white"),
              "boom": ("slate", "navy", "navy", "navy", "navy", "navy", "white", "white"),
              "fin": "navy", "cowl": "white", "sponson": "slate"},
    # Offshore operator style: red top and nose, white below, a blue cheat
    # line with a white pinstripe that sweeps up into a blue boom and fin,
    # white window frames, red and white striped tail rotor
    "redtop": {"cabin": ("white", "white", "blue", "white", "signal", "signal", "signal", "signal"),
               "boom": ("white", "white", "blue", "white", "blue", "blue", "blue", "blue"),
               "fin": "blue", "cowl": "signal", "sponson": "white", "frame": "white",
               "tail_rotor": ("white", "signal")},
}
LIVERY = "redtop"

# Half cross section as (width, height) fractions, from the keel to the roof
# line; mirrored to a closed ring of 18 points (see _band for the paint).
PROFILE = [(0.0, 0.0), (0.82, 0.03), (1.0, 0.20), (1.0, 0.36), (1.0, 0.43),
           (1.0, 0.455), (1.0, 0.50), (0.95, 0.88), (0.0, 1.0)]
SHOULDER = (0.70, 0.977)  # extra point between the window top and the roof line

# Sections along the fuselage: (x, keel z, roof z, half width), the main
# rotor mast at 0, the tail rotor hub at -8.85. The nose comes in two shapes
# (NOSE picks): "pointed", the long nose cone of the real aircraft, its top
# rising to the windscreen so the windscreen's side pane is a triangle with
# glass above WINDSCREEN_Z; and "blunt", the first one, glass to the tip.
NOSES = {
    "pointed": {"sections": [(7.50, 1.00, 1.22, 0.10), (7.30, 0.85, 1.40, 0.40), (6.80, 0.68, 1.56, 0.70),
                             (6.00, 0.62, 1.70, 0.98), (5.30, 0.60, 1.90, 1.12), (4.75, 0.60, 2.36, 1.20)],
                "post": (5.62, 1.76)},
    "blunt": {"sections": [(6.70, 1.08, 1.40, 0.12), (6.45, 0.86, 1.78, 0.55), (5.85, 0.70, 2.18, 0.95),
                           (5.05, 0.62, 2.56, 1.15)],
              "post": (6.42, 1.80)},
}
NOSE = "pointed"
WINDSCREEN_Z = 1.74
SECTIONS = NOSES[NOSE]["sections"] + [
    (4.25, 0.60, 2.76, 1.22),
    (3.00, 0.58, 2.80, 1.25),
    (-1.10, 0.58, 2.80, 1.25),
    (-2.05, 0.76, 2.76, 1.14),
    (-3.05, 1.25, 2.66, 0.78),
    (-4.10, 1.80, 2.56, 0.44),
    (-8.10, 2.16, 2.64, 0.28),
    (-8.90, 2.26, 2.70, 0.25),
]
# Engine cowling over the cabin roof: (x, height above the roof, half width)
COWL = [(3.30, 0.04, 0.40), (2.60, 0.50, 0.70), (1.20, 0.68, 0.80), (-1.30, 0.66, 0.80),
        (-2.30, 0.40, 0.55), (-2.80, 0.10, 0.35)]
CABIN_END = -2.05     # sections behind this take the "boom" paint
WINDSCREEN = (4.25, SECTIONS[1][0])
ROOF = 2.80
MAST_X, HUB_Z = 0.0, 4.25
ROTOR_R, TAIL_R = 7.3, 1.45
TAIL_HUB = Vector((-8.85, 0.42, 3.95))  # tail rotor on the left (port, +Y) of the fin


def materials():
    def emit(name, color, strength):
        m, _, bsdf = b._new_mat(name)
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        return m

    def one_sided(m):  # seen from its front only (glTF doubleSided false)
        m.use_backface_culling = True
        return m

    return {
        "navy": b.mat_flat("HeliNavy", NAVY, 0.35),
        "slate": b.mat_flat("HeliSlate", SLATE, 0.4),
        "sand": b.mat_flat("HeliSand", SAND, 0.4),
        "white": b.mat_flat("HeliWhite", WHITE, 0.35),
        "signal": b.mat_flat("HeliSignal", SIGNAL, 0.35),
        "blue": b.mat_flat("HeliBlue", DEEP_BLUE, 0.35),
        "glass": b.mat_flat("HeliGlass", (0.015, 0.02, 0.025), 0.08),
        "blade": b.mat_flat("HeliBlade", (0.06, 0.06, 0.065), 0.5),
        "metal": b.mat_flat("HeliMetal", (0.25, 0.25, 0.26), 0.45),
        "tyre": b.mat_flat("HeliTyre", (0.02, 0.02, 0.02), 0.8),
        "yellow": b.mat_flat("HeliYellow", (0.80, 0.55, 0.02), 0.5),   # blade tips
        "disc": disc_material(),
        # The cabin, for the view from inside
        "clear": clear_glass(),
        "cabin": b.mat_flat("HeliCabin", (0.62, 0.63, 0.63), 0.7),        # light grey wall and roof lining
        "lining": one_sided(b.mat_flat("HeliLining", (0.62, 0.63, 0.63), 0.7)),  # window corners, inside only
        "floor": b.mat_flat("HeliFloor", (0.06, 0.065, 0.07), 0.8),
        "seat": b.mat_flat("HeliSeat", (0.085, 0.09, 0.095), 0.85),     # charcoal seat fabric
        "panel": b.mat_flat("HeliPanel", (0.03, 0.03, 0.035), 0.6),        # instrument panel, consoles
        "suit": b.mat_flat("HeliSuit", (0.05, 0.06, 0.08), 0.8),           # pilots' flight suits
        "screen": emit("HeliScreen", (0.15, 0.45, 1.0), 1.5),              # cockpit displays: sky
        "ground": emit("HeliGround", (0.45, 0.22, 0.06), 1.5),             # and ground
        "mapscreen": emit("HeliMapScreen", (0.03, 0.12, 0.10), 2.0),       # dark map pages
        "cabinlamp": emit("HeliCabinLamp", (1.0, 0.93, 0.82), 0.0),        # ceiling strips, off by day
        "red": emit("HeliRed", (1.0, 0.04, 0.02), 0.0),                  # beacons, port light
        "green": emit("HeliGreen", (0.05, 1.0, 0.15), 0.0),              # starboard light
    }


def disc_material():
    """Blur disc for Cycles previews: faint grey, see-through. The web draws
    its own streak texture on it."""
    mat, nt, bsdf = b._new_mat("HeliDisc")
    bsdf.inputs["Base Color"].default_value = (0.08, 0.08, 0.09, 1)
    bsdf.inputs["Alpha"].default_value = 0.22
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def clear_glass():
    """See-through window glass, slightly tinted, for the cabin view."""
    mat, nt, bsdf = b._new_mat("HeliClear")
    bsdf.inputs["Base Color"].default_value = (0.20, 0.24, 0.26, 1)
    bsdf.inputs["Alpha"].default_value = 0.12
    bsdf.inputs["Roughness"].default_value = 0.05
    return mat


def set_night(m, on):
    for k, s in (("red", 40), ("green", 30), ("cabinlamp", 10)):
        m[k].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = s if on else 0.0


def _ring(x, zb, zt, hw):
    half = PROFILE[:-1] + [SHOULDER, PROFILE[-1]]
    pts = [Vector((x, u * hw, zb + v * (zt - zb))) for u, v in half]
    return pts + [Vector((p.x, -p.y, p.z)) for p in reversed(pts[1:-1])]


def _section_at(x):
    """(zb, zt, hw) of the fuselage at x, between the sections round it."""
    for (xa, *a), (xb, *b_) in zip(SECTIONS, SECTIONS[1:]):
        if xb <= x <= xa:
            k = (xa - x) / (xa - xb)
            return tuple(p + (q - p) * k for p, q in zip(a, b_))
    raise ValueError(x)


def _side_y(x, z, inset=0.0):
    """Half width of the skin at x and height z on the cabin side (or of
    the lining, inset like build_cabin_interior's)."""
    zb, zt, hw = _section_at(x)
    zb, zt, hw = zb + inset, zt - inset, hw - inset
    v = (z - zb) / (zt - zb)
    half = PROFILE[:-1] + [SHOULDER, PROFILE[-1]]
    for (ua, va), (ub, vb) in zip(half, half[1:]):
        if va <= v <= vb:
            return hw * (ua + (ub - ua) * (v - va) / (vb - va))
    return hw


def loft(g, rings, mat, caps=True):
    """Skin consecutive rings; mat(i, k) gives the material of the face
    between rings i and i+1 on segment k."""
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for k in range(n):
            vs = [rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]]
            g.add(mat(i, k), vs, [(3, 2, 1, 0)])
    if caps:
        g.add(mat(0, 0), rings[0], [tuple(range(n))])
        g.add(mat(len(rings) - 2, 0), rings[-1], [tuple(reversed(range(n)))])


def _band(k):
    """Paint band of ring segment k: 9 segments per side from the keel up,
    then back down the other side."""
    k = k if k < 9 else 17 - k
    return (0, 0, 1, 2, 3, 4, 5, 6, 7)[k]


def cut_quad(g, mat, a, c, d, e, holes, flip=False):
    """Loft face a-c (one ring, bottom to top or top to bottom), d-e (next
    ring) with rectangular holes, given as (x0, x1, z0, z1) in world x and z.
    Emits the frame around the holes as quads; holes outside the face are ignored."""
    def P(s, t):  # bilinear across the face: s along x (a->e), t across the band (a->c)
        lo, hi = a.lerp(e, s), c.lerp(d, s)
        return lo.lerp(hi, t)

    xa, xe = a.x, e.x
    cuts = []
    for x0, x1, z0, z1 in holes:
        s0, s1 = sorted(((x0 - xa) / (xe - xa), (x1 - xa) / (xe - xa)))
        if s1 <= 0 or s0 >= 1:
            continue
        t0, t1 = sorted(((z0 - a.z) / (c.z - a.z), (z1 - a.z) / (c.z - a.z)))
        if t1 <= 0 or t0 >= 1:
            continue
        cuts.append((max(s0, 0), min(s1, 1), max(t0, 0), min(t1, 1)))
    cuts.sort()
    pieces, s = [], 0.0
    for s0, s1, t0, t1 in cuts:
        if s0 > s:
            pieces.append((s, s0, 0, 1))
        pieces += [(s0, s1, 0, t0), (s0, s1, t1, 1)]
        s = s1
    if s < 1:
        pieces.append((s, 1, 0, 1))
    for s0, s1, t0, t1 in pieces:
        if s1 - s0 < 1e-4 or t1 - t0 < 1e-4:
            continue
        vs = [P(s1, t0), P(s1, t1), P(s0, t1), P(s0, t0)]
        g.add(mat, vs[::-1] if flip else vs, [(0, 1, 2, 3)])


def split_z(g, below, above, vs, z, flip=False):
    """Split polygon vs (in order) at height z: the part under it in below,
    the part over it in above (either may be None to leave it out)."""
    for mat, keep in ((below, lambda v: v.z <= z), (above, lambda v: v.z >= z)):
        if mat is None:
            continue
        out = []
        for i, p in enumerate(vs):
            q = vs[(i + 1) % len(vs)]
            if keep(p):
                out.append(p)
            if keep(p) != keep(q) and abs(q.z - p.z) > 1e-9:
                out.append(p.lerp(q, (z - p.z) / (q.z - p.z)))
        if len(out) >= 3:
            g.add(mat, out[::-1] if flip else out, [tuple(range(len(out)))])


def build_fuselage(g, m, liv, glazed=False):
    """glazed: real window openings in the skin (for the cabin view); else
    the windows are painted on."""
    rings = [_ring(*sec) for sec in SECTIONS]

    pointed = NOSE == "pointed"

    def screen(i, k):  # a face of the windscreen and the eyebrow panes
        x0, x1 = SECTIONS[i][0], SECTIONS[i + 1][0]
        return WINDSCREEN[0] <= x1 and x0 <= WINDSCREEN[1] + 0.01 and _band(k) >= 5

    def paint(i, k):
        if screen(i, k) and not pointed:
            return m["glass"]
        return m[(liv["boom"] if SECTIONS[i + 1][0] < CABIN_END - 0.01 else liv["cabin"])[_band(k)]]

    n = len(rings[0])
    for i in range(len(rings) - 1):
        for k in range(n):
            a, c = rings[i][k], rings[i][(k + 1) % n]
            d, e = rings[i + 1][(k + 1) % n], rings[i + 1][k]
            if pointed and screen(i, k):    # paint under the line, glass over it
                split_z(g, paint(i, k), m["glass"], [e, d, c, a], WINDSCREEN_Z)
            elif glazed:
                cut_quad(g, paint(i, k), a, c, d, e, _holes(_band(k)))
            else:
                g.add(paint(i, k), [a, c, d, e], [(3, 2, 1, 0)])
    g.add(m[liv["cabin"][4]], rings[0], [tuple(range(len(rings[0])))])               # nose cap
    g.add(m[liv["boom"][4]], rings[-1], [tuple(reversed(range(len(rings[-1]))))])    # boom end
    # Centre post and frame of the windscreen
    px, pz = NOSES[NOSE]["post"]
    pts = [(x, zt + 0.02) for x, _, zt, _ in reversed(SECTIONS) if WINDSCREEN[0] <= x < px] + [(px, pz)]
    for (xa, za), (xb, zb) in zip(pts, pts[1:]):   # along the roof line, section to section
        g.beam(m[liv["cabin"][5]], (xa, 0, za), (xb, 0, zb), 0.12)


def side_quad(g, mat, x0, x1, z0, z1, y):
    """Window or door panel flat on the side of the cabin, on both sides."""
    for s in (1, -1):
        vs = [Vector((x0, s * y, z0)), Vector((x1, s * y, z0)), Vector((x1, s * y, z1)), Vector((x0, s * y, z1))]
        g.add(mat, vs, [(0, 1, 2, 3) if s > 0 else (3, 2, 1, 0)])


# Side windows as (x0, x1, z0, z1): the crew door window, then four big
# square cabin windows (the last behind the sliding door). The skin and the
# lining get rectangular openings; WINDOW_SHAPE gives the glass its outline
# inside that box: "rounded", corners cut by WINDOW_CHAMFER (one cut each,
# an octagon) and the crew window's front edge leaning back by CREW_SLANT
# at the top, along the windscreen; or "square", the first look.
_ZW0, _ZW1 = 0.58 + 0.50 * 2.22 + 0.06, 0.58 + 0.88 * 2.22 - 0.07
CREW_WINDOW = (3.15, 4.10, _ZW0 - 0.15, _ZW1)
WINDOWS = ([CREW_WINDOW] + [(x - 0.46, x + 0.46, _ZW0, _ZW1) for x in (2.05, 0.80, -0.45)]
           + [(-1.55, -1.05, _ZW0 + 0.05, _ZW1)])
WINDOW_SHAPE = "rounded"
WINDOW_CHAMFER = 0.14
CREW_SLANT = 0.40
# The sliding cabin door on each side, (x0, x1, z0, z1): it carries the two
# middle windows and slides aft to open (the HeliDoorL/R parts, interior
# only). People step out at its front, at EXIT_X, onto the step and down.
DOOR = (-1.0, 1.30, 1.12, 0.58 + 0.88 * 2.22 - 0.005)
DOOR_SLIDE = (0.42, 2.40)   # out, then aft (m), fully open
EXIT_X = 0.95
_in_door = lambda w: DOOR[0] <= w[0] and w[1] <= DOOR[1]


def _cut(w, d=0.005):
    """Window w's opening grown by d: the skin's a little bigger and the
    lining's a little smaller than the reveal, so no cut edge lies flush
    on it (an edge-on face flickers there)."""
    return (w[0] - d, w[1] + d, w[2] - d, w[3] + d)


def _holes(band, door=True, d=0.005):
    """Openings in a skin face of this paint band: the windows, and with
    door the door opening in place of the windows it carries."""
    wins = [_cut(w, d) for w in WINDOWS] if band in (4, 5) else []
    return [w for w in wins if not _in_door(w)] + [DOOR] if door else wins


def _reveal(g, mat, w, s, outer, inner):
    """Walls round opening w on side s, from outer(x, z) to inner(x, z)
    (half widths), facing into the opening."""
    x0, x1, z0, z1 = w
    for a, c in (((x0, z0), (x1, z0)), ((x1, z0), (x1, z1)), ((x1, z1), (x0, z1)), ((x0, z1), (x0, z0))):
        vs = [Vector((a[0], s * outer(*a), a[1])), Vector((c[0], s * outer(*c), c[1])),
              Vector((c[0], s * inner(*c), c[1])), Vector((a[0], s * inner(*a), a[1]))]
        g.add(mat, vs if s > 0 else vs[::-1], [(0, 1, 2, 3)])


def build_door(g, m, liv, side):
    """The sliding door for side +1 (left, +Y) or -1: the skin over the
    opening in its paint, the lining inside, its two windows."""
    x0, x1, z0, z1 = DOOR
    half = PROFILE[:-1] + [SHOULDER, PROFILE[-1]]
    zb, zt, hw = _section_at(0.0)
    for k in range(len(half) - 1):
        (ua, va), (ub, vb) = half[k], half[k + 1]
        za, zb_ = zb + va * (zt - zb), zb + vb * (zt - zb)
        if zb_ <= z0 or za >= z1:
            continue
        def at(z):  # y on this segment at height z
            return hw * (ua + (ub - ua) * (z - za) / (zb_ - za))
        lo, hi = max(za, z0), min(zb_, z1)
        band = _band(k)
        paint = m[liv["cabin"][band]]
        for off, mat, flip, grow in ((0.012, paint, True, 0.005), (-0.07, m["cabin"], False, -0.005)):
            wins = [_cut(w, grow) for w in WINDOWS if _in_door(w)] if band in (4, 5) else []
            a, c = Vector((x0, side * (at(lo) + off), lo)), Vector((x0, side * (at(hi) + off), hi))
            d, e = Vector((x1, side * (at(hi) + off), hi)), Vector((x1, side * (at(lo) + off), lo))
            cut_quad(g, mat, a, c, d, e, wins, flip=(flip if side > 0 else not flip))
    # Edges round the panel, and the glass and frames of its windows
    t0, t1 = side * 1.192, side * 1.262
    for xa, xb in ((x0, x0), (x1, x1)):
        g.add(m["cabin"], [Vector((xa, t0, z0)), Vector((xa, t1, z0)), Vector((xb, t1, z1)), Vector((xb, t0, z1))],
              [(0, 1, 2, 3), (3, 2, 1, 0)])
    g.add(m["cabin"], [Vector((x0, t0, z0)), Vector((x1, t0, z0)), Vector((x1, t1, z0)), Vector((x0, t1, z0))],
          [(0, 1, 2, 3), (3, 2, 1, 0)])
    for w in (w for w in WINDOWS if _in_door(w)):   # reveals through the panel
        _reveal(g, m["cabin"], w, side, lambda x, z: _side_y(x, z) + 0.02, lambda x, z: _side_y(x, z) - 0.075)
    for wx0, wx1, wz0, wz1 in (w for w in WINDOWS if _in_door(w)):
        _window(g, m, liv, wx0, wx1, wz0, wz1, side * 1.265, side, holes=True)


def _outline(w):
    """The glass outline of window w as (x, z) points, anticlockwise seen
    from +Y, inside its box."""
    x0, x1, z0, z1 = w
    if WINDOW_SHAPE == "square":
        return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    top = x1 - CREW_SLANT if w == CREW_WINDOW else x1
    corners = [(x0, z0), (x1, z0), (top, z1), (x0, z1)]
    pts = []
    for i, p in enumerate(corners):   # cut each corner, WINDOW_CHAMFER along both edges
        for q in (corners[i - 1], corners[(i + 1) % 4]):
            d = Vector(q) - Vector(p)
            c = min(WINDOW_CHAMFER, d.length / 3)
            pts.append(tuple(Vector(p) + d.normalized() * c))
    return pts


def _offset(pts, f):
    """Convex polygon pts grown outward by f (each edge moved out, the
    corners where the moved edges meet)."""
    n, lines = len(pts), []
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        nrm = Vector((b.y - a.y, a.x - b.x)).normalized()    # outward for anticlockwise
        lines.append((a + nrm * f, b - a))
    out = []
    for i in range(n):
        (p, u), (q, v) = lines[i - 1], lines[i]
        cross = u.x * v.y - u.y * v.x
        t = ((q - p).x * v.y - (q - p).y * v.x) / cross
        out.append(tuple(p + u * t))
    return out


def _outside(box, pts):
    """The pieces of rectangle box outside convex polygon pts, one per edge
    (empty pieces left out), as point lists."""
    x0, x1, z0, z1 = box
    rect = [Vector(v) for v in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
    pieces = []
    for i in range(len(pts)):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % len(pts)])
        nrm = Vector((b.y - a.y, a.x - b.x)).normalized()
        out = []
        for j, p in enumerate(rect):   # keep the side past this edge
            q = rect[(j + 1) % 4]
            dp, dq = (p - a).dot(nrm), (q - a).dot(nrm)
            if dp >= 0:
                out.append(p)
            if (dp >= 0) != (dq >= 0):
                out.append(p.lerp(q, dp / (dp - dq)))
        area = sum(out[k].x * out[k - 1].y - out[k - 1].x * out[k].y for k in range(len(out))) / 2
        if len(out) >= 3 and abs(area) > 1e-5:
            pieces.append(out)
    return pieces


def _flat(g, mat, pts, y, s, inward=False):
    """Polygon pts (x, z) flat at y on side s (+1 or -1), facing out (or in);
    pts anticlockwise in (x, z) face -Y as given."""
    vs = [Vector((x, y, z)) for x, z in pts]
    g.add(mat, vs[::-1] if (s > 0) != inward else vs, [tuple(range(len(vs)))])


def _window(g, m, liv, x0, x1, z0, z1, y, side=None, holes=False):
    """Glass and, if the livery has one, a frame; on one side or both.
    holes: the skin has the window's rectangular opening, so fill what the
    outline leaves of it, in paint outside and lining inside."""
    w, y = (x0, x1, z0, z1), abs(y)
    glass = _outline(w)
    f = 0.07 if liv.get("frame") else 0.0
    rim = _offset(glass, f) if f else glass
    for s in ((1, -1) if side is None else (side,)):
        _flat(g, m["glass"], glass, s * (y + 0.01), s)
        if f:  # a ring, so the window stays clear from inside
            n = len(glass)
            for i in range(n):
                _flat(g, m[liv["frame"]], [glass[i], rim[i], rim[(i + 1) % n], glass[(i + 1) % n]],
                      s * (y + 0.005), s)
        if holes:
            for piece in _outside(_cut(w), rim):
                _flat(g, m[liv["cabin"][5]], piece, s * (y + 0.003), s)
            for piece in _outside(_cut(w), glass):   # under the paint, close behind the glass
                _flat(g, m["lining"], piece, s * (y + 0.001), s, inward=True)


def one_quad(g, mat, x0, x1, z0, z1, y, s):
    vs = [Vector((x0, y, z0)), Vector((x1, y, z0)), Vector((x1, y, z1)), Vector((x0, y, z1))]
    g.add(mat, vs, [(0, 1, 2, 3) if s > 0 else (3, 2, 1, 0)])


def build_cabin_details(g, m, liv, door=False):
    """door: the sliding doors are separate parts (build_door), so leave
    their windows and seams off the body."""
    y = 1.255
    zw1 = _ZW1
    for w in WINDOWS:
        if not (door and _in_door(w)):
            _window(g, m, liv, *w, y, holes=door)
    # Sliding door seam and crew door seam: thin dark lines
    for x in (() if door else (1.30, -1.0)):
        side_quad(g, m["metal"], x, x + 0.05, DOOR[2], zw1 + 0.10, y + 0.012)
    side_quad(g, m["metal"], 2.98, 3.02, 0.80, zw1 + 0.10, y + 0.012)
    # Sponsons with the main gear under the door sill, and a step
    sp = m[liv["sponson"]]
    for s in (1, -1):
        g.box(sp, (-1.0, s * 1.40, 0.785), (2.0, 0.40, 0.67))   # under the door's rear half and aft, as on the real one
        g.box(m["metal"], (0.95, s * 1.45, 0.47), (0.60, 0.30, 0.06))   # step, half way down to the deck
        g.box(m["metal"], (2.6, s * 1.30, 0.62), (0.5, 0.18, 0.05))
    # Engine cowling: a low hump over the cabin roof with two exhausts aft
    cw = m[liv["cowl"]]
    rings = [_ring(x, ROOF - 0.05, ROOF + h, hw) for x, h, hw in COWL]
    loft(g, rings, lambda i, k: cw)
    g.box(m["metal"], (0.0, 0, ROOF + 0.72), (1.3, 0.9, 0.16))           # gearbox fairing
    for s in (1, -1):
        g.tube(m["metal"], (-1.9, s * 0.55, ROOF + 0.40), (-2.35, s * 0.85, ROOF + 0.48), 0.20, 8)
        g.box(m["panel"], (1.6, s * 0.79, ROOF + 0.36), (0.9, 0.02, 0.22))  # intake grilles


def build_tail(g, m, liv):
    fin = m[liv["fin"]]
    # Swept fin rising from the end of the boom, a slab of two quads per side
    x0, x1, z0, z1 = -7.75, -9.05, 2.55, 2.70
    top = (-9.55, 4.95, -10.05, 5.00)
    t = 0.13
    vs = [Vector(v) for v in ((x0, -t, z0), (x1, -t, z1), (top[2], -t * 0.7, top[3]), (top[0], -t * 0.7, top[1]),
                              (x0, t, z0), (x1, t, z1), (top[2], t * 0.7, top[3]), (top[0], t * 0.7, top[1]))]
    g.add(fin, vs, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 3, 7, 4), (3, 2, 6, 7), (2, 1, 5, 6)])
    # Horizontal stabiliser across the boom ahead of the fin, with end plates
    g.box(fin, (-7.2, 0, 2.55), (0.85, 3.4, 0.08))
    for s in (1, -1):
        g.box(fin, (-7.25, s * 1.70, 2.65), (0.75, 0.05, 0.55))
    # Tail skid and beacon on the fin
    g.beam(m["metal"], (-8.2, 0, 2.20), (-8.7, 0, 1.70), 0.08)
    g.prism(m["red"], (-9.85, 0), 0.07, 5.00, 5.10, 6)


def build_tail_rotor(g, m, liv, hub=Vector((0, 0, 0))):
    """Four blades on the left of the fin, around hub; turns about Y."""
    g.tube(m["metal"], hub + Vector((0, -0.30, 0)), hub, 0.12, 8)
    for i in range(4):
        a = math.radians(20 + 90 * i)
        d = Vector((math.cos(a), 0, math.sin(a)))
        if "tail_rotor" in liv:     # striped blades: three bands, tip in the second colour
            c0, c1 = (m[k] for k in liv["tail_rotor"])
            for j, (r0, r1) in enumerate(((0.15, 0.6), (0.6, 0.9), (0.9, 1.15), (1.15, TAIL_R))):
                g.beam(c1 if j % 2 else c0, hub + d * r0, hub + d * r1, 0.20, 0.04)
        else:
            g.beam(m["blade"], hub + d * 0.15, hub + d * (TAIL_R - 0.2), 0.20, 0.04)
            g.beam(m["yellow"], hub + d * (TAIL_R - 0.2), hub + d * TAIL_R, 0.20, 0.04)


def build_mast(g, m):
    g.tube(m["metal"], (MAST_X, 0, ROOF + 0.75), (MAST_X, 0, HUB_Z), 0.16, 8)


def build_rotor(g, m, droop=0.30, phase=math.radians(18)):
    """Hub and five blades around the origin (the hub); turns about Z."""
    g.prism(m["metal"], (0, 0), 0.55, -0.12, 0.10, 5, phase)
    g.prism(m["metal"], (0, 0), 0.22, 0.10, 0.32, 6)
    for i in range(5):
        a = phase + 2 * math.pi * i / 5
        d = Vector((math.cos(a), math.sin(a), 0))
        root = d * 0.55
        tip = d * ROTOR_R + Vector((0, 0, -droop))
        knee = root.lerp(tip, 0.94)
        # Blades at rest droop toward the tip; flat boards with a yellow tip
        g.beam(m["blade"], root, knee, 0.58, 0.07)
        g.beam(m["yellow"], knee, tip, 0.58, 0.07)


def build_disc(g, mat, r, n=24, cone=0.0, axis="z"):
    """Flat ring the blades sweep when they spin fast: a stand-in for motion
    blur, drawn with a radial streak texture (planar UVs from -r..r to 0..1).
    Hidden while the rotor turns slowly."""
    r0 = 0.5
    vs, uvs = [], []
    for rr, dz in ((r0, 0.0), (r, cone)):
        for i in range(n):
            t = 2 * math.pi * i / n
            u, v = rr * math.cos(t), rr * math.sin(t)
            vs.append(Vector((u, v, dz)) if axis == "z" else Vector((u, dz, v)))
            uvs.append((0.5 + u / (2 * r), 0.5 + v / (2 * r)))
    fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    if axis != "z":
        fs = [tuple(reversed(f)) for f in fs]
    g.add(mat, vs, fs)
    g.uvs = getattr(g, "uvs", {})
    g.uvs.setdefault(mat, []).extend(uvs)


# Cabin: floor height, four rows of four seats facing each other in pairs as
# in the real cabin (row 1 backs onto the cockpit, rows 2 and 3 sit back to
# back, row 4 backs onto the rear wall), the cockpit
FLOOR = 1.0
SEAT_ROWS = (2.10, 0.95, 0.20, -0.95)  # row 2 and 4 by a window
SEAT_FACE = (-1, 1, -1, 1)               # +1 faces forward (+X), -1 aft
SEAT_Y = (-0.86, -0.30, 0.30, 0.86)
PILOT_X, PILOT_Y = 3.75, 0.55
# Where a passenger's eyes are: the right-hand (starboard) window seat, second row, facing forward
EYE_SEAT = Vector((SEAT_ROWS[1] - 0.10, SEAT_Y[0] + 0.10, FLOOR + 1.17))
# and the jump seat behind the pilots
EYE_JUMP = Vector((2.85, 0.0, FLOOR + 1.32))


def seat(g, m, x, y, w=0.48, face=1):
    """Crash seat facing +X (face 1) or -X (face -1): pan, back, headrest, legs."""
    z = FLOOR + 0.45
    g.box(m["seat"], (x, y, z), (0.48, w, 0.10))
    back0, back1 = Vector((x - face * 0.24, y, z + 0.03)), Vector((x - face * 0.31, y, z + 0.62))
    # Back: a slab the seat's width across, leaning back; built corner by
    # corner, since a beam's section turns arbitrarily on a near-vertical axis
    up = (back1 - back0).normalized()
    t = Vector((-up.z, 0, up.x)) * 0.04          # half the thickness, in the x-z plane (axes as op.Mesh.beam's)
    vs = [p + dt + Vector((0, dy, 0)) for p in (back0, back1) for dy in (-w / 2, w / 2) for dt in (-t, t)]
    g.add(m["seat"], vs, op.BOX_FACES)
    g.box(m["seat"], (x - face * 0.32, y, z + 0.74), (0.10, w * 0.6, 0.20))   # headrest
    for dy in (-w / 2 + 0.05, w / 2 - 0.05):
        g.beam(m["metal"], (x + face * 0.15, y + dy, FLOOR), (x + face * 0.10, y + dy, z - 0.05), 0.04)
        g.beam(m["metal"], (x - face * 0.20, y + dy, FLOOR), (x - face * 0.20, y + dy, z - 0.05), 0.04)


def ball(g, mat, c, r, n=8, rings=5):
    """Low-poly sphere: n segments around, rings bands from pole to pole."""
    c = Vector(c)
    vs = [c + Vector((0, 0, -r))]
    for j in range(1, rings):
        ph = math.pi * j / rings - math.pi / 2
        vs += [c + Vector((r * math.cos(ph) * math.cos(2 * math.pi * i / n),
                           r * math.cos(ph) * math.sin(2 * math.pi * i / n), r * math.sin(ph))) for i in range(n)]
    vs.append(c + Vector((0, 0, r)))
    top = len(vs) - 1
    fs = [(0, 1 + (i + 1) % n, 1 + i) for i in range(n)]
    for j in range(rings - 2):
        o = 1 + j * n
        fs += [(o + i, o + (i + 1) % n, o + n + (i + 1) % n, o + n + i) for i in range(n)]
    o = 1 + (rings - 2) * n
    fs += [(o + i, o + (i + 1) % n, top) for i in range(n)]
    g.add(mat, vs, fs)


def pilot(g, m, x, y):
    """A seated pilot in a dark flight suit and white helmet, hands forward."""
    g.box(m["suit"], (x - 0.05, y, FLOOR + 0.85), (0.30, 0.44, 0.62))          # torso
    g.prism(m["suit"], (x - 0.03, y), 0.06, FLOOR + 1.14, FLOOR + 1.24, 6)     # neck
    ball(g, m["white"], (x - 0.03, y, FLOOR + 1.36), 0.16)                     # helmet
    g.box(m["panel"], (x + 0.115, y, FLOOR + 1.33), (0.04, 0.22, 0.08))        # visor
    for dy in (-0.12, 0.12):
        g.beam(m["suit"], (x + 0.05, y + dy, FLOOR + 0.52), (x + 0.50, y + dy, FLOOR + 0.58), 0.15)  # thighs
        g.beam(m["suit"], (x + 0.50, y + dy, FLOOR + 0.58), (x + 0.62, y + dy, FLOOR + 0.08), 0.13)  # shins
        g.beam(m["suit"], (x + 0.0, y + dy * 2, FLOOR + 1.05), (x + 0.42, y + dy * 1.2, FLOOR + 0.80), 0.10)  # arms


def build_cabin_interior(g, m, pilots=True):
    """Lining, floor, seats and cockpit for the view from inside. The skin
    must be built glazed, with real window openings."""
    # Lining: the fuselage sections inset a little, faces turned inward, with the same window openings
    secs = [sec for sec in SECTIONS if CABIN_END - 0.01 <= sec[0] <= WINDSCREEN[1]]
    rings = [_ring(x, zb + 0.05, zt - 0.05, hw - 0.05) for x, zb, zt, hw in secs]
    n = len(rings[0])
    for i in range(len(rings) - 1):
        x0, x1 = secs[i][0], secs[i + 1][0]
        for k in range(n):
            band = _band(k)
            a, c = rings[i][k], rings[i][(k + 1) % n]
            d, e = rings[i + 1][(k + 1) % n], rings[i + 1][k]
            if band == 0:
                continue    # under the floor
            if WINDSCREEN[0] <= x1 and band >= 5:   # windscreen (as build_fuselage paints it)
                if NOSE == "pointed":
                    split_z(g, m["cabin"], None, [e, d, c, a], WINDSCREEN_Z, flip=True)
                continue
            cut_quad(g, m["cabin"], a, c, d, e, _holes(band, d=-0.005), flip=True)
    g.add(m["cabin"], rings[-1], [tuple(range(n))])                       # rear bulkhead
    # Window reveals: close the gap between the skin and the lining round each opening
    for w in [w for w in WINDOWS if not _in_door(w)] + [DOOR]:
        for sy in (1, -1):
            _reveal(g, m["cabin"], w, sy, lambda x, z: _side_y(x, z) + 0.01, lambda x, z: _side_y(x, z, 0.05) - 0.005)
    g.span(m["floor"], CABIN_END, 4.9, -1.15, 1.15, FLOOR - 0.06, FLOOR)
    # Ceiling light strips and the overhead air and oxygen panels
    for y in (-0.45, 0.45):
        g.box(m["cabinlamp"], (0.6, y, ROOF - 0.08), (4.2, 0.10, 0.02))
        g.box(m["panel"], (0.6, y * 1.5, ROOF - 0.10), (4.2, 0.16, 0.04))
    for x, face in zip(SEAT_ROWS, SEAT_FACE):
        for y in SEAT_Y:
            seat(g, m, x, y, face=face)
    # Cockpit: instrument panel with four displays, glareshield, centre console, overhead panel
    g.box(m["panel"], (4.70, 0, FLOOR + 0.75), (0.30, 2.0, 0.70))
    g.box(m["panel"], (4.62, 0, FLOOR + 1.13), (0.50, 2.05, 0.07))
    for y in (-0.78, -0.30, 0.30, 0.78):
        if abs(y) > 0.5:  # flight displays: sky over ground, a horizon line
            g.box(m["screen"], (4.545, y, FLOOR + 0.87), (0.01, 0.36, 0.16))
            g.box(m["ground"], (4.545, y, FLOOR + 0.72), (0.01, 0.36, 0.14))
        else:             # map and systems pages
            g.box(m["mapscreen"], (4.545, y, FLOOR + 0.80), (0.01, 0.36, 0.30))
    g.box(m["panel"], (4.10, 0, FLOOR + 0.30), (0.95, 0.34, 0.60))
    g.box(m["screen"], (4.10, 0, FLOOR + 0.605), (0.40, 0.22, 0.01))
    g.box(m["panel"], (3.85, 0, ROOF - 0.12), (0.75, 0.45, 0.10))
    for y in (-PILOT_Y, PILOT_Y):
        seat(g, m, PILOT_X, y, 0.52)
        if pilots:
            pilot(g, m, PILOT_X + 0.05, y)
    # Fold-down jump seat behind the pilots
    g.box(m["seat"], (3.05, 0, FLOOR + 0.48), (0.40, 0.42, 0.08))


# Landing gear legs: (part, pivot, wheel centre below it, wheels as (dy, radius, width)).
# Retracting swings each leg forward about Y, nose wheels into the nose,
# main wheels into the sponsons.
GEAR = [("NoseGear", Vector((4.55, 0, 1.15)), 0.30, ((0.17, 0.30, 0.22), (-0.17, 0.30, 0.22))),
        ("MainGearL", Vector((-0.90, 1.43, 0.80)), 0.34, ((0.0, 0.34, 0.26),)),
        ("MainGearR", Vector((-0.90, -1.43, 0.80)), 0.34, ((0.0, 0.34, 0.26),))]
GEAR_SWING = math.radians(-90)  # gear up: legs point forward


def build_leg(g, m, pivot, wheel_z, wheels):
    """One gear leg around its pivot (the origin), pointing down."""
    drop = wheel_z - pivot.z
    side = 0.0 if pivot.y == 0 else -math.copysign(0.17, pivot.y)  # strut inboard of a main wheel
    g.beam(m["metal"], (0, side, 0.05), (0, side, drop), 0.12)
    for dy, r, w in wheels:
        g.tube(m["tyre"], (0, dy - w / 2, drop), (0, dy + w / 2, drop), r, 10)


def build_lights(g, m):
    g.prism(m["red"], (-1.8, 0), 0.08, ROOF + 0.55, ROOF + 0.67, 6)       # beacon on the cowling
    g.prism(m["red"], (0.6, 0), 0.08, 0.50, 0.58, 6)                      # belly beacon
    g.box(m["red"], (-0.2, 1.61, 1.05), (0.12, 0.04, 0.08))              # port (left): red
    g.box(m["green"], (-0.2, -1.61, 1.05), (0.12, 0.04, 0.08))           # starboard: green


def _part_object(name, g, pivot, parent, collection):
    """One object per moving part, all its materials as slots. The geometry
    is built around the origin and the object sits at its pivot."""
    me = bpy.data.meshes.new(name)
    vs, fs, mats = [], [], []
    for mat, (pv, pf) in g.parts.items():
        o = len(vs)
        vs += [Vector(v) for v in pv]
        fs += [tuple(i + o for i in f) for f in pf]
        mats += [len(me.materials)] * len(pf)
        me.materials.append(mat)
    me.from_pydata([tuple(v) for v in vs], [], fs)
    for poly, mi in zip(me.polygons, mats):
        poly.material_index = mi
    if getattr(g, "uvs", None):
        layer = me.uv_layers.new(name="UVMap")
        flat = [(0.5, 0.5)] * len(vs)
        o = 0
        for mat, (pv, pf) in g.parts.items():
            for i, t in enumerate(g.uvs.get(mat, [])):
                flat[o + i] = t
            o += len(pv)
        for loop in me.loops:
            layer.data[loop.index].uv = flat[loop.vertex_index]
    me.validate()
    ob = bpy.data.objects.new(name, me)
    ob.location = pivot
    ob.parent = parent
    collection.objects.link(ob)
    return ob


def build_helicopter(m, collection=None, loc=(0, 0, 0), yaw=0.0, livery=None, droop=0.30, discs=True,
                     interior=False, pilots=True):
    """Build one helicopter into collection as a root empty with its moving
    parts as children; returns (root, parts, triangles). loc is the ground
    point under the mast, yaw turns the nose from +X. Parts: Body,
    MainRotor (turns about local Z), TailRotor (about local Y), MainDisc and
    TailDisc (blur discs, hidden), NoseGear, MainGearL, MainGearR (swing
    about local Y; see pose()). interior: open windows, clear glass, and the
    cabin and cockpit inside, for the view from a seat, plus the sliding
    doors DoorL and DoorR (see pose())."""
    collection = collection or bpy.context.collection
    liv = LIVERIES[livery or LIVERY]
    root = bpy.data.objects.new("Helicopter", None)
    root.location, root.rotation_euler = loc, (0, 0, yaw)
    collection.objects.link(root)
    meshes = {}

    def part(name):
        return meshes.setdefault(name, op.Mesh())

    if interior:
        m = dict(m, glass=m["clear"])
    body = part("Body")
    build_fuselage(body, m, liv, glazed=interior)
    if interior:
        build_cabin_interior(body, m, pilots)
    build_cabin_details(body, m, liv, door=interior)
    if interior:
        build_door(part("DoorL"), m, liv, 1)
        build_door(part("DoorR"), m, liv, -1)
    build_tail(body, m, liv)
    build_mast(body, m)
    build_lights(body, m)
    build_rotor(part("MainRotor"), m, droop)
    build_tail_rotor(part("TailRotor"), m, liv)
    pivots = {"Body": Vector(), "MainRotor": Vector((MAST_X, 0, HUB_Z)), "TailRotor": TAIL_HUB,
              "DoorL": Vector(), "DoorR": Vector()}
    for name, pivot, wz, wheels in GEAR:
        build_leg(part(name), m, pivot, wz, wheels)
        pivots[name] = pivot
    if discs:
        build_disc(part("MainDisc"), m["disc"], ROTOR_R)
        build_disc(part("TailDisc"), m["disc"], TAIL_R, 12, axis="y")
        pivots["MainDisc"], pivots["TailDisc"] = pivots["MainRotor"], TAIL_HUB + Vector((0, 0.02, 0))
    parts = {name: _part_object("Heli" + name, g, pivots[name], root, collection) for name, g in meshes.items()}
    for name in ("MainDisc", "TailDisc"):
        if name in parts:
            parts[name].hide_render = True
    tris = sum(g.tris for name, g in meshes.items() if "Disc" not in name)
    return root, parts, tris


def pose(parts, gear=1.0, rotor=0.0, tail=None, door=0.0):
    """gear 1 = down, 0 = up; rotor and tail are blade angles in radians;
    door 0 = shut, 1 = slid open (out, then aft)."""
    for name, side in (("DoorL", 1), ("DoorR", -1)):
        if name in parts:
            out, aft = min(1, door * 4), max(0, door * 4 / 3 - 1 / 3)
            parts[name].location = (-DOOR_SLIDE[1] * aft, side * DOOR_SLIDE[0] * out, 0)
    for name, *_ in GEAR:
        parts[name].rotation_euler = (0, GEAR_SWING * (1 - gear), 0)
    parts["MainRotor"].rotation_euler = (0, 0, rotor)
    parts["TailRotor"].rotation_euler = (0, rotor * 5.0 if tail is None else tail, 0)


def export_glb(m, path, livery=None):
    """The default livery on its own, parts named for the browser to animate."""
    coll = bpy.data.collections.new("Export")
    bpy.context.scene.collection.children.link(coll)
    root, parts, _ = build_helicopter(m, coll, livery=livery)
    for o in parts.values():
        o.hide_render = False
    bpy.ops.object.select_all(action="DESELECT")
    for o in coll.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=False, export_yup=True)
    print("wrote", path, flush=True)
    bpy.data.collections.remove(coll)


# Where it parks: on the H of the platform's helideck, nose toward the quarters
DECK_LOC = (op.HELI_X - 0.8, 0.0, op.HELI_Z + 0.04)
DECK_YAW = math.pi


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--res", type=int, default=1280)
    p.add_argument("--out", default=os.path.join(b.BUILD, "helicopter"))
    p.add_argument("--device", default="auto")
    p.add_argument("--only", default="", help="comma list of shots to render")
    p.add_argument("--glb", action="store_true", help="also export the default livery to helicopter.glb")
    args = p.parse_args()
    os.makedirs(args.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = b.pick_device(args.device)
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"

    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    scene.world = world
    sun_d = bpy.data.lights.new("Sun", "SUN")
    sun_d.angle = math.radians(2)
    sun = bpy.data.objects.new("Sun", sun_d)
    sun.rotation_euler = (math.radians(45), 0, math.radians(-40))
    scene.collection.objects.link(sun)

    def cam(name, loc, aim, lens):
        d = bpy.data.cameras.new(name)
        d.lens, d.clip_end = lens, 5000
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)
        return o

    colls = {}

    def show(coll):
        for c in colls.values():
            c.hide_render = c is not coll

    def shot(c, name, w, h):
        if args.only and name not in args.only.split(","):
            return
        scene.camera = c
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.render.filepath = os.path.join(args.out, name + ".jpg")
        scene.render.image_settings.file_format = "JPEG"
        bpy.ops.render.render(write_still=True)
        print("wrote", scene.render.filepath, flush=True)

    m = materials()
    if args.glb:  # first, so the part names carry no .001 suffixes
        export_glb(m, os.path.join(args.out, "helicopter.glb"))
    # Studio: all liveries in a row, and each one alone
    floor_m = b.mat_flat("Floor", (0.35, 0.36, 0.37), 0.8)
    studio = colls["studio"] = bpy.data.collections.new("Studio")
    scene.collection.children.link(studio)
    g = op.Mesh()
    g.span(floor_m, -60, 60, -60, 60, -0.1, 0)
    g.objects("Floor", studio)
    names = list(LIVERIES)
    studio_parts = {}
    for i, name in enumerate(names):
        c = colls[name] = bpy.data.collections.new("Studio_" + name)
        scene.collection.children.link(c)
        _, parts, tris = build_helicopter(m, c, (0, 0, 0), 0.0, name)
        studio_parts[name] = parts
        g = op.Mesh()
        g.span(floor_m, -60, 60, -60, 60, -0.1, 0)
        g.objects("Floor_" + name, c)
        print(f"helicopter ({name}): {tris} triangles", flush=True)
    line = colls["lineup"] = bpy.data.collections.new("Lineup")
    scene.collection.children.link(line)
    for i, name in enumerate(names):
        build_helicopter(m, line, ((i - 1.5) * 16.0, (i - 1.5) * -2.0, 0), math.radians(-25), name)
    g = op.Mesh()
    g.span(floor_m, -80, 80, -60, 60, -0.1, 0)
    g.objects("Floor_lineup", line)

    w = args.res
    bg.inputs["Color"].default_value = (0.72, 0.78, 0.86, 1)
    bg.inputs["Strength"].default_value = 1.0
    sun_d.energy = 3.0
    set_night(m, False)
    show(line)
    shot(cam("Lineup", (6, -58, 17), (0, 0, 2.0), 35), "lineup", w, w * 9 // 16)
    for name in names:
        show(colls[name])
        shot(cam("Q_" + name, (13, -15, 5.5), (0, 0, 2.2), 35), "quarter-" + name, w, w * 9 // 16)
    show(colls[LIVERY])
    shot(cam("Side", (-1.5, -40, 2.6), (-1.5, 0, 2.6), 50), "side", w, w * 9 // 16)
    shot(cam("Rear", (-18, 12, 7), (-2, 0, 2.5), 35), "rear", w, w * 9 // 16)
    shot(cam("Top", (0, 0, 40), (0, 0.01, 0), 35), "top", w, w * 9 // 16)
    # Gear up, and the rotors spinning at flight speed with real motion blur
    # (the reference look for the web's blur discs)
    hp = studio_parts[LIVERY]
    pose(hp, gear=0.0)
    shot(cam("GearUp", (11, -13, 1.2), (0, 0, 1.6), 35), "gear-up", w, w * 9 // 16)
    pose(hp, gear=1.0)
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5           # 1/50 s at 25 fps
    scene.render.fps = 25
    rev = 2 * math.pi * 4.8 / 25                     # main rotor ~290 rpm, per frame
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for f in (0, 1, 2):
        pose(hp, rotor=(f - 1) * rev, tail=(f - 1) * rev * 5.4)
        for n in ("MainRotor", "TailRotor"):
            hp[n].keyframe_insert("rotation_euler", frame=f)
    for n in ("MainRotor", "TailRotor"):
        hp[n].cycles.motion_steps = 6                # follow the arc, not a straight smear
    scene.frame_set(1)
    shot(cam("Spin", (13, -15, 5.5), (0, 0, 2.2), 35), "spin-blur", w, w * 9 // 16)
    scene.render.use_motion_blur = False

    # On the helideck, seen from the platform's helideck CCTV camera, per livery
    pm = op.materials()
    for name in names:
        c = colls["deck-" + name] = bpy.data.collections.new("Deck_" + name)
        scene.collection.children.link(c)
        op.build_platform(pm, c)
        build_helicopter(m, c, DECK_LOC, DECK_YAW, name)
    sea_m = b.mat_flat("Sea", (0.01, 0.03, 0.04), 0.15)
    for name in names:
        g = op.Mesh()
        g.span(sea_m, -2000, 2000, -2000, 2000, -0.1, 0)
        g.objects("Sea_" + name, colls["deck-" + name])
    bg.inputs["Color"].default_value = (0.55, 0.65, 0.78, 1)
    for name in names:
        show(colls["deck-" + name])
        shot(cam("Deck_" + name, (44, -16, 86), (68, 2, 73), 20), "deck-" + name, w, w * 9 // 16)
    show(colls["deck-" + LIVERY])
    shot(cam("DeckWide", (150, -120, 95), (60, 0, 70), 50), "deck-wide", w, w * 9 // 16)
    # Night on the helideck camera: deck lights, beacons and nav lights
    bg.inputs["Color"].default_value = (0.01, 0.015, 0.03, 1)
    sun_d.energy = 0.04
    set_night(m, True)
    op.set_night(pm, True)
    shot(cam("DeckNight", (44, -16, 86), (68, 2, 73), 20), "deck-night", w, w * 9 // 16)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "helicopter.blend"))


if __name__ == "__main__":
    main()
