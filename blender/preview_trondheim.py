"""Preview of the "one year ago" Trondheim scene: Torvet, the Olav Tryggvason
column and Føniks, opening on the drone view (B) and gliding down to the
character at the Føniks door (A).

    .venv/bin/python blender/preview_trondheim.py [--samples 16] [--res 960] [--out DIR]
    SHOTS=B_wide,A_street ...   renders only those shots
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import bmesh  # noqa: E402

bpy = b.bpy
Vector = b.Vector
ROOT = b.ROOT

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=16)
p.add_argument("--out", default=os.path.join(b.BUILD, "trondheim"))
p.add_argument("--glb", help="export only Føniks (with its annex and fountain) to this .glb and stop")
p.add_argument("--res", type=int, default=960)
args = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


M = {k: b.mat_flat("Trd" + k, srgb(v), r) for k, (v, r) in {
    "cobble": ("#8a8780", 0.95), "granite": ("#a7a49d", 0.8), "dark": ("#3b3e41", 0.6),
    "bronze": ("#4f6b5d", 0.45), "glass": ("#2a3540", 0.15), "phoenix": ("#d8c8ae", 0.75),
    "roof": ("#5e4b40", 0.8), "road": ("#505356", 0.9), "tree": ("#4f6a35", 1.0),
    "trunk": ("#4a3a2c", 1.0), "c1": ("#c9a77c", 0.8), "c2": ("#b46a4f", 0.8),
    "c3": ("#e2ddcf", 0.8), "c4": ("#8f9b8a", 0.8), "c5": ("#c7b07a", 0.8),
    "brick": ("#8e3b2e", 0.85), "brick_dark": ("#6e3d31", 0.85), "pink": ("#c9776a", 0.8),
    "torg": ("#cdbf9f", 0.8), "glass_block": ("#4d5f6a", 0.4), "red": ("#d8262c", 0.5), "verdigris": ("#4f9a8f", 0.5), "hill": ("#3d5235", 1.0), "wood": ("#6b3f26", 0.6), "steel": ("#7d8488", 0.4), "flag": ("#f4f4f1", 0.8),
    "logo_magenta": ("#c42a72", 0.6), "logo_orange": ("#ec8a3c", 0.6), "logo_green": ("#2e9a52", 0.6), "tile": ("#2b3a3c", 0.5), "water": ("#2f7f86", 0.1), "frame": ("#efede6", 0.6), "slate": ("#3a3d42", 0.7), "roof_light": ("#8f9498", 0.8),
    "copper": ("#6e3a2c", 0.55), "plinth": ("#59625d", 0.8), "amber": ("#61798a", 0.08), "glass_curve": ("#86a3b8", 0.06), "skylight": ("#c9cdcf", 0.5), "door": ("#4a2c1e", 0.5),
    "bronze_dark": ("#2f3a33", 0.45), "gold": ("#b8913a", 0.35), "travertine": ("#dcd2bf", 0.8), "orange": ("#c9583a", 0.8),
}.items()}


def box(name, loc, size, mat, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=(0, 0, rot))
    o = bpy.context.object
    o.name, o.scale = name, size
    o.data.materials.append(M[mat])
    return o


def cyl(name, loc, r, h, mat, n=8, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r if r2 is None else r2, depth=h,
                                    location=(loc[0], loc[1], loc[2] + h / 2))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(M[mat])
    return o


def facade(name, x0, x1, y0, y1, h, mat, floors, faces=("-y",)):
    """A block with window rows on the faces toward the square."""
    box(name, ((x0 + x1) / 2, (y0 + y1) / 2, h / 2), (x1 - x0, y1 - y0, h), mat)
    box(name + "Roof", ((x0 + x1) / 2, (y0 + y1) / 2, h + 1.2), (x1 - x0 - 1, y1 - y0 - 1, 2.4), "roof")
    fh = h / floors
    for f, face in ((f, face) for f in range(1, floors) for face in faces):
        z = f * fh + fh * 0.45
        if face in ("-y", "+y"):
            y = y0 - 0.05 if face == "-y" else y1 + 0.05
            n = int((x1 - x0) / 3.2)
            for i in range(n):
                x = x0 + (i + 0.5) * (x1 - x0) / n
                box(f"{name}W", (x, y, z), (1.3, 0.2, fh * 0.5), "glass")
        else:
            x = x0 - 0.05 if face == "-x" else x1 + 0.05
            n = int((y1 - y0) / 3.2)
            for i in range(n):
                y = y0 + (i + 0.5) * (y1 - y0) / n
                box(f"{name}W", (x, y, z), (0.2, 1.3, fh * 0.5), "glass")


def prism(name, pts, z0, z1, mat):
    """A straight prism over a convex outline pts (counter-clockwise seen from above)."""
    n = len(pts)
    v = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    f = [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M[mat])
    return o


def frustum(name, c, z, w0, d0, w1, d1, h, mat):
    """A box that narrows from w0 x d0 at the bottom to w1 x d1 at the top."""
    x, y = c
    v = [(x + sx * w / 2, y + sy * d / 2, zz) for (w, d, zz) in ((w0, d0, z), (w1, d1, z + h))
         for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M[mat])
    return o


def tri(name, pts, z, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x, y, z) for x, y in pts], [], [tuple(range(len(pts)))])
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M[mat])


def paving(name, size):
    """Today's Torvet: grey granite slabs in a loose light/dark checker (2 m squares)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    tc = nt.nodes.new("ShaderNodeTexCoord")
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = size / 1.5
    chk.inputs["Color1"].default_value = (*srgb("#b4b7b8"), 1)
    chk.inputs["Color2"].default_value = (*srgb("#9da1a3"), 1)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = size / 6.0
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["Factor"].default_value = 0.25
    nt.links.new(tc.outputs["UV"], chk.inputs["Vector"])
    nt.links.new(tc.outputs["UV"], noise.inputs["Vector"])
    nt.links.new(chk.outputs["Color"], mix.inputs[6])
    nt.links.new(noise.outputs["Fac"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


# Layout (x east, y north, metres, the column at the origin), measured from Adriaen's
# two drone photos (cameras fitted to the 18 m column), then corrected against a
# Google 3D top-down view at ~0.128 m per pixel.
# Trondheim Torg along the west side facing east, the green pavilion in front of it,
# Kongens gate (bus stops) leaving west at y ~ -15..15, Føniks on the corner north of it
# with its phoenix front facing EAST, the pink wooden house right after it, Munkegata
# running north between tree rows, the café block along the north side, the yellow
# 1950s block on the south side and Munkegata running south past it to the cathedral
SQ_W, SQ_E, SQ_S, SQ_N = -44.5, 42.0, -49.0, 43.0
FONIKS_FRONT, FONIKS_SOUTH, FW = -44.5, 20.5, 38.0   # Føniks: front line, south end, length

M["lamp"] = b.mat_flat("TrdLamp", (1, 1, 1), 0.3)
box("Ground", (0, 0, -0.05), (500, 500, 0.1), "road")


def paved(x0, x1, y0, y1, name="Paving", z=0.03):
    bpy.ops.mesh.primitive_plane_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, z))
    o = bpy.context.object
    o.name, o.scale = name, (x1 - x0, y1 - y0, 1)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(paving("TrdPaving" + name, max(x1 - x0, y1 - y0)))
    return o


paved(SQ_W, SQ_E, SQ_S, SQ_N)                       # the square
for k in range(16):   # the compass star in dark stone, long and short points
    a = k / 16 * math.tau + math.pi / 16
    r = 10.5 if k % 2 == 0 else 6.5
    w = 0.22 if k % 2 == 0 else 0.32
    tri("Rose", [(r * math.cos(a), r * math.sin(a)), (4.6 * math.cos(a + w), 4.6 * math.sin(a + w)),
                 (4.6 * math.cos(a - w), 4.6 * math.sin(a - w))], 0.05, "dark")
