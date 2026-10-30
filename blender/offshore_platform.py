"""
Medium-detail model of a North Sea PDQ platform (production,
drilling, quarters), traced from reference views of a scale model and public figures
(~110 m water, a 108 x 38 m topsides, ~230 m from seabed to flare tip),
with heights checked against a long-lens side photo.

Reading the topsides from the flare end (-X) to the quarters end (+X):

  * a tall corner shaft, then the process block: two open-framed storeys
    (cellar and mezzanine) with an open-framed process module on top, all
    behind white bracing;
  * a lower open deck in the middle, the laydown area over the wellbay;
  * a grey stair tower with the big yellow pedestal crane on top, its white
    and red boom swung out over the process end;
  * a clad plant module, a little taller than its neighbours, with the
    exhaust stacks and a white lattice tower on top, and the yellow name
    board on its crane side (two more on the far side);
  * the quarters over the utility module, roof level with the process roof,
    six rows of cabin windows;
  * a full-height end tower with two free-fall lifeboats on its face, and
    the helideck overhanging the end on a deep truss.

The jacket is sturdy: four legs with a slight batter and X-braced bays,
sitting toward the flare end under the wider topsides, with bundles of
conductors and risers inside. The flare boom is a long, steep, tapering pair
of Warren trusses rising from the process end.
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
import platform_textures as tex  # noqa: E402

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402

# Heights above sea level (metres)
SEABED = -112.0
DECK_BOT, CELLAR = 22.0, 24.5          # underside and top of the cellar deck plate
MEZZ, LOWER_TOP = 31.5, 39.5           # open storeys of the process block
PROC_TOP = 52.5                         # process module roof
NOTCH_TOP = LOWER_TOP + 0.5             # laydown deck over the lower block, also the crane's footing
UTIL_TOP, LQ_TOP = 32.0, 56.0           # utility module roof = quarters floor; quarters roof
PLANT_TOP = 57.0                        # clad plant module between the crane and the quarters
TOP_X, TOP_Y = 54.0, 19.0               # topsides half extents: 108 x 38 m

# Along X
PROC_X1 = -17.5                         # process module ends, laydown deck begins
STAIR_X0, STAIR_X1 = 0.0, 8.0           # stair tower under the crane
LQ_X0, LQ_X1, LQ_Y = 31.0, 49.0, 18.5   # quarters block
END_X0 = 49.0                           # end tower, full height

# Jacket: centred toward the flare end, four sturdy legs with a slight batter
JACKET_X = -4.5
LEG_TOP, LEG_BASE, LEG_R = (19.5, 16.0), (24.0, 21.0), 1.5
JACKET_LEVELS = (20.5, 16.0, 6.0, -14.0, -38.0, -62.0, -87.0, SEABED)  # horizontal frames

# Which quarters end goes in the scene, kept as a library:
#   "terraced"  lower storeys stepped out with a terrace, an open steel end
#               frame between two corner columns, the helideck on a real truss
#   "box"       the same massing as before with the end frame and the
#               helideck truss painted on (fewer triangles)
#   "v5"        the plain block of PR #43
QUARTERS = "terraced"

# Night lighting, kept as a library:
#   "dense"   fittings every ~4.5 m on every storey, under the deck, roof
#             edges and stair landings, as on the night and fog photos
#   "sparse"  every ~9 m on three storeys (until 2026-10-22)
LIGHTS = "dense"

# Helideck: octagon on a deep truss, overhanging the quarters end at roof height
HELI_Z, HELI_R, HELI_X = 57.5, 11.5, 65.5

# Flare boom: two Warren trusses, deep at the root, meeting at the tip
FLARE_ROOT_TOP, FLARE_ROOT_BOT = Vector((-TOP_X, 0, 52.0)), Vector((-TOP_X + 3, 0, 25.0))
FLARE_TIP = Vector((-96.0, 0, 115.0))

# The crane pedestal, between the laydown deck and the plant module
CRANE_X, CRANE_Y = 5.0, -13.0           # on the stair tower
CRANE_RING = 61.6                       # top of its slewing ring: the pivot of the part that turns
CRANE_BOOM = 61.0                       # boom length, level when stowed
CRANE_SLEW = "CraneSlew"                # that part's object name with build_platform(crane_slew=True)

# Wellbay under the laydown deck, inside the jacket
WELL_X0, WELL_X1, WELL_Y0, WELL_Y1 = -15.0, -3.0, -5.0, 5.0


# ----------------------------------------------------------- mesh builder

class Mesh:
    """Collects geometry per material and turns each into one object."""

    def __init__(self, caps=True):
        self.caps = caps  # whether beams close their ends unless told otherwise
        self.parts = {}
        self.uvs = {}  # material -> one (u, v) per vertex, for the ones mapped by hand
        self.tris = 0

    def add(self, mat, verts, faces, uv=None):
        vs, fs = self.parts.setdefault(mat, ([], []))
        o = len(vs)
        vs.extend(verts)
        fs.extend([tuple(i + o for i in f) for f in faces])
        self.tris += sum(len(f) - 2 for f in faces)
        if uv:
            self.uvs.setdefault(mat, [(0.0, 0.0)] * o).extend(uv)

    def box(self, mat, center, size, rot_z=0.0, sides=None):
        """Box; sides limits it to some faces ("-x+y-z" ...) where the rest
        are always hidden, as on a lamp against a wall."""
        sx, sy, sz = (s / 2 for s in size)
        M = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, "Z")
        vs = [M @ Vector((x * sx, y * sy, z * sz)) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        if sides:
            self.add(mat, vs, [f for f, k in zip(BOX_FACES, BOX_SIDES) if k in sides])
            return
        self.add(mat, vs, BOX_FACES)

    def span(self, mat, x0, x1, y0, y1, z0, z1):
        self.box(mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0))

    def beam(self, mat, a, c, w, h=None, caps=None, back=None):
        """Square (or w x h) section from a to c. On the platform (a Mesh
        made with caps=False) its ends are left open: members meet at joints,
        where an end cap is always hidden; caps=True closes them for a free
        end that shows, like a lifeboat. back is a
        direction nobody looks from (into a wall): the face turned that way
        is dropped too."""
        a, c = Vector(a), Vector(c)
        M = _frame(a, c)
        h = w if h is None else h
        ln = (c - a).length
        vs = [M @ Vector((x * ln, y * w / 2, z * h / 2)) for x in (0, 1) for y in (-1, 1) for z in (-1, 1)]
        faces = BOX_FACES if (self.caps if caps is None else caps) else BOX_FACES[2:]
        if back is not None:
            def normal(f):
                return (vs[f[1]] - vs[f[0]]).cross(vs[f[2]] - vs[f[0]]).normalized()
            faces = [f for f in faces if normal(f).dot(back) < 0.7]
        self.add(mat, vs, faces)

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
            if mat in self.uvs:
                uv = me.uv_layers.new(name="UVMap")
                for li, lp in enumerate(me.loops):
                    uv.data[li].uv = self.uvs[mat][lp.vertex_index]
            elif mat.get("tile"):
                _box_uvs(me, mat["tile"])
            o = bpy.data.objects.new(me.name, me)
            collection.objects.link(o)
            out.append(o)
        return out


    def single(self, name, collection, origin):
        """Everything as one object with a material slot each, its origin
        at origin (world space)."""
        vs, fs, mi, mats = [], [], [], list(self.parts)
        for k, mat in enumerate(mats):
            pv, pf = self.parts[mat]
            o = len(vs)
            vs.extend(pv)
            fs.extend([tuple(i + o for i in f) for f in pf])
            mi.extend([k] * len(pf))
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in vs], [], fs)
        me.polygons.foreach_set("material_index", mi)
        me.validate()
        for mat in mats:
            me.materials.append(mat)
        tiles = [mat["tile"] for mat in mats if mat.get("tile")]
        if tiles:
            _box_uvs(me, tiles[0])
        me.transform(Matrix.Translation(-Vector(origin)))
        o = bpy.data.objects.new(name, me)
        o.location = origin
        collection.objects.link(o)
        return o


BOX_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
BOX_SIDES = ["-x", "+x", "-y", "+y", "-z", "+z"]  # which way each of BOX_FACES faces


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

def materials(textured=True):
    """The platform's palette. textured=True paints the busy clutter of the
    photos onto the open-module interiors, the clad walls and the quarters
    (platform_textures.py, box-mapped in world metres); False keeps flat
    colours, as the control room's bake uses them."""
    def emit(name, color, strength, base=None):
        m, _, bsdf = b._new_mat(name)
        bsdf.inputs["Base Color"].default_value = (*(base or color), 1)
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        return m

    m = {
        "jacket": b.mat_flat("PlatJacket", (0.78, 0.31, 0.01), 0.6),     # orange-yellow steel
        "crane": b.mat_flat("PlatCrane", (0.80, 0.42, 0.01), 0.5),
        "steel": b.mat_flat("PlatSteel", (0.50, 0.51, 0.52), 0.6),        # deck plates, flare boom
        "module": b.mat_flat("PlatModule", (0.56, 0.57, 0.58), 0.7),      # clad module walls
        "interior": b.mat_flat("PlatInterior", (0.20, 0.205, 0.21), 0.8),  # inside the open-framed modules
        "dark": b.mat_flat("PlatDark", (0.24, 0.25, 0.26), 0.6),          # stair tower, cab glass
        "brown": b.mat_flat("PlatBrown", (0.30, 0.13, 0.08), 0.6),        # exhaust duct, containers
        "lq": b.mat_flat("PlatQuarters", (0.70, 0.71, 0.72), 0.6),
        "boat": b.mat_flat("PlatBoat", (0.90, 0.22, 0.02), 0.5),          # free-fall lifeboat
        "glass": b.mat_flat("PlatGlass", (0.04, 0.05, 0.06), 0.2),
        "equip": b.mat_flat("PlatEquip", (0.30, 0.38, 0.42), 0.5),        # vessels, pipework
        "heli": b.mat_flat("PlatHelideck", (0.25, 0.26, 0.27), 0.8),
        "mark": b.mat_flat("PlatMarking", (0.88, 0.50, 0.01), 0.7),
        "white": b.mat_flat("PlatWhite", (0.80, 0.80, 0.80), 0.7),
        "orange": b.mat_flat("PlatOrange", (0.60, 0.04, 0.03), 0.5),      # lifeboats, crane boom bands
        "lamp": emit("PlatLamp", (1.0, 0.78, 0.45), 0.0),                   # floodlights, off by day
        "lampw": emit("PlatLampWhite", (0.85, 0.92, 1.0), 0.0),             # white LED deck fittings
        "window": emit("PlatWindow", (1.0, 0.85, 0.6), 0.0, base=(0.04, 0.05, 0.06)),
        "red": emit("PlatRed", (1.0, 0.05, 0.02), 0.0),                     # obstruction lights
        "flare": emit("PlatFlare", (1.0, 0.45, 0.10), 0.0),
    }
    if textured:
        for key, draw in (("interior", tex.busy), ("module", tex.clad_busy), ("lq", tex.quarters)):
            _texture(m[key], draw())
    return m


