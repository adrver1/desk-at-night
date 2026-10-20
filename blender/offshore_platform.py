"""
Medium-detail model of a North Sea PDQ platform (production, drilling,
quarters): a slender four-leg steel jacket under a much wider topsides, a
braced process block at one end, an open middle deck with the wellbay, one
big pedestal crane, the quarters block with the helideck overhanging the far
end, and a long flare boom reaching out low over the sea.

Proportions come from public figures for this kind of platform (~110 m
water, a 108 x 38 m topsides, a seven-floor quarters block, ~230 m from
seabed to flare tip) and from reference views of a scale model. Equipment
and facade details are invented.

    python blender/offshore_platform.py                     # preview stills
    python blender/offshore_platform.py --samples 16        # faster, noisier
    python blender/offshore_platform.py --jackup            # also the jack-up rig

Everything is merged into one mesh per material, so the whole platform costs
one draw call per material in the browser, and it uses no textures at all:
flat colours plus emissive deck lights for night. Origin is mean sea level at
the jacket centre; +X runs from the flare end to the quarters end.

Renders go to blender/build/platform/, and the .blend is saved next to them.
"""
import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402

# Heights above sea level (metres)
SEABED = -112.0
CELLAR, MAIN, UPPER = 24.0, 33.0, 42.0  # deck levels; the jacket stops under the cellar deck
TOP_X, TOP_Y = 54.0, 19.0               # topsides half extents: 108 x 38 m

# Jacket: four legs, only slightly battered, far inside the topsides footprint
LEG_TOP, LEG_BASE, LEG_R = (13.0, 13.0), (25.0, 25.0), 1.2
JACKET_LEVELS = [22.0, 8.0, -10.0, -32.0, -56.0, -84.0, SEABED]

# Along X: process block, open wellbay deck, stair tower + crane, utility deck with quarters on top
PROC_X1, PROC_TOP = -20.0, 60.0
UTIL_X0, UTIL_TOP = 2.0, 48.0
LQ_X0, LQ_X1, LQ_Y, LQ_TOP, LQ_FLOORS = 14.0, 50.0, 17.0, 72.0, 6
HELI_Z, HELI_R, HELI_X = 75.0, 13.0, 67.0

# Flare boom: from the process end, long and fairly low
FLARE_BASE = Vector((-TOP_X, 0.0, 40.0))
FLARE_ANGLE, FLARE_LEN = math.radians(40), 104.0

# Wellbay in the open middle deck, conductors straight down inside the jacket
WELL_X0, WELL_X1, WELL_Y0, WELL_Y1 = -13.0, 1.0, -6.0, 8.0


# ----------------------------------------------------------- mesh builder

