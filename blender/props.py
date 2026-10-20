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

    def lathe(self, profile, mat, segs=48):
        """Spin a (radius, z) polyline a full turn around Z."""
        def make():
            vs = [self.bm.verts.new((r, 0, z)) for r, z in profile]
            es = [self.bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
            bmesh.ops.spin(self.bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1),
                           angle=2 * math.pi, steps=segs)
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
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


def make_mug(m, name="Mug"):
    """Ceramic mug, half full, handle on +X."""
    mug = Builder(name)
    r, h, wall = 0.041, 0.096, 0.004
    mug.lathe([(0.0, 0.0), (r - 0.004, 0.0), (r, 0.004), (r + 0.001, h), (r - wall, h),
               (r - wall, 0.008), (0.0, 0.008)], m["ceramic"])
    mug.cyl(r - wall, r - wall, 0.002, Vector((0, 0, 0.066)), m["coffee"], segs=48)
    arc = [Vector((r - 0.002 + 0.022 * math.sin(t), 0, 0.050 + 0.030 * math.cos(t)))
           for t in (math.pi * i / 16 for i in range(17))]
    mug.tube(arc, 0.0055, m["ceramic"], segs=10, normal=Vector((0, 1, 0)))
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


def make_whiteboard(m, name="Whiteboard", size=(2.4, 1.2), face=None):
    """Wall whiteboard with an aluminium frame and a pen tray. `face` is the
    material for the writing surface (see board_material); the surface is a
    child object named <name>Face, so the bake can give it its own texture.
    The origin is at the middle of the back, the face points -Y."""
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


ALL = [make_keyboard, make_mouse, make_mousepad, make_mug, make_mic, make_notepad, make_pencil,
       make_chair, make_videobar, make_touchpanel, make_lightpanel, make_deskphone, make_ptz_camera,
       make_ceiling_tv, make_whiteboard]
