"""
Medium-detail platform supply vessel (PSV) for resupply runs to the
platform: bridge and accommodation forward, a long open cargo deck aft with
crash rails, deck cargo, a mast with turning radars and night lights.

Three hull designs are kept side by side in DESIGNS (the asset library):

    modern   ~88 x 19 m, conventional raked bow and flared forecastle
    xbow     ~89 x 19 m, inverted bow that rises into the superstructure
    classic  ~70 x 16 m, older vessel with a tall forecastle and twin funnels

DESIGN picks the one the scene uses, LIVERY its paint (LIVERIES). The hull
is a loft of stations through five lines (keel, bilge, waterline, fender
belt, deck edge) with flat faces, like the helicopter's fuselage.

    python blender/supply_vessel.py                  # preview stills
    python blender/supply_vessel.py --only lineup    # one shot
    python blender/supply_vessel.py --glb            # also export the default
    python blender/supply_vessel.py --web            # only write the game's files

--web writes the scene's vessel (DESIGN, LIVERY) for web/src/vessel.js:

    vessel.glb   the vessel in its own frame, parts named for the browser,
                 lamps and lit windows at their night strength
    vessel.json  its berth and the platform-to-room transform

to web/public/control/.

Everything is merged into one mesh per material and no textures are used.
Origin is the waterline amidships, +X points to the bow and +Z up. Renders go
to blender/build/supply_vessel/, and the .blend is saved next to them.
"""
import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import helicopter as heli  # noqa: E402
import offshore_platform as op  # noqa: E402

bpy, Vector = b.bpy, b.Vector
srgb = heli.srgb

# ------------------------------------------------------------------ designs