cyl("RoseRing", (0, 0, 0), 5.0, 0.07, "dark", 32)
cyl("Octagon", (0, 0, 0), 4.3, 0.18, "granite", 8)
for i, w in enumerate((4.6, 3.7, 2.8)):
    frustum("Step", (0, 0), 0.18 + i * 0.35, w, w, w, w, 0.35, "granite")
frustum("Pedestal", (0, 0), 1.23, 1.5, 1.5, 1.3, 1.3, 1.0, "granite")
frustum("Shaft", (0, 0), 2.23, 1.05, 1.05, 0.95, 0.95, 10.0, "granite")
frustum("Band", (0, 0), 12.23, 1.0, 1.0, 1.0, 1.0, 0.3, "dark")
frustum("Capital", (0, 0), 12.53, 0.98, 0.98, 1.7, 1.7, 0.8, "granite")
frustum("Cornice", (0, 0), 13.33, 1.9, 1.9, 2.6, 2.6, 0.25, "granite")
frustum("Slab", (0, 0), 13.58, 2.6, 2.6, 2.4, 2.4, 0.22, "granite")
frustum("Plinth", (0, 0), 13.8, 1.3, 1.1, 1.3, 1.1, 0.3, "bronze")
TOP = 14.1


def _logo():
    """The Aker BP ribbon logo, read from the PPE outfit so there is one source."""
    import ast
    src = open(os.path.join(ROOT, "characters", "_shared", "outfits.py")).read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "LOGO")
    return ast.literal_eval(node.value)


LOGO = _logo()


def flag_mast(x, y, h=9.0):
    """A white mast with a hanging banner flag: white, the logo on both faces."""
    cyl("Mast", (x, y, 0), 0.06, h, "frame", 6)
    cyl("Truck", (x, y, h), 0.1, 0.12, "frame", 4)
    fw, fh, top = 1.0, 2.6, h - 0.4
    fx = x + 0.08 + fw / 2
    box("Flag", (fx, y, top - fh / 2), (fw, 0.02, fh), "flag")
    box("FlagBar", (fx, y, top), (fw + 0.1, 0.04, 0.04), "frame")
    lw, lh, lz = 0.8, 0.95, top - fh * 0.42
    for face in (-1, 1):
        for k, (swatch, outline) in enumerate(LOGO):
            u0 = (lambda u: -u) if face > 0 else (lambda u: u)   # mirror on the back so it reads from both sides
            off = face * (0.0115 + 0.002 * k)   # each ribbon a hair above the last, so overlaps don't flicker
            pts = [(fx + u0(u - 0.5) * lw, y + off, lz + (v - 0.5) * lh) for u, v in outline]
            me = bpy.data.meshes.new("Logo")
            me.from_pydata(pts, [], [tuple(range(len(pts)))])
            o = bpy.data.objects.new("Logo", me)
            scene.collection.objects.link(o)
            me.materials.append(M[swatch])
            o.modifiers.new("Tri", "TRIANGULATE").quad_method = "BEAUTY"


def window(x, z, y, w=1.35, h=2.1, arch=False, side=False):
    """A white-framed window with the white cross (mullion + transom) of the old hotel.
    Faces -y, or -x with side=True (then x is along the wall and y is the wall line)."""
    def B(name, cx, cz, sx, sz, dy, mat):
        if side:
            box(name, (y - dy, cx, cz), (0.12, sx, sz), mat)
        else:
            box(name, (cx, y - dy, cz), (sx, 0.12, sz), mat)
    B("WinFrame", x, z, w + 0.3, h + 0.3, 0.05, "frame")
    B("Win", x, z, w, h, 0.1, "glass")
    B("Mullion", x, z, 0.1, h, 0.18, "frame")
    B("Transom", x, z + h * 0.2, w, 0.1, 0.18, "frame")
    if arch:   # a round glazed head: two flat half discs, frame behind glass
        halfdisc("WinFrame", x, z + h / 2, w / 2 + 0.15, y - 0.11, "frame", side=side)
        halfdisc("Win", x, z + h / 2, w / 2, y - 0.16, "glass", side=side)


def halfdisc(name, cx, cz, r, y, mat, n=8, side=False):
    """A flat half disc facing -y (or -x with side=True, then cx runs along the wall and
    y is the wall line): a fanlight or the top of an arch, one face."""
    arc = [(cx + r * math.cos(math.pi * k / n), cz + r * math.sin(math.pi * k / n)) for k in range(n + 1)]
    pts = [(y, u, z) for u, z in arc[::-1]] if side else [(u, y, z) for u, z in arc]
    me = bpy.data.meshes.new(name)
    me.from_pydata(pts, [], [tuple(range(n + 1))])   # counter-clockwise seen from the front
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M[mat])
    return o


def balcony_door(x, z, w=1.5, h=3.65):
    """A tall door onto the front balcony (2025 photo): set in the brick under a cream
    arch with a keystone, a round sunburst fanlight over the white double door."""
    top = z + h / 2
    box("DoorArch", (x, -0.16, (z - h / 2 + top) / 2), (w + 0.7, 0.08, h), "phoenix")
    halfdisc("DoorArch", x, top, w / 2 + 0.35, -0.2, "phoenix")
    box("Keystone", (x, -0.26, top + w / 2 + 0.2), (0.32, 0.08, 0.5), "phoenix")
    window(x, z, -0.12, w, h)
    halfdisc("WinFrame", x, top, w / 2 + 0.12, -0.235, "frame")
    halfdisc("Win", x, top, w / 2, -0.285, "glass")
    for k in (1, 2, 3):   # the sunburst bars
        a = math.pi * k / 4
        b = box("Mullion", (x + 0.27 * w * math.cos(a), -0.33, top + 0.27 * w * math.sin(a)), (0.54 * w, 0.06, 0.06), "frame")
        b.rotation_euler = (0, -a, 0)


def rib(path, leg, at, quarter, r, z0, side):
    """A dark glazing bar over the curved eave: a thin strip following the quarter
    round, across leg `leg` of the path at coordinate `at` along it."""
    a_, b_ = Vector(path[leg]), Vector(path[leg + 1])
    t = (b_ - a_).normalized()
    n = Vector((-t.y, t.x)) * side
    p = a_ + t * ((at - a_.x) / t.x if abs(t.x) > 0.5 else (at - a_.y) / t.y)
    verts, faces = [], []
    for k, (c, sn) in enumerate(quarter):
        d, z = r - r * c, z0 + r * sn
        q = p + n * (d - 0.03 * c)   # a hair proud of the glass, along its normal
        verts += [(*(q - t * 0.05), z + 0.03 * sn), (*(q + t * 0.05), z + 0.03 * sn)]
        if k:
            faces.append((2 * k - 2, 2 * k - 1, 2 * k + 1, 2 * k))
    me = bpy.data.meshes.new("Rib")
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new("Rib", me)
    scene.collection.objects.link(o)
    me.materials.append(M["dark"])


