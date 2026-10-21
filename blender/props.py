"""
Desk props for the control room: operator keyboard, mouse and pad, coffee
mug, gooseneck PA microphone, notepad and pencil.

Each make_*() builds one prop at the origin, standing on z = 0 with its
front toward -Y (the operator), and returns it as a single object with one
material slot per surface. Place it afterwards with place().

These are baked with the room, and a bake stores diffuse light only, so
nothing here is a true metal: steel is a light grey dielectric.
"""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import build as b


def materials():
    """Shared prop materials; safe to call more than once."""
    def flat(key, name, color, rough):
        return key, bpy.data.materials.get(name) or b.mat_flat(name, color, rough)
    m = dict([
        flat("black", "PropBlack", (0.025, 0.025, 0.028), 0.55),
        flat("key", "PropKey", (0.09, 0.09, 0.10), 0.6),
        flat("key_grey", "PropKeyGrey", (0.42, 0.43, 0.45), 0.6),
        flat("key_red", "PropKeyRed", (0.55, 0.05, 0.04), 0.5),
        flat("key_yellow", "PropKeyYellow", (0.75, 0.55, 0.05), 0.5),
        flat("key_green", "PropKeyGreen", (0.10, 0.40, 0.12), 0.5),
        flat("pad", "PropPad", (0.04, 0.045, 0.05), 0.9),
        flat("ceramic", "PropCeramic", (0.82, 0.81, 0.78), 0.15),
        flat("coffee", "PropCoffee", (0.06, 0.03, 0.015), 0.05),
        flat("steel", "PropSteel", (0.55, 0.56, 0.58), 0.35),
        flat("wire", "PropWire", (0.22, 0.23, 0.25), 0.35),
        flat("foam", "PropFoam", (0.03, 0.03, 0.03), 1.0),
        flat("button", "PropButtonRed", (0.65, 0.04, 0.03), 0.4),
        flat("paper", "PropPaper", (0.86, 0.85, 0.80), 0.9),
        flat("card", "PropCard", (0.30, 0.22, 0.14), 0.8),
        flat("paint", "PropPencilPaint", (0.85, 0.60, 0.05), 0.4),
        flat("wood", "PropPencilWood", (0.78, 0.60, 0.40), 0.7),
        flat("eraser", "PropEraser", (0.85, 0.42, 0.45), 0.8),
        flat("fabric", "PropFabric", (0.035, 0.037, 0.042), 0.95),
        flat("alu", "PropAlu", (0.45, 0.46, 0.48), 0.35),
        flat("grille", "PropGrille", (0.06, 0.06, 0.065), 0.9),
        flat("lens", "PropLens", (0.004, 0.005, 0.008), 0.05),
    ])
    m["ruled"] = bpy.data.materials.get("PropRuled") or _ruled_paper()
    return m