# Hull lines from the bottom up, each a list of (x, half breadth, z) from
# the transom (x = 0) to the stem. Stations are cut at every control point,
# so a line's shape is exactly its points joined by straight segments.
DESIGNS = {
    "modern": {
        "length": 88.5,
        "lines": [
            [(5, 5.5, -3.6), (14, 7.8, -6.4), (64, 7.8, -6.4), (76, 4.2, -6.4), (82, 1.2, -6.0), (84.5, 0, -5.0)],
            [(1.5, 8.3, -2.4), (14, 9.4, -5.5), (64, 9.4, -5.5), (76, 6.6, -5.2), (83, 2.4, -4.2), (86.2, 0, -2.6)],
            [(0, 9.2, 0.0), (12, 9.5, 0.0), (62, 9.5, 0.0), (74, 8.2, 0.0), (82, 4.2, 0.0), (87.2, 0, 0.0)],
            [(0, 9.6, 1.9), (56, 9.6, 1.9), (60, 9.6, 5.4), (74, 8.95, 5.6), (82, 5.6, 5.9), (88.2, 0, 6.2)],
            [(0, 9.5, 2.8), (56, 9.5, 2.8), (60, 9.5, 6.3), (74, 8.85, 6.5), (82, 5.5, 6.8), (88.5, 0, 7.1)],
        ],
        "cargo": (1.5, 56.0),          # cargo deck from the transom to the superstructure
        "deck_z": 2.8,
        # Superstructure tiers: (x aft, x fwd, half width, z0, z1, front rake)
        # with a negative rake leaning the front out (bridge windows)
        "tiers": [(57.0, 75.5, 9.3, 6.3, 9.1, 0.8), (59.0, 75.0, 8.6, 9.1, 11.9, 0.8),
                  (61.0, 74.0, 8.0, 11.9, 14.7, 0.6)],
        "bridge": (63.0, 74.6, 9.4, 14.7, 18.0, -0.7),
        "bulwark": (74.0, 1.3),        # forecastle bulwark from x, height
        "stacks": [(60.2, 5.2), (60.2, -5.2)],  # exhaust stacks behind the bridge (x, y)
        "stack_top": 19.6,
        "mast_x": 69.0,
    },
    "xbow": {
        "length": 89.2,
        "lines": [
            [(5, 5.5, -3.6), (14, 7.8, -6.4), (64, 7.8, -6.4), (78, 3.8, -6.4), (85, 0.8, -6.0), (87, 0, -5.0)],
            [(1.5, 8.3, -2.4), (14, 9.4, -5.5), (64, 9.4, -5.5), (78, 6.4, -5.2), (85.5, 2.2, -4.0), (88.4, 0, -2.4)],
            [(0, 9.2, 0.0), (12, 9.5, 0.0), (62, 9.5, 0.0), (76, 8.4, 0.0), (84, 4.6, 0.0), (89.2, 0, 0.8)],
            [(0, 9.6, 1.9), (56, 9.6, 1.9), (60, 9.6, 5.6), (76, 9.0, 6.4), (83, 5.0, 6.6), (88.0, 0, 6.4)],
            [(0, 9.5, 2.8), (56, 9.5, 2.8), (60, 9.5, 11.9), (72, 9.0, 12.0), (78, 6.2, 12.1), (82.5, 0, 12.2)],
        ],
        "cargo": (1.5, 56.0),
        "deck_z": 2.8,
        "tiers": [(57.0, 60.5, 9.3, 6.3, 11.9, 0.0), (59.5, 76.0, 8.9, 11.9, 14.7, 1.8)],
        "bridge": (62.0, 76.4, 9.4, 14.7, 18.0, 1.6),
        "bulwark": None,
        "stacks": [(60.8, 5.6), (60.8, -5.6)],
        "stack_top": 19.4,
        "mast_x": 68.5,
    },
    "classic": {
        "length": 70.8,
        "lines": [
            [(4, 4.5, -3.0), (11, 6.4, -5.6), (50, 6.4, -5.6), (60, 3.0, -5.6), (66, 0, -4.8)],
            [(1.2, 7.0, -2.0), (11, 7.9, -4.8), (50, 7.9, -4.8), (60, 5.0, -4.4), (67.5, 0, -2.4)],
            [(0, 7.8, 0.0), (10, 8.0, 0.0), (48, 8.0, 0.0), (60, 5.6, 0.0), (68.5, 0, 0.0)],
            [(0, 8.1, 1.6), (44, 8.1, 1.6), (47, 8.1, 4.5), (60, 7.25, 5.0), (70.5, 0, 6.6)],
            [(0, 8.0, 2.5), (44, 8.0, 2.5), (47, 8.0, 5.4), (60, 7.0, 5.9), (70.8, 0, 7.6)],
        ],
        "cargo": (1.2, 44.0),
        "deck_z": 2.5,
        "tiers": [(45.0, 58.0, 7.6, 5.4, 8.0, 0.4), (47.0, 57.0, 7.0, 8.0, 10.6, 0.4)],
        "bridge": (48.0, 57.6, 7.9, 10.6, 13.4, -0.6),
        "bulwark": (57.0, 1.1),
        "stacks": [(46.6, 3.6), (46.6, -3.6)],
        "stack_top": 16.0,
        "mast_x": 53.0,
    },
}
DESIGN = "modern"

# Paint: a colour key for each part of the vessel
LIVERIES = {
    # Red hull and white superstructure, the most common North Sea look
    "red": {"hull": "red", "super": "white", "rail": "yellow", "stack": "white", "stack_top": "black"},
    # Navy hull, white superstructure, grey rails, navy stack tops
    "navy": {"hull": "navy", "super": "white", "rail": "grey", "stack": "white", "stack_top": "navy"},
    # Mid blue hull, white superstructure, blue stacks
    "blue": {"hull": "blue", "super": "white", "rail": "yellow", "stack": "blue", "stack_top": "black"},
}
LIVERY = "red"