def sweep(name, path, profile, side, mat):
    """A profile swept along a 2D path with mitred corners: profile points are
    (distance off the path, height); side 1 offsets to the left of the walk direction,
    -1 to the right. The open ends get flat caps."""
    P = [Vector((x, y)) for x, y in path]
    normals = []
    for a_, b_ in zip(P, P[1:]):
        t = (b_ - a_).normalized()
        normals.append(Vector((-t.y, t.x)) * side)
    rings = []
    for i, p in enumerate(P):
        if i == 0:
            m = normals[0]
        elif i == len(P) - 1:
            m = normals[-1]
        else:
            n1, n2 = normals[i - 1], normals[i]
            m = (n1 + n2) / (1 + n1.dot(n2))   # mitre: keeps the offset true on both legs
        rings.append([(p.x + m.x * d, p.y + m.y * d, z) for d, z in profile])
    verts = [v for r_ in rings for v in r_]
    n = len(profile)
    faces = [(i * n + j, i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j)
             for i in range(len(P) - 1) for j in range(n - 1)]
    for i, far in ((0, profile[-1][0]), (len(P) - 1, profile[-1][0])):   # end caps
        base = len(verts)
        p, m = P[i], normals[0 if i == 0 else -1]
        verts.append((p.x + m.x * far, p.y + m.y * far, profile[0][1]))
        faces.append(tuple(range(i * n, i * n + n)) + (base,))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M[mat])
    return o


def dormer(u, face, eave, side):
    """A mansard dormer as on the close-up: cream cheeks, a shallow arched hood, a tall
    two-pane window in a white frame with one vertical bar. Faces -y (or -x with
    side=True); u runs along the wall, face is where its front stands."""
    def P(along, out, z):   # along the wall, out from the front (negative = forward)
        return (face + out, along, z) if side else (along, face + out, z)
    def B(name, along, out, z, w, d, h, mat):
        box(name, P(along, out, z), (d, w, h) if side else (w, d, h), mat)
    B("Dormer", u, 0.8, eave + 1.8, 1.6, 1.6, 2.4, "phoenix")             # z eave+0.6 .. +3.0
    B("DormerFrame", u, -0.02, eave + 1.75, 1.2, 0.06, 2.25, "frame")
    B("DormerWin", u, -0.06, eave + 1.75, 1.02, 0.06, 2.1, "glass")
    B("DormerBar", u, -0.1, eave + 1.75, 0.08, 0.06, 2.1, "frame")
    # the hood: a round-topped arch, extruded back into the roof
    n, w, rise, z0 = 6, 1.65, 0.55, eave + 3.0
    arc = [(-w / 2 + w * k / n, z0 + rise * (1 - (2 * k / n - 1) ** 2)) for k in range(n + 1)]
    ring = lambda out: [P(u + a_, out, z) for a_, z in arc]   # closes along its flat base
    front, back = ring(-0.05), ring(1.6)
    m = len(front)
    faces = [tuple(range(m)), tuple(range(2 * m - 1, m - 1, -1))]
    faces += [(i, i + 1, m + i + 1, m + i) for i in range(n)] + [(0, m, 2 * m - 1, n)]   # top, then base
    me = bpy.data.meshes.new("DormerHood")
    me.from_pydata(front + back, [], faces)
    me.validate()
    o = bpy.data.objects.new("DormerHood", me)
    scene.collection.objects.link(o)
    me.materials.append(M["phoenix"])


def skylight(loc, r=0.45):
    """A round roof light: a flat white disc lying on the roof."""
    bpy.ops.mesh.primitive_circle_add(vertices=6, radius=r, fill_type="NGON", location=loc)
    o = bpy.context.object
    o.name = "Skylight"
    o.data.materials.append(M["skylight"])