def _texture(mat, path):
    """Base colour from a tileable image instead of the flat colour; the
    mesh gets matching UVs in Mesh.objects (see _box_uvs)."""
    nt = mat.node_tree
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(path, check_existing=True)
    nt.links.new(img.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    mat["tile"] = tex.TILE


def _box_uvs(me, tile):
    """World-space box mapping, tile metres per repeat: walls take (along,
    up) read from outside, floors and roofs (x, y)."""
    uv = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) >= max(abs(n.x), abs(n.y)):
                u, v = co.x, co.y
            elif abs(n.x) > abs(n.y):
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            uv.data[li].uv = (u / tile, v / tile)


def set_night(m, on):
    for k, s in (("lamp", 40), ("lampw", 40), ("window", 2.5), ("red", 60), ("flare", 120)):
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
    back = Vector((0, -out, 0)) if plane[0] == "y" else Vector((-out, 0, 0))  # into the module
    us = [u0 + (u1 - u0) * i / nu for i in range(nu + 1)]
    zs = [z0 + (z1 - z0) * j / nz for j in range(nz + 1)]
    wm, off = m["white"], 0.4
    for u in us[1:] if "l" in skip else us:
        g.beam(wm, P(u, z0, off), P(u, z1, off), w, back=back)
    for z in zs[1:] if "b" in skip else zs:
        g.beam(wm, P(u0, z, off), P(u1, z, off), w, back=back)
    rng = random.Random(seed)
    for j in range(nz):
        for i in range(nu):
            k = pattern[(j * nu + i) % len(pattern)] if pattern else rng.choice("XX//\\\\K")
            a, c = us[i], us[i + 1]
            lo, hi = zs[j], zs[j + 1]
            if k in "X/":
                g.beam(wm, P(a, lo, off), P(c, hi, off), w * 0.8, back=back)
            if k in "X\\":
                g.beam(wm, P(a, hi, off), P(c, lo, off), w * 0.8, back=back)
            if k == "K":
                mid = (a + c) / 2
                g.beam(wm, P(a, lo, off), P(mid, hi, off), w * 0.8, back=back)
                g.beam(wm, P(c, lo, off), P(mid, hi, off), w * 0.8, back=back)


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
    full = list(JACKET_LEVELS)
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
    # Well conductors: 4 x 5 slots under the wellbay, straight down, and a
    # second bundle of risers and J-tubes toward the other end (yellow, as built)
    for i in range(5):
        for j in range(4):
            x = WELL_X0 + 2 + i * (WELL_X1 - WELL_X0 - 4) / 4
            y = WELL_Y0 + 2 + j * (WELL_Y1 - WELL_Y0 - 4) / 3
            g.tube(jm, (x, y, bottom), (x, y, CELLAR), 0.45, 6, caps=False)
    for i in range(4):
        for j in range(3):
            x, y = 5.0 + i * 1.6, -4.0 + j * 4.0
            g.tube(jm, (x, y, bottom), (x, y, CELLAR), 0.45, 6, caps=False)
    # Riser guards and a boat landing on the -Y face at the splash zone
    yf = -LEG_TOP[1] - 1.2
    for x in (-1, 3):
        g.tube(m["steel"], (JACKET_X + x, yf, -4), (JACKET_X + x, yf, DECK_BOT), 0.5, 6)
    g.span(m["steel"], JACKET_X - 6, JACKET_X + 6, yf - 3.3, yf - 2.3, 2, 3)


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
    open_module(g, m, -TOP_X, PROC_X1, -TOP_Y, TOP_Y, LOWER_TOP, PROC_TOP, 2, 4, ends="-+", seed=3,
                pattern="X\\X/" "/X\\K", skip="b")
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

    # Laydown deck: the roof of the lower block over the wellbay, containers on top
    g.span(st, PROC_X1, STAIR_X0, -TOP_Y - 0.3, TOP_Y + 0.3, NOTCH_TOP - 0.5, NOTCH_TOP)
    for x, y, sx, sy, sz, c in ((-17, -11, 6, 4, 3.5, "module"), (-12, -15, 6, 2.5, 2.6, "brown"),
                                (-12, 12, 6, 2.5, 2.6, "orange"), (-17, 6, 3, 3, 2.6, "brown")):
        g.box(m[c], (x, y, NOTCH_TOP + sz / 2), (sx, sy, sz))
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
    name_board(g, m, ("y", -TOP_Y + 0.5), -1, 25.0, 36.9, 10.0, 4.6)  # on the plant module
    name_board(g, m, ("y", TOP_Y), 1, -26.0, PROC_TOP - 3.6, 9.5, 5.0)  # far side, high on the process module
    # Escape tunnel: a white clad corridor along the bottom of the far side,
    # nearly the full length of the platform, panel seams every few metres
    tx0, tx1, ty, tz0, tz1 = -48.0, 47.0, TOP_Y + 2.8, DECK_BOT - 0.3, 27.6
    g.span(m["white"], tx0, tx1, TOP_Y, ty, tz0, tz1)
    for i in range(int((tx1 - tx0) / 3.4) + 1):
        xx = tx0 + i * 3.4
        g.box(m["steel"], (xx, ty + 0.05, (tz0 + tz1) / 2), (0.15, 0.1, tz1 - tz0))
    g.box(m["steel"], ((tx0 + tx1) / 2, ty + 0.05, tz1 - 0.6), (tx1 - tx0, 0.1, 0.12))
    # Ledge at the foot of the quarters, sticking out on the -Y side
    g.span(m["white"], x0 + 0.05, END_X0 - 0.05, -TOP_Y - 1.5, TOP_Y + 0.25, UTIL_TOP - 0.6, UTIL_TOP + 0.08)