def materials():
    def emit(name, color, strength=0.0):
        m, _, bsdf = b._new_mat(name)
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        return m

    return {
        "red": b.mat_flat("PsvRed", srgb("#b0281f"), 0.45),
        "navy": b.mat_flat("PsvNavy", srgb("#14263f"), 0.45),
        "blue": b.mat_flat("PsvBlue", srgb("#1f5a9e"), 0.45),
        "white": b.mat_flat("PsvWhite", srgb("#e6e8e6"), 0.5),
        "bottom": b.mat_flat("PsvBottom", srgb("#4a1814"), 0.7),
        "black": b.mat_flat("PsvBlack", srgb("#1a1b1c"), 0.6),
        "deck": b.mat_flat("PsvDeck", srgb("#5b625c"), 0.85),
        "grey": b.mat_flat("PsvGrey", srgb("#8a9196"), 0.5),
        "yellow": b.mat_flat("PsvYellow", srgb("#d9a514"), 0.5),
        "orange": b.mat_flat("PsvOrange", srgb("#e0571b"), 0.5),       # rescue boat
        "glass": b.mat_flat("PsvGlass", (0.012, 0.016, 0.02), 0.08),
        "c_blue": b.mat_flat("PsvBoxBlue", srgb("#2d5c8a"), 0.6),     # containers
        "c_green": b.mat_flat("PsvBoxGreen", srgb("#3d6b45"), 0.6),
        "c_orange": b.mat_flat("PsvBoxOrange", srgb("#c4612a"), 0.6),
        "c_grey": b.mat_flat("PsvBoxGrey", srgb("#9a9d9a"), 0.6),
        "pipe": b.mat_flat("PsvPipe", srgb("#6b5a4a"), 0.5),
        "lit": emit("PsvLitWindow", srgb("#ffd9a0")),                   # cabin windows at night
        "flood": emit("PsvFlood", (1.0, 0.95, 0.85)),                    # deck floodlights
        "nav_red": emit("PsvNavRed", (1.0, 0.04, 0.02)),
        "nav_green": emit("PsvNavGreen", (0.05, 1.0, 0.15)),
        "nav_white": emit("PsvNavWhite", (1.0, 1.0, 0.95)),
    }


def set_night(m, on):
    for k, s in (("lit", 6), ("flood", 60), ("nav_red", 40), ("nav_green", 30), ("nav_white", 40)):
        m[k].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = s if on else 0.0


# --------------------------------------------------------------------- hull

def _at(line, x):
    """(half breadth, z) of a line at x, by straight segments."""
    if x <= line[0][0]:
        return line[0][1], line[0][2]
    for (x0, h0, z0), (x1, h1, z1) in zip(line, line[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0)
            return h0 + t * (h1 - h0), z0 + t * (z1 - z0)
    return line[-1][1], line[-1][2]


def _sample(line, t):
    x = line[0][0] + t * (line[-1][0] - line[0][0])
    h, z = _at(line, x)
    return Vector((x, h, z))


def _face(g, mat, pts):
    """Add one flat face, dropping repeated corners where the hull closes at
    the stem; nothing if fewer than three distinct corners remain."""
    out = []
    for p in pts:
        if not any((p - q).length < 1e-4 for q in out):
            out.append(p)
    if len(out) >= 3:
        g.add(mat, out, [tuple(range(len(out)))])


def build_hull(g, m, d, liv):
    lines = d["lines"]
    ts = sorted({round((x - ln[0][0]) / (ln[-1][0] - ln[0][0]), 4) for ln in lines for x, *_ in ln} | {0.0, 1.0})
    stations = [[_sample(ln, t) for ln in lines] for t in ts]
    hull, fender = m[liv["hull"]], m["black"]
    for a, c in zip(stations, stations[1:]):
        for k in range(len(lines) - 1):
            # Below the waterline: bottom paint; the belt band: black fender
            # where it's a narrow strake, hull colour where the bow rises above it
            if k < 2:
                mat = m["bottom"]
            elif k == 3 and max(a[4].z - a[3].z, c[4].z - c[3].z) < 1.5:
                mat = fender
            else:
                mat = hull
            for s in (1, -1):
                q = [Vector((p.x, s * p.y, p.z)) for p in (a[k], c[k], c[k + 1], a[k + 1])]
                _face(g, mat, q if s > 0 else list(reversed(q)))
        # Flat bottom between the keel lines, and the deck between the deck edges
        _face(g, m["bottom"], [Vector((p.x, s * p.y, p.z)) for p, s in ((a[0], -1), (c[0], -1), (c[0], 1), (a[0], 1))])
        _face(g, m["deck"], [Vector((p.x, s * p.y, p.z)) for p, s in ((a[4], 1), (c[4], 1), (c[4], -1), (a[4], -1))])
    # Transom: the hull colour above the waterline, bottom paint below
    st = stations[0]
    star = [Vector((p.x, -p.y, p.z)) for p in st]
    _face(g, m["bottom"], [st[0], st[1], st[2], star[2], star[1], star[0]][::-1])
    _face(g, hull, [st[2], st[3], st[4], star[4], star[3], star[2]][::-1])


def build_bulwark(g, m, d, liv):
    """Forecastle bulwark: a wall along the deck edge from x to the stem."""
    if not d["bulwark"]:
        return
    x0, h = d["bulwark"]
    deck = d["lines"][4]
    xs = [x0] + [x for x, *_ in deck if x > x0]
    xs = xs[:-1] + [deck[-1][0] - 0.05]
    for xa, xc in zip(xs, xs[1:]):
        (ha, za), (hc, zc) = _at(deck, xa), _at(deck, xc)
        for s in (1, -1):
            q = [Vector((xa, s * ha, za)), Vector((xc, s * hc, zc)), Vector((xc, s * hc, zc + h)), Vector((xa, s * ha, za + h))]
            _face(g, m[liv["hull"]], q if s > 0 else list(reversed(q)))
            # white cap rail
            g.beam(m["white"], (xa, s * ha, za + h), (xc, s * hc, zc + h), 0.25, 0.12)


# ------------------------------------------------------------ superstructure

def _block(g, mat, x0, x1, hw, z0, z1, rake=0.0, aft_rake=0.0):
    """Box with its front top edge moved aft by rake (forward if negative)."""
    vs = []
    for x in (0, 1):
        for y in (-1, 1):
            for z in (0, 1):
                xx = (x1 - rake * z if x else x0 + aft_rake * z)
                vs.append(Vector((xx, y * hw, z1 if z else z0)))
    g.add(mat, vs, op.BOX_FACES)
    return vs


def _on(g, mat, corners, u0, u1, v0, v1, out=0.03):
    """Sub-quad of a face given as (bottom-left, bottom-right, top-right,
    top-left), u along the bottom edge, v up, pushed out from the face."""
    bl, br, tr, tl = corners
    n = (tl - bl).cross(br - bl).normalized() * out

    def p(u, v):
        return bl.lerp(br, u).lerp(tl.lerp(tr, u), v) + n

    g.add(mat, [p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)], [(0, 1, 2, 3)])