def curved_eave(x, y, length, rot_deg, r=1.0, z=3.1):
    """The conservatory's rounded glass eave: a quarter barrel along one outer edge."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r, depth=length, location=(x, y, z),
                                        rotation=(0, math.radians(90), math.radians(rot_deg)))
    o = bpy.context.object
    o.name = "CurvedEave"
    o.data.materials.append(M["glass_block"])
    return o


def foniks():
    """Føniks (the 1916 Hotel Phoenix) as on the 2011 photo, built facing -y with its
    south end at x = 0: ground floor + three floors of cream render, wide red brick
    corner piers, two light side bays brought forward with top-floor balconies, the
    middle four bays between brick pilasters with arched first-floor windows, a steep
    slate mansard with eight round-topped dormers. Ten window columns, white crosses.
    In front: the glass conservatory on the left, the ramp and the stairs up to a
    landing, the balcony across the doors, four flag masts and the phoenix fountain."""
    L, PIER, BAY = FW, FW * 0.128, FW * 0.189
    BD = 1.6   # how far the side bays stand out: as far as the middle balcony
    eave, depth = 16.8, 12.8   # depth from Adriaen's GPS pins (SE and SW roof corners)
    cx = L / 2
    box("Foniks", (cx, depth / 2, eave / 2), (L, depth, eave), "phoenix")
    box("FoniksPlinth", (cx, -0.12, 0.5), (L + 0.2, 0.3, 1.0), "plinth")   # dark green-grey base
    box("FoniksCornice", (cx, depth / 2, eave - 0.2), (L + 0.8, depth + 0.8, 0.45), "frame")
    frustum("FoniksMansard", (cx, depth / 2), eave, L + 0.6, depth + 0.6, L - 3.4, depth - 3.4, 3.6, "slate")
    frustum("FoniksRoof", (cx, depth / 2), eave + 3.6, L - 3.4, depth - 3.4, L - 14, 3, 2.6, "slate")
    for x in (8.5, L - 8.5):
        box("Chimney", (x, depth / 2 + 2, eave + 6.2), (1.6, 1.2, 2.0), "dark")
    # Cream corners and pilasters, red brick panels between the middle pilasters
    # from above the ground floor up (2024 photos)
    mid0, mid1 = PIER + BAY, L - PIER - BAY
    cols = [(mid0 + (i + 0.5) * (mid1 - mid0) / 4) for i in range(4)]
    bw = (mid1 - mid0) / 4
    for x0 in (0.0, L - PIER):   # brick corner piers, as on the south wall (aerial photo)
        box("BrickPier", (x0 + PIER / 2, -0.05, (5.0 + eave - 1.2) / 2), (PIER, 0.12, eave - 1.2 - 5.0), "brick")
    for x in (PIER - 0.35, L - PIER + 0.35):   # a cream strip between each pier and its bay
        box("PierStrip", (x, -0.07, (5.0 + eave - 1.2) / 2), (0.7, 0.12, eave - 1.2 - 5.0), "phoenix")
    for x in cols:
        box("BrickPanel", (x, -0.05, (5.45 + eave - 0.6) / 2), (bw - 0.75, 0.12, eave - 0.6 - 5.45), "brick")   # pilasters ~0.75 m
        box("Cartouche", (x, -0.14, 12.95), (1.3, 0.12, 0.7), "phoenix")   # carved relief between the upper windows
    for i in range(5):   # capitals on the cream pilasters under the cornice
        box("Capital", (mid0 + i * bw, -0.16, eave - 1.2), (1.9, 0.2, 0.7), "phoenix")
    # The north bay's ground floor steps out again into a half-octagon with big
    # windows and a small dark lead roof (2025 photos)
    ox, OP, OF, OH = L - PIER - BAY / 2, 1.2, 3.6, 4.3   # centre, how far out, front width, height
    oct_ = [(ox - OF / 2 - OP, -BD), (ox - OF / 2, -BD - OP), (ox + OF / 2, -BD - OP), (ox + OF / 2 + OP, -BD)]
    prism("Oriel", oct_ + [(ox + OF / 2 + OP, -BD + 0.1), (ox - OF / 2 - OP, -BD + 0.1)], 0, OH, "phoenix")
    grow = lambda pts, d: [(x + d * (1 if x > ox else -1) * (abs(x - ox) > 0.1), y - d * (y < -BD + 0.01)) for x, y in pts]
    prism("OrielPlinth", grow(oct_, 0.04) + [(ox + OF / 2 + OP + 0.04, -BD + 0.1), (ox - OF / 2 - OP - 0.04, -BD + 0.1)], 0, 1.0, "plinth")
    eav = grow(oct_, 0.3)   # roof: from the eave line out past the walls up to the bay wall
    hood = [(x, y, OH) for x, y in eav] + [(eav[3][0], -BD + 0.05, OH + 0.75), (eav[0][0], -BD + 0.05, OH + 0.75)]
    me = bpy.data.meshes.new("OrielRoof")
    me.from_pydata(hood, [], [(0, 1, 2, 3), (0, 3, 4, 5), (0, 1, 5), (1, 2, 4, 5), (2, 3, 4)])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("OrielRoof", me)
    scene.collection.objects.link(o)
    me.materials.append(M["dark"])
    window(ox, 2.75, -BD - OP, 3.0, 2.3)
    for sx in (-1, 1):   # narrow windows in the angled sides
        a = math.radians(45 * sx)
        cxw, cyw = ox + sx * (OF / 2 + OP / 2), -BD - OP / 2
        n = (sx * 0.7071, -0.7071)
        box("WinFrame", (cxw + n[0] * 0.05, cyw + n[1] * 0.05, 2.75), (1.2, 0.12, 2.6), "frame", a)
        box("Win", (cxw + n[0] * 0.1, cyw + n[1] * 0.1, 2.75), (0.95, 0.12, 2.3), "glass", a)
    for bx in (PIER + BAY / 2, L - PIER - BAY / 2):   # the side bays come forward
        # the bays come out as far as the middle balcony and stop a floor short of
        # the eave; their tops are balconies behind a solid parapet with small slots
        box("Bay", (bx, -BD / 2, 12.7 / 2), (BAY, BD, 12.7), "phoenix")
        box("BayCornice", (bx, -BD / 2 - 0.05, 12.75), (BAY + 0.3, BD + 0.2, 0.2), "frame")
        box("BayParapet", (bx, -BD + 0.1, 13.35), (BAY, 0.2, 1.0), "phoenix")
        for sx in (-1, 1):
            box("BayParapet", (bx + sx * (BAY / 2 - 0.1), -BD / 2, 13.35), (0.2, BD, 1.0), "phoenix")
        for k in range(6):
            box("ParapetSlot", (bx - BAY / 2 + 0.6 + k * (BAY - 1.2) / 5, -BD - 0.02, 13.35), (0.25, 0.06, 0.35), "dark")
    rows = (8.1, 11.3, 14.6)
    for z in rows:
        for x in (PIER / 2, L - PIER / 2):   # round-topped on the first and second floors, like the south wall
            window(x, z, -0.12, arch=z in rows[:2])
        for bx in (PIER + BAY / 2, L - PIER - BAY / 2):
            for dx in (-1.6, 1.6):
                window(bx + dx, z, -BD if z < 12.7 else -0.12)
        for x in cols:
            if z == rows[0]:   # tall arched doors out onto the balcony
                balcony_door(x, 7.33, 1.2)
            else:
                window(x, z, -0.12, 1.05)   # narrower than the bay windows, brick either side
    window(L - PIER / 2, 3.4, -0.12, 1.4, 2.4)   # (none behind the restaurant; the north bay has its oriel)
    # Entrance (2025 street photos): a raised terrace along the front from the
    # restaurant to past the doors, wide steps down to the square that wrap round the
    # phoenix fountain (its basin is set into the steps), a ramp up along the
    # restaurant's glass front, and three more steps up to a higher platform at the
    # doors with a short ramp beside them. Two wooden doors with fanlights, tall
    # windows either side, the balcony with balusters across above
    T1, LAND = 0.8, 1.3         # terrace, platform at the doors
    d0, d1 = cols[1], cols[2]
    cw = mid0 - 1.0            # where the restaurant's front arm ends: short of the bay's edge, so its beige side shows down to the ground
    TD, t1 = -FOUNT[1], mid1 + 0.5   # terrace depth (to the fountain's centre), its north end (just short of the oriel)
    PD, s0, s1 = 2.0, d0 - 1.6, d1 + 1.2  # platform depth, its steps' ends
    fx, fy, fr = FOUNT[0], FOUNT[1], 3.0
    cut = [box("Terrace", ((cw + t1) / 2, -TD / 2, T1 / 2), (t1 - cw, TD, T1), "granite")]
    box("RampTop", (cw + 0.8, -(TD + 8.6) / 2, T1 / 2), (1.6, 8.6 - TD, T1), "granite")
    for i in range(4):   # the steps turn the north corner too, each one reaching further out
        e = t1 + (i + 1) * 0.45
        cut.append(box("Stair", ((cw + 1.6 + e) / 2, -TD - 0.2 - i * 0.4, (T1 - i * 0.2) / 2),
                       (e - cw - 1.6, 0.4, T1 - i * 0.2), "granite"))
        box("Stair", (e - 0.225, (-3.0 - TD - i * 0.4) / 2, (T1 - i * 0.2) / 2), (0.45, TD + i * 0.4 - 3.0, T1 - i * 0.2), "granite")
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=fr, depth=10, location=(fx, fy, 0))
    hole = bpy.context.object   # the basin takes a round bite out of terrace and steps
    dg = bpy.context.evaluated_depsgraph_get()
    for o in cut:
        m = o.modifiers.new("Basin", "BOOLEAN")
        m.operation, m.object, m.solver = "DIFFERENCE", hole, "EXACT"
        dg.update()
        o.data = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        o.modifiers.clear()
    bpy.data.objects.remove(hole)
    box("Platform", ((s0 + t1) / 2, -PD / 2, LAND / 2), (t1 - s0, PD, LAND), "granite")
    for i in range(3):
        h = LAND - (i + 1) * (LAND - T1) / 3
        box("Stair", ((s0 + s1) / 2, -PD - 0.17 - i * 0.34, (T1 + h) / 2), (s1 - s0, 0.34, h - T1 + 0.01), "granite")
    box("PlatformWall", ((s1 + t1) / 2, -PD - 0.1, (LAND + T1) / 2 + 0.2), (t1 - s1, 0.2, LAND - T1 + 0.4), "plinth")
    r0, r1 = cw - 8.0, cw   # ramp: up along the restaurant front, high end at the terrace
    ramp = frustum("Ramp", ((r0 + r1) / 2, -7.9), 0, r1 - r0, 1.4, r1 - r0, 1.4, 0.02, "granite")
    for v in ramp.data.vertices:
        if v.co.z > 0.01:
            v.co.z = 0.02 + T1 * (v.co.x - r0) / (r1 - r0)

    def slope(x0, x1, y0, y1, z0, z1):   # a ramp slab rising from z0 at x0 to z1 at x1
        o = frustum("Ramp", ((x0 + x1) / 2, (y0 + y1) / 2), 0, abs(x1 - x0), abs(y1 - y0), abs(x1 - x0), abs(y1 - y0), 1.0, "granite")
        for v in o.data.vertices:
            if v.co.z > 0.5:
                v.co.z = z0 + (z1 - z0) * (v.co.x - x0) / (x1 - x0)
    # ...and a U-shaped ramp on up to the platform beside its steps (2025 photo): up
    # along the front towards the restaurant, a flat landing to turn on, then back
    # up along the wall to the platform
    RW, ml = 1.2, (T1 + LAND) / 2
    lx = cw + 1.2   # landing: cw..lx
    slope(lx, s0, -RW, -2 * RW, ml, T1)
    box("RampLanding", ((cw + lx) / 2, -RW, ml / 2), (lx - cw, 2 * RW, ml), "granite")
    slope(lx, s0, 0, -RW, ml, LAND)

    def rail(p0, p1, z0, z1):
        n = max(2, int((Vector(p1) - Vector(p0)).length / 1.2) + 1)
        for i in range(n):
            t = i / (n - 1)
            cyl("Post", (p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1]), z0 + t * (z1 - z0)), 0.03, 1.0, "steel", 4)
        a, c = Vector((*p0, z0 + 1.0)), Vector((*p1, z1 + 1.0))
        r = box("Handrail", (a + c) / 2, (0.05, 0.05, (c - a).length), "steel")
        r.rotation_euler = (c - a).to_track_quat("Z", "Y").to_euler()
    rail((r0, -8.6), (r1, -8.6), 0.02, T1)
    rail((r0, -7.2), (r1, -7.2), 0.02, T1)
    rail((cw + 1.6, -8.6), (cw + 1.6, -TD - 1.6), T1, T1)
    rail((s0, -2 * RW), (lx, -2 * RW), T1, ml)   # outer rail, round the landing, between the legs
    rail((lx, -2 * RW), (cw, -2 * RW), ml, ml)
    rail((cw, -2 * RW), (cw, -0.1), ml, ml)
    rail((lx, -RW), (s0, -RW), ml, LAND)
    rail((lx, -0.1), (s0, -0.1), ml, LAND)
    rail((s1 + 0.2, -PD - 0.1), (t1, -PD - 0.1), LAND, LAND)
    for x in (d0, d1):
        box("DoorFrame", (x, -0.08, LAND + 1.8), (2.1, 0.14, 3.6), "frame")
        box("Door", (x, -0.15, LAND + 1.4), (1.7, 0.12, 2.8), "door")
        box("Fanlight", (x, -0.15, LAND + 3.15), (1.7, 0.12, 0.6), "glass")
    for x in (cols[0], cols[3]):
        window(x, LAND + 1.7, -0.12, 1.5, 2.6)
    box("EntryBalcony", ((mid0 + mid1) / 2, -0.8, 5.3), (mid1 - mid0, 1.6, 0.3), "frame")
    box("EntryRail", ((mid0 + mid1) / 2, -1.55, 6.45), (mid1 - mid0, 0.1, 0.08), "dark")   # black wrought iron
    n = int((mid1 - mid0) / 0.5)
    for i in range(n):
        box("Baluster", (mid0 + 0.25 + i * (mid1 - mid0 - 0.5) / (n - 1), -1.55, 5.95), (0.04, 0.04, 0.9), "dark")
    for x in (cols[0], (d0 + d1) / 2, cols[3]):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=0.16, location=(x, -0.9, 5.0))
        bpy.context.object.data.materials.append(M["lamp"])
    for x in (s0 - 2.6, s0 - 0.5, s1 + 0.4, s1 + 2.2):   # four masts on the terrace, beside the platform steps
        before = set(bpy.data.objects)
        flag_mast(x, -PD - 1.3)
        for o in set(bpy.data.objects) - before:
            o.location.z += T1
    # The glass restaurant, L-shaped round the south-east corner (2024 photos): a
    # granite plinth, clear glazing in dark frames, the glass curving over at the eaves
    # in a quarter round that meets in a mitred hip at the corner, a flat dark roof
    # dotted with round skylights, a second curved glass strip leaning on the building,
    # and the door in a little arched porch on the corner with steps down to the square
    RD, RS = 7.0, 6.0          # depth of the front arm, of the south arm
    WT, R, RI = 2.4, 2.0, 1.1  # wall top, eave radius, radius of the strip on the building
    outer = [(cw, -RD), (-RS, -RD), (-RS, depth)]            # street edge, corner in the middle
    wall = [(cw, 0.0), (0.0, 0.0), (0.0, depth)]             # the building's walls
    quarter = [(math.cos(t), math.sin(t)) for t in (k / 6 * math.pi / 2 for k in range(7))]
    # eave: from upright at the wall top to flat at the roof, inward from the street edge
    sweep("RestaurantEave", outer, [(R - R * c, WT + R * sn) for c, sn in quarter], -1, "glass_curve")
    # strip on the building: rises off the roof RI out from the wall and leans in onto it
    sweep("RestaurantLean", wall, [(RI * c, WT + R + RI * sn) for c, sn in quarter], 1, "glass_curve")
    for x0, x1, y0, y1 in ((-RS, cw, -RD, 0.0), (-RS, 0.0, 0.0, depth)):
        cxa, cya, wx, wy = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
        box("RestaurantPlinth", (cxa, cya, 0.35), (wx, wy, 0.7), "granite")
        box("Restaurant", (cxa, cya, (0.7 + WT) / 2), (wx - 0.1, wy - 0.1, WT - 0.7), "amber")
        ux0, uy0 = x0 + R, y0 + (R if y0 < 0 else 0.0)   # the roof sits inside the eave
        box("RestaurantUpper", ((ux0 + x1) / 2, (uy0 + y1) / 2, WT + R / 2), (x1 - ux0, y1 - uy0, R), "amber")   # glazed where an arm ends
        box("RestaurantRoof", ((ux0 + x1) / 2, (uy0 + y1) / 2, WT + R), (x1 - ux0, y1 - uy0, 0.2), "dark")
    for x in [cw - 0.05 - i * 1.6 for i in range(int((cw + RS) / 1.6) + 1) if cw - 0.05 - i * 1.6 > -RS + 0.3]:   # frames on the street faces
        box("Mullion", (x, -RD, (0.7 + WT) / 2), (0.1, 0.12, WT - 0.7), "dark")
        rib(outer, 0, x, quarter, R, WT, -1)
    for y in [depth - 0.05 - i * 1.6 for i in range(int((depth + RD) / 1.6) + 1) if depth - 0.05 - i * 1.6 > -RD + 0.3]:
        box("Mullion", (-RS, y, (0.7 + WT) / 2), (0.12, 0.1, WT - 0.7), "dark")
        rib(outer, 1, y, quarter, R, WT, -1)
    for i in range(int((cw + RS - 3) / 2.0)):   # skylights between the eave and the strip
        for y in (-RD + R + 1.0, -RD + R + 2.9):
            skylight((-RS + 2.6 + i * 2.0, y, WT + R + 0.11))
    for i in range(int((depth - 0.5) / 2.0)):
        for x in (-RS + R + 0.9, -RS + R + 2.5):
            skylight((x, 0.8 + i * 2.0, WT + R + 0.11))
    # the corner porch: a dark frame facing the square on the diagonal, arched on top
    # (a slim black frame no higher than the glass curve, 2025 photo)
    pc = Vector((-RS, -RD)) + Vector((-1, -1)).normalized() * 0.3
    box("Porch", (pc.x, pc.y, (WT + 0.6) / 2), (1.6, 0.5, WT + 0.6), "dark", math.radians(-45))
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.8, depth=0.5, location=(pc.x, pc.y, WT + 0.6),
                                        rotation=(math.pi / 2, 0, math.radians(135)))
    bpy.context.object.name = "PorchArch"
    bpy.context.object.data.materials.append(M["dark"])
    pf = pc + Vector((-1, -1)).normalized() * 0.27
    box("PorchDoor", (pf.x, pf.y, 0.7 + 1.2), (1.1, 0.06, 2.4), "glass", math.radians(-45))
    for i in range(3):
        st = pc + Vector((-1, -1)).normalized() * (0.55 + i * 0.35)
        box("CornerStep", (st.x, st.y, (0.8 - i * 0.26) / 2), (2.4, 0.5, 0.8 - i * 0.26), "granite", math.radians(-45))
    # Eight round-topped dormers, over the window columns: two on each bay, four in the middle
    for x in [bx + dx for bx in (PIER + BAY / 2, L - PIER - BAY / 2) for dx in (-1.6, 1.6)] + cols:
        dormer(x, 0.5, eave, False)
    # The south side along Kongens gate (build -x face) is red brick, with the same
    # white-framed windows with crosses
    box("SouthBrick", (-0.04, depth / 2, (5.0 + eave - 1.2) / 2), (0.08, depth, eave - 1.2 - 5.0), "brick")   # cream ground floor, tan band under the eave
    box("SouthBand", (-0.1, depth / 2, eave - 0.6), (0.12, depth, 1.2), "phoenix")
    for y in SOUTH_COLS:   # three round-topped dormers on the south slope
        dormer(y, 0.5, eave, True)
    for y in (0.7, depth - 0.7):   # cream quoins at both corners
        box("Quoin", (-0.09, y, eave / 2), (0.1, 1.4, eave - 0.6), "phoenix")
    for z in rows:
        for y in SOUTH_COLS:
            window(y, z, 0.0, side=True, arch=z in rows[:2])


def wing(name, root, side, scale=1.0):
    """A raised, spread wing as a flat feathered outline with a little thickness."""
    out = [(0, 0), (0.22, 0.32), (0.5, 0.7), (0.72, 1.05), (0.98, 1.32), (0.92, 1.05), (1.04, 0.9),
           (0.9, 0.72), (0.98, 0.56), (0.82, 0.42), (0.86, 0.26), (0.66, 0.16), (0.62, 0.0), (0.42, -0.05),
           (0.3, -0.2), (0.12, -0.12)]
    pts = [(root[0] + side * 1.25 * u * scale, root[1] - 0.28 * u * u * scale, root[2] + 0.9 * v * scale)
           for u, v in out]   # wider than tall, cupped forward like the real bird
    me = bpy.data.meshes.new(name)
    me.from_pydata(pts, [], [tuple(range(len(pts)))])
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M["bronze_dark"])
    o.modifiers.new("Thick", "SOLIDIFY").thickness = 0.06


def phoenix_fountain(cx, cy, z0=0.15):
    """The phoenix fountain in front of the Føniks entrance (Adriaen's photo): a low
    round basin with a thick stone rim, a dark tiled column, three globe lamps at the
    front and the bronze phoenix rising from its nest with both wings raised."""
    before = set(bpy.data.objects)
    cyl("Water", (cx, cy, 0), 3.0, 0.32, "water", 24)
    bpy.ops.mesh.primitive_torus_add(major_radius=3.0, minor_radius=0.3, major_segments=24, minor_segments=6,
                                     location=(cx, cy, 0.3))
    bpy.context.object.scale.z = 1.3
    bpy.context.object.data.materials.append(M["granite"])
    cyl("Column", (cx, cy, 0), 0.3, 1.45, "tile", 12)
    cyl("Collar", (cx, cy, 1.45), 0.36, 0.12, "dark", 12)
    cyl("Nest", (cx, cy, 1.57), 0.3, 0.28, "bronze_dark", 10, 0.5)
    for k in (-1, 0, 1):
        a = math.radians(-90 + k * 32)
        box("LampArm", (cx + 0.25 * math.cos(a), cy + 0.25 * math.sin(a), 1.32), (0.5, 0.05, 0.05), "gold", a)
    for k in (-1, 0, 1):   # three globe lamps on short arms at the front, below the bird
        a = math.radians(-90 + k * 32)
        x, y = cx + 0.5 * math.cos(a), cy + 0.5 * math.sin(a)
        cyl("LampStem", (x, y, 1.3), 0.03, 0.2, "dark", 6)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.15, location=(x, y, 1.62))
        bpy.context.object.data.materials.append(M["lamp"])
    for k in range(7):   # the nest of flames it rises from
        t = k / 7 * math.tau
        f = cyl("Flame", (cx + 0.2 * math.cos(t), cy + 0.2 * math.sin(t), 1.75), 0.08, 0.32, "gold", 4, 0.0)
        f.rotation_euler = (0.35 * math.sin(t), -0.35 * math.cos(t), 0)
    tail = box("Tail", (cx, cy + 0.26, 1.95), (0.36, 0.05, 0.55), "bronze_dark")
    tail.rotation_euler = (math.radians(-20), 0, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.26, location=(cx, cy, 2.25))
    bpy.context.object.scale = (1.0, 0.85, 1.55)   # stout upright body
    bpy.context.object.data.materials.append(M["bronze_dark"])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.13, location=(cx + 0.04, cy - 0.08, 2.74))
    bpy.context.object.data.materials.append(M["bronze_dark"])
    cyl("Neck", (cx + 0.02, cy - 0.04, 2.5), 0.12, 0.22, "bronze_dark", 8, 0.1)
    beak = cyl("Beak", (cx + 0.16, cy - 0.12, 2.72), 0.045, 0.16, "bronze_dark", 4, 0.0)
    beak.rotation_euler = (0, math.radians(95), math.radians(-20))   # head turned to its left
    for side in (-1, 1):
        wing("Wing", (cx + side * 0.18, cy + 0.02, 2.4), side, 0.95)
        for u, v in ((0.82, 0.95), (0.86, 0.75), (0.8, 0.55), (0.7, 0.36)):   # round bosses along each wing
            bpy.ops.mesh.primitive_uv_sphere_add(segments=4, ring_count=2, radius=0.06,
                                                 location=(cx + side * (0.18 + 1.19 * u), cy + 0.02 - 0.27 * u * u - 0.06, 2.4 + 0.855 * v))
            bpy.context.object.data.materials.append(M["steel"])
    for o in set(bpy.data.objects) - before:   # raised on a stone drum to the terrace's height
        o.location.z += z0
    cyl("Drum", (cx, cy, 0), 3.25, z0 + 0.3, "granite", 24)


FOUNT = (FW / 2, -6.5)   # phoenix fountain: centred on the doors, its back just clear of the platform steps
SOUTH_COLS = (2.9, 6.4, 9.9)   # south wall window columns, from the front (Kongens gate photo)
_before = set(bpy.data.objects)
foniks()
phoenix_fountain(*FOUNT)   # set into the terrace steps, in front of the doors
from mathutils import Matrix
# Built facing -y with its south end at build x = 0; a quarter turn to the left makes
# it face EAST, then it slides onto the square: front at FONIKS_FRONT, south end at
# FONIKS_SOUTH on Kongens gate. FL() maps a build point onto the square.
TURN = math.radians(90)
FONIKS = Matrix.Translation((FONIKS_FRONT, FONIKS_SOUTH, 0)) @ Matrix.Rotation(TURN, 4, "Z")


def FL(x, y, z=0.0):
    """A point given in Føniks's own build coordinates, placed on the square."""
    return tuple(FONIKS @ Vector((x, y, z)))


FONIKS_OBJS = set(bpy.data.objects) - _before
for o in FONIKS_OBJS:
    if o.parent is None:
        o.matrix_world = FONIKS @ o.matrix_world


def block(name, x0, x1, y0, y1, h, mat, floors, faces, roof=None, roof_h=4.0):
    """A neighbour, kept simple: the right colour, height, windows and roof shape."""
    facade(name, x0, x1, y0, y1, h, mat, floors, faces)
    if roof:
        along_x = (x1 - x0) >= (y1 - y0)
        w, d = x1 - x0 + 0.6, y1 - y0 + 0.6
        frustum(name + "Pitch", ((x0 + x1) / 2, (y0 + y1) / 2), h, w, d,
                w if along_x else 0.6, 0.6 if along_x else d, roof_h, roof)


# The rest of the Føniks block behind it, and along the north side of Kongens gate
# going west: the light block with a grid of windows and green awnings, then the
# dark brick block with steep slate roofs
# Føniks's own annex, joined straight onto its west wall along Kongens gate (Adriaen:
# part of Føniks): cream, five storeys of regular windows, a set-back top floor,
# awnings over its ground floor; a glass-roofed courtyard block behind both
FB = FONIKS_FRONT - 12.8   # Føniks's back wall (GPS: SW roof corner)
# (Kongens gate photos: a dark glass ground floor between copper piers; above it a
# travertine box of three storeys standing a little proud, six tall windows a floor;
# a copper-clad top floor set back on top; a narrow copper-clad joint with its own
# windows where it meets Føniks, the glass atrium roof showing behind)
AS, JW = FONIKS_SOUTH - 1.0, 2.2   # annex street face, joint width
ax0, ax1 = FB - JW - 17.7, FB - JW   # 17.7 m wide (GPS pins on both street corners)
acx = (ax0 + ax1) / 2
box("FoniksAnnex", (acx, AS + 10.5, 9.8), (ax1 - ax0, 21, 19.6), "travertine")
box("FoniksAnnexBase", (acx, AS - 0.05, 2.65), (ax1 - ax0 - 0.4, 0.12, 5.3), "glass")
for i in range(6):
    box("FoniksAnnexPier", (ax0 + 0.4 + i * (ax1 - ax0 - 0.8) / 5, AS - 0.12, 2.65), (0.5, 0.2, 5.3), "copper")
box("FoniksAnnexBox", (acx, AS - 0.5, 11.05), (ax1 - ax0 + 0.6, 1.0, 11.5), "travertine")   # stands proud
for row in range(3):
    for i in range(6):
        box("FoniksAnnexWin", (ax0 + 1.6 + i * (ax1 - ax0 - 3.2) / 5, AS - 1.05, 7.0 + row * 3.4),
            (1.5, 0.12, 2.4), "glass")
box("FoniksAnnexTop", (acx, AS + 10.5, 18.2), (ax1 - ax0 - 0.8, 19.4, 2.9), "copper")   # set back
for i in range(5):
    box("FoniksAnnexTopWin", (ax0 + 2.5 + i * (ax1 - ax0 - 5) / 4, AS + 0.15, 18.0), (2.4, 0.12, 1.6), "glass")
box("FoniksAnnexJoint", (FB - JW / 2, AS + 10.8, 7.3), (JW, 21, 14.6), "copper")   # set back a little
for z in (3.0, 7.5, 11.5):
    box("FoniksAnnexJointWin", (FB - JW / 2, AS + 0.25, z), (JW - 1.2, 0.12, 2.6), "glass")
box("FoniksAnnexAwning", (acx, AS - 3.0, 3.0), (ax1 - ax0, 4.0, 0.15), "dark")
for i in range(6):
    box("PergolaPost", (ax0 + 1 + i * (ax1 - ax0 - 2) / 5, AS - 4.9, 1.5), (0.15, 0.15, 3.0), "dark")
block("FoniksBack", FB - 22, FB, FONIKS_SOUTH + 20, FONIKS_SOUTH + FW, 15, "brick_dark", 4, (), None)
box("FoniksAtrium", (FB - 6, FONIKS_SOUTH + 12, 16.5), (10, 18, 3.8), "glass_block")   # glass atrium behind the joint
# Everything around the square except Føniks lives in trondheim_surroundings.py, in
# variants side by side; TRD_SURROUND=v1 is round 6 with every street square to the square
import trondheim_surroundings  # noqa: E402
trondheim_surroundings.build(globals(), os.environ.get("TRD_SURROUND", "v2"))


def load_char(name, loc, yaw, mat=None, scale=1.0, pose=None, glb=None):
    path = glb or os.path.join(ROOT, "characters", name, name + ".glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    rig = next(o for o in new if o.type == "ARMATURE")
    top = [o for o in new if o.parent is None]
    holder = bpy.data.objects.new(name + "Holder", None)
    scene.collection.objects.link(holder)
    for o in top:
        o.parent = holder
    holder.location, holder.rotation_euler, holder.scale = loc, (0, 0, yaw), (scale,) * 3
    if mat:
        for o in new:
            if o.type == "MESH":
                o.data.materials.clear()
                o.data.materials.append(M[mat])
    if pose:
        for bone, rot in pose.items():
            pb = rig.pose.bones.get(bone)
            if pb:
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = [math.radians(a) for a in rot]
    return holder, rig


# Statue (Adriaen's photos): the clean-shaven base body in bronze, scaled 2x, facing north
# up Munkegata. Conical helmet with a nose guard over hair to the jaw, a moustache, a mail
# shirt to the knees with a belt. Right arm down, the sword hanging straight from the fist
# with its tip on the plinth; left forearm raised, the fist holding the orb upright on its
# stem, a cross on top; a stone between his feet
YAW = 0.0
statue, rig = load_char("base_body", (0, 0, TOP), YAW, "bronze", 2.0,
                        {"upper_arm.R": (-30, 30, 15), "forearm.R": (-60, 90, -45),
                         "upper_arm.L": (-45, 60, -75), "forearm.L": (90, -60, 60)},
                        glb=os.path.join(ROOT, "characters", "_shared", "base_body.glb"))
for o in list(statue.children):   # the base body file carries a stray sphere
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
bpy.context.view_layer.update()
W = lambda bone, end="tail": rig.matrix_world @ getattr(rig.pose.bones[bone], end)
SPIN = Matrix.Rotation(YAW, 4, "Z")
F = lambda x, y, z: SPIN @ Vector((x, y, z))   # an offset in his own frame, y forward
fist_r = (W("hand.R", "head") + W("hand.R")) / 2
hilt, tip = fist_r + Vector((0, 0, 0.22)), Vector((fist_r.x, fist_r.y, TOP + 0.08))
box("Sword", (hilt + tip) / 2, (0.1, 0.035, (hilt - tip).length), "bronze", YAW)
box("Guard", fist_r - Vector((0, 0, 0.16)), (0.42, 0.08, 0.06), "bronze", YAW)
head, crown = W("head", "head"), W("head")
# The helmet (close-up photo): a tall pointed cone, slightly egg-shaped, sitting snug
# down to the brows, a thin nose guard to the tip of the nose; hair falls from under it to
# the jaw. Made in the body's own unscaled frame (head x +-0.135, y -0.10..0.124, top 1.75)
LOCAL = statue.matrix_world


def helmet():
    prof = [(1.06, 1.638), (1.06, 1.662), (1.0, 1.666), (0.97, 1.740), (0.86, 1.815), (0.66, 1.880), (0.40, 1.935), (0.0, 1.985)]
    n, rx, ry, cy = 12, 0.152, 0.136, 0.012
    verts = [LOCAL @ Vector((rx * f * math.cos(t), cy + ry * f * math.sin(t), z))
             for f, z in prof for t in (k / n * math.tau for k in range(n))]
    faces = [(i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k)
             for i in range(len(prof) - 1) for k in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))
    me = bpy.data.meshes.new("Helmet")
    me.from_pydata(verts, [], faces)
    me.materials.append(M["bronze"])
    o = bpy.data.objects.new("Helmet", me)
    scene.collection.objects.link(o)


def bit(name, loc, size):   # a bronze box in the body's frame, size in body units (x2 on the statue)
    o = box(name, LOCAL @ Vector(loc), [v * 2.0 for v in size], "bronze", YAW)
    return o


helmet()   # the rim is the slight flare at the bottom of the cone, no separate brim
bit("NoseGuard", (0, 0.152, 1.605), (0.024, 0.014, 0.10))
for side in (-1, 1):   # hair from under the helmet to the jaw, tucked flush to the head
    bit("Hair", (side * 0.136, -0.055, 1.58), (0.016, 0.11, 0.12))
bit("Hair", (0, -0.112, 1.575), (0.25, 0.02, 0.13))
bit("Moustache", (0, 0.13, 1.562), (0.07, 0.016, 0.018))
hips = W("hips", "head")
cyl("Mail", (hips.x, hips.y, hips.z - 0.8), 0.42, 1.2, "bronze", 10, 0.34)   # mail shirt down to the knees
cyl("Belt", (hips.x, hips.y, hips.z - 0.02), 0.39, 0.1, "bronze", 10)
grip = W("hand.L")   # the fist's top
cyl("OrbStem", (grip.x, grip.y, grip.z - 0.12), 0.06, 0.2, "bronze", 8)
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.18, location=(grip.x, grip.y, grip.z + 0.22))
bpy.context.object.scale.z = 1.15
bpy.context.object.data.materials.append(M["bronze"])
box("OrbCross", (grip.x, grip.y, grip.z + 0.56), (0.06, 0.06, 0.3), "bronze", YAW)   # upright and crossbar
box("OrbCrossBar", (grip.x, grip.y, grip.z + 0.6), (0.2, 0.06, 0.06), "bronze", YAW)
stone = F(0, 0.3, 0)
bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.32, radius2=0.12, depth=0.7, location=(stone.x, stone.y, TOP + 0.35))
bpy.context.object.data.materials.append(M["bronze"])   # the stone between his feet
# The bearded character (Adriaen, one year ago) at the Føniks entrance, by the fountain
me, _ = load_char("bearded_operator", FL(11.0, -11.0), math.radians(200) + TURN)
# Light: low autumn sun, overcast sky
world = bpy.data.worlds.new("Sky")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (*srgb("#9fb3c8"), 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
scene.world = world
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 3
sun.data.angle = math.radians(6)
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
scene.collection.objects.link(sun)
trondheim_surroundings.finish(globals())   # e.g. the dream variant's pale sky

scene.render.engine = "CYCLES"
scene.cycles.device = b.pick_device("auto")
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"
scene.render.resolution_x, scene.render.resolution_y = args.res, args.res * 9 // 16
scene.render.image_settings.file_format = "JPEG"



def aim(pos, bearing, pitch):
    """A target point from a compass bearing and a downward pitch, both in degrees."""
    b_, p_ = math.radians(bearing), math.radians(pitch)
    return (pos[0] + math.sin(b_) * math.cos(p_), pos[1] + math.cos(b_) * math.cos(p_), pos[2] - math.sin(p_))


# The drone cameras fitted to Adriaen's two photos (24 mm, 3:2): B = the sunset photo,
# high over the south-east corner looking north-west; B1 = the overcast photo, lower
B_POS, B1_POS = (79.3, -47.1, 48.1), (28.2, -48.1, 26.0)
A_POS, A_AT = FL(10.0, -16.0, 1.7), FL(17.0, 0.0, 3.2)
if args.glb:   # Føniks on its own for the spin-around viewer
    bpy.ops.object.select_all(action="DESELECT")
    keep = FONIKS_OBJS | {o for o in bpy.data.objects if o.name.startswith(("Foniks", "PergolaPost"))}
    # Lean export: drop buried and flush-hidden faces, then one mesh per material
    import mesh_cleanup
    keep = [o for o in keep if o.type == "MESH"]
    mesh_cleanup.strip_hidden(keep)
    mesh_cleanup.fronts_only(keep, {"Win", "Mullion", "Transom", "Cartouche", "DormerWin", "Capital", "FoniksAnnexWin",
                                    "FoniksAnnexTopWin", "FoniksAnnexJointWin", "Fanlight", "Door", "BrickPanel", "SouthBand",
                                    "ParapetSlot", "PierStrip", "Keystone", "DoorArch"})
    if os.environ.get("TRD_STATS"):   # triangles left per part, biggest first
        import collections, re
        tri = collections.Counter()
        for o in keep:
            tri[re.sub(r"\.\d+$", "", o.name)] += sum(len(p.vertices) - 2 for p in o.data.polygons)
        for k, v in tri.most_common(30):
            print(f"  {k:24s}{v:6d}")
    for o in mesh_cleanup.merge_by_material(keep):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=args.glb, use_selection=True, export_apply=True, export_yup=True)
    print("wrote", args.glb)
    sys.exit(0)