def name_board(g, m, plane, out, uc, zc, w, h, lines=("NORDHAV ALFA", "25/1-A", "NORDHAV ENERGI")):
    """Yellow board with the platform's name, licence block and operator,
    standing proud of the facade bracing: one quad with its lettering drawn
    into a small image (platform_textures.sign)."""
    key = ("sign",) + tuple(lines) + (w, h)
    if key not in m:
        mat, _, bsdf = b._new_mat("PlatSign")
        img = mat.node_tree.nodes.new("ShaderNodeTexImage")
        img.image = bpy.data.images.load(tex.sign(lines, w, h), check_existing=True)
        mat.node_tree.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.7
        m[key] = mat
    P = _plane(plane, out)
    s = -out if plane[0] == "y" else out  # which way along the face reads left to right
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    vs = [P(uc + s * cu * w / 2, zc + cz * h / 2, 0.8) for cu, cz in corners]
    want = Vector((0, out, 0)) if plane[0] == "y" else Vector((out, 0, 0))
    face = (0, 1, 2, 3) if (vs[1] - vs[0]).cross(vs[3] - vs[0]).dot(want) > 0 else (3, 2, 1, 0)
    g.add(m[key], vs, [face], uv=[((cu + 1) / 2, (cz + 1) / 2) for cu, cz in corners])


def build_quarters(g, m):
    x0, x1, y = LQ_X0, LQ_X1, LQ_Y
    # Clad plant module between the crane and the quarters, a little taller
    # than both, louvred on the long sides
    px0 = STAIR_X1 + 3.1
    g.span(m["module"], px0, x0 - 0.1, -TOP_Y + 0.5, TOP_Y - 0.5, UTIL_TOP + 0.08, PLANT_TOP)
    for s, yy in ((-1, -TOP_Y + 0.5), (1, TOP_Y - 0.5)):
        facade(g, m, ("y", yy), s, px0 + 0.5, x0 - 0.6, UTIL_TOP + 0.08, PLANT_TOP, 6, 3, "|", w=0.35)
    if QUARTERS == "v5":
        _quarters_v5(g, m)
    else:
        _quarters(g, m, QUARTERS == "terraced")
    # Plant on the roofs: a grey mass over the plant module and the back of
    # the quarters, two exhaust stacks, a radome on each end corner
    g.span(m["module"], px0 + 3, x0 + 8, 0, TOP_Y - 2, PLANT_TOP, PLANT_TOP + 4)
    g.span(m["module"], x0 + 1, x0 + 9, -14, -8, LQ_TOP, LQ_TOP + 2.5)
    for xx in (19.0, 23.0):
        g.tube(m["steel"], (xx, -6, PLANT_TOP), (xx, -6, PLANT_TOP + 5.7), 1.3, 10)
    for yy in (-16.5, 16.5):
        g.tube(m["white"], (TOP_X - 1.5, yy, LQ_TOP + 1), (TOP_X - 1.5, yy, LQ_TOP + 3.4), 1.6, 8, r1=1.0)
    # Exhaust: a white lattice tower with a dark stack, the highest point but the flare
    g.lattice(m["white"], (28.5, 10, PLANT_TOP + 4), (28.5, 10, 72.0), 3.6, 3.0, 3.4, 0.25)
    g.tube(m["dark"], (28.5, 10, 70.0), (28.5, 10, 74.0), 0.9, 8)
    g.tube(m["brown"], (22, 6, PLANT_TOP + 4), (27, 9.5, PLANT_TOP + 6), 0.9, 8)
    g.prism(m["red"], (28.5, 10), 0.4, 74.0, 74.8, 6)
    g.prism(m["red"], (TOP_X - 1, -TOP_Y + 1), 0.4, LQ_TOP + 1.2, LQ_TOP + 1.9, 6)

    if QUARTERS == "v5":
        _helideck_v5(g, m)
    else:
        _helideck(g, m, QUARTERS == "terraced")