def _faces(vs):
    """Side, front and aft faces of a _block, each as (bl, br, tr, tl) seen
    from outside."""
    # vs index = x*4 + y*2 + z, y 0 = starboard (-Y), 1 = port (+Y)
    return {
        "port": (vs[2], vs[6], vs[7], vs[3]),
        "star": (vs[4], vs[0], vs[1], vs[5]),
        "front": (vs[6], vs[4], vs[5], vs[7]),
        "aft": (vs[0], vs[2], vs[3], vs[1]),
    }


def _window_row(g, mat, face, n, v0=0.35, v1=0.7, margin=0.08, w=0.5):
    """n windows spread evenly along a face, each w of its slot."""
    for i in range(n):
        u = margin + (1 - 2 * margin) * (i + 0.5) / n
        du = (1 - 2 * margin) / n * w / 2
        _on(g, mat, face, u - du, u + du, v0, v1)


def build_superstructure(g, m, d, liv):
    sup = m[liv["super"]]
    for i, (x0, x1, hw, z0, z1, rake) in enumerate(d["tiers"]):
        vs = _block(g, sup, x0, x1, hw, z0, z1, rake)
        f = _faces(vs)
        n_side = max(2, round((x1 - x0) / 2.6))
        if z1 - z0 > 4:  # tall tier where the hull rises (x-bow): two rows
            for v in ((0.2, 0.33), (0.62, 0.75)):
                _window_row(g, m["lit"], f["port"], n_side, *v)
                _window_row(g, m["lit"], f["star"], n_side, *v)
        else:
            _window_row(g, m["lit"], f["port"], n_side)
            _window_row(g, m["lit"], f["star"], n_side)
        if i > 0 or z0 > 6.5:
            _window_row(g, m["lit"], f["front"], max(3, round(hw * 2 / 3.0)))
        # Doors and floodlights on the aft face over the cargo deck
        _on(g, m["grey"], f["aft"], 0.2, 0.26, 0.0, 0.75)
        _on(g, m["grey"], f["aft"], 0.74, 0.8, 0.0, 0.75)
        _on(g, m["flood"], f["aft"], 0.08, 0.13, 0.82, 0.92)
        _on(g, m["flood"], f["aft"], 0.87, 0.92, 0.82, 0.92)
    # Bridge: glass all round, wings out to the hull sides, aft windows over the deck
    x0, x1, hw, z0, z1, rake = d["bridge"]
    vs = _block(g, sup, x0, x1, hw, z0, z1, rake)
    f = _faces(vs)
    _on(g, m["glass"], f["front"], 0.03, 0.97, 0.35, 0.9)
    _on(g, m["glass"], f["aft"], 0.03, 0.97, 0.35, 0.9)
    _on(g, m["glass"], f["port"], 0.05, 0.95, 0.35, 0.9)
    _on(g, m["glass"], f["star"], 0.05, 0.95, 0.35, 0.9)
    # Roof slab with a little overhang, and the sun visor line
    g.box(sup, ((x0 + x1 - rake) / 2, 0, z1 + 0.12), (x1 - x0 - rake + 0.3 if rake < 0 else x1 - x0 + 0.3, hw * 2 + 0.3, 0.24))
    # Exhaust stacks behind the bridge with dark tops
    top = d["stack_top"]
    zb = d["tiers"][-1][4] if len(d["tiers"]) > 1 else z0
    for sx, sy in d["stacks"]:
        g.box(m[liv["stack"]], (sx, sy, (zb + top) / 2), (2.4, 1.6, top - zb))
        g.box(m[liv["stack_top"]], (sx, sy, top + 0.25), (2.5, 1.7, 0.5))
    # Life raft canisters and a rescue boat in its davit on the top tier
    tx0, tx1, thw, tz0, tz1, _ = d["tiers"][-1]
    for i in range(3):
        for s in (1, -1):
            g.tube(m["white"], (tx0 + 1.5 + i * 1.4, s * (thw + 0.5), tz0 + 0.5),
                   (tx0 + 1.5 + i * 1.4, s * (thw + 0.5), tz0 + 1.6), 0.45, 6)
    bx, by, bz = tx0 + 7.5, -(thw + 1.3), tz0 + 0.2
    g.box(m["orange"], (bx, by, bz + 0.6), (6.0, 2.2, 1.0))
    g.box(m["orange"], (bx + 0.6, by, bz + 1.4), (2.0, 1.4, 0.6))
    g.beam(m["grey"], (bx - 1.0, -thw + 0.2, tz0), (bx - 1.0, by, bz + 3.0), 0.25)


