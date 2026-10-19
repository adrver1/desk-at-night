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
        flat("foam", "PropFoam", (0.03, 0.03, 0.03), 1.0),
        flat("button", "PropButtonRed", (0.65, 0.04, 0.03), 0.4),
        flat("paper", "PropPaper", (0.86, 0.85, 0.80), 0.9),
        flat("card", "PropCard", (0.30, 0.22, 0.14), 0.8),
        flat("paint", "PropPencilPaint", (0.85, 0.60, 0.05), 0.4),
        flat("wood", "PropPencilWood", (0.78, 0.60, 0.40), 0.7),
        flat("eraser", "PropEraser", (0.85, 0.42, 0.45), 0.8),
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

def make_keyboard(m, name="Keyboard"):
    """Wide DCS operator keyboard: a block of alarm and display keys on the
    left, a typing block in the middle and a numeric pad on the right, with
    a row of function keys above. Its back edge sits a little higher."""
    kb = Builder(name)
    pitch, key, cap = 0.019, 0.0155, 0.007
    w, d, tilt = 0.53, 0.175, math.radians(3)
    lift = Matrix.Translation((0, 0, 0.024)) @ _rot(x=tilt)  # body frame: z = 0 is the top surface
    kb.box((w, d, 0.024), lift @ Vector((0, 0, -0.012)), m["black"], orient=_rot(x=tilt))

    def key_at(x, y, mat, wide=1.0):
        c = lift @ Vector((x, y, cap / 2))
        kb.box((key + (wide - 1) * pitch, key, cap), c, mat, orient=_rot(x=tilt))

    y0 = -d / 2 + 0.018
    # Left: 6 x 5 operator block (alarm acknowledge, silence, display keys)
    accents = {(0, 4): m["key_red"], (1, 4): m["key_yellow"], (2, 4): m["key_green"],
               (0, 3): m["key_red"], (1, 3): m["key_yellow"]}
    for col in range(6):
        for row in range(5):
            key_at(-w / 2 + 0.022 + col * pitch, y0 + row * pitch, accents.get((col, row), m["key_grey"]))
    # Middle: 14 x 4 typing block plus a bottom row with a space bar
    x0 = -w / 2 + 0.022 + 6 * pitch + 0.016
    for row in range(1, 5):
        for col in range(14):
            key_at(x0 + col * pitch, y0 + row * pitch, m["key"])
    for col in (0, 1, 2, 11, 12, 13):
        key_at(x0 + col * pitch, y0, m["key"])
    key_at(x0 + 6.5 * pitch, y0, m["key"], wide=8)
    # Function row across the typing block
    for col in range(14):
        key_at(x0 + col * pitch, y0 + 5 * pitch + 0.006, m["key_grey"])
    # Right: 4 x 5 numeric pad
    x1 = x0 + 14 * pitch + 0.016
    for col in range(4):
        for row in range(5):
            key_at(x1 + col * pitch, y0 + row * pitch, m["key"])
    return kb.done()


def make_mouse(m, name="Mouse"):
    """A plain right-handed mouse: a squashed sphere with a flat bottom and
    a scroll wheel."""
    ms = Builder(name)

    def make():
        g = bmesh.ops.create_uvsphere(ms.bm, u_segments=32, v_segments=16, radius=1.0)
        for v in g["verts"]:
            x, y, z = v.co
            back = 1.0 + 0.15 * max(y, 0)  # a little fuller toward the palm
            v.co = Vector((0.031 * x * back, 0.058 * y, max(0.0, 0.034 * z + 0.004 * (y + 1) - 0.004)))
    ms._new(m["black"], make)
    ms.cyl(0.006, 0.006, 0.005, Vector((0, -0.025, 0.026)), m["key_grey"], segs=16, orient=_rot(y=math.pi / 2))
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
    """A5 spiral-bound pad, open to a ruled page, binding along the top."""
    pad = Builder(name)
    w, d = 0.148, 0.210
    pad.box((w, d, 0.0015), Vector((0, 0, 0.00075)), m["card"])
    pad.box((w - 0.002, d - 0.004, 0.007), Vector((0, -0.002, 0.005)), m["paper"])
    pad.box((w - 0.002, d - 0.012, 0.0004), Vector((0, -0.006, 0.0087)), m["ruled"])
    for i in range(23):
        x = -w / 2 + 0.010 + i * (w - 0.020) / 22
        loop = [Vector((x, d / 2 - 0.006 + 0.0045 * math.sin(t), 0.0045 + 0.0060 * math.cos(t)))
                for t in (2 * math.pi * k / 12 for k in range(13))]
        pad.tube(loop, 0.0006, m["steel"], segs=6, caps=False)
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


ALL = [make_keyboard, make_mouse, make_mousepad, make_mug, make_mic, make_notepad, make_pencil]