def _quarters_v5(g, m):
    """The quarters as one plain block with a full-width end tower (PR #43)."""
    x0, x1, y = LQ_X0, LQ_X1, LQ_Y
    # Quarters: the full width of the topsides, roof level with the process roof
    g.span(m["lq"], x0, x1, -y, y, UTIL_TOP, LQ_TOP)
    # End tower: full height, from under the deck to the roof
    g.span(m["lq"], END_X0, TOP_X + 0.3, -TOP_Y - 0.25, TOP_Y + 0.25, DECK_BOT - 2, LQ_TOP + 1)
    name_board(g, m, ("x", TOP_X + 0.3), 1, 0.0, 36.5, 11.6, 2.6, ("NORDHAV ALFA", "25/1-A NORDHAV ENERGI"))  # over the lifeboats
    # Two free-fall lifeboats side by side on the end face, on skids sloping out
    for yy in (-3.3, 3.3):
        g.beam(m["white"], (TOP_X + 0.3, yy, 31.0), (TOP_X + 7.0, yy, 24.5), 0.5)
        g.beam(m["boat"], (TOP_X + 1.2, yy, 30.6), (TOP_X + 8.0, yy, 25.6), 2.6, 2.8, caps=True)
    # Cabin windows: six rows on the -Y face, fewer on the end and the +Y face
    rows = 6
    fh = (LQ_TOP - UTIL_TOP - 2) / rows
    rng = random.Random(7)  # which cabins have the light on at night
    cols = [x0 + 1.5 + i * 3.2 for i in range(5)]
    for f in range(rows):
        z = UTIL_TOP + 1.5 + f * fh + 0.6
        for wx in cols:
            mat = m["window" if rng.random() < 0.4 else "glass"]
            rect(g, mat, ("y", -y), -1, wx, wx + 1.3, z, z + 1.8)
        if f >= 2:  # on the end tower, beside the lifeboats
            for wy in (-14, -10, 9, 13):
                rect(g, m["window" if rng.random() < 0.4 else "glass"], ("x", TOP_X + 0.3), 1, wy, wy + 1.3, z, z + 1.8)
    # +Y face: plain, with the white cage of the external escape stair
    facade(g, m, ("y", y), 1, x0 + 1, x0 + 12, UTIL_TOP, LQ_TOP, 3, 6, "|", w=0.4)
    for f in range(rows):
        z = UTIL_TOP + 1.5 + f * fh + 0.6
        for wx in (x0 + 13, x0 + 15.5):
            rect(g, m["window" if rng.random() < 0.4 else "glass"], ("y", y), 1, wx, wx + 1.3, z, z + 1.8)
    # Rescue boat in its davit on the -Y face
    g.box(m["orange"], (x0 + 6, -TOP_Y - 0.9, UTIL_TOP + 3.0), (5.0, 2.0, 1.6))


def _helideck_v5(g, m):
    """The smaller helideck of PR #43 on its two raking struts."""
    hz, hx, r = HELI_Z, HELI_X, HELI_R
    g.prism(m["heli"], (hx, 0), r, hz - 1.2, hz, 8, math.pi / 8)
    g.prism(m["steel"], (hx, 0), r + 1.3, hz - 1.6, hz - 1.3, 8, math.pi / 8)  # safety net shelf
    g.ring(m["mark"], (hx, 0), r * 0.42, r * 0.50, hz + 0.03, 20)
    for c, s in (((hx, -1.6, hz + 0.04), (4.0, 0.7, 0.04)), ((hx, 1.6, hz + 0.04), (4.0, 0.7, 0.04)),
                 ((hx, 0, hz + 0.04), (0.7, 3.2, 0.04))):
        g.box(m["white"], c, s)
    g.box(m["dark"], (hx + r * 0.8, 0, hz + 0.04), (1.0, 5, 0.06))  # name panel
    edge = hx + r * 0.85
    for yy in (-8, 8):
        foot = (TOP_X + 0.3, yy, hz - 13)
        g.beam(m["white"], foot, (edge, yy * 0.7, hz - 1.6), 0.8)          # the long diagonal
        g.beam(m["white"], foot, (TOP_X + 0.3 + (edge - TOP_X) * 0.45, yy * 0.8, hz - 1.6), 0.6)
        g.beam(m["white"], (TOP_X + 0.3, yy, hz - 1.6), (edge, yy * 0.7, hz - 1.6), 0.6)  # top chord
    g.beam(m["white"], (TOP_X + 0.3, 0, hz - 9), (edge - 2, 0, hz - 1.6), 0.6)
    for i in range(8):
        a = math.pi / 8 + 2 * math.pi * i / 8
        g.prism(m["lamp"], (hx + (r - 0.3) * math.cos(a), (r - 0.3) * math.sin(a)), 0.25, hz, hz + 0.3, 6)


def _image_mat(m, key, name, path):
    """A material showing one image through the mesh's own UVs (Mesh.add uv=),
    made once per key, like the name boards'."""
    if key not in m:
        mat, _, bsdf = b._new_mat(name)
        img = mat.node_tree.nodes.new("ShaderNodeTexImage")
        img.image = bpy.data.images.load(path, check_existing=True)
        mat.node_tree.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.7
        m[key] = mat
    return m[key]


def _boat(g, m, a, c, r, mat=None, canopy=None):
    """A lifeboat or rescue boat from stern a to bow c: a tapering hull with
    a canopy along the top (all orange on a free-fall lifeboat)."""
    a, c = Vector(a), Vector(c)
    mat = mat or m["boat"]
    g.tube(mat, a, c, r, 8, caps=True, r1=r * 0.55)
    up = (c - a).normalized().cross(Vector((0, 1, 0))).normalized() * -r * 0.75
    if up.z < 0:
        up = -up
    g.tube(canopy or mat, a.lerp(c, 0.1) + up, a.lerp(c, 0.75) + up, r * 0.55, 6, caps=True, r1=r * 0.4)