def build_mast(g, m, d):
    """Mast on the bridge roof with a yard, nav lights and two radar posts.
    Returns the radar pivot points (antennas are separate moving parts)."""
    x0, x1, hw, z0, z1, rake = d["bridge"]
    mx, roof = d["mast_x"], z1 + 0.24
    g.tube(m["grey"], (mx, 0, roof), (mx, 0, roof + 7.5), 0.25, 8)
    g.beam(m["grey"], (mx, -2.2, roof + 5.0), (mx, 2.2, roof + 5.0), 0.15)
    g.prism(m["nav_white"], (mx, 0), 0.15, roof + 7.5, roof + 7.9, 6)
    g.prism(m["nav_white"], (mx, 0), 0.15, roof + 5.4, roof + 5.7, 6)
    # sidelights on the bridge wings: red port, green starboard
    g.box(m["nav_red"], ((x0 + x1) / 2, hw + 0.05, z0 + 0.4), (0.4, 0.1, 0.3))
    g.box(m["nav_green"], ((x0 + x1) / 2, -hw - 0.05, z0 + 0.4), (0.4, 0.1, 0.3))
    # stern light
    g.box(m["nav_white"], (0.05, 0, d["deck_z"] + 0.6), (0.1, 0.4, 0.3))
    pivots = []
    for dx, h in ((-2.4, 2.2), (2.6, 1.0)):
        g.tube(m["grey"], (mx + dx, 0, roof), (mx + dx, 0, roof + h), 0.3, 6)
        pivots.append(Vector((mx + dx, 0, roof + h)))
    return pivots