def _ruled_paper():
    """Paper with faint blue lines every 7 mm along the page (object Y)."""
    m, nt, bsdf = b._new_mat("PropRuled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    frac = nt.nodes.new("ShaderNodeMath")
    frac.operation = "PINGPONG"  # triangle wave, period 7 mm
    frac.inputs[1].default_value = 0.0035
    nt.links.new(sep.outputs["Y"], frac.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.40, 0.52, 0.75, 1)
    ramp.color_ramp.elements[1].position = 0.0004
    ramp.color_ramp.elements[1].color = (0.86, 0.85, 0.80, 1)
    nt.links.new(frac.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


def place(obj, x, y, z, yaw=0.0):
    obj.matrix_world = Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, "Z")
    return obj


# ------------------------------------------------------------------ builder

def _rot(x=0.0, y=0.0, z=0.0):
    return Euler((x, y, z)).to_matrix().to_4x4()


class Builder:
    """Accumulates primitives into one bmesh. Every operation tags the faces
    it created with the material it was given, adding a slot as needed."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []

    def _new(self, mat, make):
        before = set(self.bm.faces)
        make()
        if mat not in self.slots:
            self.slots.append(mat)
        idx = self.slots.index(mat)
        for f in set(self.bm.faces) - before:
            f.material_index = idx

    def _xform(self, verts, matrix):
        bmesh.ops.transform(self.bm, matrix=matrix, verts=verts)

    def box(self, size, center, mat, orient=Matrix()):
        def make():
            g = bmesh.ops.create_cube(self.bm, size=1.0)
            self._xform(g["verts"], Matrix.Translation(center) @ orient @ Matrix.Diagonal((*size, 1)))
        self._new(mat, make)

    def rbox(self, size, center, mat, radius, segs=3, orient=Matrix(), bend=None):
        """A box with rounded edges. `bend`, if given, maps each local vertex
        (a Vector, before orient and center) to a new one, to curve or taper
        the box."""
        def make():
            g = bmesh.ops.create_cube(self.bm, size=1.0)
            self._xform(g["verts"], Matrix.Diagonal((*size, 1)))
            edges = list({e for v in g["verts"] for e in v.link_edges})
            before = set(self.bm.verts)
            bmesh.ops.bevel(self.bm, geom=g["verts"] + edges, offset=radius, offset_type="OFFSET",
                            segments=segs, profile=0.5, affect="EDGES", clamp_overlap=True)
            live = [v for v in (set(self.bm.verts) - before) | set(g["verts"]) if v.is_valid]
            if bend:
                for v in live:
                    v.co = bend(v.co.copy())
            self._xform(live, Matrix.Translation(center) @ orient)
        self._new(mat, make)

    def cyl(self, r1, r2, h, center, mat, segs=24, orient=Matrix()):
        """Cone or cylinder along local Z, centred on `center`."""
        def make():
            g = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs,
                                      radius1=r1, radius2=r2, depth=h)
            self._xform(g["verts"], Matrix.Translation(center) @ orient)
        self._new(mat, make)

    def lathe(self, profile, mat, segs=48, center=None):
        """Spin a (radius, z) polyline a full turn around Z (through `center`,
        if given)."""
        def make():
            before = set(self.bm.verts)
            vs = [self.bm.verts.new((r, 0, z)) for r, z in profile]
            es = [self.bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
            bmesh.ops.spin(self.bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1),
                           angle=2 * math.pi, steps=segs)
            new = list(set(self.bm.verts) - before)
            bmesh.ops.remove_doubles(self.bm, verts=new, dist=1e-6)
            if center is not None:
                self._xform([v for v in new if v.is_valid], Matrix.Translation(center))
        self._new(mat, make)

    def tube(self, points, radius, mat, segs=12, caps=True, normal=Vector((1, 0, 0))):
        """A round tube along a polyline of Vectors that lies roughly in the
        plane with the given normal (which keeps the rings from twisting)."""
        def make():
            rings, n = [], len(points)
            for i, p in enumerate(points):
                t = (points[min(i + 1, n - 1)] - points[max(i - 1, 0)]).normalized()
                u = normal.cross(t).normalized()
                v = t.cross(u)
                rings.append([self.bm.verts.new(p + radius * (math.cos(2 * math.pi * k / segs) * u +
                                                              math.sin(2 * math.pi * k / segs) * v))
                              for k in range(segs)])
            for i in range(n - 1):
                for k in range(segs):
                    self.bm.faces.new((rings[i][k], rings[i][(k + 1) % segs],
                                       rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
            if caps:
                self.bm.faces.new(rings[0][::-1])
                self.bm.faces.new(rings[-1])
        self._new(mat, make)

    def ring(self, r_in, r_out, width, center, mat, segs=8, orient=Matrix()):
        """A flat washer (annulus with a little thickness) around local Z."""
        def make():
            prof = [(r_in, -width / 2), (r_out, -width / 2), (r_out, width / 2), (r_in, width / 2)]
            vs = [self.bm.verts.new((r, 0, z)) for r, z in prof]
            es = [self.bm.edges.new((vs[i], vs[(i + 1) % 4])) for i in range(4)]
            before = set(self.bm.verts)
            bmesh.ops.spin(self.bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1),
                           angle=2 * math.pi, steps=segs)
            new = (set(self.bm.verts) - before) | set(vs)
            bmesh.ops.remove_doubles(self.bm, verts=list(new), dist=1e-7)
            live = [v for v in new if v.is_valid]
            self._xform(live, Matrix.Translation(center) @ orient)
        self._new(mat, make)

    def done(self, smooth=False):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for mat in self.slots:
            me.materials.append(mat)
        if smooth:
            me.shade_smooth()
        o = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(o)
        return o


def _bezier(p0, p1, p2, n):
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in (i / n for i in range(n + 1))]


# -------------------------------------------------------------------- props

# Full-size ANSI layout in key units (1u = 19.05 mm): per row, a list of
# (width, material key); None is a gap. Rows run front (space bar) to back.
_TYPING = [
    [(1.25, "key"), (1.25, "key"), (1.25, "key"), (6.25, "key"), (1.25, "key"), (1.25, "key"), (1.25, "key"), (1.25, "key")],
    [(2.25, "key")] + [(1, "key")] * 10 + [(2.75, "key")],
    [(1.75, "key")] + [(1, "key")] * 11 + [(2.25, "key")],
    [(1.5, "key")] + [(1, "key")] * 12 + [(1.5, "key")],
    [(1, "key")] * 13 + [(2, "key")],
]
_FUNCTION = [(1, "key"), (1, None)] + [(1, "key_grey")] * 4 + [(0.5, None)] + [(1, "key_grey")] * 4 + \
            [(0.5, None)] + [(1, "key_grey")] * 4  # Esc, F1-F4, F5-F8, F9-F12


def make_keyboard(m, name="Keyboard"):
    """Control-room operator keyboard: a full-size ANSI keyboard (function
    row, typing block, navigation cluster with arrow keys, numeric pad) with
    a block of operator keys on the left: alarm acknowledge and silence in
    red and yellow on top, display and faceplate keys below. The back edge
    sits a little higher than the front."""
    kb = Builder(name)
    u, cap = 0.01905, 0.007
    gap = 0.0035                      # space between neighbouring caps
    tilt = math.radians(3)
    op_w, typing_w, nav_w, num_w = 4.0, 15.0, 3.0, 4.0
    span = op_w + 0.75 + typing_w + 0.5 + nav_w + 0.5 + num_w  # in units
    w, d = span * u + 0.030, 6.5 * u + 0.030
    lift = Matrix.Translation((0, 0, 0.024)) @ _rot(x=tilt)  # body frame: z = 0 is the top surface
    kb.box((w, d, 0.024), lift @ Vector((0, 0, -0.012)), m["black"], orient=_rot(x=tilt))

    left, front = -w / 2 + 0.015, -d / 2 + 0.015  # outer corner of the key field

    def key(col, row, mat, wide=1.0, tall=1.0):
        """A cap whose front-left corner sits at (col, row) in units."""
        x = left + (col + wide / 2) * u
        y = front + (row + tall / 2) * u
        c = lift @ Vector((x, y, cap / 2))
        kb.box((wide * u - gap, tall * u - gap, cap), c, m[mat], orient=_rot(x=tilt))

    def row_of(x, row, keys):
        for width, mat in keys:
            if mat:
                key(x, row, mat, width)
            x += width

    # Operator block, 4 x 6: alarm keys along the back, display keys below
    for col in range(4):
        for row in range(6):
            mat = "key_grey"
            if row == 5:
                mat = ("key_red", "key_red", "key_yellow", "key_yellow")[col]
            elif row == 4 and col == 0:
                mat = "key_green"
            key(col, row if row < 5 else 5.5, mat)
    x0 = op_w + 0.75
    # Typing block and function row (half a unit gap above the number row)
    for row, keys in enumerate(_TYPING):
        row_of(x0, row, keys)
    row_of(x0, 5.5, _FUNCTION)
    # Navigation cluster: arrows, then Ins/Home/PgUp and Del/End/PgDn, then PrtSc/ScrLk/Pause
    xn = x0 + typing_w + 0.5
    key(xn, 0, "key"), key(xn + 1, 0, "key"), key(xn + 2, 0, "key")
    key(xn + 1, 1, "key")
    for col in range(3):
        key(xn + col, 3, "key"), key(xn + col, 4, "key"), key(xn + col, 5.5, "key_grey")
    # Numeric pad: 0 is double wide, + and Enter are double tall
    xp = xn + nav_w + 0.5
    key(xp, 0, "key", wide=2), key(xp + 2, 0, "key")
    for col in range(3):
        key(xp + col, 1, "key"), key(xp + col, 2, "key"), key(xp + col, 3, "key")
    for col in range(4):
        key(xp + col, 4, "key")
    key(xp + 3, 0, "key", tall=2), key(xp + 3, 2, "key", tall=2)
    return kb.done()


def make_mouse(m, name="Mouse"):
    """A plain symmetric mouse: a rounded footprint, narrower at the front,
    with a dome that peaks behind the middle where the palm rests, a short
    vertical skirt, and a scroll wheel set into a slot between the buttons."""
    ms = Builder(name)
    length, n_exp, skirt = 0.114, 3.4, 0.004

    def half_width(y):  # wider toward the palm (+Y is the back)
        return 0.0300 + 0.0025 * (y / (length / 2))

    def height(x, y):
        along = max(0.0, 1 - ((y - 0.014) / 0.072) ** 2)          # profile front to back
        across = max(0.0, 1 - (x / (half_width(y) * 1.05)) ** 2)  # profile side to side
        return skirt + 0.030 * along ** 0.5 * across ** 0.6

    def outline(t):
        c, s = math.cos(t), math.sin(t)
        y = length / 2 * math.copysign(abs(s) ** (2 / n_exp), s)
        x = half_width(y) * math.copysign(abs(c) ** (2 / n_exp), c)
        return x, y

    def make():
        bm, segs, rings = ms.bm, 48, 10
        top = bm.verts.new((0, 0.0, height(0, 0)))
        grid = []
        for i in range(1, rings + 1):
            f = i / rings
            ring = []
            for j in range(segs):
                ox, oy = outline(2 * math.pi * j / segs)
                x, y = ox * f, oy * f
                ring.append(bm.verts.new((x, y, height(x, y) if i < rings else skirt)))
            grid.append(ring)
        base = [bm.verts.new((v.co.x, v.co.y, 0.0)) for v in grid[-1]]
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((top, grid[0][j], grid[0][k]))
            for i in range(rings - 1):
                bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][k], grid[i][k]))
            bm.faces.new((grid[-1][j], base[j], base[k], grid[-1][k]))
        bm.faces.new(base[::-1])
    ms._new(m["key"], make)
    # Seams: one between the two buttons, one across where the buttons end
    seam = [Vector((0, y, height(0, y) + 0.0002)) for y in (-length / 2 + 0.004 + 0.002 * i for i in range(27))]
    ms.tube(seam, 0.0007, m["black"], segs=6)
    hw = half_width(0.004) * 0.92
    across = [Vector((x, 0.004, height(x, 0.004) + 0.0002)) for x in (-hw + 2 * hw * i / 30 for i in range(31))]
    ms.tube(across, 0.0007, m["black"], segs=6, normal=Vector((0, 1, 0)))
    wy = -0.024
    ms.cyl(0.0060, 0.0060, 0.0045, Vector((0, wy, height(0, wy) - 0.0040)), m["black"],  # scroll wheel
           segs=24, orient=_rot(y=math.pi / 2))
    return ms.done(smooth=True)


def make_mousepad(m, name="MousePad"):
    pad = Builder(name)
    pad.box((0.24, 0.20, 0.003), Vector((0, 0, 0.0015)), m["pad"])
    return pad.done()


def _mug(bld, m, at=Vector(), yaw=0.0, coffee=True):
    """Mug geometry on builder bld, standing at `at`, its handle toward
    `yaw` (0: +X). The handle is a C: it leaves the wall nearly level,
    drops straight down the outside and turns back in, rather than a thin
    oval loop."""
    r, h, wall = 0.041, 0.096, 0.004
    rot = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, "Z")
    bld.lathe([(0.0, 0.0), (r - 0.004, 0.0), (r, 0.004), (r + 0.001, h), (r - wall, h),
               (r - wall, 0.008), (0.0, 0.008)], m["ceramic"], segs=32, center=at)
    if coffee:
        bld.cyl(r - wall, r - wall, 0.002, at + Vector((0, 0, 0.066)), m["coffee"], segs=32)

    def sq(v):  # squarer than a sine: a flat outer side with round corners
        return math.copysign(abs(v) ** 0.55, v)
    arc = [rot @ Vector((r - 0.003 + 0.029 * sq(math.sin(t)), 0, 0.053 + 0.028 * sq(math.cos(t))))
           for t in (math.pi * i / 12 for i in range(13))]
    bld.tube(arc, 0.0058, m["ceramic"], segs=8, normal=rot.to_3x3() @ Vector((0, 1, 0)))


def make_mug(m, name="Mug"):
    """Ceramic mug, half full, handle on +X."""
    mug = Builder(name)
    _mug(mug, m)
    return mug.done(smooth=True)


def make_mic(m, name="PaMic"):
    """Desk PA microphone: a weighted base with a red talk button, a
    gooseneck that rises and leans toward the operator, and a foam head."""
    mic = Builder(name)
    mic.cyl(0.058, 0.052, 0.028, Vector((0, 0, 0.014)), m["black"], segs=40)
    mic.cyl(0.011, 0.011, 0.006, Vector((0, -0.030, 0.029)), m["button"], segs=20)
    mic.cyl(0.012, 0.010, 0.012, Vector((0, 0.015, 0.034)), m["steel"], segs=16)
    neck = _bezier(Vector((0, 0.015, 0.038)), Vector((0, 0.035, 0.36)), Vector((0, -0.11, 0.37)), 28)
    mic.tube(neck, 0.0045, m["black"], segs=10)
    tip, t = neck[-1], (neck[-1] - neck[-2]).normalized()
    head = [tip + t * s for s in (0.0, 0.012, 0.055, 0.062)]
    mic.tube(head[:2], 0.0065, m["steel"], segs=16)
    mic.tube(head[1:], 0.011, m["foam"], segs=20)
    return mic.done(smooth=True)


def make_notepad(m, name="Notepad"):
    """A5 wire-bound pad, open to a ruled page, with a row of separate flat
    rings along the top edge."""
    pad = Builder(name)
    w, d = 0.148, 0.210
    pad.box((w, d, 0.0015), Vector((0, 0, 0.00075)), m["card"])
    pad.box((w - 0.002, d - 0.004, 0.007), Vector((0, -0.002, 0.005)), m["paper"])
    pad.box((w - 0.002, d - 0.012, 0.0004), Vector((0, -0.006, 0.0087)), m["ruled"])
    for i in range(23):
        x = -w / 2 + 0.010 + i * (w - 0.020) / 22
        pad.ring(0.0052, 0.0064, 0.0012, Vector((x, d / 2 - 0.003, 0.0045)), m["wire"],
                 segs=10, orient=_rot(y=math.pi / 2))
    return pad.done()


def make_pencil(m, name="Pencil"):
    """Yellow hexagonal pencil lying on a flat, along X, tip toward +X."""
    p = Builder(name)
    r, body = 0.0037, 0.150
    ry = _rot(y=math.pi / 2)            # local Z -> world X
    flat = ry @ _rot(z=math.pi / 6)     # and a flat face down
    z = r * math.cos(math.pi / 6)
    p.cyl(r, r, body, Vector((0, 0, z)), m["paint"], segs=6, orient=flat)
    p.cyl(r, 0.0011, 0.018, Vector((body / 2 + 0.009, 0, z)), m["wood"], segs=6, orient=flat)
    p.cyl(0.0011, 0.0002, 0.004, Vector((body / 2 + 0.020, 0, z)), m["black"], segs=6, orient=flat)
    p.cyl(r * 1.02, r * 1.02, 0.008, Vector((-body / 2 - 0.004, 0, z)), m["steel"], segs=16, orient=ry)
    p.cyl(r * 0.97, r * 0.97, 0.007, Vector((-body / 2 - 0.0115, 0, z)), m["eraser"], segs=16, orient=ry)
    return p.done()


def make_chair(m, name="Chair"):
    """24/7 control-room chair: five-star base on casters, gas lift, padded
    seat, a tall curved back that leans back a little, headrest and T-arms.
    The sitter faces +Y, so the back is toward -Y."""
    c = Builder(name)
    for i in range(5):  # star base
        a = 2 * math.pi * i / 5 + math.pi / 2
        d = Vector((math.cos(a), math.sin(a), 0))
        c.box((0.30, 0.045, 0.028), d * 0.18 + Vector((0, 0, 0.085)), m["alu"], orient=_rot(z=a))
        c.box((0.03, 0.03, 0.04), d * 0.32 + Vector((0, 0, 0.065)), m["black"], orient=_rot(z=a))
        c.cyl(0.028, 0.028, 0.024, d * 0.32 + Vector((0, 0, 0.028)), m["black"], segs=16,
              orient=_rot(z=a) @ _rot(y=math.pi / 2) @ _rot(x=math.pi / 2))
    c.cyl(0.05, 0.045, 0.06, Vector((0, 0, 0.10)), m["alu"], segs=24)
    c.cyl(0.032, 0.028, 0.20, Vector((0, 0, 0.22)), m["black"], segs=20)   # gas-lift sheath
    c.cyl(0.021, 0.021, 0.08, Vector((0, 0, 0.36)), m["steel"], segs=20)
    c.box((0.26, 0.30, 0.05), Vector((0, 0.0, 0.41)), m["black"])           # tilt mechanism
    seat = lambda v: v + Vector((0, 0, 0.12 * (v.x / 0.25) ** 2 * 0.15))   # sides a touch higher
    c.rbox((0.50, 0.48, 0.08), Vector((0, 0.03, 0.47)), m["fabric"], 0.03, orient=Matrix(), bend=seat)
    # Back: wider at the shoulders than the lumbar, curved to wrap the sitter
    def back(v):
        v.x *= 0.92 + 0.08 * (v.z / 0.31)
        v.y += 0.08 * (v.x / 0.23) ** 2
        return v
    tilt = _rot(x=math.radians(10))
    c.rbox((0.47, 0.07, 0.62), Vector((0, -0.26, 0.87)), m["fabric"], 0.03, orient=tilt, bend=back)
    c.box((0.07, 0.17, 0.03), Vector((0, -0.21, 0.41)), m["black"])  # spine: back from the mechanism,
    c.box((0.07, 0.03, 0.30), Vector((0, -0.28, 0.555)), m["black"])  # then up behind the backrest
    head = lambda v: v + Vector((0, 0.05 * (v.x / 0.15) ** 2, 0))
    c.rbox((0.30, 0.07, 0.15), Vector((0, -0.335, 1.29)), m["fabric"], 0.03, orient=tilt, bend=head)
    for x in (-0.08, 0.08):
        c.cyl(0.008, 0.008, 0.10, Vector((x, -0.33, 1.19)), m["steel"], segs=10, orient=tilt)
    for s in (-1, 1):  # T-arms
        c.box((0.17, 0.05, 0.025), Vector((s * 0.19, -0.02, 0.42)), m["black"])
        c.box((0.04, 0.06, 0.21), Vector((s * 0.265, -0.02, 0.53)), m["black"])
        c.rbox((0.085, 0.26, 0.035), Vector((s * 0.265, 0.02, 0.645)), m["black"], 0.012)
    return c.done(smooth=True)


def make_videobar(m, name="VideoBar"):
    """Teleconference camera bar that sits on top of a display: a slim
    rounded body, fabric speaker grille, and the lens in the middle. Its
    front faces -Y."""
    v = Builder(name)
    v.rbox((0.62, 0.065, 0.075), Vector((0, 0, 0.0375)), m["black"], 0.015)
    v.box((0.56, 0.002, 0.05), Vector((0, -0.033, 0.0375)), m["grille"])
    face = _rot(x=math.pi / 2)  # local Z -> -Y
    v.cyl(0.024, 0.024, 0.004, Vector((0, -0.034, 0.0375)), m["black"], segs=24, orient=face)
    v.cyl(0.017, 0.015, 0.004, Vector((0, -0.037, 0.0375)), m["lens"], segs=24, orient=face)
    v.box((0.10, 0.07, 0.012), Vector((0, 0.03, -0.006)), m["black"])  # clamp over the bezel
    return v.done()



def make_touchpanel(m, name="TouchPanel"):
    """Desk touch panel for the room systems (lights, blinds, PA): a glass
    screen on a wedge stand, leaning back toward the operator at -Y."""
    t = Builder(name)
    lean = _rot(x=math.radians(-50))  # top falls away from the operator
    c = Vector((0, 0.02, 0.06))
    t.box((0.12, 0.08, 0.012), Vector((0, 0.03, 0.006)), m["black"])
    t.rbox((0.21, 0.014, 0.14), c, m["black"], 0.006, orient=lean)
    t.box((0.19, 0.002, 0.12), c + lean @ Vector((0, -0.0075, 0)), m["lens"], orient=lean)
    return t.done()


def make_lightpanel(m, name="LightPanel"):
    """Wall keypad for the ceiling lights: an off-white plate with three
    buttons (full, night, off). Its face points -Y; the origin is at the
    middle of the plate's back."""
    w = Builder(name)
    w.rbox((0.09, 0.012, 0.15), Vector((0, -0.006, 0)), m["ceramic"], 0.004)
    for i, z in enumerate((0.04, 0.0, -0.04)):
        w.rbox((0.06, 0.006, 0.03), Vector((0, -0.014, z)), m["key_grey"], 0.003)
    return w.done()


def make_deskphone(m, name="DeskPhone"):
    """IP desk phone: a wedge body that slopes up away from the operator
    (at -Y), a tilted display, a 4 x 3 keypad, line keys beside the display,
    and a handset in its cradle on the left with a coiled cord."""
    p = Builder(name)
    w, d = 0.23, 0.19
    slope = math.radians(28)
    tilt = _rot(x=slope)  # the face leans back, rising toward +Y
    # Body: a low front lip rising to the back
    body = lambda v: v + Vector((0, 0, (v.y / d + 0.5) * 0.05))
    p.rbox((w, d, 0.03), Vector((0, 0, 0.015)), m["black"], 0.008, bend=body)
    face = lambda u, v, lift=0.0: Vector((u, v * math.cos(slope), 0.032 + (v / d + 0.5) * 0.05 + lift))
    # Display, upper right of the face
    p.box((0.10, 0.006, 0.055), face(0.035, 0.045, 0.002), m["key_grey"], orient=tilt @ _rot(x=-math.pi / 2))
    p.box((0.092, 0.002, 0.047), face(0.035, 0.045, 0.005), m["lens"], orient=tilt @ _rot(x=-math.pi / 2))
    for i in range(4):  # line keys left of the display
        p.box((0.014, 0.008, 0.004), face(-0.03, 0.068 - i * 0.015, 0.003), m["key_grey"], orient=tilt)
    for r in range(4):  # keypad, lower right
        for c in range(3):
            p.rbox((0.017, 0.011, 0.005), face(0.012 + c * 0.023, -0.012 - r * 0.016, 0.003), m["key"], 0.002, segs=1, orient=tilt)
    p.rbox((0.03, 0.012, 0.005), face(0.085, -0.03, 0.003), m["key_red"], 0.002, segs=1, orient=tilt)  # hang-up
    p.rbox((0.03, 0.012, 0.005), face(0.085, -0.05, 0.003), m["key_green"], 0.002, segs=1, orient=tilt)
    # Handset in a cradle along the left edge: a long bar with ear and mouth cups
    hx = -0.085
    p.rbox((0.05, 0.18, 0.025), Vector((hx, 0.0, 0.065)), m["black"], 0.012, orient=tilt)
    for y in (-0.07, 0.07):
        p.rbox((0.052, 0.05, 0.022), Vector((hx, y * math.cos(slope), 0.065 + y * math.sin(slope) - 0.012)),
               m["black"], 0.01, orient=tilt)
    # Coiled cord from the bottom of the handset to the left side of the body
    coil = []
    for i in range(121):
        t = i / 120
        base = Vector((hx - 0.03 - 0.015 * t, -0.08 + 0.10 * t, 0.03 - 0.02 * math.sin(math.pi * t)))
        a = t * 2 * math.pi * 14
        coil.append(base + Vector((0.004 * math.cos(a), 0, 0.004 * math.sin(a))))
    p.tube(coil, 0.0012, m["black"], segs=6, normal=Vector((1, 0, 0)))
    return p.done()


def make_ptz_camera(m, name="PtzCamera", drop=0.45):
    """Pan-tilt-zoom conference camera hanging upside down from a ceiling
    pole. The origin is on the ceiling, everything hangs below z = 0, and
    the lens looks toward -Y."""
    c = Builder(name)
    c.cyl(0.05, 0.05, 0.01, Vector((0, 0, -0.005)), m["ceramic"], segs=24)           # ceiling plate
    c.cyl(0.018, 0.018, drop, Vector((0, 0, -drop / 2)), m["ceramic"], segs=16)      # pole
    c.box((0.10, 0.10, 0.012), Vector((0, 0, -drop - 0.006)), m["ceramic"])          # mounting plate
    # Base turret (upside down: it hangs from the plate), then the yoke and head
    c.cyl(0.065, 0.06, 0.04, Vector((0, 0, -drop - 0.032)), m["ceramic"], segs=32)
    c.cyl(0.02, 0.02, 0.01, Vector((0, -0.055, -drop - 0.02)), m["lens"], segs=10,
          orient=_rot(x=math.pi / 2))                                                 # status LED
    for s in (-1, 1):
        c.box((0.012, 0.05, 0.07), Vector((s * 0.052, 0, -drop - 0.082)), m["ceramic"])
    head = _rot(x=math.radians(-12))  # tipped down toward the room
    c.rbox((0.09, 0.11, 0.085), Vector((0, 0, -drop - 0.10)), m["ceramic"], 0.03, orient=head)
    lens = _rot(x=math.pi / 2 - math.radians(12))
    hc = Vector((0, 0, -drop - 0.10))
    c.cyl(0.032, 0.032, 0.01, hc + head @ Vector((0, -0.056, 0)), m["black"], segs=32, orient=lens)
    c.cyl(0.024, 0.022, 0.006, hc + head @ Vector((0, -0.063, 0)), m["lens"], segs=32, orient=lens)
    return c.done(smooth=True)


def make_ceiling_tv(m, name="CeilingTv", size=(1.24, 0.72), drop=0.5):
    """Black 55" TV hanging from a ceiling pole, switched off. The origin is
    on the ceiling; the screen faces -Y and its top edge is `drop` below."""
    w, h = size
    t = Builder(name)
    t.box((w, 0.05, h), Vector((0, 0.01, -drop - h / 2)), m["black"])
    t.box((w - 0.02, 0.002, h - 0.02), Vector((0, -0.016, -drop - h / 2)), m["lens"])
    t.box((0.40, 0.03, 0.30), Vector((0, 0.05, -drop - h / 2)), m["black"])         # wall-plate on the back
    t.cyl(0.03, 0.03, drop + h / 2, Vector((0, 0.08, -(drop + h / 2) / 2)), m["black"], segs=16)
    t.cyl(0.08, 0.08, 0.01, Vector((0, 0.08, -0.005)), m["black"], segs=24)
    t.box((0.12, 0.06, 0.04), Vector((0, 0.065, -drop - h / 2 + 0.17)), m["black"])  # tilt bracket
    return t.done()


def make_whiteboard(m, name="Whiteboard", size=(2.4, 1.2), face=None, stand=None):
    """Wall whiteboard with an aluminium frame and a pen tray. `face` is the
    material for the writing surface (see board_material); the surface is a
    child object named <name>Face, so the bake can give it its own texture.
    The origin is at the middle of the back, the face points -Y. With
    `stand` (the height of that middle above the floor) it is a mobile board
    on two legs with castors instead."""
    w, h = size
    surface = Builder(name + "Face")
    surface.box((w, 0.012, h), Vector((0, -0.006, 0)), face or m["paper"])
    surface = surface.done()
    wb = Builder(name)
    f = 0.02
    for s in (-1, 1):
        wb.box((w + 2 * f, 0.02, f), Vector((0, -0.01, s * (h + f) / 2)), m["alu"])
        wb.box((f, 0.02, h), Vector((s * (w + f) / 2, -0.01, 0)), m["alu"])
    wb.box((w * 0.6, 0.06, 0.012), Vector((0, -0.04, -h / 2 - f - 0.006)), m["alu"])  # pen tray
    wb.box((w * 0.6, 0.004, 0.025), Vector((0, -0.068, -h / 2 - f + 0.004)), m["alu"])
    for i, mat in enumerate((m["key_red"], m["key_green"], m["black"])):  # markers
        wb.cyl(0.008, 0.008, 0.13, Vector((-0.2 + i * 0.05, -0.04, -h / 2 - f + 0.008)), mat, segs=10,
               orient=_rot(y=math.pi / 2))
    if stand:
        for s in (-1, 1):  # side legs from the top of the frame to the floor, on castor feet
            x = s * (w / 2 + f + 0.02)
            wb.box((0.035, 0.035, stand + h / 2 + 0.05), Vector((x, 0.0, (h / 2 + 0.05 - stand) / 2)), m["alu"])
            wb.box((0.05, 0.60, 0.035), Vector((x, 0.0, -stand + 0.09)), m["alu"])
            for t in (-1, 1):
                wb.cyl(0.03, 0.03, 0.025, Vector((x, t * 0.27, -stand + 0.035)), m["black"], segs=12,
                       orient=_rot(y=math.pi / 2))
    frame = wb.done()
    surface.parent = frame
    return frame


def board_material(name, path, size):
    """Image over a whiteboard face of the given size (w, h), mapped from
    the object's own coordinates (x across, z up), so no UVs are needed."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    w, h = size
    mt, nt, bsdf = b._new_mat(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(path)
    img.interpolation = "Cubic"
    img.extension = "EXTEND"
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    for axis, out, size_ in (("X", "X", w), ("Z", "Y", h)):
        mad = nt.nodes.new("ShaderNodeMath")
        mad.operation = "MULTIPLY_ADD"
        mad.inputs[1].default_value = 1 / size_
        mad.inputs[2].default_value = 0.5
        nt.links.new(sep.outputs[axis], mad.inputs[0])
        nt.links.new(mad.outputs[0], comb.inputs[out])
    nt.links.new(comb.outputs["Vector"], img.inputs["Vector"])
    nt.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.25  # glossy board
    return mt


def make_ceiling_mic(m, name="CeilingMic", drop=0.55):
    """Hanging ceiling microphone for room audio: a small white ceiling
    rose, a thin white cord, and a slim capsule at the end with a dark
    grille pointing down. The origin is on the ceiling; it hangs below."""
    c = Builder(name)
    c.cyl(0.022, 0.018, 0.012, Vector((0, 0, -0.006)), m["ceramic"], segs=16)  # ceiling rose
    c.cyl(0.0018, 0.0018, drop, Vector((0, 0, -drop / 2)), m["ceramic"], segs=6)  # cord
    c.cyl(0.004, 0.0075, 0.012, Vector((0, 0, -drop - 0.006)), m["ceramic"], segs=12)  # strain relief
    c.cyl(0.0075, 0.0075, 0.045, Vector((0, 0, -drop - 0.0345)), m["ceramic"], segs=16)  # capsule
    c.cyl(0.0072, 0.0065, 0.006, Vector((0, 0, -drop - 0.060)), m["grille"], segs=16)   # grille
    return c.done(smooth=True)


# ------------------------------------------------- room furniture (rear)

def _room_mats(m):
    def flat(name, color, rough):
        return bpy.data.materials.get(name) or b.mat_flat(name, color, rough)
    return {
        "cabinet": flat("PropCabinet", (0.80, 0.81, 0.80), 0.5),
        "lamp_red": flat("PropLampRed", (0.70, 0.06, 0.04), 0.3),
        "lamp_green": flat("PropLampGreen", (0.10, 0.60, 0.20), 0.3),
        "button_blue": flat("PropButtonBlue", (0.04, 0.08, 0.30), 0.4),
        "fg_red": flat("PropFireRed", (0.62, 0.10, 0.05), 0.5),
        "shelf": flat("PropShelfGrey", (0.36, 0.37, 0.38), 0.6),
        "sofa": flat("PropSofa", (0.42, 0.13, 0.28), 0.95),       # the lounge's magenta upholstery
        "white": flat("PropWhiteTop", (0.84, 0.84, 0.82), 0.4),
        "leaf": flat("PropLeaf", (0.08, 0.22, 0.07), 0.7),
        "leaf_light": flat("PropLeafLight", (0.16, 0.34, 0.10), 0.7),
        "cane": flat("PropCane", (0.28, 0.21, 0.13), 0.8),
        "soil": flat("PropSoil", (0.05, 0.035, 0.025), 1.0),
        "glass": flat("PropGlass", (0.50, 0.54, 0.56), 0.1),   # an empty jug: reads as glass catching the light
        "tank": flat("PropTank", (0.62, 0.66, 0.68), 0.2),     # frosted water tank
        "pot": flat("PropPot", (0.12, 0.12, 0.13), 0.6),
        "binders": [flat(f"PropBinder{i}", c, 0.6) for i, c in
                    enumerate([(0.08, 0.16, 0.42), (0.40, 0.40, 0.42), (0.55, 0.08, 0.06), (0.06, 0.06, 0.07),
                               (0.70, 0.62, 0.20)])],
    }


def make_esd_panel(m, name="EsdPanel", face=None, size=(1.6, 2.0)):
    """Fire & gas / ESD CAP cabinet: a tall grey steel cabinet whose front
    is printed (the child <name>Face, so the bake can give it its own
    texture, like a whiteboard), with lit push buttons and key switches
    standing out of it at boards.ESD_PARTS, and two door handles on the
    left. Stands on the floor against a wall; the front faces -Y."""
    from boards import ESD_PARTS
    rm = _room_mats(m)
    w, h = size
    d, z0 = 0.45, 0.10  # depth, plinth
    surface = Builder(name + "Face")  # centred on its own origin, which board_material maps from
    surface.box((w, 0.004, h), Vector((0, -d - 0.002, 0)), face or rm["cabinet"])
    surface = surface.done()
    surface.location = (0, 0, z0 + h / 2)
    c = Builder(name)
    c.box((w + 0.06, d, h + 0.06), Vector((0, -d / 2, z0 + h / 2)), rm["cabinet"])
    c.box((w + 0.02, d - 0.04, z0), Vector((0, -d / 2, z0 / 2)), m["black"])  # plinth
    top = z0 + h  # the texture's y runs down from here, in metres
    for zz in (0.42, 1.12):  # door handles on the left edge
        c.box((0.025, 0.035, 0.13), Vector((-w / 2 + 0.015, -d - 0.02, top - zz)), m["steel"])
    face_y = -d - 0.004
    for x, y, kind in ESD_PARTS:
        at = Vector((-w / 2 + x, face_y, top - y))
        if kind == "key":
            c.cyl(0.016, 0.016, 0.012, at + Vector((0, -0.006, 0)), m["black"], segs=12, orient=_rot(x=math.pi / 2))
            c.box((0.008, 0.016, 0.026), at + Vector((0, -0.018, 0)), m["steel"])
            continue
        mat = {"red": rm["lamp_red"], "grey": m["key_grey"], "lamp": rm["cabinet"],
               "black": m["black"], "blue": rm["button_blue"]}[kind]
        c.box((0.030, 0.012, 0.030), at + Vector((0, -0.006, 0)), mat)
    frame = c.done()
    surface.parent = frame
    return frame


def make_fg_panel(m, name="FgPanel"):
    """Fire & gas panel: a red wall-mounted unit with a small display and a
    button block. Origin on the wall at its middle; the front faces -Y."""
    rm = _room_mats(m)
    p = Builder(name)
    p.rbox((0.34, 0.10, 0.42), Vector((0, -0.05, 0)), rm["fg_red"], 0.01, segs=2)
    p.box((0.20, 0.01, 0.10), Vector((0, -0.105, 0.10)), m["lens"])
    p.box((0.22, 0.01, 0.14), Vector((0, -0.105, -0.07)), m["black"])
    for i in range(3):
        for j in range(2):
            p.box((0.05, 0.01, 0.035), Vector((-0.06 + i * 0.06, -0.112, -0.04 - j * 0.05)), m["key_grey"])
    return p.done()


def make_shelving(m, name="Shelving", size=(1.6, 0.40, 1.80), face=None):
    """Open grey shelving unit full of ring binders. Origin at the back,
    middle, on the floor; the open side faces -Y. The binders are one flat
    face (the child <name>Face) carrying a painted image of their spines
    (see boards.binder_spines and SHELVES below), which the bake gives its
    own texture like a whiteboard: a few hundred triangles instead of
    thousands of little boxes."""
    rm = _room_mats(m)
    w, d, h = size
    s = Builder(name)
    for x in (-w / 2, w / 2):
        s.box((0.025, d, h), Vector((x, -d / 2, h / 2)), rm["shelf"])
    s.box((w, 0.01, h), Vector((0, -0.005, h / 2)), rm["shelf"])
    for z in shelf_heights(h):
        s.box((w, d, 0.025), Vector((0, -d / 2, z)), rm["shelf"])
    fw, fh, z0 = shelving_face(size)
    surface = Builder(name + "Face")  # centred on its own origin, which board_material maps from
    surface.box((fw, 0.004, fh), Vector((0, -0.32, 0)), face or rm["shelf"])
    surface = surface.done()
    surface.location = (0, 0, z0 + fh / 2)
    frame = s.done()
    surface.parent = frame
    return frame


def shelf_heights(h, shelves=5):
    return [0.05 + k * (h - 0.05) / (shelves - 1) for k in range(shelves)]


def shelving_face(size):
    """Width, height and bottom of the binder face for a unit of this size."""
    w, _, h = size
    z0 = 0.05 + 0.0125
    return w - 0.025, h - z0, z0


def make_link_stand(m, name="LinkStand", size=(1.9, 1.08), centre=1.55):
    """Floor stand for the big video-link screen: two uprights on long feet
    and a cross bar behind the screen. Origin on the floor, centred; the
    screen hangs in front of it (toward -Y)."""
    w, h = size
    s = Builder(name)
    for x in (-0.45, 0.45):
        s.box((0.08, 0.06, centre + 0.25), Vector((x, 0.06, (centre + 0.25) / 2)), m["alu"])
        s.box((0.09, 0.70, 0.04), Vector((x, 0.0, 0.02)), m["alu"])
        for t in (-1, 1):
            s.cyl(0.03, 0.03, 0.03, Vector((x, t * 0.32, 0.015)), m["black"], segs=10)
    s.box((1.0, 0.05, 0.10), Vector((0, 0.06, centre)), m["alu"])
    s.box((0.80, 0.05, 0.08), Vector((0, 0.06, 0.45)), m["alu"])  # lower bar with a shelf for the codec
    s.box((0.80, 0.30, 0.02), Vector((0, -0.05, 0.50)), m["alu"])
    s.box((0.40, 0.25, 0.06), Vector((0, -0.05, 0.54)), m["black"])
    return s.done()


def make_pillar(m, name="Pillar", size=(0.40, 0.40), height=2.9):
    """Dark concrete column, floor to ceiling, with a black skirting."""
    w, d = size
    concrete = bpy.data.materials.get("PropConcrete") or b.mat_flat("PropConcrete", (0.20, 0.20, 0.21), 0.85)
    p = Builder(name)
    p.box((w, d, height), Vector((0, 0, height / 2)), concrete)
    p.box((w + 0.01, d + 0.01, 0.08), Vector((0, 0, 0.04)), m["black"])
    return p.done()


def make_sofa(m, name="Sofa", w=2.0):
    """Low lounge sofa in magenta upholstery with arms. Origin at the back,
    middle, on the floor; the seat faces -Y."""
    rm = _room_mats(m)
    d = 0.85
    s = Builder(name)
    s.rbox((w, d - 0.12, 0.40), Vector((0, -d / 2 - 0.06, 0.22)), rm["sofa"], 0.04)      # base and seat
    s.rbox((w, 0.20, 0.42), Vector((0, -0.10, 0.62)), rm["sofa"], 0.05)                  # back
    for x in (-w / 2 + 0.09, w / 2 - 0.09):
        s.rbox((0.18, d, 0.58), Vector((x, -d / 2, 0.31)), rm["sofa"], 0.04)            # arms
    for x in (-w / 2 + 0.1, w / 2 - 0.1):
        for y in (-0.08, -d + 0.08):
            s.box((0.04, 0.04, 0.04), Vector((x, y, 0.02)), m["black"])
    return s.done()


def make_coffee_table(m, name="CoffeeTable", size=(1.1, 0.55), height=0.42):
    rm = _room_mats(m)
    w, d = size
    t = Builder(name)
    t.box((w, d, 0.03), Vector((0, 0, height - 0.015)), rm["white"])
    for x in (-w / 2 + 0.05, w / 2 - 0.05):
        for y in (-d / 2 + 0.05, d / 2 - 0.05):
            t.cyl(0.015, 0.015, height - 0.03, Vector((x, y, (height - 0.03) / 2)), m["steel"], segs=10)
    t.box((0.30, 0.22, 0.03), Vector((0.15, 0.02, height + 0.015)), m["paper"])  # magazines
    t.cyl(0.13, 0.07, 0.08, Vector((-0.25, 0.0, height + 0.04)), m["ceramic"], segs=24)  # fruit bowl
    return t.done()


def make_kitchenette(m, name="Kitchenette", w=1.8):
    """Counter for the rest corner: base cabinets with a white top, an
    under-counter mini fridge at the right end, a filter coffee machine with
    its glass jug, a pump thermos and a few mugs. Origin at the back,
    middle, on the floor; the front faces -Y."""
    rm = _room_mats(m)
    d, h = 0.60, 0.90
    k = Builder(name)
    k.box((w, d, 0.03), Vector((0, -d / 2, h - 0.015)), rm["white"])
    k.box((w - 0.60, d - 0.05, h - 0.13), Vector((-0.30, -d / 2 + 0.02, (h - 0.13) / 2 + 0.10)), rm["shelf"])
    k.box((w - 0.60, d - 0.08, 0.10), Vector((-0.30, -d / 2 + 0.03, 0.05)), m["black"])  # plinth
    for i in range(3):  # cabinet doors and handles
        x = -w / 2 + 0.20 + i * 0.40
        k.box((0.39, 0.01, h - 0.16), Vector((x, -d + 0.02, (h - 0.16) / 2 + 0.11)), rm["shelf"])
        k.box((0.12, 0.02, 0.012), Vector((x, -d + 0.005, h - 0.10)), m["steel"])
    # Mini fridge, under the counter at the right end
    fx = w / 2 - 0.30
    k.rbox((0.56, d - 0.04, h - 0.06), Vector((fx, -d / 2, (h - 0.06) / 2)), rm["white"], 0.015, segs=2)
    k.box((0.012, 0.02, 0.30), Vector((fx - 0.24, -d + 0.01, h - 0.30)), m["steel"])
    k.box((0.50, 0.003, 0.003), Vector((fx, -d + 0.02, h - 0.10)), m["key_grey"])
    # Filter coffee machine with a glass jug, on the counter
    _coffee_machine(k, m, rm, -0.35, -0.02, h)
    top = h
    # Pump thermos and mugs
    _pump_thermos(k, m, 0.10, -0.25, top)
    for x, y, yaw in [(0.32, -0.30, 0.4), (0.44, -0.20, 2.0), (0.40, -0.42, -1.2)]:
        _mug(k, m, Vector((x, y, top)), yaw, coffee=False)
    return k.done()


def _coffee_machine(k, m, rm, x, y, z):
    """A filter coffee machine (the classic Dutch kind every platform has)
    on builder k, its back at (x, y), standing at height z, facing -Y.
    Proportions of the real thing, 17 wide, 32 deep and 36 cm tall: a long
    base with the hot plate and switch, an aluminium column at the back
    carrying the frosted water tank, an outlet arm from the tank top over
    the cone-shaped brew basket, which sits in a holder on the column just
    above the jug, and a glass jug with handle and lid, a third full."""
    V = lambda dx, dy, dz: Vector((x + dx, y + dy, z + dz))  # noqa: E731
    jy = -0.225  # jug and basket centre, in front of the column
    k.rbox((0.17, 0.32, 0.04), V(0, -0.16, 0.02), m["black"], 0.012, segs=2)            # base
    k.cyl(0.064, 0.064, 0.006, V(0, jy, 0.043), m["steel"], segs=24)                     # hot plate
    k.box((0.012, 0.035, 0.018), V(0.086, -0.06, 0.022), m["black"])                     # rocker switch on the side
    k.box((0.004, 0.012, 0.008), V(0.093, -0.06, 0.024), rm["lamp_red"])
    k.rbox((0.10, 0.07, 0.17), V(0, -0.045, 0.04 + 0.085), m["alu"], 0.012, segs=2)     # column
    k.rbox((0.165, 0.12, 0.14), V(0, -0.065, 0.21 + 0.07), rm["tank"], 0.015, segs=2)   # water tank
    k.rbox((0.17, 0.125, 0.012), V(0, -0.065, 0.356), m["black"], 0.005, segs=2)        # its lid
    for i in range(5):  # cup marks on the tank's side
        k.box((0.002, 0.03 if i % 2 else 0.05, 0.003), V(-0.0835, -0.065, 0.23 + i * 0.025), m["black"])
    k.rbox((0.04, 0.13, 0.02), V(0, -0.18, 0.338), m["black"], 0.006, segs=2)            # outlet arm
    k.rbox((0.10, 0.06, 0.012), V(0, -0.105, 0.205), m["alu"], 0.004, segs=1)           # basket holder
    # Brew basket: a cone sitting in the holder, its drip stop just above the jug lid
    k.lathe([(0.0, 0.198), (0.028, 0.198), (0.032, 0.206), (0.068, 0.300), (0.071, 0.305), (0.0, 0.305)],
            m["black"], segs=24, center=V(0, jy, 0))
    k.box((0.028, 0.03, 0.01), V(0, jy - 0.082, 0.295), m["black"])                     # its handle tab
    # Jug: wide at the bottom, narrowing to the neck, a black lid and handle
    coffee = [(0.0, 0.046), (0.062, 0.046), (0.066, 0.058), (0.067, 0.09)]
    glass = [(0.067, 0.09), (0.064, 0.13), (0.052, 0.165), (0.053, 0.175)]
    k.lathe(coffee, m["coffee"], segs=24, center=V(0, jy, 0))
    k.lathe(glass, rm["glass"], segs=24, center=V(0, jy, 0))
    k.cyl(0.056, 0.036, 0.016, V(0, jy, 0.183), m["black"], segs=24)                    # lid
    k.tube([V(0.05, jy, 0.168), V(0.092, jy, 0.163), V(0.097, jy, 0.10), V(0.066, jy, 0.07)], 0.007,
           m["black"], segs=8, normal=Vector((0, 1, 0)))


def _pump_thermos(k, m, x, y, z):
    """A pump-action airpot on builder k, standing at (x, y, z), spout
    toward -Y: a black foot, a steel body, a black head with a domed pump
    button, the spout, and a carry handle arching over the top."""
    V = lambda dx, dy, dz: Vector((x + dx, y + dy, z + dz))  # noqa: E731
    k.lathe([(0.0, 0.0), (0.078, 0.0), (0.080, 0.01), (0.077, 0.03), (0.0, 0.03)], m["black"], segs=20, center=V(0, 0, 0))
    k.lathe([(0.0, 0.03), (0.073, 0.03), (0.074, 0.25), (0.0, 0.25)], m["steel"], segs=20, center=V(0, 0, 0))
    k.lathe([(0.0, 0.25), (0.076, 0.25), (0.077, 0.285), (0.062, 0.315), (0.035, 0.325), (0.0, 0.325)],
            m["black"], segs=20, center=V(0, 0, 0))
    k.lathe([(0.0, 0.322), (0.032, 0.322), (0.030, 0.338), (0.018, 0.346), (0.0, 0.348)], m["key_grey"], segs=16,
            center=V(0, 0, 0))
    k.rbox((0.030, 0.07, 0.026), V(0, -0.085, 0.292), m["black"], 0.008, segs=1,          # spout
           bend=lambda v: v + Vector((0, 0, -0.25 * max(0.0, -v.y))))
    arch = [V(0.078 * math.cos(t), 0.0, 0.29 + 0.085 * math.sin(t)) for t in (math.pi * i / 10 for i in range(11))]
    k.tube(arch, 0.007, m["black"], segs=6, normal=Vector((0, 1, 0)))                    # carry handle


def _text(bld, text, size, center, mat, orient=Matrix()):
    """Flat lettering on builder bld, centred on `center`, in the XY plane
    of `orient` (the default faces +Z). Few curve steps, to keep it light."""
    def make():
        cu = bpy.data.curves.new("Lettering", "FONT")
        cu.body, cu.size, cu.resolution_u = text, size, 2
        cu.align_x, cu.align_y = "CENTER", "CENTER"
        tmp = bpy.data.objects.new("Lettering", cu)
        bpy.context.collection.objects.link(tmp)
        me = tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        xf = Matrix.Translation(center) @ orient
        vs = [bld.bm.verts.new(xf @ v.co) for v in me.vertices]
        for f in me.polygons:
            bld.bm.faces.new([vs[i] for i in f.vertices])
        tmp.to_mesh_clear()
        bpy.data.objects.remove(tmp)
        bpy.data.curves.remove(cu)
    bld._new(mat, make)


CLOCK_TIME = (2, 47, 30)  # night shift: the hands are set to 02:47:30


def make_wall_clock(m, name="WallClock", style="station", live=False):
    """Round wall clock, its back on the wall at y = 0, the dial facing -Y,
    centred on the origin. Styles:
    station: the railway clock: thin aluminium rim, white dial, thick black
             bars instead of numerals, black bar hands and a red second hand
             ending in a disc.
    office:  a deep black plastic case, white dial with numerals 1 to 12,
             slim black hands and a thin red second hand.
    dark:    a rounded square dark grey case with a near-black dial, white
             bars and hands, and an orange second hand: quiet at night.
    Returns the clock. With `live`, returns [clock, hour, minute, second
    hand]: the hands are their own objects named <name>HourHand and so on,
    pointing at 12, with the same origin as the clock (the dial's centre),
    so the game can turn them about the dial's axis to the in-game time.
    Otherwise the hands are part of the clock, set to CLOCK_TIME."""
    rm = _room_mats(m)
    c = Builder(name)
    face_y = Matrix.Rotation(math.radians(90), 4, "X")   # local Z -> -Y: discs face the room
    hh, mm, ss = (0, 0, 0) if live else CLOCK_TIME
    H, M, S = (Builder(name + k) for k in ("HourHand", "MinuteHand", "SecondHand")) if live else (c, c, c)

    def radial(a, w, t, length, r_mid, y, mat, bld=c):  # a bar along the dial's radius at clock angle a
        orient = Matrix.Rotation(a, 4, "Y")
        bld.box((w, t, length), Vector((math.sin(a) * r_mid, y, math.cos(a) * r_mid)), mat, orient)

    def hand(bld, a, w, length, tail, y, mat, t=0.003):
        radial(a, w, t, length + tail, (length - tail) / 2, y, mat, bld)

    a_h = 2 * math.pi * ((hh % 12) + mm / 60) / 12
    a_m = 2 * math.pi * (mm + ss / 60) / 60
    a_s = 2 * math.pi * ss / 60

    if style == "station":
        R = 0.175
        c.cyl(R, R, 0.035, Vector((0, -0.0175, 0)), m["alu"], segs=40, orient=face_y)
        c.ring(R - 0.010, R + 0.003, 0.012, Vector((0, -0.041, 0)), m["alu"], segs=40, orient=face_y)
        c.cyl(R - 0.010, R - 0.010, 0.002, Vector((0, -0.036, 0)), m["paper"], segs=40, orient=face_y)
        for i in range(60):
            a = 2 * math.pi * i / 60
            if i % 5:
                radial(a, 0.0035, 0.002, 0.012, R - 0.026, -0.0375, m["black"])
            else:
                radial(a, 0.010, 0.002, 0.040, R - 0.040, -0.0375, m["black"])
        hand(H, a_h, 0.013, 0.095, 0.03, -0.040, m["black"])
        hand(M, a_m, 0.010, 0.140, 0.03, -0.043, m["black"])
        hand(S, a_s, 0.0035, 0.100, 0.04, -0.046, rm["fg_red"], t=0.002)
        S.cyl(0.013, 0.013, 0.002, Vector((math.sin(a_s) * 0.10, -0.046, math.cos(a_s) * 0.10)), rm["fg_red"],
              segs=12, orient=face_y)
        S.cyl(0.006, 0.006, 0.012, Vector((0, -0.044, 0)), rm["fg_red"], segs=10, orient=face_y)
    elif style == "office":
        R = 0.15
        c.cyl(R + 0.012, R + 0.012, 0.045, Vector((0, -0.0225, 0)), m["black"], segs=40, orient=face_y)
        c.ring(R - 0.004, R + 0.014, 0.012, Vector((0, -0.050, 0)), m["black"], segs=40, orient=face_y)
        c.cyl(R - 0.004, R - 0.004, 0.002, Vector((0, -0.046, 0)), m["paper"], segs=40, orient=face_y)
        for i in range(60):
            a = 2 * math.pi * i / 60
            radial(a, 0.004 if i % 5 == 0 else 0.0018, 0.002, 0.012 if i % 5 == 0 else 0.007,
                   R - 0.014, -0.0475, m["black"])
        lettering = face_y  # upright, readable from the room
        for n in range(1, 13):
            a = 2 * math.pi * n / 12
            _text(c, str(n), 0.032, Vector((math.sin(a) * (R - 0.040), -0.0475, math.cos(a) * (R - 0.040))),
                  m["black"], lettering)
        hand(H, a_h, 0.008, 0.075, 0.015, -0.050, m["black"])
        hand(M, a_m, 0.006, 0.115, 0.015, -0.052, m["black"])
        hand(S, a_s, 0.002, 0.120, 0.03, -0.054, rm["fg_red"], t=0.002)
        S.cyl(0.007, 0.007, 0.010, Vector((0, -0.052, 0)), m["black"], segs=10, orient=face_y)
    else:  # dark
        R = 0.15
        c.rbox((0.34, 0.04, 0.34), Vector((0, -0.02, 0)), m["key"], 0.04, segs=3)
        c.cyl(R, R, 0.002, Vector((0, -0.0405, 0)), m["black"], segs=40, orient=face_y)
        for i in range(12):
            a = 2 * math.pi * i / 12
            radial(a, 0.008 if i % 3 == 0 else 0.005, 0.002, 0.034 if i % 3 == 0 else 0.022,
                   R - 0.028, -0.042, m["paper"])
        hand(H, a_h, 0.010, 0.080, 0.0, -0.044, m["paper"])
        hand(M, a_m, 0.007, 0.120, 0.0, -0.046, m["paper"])
        hand(S, a_s, 0.0025, 0.125, 0.03, -0.048, m["paint"], t=0.002)
        S.cyl(0.008, 0.008, 0.010, Vector((0, -0.046, 0)), m["paint"], segs=10, orient=face_y)
    if live:
        return [c.done(), H.done(), M.done(), S.done()]
    return c.done()


def _blade(bld, base, heading, rise, length, width, droop, mat, segs=5, fold=0.25, thick=0.0015, taper=1.4):
    """One strap leaf on builder bld: a thin solid ribbon from `base`
    leaving at angle `rise` above the horizontal toward `heading` (radians),
    arching down by `droop`, widest a third of the way along, with a fold
    along the midrib. Its root sits on the stem, so nothing floats. A lower
    `taper` keeps the leaf wide further out, for a rounder tip."""
    def make():
        d = Vector((math.cos(heading), math.sin(heading), 0))
        side = Vector((0, 0, 1)).cross(d).normalized()
        top, bot = [], []
        for i in range(segs + 1):
            t = i / segs
            c = base + d * (length * t * math.cos(rise)) + Vector((0, 0, length * t * math.sin(rise) - droop * length * t * t))
            ahead = d * math.cos(rise) + Vector((0, 0, math.sin(rise) - 2 * droop * t))
            n = side.cross(ahead).normalized()
            if n.z < 0:
                n = -n
            w = width * max(0.08, math.sin(math.pi * min(t * taper, 1)) ** 0.7) * (0.35 + 0.65 * min(t * 3, 1)) / 2
            row = [c - side * w - n * w * fold, c, c + side * w - n * w * fold]
            top.append([bld.bm.verts.new(p) for p in row])
            bot.append([bld.bm.verts.new(p - n * thick) for p in row])
        for i in range(segs):
            for j in range(2):
                bld.bm.faces.new((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]))
                bld.bm.faces.new((bot[i][j + 1], bot[i][j], bot[i + 1][j], bot[i + 1][j + 1]))
            for j in (0, 2):
                bld.bm.faces.new((top[i][j], top[i + 1][j], bot[i + 1][j], bot[i][j]))
        bld.bm.faces.new((top[0][0], bot[0][0], bot[0][1], bot[0][2], top[0][2], top[0][1]))
        bld.bm.faces.new((top[-1][0], top[-1][1], top[-1][2], bot[-1][2], bot[-1][1], bot[-1][0]))
    bld._new(mat, make)


def make_plant(m, name="Plant", height=1.4, light=False):
    """Tall office dracaena: three bare canes of different heights in a
    dark pot, each topped by a rosette of arching strap leaves that grow
    out of the cane (upright in the middle, drooping further out).
    `light` gives about half the triangles: fewer leaves, each bent fewer
    times, and coarser pot and canes."""
    rm = _room_mats(m)
    p = Builder(name)
    round_ = 16 if light else 24
    p.cyl(0.16, 0.20, 0.42, Vector((0, 0, 0.21)), rm["pot"], segs=round_)
    p.cyl(0.185, 0.185, 0.01, Vector((0, 0, 0.395)), rm["soil"], segs=round_)
    rng = __import__("random").Random(len(name) * 7)
    for c, (frac, ox, oy) in enumerate([(1.0, 0.03, -0.02), (0.78, -0.06, 0.03), (0.6, 0.05, 0.06)]):
        top = 0.40 + (height - 0.65) * frac
        lean = Vector((ox, oy, 0)) * 1.5
        foot, tip = Vector((ox, oy, 0.39)), Vector((ox, oy, top)) + lean
        p.tube([foot, (foot + tip) / 2 + lean * 0.1, tip], 0.014 - 0.002 * c, rm["cane"], segs=6 if light else 8,
               normal=Vector((-oy, ox, 0)).normalized() if (ox or oy) else Vector((1, 0, 0)))
        n = 13 - 2 * c if light else 18 - 3 * c
        for i in range(n):
            u = i / (n - 1)                         # 0: innermost, upright; 1: outermost, drooping
            z = tip.z - 0.16 * u                    # the older leaves sit lower down the cane
            at = foot.lerp(tip, (z - foot.z) / (tip.z - foot.z))
            _blade(p, at, i * 2.4 + c + rng.uniform(-0.2, 0.2), math.radians(75 - 55 * u + rng.uniform(-6, 6)),
                   0.30 + 0.18 * u + rng.uniform(-0.03, 0.03), 0.06, 0.25 + 0.55 * u,
                   rm["leaf"] if (i + c) % 3 else rm["leaf_light"], segs=3 if light else 5)
    return p.done()


def make_fern(m, name="Fern", leaves=9):
    """Small bird's-nest fern in a terracotta pot, for counters and shelves
    (after Poly Haven's Fern 02, whose leaf outlines come from a
    transparency texture that the baked atlas can't carry): a rosette of
    broad strap leaves, the inner ones upright, the outer ones arching over
    the rim. About 1,500 triangles."""
    rm = _room_mats(m)
    clay = bpy.data.materials.get("PropTerracotta") or b.mat_flat("PropTerracotta", (0.42, 0.19, 0.11), 0.85)
    f = Builder(name)
    f.lathe([(0.0, 0.0), (0.072, 0.0), (0.094, 0.135), (0.104, 0.138), (0.106, 0.165), (0.090, 0.165),
             (0.088, 0.150), (0.0, 0.150)], clay, segs=20)
    f.cyl(0.088, 0.088, 0.006, Vector((0, 0, 0.148)), rm["soil"], segs=20)
    rng = __import__("random").Random(len(name) * 13)
    for i in range(leaves):
        u = i / (leaves - 1)                      # 0: inner and upright; 1: outer, arching over the rim
        heading = i * 2.4 + rng.uniform(-0.2, 0.2)
        base = Vector((math.cos(heading), math.sin(heading), 0)) * 0.015 * u + Vector((0, 0, 0.15))
        _blade(f, base, heading, math.radians(84 - 30 * u + rng.uniform(-5, 5)),
               0.30 + 0.06 * u + rng.uniform(-0.03, 0.03), 0.08, 0.25 + 0.4 * u,
               rm["leaf_light"] if i % 3 else rm["leaf"], segs=6, fold=0.15, taper=1.0)
    return f.done()


def make_coffee_machine(m, name="CoffeeMachine"):
    """The filter coffee machine on its own (the kitchenette builds it into
    its counter), its back on y = 0."""
    k = Builder(name)
    _coffee_machine(k, m, _room_mats(m), 0, 0, 0)
    return k.done()


def make_thermos(m, name="Thermos"):
    """The pump airpot on its own (the kitchenette builds it into its counter)."""
    k = Builder(name)
    _pump_thermos(k, m, 0, 0, 0)
    return k.done()


def make_kettle(m, name="Kettle"):
    """The cordless electric kettle on its power base (CC0, OpenGameArt; see
    blender/assets/README.md), with its flat colour swatches mapped onto our
    prop materials. Stands on z = 0; 24.5 cm tall."""
    rm = _room_mats(m)
    swap = {"KettleBlack": m["black"], "KettleGrey": m["key"], "KettleWindow": m["key_grey"],
            "KettleOrange": rm["lamp_red"]}
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets",
                                                    "electric_kettle.glb"))
    o = next(x for x in bpy.data.objects if x not in before and x.type == "MESH")
    for i, mt in enumerate(o.data.materials):
        o.data.materials[i] = swap[mt.name.split(".")[0]]
    # glTF stores every flat face with its own corners; weld them again, or
    # the bake unwraps each face as its own atlas island (a few texels each,
    # which bleed into one another)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data)
    bm.free()
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=math.radians(40))
    o.name = o.data.name = name
    return o


ALL = [make_keyboard, make_mouse, make_mousepad, make_mug, make_mic, make_notepad, make_pencil,
       make_chair, make_videobar, make_touchpanel, make_lightpanel, make_deskphone, make_ptz_camera,
       make_ceiling_tv, make_whiteboard, make_ceiling_mic, make_esd_panel, make_fg_panel, make_shelving,
       make_link_stand, make_pillar, make_sofa, make_coffee_table, make_kitchenette, make_plant,
       make_coffee_machine, make_thermos, make_kettle, make_fern, make_wall_clock]
