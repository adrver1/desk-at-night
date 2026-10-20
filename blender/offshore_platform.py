"""
Medium-detail model of a North Sea PDQ platform (production, drilling
quarters): a four-leg steel jacket, a three-level topsides, the living
quarters with the helideck on top, an inclined flare boom, two pedestal
cranes and a wellbay that a jack-up rig can cantilever over.

Proportions come from public figures for this kind of platform: ~110 m water,
a 108 x 38 m topsides, a seven-floor quarters block about 40 m tall, and
~230 m from seabed to flare tip. Equipment inside the modules is invented.

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
import random
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402

# Heights above sea level (metres)
SEABED = -112.0
CELLAR, MAIN, UPPER = 24.0, 32.0, 40.0  # deck levels; the jacket stops under the cellar deck
TOP_X, TOP_Y = 54.0, 19.0              # topsides half extents: 108 x 38 m

# Jacket: legs batter out from the top to the seabed
LEG_TOP = (18.0, 12.0)
LEG_BASE = (30.0, 24.0)
LEG_R = 1.3
JACKET_LEVELS = [22.0, 6.0, -22.0, -52.0, -84.0, SEABED]

# Living quarters at the +X end, helideck on its roof overhanging the end
LQ_X0, LQ_Y = 33.0, 13.0
LQ_Z0, LQ_Z1, LQ_FLOORS = UPPER, 66.0, 7
HELI_Z, HELI_R, HELI_X = 68.5, 12.0, 58.0

# Flare boom at the -X end, inclined outward
FLARE_BASE = Vector((-50.0, 0.0, UPPER + 2))
FLARE_ANGLE, FLARE_LEN = math.radians(60), 86.0

# Wellbay on the +Y side, open to the sky so a jack-up can cantilever over it
WELL_X0, WELL_X1, WELL_Y0, WELL_Y1 = -22.0, -4.0, 6.0, 17.0


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
        "jacket": b.mat_flat("PlatJacket", (0.78, 0.55, 0.08), 0.6),      # yellow steel
        "steel": b.mat_flat("PlatSteel", (0.42, 0.43, 0.44), 0.6),        # deck structure, booms
        "module": b.mat_flat("PlatModule", (0.78, 0.79, 0.78), 0.7),      # clad modules
        "lq": b.mat_flat("PlatQuarters", (0.86, 0.87, 0.86), 0.6),
        "glass": b.mat_flat("PlatGlass", (0.05, 0.07, 0.09), 0.2),
        "equip": b.mat_flat("PlatEquip", (0.30, 0.38, 0.42), 0.5),        # vessels, pipework
        "heli": b.mat_flat("PlatHelideck", (0.12, 0.30, 0.16), 0.8),
        "mark": b.mat_flat("PlatMarking", (0.85, 0.75, 0.10), 0.7),
        "white": b.mat_flat("PlatWhite", (0.9, 0.9, 0.9), 0.7),
        "orange": b.mat_flat("PlatOrange", (0.9, 0.30, 0.03), 0.5),       # lifeboats, crane cabs
        "lamp": emit("PlatLamp", (1.0, 0.78, 0.45), 0.0),                   # deck lights, off by day
        "window": emit("PlatWindow", (1.0, 0.85, 0.6), 0.0),
        "red": emit("PlatRed", (1.0, 0.05, 0.02), 0.0),                     # obstruction lights
        "flare": emit("PlatFlare", (1.0, 0.45, 0.10), 0.0),
    }


def set_night(m, on):
    for k, s in (("lamp", 40), ("window", 2.5), ("red", 60), ("flare", 120)):
        m[k].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = s if on else 0.0


# ----------------------------------------------------------------- jacket

def leg_xy(sx, sy, z):
    """Leg centre at height z: linear batter from the top to the seabed."""
    t = (LEG_TOP_Z - z) / (LEG_TOP_Z - SEABED)
    return (sx * (LEG_TOP[0] + (LEG_BASE[0] - LEG_TOP[0]) * t),
            sy * (LEG_TOP[1] + (LEG_BASE[1] - LEG_TOP[1]) * t), z)


LEG_TOP_Z = CELLAR - 1.5


def build_jacket(g, m, z_cut):
    levels = [z for z in JACKET_LEVELS if z >= z_cut] + ([z_cut] if z_cut > SEABED else [])
    levels = sorted(set(levels), reverse=True)
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for sx, sy in corners:
        g.tube(m["jacket"], leg_xy(sx, sy, LEG_TOP_Z), leg_xy(sx, sy, levels[-1]), LEG_R, 10)
    for i, z in enumerate(levels):
        cut = z == z_cut and z_cut > SEABED
        if cut:
            continue
        # Horizontal frame and a plan diagonal at every level
        for k in range(4):
            g.tube(m["jacket"], leg_xy(*corners[k], z), leg_xy(*corners[(k + 1) % 4], z), 0.5, 6, caps=False)
        g.tube(m["jacket"], leg_xy(1, 1, z), leg_xy(-1, -1, z), 0.4, 6, caps=False)
    for z0, z1 in zip(levels, levels[1:]):
        # X braces on all four faces, clipped at the cut so nothing pokes up
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            for (p, q) in ((leg_xy(*c0, z0), leg_xy(*c1, z1)), (leg_xy(*c1, z0), leg_xy(*c0, z1))):
                g.tube(m["jacket"], p, q, 0.45, 6, caps=False)
    # Well conductors: two rows of ten under the wellbay
    for row in range(2):
        for i in range(10):
            x = WELL_X0 + 2 + i * (WELL_X1 - WELL_X0 - 4) / 9
            y = 8.0 + row * 2.6
            g.tube(m["steel"], (x, y, levels[-1]), (x, y, MAIN), 0.45, 6, caps=False)
    # Boat landing and riser guards on the -Y face at the splash zone
    g.span(m["steel"], -8, 8, -LEG_TOP[1] - 4.5, -LEG_TOP[1] - 3.5, 2, 3)
    for x in (-6, 0, 6):
        g.tube(m["steel"], (x, -15.5, -4), (x, -15.5, CELLAR), 0.5, 6)


# --------------------------------------------------------------- topsides

def build_topsides(g, m):
    st, mod, eq = m["steel"], m["module"], m["equip"]
    xs = [-TOP_X + 12 * i for i in range(10)]  # column grid
    ys = [-TOP_Y, 0.0, TOP_Y]

    # Deck support frame on the jacket, then the three deck plates
    for sx in (1, -1):
        g.beam(st, (sx * LEG_TOP[0], -TOP_Y, CELLAR - 1), (sx * LEG_TOP[0], TOP_Y, CELLAR - 1), 2.0)
    for z, x1 in ((CELLAR, TOP_X), (MAIN, TOP_X), (UPPER, TOP_X)):
        g.span(st, -TOP_X, x1, -TOP_Y, TOP_Y, z - 1.2, z)
    for x in xs + [TOP_X]:
        for y in ys:
            g.beam(st, (x, y, CELLAR), (x, y, UPPER), 0.9)
    # Diagonal trusses in the long faces, alternate bays
    for y in (-TOP_Y, TOP_Y):
        for i, x in enumerate(xs):
            for z0, z1 in ((CELLAR, MAIN), (MAIN, UPPER)):
                a, c = ((x, y, z0), (x + 12, y, z1)) if (i + (z0 > CELLAR)) % 2 else ((x, y, z1), (x + 12, y, z0))
                g.beam(st, a, c, 0.6)

    # Cladding: some bays walled in, the rest open to show the process
    clad = {(0, 0), (1, 0), (3, 1), (4, 1), (5, 0), (6, 0), (6, 1), (7, 0), (7, 1), (8, 0), (8, 1)}
    for (i, lvl) in clad:
        z0, z1 = (CELLAR, MAIN) if lvl == 0 else (MAIN, UPPER)
        for y in (-TOP_Y - 0.3, TOP_Y + 0.3):
            g.span(mod, xs[i] + 0.5, xs[i] + 11.5, y - 0.2, y + 0.2, z0 + 0.2, z1 - 1.3)

    # Process equipment between decks: separators, scrubbers, a compressor train
    for x0, y, z, ln, r in ((-40, -8, CELLAR + 3.2, 20, 2.4), (-40, 7, CELLAR + 2.6, 16, 1.8),
                            (-12, -10, CELLAR + 3.0, 18, 2.2), (-30, -6, MAIN + 2.6, 14, 1.8)):
        g.tube(eq, (x0, y, z), (x0 + ln, y, z), r, 12)
    for x, y in ((-16, 12), (-10, 13), (4, -12), (8, -12), (12, -12)):
        g.tube(eq, (x, y, MAIN), (x, y, UPPER - 1.2), 1.4, 10)
    # Pipe racks: bundles running the length of the main deck
    for y in (-2.0, 2.0):
        for k in range(3):
            g.tube(eq, (-TOP_X + 2, y + 0.9 * k - 0.9, MAIN + 5.5), (LQ_X0 - 2, y + 0.9 * k - 0.9, MAIN + 5.5), 0.35, 6, caps=False)

    # Modules on the weather deck (x0, x1, y0, y1, height)
    for x0, x1, y0, y1, h in ((-50, -30, -17, -1, 10), (-28, -10, -17, 4, 13), (-8, 8, -17, -4, 8),
                              (-2, 12, 1, 17, 15), (14, 31, -17, 17, 8), (-50, -40, 4, 17, 6)):
        g.span(mod, x0, x1, y0, y1, UPPER, UPPER + h)
        g.span(st, x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, UPPER + h, UPPER + h + 0.6)  # roof edge
        # Louvre bands give the white boxes a little rhythm
        for z in (UPPER + h * 0.35, UPPER + h * 0.7):
            g.span(eq, x0 - 0.15, x1 + 0.15, y0 + 1, y1 - 1, z, z + 0.8)
    # HVAC stacks and exhausts on the tallest module
    for x in (1, 5, 9):
        g.tube(st, (x, 9, UPPER + 15.6), (x, 9, UPPER + 21), 0.9, 8)
    # Wellbay hatch frame (open), and the lifting rails around it
    for y in (WELL_Y0, WELL_Y1):
        g.beam(st, (WELL_X0, y, UPPER + 1.5), (WELL_X1, y, UPPER + 1.5), 0.8)
    for x in (WELL_X0, WELL_X1):
        g.beam(st, (x, WELL_Y0, UPPER + 1.5), (x, WELL_Y1, UPPER + 1.5), 0.8)
    # Lightning / vent mast mid-platform
    g.lattice(st, (-4, -10, UPPER + 8), (-4, -10, UPPER + 30), 3.0, 1.0, 3.0, 0.3)
    g.prism(m["red"], (-4, -10), 0.5, UPPER + 30, UPPER + 31, 6)


def build_quarters(g, m):
    x0, x1, y = LQ_X0, TOP_X, LQ_Y
    g.span(m["lq"], x0, x1, -y, y, CELLAR, LQ_Z1)
    floor_h = (LQ_Z1 - LQ_Z0) / LQ_FLOORS
    rng = random.Random(7)  # which cabins have the light on at night
    for f in range(LQ_FLOORS):
        z = LQ_Z0 + f * floor_h + floor_h * 0.35
        # Cabin windows on the two long sides and the end facing the sea
        for i in range(9):
            wx = x0 + 2.2 + i * (x1 - x0 - 4.4) / 8
            for yy in (-y, y):
                g.span(m["window" if rng.random() < 0.45 else "glass"], wx - 0.7, wx + 0.7, yy - 0.15, yy + 0.15, z, z + 1.3)
        for i in range(11):
            wy = -y + 2.2 + i * (2 * y - 4.4) / 10
            g.span(m["window" if rng.random() < 0.45 else "glass"], x1 - 0.15, x1 + 0.15, wy - 0.7, wy + 0.7, z, z + 1.3)
        # Floor slab lines
        g.span(m["steel"], x0 - 0.2, x1 + 0.2, -y - 0.2, y + 0.2, LQ_Z0 + f * floor_h - 0.25, LQ_Z0 + f * floor_h + 0.25)
    # Stair tower on the module side, and the roof plant
    g.span(m["lq"], x0 - 4, x0, -4, 4, UPPER, LQ_Z1 + 3)
    g.span(m["steel"], x0 + 4, x0 + 12, -6, 6, LQ_Z1, LQ_Z1 + 2.5)
    # Lifeboats on davits along the -Y side
    for x in (38, 47):
        g.tube(m["orange"], (x - 4.5, -y - 3.2, MAIN + 3.5), (x + 4.5, -y - 3.2, MAIN + 3.5), 1.7, 10)
        g.span(m["white"], x - 4, x + 4, -y - 4.5, -y - 1.9, MAIN + 4.7, MAIN + 5.4)
        for dx in (-3.5, 3.5):
            g.beam(m["steel"], (x + dx, -y, MAIN + 8), (x + dx, -y - 3.2, MAIN + 6), 0.5)
    # Helideck: octagon overhanging the +X end, trussed back to the facade
    hz, hx, r = HELI_Z, HELI_X, HELI_R
    g.prism(m["heli"], (hx, 0), r, hz - 0.6, hz, 8, math.pi / 8)
    g.ring(m["mark"], (hx, 0), r * 0.50, r * 0.58, hz + 0.03, 24)
    for c, s in (((hx - 2.5, 0, hz + 0.04), (0.8, 6, 0.04)), ((hx + 2.5, 0, hz + 0.04), (0.8, 6, 0.04)),
                 ((hx, 0, hz + 0.04), (5, 0.8, 0.04))):
        g.box(m["white"], c, s)
    g.prism(m["steel"], (hx, 0), r + 1.2, hz - 1.0, hz - 0.7, 8, math.pi / 8)  # safety net shelf
    for yy in (-8, 0, 8):
        g.beam(m["steel"], (x1, yy, LQ_Z1 - 12), (hx + 6, yy, hz - 0.6), 0.8)
        g.beam(m["steel"], (x1, yy, LQ_Z1 - 12), (x1, yy, hz - 0.6), 0.8)
    g.beam(m["steel"], (x0 + 8, 0, LQ_Z1), (x1 + 0.5, 0, hz - 0.6), 0.6)
    for i in range(8):
        a = math.pi / 8 + 2 * math.pi * i / 8
        g.prism(m["lamp"], (hx + (r - 0.3) * math.cos(a), (r - 0.3) * math.sin(a)), 0.25, hz, hz + 0.3, 6)
    # Telecom mast on the roof
    g.lattice(m["steel"], (x0 + 6, 9, LQ_Z1), (x0 + 6, 9, LQ_Z1 + 18), 2.6, 0.8, 3.0, 0.25)
    g.prism(m["red"], (x0 + 6, 9), 0.4, LQ_Z1 + 18, LQ_Z1 + 18.8, 6)
    g.prism(m["red"], (x1 - 1, y - 1), 0.4, LQ_Z1 + 0.2, LQ_Z1 + 0.9, 6)


def build_flare(g, m):
    d = Vector((-math.cos(FLARE_ANGLE), 0, math.sin(FLARE_ANGLE)))
    tip = FLARE_BASE + d * FLARE_LEN
    g.lattice(m["steel"], FLARE_BASE, tip, 6.0, 2.2, 5.0, 0.45)
    # Two back-stays down to the deck frame
    for yy in (-6, 6):
        g.beam(m["steel"], (-TOP_X, yy, UPPER), FLARE_BASE + d * 22 + Vector((0, yy * 0.25, 0)), 0.6)
    g.tube(m["steel"], tip, tip + Vector((0, 0, 4)), 0.9, 10)
    # The platform runs on power from shore, so normally only the pilot burns
    g.tube(m["flare"], tip + Vector((0, 0, 4)), tip + Vector((0, 0, 6.5)), 0.6, 8, r1=0.1)
    g.prism(m["red"], (tip.x + 1.2, 0), 0.35, tip.z + 1, tip.z + 1.7, 6)
    return tip


def build_crane(g, m, base, ped_h, yaw, luff, boom_len):
    """Pedestal crane: column, slewing house, cab and a lattice boom.
    yaw is the boom direction in plan, luff its angle above horizontal."""
    x, y, z = base
    g.prism(m["steel"], (x, y), 1.8, z, z + ped_h, 12)
    zt = z + ped_h
    fwd = Vector((math.cos(yaw), math.sin(yaw), 0))
    side = Vector((-fwd.y, fwd.x, 0))
    g.box(m["module"], Vector((x, y, zt + 2)) - fwd * 1.5, (7, 5, 4), yaw)
    g.box(m["orange"], Vector((x, y, zt + 2.5)) + fwd * 2.4 + side * 2.2, (2.2, 1.8, 2.4), yaw)
    # A-frame behind the boom foot
    top = Vector((x, y, zt + 9)) - fwd * 2.0
    for s in (-1.8, 1.8):
        g.beam(m["steel"], Vector((x, y, zt + 4)) + side * s - fwd * 4, top + side * s * 0.4, 0.5)
        g.beam(m["steel"], Vector((x, y, zt + 4)) + side * s + fwd * 0.5, top + side * s * 0.4, 0.5)
    foot = Vector((x, y, zt + 3)) + fwd * 1.5
    tip = foot + (fwd * math.cos(luff) + Vector((0, 0, math.sin(luff)))) * boom_len
    g.lattice(m["jacket"], foot, tip, 2.4, 1.0, 3.5, 0.3, roll=math.pi / 4)
    g.beam(m["steel"], top, tip, 0.12)  # luffing wire
    g.beam(m["steel"], tip, tip - Vector((0, 0, 8)), 0.08)  # hook line
    return tip


def build_cranes(g, m):
    # One boom laid in its rest along the +Y edge, one working over the -Y side
    build_crane(g, m, (-38, 15.5, UPPER), 10, 0.0, math.radians(-2), 44)
    g.beam(m["steel"], (5, 15.5, UPPER), (5, 15.5, UPPER + 12.2), 0.8)  # boom rest
    build_crane(g, m, (27, -16, UPPER), 9, math.radians(200), math.radians(32), 40)


def build_lights(g, m):
    """Deck lights every ~6 m along the edges of each deck, the night look."""
    for z in (CELLAR, MAIN, UPPER):
        zz = z + 2.6
        for i in range(19):
            x = -TOP_X + 3 + i * 6
            if z == UPPER and x > LQ_X0:
                continue
            for y in (-TOP_Y - 0.6, TOP_Y + 0.6):
                g.box(m["lamp"], (x, y, zz), (0.5, 0.3, 0.3))
        for x in (-TOP_X - 0.6,):
            for y in (-14, -7, 0, 7, 14):
                g.box(m["lamp"], (x, y, zz), (0.3, 0.5, 0.3))
    # Floodlights on top of the modules
    for x, y, z in ((-40, -9, UPPER + 10.8), (-19, -6, UPPER + 13.8), (5, 9, UPPER + 15.8), (22, 0, UPPER + 8.8)):
        g.box(m["lamp"], (x, y, z), (1.0, 1.0, 0.5))


# ---------------------------------------------------------------- jack-up

JU_C = Vector((-13.0, 64.0))  # hull centre in plan, north of the wellbay


def build_jackup(g, m, z_cut):
    """Generic harsh-environment jack-up standing beside the platform with its
    cantilever skidded out over the wellbay."""
    hz0, hz1 = 47.0, 56.0  # hull bottom/top: the drill floor clears the topsides
    cx, cy = JU_C
    hull = [(-36, -26), (36, -26), (36, 8), (14, 34), (-14, 34), (-36, 8)]
    n = len(hull)
    vs = [Vector((cx + x, cy + y, z)) for z in (hz0, hz1) for x, y in hull]
    fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    fs += [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    g.add(m["white"], vs, fs)
    # Three triangular lattice legs, well above the hull
    leg_top = hz1 + 60
    for lx, ly in ((-28, -16), (28, -16), (0, 26)):
        p = (cx + lx, cy + ly)
        g.prism(m["steel"], p, 7.5, hz1, hz1 + 5, 8)  # jack house
        g.lattice(m["jacket"], (*p, max(z_cut, SEABED)), (*p, leg_top), 12, 12, 6, 0.8, sides=3)
        if z_cut <= SEABED:
            g.prism(m["jacket"], p, 9, SEABED, SEABED + 4, 8)  # spudcan
    # Quarters block and helideck on the far end
    g.span(m["lq"], cx - 20, cx + 8, cy + 14, cy + 30, hz1, hz1 + 14)
    g.prism(m["heli"], (cx + 22, cy + 22), 11, hz1 + 17, hz1 + 17.6, 8, math.pi / 8)
    for xx in (14, 26):
        g.beam(m["steel"], (cx + xx, cy + 12, hz1), (cx + xx, cy + 20, hz1 + 17), 0.8)
    g.span(m["window"], cx - 19, cx + 7, cy + 13.8, cy + 14.1, hz1 + 5, hz1 + 6.2)
    g.span(m["window"], cx - 19, cx + 7, cy + 13.8, cy + 14.1, hz1 + 10, hz1 + 11.2)
    # Cantilever beams out over the wellbay, the drill floor and the derrick
    cy0, cy1 = WELL_Y0 + 2, cy - 4
    for xx in (-7, 7):
        g.span(m["steel"], cx + xx - 1.2, cx + xx + 1.2, cy0, cy1, hz1, hz1 + 7)
    g.span(m["module"], cx - 9, cx + 9, cy0, cy0 + 16, hz1 + 7, hz1 + 9)  # drill floor
    g.span(m["module"], cx - 9, cx + 9, cy0 + 16, cy0 + 30, hz1 + 7, hz1 + 15)  # pipe deck / mud
    fc = Vector((cx, cy0 + 8, hz1 + 9))
    g.lattice(m["white"], fc, fc + Vector((0, 0, 52)), 12, 3.5, 6.5, 0.45)
    g.prism(m["red"], (fc.x, fc.y), 0.5, fc.z + 52, fc.z + 53, 6)
    # Its own deck crane and edge lights
    build_crane(g, m, (cx + 32, cy - 22, hz1), 6, math.radians(150), math.radians(25), 34)
    for x, y in hull:
        g.box(m["lamp"], (cx + x * 1.01, cy + y * 1.01, hz1 + 1), (0.6, 0.6, 0.4))
    for lx, ly in ((-28, -16), (28, -16), (0, 26)):
        g.prism(m["red"], (cx + lx, cy + ly), 0.6, leg_top, leg_top + 1, 6)


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
    for c in (above, full):
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
        for c in (above, full):
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

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "platform.blend"))


if __name__ == "__main__":
    main()