def build_radar(g, m, length):
    g.box(m["black"], (0, 0, 0.15), (0.5, 0.5, 0.3))
    g.box(m["white"], (0, 0, 0.45), (0.35, length, 0.3))


# ----------------------------------------------------------- cargo deck

def build_cargo_rails(g, m, d, liv):
    x0, x1 = d["cargo"]
    z = d["deck_z"]
    hb, _ = _at(d["lines"][4], (x0 + x1) / 2)
    y = hb - 0.6
    rail = m[liv["rail"]]
    n = round((x1 - x0) / 4.5)
    for s in (1, -1):
        # low bulwark at the deck edge, then the crash rail posts and rails
        g.box(m[liv["hull"]], ((x0 + x1) / 2 - 0.5, s * (hb - 0.12), z + 0.5), (x1 - x0 + 1.0, 0.24, 1.0))
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            g.beam(rail, (x, s * y, z), (x, s * y, z + 2.6), 0.3)
        for h in (1.3, 2.6):
            g.beam(rail, (x0, s * y, z + h), (x1, s * y, z + h), 0.25)


def build_cargo(g, m, d, load="full", seed=7):
    """Containers, open baskets and pipe bundles, kept inside the rails."""
    if load == "empty":
        return
    rng = random.Random(seed)
    x0, x1 = d["cargo"]
    z = d["deck_z"]
    hb, _ = _at(d["lines"][4], (x0 + x1) / 2)
    ymax = hb - 1.6
    boxes = ("c_blue", "c_green", "c_orange", "c_grey")
    x = x0 + 3.0
    keep = 1.0 if load == "full" else 0.45
    while x < x1 - 4:
        kind = rng.choice(("box", "box", "basket", "pipes"))
        if kind == "pipes":
            ln = rng.uniform(10, 14)
            if x + ln > x1 - 2:
                break
            yc = rng.uniform(-ymax + 2, ymax - 2)
            if rng.random() < keep:
                for i in range(3):
                    for j in range(2 - i // 2):
                        g.tube(m["pipe"], (x, yc + (i - 1) * 0.65, z + 0.35 + j * 0.6),
                               (x + ln, yc + (i - 1) * 0.65, z + 0.35 + j * 0.6), 0.3, 6)
                g.box(m["grey"], (x + 1, yc, z + 0.05), (0.3, 2.4, 0.1))
                g.box(m["grey"], (x + ln - 1, yc, z + 0.05), (0.3, 2.4, 0.1))
            x += ln + rng.uniform(1.5, 3)
            continue
        # a row across the deck
        ln = 6.1 if kind == "box" else rng.choice((4.0, 6.0))
        y = -ymax
        while y < ymax - 2.4:
            w = 2.44
            if rng.random() < keep:
                if kind == "box":
                    h = rng.choice((2.6, 2.6, 2.6, 1.3))
                    g.box(m[rng.choice(boxes)], (x + ln / 2, y + w / 2, z + h / 2), (ln, w, h))
                else:  # open basket: floor and four low walls
                    h = 1.1
                    col = m[rng.choice(("c_grey", "c_orange", "yellow"))]
                    g.box(col, (x + ln / 2, y + w / 2, z + 0.1), (ln, w, 0.2))
                    for dy in (0.05, w - 0.05):
                        g.box(col, (x + ln / 2, y + dy, z + h / 2), (ln, 0.1, h))
                    for dx in (0.05, ln - 0.05):
                        g.box(col, (x + dx, y + w / 2, z + h / 2), (0.1, w, h))
            y += w + rng.uniform(0.4, 1.2)
        x += ln + rng.uniform(1.0, 2.5)


def build_forecastle(g, m, d):
    """Anchor windlass and bollards on the forecastle (none on the x-bow,
    where the bow is closed in)."""
    if not d["bulwark"]:
        return
    deck = d["lines"][4]
    xw = d["bulwark"][0] + 4.5
    _, z = _at(deck, xw)
    for s in (1, -1):
        g.tube(m["grey"], (xw, s * 1.0, z + 0.7), (xw, s * 2.6, z + 0.7), 0.6, 8)
        g.prism(m["black"], (xw - 3, s * 4.0), 0.25, z, z + 0.7, 6)


# ------------------------------------------------------------- assembly

def build_vessel(m, collection=None, loc=(0, 0, 0), yaw=0.0, design=None, livery=None, load="full"):
    """Build one vessel into collection as a root empty with its parts as
    children; returns (root, parts, triangles). loc is the waterline point
    amidships, yaw turns the bow from +X. Parts: Body, RadarA, RadarB (the
    radar antennas, turning about local Z)."""
    collection = collection or bpy.context.collection
    d = DESIGNS[design or DESIGN]
    liv = LIVERIES[livery or LIVERY]
    root = bpy.data.objects.new("SupplyVessel", None)
    root.location, root.rotation_euler = loc, (0, 0, yaw)
    collection.objects.link(root)
    body = op.Mesh()
    build_hull(body, m, d, liv)
    build_bulwark(body, m, d, liv)
    build_superstructure(body, m, d, liv)
    pivots = build_mast(body, m, d)
    build_forecastle(body, m, d)
    build_cargo_rails(body, m, d, liv)
    build_cargo(body, m, d, load)
    meshes = {"Body": body}
    for name, ln in (("RadarA", 4.2), ("RadarB", 2.6)):
        build_radar(meshes.setdefault(name, op.Mesh()), m, ln)
    # Move the origin from the transom to amidships
    mid = Vector((d["length"] / 2, 0, 0))
    for vs, _ in body.parts.values():
        for i, v in enumerate(vs):
            vs[i] = Vector(v) - mid
    pv = {"Body": Vector(), "RadarA": pivots[0] - mid, "RadarB": pivots[1] - mid}
    parts = {name: heli._part_object("Psv" + name, g, pv[name], root, collection) for name, g in meshes.items()}
    return root, parts, sum(g.tris for g in meshes.values())


# Where it holds station: alongside the crane side (-Y, true bearing 330°)
# of the platform, the crane over its cargo deck and its bridge under the
# control room window, bow toward the helideck end (+X, 240°): it comes in
# from the north-east along the platform and crabs sideways onto the berth
BERTH_LOC = (12.0, -45.0, 0.0)
BERTH_YAW = 0.0


# ---------------------------------------------------------------- previews

def export_glb(m, path, design=None, livery=None):
    coll = bpy.data.collections.new("Export")
    bpy.context.scene.collection.children.link(coll)
    build_vessel(m, coll, design=design, livery=livery)
    bpy.ops.object.select_all(action="DESELECT")
    for o in coll.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=False, export_yup=True,
                              export_texcoords=False, export_normals=True)
    print("wrote", path, flush=True)
    bpy.data.collections.remove(coll)