# Onto true north at true size from Adriaen's GPS points (TRD_TRUE=0 keeps the square
# axis-aligned, e.g. for overlays on the top-down screenshot); cameras follow below
TRUE = os.environ.get("TRD_TRUE", "1") != "0"
if TRUE:
    trondheim_surroundings.true_world()

SHOTS = {
    "B_wide": (B_POS, aim(B_POS, 303.3, 16.3), 24.0, 1.5),
    "B1_overcast": (B1_POS, aim(B1_POS, 318.4, 18.0), 24.0, 5 / 3),
    # The glide from B down to A, part way: over the square, Føniks filling the frame
    "G_glide": ((22.0, -2.0, 16.0), FL(17.0, 0.0, 6.0), 26.0, 16 / 9),
    # A: street level in front of Føniks, the character by the fountain, doors behind
    "A_street": (A_POS, A_AT, 28.0, 16 / 9),
    # R: the restaurant corner from above the square (Adriaen's aerial photo)
    "R_restaurant": (FL(-24.0, -30.0, 24.0), FL(7.0, 4.0, 7.0), 32.0, 3 / 4),
    # T: along the front from the restaurant: the ramp, the terrace and the balcony doors
    "N_north_bay": (FL(25.0, -15.0, 1.7), FL(30.5, -1.0, 4.5), 30.0, 3 / 4),
    "Z_facade": (FL(19.0, -13.0, 1.7), FL(19.0, 0.0, 11.0), 22.0, 3 / 4),
    "U_ramp": (FL(18.5, -10.0, 3.2), FL(12.0, -1.0, 1.4), 30.0, 4 / 3),
    "T_terrace": (FL(2.0, -14.0, 1.7), FL(20.0, -2.0, 5.0), 24.0, 3 / 4),
    # S: across Kongens gate, Føniks's brick south wall and the annex (Adriaen's winter photo)
    "S_kongens_street": ((FB - 2.0, FONIKS_SOUTH - 34.0, 1.7), (FB - 2.0, FONIKS_SOUTH, 9.5), 20.0, 4 / 3),
    "E_entrance": (FL(18.0, -19.0, 2.0), FL(18.0, 0.0, 4.2), 30.0, 16 / 9),
    "F_phoenix": (FL(20.0, -16.0, 2.0), FL(19.0, -6.5, 2.2), 40.0, 16 / 9),
    "D_statue_close": ((-6.5, -6, 16.2), (0, 0, 15.8), 50.0, 16 / 9),
    # C: over the character's shoulder at the door, looking back at the statue
    "C_statue": (FL(21.5, -1.2, 3.0), (2, 0, 10), 26.0, 16 / 9),
    # Like Adriaen's Google 3D view: over Kongens gate, Føniks's brick south wall and its annex
    "K_kongens": ((-12.0, -22.0, 38.0), (-46.0, 24.0, 6.0), 30.0, 16 / 9),
    # Straight down, orthographic (lens < 0 = ortho width in metres), for the satellite check
    "T_top": ((0.0, 10.0, 300.0), (0.0, 10.001, 0.0), -160.0, 1.0),
}
SHOTS.update(trondheim_surroundings.SHOTS)
only = [s for s in os.environ.get("SHOTS", "").split(",") if s]
for name, (pos, at, lens, aspect) in SHOTS.items():
    if only and name not in only:
        continue
    scene.render.resolution_x, scene.render.resolution_y = args.res, int(args.res / aspect)
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    if lens < 0:
        cam.data.type, cam.data.ortho_scale = "ORTHO", -lens
    else:
        cam.data.lens = lens
    cam.data.clip_end = 30000   # the wide terrain reaches ~14 km
    if TRUE:
        pos, at = trondheim_surroundings.to_true(pos), trondheim_surroundings.to_true(at)
    cam.location = pos
    cam.rotation_euler = (Vector(at) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = os.path.join(args.out, name + ".jpg")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)