def _quarters(g, m, terraced):
    """The quarters as on the photos and the top view: a clad block with
    small paired cabin windows, two white corner columns at the end carrying
    the helideck's struts and the radio dishes, and between them the end bay
    with the two free-fall lifeboats under the name board. terraced builds
    the two lowest storeys out over the -Y edge with a terrace on top, and
    the end bay as open steel framing with a walkway every storey; otherwise
    the end bay is clad and the same reads from the texture."""
    x0, x1, y = LQ_X0, LQ_X1, LQ_Y
    storey = (LQ_TOP - UTIL_TOP) / 7
    ex = TOP_X + 0.3                    # outer face of the end columns
    cw = 6.0                            # corner column width
    g.span(m["lq"], x0, x1, -y, y, UTIL_TOP, LQ_TOP)
    for s in (-1, 1):
        g.span(m["lq"], END_X0, ex, *sorted((s * (TOP_Y + 0.25), s * (TOP_Y - cw))), DECK_BOT - 2, LQ_TOP - 0.2)
        for zz in (40.0, 48.0):  # radio dishes on the columns' outer face
            g.tube(m["white"], (ex - 2.5, s * (TOP_Y + 0.25), zz), (ex - 2.5, s * (TOP_Y + 1.1), zz), 1.3, 10)
    bay = TOP_Y - cw                    # the end bay spans y -bay..bay
    face_y = -y                         # where the -Y cabin windows sit, storey by storey
    if terraced:
        # The two lowest storeys come out to the edge; a terrace on top with
        # a rail and a row of containers
        ty = -TOP_Y - 2.0
        tz = UTIL_TOP + 2 * storey
        g.span(m["lq"], x0, END_X0, ty, -y, UTIL_TOP, tz)
        g.beam(m["white"], (x0, ty + 0.1, tz + 1.1), (END_X0, ty + 0.1, tz + 1.1), 0.12)
        for xx in (x0 + 0.2, END_X0 - 0.2):
            g.beam(m["white"], (xx, ty + 0.1, tz), (xx, ty + 0.1, tz + 1.1), 0.12)
        for xx, mat in ((x0 + 4.0, "orange"), (x0 + 10.4, "orange"), (x0 + 16.8, "equip")):
            g.box(m[mat], (xx, -y - 1.6, tz + 1.3), (6.0, 2.4, 2.6), sides="-x+x-y+z")
        # End bay: open framing in front of the clad end wall, a walkway
        # plate every storey
        facade(g, m, ("x", ex), 1, -bay, bay, DECK_BOT, LQ_TOP - 0.2, 4, 7, "|X|K", w=0.45)
        for k in range(1, 8):
            zz = UTIL_TOP + (k - 4) * storey
            if zz > DECK_BOT + 1:
                g.span(m["steel"], END_X0, ex, -bay, bay, zz - 0.2, zz)
                g.beam(m["white"], (ex - 0.2, -bay, zz + 1.1), (ex - 0.2, bay, zz + 1.1), 0.1)
    else:
        g.span(m["lq"], END_X0, ex - 0.6, -bay, bay, DECK_BOT - 2, LQ_TOP - 0.2)
    name_board(g, m, ("x", ex), 1, 0.0, 39.3, 11.6, 2.6, ("NORDHAV ALFA", "25/1-A NORDHAV ENERGI"))  # over the lifeboats
    # Two free-fall lifeboats side by side in a white frame, sloping steeply
    # out of the end bay under the name board
    for yy in (-5.4, 0.0, 5.4):
        g.beam(m["white"], (ex + 0.4, yy, DECK_BOT), (ex + 0.4, yy, 37.2), 0.5)
    g.beam(m["white"], (ex + 0.4, -5.4, 37.2), (ex + 0.4, 5.4, 37.2), 0.6)
    d = Vector((math.cos(math.radians(45)), 0, -math.sin(math.radians(45))))
    n = Vector((-d.z, 0, d.x))
    for yy in (-2.7, 2.7):
        a = Vector((TOP_X - 4.0, yy, 33.0))
        g.beam(m["white"], a, a + d * 11.5, 0.4, caps=True)
        _boat(g, m, a + n * 1.9, a + n * 1.9 + d * 10.5, 1.75)
    # Cabin windows: small, in pairs, every storey above the terrace on -Y;
    # fewer on +Y beside the escape stair
    rng = random.Random(7)  # which cabins have the light on at night
    pairs = [x0 + 1.5 + i * 4.2 for i in range(4)]
    for f in range(7):
        z = UTIL_TOP + f * storey + 1.0
        fy = (-TOP_Y - 2.0) if terraced and f < 2 else face_y
        for px in pairs:
            for wx in (px, px + 1.6):
                rect(g, m["window" if rng.random() < 0.4 else "glass"], ("y", fy), -1, wx, wx + 1.0, z, z + 1.2)
        for wx in (x0 + 13, x0 + 14.6):
            rect(g, m["window" if rng.random() < 0.4 else "glass"], ("y", y), 1, wx, wx + 1.0, z, z + 1.2)
    # +Y face: plain, with the white cage of the external escape stair
    facade(g, m, ("y", y), 1, x0 + 1, x0 + 12, UTIL_TOP, LQ_TOP, 3, 6, "|", w=0.4)
    # Rescue boat hanging in its davit on the -Y face, below the terrace
    by = (-TOP_Y - 2.0 if terraced else -TOP_Y) - 1.4
    g.beam(m["white"], (x0 + 3.0, by + 1.2, UTIL_TOP + 4.5), (x0 + 3.0, by, UTIL_TOP + 4.5), 0.3)
    g.beam(m["white"], (x0 + 9.0, by + 1.2, UTIL_TOP + 4.5), (x0 + 9.0, by, UTIL_TOP + 4.5), 0.3)
    _boat(g, m, (x0 + 3.0, by, UTIL_TOP + 2.5), (x0 + 9.0, by, UTIL_TOP + 2.5), 1.0, m["orange"], m["white"])