def export_web(m, out):
    """The scene's vessel and where it berths, for web/src/vessel.js. The
    browser sails it in platform coordinates (metres, +Z up, the berth from
    here) and maps them to the room's frame (three.js axes) with toRoom."""
    import json
    import control_room as cr
    from mathutils import Matrix
    os.makedirs(out, exist_ok=True)
    set_night(m, True)
    export_glb(m, os.path.join(out, "vessel.glb"))
    yup = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # z-up to three.js y-up
    M = yup @ cr.PLATFORM_TO_ROOM
    info = {
        "design": DESIGN, "livery": LIVERY, "length": DESIGNS[DESIGN]["length"],
        "berth": [round(BERTH_LOC[0], 3), round(BERTH_LOC[1], 3), round(BERTH_YAW, 5)],
        "crane": [getattr(op, "CRANE_X", 8.5), getattr(op, "CRANE_Y", -13.0)],
        "toRoom": [round(M[r][c], 6) for c in range(4) for r in range(4)],  # column-major, as Matrix4.fromArray
    }
    with open(os.path.join(out, "vessel.json"), "w") as f:
        json.dump(info, f, indent=1)
    print("wrote", out, flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--res", type=int, default=1280)
    p.add_argument("--out", default=os.path.join(b.BUILD, "supply_vessel"))
    p.add_argument("--device", default="auto")
    p.add_argument("--only", default="", help="comma list of shots to render")
    p.add_argument("--glb", action="store_true", help="also export the default to supply_vessel.glb")
    p.add_argument("--web", action="store_true", help="only write vessel.glb/json for the game")
    args = p.parse_args()
    os.makedirs(args.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    if args.web:
        export_web(materials(), os.path.join(b.ROOT, "web", "public", "control"))
        return
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
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)

    def cam(name, loc, aim, lens):
        dd = bpy.data.cameras.new(name)
        dd.lens, dd.clip_end = lens, 8000
        o = bpy.data.objects.new(name, dd)
        o.location = loc
        o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)
        return o

    colls = {}

    def coll(name):
        c = colls[name] = bpy.data.collections.new(name)
        scene.collection.children.link(c)
        return c

    def show(c):
        for k in colls.values():
            k.hide_render = k is not c

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
    if args.glb:
        export_glb(m, os.path.join(args.out, "supply_vessel.glb"))
    sea_m = b.mat_flat("Sea", (0.012, 0.035, 0.05), 0.12)

    def sea(c, r=3000):
        g = op.Mesh()
        g.span(sea_m, -r, r, -r, r, -0.2, 0)
        g.objects("Sea_" + c.name, c)

    # Studio at sea: all designs side by side, then each alone, then the liveries
    names = list(DESIGNS)
    line = coll("lineup")
    for i, name in enumerate(names):
        _, _, tris = build_vessel(m, line, (0, (1 - i) * 40.0, 0), 0.0, name)
        print(f"vessel ({name}): {tris} triangles", flush=True)
    sea(line)
    for name in names:
        c = coll("d_" + name)
        build_vessel(m, c, design=name)
        sea(c)
    livs = coll("liveries")
    for i, name in enumerate(LIVERIES):
        build_vessel(m, livs, (0, (1 - i) * 40.0, 0), 0.0, livery=name)
    sea(livs)

    w = args.res
    bg.inputs["Color"].default_value = (0.62, 0.70, 0.80, 1)
    bg.inputs["Strength"].default_value = 1.0
    sun_d.energy = 3.0
    set_night(m, False)
    show(line)
    shot(cam("Lineup", (120, -150, 60), (0, 0, 2), 50), "lineup", w, w * 9 // 16)
    show(livs)
    shot(cam("Liveries", (120, -150, 60), (0, 0, 2), 50), "liveries", w, w * 9 // 16)
    for name in names:
        show(colls["d_" + name])
        shot(cam("Q_" + name, (70, -55, 22), (2, 0, 5), 35), "quarter-" + name, w, w * 9 // 16)
        shot(cam("A_" + name, (-60, 40, 30), (0, 0, 4), 35), "aft-" + name, w, w * 9 // 16)
        shot(cam("S_" + name, (0, -150, 8), (0, 0, 6), 50), "side-" + name, w, w * 9 // 16)

    # Alongside the platform
    pm = op.materials()
    for name in names:
        c = coll("p_" + name)
        op.build_platform(pm, c)
        build_vessel(m, c, BERTH_LOC, BERTH_YAW, design=name)
        sea(c)
    for name in names:
        show(colls["p_" + name])
        shot(cam("PW_" + name, (160, -190, 45), (0, -25, 25), 40), "platform-" + name, w, w * 9 // 16)
    show(colls["p_" + DESIGN])
    # Roughly the control room window view (quarters, crane side) and a crane camera
    shot(cam("Window", (40, -19.8, 51.3), (BERTH_LOC[0], BERTH_LOC[1], 4), 28), "window", w, w * 9 // 16)
    shot(cam("CraneCam", (2, -21, 46), (BERTH_LOC[0], BERTH_LOC[1], 2), 24), "cranecam", w, w * 9 // 16)
    bg.inputs["Color"].default_value = (0.01, 0.015, 0.03, 1)
    sun_d.energy = 0.03
    set_night(m, True)
    op.set_night(pm, True)
    shot(cam("Night", (160, -190, 45), (0, -25, 25), 40), "night", w, w * 9 // 16)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "supply_vessel.blend"))


if __name__ == "__main__":
    main()