class Mesh:
    """Collects geometry per material and turns each into one object."""

    def __init__(self):
        self.parts = {}
        self.tris = 0

    def add(self, mat, verts, faces):
        vs, fs = self.parts.setdefault(mat, ([], []))
        o = len(vs)
        vs.extend(verts)
        fs.extend([tuple(i + o for i in f) for f in faces])
        self.tris += sum(len(f) - 2 for f in faces)

    def box(self, mat, center, size, rot_z=0.0):
        sx, sy, sz = (s / 2 for s in size)
        M = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, "Z")
        vs = [M @ Vector((x * sx, y * sy, z * sz)) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        self.add(mat, vs, BOX_FACES)

    def span(self, mat, x0, x1, y0, y1, z0, z1):
        self.box(mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0))

    def beam(self, mat, a, c, w, h=None):
        """Square (or w x h) section from a to c."""
        a, c = Vector(a), Vector(c)
        M = _frame(a, c)
        h = w if h is None else h
        ln = (c - a).length
        vs = [M @ Vector((x * ln, y * w / 2, z * h / 2)) for x in (0, 1) for y in (-1, 1) for z in (-1, 1)]
        self.add(mat, vs, BOX_FACES)

    def tube(self, mat, a, c, r, n=8, caps=True, r1=None):
        a, c = Vector(a), Vector(c)
        M = _frame(a, c)
        ln, r1 = (c - a).length, r if r1 is None else r1
        vs = []
        for x, rr in ((0, r), (ln, r1)):
            for i in range(n):
                t = 2 * math.pi * i / n
                vs.append(M @ Vector((x, rr * math.cos(t), rr * math.sin(t))))
        fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        if caps:
            fs += [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        self.add(mat, vs, fs)

    def prism(self, mat, center, r, z0, z1, n=8, rot=0.0):
        """Vertical n-gon prism, for pedestals, the helideck and lamps."""
        cx, cy = center
        ring = [(cx + r * math.cos(rot + 2 * math.pi * i / n), cy + r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]
        vs = [Vector((x, y, z0)) for x, y in ring] + [Vector((x, y, z1)) for x, y in ring]
        fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        fs += [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        self.add(mat, vs, fs)

    def ring(self, mat, center, r0, r1, z, n=24):
        cx, cy = center
        vs = []
        for r in (r0, r1):
            vs += [Vector((cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
        self.add(mat, vs, [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)])

    def lattice(self, mat, a, c, w0, w1, bay, chord, brace=None, sides=4, roll=0.0):
        """Tapered lattice mast or boom from a to c: chords along the edges and
        a zig-zag of diagonals on every face. sides=3 gives a jack-up leg."""
        a, c = Vector(a), Vector(c)
        M = _frame(a, c) @ Matrix.Rotation(roll, 4, "X")
        ln = (c - a).length
        nb = max(1, round(ln / bay))
        brace = brace or chord * 0.5

        def corner(k, x):
            w = w0 + (w1 - w0) * x / ln
            t = 2 * math.pi * k / sides + math.pi / sides
            r = w / 2 / math.cos(math.pi / sides)  # w is the face width
            return M @ Vector((x, r * math.cos(t), r * math.sin(t)))

        for k in range(sides):
            self.beam(mat, corner(k, 0), corner(k, ln), chord)
            for j in range(nb):
                x0, x1 = ln * j / nb, ln * (j + 1) / nb
                k1 = (k + 1) % sides
                if j % 2:
                    self.beam(mat, corner(k, x0), corner(k1, x1), brace)
                else:
                    self.beam(mat, corner(k1, x0), corner(k, x1), brace)
                if j == 0 or j == nb - 1:
                    self.beam(mat, corner(k, x1 if j else x0), corner(k1, x1 if j else x0), brace)

    def objects(self, name, collection):
        out = []
        for mat, (vs, fs) in self.parts.items():
            me = bpy.data.meshes.new(f"{name}_{mat.name}")
            me.from_pydata([tuple(v) for v in vs], [], fs)
            me.validate()
            me.materials.append(mat)
            o = bpy.data.objects.new(me.name, me)
            collection.objects.link(o)
            out.append(o)
        return out


BOX_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


def _frame(a, c):
    """Matrix whose local X runs from a toward c."""
    d = (c - a).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.98 else Vector((1, 0, 0))
    y = up.cross(d).normalized()
    z = d.cross(y)
    M = Matrix((d, y, z)).transposed().to_4x4()
    M.translation = a
    return M


# -------------------------------------------------------------- materials

def materials():
    def emit(name, color, strength):
        m, _, bsdf = b._new_mat(name)
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        return m

    return {
        "jacket": b.mat_flat("PlatJacket", (0.62, 0.58, 0.05), 0.6),      # yellow-green steel
        "crane": b.mat_flat("PlatCrane", (0.85, 0.75, 0.02), 0.5),
        "steel": b.mat_flat("PlatSteel", (0.50, 0.51, 0.52), 0.6),        # deck plates, flare boom
        "module": b.mat_flat("PlatModule", (0.55, 0.56, 0.57), 0.7),      # clad module walls
        "dark": b.mat_flat("PlatDark", (0.28, 0.29, 0.30), 0.6),          # stair tower, cab glass
        "brown": b.mat_flat("PlatBrown", (0.30, 0.13, 0.08), 0.6),        # exhaust duct, containers
        "lq": b.mat_flat("PlatQuarters", (0.86, 0.87, 0.86), 0.6),
        "glass": b.mat_flat("PlatGlass", (0.05, 0.07, 0.09), 0.2),
        "equip": b.mat_flat("PlatEquip", (0.30, 0.38, 0.42), 0.5),        # vessels, pipework
        "heli": b.mat_flat("PlatHelideck", (0.42, 0.43, 0.44), 0.8),
        "mark": b.mat_flat("PlatMarking", (0.85, 0.75, 0.10), 0.7),
        "white": b.mat_flat("PlatWhite", (0.9, 0.9, 0.9), 0.7),
        "orange": b.mat_flat("PlatOrange", (0.75, 0.06, 0.04), 0.5),      # lifeboats, crane boom bands
        "lamp": emit("PlatLamp", (1.0, 0.78, 0.45), 0.0),                   # deck lights, off by day
        "window": emit("PlatWindow", (1.0, 0.85, 0.6), 0.0),
        "red": emit("PlatRed", (1.0, 0.05, 0.02), 0.0),                     # obstruction lights
        "flare": emit("PlatFlare", (1.0, 0.45, 0.10), 0.0),
    }


def set_night(m, on):
    for k, s in (("lamp", 40), ("window", 2.5), ("red", 60), ("flare", 120)):
        m[k].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = s if on else 0.0




# ---------------------------------------------------------------- facades

def _plane(plane, out):
    """Map (u, z, offset) on a vertical plane to world space. plane is
    ("y", y) for a long side or ("x", x) for an end; out is +1/-1, the side
    the facade faces."""
    axis, c = plane
    if axis == "y":
        return lambda u, z, off=0.0: Vector((u, c + out * off, z))
    return lambda u, z, off=0.0: Vector((c + out * off, u, z))


def rect(g, mat, plane, out, u0, u1, z0, z1, off=0.1):
    """Single outward-facing quad: windows, signs, cheap panels."""
    P = _plane(plane, out)
    vs = [P(u0, z0, off), P(u1, z0, off), P(u1, z1, off), P(u0, z1, off)]
    n = (vs[1] - vs[0]).cross(vs[3] - vs[0])
    want = Vector((0, out, 0)) if plane[0] == "y" else Vector((out, 0, 0))
    g.add(mat, vs, [(0, 1, 2, 3) if n.dot(want) > 0 else (3, 2, 1, 0)])


def facade(g, m, plane, out, u0, u1, z0, z1, nu, nz, wall="module", seed=0):
    """Clad wall with an exposed white bracing grid in front of it: the look
    of every module face in the reference. nu x nz panels, each with an X,
    a single diagonal or nothing."""
    P = _plane(plane, out)
    if wall:
        rect(g, m[wall], plane, out, u0, u1, z0, z1, 0.0)
    us = [u0 + (u1 - u0) * i / nu for i in range(nu + 1)]
    zs = [z0 + (z1 - z0) * j / nz for j in range(nz + 1)]
    w = m["white"]
    for u in us:
        g.beam(w, P(u, z0, 0.4), P(u, z1, 0.4), 0.5)
    for z in zs:
        g.beam(w, P(u0, z, 0.4), P(u1, z, 0.4), 0.5)
    rng = random.Random(seed)
    for i in range(nu):
        for j in range(nz):
            k = rng.random()
            a, c = (us[i], zs[j]), (us[i + 1], zs[j + 1])
            if k < 0.45:
                g.beam(w, P(*a, 0.4), P(*c, 0.4), 0.4)
                g.beam(w, P(us[i], zs[j + 1], 0.4), P(us[i + 1], zs[j], 0.4), 0.4)
            elif k < 0.8:
                g.beam(w, P(*a, 0.4), P(*c, 0.4), 0.4) if (i + j) % 2 else \
                    g.beam(w, P(us[i], zs[j + 1], 0.4), P(us[i + 1], zs[j], 0.4), 0.4)


def block(g, m, x0, x1, y0, y1, z0, z1, mat="module", panel=9.0, ends=(True, True), seed=0):
    """Module block: a solid box with braced facades on its long sides and
    (optionally) its ends."""
    g.span(m[mat], x0, x1, y0, y1, z0, z1)
    nu, nz = max(1, round((x1 - x0) / panel)), max(1, round((z1 - z0) / panel))
    facade(g, m, ("y", y0), -1, x0, x1, z0, z1, nu, nz, None, seed)
    facade(g, m, ("y", y1), 1, x0, x1, z0, z1, nu, nz, None, seed + 1)
    nv = max(1, round((y1 - y0) / panel))
    if ends[0]:
        facade(g, m, ("x", x0), -1, y0, y1, z0, z1, nv, nz, None, seed + 2)
    if ends[1]:
        facade(g, m, ("x", x1), 1, y0, y1, z0, z1, nv, nz, None, seed + 3)
    g.span(m["steel"], x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, z1, z1 + 0.5)  # roof edge


# ----------------------------------------------------------------- jacket

LEG_TOP_Z = CELLAR - 1.5


def leg_xy(sx, sy, z):
    """Leg centre at height z: linear batter from the top to the seabed."""
    t = (LEG_TOP_Z - z) / (LEG_TOP_Z - SEABED)
    return (sx * (LEG_TOP[0] + (LEG_BASE[0] - LEG_TOP[0]) * t),
            sy * (LEG_TOP[1] + (LEG_BASE[1] - LEG_TOP[1]) * t), z)


def build_jacket(g, m, z_cut):
    levels = sorted({z for z in JACKET_LEVELS if z >= z_cut} | {max(z_cut, SEABED)}, reverse=True)
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    jm = m["jacket"]
    for sx, sy in corners:
        g.tube(jm, leg_xy(sx, sy, LEG_TOP_Z + 1.5), leg_xy(sx, sy, levels[-1]), LEG_R, 8)
        if z_cut <= SEABED:  # mudmat / pile sleeves on the seabed
            x, y, _ = leg_xy(sx, sy, SEABED)
            g.prism(jm, (x, y), 3.2, SEABED, SEABED + 3, 8)
    for z in levels:
        if z == z_cut and z_cut > SEABED:
            continue
        for k in range(4):
            g.tube(jm, leg_xy(*corners[k], z), leg_xy(*corners[(k + 1) % 4], z), 0.45, 6, caps=False)
        g.tube(jm, leg_xy(1, 1, z), leg_xy(-1, -1, z), 0.35, 6, caps=False)
        g.tube(jm, leg_xy(-1, 1, z), leg_xy(1, -1, z), 0.35, 6, caps=False)
    for z0, z1 in zip(levels, levels[1:]):
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            g.tube(jm, leg_xy(*c0, z0), leg_xy(*c1, z1), 0.4, 6, caps=False)
            g.tube(jm, leg_xy(*c1, z0), leg_xy(*c0, z1), 0.4, 6, caps=False)
    # Well conductors: 4 x 5 slots under the wellbay, straight down
    for i in range(5):
        for j in range(4):
            x = WELL_X0 + 3 + i * (WELL_X1 - WELL_X0 - 6) / 4
            y = WELL_Y0 + 3 + j * (WELL_Y1 - WELL_Y0 - 6) / 3
            g.tube(m["white"], (x, y, levels[-1]), (x, y, MAIN), 0.4, 5, caps=False)
    # Riser guards and a boat landing on the -Y face at the splash zone
    for x in (-4, 0, 4):
        g.tube(m["steel"], (x, -14.2, -4), (x, -14.2, CELLAR), 0.5, 6)
    g.span(m["steel"], -7, 7, -17.5, -16.5, 2, 3)


# --------------------------------------------------------------- topsides

def build_topsides(g, m):
    st = m["steel"]
    # Deck support frame on the jacket, and the cellar deck under everything
    for sx in (1, -1):
        g.beam(st, (sx * LEG_TOP[0], -TOP_Y, CELLAR - 1.2), (sx * LEG_TOP[0], TOP_Y, CELLAR - 1.2), 2.0)
    g.span(st, -TOP_X, TOP_X, -TOP_Y, TOP_Y, CELLAR - 1.0, CELLAR)

    # Process block at the flare end: tall, clad, braced on every face
    block(g, m, -TOP_X, PROC_X1, -TOP_Y, TOP_Y, CELLAR, PROC_TOP, ends=(True, False), seed=1)
    g.span(m["white"], -TOP_X - 1, -TOP_X + 4, -TOP_Y - 1, -TOP_Y + 6, CELLAR, PROC_TOP + 4)  # stair/HVAC shaft
    rng = random.Random(3)
    for _ in range(7):  # roof plant: fans, skids, a couple of tanks
        x, y = rng.uniform(-50, -24), rng.uniform(-15, 15)
        g.box(m["module"], (x, y, PROC_TOP + 1.5), (rng.uniform(3, 7), rng.uniform(3, 6), 3))
    for x, y in ((-46, 11), (-41, 11)):
        g.tube(m["module"], (x, y, PROC_TOP + 0.5), (x, y, PROC_TOP + 5), 1.6, 10)

    # Open middle: three deck plates on columns, trussed sides, the wellbay
    x0, x1 = PROC_X1, UTIL_X0
    for z in (MAIN, UPPER):
        g.span(st, x0, x1, -TOP_Y, TOP_Y, z - 0.8, z)
    for x in (x0 + 0.5, (x0 + x1) / 2, x1 - 0.5):
        for y in (-TOP_Y + 0.5, 0, TOP_Y - 0.5):
            g.beam(st, (x, y, CELLAR), (x, y, UPPER), 0.8)
    for out, y in ((-1, -TOP_Y), (1, TOP_Y)):
        facade(g, m, ("y", y), out, x0, x1, CELLAR, UPPER, 2, 2, None, seed=5 + out)
    for x, y, c in ((-17, -14, "orange"), (-17, -10, "brown"), (-8, -15, "module"), (-4, 14, "orange")):
        g.box(m[c], (x, y, UPPER + 1.3), (6, 2.5, 2.6))  # containers in the laydown area
    # Process vessels visible between the open decks
    g.tube(m["equip"], (x0 + 1, -11, CELLAR + 3.5), (x1 - 1, -11, CELLAR + 3.5), 2.6, 12)
    g.tube(m["equip"], (x0 + 1, 12, MAIN + 3.2), (x1 - 3, 12, MAIN + 3.2), 2.2, 12)
    for y in (WELL_Y0, WELL_Y1):  # wellbay hatch frame, open to the sky
        g.beam(st, (WELL_X0, y, UPPER + 1), (WELL_X1, y, UPPER + 1), 0.7)

    # Stair tower and crane pedestal between the open deck and the quarters
    g.span(m["dark"], UTIL_X0, UTIL_X0 + 6, -TOP_Y, -7, CELLAR, 64)
    # Utility deck under the quarters, the full rest of the length
    block(g, m, UTIL_X0, TOP_X - 4, -TOP_Y, TOP_Y, CELLAR, UTIL_TOP, ends=(False, False), seed=11)


def build_quarters(g, m):
    x0, x1, y = LQ_X0, LQ_X1, LQ_Y
    g.span(m["lq"], x0, x1, -y, y, UTIL_TOP, LQ_TOP)
    # Lower grey service floors stepping back toward the crane
    g.span(m["module"], UTIL_X0 + 6, x0, -TOP_Y + 3, TOP_Y - 3, UTIL_TOP, UTIL_TOP + 8)
    # White end tower: stairs and lifts, the full height of the end
    g.span(m["lq"], TOP_X - 4, TOP_X, -TOP_Y, TOP_Y, CELLAR - 2, LQ_TOP + 2)
    floor_h = (LQ_TOP - UTIL_TOP) / LQ_FLOORS
    rng = random.Random(7)  # which cabins have the light on at night
    for f in range(LQ_FLOORS):
        z = UTIL_TOP + f * floor_h + floor_h * 0.35
        for i in range(10):
            wx = x0 + 3 + i * (x1 - x0 - 6) / 9
            for out in (-1, 1):
                mat = m["window" if rng.random() < 0.45 else "glass"]
                rect(g, mat, ("y", out * y), out, wx - 0.8, wx + 0.8, z, z + 1.4)
        for i in range(7):
            wy = -y + 3 + i * (2 * y - 6) / 6
            mat = m["window" if rng.random() < 0.45 else "glass"]
            rect(g, mat, ("x", x0), -1, wy - 0.8, wy + 0.8, z, z + 1.4)
    # Roof plant on the quarters
    for (cx, cy, sx, sy, h) in ((22, -8, 8, 6, 3), (34, 6, 10, 7, 4), (42, -9, 6, 5, 2.5), (30, -10, 4, 4, 5)):
        g.box(m["module"], (cx, cy, LQ_TOP + h / 2), (sx, sy, h))
    for (cx, cy) in ((38, -2), (44, 4)):
        g.tube(m["module"], (cx, cy, LQ_TOP), (cx, cy, LQ_TOP + 2.5), 1.4, 10)
    # Lifeboats: two red capsules on the -Y side at the foot of the quarters
    for x in (25, 31):
        g.tube(m["orange"], (x - 2.6, -TOP_Y - 1.6, UTIL_TOP + 1.8), (x + 2.6, -TOP_Y - 1.6, UTIL_TOP + 1.8), 1.4, 8)
    # Exhaust tower: a lattice with a brown duct up through it
    g.lattice(m["white"], (26, 10, LQ_TOP), (26, 10, LQ_TOP + 15), 3.5, 2.5, 3.5, 0.25)
    g.tube(m["brown"], (24, 10, LQ_TOP), (24, 10, LQ_TOP + 6), 1.0, 8)
    g.tube(m["brown"], (24, 10, LQ_TOP + 6), (26, 10, LQ_TOP + 7), 1.0, 8)
    g.tube(m["dark"], (26, 10, LQ_TOP + 7), (26, 10, LQ_TOP + 17), 0.9, 8)
    g.prism(m["red"], (26, 10), 0.4, LQ_TOP + 17, LQ_TOP + 17.8, 6)
    g.prism(m["red"], (x1 - 1, y - 1), 0.4, LQ_TOP + 0.2, LQ_TOP + 0.9, 6)
    # Helideck: grey octagon overhanging the end, trussed back to the tower
    hz, hx, r = HELI_Z, HELI_X, HELI_R
    g.prism(m["heli"], (hx, 0), r, hz - 0.6, hz, 8, math.pi / 8)
    g.ring(m["mark"], (hx, 0), r * 0.48, r * 0.56, hz + 0.03, 20)
    for c, s in (((hx, -2.3, hz + 0.04), (5.5, 0.8, 0.04)), ((hx, 2.3, hz + 0.04), (5.5, 0.8, 0.04)),
                 ((hx, 0, hz + 0.04), (0.8, 4.6, 0.04))):
        g.box(m["white"], c, s)
    g.prism(m["steel"], (hx, 0), r + 1.2, hz - 1.0, hz - 0.7, 8, math.pi / 8)  # safety net shelf
    for yy in (-7, 7):
        g.beam(m["white"], (TOP_X, yy, LQ_TOP - 16), (hx + 7, yy, hz - 0.6), 0.7)
        g.beam(m["white"], (TOP_X, yy, LQ_TOP - 16), (hx - 2, yy, hz - 0.6), 0.7)
        g.beam(m["white"], (TOP_X, yy, hz - 0.8), (hx + 7, yy, hz - 0.8), 0.7)
    for i in range(8):
        a = math.pi / 8 + 2 * math.pi * i / 8
        g.prism(m["lamp"], (hx + (r - 0.3) * math.cos(a), (r - 0.3) * math.sin(a)), 0.25, hz, hz + 0.3, 6)


def build_flare(g, m):
    d = Vector((-math.cos(FLARE_ANGLE), 0, math.sin(FLARE_ANGLE)))
    tip = FLARE_BASE + d * FLARE_LEN
    # Triangular lattice, flat face down, tapering toward the tip
    g.lattice(m["steel"], FLARE_BASE, tip, 9.0, 3.5, 9.0, 0.9, brace=0.6, sides=3, roll=math.pi / 2)
    # Tip platform and the burner
    g.box(m["steel"], tip + Vector((-2, 0, 0.5)), (10, 7, 1.2))
    g.box(m["steel"], tip + Vector((-3.5, 0, 2.2)), (4, 4, 2.2))
    g.tube(m["dark"], tip + Vector((-3.5, 0, 3.3)), tip + Vector((-3.5, 0, 5.5)), 0.7, 8)
    # The platform runs on power from shore, so normally only the pilot burns
    g.tube(m["flare"], tip + Vector((-3.5, 0, 5.5)), tip + Vector((-3.5, 0, 7.5)), 0.5, 6, r1=0.1)
    g.prism(m["red"], (tip.x + 2.5, 2.5), 0.35, tip.z + 1.1, tip.z + 1.8, 6)
    return tip


def build_crane(g, m, base, ped_h, yaw, luff, boom_len, bands=True):
    """Pedestal crane: yellow column, slewing house and A-frame, and a white
    lattice boom with red bands. yaw is the boom direction in plan, luff its
    angle above horizontal."""
    x, y, z = base
    cr = m["crane"]
    g.prism(cr, (x, y), 2.2, z, z + ped_h, 10)
    g.prism(cr, (x, y), 3.0, z + ped_h * 0.55, z + ped_h * 0.62, 10)  # slewing ring flange
    zt = z + ped_h
    fwd = Vector((math.cos(yaw), math.sin(yaw), 0))
    side = Vector((-fwd.y, fwd.x, 0))
    g.box(cr, Vector((x, y, zt + 2)) - fwd * 1.5, (7, 5, 4), yaw)
    g.box(m["dark"], Vector((x, y, zt + 2.5)) + fwd * 2.4 + side * 2.4, (2.2, 1.6, 2.4), yaw)  # cab glass
    top = Vector((x, y, zt + 12)) - fwd * 2.0
    for s in (-1.6, 1.6):
        g.beam(cr, Vector((x, y, zt + 4)) + side * s - fwd * 4, top + side * s * 0.3, 0.7)
        g.beam(cr, Vector((x, y, zt + 4)) + side * s + fwd * 0.5, top + side * s * 0.3, 0.7)
    foot = Vector((x, y, zt + 3)) + fwd * 1.5
    dirv = fwd * math.cos(luff) + Vector((0, 0, math.sin(luff)))
    tip = foot + dirv * boom_len
    g.lattice(m["white"], foot, tip, 2.6, 1.2, 4.0, 0.3, roll=math.pi / 4)
    if bands:  # red sections near the foot and the tip, as on the real boom
        for t0, t1 in ((0.12, 0.24), (0.76, 0.88)):
            g.lattice(m["orange"], foot + dirv * boom_len * t0, foot + dirv * boom_len * t1,
                      2.6 - 1.4 * t0 + 0.15, 2.6 - 1.4 * t1 + 0.15, 4.0, 0.32, roll=math.pi / 4)
    g.beam(m["steel"], top, tip, 0.12)  # luffing wire
    g.beam(m["steel"], tip, tip - Vector((0, 0, 6)), 0.08)  # hook line
    g.prism(m["red"], (tip.x, tip.y), 0.3, tip.z + 0.5, tip.z + 1.1, 6)
    return tip


def build_cranes(g, m):
    # One big crane beside the stair tower, boom swung out over the process end
    build_crane(g, m, (UTIL_X0 + 3, -12, UTIL_TOP), 18, math.radians(178), math.radians(-3), 60)


def build_lights(g, m):
    """Deck lights every ~9 m along the edges of each deck, the night look."""
    for z in (CELLAR, MAIN, UPPER):
        for i in range(12):
            x = -TOP_X + 4 + i * 9
            for y in (-TOP_Y - 0.7, TOP_Y + 0.7):
                g.box(m["lamp"], (x, y, z + 2.6), (0.5, 0.3, 0.3))
        for y in (-12, 0, 12):
            g.box(m["lamp"], (-TOP_X - 0.7, y, z + 2.6), (0.3, 0.5, 0.3))
    for x, y, z in ((-40, -9, PROC_TOP + 0.8), (-28, 9, PROC_TOP + 0.8), (-9, 0, UPPER + 6), (20, 0, UTIL_TOP + 8.8)):
        g.box(m["lamp"], (x, y, z), (1.0, 1.0, 0.5))  # floodlights


# ---------------------------------------------------------------- jack-up

JU_C = Vector(((WELL_X0 + WELL_X1) / 2, 64.0))  # hull centre in plan, beside the wellbay


def build_jackup(g, m, z_cut):
    """Generic harsh-environment jack-up standing beside the platform with its
    cantilever skidded out over the wellbay."""
    hz0, hz1 = 47.0, 56.0  # hull bottom/top: the drill floor clears the open deck
    cx, cy = JU_C
    hull = [(-36, -26), (36, -26), (36, 8), (14, 34), (-14, 34), (-36, 8)]
    n = len(hull)
    vs = [Vector((cx + x, cy + y, z)) for z in (hz0, hz1) for x, y in hull]
    fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    fs += [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    g.add(m["white"], vs, fs)
    leg_top = hz1 + 60
    for lx, ly in ((-28, -16), (28, -16), (0, 26)):
        p = (cx + lx, cy + ly)
        g.prism(m["steel"], p, 7.5, hz1, hz1 + 5, 8)  # jack house
        g.lattice(m["jacket"], (*p, max(z_cut, SEABED)), (*p, leg_top), 12, 12, 6, 0.8, sides=3)
        if z_cut <= SEABED:
            g.prism(m["jacket"], p, 9, SEABED, SEABED + 4, 8)  # spudcan
        g.prism(m["red"], p, 0.6, leg_top, leg_top + 1, 6)
    # Quarters block and helideck on the far end
    g.span(m["lq"], cx - 20, cx + 8, cy + 14, cy + 30, hz1, hz1 + 14)
    g.prism(m["heli"], (cx + 22, cy + 22), 11, hz1 + 17, hz1 + 17.6, 8, math.pi / 8)
    for xx in (14, 26):
        g.beam(m["steel"], (cx + xx, cy + 12, hz1), (cx + xx, cy + 20, hz1 + 17), 0.8)
    for z in (hz1 + 5, hz1 + 10):
        rect(g, m["window"], ("y", cy + 14), -1, cx - 19, cx + 7, z, z + 1.2)
    # Cantilever beams out over the wellbay, the drill floor and the derrick
    wy = (WELL_Y0 + WELL_Y1) / 2
    cy0, cy1 = wy - 8, cy - 4
    for xx in (-7, 7):
        g.span(m["steel"], cx + xx - 1.2, cx + xx + 1.2, cy0, cy1, hz1, hz1 + 7)
    g.span(m["module"], cx - 9, cx + 9, cy0, cy0 + 16, hz1 + 7, hz1 + 9)  # drill floor
    g.span(m["module"], cx - 9, cx + 9, cy0 + 16, cy0 + 30, hz1 + 7, hz1 + 15)  # pipe deck / mud
    fc = Vector((cx, wy, hz1 + 9))
    g.lattice(m["white"], fc, fc + Vector((0, 0, 52)), 12, 3.5, 6.5, 0.45)
    g.prism(m["red"], (fc.x, fc.y), 0.5, fc.z + 52, fc.z + 53, 6)
    build_crane(g, m, (cx + 32, cy - 22, hz1), 6, math.radians(150), math.radians(25), 34, bands=False)
    for x, y in hull:
        g.box(m["lamp"], (cx + x * 1.01, cy + y * 1.01, hz1 + 1), (0.6, 0.6, 0.4))


# ------------------------------------------------------------------ build

def build_platform(m, collection=None, jackup=False, z_cut=-4.0):
    """Build the platform into collection; returns (objects, triangles, flare tip).
    z_cut is where the jacket stops: just under the sea surface for a view
    from above the water, SEABED for a scale model."""
    collection = collection or bpy.context.collection
    g = Mesh()
    build_jacket(g, m, z_cut)
    build_topsides(g, m)
    build_quarters(g, m)
    tip = build_flare(g, m)
    build_cranes(g, m)
    build_lights(g, m)
    if jackup:
        build_jackup(g, m, z_cut)
    return g.objects("Platform", collection), g.tris, tip


# ---------------------------------------------------------------- preview

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--res", type=int, default=1280)
    p.add_argument("--out", default=os.path.join(b.BUILD, "platform"))
    p.add_argument("--device", default="auto")
    p.add_argument("--jackup", action="store_true", help="add the jack-up rig beside the platform")
    p.add_argument("--only", default="", help="comma list of shots to render")
    args = p.parse_args()
    os.makedirs(args.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = b.pick_device(args.device)
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"

    m = materials()
    above = bpy.data.collections.new("AboveWater")
    full = bpy.data.collections.new("ScaleModel")
    whole = bpy.data.collections.new("FullHeight")
    for c in (above, full, whole):
        scene.collection.children.link(c)
    objs, tris, tip = build_platform(m, above, jackup=args.jackup)
    print(f"platform above water: {len(objs)} objects (one per material), {tris} triangles", flush=True)

    sea_m, _, bsdf = b._new_mat("Sea")
    bsdf.inputs["Base Color"].default_value = (0.01, 0.03, 0.04, 1)
    bsdf.inputs["Roughness"].default_value = 0.15
    sea = b.quad("Sea", [(-2000, -2000, 0), (2000, -2000, 0), (2000, 2000, 0), (-2000, 2000, 0)], sea_m, (0, 0, 0))
    for c in sea.users_collection:
        c.objects.unlink(sea)
    above.objects.link(sea)

    # Scale model: the full height, every surface white, on a plinth
    wm = {k: b.mat_flat("Model_" + k, (0.86, 0.84, 0.78), 0.7) for k in m}
    mobjs, mtris, _ = build_platform(wm, full, jackup=False, z_cut=SEABED)
    g = Mesh()
    g.span(wm["module"], -45, 45, -40, 40, SEABED - 4, SEABED)
    g.objects("Plinth", full)
    print(f"scale model (to seabed): {mtris} triangles", flush=True)
    # Full height in colour, to compare against reference views of the whole structure
    build_platform(m, whole, jackup=False, z_cut=SEABED)

    sun_d = bpy.data.lights.new("Sun", "SUN")
    sun_d.energy = 3.5
    sun_d.angle = math.radians(2)
    sun = bpy.data.objects.new("Sun", sun_d)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)

    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    scene.world = world

    def cam(name, loc, aim, lens):
        d = bpy.data.cameras.new(name)
        d.lens, d.clip_end = lens, 5000
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)
        return o

    def show(coll):
        for c in (above, full, whole):
            c.hide_render = c is not coll

    def shot(c, name, w, h):
        if args.only and name not in args.only.split(","):
            return
        scene.camera = c
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.render.filepath = os.path.join(args.out, name + ".png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scene.render.filepath, flush=True)

    w = args.res
    sfx = "-jackup" if args.jackup else ""
    # Day, above water: overall read of the shapes
    show(above)
    bg.inputs["Color"].default_value = (0.55, 0.65, 0.78, 1)
    bg.inputs["Strength"].default_value = 1.0
    set_night(m, False)
    shot(cam("Quarter", (190, -210, 95), (0, 0, 45), 35), "day-quarter" + sfx, w, w * 9 // 16)
    shot(cam("Side", (0, -330, 45), (0, 0, 55), 35), "day-side" + sfx, w, w * 9 // 16)
    shot(cam("Flare", (-170, 150, 70), (-10, 0, 55), 35), "day-flare-end" + sfx, w, w * 9 // 16)
    shot(cam("Deck", (95, -60, 110), (-10, 4, 42), 30), "day-deck" + sfx, w, w * 9 // 16)
    # Night: deck lights, quarters windows, obstruction lights and the pilot
    bg.inputs["Color"].default_value = (0.01, 0.015, 0.03, 1)
    sun_d.energy = 0.04
    set_night(m, True)
    shot(cam("Night", (230, -260, 30), (0, 0, 50), 40), "night" + sfx, w, w * 9 // 16)
    # Scale model: white, full height, like the one in the lounge
    sun_d.energy = 3.5
    bg.inputs["Color"].default_value = (0.25, 0.25, 0.27, 1)
    show(full)
    shot(cam("Model", (260, -300, 20), (0, 0, 0), 50), "scale-model", w * 9 // 16, w)
    # Full height in colour on a pale studio background, from the reference angles
    bg.inputs["Color"].default_value = (0.85, 0.87, 0.9, 1)
    bg.inputs["Strength"].default_value = 0.75
    sun_d.energy = 2.2
    set_night(m, False)
    show(whole)
    shot(cam("RefSide", (60, -440, 10), (0, 0, 2), 35), "full-side", w, w * 9 // 16)
    shot(cam("RefHigh", (230, -300, 230), (-15, 0, 10), 35), "full-high", w, w * 9 // 16)
    shot(cam("RefBack", (-120, 330, 200), (-10, 0, 10), 35), "full-back", w, w * 9 // 16)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "platform.blend"))


if __name__ == "__main__":
    main()