def _helideck(g, m, beams):
    """Helideck as on the top view: an octagon out past the end, its deck
    running on level back over the quarters' roof to the head of the stairs,
    on a deep truss with two pairs of raking struts down to the corner
    columns. beams builds the truss from members; otherwise it is a solid
    octagonal frustum with the bracing painted on (platform_textures.truss)."""
    hz, hx, r = HELI_Z, HELI_X, HELI_R
    rot = math.pi / 8
    # The deck: the octagon's outer five sides, then on level back over the
    # quarters' roof as wide as it is across the flats; the safety net shelf
    # follows the same outline 1.3 m out
    x0 = LQ_X1 - 3.0

    def outline(rr, z0, z1, mat):
        ring = [(x0, -rr * math.cos(rot))]
        for k in range(-3, 3):
            a = rot + k * math.pi / 4
            ring.append((hx + rr * math.cos(a), rr * math.sin(a)))
        ring.append((x0, rr * math.cos(rot)))
        n = len(ring)
        vs = [Vector((x, y, z0)) for x, y in ring] + [Vector((x, y, z1)) for x, y in ring]
        fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        g.add(mat, vs, fs + [tuple(reversed(range(n))), tuple(range(n, 2 * n))])

    outline(r, hz - 1.0, hz, m["heli"])
    outline(r + 1.3, hz - 1.4, hz - 1.1, m["steel"])
    half = r * math.cos(rot)
    # Under the deck where it crosses the roof and the end columns: a solid
    # clad plinth down onto them, so no daylight shows between deck and roof
    g.span(m["lq"], x0, TOP_X + 0.3, -half + 0.4, half - 0.4, LQ_TOP - 0.3, hz - 1.05)
    g.ring(m["mark"], (hx, 0), r * 0.42, r * 0.50, hz + 0.03, 20)
    for c, s in (((hx, -1.6, hz + 0.04), (4.0, 0.7, 0.04)), ((hx, 1.6, hz + 0.04), (4.0, 0.7, 0.04)),
                 ((hx, 0, hz + 0.04), (0.7, 3.2, 0.04))):
        g.box(m["white"], c, s)
    g.box(m["dark"], (hx + r * 0.8, 0, hz + 0.04), (1.0, 5, 0.06))  # name panel
    lamps = [(hx + (r - 0.3) * math.cos(rot + k * math.pi / 4), (r - 0.3) * math.sin(rot + k * math.pi / 4)) for k in range(-3, 3)]
    for c in lamps + [(x0 + 0.3, -half + 0.3), (x0 + 0.3, half - 0.3)]:
        g.prism(m["lamp"], c, 0.25, hz, hz + 0.3, 6)
    # The truss under it: top ring under the deck, a smaller ring 3.5 m lower
    zt, zb, rb = hz - 1.0, hz - 4.5, r * 0.8
    top = [Vector((hx + r * math.cos(rot + 2 * math.pi * i / 8), r * math.sin(rot + 2 * math.pi * i / 8), zt)) for i in range(8)]
    bot = [Vector((hx + rb * math.cos(rot + 2 * math.pi * i / 8), rb * math.sin(rot + 2 * math.pi * i / 8), zb)) for i in range(8)]
    out = [i for i in range(8) if (top[i].x + top[(i + 1) % 8].x) / 2 > TOP_X + 1]  # faces not inside the quarters
    if beams:
        for i in out:
            j = (i + 1) % 8
            g.beam(m["white"], bot[i], bot[j], 0.45)
            g.beam(m["white"], top[i], bot[i], 0.35)
            g.beam(m["white"], top[j], bot[j], 0.35)
            g.beam(m["white"], top[i], bot[j], 0.3)
            g.beam(m["white"], bot[i], top[i].lerp(top[j], 0.5), 0.3)
        for i in (out[0], out[len(out) // 2], out[-1]):  # cross beams under the deck
            g.beam(m["white"], bot[i], Vector((hx, 0, zb)), 0.45)
    else:
        mat = _image_mat(m, ("truss",), "PlatTruss", tex.truss())
        vs, fs, uv = [], [], []
        for i in out:
            j = (i + 1) % 8
            k = len(vs)
            vs += [bot[i], bot[j], top[j], top[i]]
            uv += [(0, 0), (1, 0), (1, 1), (0, 1)]
            fs.append((k, k + 1, k + 2, k + 3))
        g.add(mat, vs, fs, uv=uv)
        g.add(m["dark"], bot, [tuple(reversed(range(8)))])
    # Raking struts: from the corner columns a few storeys down, out to the
    # truss's lower ring, a pair on each side
    for s in (-1, 1):
        foot = Vector((TOP_X + 0.3, s * (TOP_Y - 3.0), hz - 15.0))
        g.beam(m["white"], foot, Vector((hx + r * 0.45, s * r * 0.55, zb)), 0.9)
        g.beam(m["white"], foot, Vector((TOP_X + 4.0, s * (TOP_Y - 4.5), zb)), 0.7)
        g.beam(m["white"], Vector((TOP_X + 0.3, s * (TOP_Y - 3.0), zb)), Vector((hx + r * 0.45, s * r * 0.55, zb)), 0.6)


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


def build_crane(g, m, base, ped_h, yaw, luff, boom_len, rest=None, slew=None):
    """Pedestal crane after the photos: a tall yellow column wound with a
    spiral stair, a slewing deck with the machinery house and cab, a tall
    yellow lattice A-frame, and a long red lattice boom hung from it on
    pendants. yaw is the boom direction in plan, luff its angle above
    horizontal (negative dips toward the tip). rest = (x, y, z0) puts a boom
    rest under the boom at (x, y), standing on z0. slew is a separate Mesh for what
    turns on the slewing ring (house, cab, A-frame, boom), so it can be
    exported as its own object; by default it all goes into g."""
    x, y, z = base
    cr = m["crane"]
    zt = z + ped_h
    g.prism(cr, (x, y), 2.1, z, zt, 12)
    # Spiral stair round the column, with two landings
    turns, steps, r = 3.0, 27, 2.9
    pts = [Vector((x + r * math.cos(2 * math.pi * turns * i / steps), y + r * math.sin(2 * math.pi * turns * i / steps),
                   z + 1.0 + (ped_h - 2.0) * i / steps)) for i in range(steps + 1)]
    for p0, p1 in zip(pts, pts[1:]):
        g.beam(m["white"], p0, p1, 0.7, 0.4)  # deep enough to read as flight and handrail
    for zz in (z + ped_h * 0.45, zt - 0.6):
        g.ring(m["white"], (x, y), 2.1, 3.6, zz, 16)
    g.prism(cr, (x, y), 3.6, zt - 0.6, zt, 16)                  # slewing ring
    fixed, g = g, slew or g
    fwd = Vector((math.cos(yaw), math.sin(yaw), 0))
    side = Vector((-fwd.y, fwd.x, 0))
    up = Vector((0, 0, 1))
    c0 = Vector((x, y, zt))
    g.box(cr, c0 - fwd * 1.2 + up * 2.4, (8.5, 6.0, 4.8), yaw)  # machinery house
    g.box(m["module"], c0 - fwd * 5.0 + up * 1.4, (2.0, 5.0, 2.6), yaw)  # counterweight
    g.box(cr, c0 + fwd * 3.6 + side * 3.2 + up * 2.0, (3.2, 2.2, 3.0), yaw)  # cab
    g.box(m["glass"], c0 + fwd * 5.25 + side * 3.2 + up * 2.3, (0.1, 2.0, 1.8), yaw)
    # A-frame: a tall tapering lattice mast, leaning a little back
    m0, m1 = c0 + up * 4.8 - fwd * 1.0, c0 + up * 19.0 - fwd * 2.6
    g.lattice(cr, m0, m1, 2.6, 1.0, 2.4, 0.3)
    for sgn in (-1, 1):
        g.beam(cr, c0 + up * 4.8 - fwd * 4.0 + side * sgn * 2.2, m1 - up * 3.0, 0.4)  # back legs
    g.box(cr, m1 + up * 0.4, (1.6, 1.6, 0.8), yaw)
    # Boom: red lattice from the house front, hung on pendants from the A-frame
    foot = c0 + fwd * 3.2 + up * 1.2
    dirv = fwd * math.cos(luff) + up * math.sin(luff)
    tip = foot + dirv * boom_len
    g.lattice(m["orange"], foot, tip, 3.0, 1.2, 4.0, 0.32, roll=math.pi / 4)
    g.box(m["orange"], tip + dirv * 1.0, (2.0, 1.4, 1.6), yaw)  # boom head and sheaves
    for t in (1.0, 0.55):
        g.beam(m["steel"], m1, foot + dirv * boom_len * t + up * 1.0, 0.12)
    g.prism(m["red"], (m1.x, m1.y), 0.3, m1.z + 0.8, m1.z + 1.4, 6)
    if rest:
        rx, ry, rz = rest
        top = foot + dirv * (Vector((rx, ry, rz)) - foot).dot(dirv) - up * 1.4  # under the boom, over the feet
        for sgn in (-1, 1):
            fixed.beam(m["white"], Vector((rx, ry, rz)) + side * sgn * 2.0, top + side * sgn * 0.8, 0.35)
        fixed.beam(m["white"], top - side * 1.2, top + side * 1.2, 0.4)
    return tip


def build_cranes(g, m, slew=None, lift=None):
    """The big crane between the laydown deck and the plant module. By
    default its boom is stowed horizontal over the process module on its
    rest. lift = (x, y, z) swings it out instead and lowers the hook to that
    point with a container slung under it, as when unloading a supply vessel;
    (x, y, z, False) leaves the hook empty, waiting for one."""
    base = (CRANE_X, CRANE_Y, NOTCH_TOP)
    ped_h = CRANE_RING - NOTCH_TOP
    if not lift:
        build_crane(g, m, base, ped_h, math.radians(180), 0.0, CRANE_BOOM,
                    rest=(-42.5, CRANE_Y, PROC_TOP + 0.6), slew=slew)
        return
    hx, hy, hz = lift[:3]
    load = lift[3] if len(lift) > 3 else True
    yaw = math.atan2(hy - CRANE_Y, hx - CRANE_X)
    reach = math.hypot(hx - CRANE_X, hy - CRANE_Y) - 3.2       # from the boom foot
    luff = math.acos(min(1.0, reach / CRANE_BOOM))
    tip = build_crane(g, m, base, ped_h, yaw, luff, CRANE_BOOM, slew=slew)
    hang = slew or g
    hook = Vector((tip.x, tip.y, hz))
    hang.beam(m["steel"], tip, hook + Vector((0, 0, 3.2)), 0.08)            # hoist wire
    hang.box(m["orange"], hook + Vector((0, 0, 3.0)), (0.6, 0.6, 0.8))      # hook block
    if not load:
        return hook
    for dx, dy in ((-2.6, -1.1), (2.6, -1.1), (2.6, 1.1), (-2.6, 1.1)):     # four-leg sling
        hang.beam(m["steel"], hook + Vector((0, 0, 2.6)), hook + Vector((dx, dy, 0.1)), 0.04)
    hang.box(m["red"], hook - Vector((0, 0, 1.2)), (6.0, 2.4, 2.6))         # container
    return hook


def build_lights(g, m):
    if LIGHTS == "sparse":
        _lights_sparse(g, m)
    else:
        _lights_dense(g, m)


def _lights_sparse(g, m):
    """Deck lights every ~9 m along the edges of each storey, the night look."""
    for z in (CELLAR, MEZZ, LOWER_TOP):
        for i in range(12):
            x = -TOP_X + 4 + i * 9
            if x > END_X0:
                continue
            for y, out in ((-TOP_Y - 0.8, "-y"), (TOP_Y + 0.8, "+y")):
                g.box(m["lamp"], (x, y, z + 2.4), (0.5, 0.3, 0.3), sides=out + "-z")
        for y in (-12, 0, 12):
            g.box(m["lamp"], (-TOP_X - 0.8, y, z + 2.4), (0.3, 0.5, 0.3), sides="-x-z")
    _floodlights(g, m)


def _lights_dense(g, m):
    """As the night photos show it: white fittings every ~4.5 m along every
    storey of the open modules, a row under the cellar deck lighting the
    jacket top, dots along the roof edges, and warm floodlights on the roofs."""
    lw = m["lampw"]
    def row(x0, x1, z, y, out, step=4.5):
        for i in range(int((x1 - x0) / step) + 1):
            g.box(lw, (x0 + i * step, y, z), (0.45, 0.25, 0.25), sides=out + "-z")
    def end_row(z, step=4.0):
        for i in range(int((2 * TOP_Y - 4) / step) + 1):
            g.box(lw, (-TOP_X - 0.8, -TOP_Y + 2 + i * step, z), (0.25, 0.45, 0.25), sides="-x-z")
    # Under the cellar deck, all along both sides and the flare end
    for y, out in ((-TOP_Y + 0.6, "-y"), (TOP_Y - 0.6, "+y")):
        row(-TOP_X + 2, TOP_X - 2, DECK_BOT - 0.35, y, out)
    end_row(DECK_BOT - 0.35)
    # Every storey of the process block; the far side's lowest one sits on the escape tunnel
    store = [CELLAR, MEZZ, LOWER_TOP] + [LOWER_TOP + k * (PROC_TOP - LOWER_TOP) / 3 for k in (1, 2)]
    for z in store:
        x1 = STAIR_X0 - 1 if z < LOWER_TOP else PROC_X1 - 1
        row(-TOP_X + 2, x1, z + 2.4, -TOP_Y - 0.8, "-y")
        row(-TOP_X + 2, x1, z + 2.4 + (1.0 if z == CELLAR else 0), TOP_Y + (3.0 if z == CELLAR else 0.8), "+y")
        end_row(z + 2.4)
    # The clad utility module and the plant module: a row each at the top
    for z, x0, x1 in ((CELLAR + 2.4, STAIR_X1 + 1, END_X0 - 1), (UTIL_TOP - 1.2, STAIR_X1 + 1, LQ_X0 - 1),
                      (PLANT_TOP - 1.2, STAIR_X1 + 4, LQ_X0 - 1)):
        row(x0, x1, z, -TOP_Y - 0.8 + (0.3 if z > UTIL_TOP else 0), "-y", 6.0)
    # Dots along the process roof edge and the laydown deck's rail
    for y in (-TOP_Y - 0.4, TOP_Y + 0.4):
        for i in range(int((PROC_X1 + TOP_X) / 6) + 1):
            g.box(lw, (-TOP_X + i * 6, y, PROC_TOP + 1.0), (0.35, 0.35, 0.35))
        for i in range(4):
            g.box(lw, (PROC_X1 + 2 + i * 5, y, NOTCH_TOP + 1.1), (0.35, 0.35, 0.35))
    # Up the stair tower, a fitting on each landing
    for z in range(int(DECK_BOT) + 3, int(NOTCH_TOP), 4):
        g.box(lw, (STAIR_X1 + 0.3, -TOP_Y - 0.5, z), (0.25, 0.25, 0.25), sides="-y+x-z")
    _floodlights(g, m)
    # More floodlights on the laydown deck and plant roof corners
    for x, y, z in ((PROC_X1 + 1, -TOP_Y + 1, NOTCH_TOP + 6), (PROC_X1 + 1, TOP_Y - 1, NOTCH_TOP + 6),
                    (STAIR_X1 + 4, -TOP_Y + 1.5, PLANT_TOP + 1.0), (LQ_X0 - 1, TOP_Y - 1.5, PLANT_TOP + 1.0),
                    (-TOP_X + 1, TOP_Y - 1, PROC_TOP + 2.0)):
        g.box(m["lamp"], (x, y, z), (1.2, 1.2, 0.6))


def _floodlights(g, m):
    for x, y, z in ((-40, 6, PROC_TOP + 1), (-14, 0, NOTCH_TOP + 5), (-8, 8, NOTCH_TOP + 1)):
        g.box(m["lamp"], (x, y, z), (1.0, 1.0, 0.5))  # floodlights
    # Floodlights over the roofs and the laydown deck: on the corner shaft,
    # the crane's collar, the process roof edge and the quarters' end wall
    for x, y, z in ((-TOP_X + 2.5, -TOP_Y + 3.5, PROC_TOP + 4.0), (STAIR_X0 + 2, -9.5, NOTCH_TOP + 12.0),
                    (PROC_X1 - 0.6, -8, PROC_TOP + 1.2), (PROC_X1 - 0.6, 8, PROC_TOP + 1.2),
                    (STAIR_X1 + 2.6, -10, PLANT_TOP - 1.0), (STAIR_X1 + 2.6, 2, PLANT_TOP - 1.0)):
        g.box(m["lamp"], (x, y, z), (1.2, 1.2, 0.6))


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
    build_crane(g, m, (cx + 32, cy - 22, hz1), 6, math.radians(150), math.radians(25), 34)
    for x, y in hull:
        g.box(m["lamp"], (cx + x * 1.01, cy + y * 1.01, hz1 + 1), (0.6, 0.6, 0.4))


# ------------------------------------------------------------------ build

def build_platform(m, collection=None, jackup=False, z_cut=-4.0, crane_slew=False, crane_lift=None):
    """Build the platform into collection; returns (objects, triangles, flare tip).
    z_cut is where the jacket stops: just under the sea surface for a view
    from above the water, SEABED for a scale model. crane_slew=True builds
    the big crane's turning part as one more object, CRANE_SLEW, with its
    origin on the slewing ring (CRANE_X, CRANE_Y, CRANE_RING) so a viewer
    can swing it; it is left out of the returned objects. crane_lift is a
    hook point (see build_cranes) for the crane at work."""
    collection = collection or bpy.context.collection
    g = Mesh(caps=False)
    slew = Mesh(caps=False) if crane_slew else None
    build_jacket(g, m, z_cut)
    build_topsides(g, m)
    build_quarters(g, m)
    tip = build_flare(g, m)
    build_cranes(g, m, slew, crane_lift)
    build_lights(g, m)
    if jackup:
        build_jackup(g, m, z_cut)
    if slew:
        slew.single(CRANE_SLEW, collection, Vector((CRANE_X, CRANE_Y, CRANE_RING)))
    return g.objects("Platform", collection), g.tris + (slew.tris if slew else 0), tip


def _delete_faces(o, drop):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if drop(f)], context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def carve(objs, lo, hi):
    """Delete every face whose bounding box reaches into the box lo..hi
    (world space): makes room for a space inside the platform, such as a
    control room in the quarters, and opens its window."""
    lo, hi = Vector(lo), Vector(hi)
    for o in objs:
        mw = o.matrix_world

        def inside(f):
            ps = [mw @ v.co for v in f.verts]
            return all(min(p[i] for p in ps) <= hi[i] and max(p[i] for p in ps) >= lo[i] for i in range(3))
        _delete_faces(o, inside)


def cull_to_view(objs, eyes, samples=3, portal=None):
    """Delete every face no eye can see: the far side, module interiors,
    hidden equipment. A face stays if a ray from any eye to its centre or to
    a point near one of its corners hits that face first. Give several eyes
    spread over the window so parallax as the player moves is covered.
    portal = (x, y0, y1, z0, z1) is a window in a plane of constant x: only
    rays that pass through it count. Returns the triangles left."""
    bpy.context.view_layer.update()
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
                if portal:
                    px, y0, y1, z0, z1 = portal
                    if (eye.x - px) * (pt.x - px) >= 0:
                        continue  # the point is on the eye's side of the window
                    s = (px - eye.x) / d.x
                    cross = eye + d * s
                    if not (y0 <= cross.y <= y1 and z0 <= cross.z <= z1):
                        continue
                hit, loc, _, idx, hob, _ = scene.ray_cast(dg, eye, d.normalized(), distance=d.length + 0.05)
                if hit and hob.name == o.name and idx == p.index:
                    keep.add(p.index)
                    break
        _delete_faces(o, lambda f: f.index not in keep)
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
