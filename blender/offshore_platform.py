"""
Medium-detail model of a North Sea PDQ platform (production, drilling,
quarters), traced from reference views of a scale model and public figures
(~110 m water, a 108 x 38 m topsides, ~230 m from seabed to flare tip).

Reading the topsides from the flare end (-X) to the quarters end (+X):

  * a tall corner shaft, then the process block: two open-framed storeys
    (cellar and mezzanine) with an open-framed process module on top, all
    behind white bracing;
  * a lower open deck in the middle, the laydown area over the wellbay;
  * a grey stair tower with the big yellow pedestal crane on top, its white
    and red boom swung out over the process end;
  * a clad utility module carrying the quarters (white, six rows of cabin
    windows, stepped plant on the roof, an exhaust lattice tower);
  * a full-height end tower, and the helideck overhanging the end on struts.

The jacket is slender: four legs with a gentle batter in seven equal X-braced
bays, sitting toward the flare end under the much wider topsides. The flare
boom is a deep, tapering pair of Warren trusses rising from the process end.
Equipment and facade details are invented.

    python blender/offshore_platform.py                     # preview stills
    python blender/offshore_platform.py --samples 16        # faster, noisier
    python blender/offshore_platform.py --jackup            # also the jack-up rig

Everything is merged into one mesh per material, so the whole platform costs
one draw call per material in the browser, and it uses no textures at all:
flat colours plus emissive deck lights for night. Origin is mean sea level at
the topsides centre; +X runs from the flare end to the quarters end, and -Y
is the side with the crane and the lifeboats.

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
DECK_BOT, CELLAR = 22.0, 24.5          # underside and top of the cellar deck plate
MEZZ, LOWER_TOP = 30.5, 36.5           # open storeys of the process block
PROC_TOP = 57.5                         # process module roof
NOTCH_TOP = 46.0                        # middle laydown deck, also the crane's footing
UTIL_TOP, LQ_TOP = 49.5, 72.5           # utility module roof = quarters floor; quarters roof
TOP_X, TOP_Y = 54.0, 19.0               # topsides half extents: 108 x 38 m

# Along X
PROC_X1 = -20.0                         # process module ends, laydown deck begins
STAIR_X0, STAIR_X1 = -6.0, 3.0          # stair tower under the crane
LQ_X0, LQ_X1, LQ_Y = 18.0, 45.0, 16.0   # quarters block
END_X0 = 45.0                           # end tower, full height

# Jacket: centred toward the flare end, legs battered from +-14 m to +-27 m
JACKET_X = -5.0
LEG_TOP, LEG_BASE, LEG_R = (14.0, 14.0), (27.0, 27.0), 1.3
JACKET_BAYS = 7

# Helideck: octagon overhanging the quarters end at roof height
HELI_Z, HELI_R, HELI_X = 72.5, 14.5, 68.5

# Flare boom: two Warren trusses, deep at the root, meeting at the tip
FLARE_ROOT_TOP, FLARE_ROOT_BOT = Vector((-TOP_X, 0, 47.0)), Vector((-TOP_X, 0, 26.0))
FLARE_TIP = Vector((-110.0, 0, 88.0))

# Wellbay under the laydown deck, inside the jacket
WELL_X0, WELL_X1, WELL_Y0, WELL_Y1 = -15.0, -3.0, -5.0, 5.0


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
    def emit(name, color, strength, base=None):
        m, _, bsdf = b._new_mat(name)
        bsdf.inputs["Base Color"].default_value = (*(base or color), 1)
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        return m

    return {
        "jacket": b.mat_flat("PlatJacket", (0.30, 0.31, 0.02), 0.6),     # yellow-green steel
        "crane": b.mat_flat("PlatCrane", (0.72, 0.62, 0.01), 0.5),
        "steel": b.mat_flat("PlatSteel", (0.28, 0.29, 0.30), 0.6),        # deck plates, flare boom
        "module": b.mat_flat("PlatModule", (0.30, 0.31, 0.32), 0.7),      # clad module walls
        "interior": b.mat_flat("PlatInterior", (0.10, 0.105, 0.11), 0.8),  # inside the open-framed modules
        "dark": b.mat_flat("PlatDark", (0.18, 0.19, 0.20), 0.6),          # stair tower, cab glass
        "brown": b.mat_flat("PlatBrown", (0.30, 0.13, 0.08), 0.6),        # exhaust duct, containers
        "lq": b.mat_flat("PlatQuarters", (0.58, 0.59, 0.60), 0.6),
        "boat": b.mat_flat("PlatBoat", (0.80, 0.33, 0.06), 0.5),          # free-fall lifeboat
        "glass": b.mat_flat("PlatGlass", (0.04, 0.05, 0.06), 0.2),
        "equip": b.mat_flat("PlatEquip", (0.30, 0.38, 0.42), 0.5),        # vessels, pipework
        "heli": b.mat_flat("PlatHelideck", (0.25, 0.26, 0.27), 0.8),
        "mark": b.mat_flat("PlatMarking", (0.85, 0.75, 0.10), 0.7),
        "white": b.mat_flat("PlatWhite", (0.80, 0.80, 0.80), 0.7),
        "orange": b.mat_flat("PlatOrange", (0.75, 0.06, 0.04), 0.5),      # lifeboats, crane boom bands
        "lamp": emit("PlatLamp", (1.0, 0.78, 0.45), 0.0),                   # deck lights, off by day
        "window": emit("PlatWindow", (1.0, 0.85, 0.6), 0.0, base=(0.04, 0.05, 0.06)),
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


# Brace patterns per panel: X, the two single diagonals, a K (chevron) and empty
PATTERNS = "X/\\K "


def facade(g, m, plane, out, u0, u1, z0, z1, nu, nz, pattern=None, seed=0, w=0.55, skip=""):
    """White bracing grid standing just proud of a face: posts, a beam at
    every storey and one brace pattern per panel. pattern is a string with
    one character per panel, row by row from the bottom; otherwise random.
    skip "b" and/or "l" drops the bottom beam / first post where a facade
    stacks on or abuts another (coincident beams render black)."""
    P = _plane(plane, out)
    us = [u0 + (u1 - u0) * i / nu for i in range(nu + 1)]
    zs = [z0 + (z1 - z0) * j / nz for j in range(nz + 1)]
    wm, off = m["white"], 0.4
    for u in us[1:] if "l" in skip else us:
        g.beam(wm, P(u, z0, off), P(u, z1, off), w)
    for z in zs[1:] if "b" in skip else zs:
        g.beam(wm, P(u0, z, off), P(u1, z, off), w)
    rng = random.Random(seed)
    for j in range(nz):
        for i in range(nu):
            k = pattern[(j * nu + i) % len(pattern)] if pattern else rng.choice("XX//\\\\K")
            a, c = us[i], us[i + 1]
            lo, hi = zs[j], zs[j + 1]
            if k in "X/":
                g.beam(wm, P(a, lo, off), P(c, hi, off), w * 0.8)
            if k in "X\\":
                g.beam(wm, P(a, hi, off), P(c, lo, off), w * 0.8)
            if k == "K":
                mid = (a + c) / 2
                g.beam(wm, P(a, lo, off), P(mid, hi, off), w * 0.8)
                g.beam(wm, P(c, lo, off), P(mid, hi, off), w * 0.8)


def open_module(g, m, x0, x1, y0, y1, z0, z1, floors, nu, sides="-+", ends="", seed=0, pattern=None, skip=""):
    """Open-framed module: a dark core set back from the faces, a floor slab
    at every storey showing as a grey band, and white bracing on the chosen
    faces ("-+" = the -Y and +Y sides, "-+" in ends = the -X and +X ends)."""
    inset = 1.6
    g.span(m["interior"], x0 + (inset if "-" in ends else 0), x1 - (inset if "+" in ends else 0),
           y0 + (inset if "-" in sides else 0), y1 - (inset if "+" in sides else 0), z0, z1)
    zs = [z0 + (z1 - z0) * j / floors for j in range(floors + 1)]
    for z in zs[1:]:
        g.span(m["module"], x0, x1, y0, y1, z - 0.7, z)
    for s, y in (("-", y0), ("+", y1)):
        if s in sides:
            facade(g, m, ("y", y), -1 if s == "-" else 1, x0, x1, z0, z1, nu, floors, pattern, seed + (s == "+"), skip=skip)
    nv = max(1, round((y1 - y0) / 8))
    for s, x in (("-", x0), ("+", x1)):
        if s in ends:
            facade(g, m, ("x", x), -1 if s == "-" else 1, y0, y1, z0, z1, nv, floors, None, seed + 2 + (s == "+"),
                   skip=skip.replace("l", ""))


def lattice_box(g, mat, x, y, z, sx, sy, sz, w=0.25):
    """Open steel frame box, for the cooler frames on the module roofs."""
    c = [Vector((x + dx * sx / 2, y + dy * sy / 2, z + dz * sz)) for dz in (0, 1) for dy in (-1, 1) for dx in (-1, 1)]
    for a, b2 in ((0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7), (0, 5), (2, 7)):
        g.beam(mat, c[a], c[b2], w)


# ----------------------------------------------------------------- jacket

def leg_xy(sx, sy, z):
    """Leg centre at height z: linear batter from the deck to the seabed."""
    t = (DECK_BOT - z) / (DECK_BOT - SEABED)
    return (JACKET_X + sx * (LEG_TOP[0] + (LEG_BASE[0] - LEG_TOP[0]) * t),
            sy * (LEG_TOP[1] + (LEG_BASE[1] - LEG_TOP[1]) * t), z)


def build_jacket(g, m, z_cut):
    full = [DECK_BOT - 1.5 - (DECK_BOT - 1.5 - SEABED) * i / JACKET_BAYS for i in range(JACKET_BAYS + 1)]
    levels = [z for z in full if z >= z_cut]
    bottom = max(z_cut, SEABED)
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    jm = m["jacket"]
    for sx, sy in corners:
        g.tube(jm, leg_xy(sx, sy, DECK_BOT), leg_xy(sx, sy, bottom), LEG_R, 8)
        if z_cut <= SEABED:  # mudmats and pile sleeves on the seabed
            x, y, _ = leg_xy(sx, sy, SEABED)
            g.box(jm, (x, y, SEABED + 1.0), (7, 7, 2))
            g.prism(jm, (x, y), 2.2, SEABED + 2, SEABED + 7, 8)
    for z in levels:
        for k in range(4):
            g.tube(jm, leg_xy(*corners[k], z), leg_xy(*corners[(k + 1) % 4], z), 0.55, 6, caps=False)
    # X braces in every bay on all four faces, clipped where the jacket is cut
    for z0, z1 in zip(full, full[1:]):
        if z0 <= bottom:
            break
        frac = min(1.0, (z0 - bottom) / (z0 - z1))
        for k in range(4):
            c0, c1 = corners[k], corners[(k + 1) % 4]
            for p, q in ((c0, c1), (c1, c0)):
                a, e = Vector(leg_xy(*p, z0)), Vector(leg_xy(*q, z1))
                g.tube(jm, a, a.lerp(e, frac), 0.5, 6, caps=False)
    # Well conductors: 4 x 5 slots under the wellbay, straight down
    for i in range(5):
        for j in range(4):
            x = WELL_X0 + 2 + i * (WELL_X1 - WELL_X0 - 4) / 4
            y = WELL_Y0 + 2 + j * (WELL_Y1 - WELL_Y0 - 4) / 3
            g.tube(m["white"], (x, y, bottom), (x, y, CELLAR), 0.4, 5, caps=False)
    # Riser guards and a boat landing on the -Y face at the splash zone
    for x in (-1, 3):
        g.tube(m["steel"], (JACKET_X + x, -15.2, -4), (JACKET_X + x, -15.2, DECK_BOT), 0.5, 6)
    g.span(m["steel"], JACKET_X - 6, JACKET_X + 6, -18.5, -17.5, 2, 3)


# --------------------------------------------------------------- topsides

def build_topsides(g, m):
    st, mod = m["steel"], m["module"]
    # Cellar deck plate: a thick grey band under the whole topsides
    g.span(st, -TOP_X, TOP_X, -TOP_Y, TOP_Y, DECK_BOT, CELLAR)

    # Process block, lower two open storeys from the corner shaft to the stair tower
    open_module(g, m, -TOP_X, STAIR_X0, -TOP_Y, TOP_Y, CELLAR, LOWER_TOP, 2, 7, ends="-", seed=1,
                pattern="KXK/XK\\" + "X/X\\X/X")
    # Walkway gallery along the -Y side at mezzanine level, with its rail
    g.span(mod, -TOP_X + 8, STAIR_X0, -TOP_Y - 2.2, -TOP_Y, MEZZ - 0.5, MEZZ)
    g.beam(m["white"], (-TOP_X + 8, -TOP_Y - 2.1, MEZZ + 1.1), (STAIR_X0, -TOP_Y - 2.1, MEZZ + 1.1), 0.15)
    # Process module on top: three open storeys, braced on every face
    open_module(g, m, -TOP_X, PROC_X1, -TOP_Y, TOP_Y, LOWER_TOP, PROC_TOP, 3, 4, ends="-+", seed=3,
                pattern="X\\X/" "/X\\K" "XKX\\", skip="b")
    g.span(st, -TOP_X - 0.3, PROC_X1 + 0.3, -TOP_Y - 0.3, TOP_Y + 0.3, PROC_TOP, PROC_TOP + 0.6)
    # Corner shaft at the flare end (stairs / HVAC), a little taller than the module
    g.span(mod, -TOP_X - 0.5, -TOP_X + 6, -TOP_Y - 0.5, -TOP_Y + 8, DECK_BOT, PROC_TOP + 3.5)
    # Roof: cooler frames, two red skids, small tanks and a vent at the far corner
    for x, y in ((-44, -10), (-37, -10), (-30, -10), (-44, -2)):
        lattice_box(g, m["white"], x, y, PROC_TOP + 0.6, 6, 6, 3.2)
    for x, y in ((-33, 2), (-27, 9)):
        g.box(m["orange"], (x, y, PROC_TOP + 1.6), (4, 2.5, 2))
    for y in (-15.5, -12.5):
        g.tube(m["module"], (-50, y, PROC_TOP + 2), (-46, y, PROC_TOP + 2), 1.2, 8)
    g.tube(m["white"], (-23, 15, PROC_TOP), (-23, 15, PROC_TOP + 7), 1.0, 10)
    g.span(m["white"], -26, -22, 9, 13, PROC_TOP, PROC_TOP + 5)

    # Laydown deck: one more open storey over the wellbay, containers on top
    open_module(g, m, PROC_X1, STAIR_X0, -TOP_Y, TOP_Y, LOWER_TOP, NOTCH_TOP, 1, 2, seed=5, pattern="KX", skip="bl")
    g.span(st, PROC_X1, STAIR_X0, -TOP_Y - 0.3, TOP_Y + 0.3, NOTCH_TOP, NOTCH_TOP + 0.5)
    for x, y, sx, sy, sz, c in ((-17, -11, 6, 4, 3.5, "module"), (-12, -15, 6, 2.5, 2.6, "brown"),
                                (-12, 12, 6, 2.5, 2.6, "orange"), (-17, 6, 3, 3, 2.6, "brown")):
        g.box(m[c], (x, y, NOTCH_TOP + 0.5 + sz / 2), (sx, sy, sz))
    for y in (WELL_Y0, WELL_Y1):  # wellbay hatch frame
        g.beam(st, (WELL_X0, y, NOTCH_TOP + 1), (WELL_X1, y, NOTCH_TOP + 1), 0.6)

    # Stair tower on the -Y side with the crane on top, a taller grey block behind it
    g.span(m["dark"], STAIR_X0 + 0.1, STAIR_X1, -TOP_Y - 0.25, -9, DECK_BOT - 0.1, NOTCH_TOP)
    g.span(mod, STAIR_X0 + 0.1, STAIR_X1 + 3, -9, TOP_Y - 0.2, CELLAR + 0.05, PROC_TOP)
    for z in (28, 34, 40):
        rect(g, m["glass"], ("y", -TOP_Y), -1, STAIR_X0 + 3, STAIR_X0 + 5, z, z + 2)

    # Utility module under the quarters: clad grey, two big braced bays per side
    x0, x1 = STAIR_X1, END_X0
    g.span(mod, x0, x1, -TOP_Y + 0.1, TOP_Y - 0.1, CELLAR + 0.05, UTIL_TOP)
    facade(g, m, ("y", -TOP_Y), -1, x0, x0 + 34, CELLAR, UTIL_TOP - 2, 2, 2, "X/KX")
    facade(g, m, ("y", TOP_Y), 1, x0 + 3, x1, CELLAR, UTIL_TOP - 2, 3, 2, "X\\XK/X")
    rect(g, m["mark"], ("y", -TOP_Y), -1, 27, 34, 28, 32.5, 0.6)  # the yellow name board
    # Ledge at the foot of the quarters, sticking out on the -Y side
    g.span(m["white"], x0 + 0.05, END_X0 - 0.05, -TOP_Y - 1.5, TOP_Y + 0.25, UTIL_TOP - 0.6, UTIL_TOP + 0.08)


def build_quarters(g, m):
    x0, x1, y = LQ_X0, LQ_X1, LQ_Y
    g.span(m["lq"], x0, x1, -y, y, UTIL_TOP, LQ_TOP)
    # Stepped plant/stair blocks on the crane side of the quarters
    # (stacked, not overlapping: coincident faces render black and z-fight on the web)
    z0 = UTIL_TOP + 0.08
    for (a, z1) in ((STAIR_X1 + 3, 59.5), (STAIR_X1 + 7, 65.0), (STAIR_X1 + 11, 69.0)):
        g.span(m["module"], a, x0 + 0.3, -y, y - 4, z0, z1)
        z0 = z1
    # End tower: full height, from under the deck to the roof
    g.span(m["lq"], END_X0, TOP_X + 0.3, -TOP_Y - 0.25, TOP_Y + 0.25, DECK_BOT - 2, LQ_TOP + 1)
    # Lower sponson under the end with the free-fall lifeboat on its skid
    g.span(m["module"], END_X0 + 1, TOP_X + 2, -9, 9, DECK_BOT - 8, DECK_BOT)
    g.beam(m["boat"], (TOP_X + 1, 0, DECK_BOT - 2), (TOP_X + 9, 0, DECK_BOT - 7), 3.0, 3.2)
    # Cabin windows: six rows on the -Y face in pairs, fewer on the ends
    rows = 6
    fh = (LQ_TOP - UTIL_TOP - 2) / rows
    rng = random.Random(7)  # which cabins have the light on at night
    cols = [x0 + 2.0 + i * 3.1 for i in range(8)]
    for f in range(rows):
        z = UTIL_TOP + 1.5 + f * fh + 0.6
        for wx in cols:
            mat = m["window" if rng.random() < 0.4 else "glass"]
            rect(g, mat, ("y", -y), -1, wx, wx + 1.3, z, z + 1.8)
        if f >= 3:  # above the stepped blocks
            for wy in (-10, -6, 6, 10):
                rect(g, m["window" if rng.random() < 0.4 else "glass"], ("x", x0), -1, wy, wy + 1.3, z, z + 1.8)
    # +Y face: plain, with the white cage of the external escape stair
    facade(g, m, ("y", y), 1, x0 + 2, x0 + 14, UTIL_TOP, LQ_TOP, 3, 6, "|", w=0.4)
    for f in range(rows):
        z = UTIL_TOP + 1.5 + f * fh + 0.6
        for wx in (x0 + 17, x0 + 21):
            rect(g, m["window" if rng.random() < 0.4 else "glass"], ("y", y), 1, wx, wx + 1.3, z, z + 1.8)
    # Lifeboats: two red boats side by side at the foot of the -Y face
    for x in (30.5, 35.0):
        g.box(m["orange"], (x, -TOP_Y - 0.4, UTIL_TOP + 1.3), (4.0, 2.4, 2.6))
    # Roof plant: a stepped grey mass at the back, two radomes, a skid
    g.span(m["module"], 24, 40, 0, 15, LQ_TOP, LQ_TOP + 4)
    g.span(m["module"], 30, 40, 6, 15, LQ_TOP + 4, LQ_TOP + 7)
    g.span(m["module"], 20, 27, -14, -8, LQ_TOP, LQ_TOP + 2.5)
    for xx in (37, 41):
        g.tube(m["white"], (xx, -8, LQ_TOP), (xx, -8, LQ_TOP + 2.4), 1.6, 8, r1=1.0)
    # Exhaust: a white lattice tower with a dark stack, fed by a brown duct
    g.lattice(m["white"], (30, 10, LQ_TOP + 7), (30, 10, LQ_TOP + 17), 3.6, 3.0, 3.4, 0.25)
    g.tube(m["dark"], (30, 10, LQ_TOP + 15), (30, 10, LQ_TOP + 19.5), 0.9, 8)
    g.tube(m["brown"], (21, 4, NOTCH_TOP + 8), (21, 4, LQ_TOP + 9), 0.9, 8)
    g.tube(m["brown"], (21, 4, LQ_TOP + 9), (29, 10, LQ_TOP + 12), 0.9, 8)
    g.prism(m["red"], (30, 10), 0.4, LQ_TOP + 19.5, LQ_TOP + 20.3, 6)
    # A second, smaller lattice mast on the stepped block
    g.lattice(m["white"], (13, -6, 69.0), (13, -6, 78.0), 2.4, 1.6, 3.0, 0.2)
    g.prism(m["red"], (TOP_X - 1, -TOP_Y + 1), 0.4, LQ_TOP + 1.2, LQ_TOP + 1.9, 6)

    # Helideck: grey octagon level with the roof, overhanging the end on struts
    hz, hx, r = HELI_Z, HELI_X, HELI_R
    g.prism(m["heli"], (hx, 0), r, hz - 1.2, hz, 8, math.pi / 8)
    g.prism(m["steel"], (hx, 0), r + 1.3, hz - 1.6, hz - 1.3, 8, math.pi / 8)  # safety net shelf
    g.ring(m["mark"], (hx, 0), r * 0.42, r * 0.50, hz + 0.03, 20)
    for c, s in (((hx, -2.0, hz + 0.04), (5.0, 0.8, 0.04)), ((hx, 2.0, hz + 0.04), (5.0, 0.8, 0.04)),
                 ((hx, 0, hz + 0.04), (0.8, 4.0, 0.04))):
        g.box(m["white"], c, s)
    g.box(m["dark"], (hx + r * 0.8, 0, hz + 0.04), (1.2, 6, 0.06))  # name panel
    for yy in (-9, 9):
        g.beam(m["white"], (TOP_X, yy, 46), (hx + r - 2, yy * 0.8, hz - 1.6), 0.8)
        g.beam(m["white"], (TOP_X, yy, 46), (hx - 4, yy * 0.9, hz - 1.6), 0.7)
    g.beam(m["white"], (TOP_X, 0, 52), (hx + 6, 0, hz - 1.6), 0.7)
    for i in range(8):
        a = math.pi / 8 + 2 * math.pi * i / 8
        g.prism(m["lamp"], (hx + (r - 0.3) * math.cos(a), (r - 0.3) * math.sin(a)), 0.25, hz, hz + 0.3, 6)


def truss_plane(g, mat, top0, top1, bot0, bot1, n, w):
    """Planar Warren truss between a top and a bottom chord, n bays."""
    g.beam(mat, top0, top1, w)
    g.beam(mat, bot0, bot1, w)
    for i in range(n + 1):
        t = i / n
        p_top, p_bot = top0.lerp(top1, t), bot0.lerp(bot1, t)
        if i < n:
            q_bot = bot0.lerp(bot1, (i + 1) / n)
            q_top = top0.lerp(top1, (i + 1) / n)
            g.beam(mat, p_top, q_bot, w * 0.7) if i % 2 == 0 else g.beam(mat, p_bot, q_top, w * 0.7)
        if i in (0, n) or i % 2 == 0:
            g.beam(mat, p_top, p_bot, w * 0.6)


def build_flare(g, m):
    """Flare boom: two Warren trusses, deep at the process end and meeting
    at the tip, cross-tied every other panel; a platform and burner on top."""
    st = m["steel"]
    n = 8
    half0, half1 = 3.0, 1.4
    planes = []
    for s in (-1, 1):
        t0 = FLARE_ROOT_TOP + Vector((0, s * half0, 0))
        b0 = FLARE_ROOT_BOT + Vector((0, s * half0, 0))
        t1 = FLARE_TIP + Vector((0, s * half1, 0))
        b1 = FLARE_TIP + Vector((1.5, s * half1, -2.5))
        truss_plane(g, st, t0, t1, b0, b1, n, 1.5)
        planes.append((t0, t1, b0, b1))
    (ta0, ta1, ba0, ba1), (tb0, tb1, bb0, bb1) = planes
    for i in range(0, n + 1, 2):
        t = i / n
        g.beam(st, ta0.lerp(ta1, t), tb0.lerp(tb1, t), 0.8)
        g.beam(st, ba0.lerp(ba1, t), bb0.lerp(bb1, t), 0.8)
    tip = FLARE_TIP
    g.box(st, tip + Vector((-2, 0, 0.6)), (12, 8, 1.2))
    g.box(m["module"], tip + Vector((-2.5, 0, 2.6)), (5, 5, 2.8))
    g.tube(m["dark"], tip + Vector((-2.5, 0, 4)), tip + Vector((-2.5, 0, 6)), 0.7, 8)
    # The platform runs on power from shore, so normally only the pilot burns
    g.tube(m["flare"], tip + Vector((-2.5, 0, 6)), tip + Vector((-2.5, 0, 8)), 0.5, 6, r1=0.1)
    g.prism(m["red"], (tip.x - 7.5, 3.5), 0.35, tip.z + 1.2, tip.z + 1.9, 6)
    return tip


def build_crane(g, m, base, ped_h, yaw, luff, boom_len, bands=True):
    """Pedestal crane after the reference: tall yellow column with a collar,
    slewing house, a single tall gantry mast, and a white lattice boom with
    two red bands. yaw is the boom direction in plan, luff its angle above
    horizontal (negative dips toward the tip)."""
    x, y, z = base
    cr = m["crane"]
    zt = z + ped_h
    g.prism(cr, (x, y), 2.3, z, zt - 6, 10)
    g.prism(cr, (x, y), 3.9, zt - 6, zt - 4.8, 10)          # collar
    g.prism(cr, (x, y), 1.9, zt - 4.8, zt, 10)
    fwd = Vector((math.cos(yaw), math.sin(yaw), 0))
    side = Vector((-fwd.y, fwd.x, 0))
    g.box(cr, Vector((x, y, zt + 2.2)) - fwd * 1.0, (8, 6, 4.4), yaw)
    g.box(cr, Vector((x, y, zt + 2.6)) + fwd * 3.4 + side * 3.0, (3.0, 2.0, 2.8), yaw)  # cab
    g.box(m["dark"], Vector((x, y, zt + 2.8)) + fwd * 4.95 + side * 3.0, (0.1, 1.8, 1.6), yaw)  # cab glass
    mast_top = Vector((x, y, zt + 16)) - fwd * 1.5
    g.beam(cr, Vector((x, y, zt + 4.4)) - fwd * 1.5, mast_top, 1.1)
    g.beam(cr, Vector((x, y, zt + 4.4)) - fwd * 4.5, mast_top, 0.6)  # back stay
    foot = Vector((x, y, zt + 2.5)) + fwd * 3.0
    dirv = fwd * math.cos(luff) + Vector((0, 0, math.sin(luff)))
    tip = foot + dirv * boom_len
    g.lattice(m["white"], foot, tip, 3.2, 1.2, 4.2, 0.3, roll=math.pi / 4)
    if bands:  # red sections as on the reference boom
        for t0, t1 in ((0.19, 0.37), (0.64, 0.82)):
            g.lattice(m["orange"], foot + dirv * boom_len * t0, foot + dirv * boom_len * t1,
                      3.2 - 2.0 * t0 + 0.12, 3.2 - 2.0 * t1 + 0.12, 3.0, 0.34, roll=math.pi / 4)
    g.beam(m["steel"], mast_top, tip, 0.12)                  # luffing wire
    g.beam(m["steel"], mast_top, foot + dirv * boom_len * 0.55, 0.1)
    g.prism(m["red"], (mast_top.x, mast_top.y), 0.3, mast_top.z, mast_top.z + 0.6, 6)
    return tip


def build_cranes(g, m):
    # The big crane on the stair tower, boom swung out over the process end
    build_crane(g, m, ((STAIR_X0 + STAIR_X1) / 2, -14, NOTCH_TOP), 22, math.radians(180), math.radians(-6), 58)


def build_lights(g, m):
    """Deck lights every ~9 m along the edges of each storey, the night look."""
    for z in (CELLAR, MEZZ, LOWER_TOP):
        for i in range(12):
            x = -TOP_X + 4 + i * 9
            if x > END_X0:
                continue
            for y in (-TOP_Y - 0.8, TOP_Y + 0.8):
                g.box(m["lamp"], (x, y, z + 2.4), (0.5, 0.3, 0.3))
        for y in (-12, 0, 12):
            g.box(m["lamp"], (-TOP_X - 0.8, y, z + 2.4), (0.3, 0.5, 0.3))
    for x, y, z in ((-40, 6, PROC_TOP + 1), (-14, 0, NOTCH_TOP + 5), (8, -10, UTIL_TOP + 1)):
        g.box(m["lamp"], (x, y, z), (1.0, 1.0, 0.5))  # floodlights


# ---------------------------------------------------------------- jack-up

JU_C = Vector(((WELL_X0 + WELL_X1) / 2, 64.0))  # hull centre in plan, beside the wellbay


def build_jackup(g, m, z_cut):
    """Generic harsh-environment jack-up standing beside the platform with its
    cantilever skidded out over the wellbay."""
    hz0, hz1 = 60.0, 69.0  # hull bottom/top: the cantilever clears the process module
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


def cull_to_view(objs, eyes, samples=3):
    """Delete every face no eye can see: the far side, module interiors,
    hidden equipment. A face stays if a ray from any eye to its centre or to
    a point near one of its corners hits that face first. Give several eyes
    spread over the window so parallax as the player moves is covered.
    Returns the triangles left."""
    import bmesh
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    eyes = [Vector(e) for e in eyes]
    left = 0
    for o in objs:
        me = o.data
        keep = set()
        for p in me.polygons:
            ctr = o.matrix_world @ p.center
            pts = [ctr] + [ctr.lerp(o.matrix_world @ me.vertices[v].co, 0.8) for v in p.vertices[:samples]]
            for eye, pt in ((e, q) for e in eyes for q in pts):
                d = pt - eye
                hit, loc, _, idx, hob, _ = scene.ray_cast(dg, eye, d.normalized(), distance=d.length + 0.05)
                if hit and hob.name == o.name and idx == p.index:
                    keep.add(p.index)
                    break
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
        bm.to_mesh(me)
        bm.free()
        left += sum(len(p.vertices) - 2 for p in me.polygons)
    return left


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
    shot(cam("Model", (300, -360, 10), (-5, 0, -5), 35), "scale-model", w * 9 // 16, w)
    # Full height in colour on a pale studio background, from the reference angles
    bg.inputs["Color"].default_value = (0.75, 0.80, 0.88, 1)
    bg.inputs["Strength"].default_value = 1.1
    sun_d.energy = 1.6
    set_night(m, False)
    show(whole)
    # Cameras placed to match the reference views of the full model
    for name, loc, aim, lens in (("full-side", (25, -430, 10), (0, 0, -5), 35),
                                 ("full-high", (60, -330, 200), (0, 0, 0), 35),
                                 ("full-back", (-40, 340, 215), (0, 0, 0), 35),
                                 ("full-flare", (-250, 260, 200), (-5, 0, 0), 35)):
        shot(cam(name, loc, aim, lens), name, w, w * 9 // 16)
    show(whole)
    for name, loc, aim, lens in (("close-side", (5, -260, 50), (5, 0, 52), 50),
                                 ("close-high", (60, -170, 140), (5, 0, 50), 45),
                                 ("close-back", (-30, 180, 150), (5, 0, 50), 45)):
        shot(cam(name, loc, aim, lens), name, w, w * 9 // 16)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "platform.blend"))


if __name__ == "__main__":
    main()
