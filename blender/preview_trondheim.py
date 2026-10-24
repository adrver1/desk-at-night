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
    "bronze": ("#4f6b5d", 0.45), "glass": ("#42535f", 0.15), "phoenix": ("#d9c49c", 0.75),
    "roof": ("#5e4b40", 0.8), "road": ("#505356", 0.9), "tree": ("#4f6a35", 1.0),
    "trunk": ("#4a3a2c", 1.0), "c1": ("#c9a77c", 0.8), "c2": ("#b46a4f", 0.8),
    "c3": ("#e2ddcf", 0.8), "c4": ("#8f9b8a", 0.8), "c5": ("#c7b07a", 0.8),
    "brick": ("#8a5442", 0.85), "brick_dark": ("#6e3d31", 0.85), "pink": ("#c9776a", 0.8),
    "torg": ("#cdbf9f", 0.8), "glass_block": ("#4d5f6a", 0.4), "red": ("#d8262c", 0.5), "verdigris": ("#4f9a8f", 0.5), "hill": ("#3d5235", 1.0), "wood": ("#6b3f26", 0.6), "steel": ("#7d8488", 0.4), "flag": ("#f4f4f1", 0.8),
    "logo_magenta": ("#c42a72", 0.6), "logo_orange": ("#ec8a3c", 0.6), "logo_green": ("#2e9a52", 0.6), "tile": ("#2b3a3c", 0.5), "water": ("#2f7f86", 0.1), "frame": ("#efede6", 0.6), "slate": ("#3e3738", 0.7), "roof_light": ("#8f9498", 0.8),
    "canvas": ("#e4dac2", 0.9), "copper": ("#7f4c45", 0.55), "blind": ("#a9aeb0", 0.7), "blind_green": ("#8fb3a3", 0.7), "plinth": ("#59625d", 0.8), "amber": ("#61798a", 0.08), "glass_curve": ("#86a3b8", 0.06), "skylight": ("#c9cdcf", 0.5), "door": ("#4a2c1e", 0.5),
    "bronze_dark": ("#2f3a33", 0.45), "gold": ("#b8913a", 0.35), "travertine": ("#dcd2bf", 0.8), "orange": ("#c9583a", 0.8),
}.items()}


_CUBE_V = [(-.5, -.5, -.5), (.5, -.5, -.5), (.5, .5, -.5), (-.5, .5, -.5),
           (-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)]
_CUBE_F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def box(name, loc, size, mat, rot=0.0):
    """A unit cube scaled to size. Built through the data API: bpy.ops primitives cost
    ~50 ms each (a scene update per call), which made up most of a Føniks export."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(_CUBE_V, [], _CUBE_F)
    me.materials.append(M[mat])
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location, o.rotation_euler, o.scale = loc, (0, 0, rot), size
    return o


def pane(name, face, c, z, w, h, at, mat):
    """A single quad facing out of a wall: face "s" faces -y (c = x, at = y), "w" faces
    -x (c = y, at = x), "e" faces +x. For flat things on a wall (glass, frames): 2 triangles, and as an
    open sheet strip_hidden() never mistakes it for buried."""
    u0, u1, z0, z1 = c - w / 2, c + w / 2, z - h / 2, z + h / 2
    if face == "s":
        v = [(u0, at, z0), (u1, at, z0), (u1, at, z1), (u0, at, z1)]
    elif face == "e":
        v = [(at, u0, z0), (at, u1, z0), (at, u1, z1), (at, u0, z1)]
    else:
        v = [(at, u1, z0), (at, u0, z0), (at, u0, z1), (at, u1, z1)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], [(0, 1, 2, 3)])
    me.materials.append(M[mat])
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
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
REST_RD, REST_RS = 7.0, 6.0   # the glass restaurant: depth of its front arm, of its south arm

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
paved(-38, -6, SQ_N - 0.5, 140, "Munkegata", 0.036)   # Munkegata north, wide and pedestrian (a hair higher where it overlaps)
paved(11.5, SQ_E, -70, SQ_S + 0.5, "SquareS", 0.036)       # the square runs on south, east of the yellow block
paved(12, 34, -160, -69.5, "MunkegataS")           # Munkegata south toward the cathedral
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


def flag_mast(x, y, h=9.0, z0=0.0):
    """A white mast with a hanging banner flag: white, the logo on both faces."""
    cyl("Mast", (x, y, z0), 0.06, h, "frame", 6)
    cyl("Truck", (x, y, z0 + h), 0.1, 0.12, "frame", 4)
    fw, fh, top = 1.0, 2.6, z0 + h - 0.4
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


def window(x, z, y, w=1.35, h=2.1, arch=False, side=False, panes=2):
    """A white-framed window with the white cross (mullion + transom) of the old hotel,
    or with two mullions for three panes. Faces -y, or -x with side=True (then x is
    along the wall and y is the wall line)."""
    # flat quads laid on the wall a centimetre apart (Adriaen: no depth needed, and they
    # must sit on the wall, not float; closer than ~1 cm flickers on a phone's depth buffer)
    def B(name, cx, cz, sx, sz, dy, mat):
        return pane(name, "w" if side else "s", cx, cz, sx, sz, y - dy, mat)
    B("WinFrame", x, z, w + 0.3, h + 0.3, 0.01, "frame")
    B("Win", x, z, w, h, 0.02, "glass")
    for u in ((x,) if panes == 2 else (x - w / 6, x + w / 6)):
        B("Mullion", u, z, 0.1, h, 0.04, "frame")
    # a hair behind the mullion: coplanar faces where the two cross render as a black spot
    B("Transom", x, z + h * 0.2, w, 0.1, 0.03, "frame")
    if arch:   # a rectangular window under a round white surround filled with render
        # each a hair proud of the one behind: a face flush with the frame's front renders black
        halfdisc("WinFrame", x, z + h / 2, w / 2 + 0.15, y - 0.005, "frame", side=side)
        halfdisc("ArchFill", x, z + h / 2 + 0.12, w / 2 - 0.1, y - 0.015, "phoenix", side=side)


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
    pane("DoorArch", "s", x, (z - h / 2 + top) / 2, w + 0.7, h, -0.02, "phoenix")   # all laid flat on the brick
    halfdisc("DoorArch", x, top, w / 2 + 0.35, -0.02, "phoenix")
    pane("Keystone", "s", x, top + w / 2 + 0.2, 0.32, 0.5, -0.03, "phoenix")
    window(x, z, -0.03, w, h)
    halfdisc("WinFrame", x, top, w / 2 + 0.12, -0.035, "frame")
    halfdisc("Win", x, top, w / 2, -0.045, "glass")
    for k in (1, 2, 3):   # the sunburst bars
        a = math.pi * k / 4
        # not "Mullion": their inner ends bury each other, which fronts_only would
        # take for a buried back and leave only the outer end square
        b = box("Sunburst", (x + 0.27 * w * math.cos(a), -0.085, top + 0.27 * w * math.sin(a)), (0.54 * w, 0.01, 0.06), "frame")
        b.rotation_euler = (0, -a, 0)
    box("SunHub", (x, -0.095, top + 0.03), (0.16, 0.01, 0.16), "frame")   # covers where the bars meet


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
    # roof tiles show between the cornice and the dormer; the window stands on a sill shelf
    B("Dormer", u, 0.8, eave + 1.5, 1.6, 1.6, 1.8, "phoenix")             # z eave+0.6 .. +2.4
    B("DormerSill", u, -0.08, eave + 0.68, 1.5, 0.3, 0.12, "phoenix")   # tan like the dormer (Adriaen)
    for name, d, w, h, mat in (("DormerFrame", 0.01, 1.2, 1.56, "frame"), ("DormerWin", 0.02, 1.02, 1.42, "glass"),
                               ("DormerBar", 0.03, 0.08, 1.42, "frame")):   # flat quads on its face
        pane(name, "w" if side else "s", u, eave + 1.52, w, h, face - d, mat)
    # the hood: a round-topped arch, extruded back into the roof
    n, w, rise, z0 = 6, 1.65, 0.55, eave + 2.4
    arc = [(-w / 2 + w * k / n, z0 + rise * (1 - (2 * k / n - 1) ** 2)) for k in range(n + 1)]
    ring = lambda out: [P(u + a_, out, z) for a_, z in arc]   # closes along its flat base
    front, back = ring(-0.05), ring(1.6)
    m = len(front)
    # a tan arched front under a slate-tiled top (Adriaen); its back and base sit in the roof
    for name, faces, mat in (("DormerHood", [tuple(range(m))], "phoenix"),
                             ("DormerHoodTop", [(i, i + 1, m + i + 1, m + i) for i in range(n)], "slate")):
        me = bpy.data.meshes.new(name)
        me.from_pydata(front + back, [], faces)
        me.validate()
        o = bpy.data.objects.new(name, me)
        scene.collection.objects.link(o)
        me.materials.append(M[mat])


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
    box("FoniksCornice", (cx, depth / 2, eave - 0.2), (L + 0.8, depth + 0.8, 0.45), "phoenix")   # tan, like the render
    frustum("FoniksMansard", (cx, depth / 2), eave, L + 0.6, depth + 0.6, L - 3.4, depth - 3.4, 3.6, "slate")
    frustum("FoniksRoof", (cx, depth / 2), eave + 3.6, L - 3.4, depth - 3.4, L - 14, 0.02, 2.6, "slate")   # up to a sharp ridge (Adriaen)
    for x in (8.5, L - 8.5):
        box("Chimney", (x, depth / 2, eave + 6.2 + 0.4), (1.6, 1.2, 2.0), "dark")   # astride the ridge
    # Cream corners and pilasters, red brick panels between the middle pilasters
    # from above the ground floor up (2024 photos); brick and reliefs are quads laid
    # on the cream wall (WY: the face windows sit on)
    WY = -0.02
    mid0, mid1 = PIER + BAY, L - PIER - BAY
    cols = [(mid0 + (i + 0.5) * (mid1 - mid0) / 4) for i in range(4)]
    bw = (mid1 - mid0) / 4
    for x0 in (0.0, L - PIER):   # brick corner piers, as on the south wall (aerial photo)
        pane("BrickPier", "s", x0 + PIER / 2, (5.0 + eave - 1.2) / 2, PIER, eave - 1.2 - 5.0, -0.01, "brick")
    for x in (PIER - 0.35, L - PIER + 0.35):   # a cream strip between each pier and its bay
        pane("PierStrip", "s", x, (5.0 + eave - 1.2) / 2, 0.7, eave - 1.2 - 5.0, -0.02, "phoenix")
    for x in cols:
        pane("BrickPanel", "s", x, (5.45 + eave - 1.2) / 2, bw - 0.75, eave - 1.2 - 5.45, -0.01, "brick")   # pilasters ~0.75 m
        pane("Cartouche", "s", x, 12.15, 1.3, 0.7, -0.02, "phoenix")   # carved relief between the upper windows (rows 2 and 3)
    for i in range(5):   # capitals on the cream pilasters under the cornice
        box("Capital", (mid0 + i * bw, -0.16, eave - 1.2), (1.9, 0.2, 0.7), "phoenix")
    # The north bay's ground floor steps out again into a half-octagon with big
    # windows and a small dark lead roof (2025 photos)
    ox, OP, OH = L - PIER - BAY / 2, 1.2, 4.3   # centre, how far out, height
    OF = BAY - 2 * OP   # front width: the half-octagon spans the whole bay
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
    window(ox, 2.75, -BD - OP, OF - 0.8, 2.3, panes=3)   # the angled sides are blank
    for bx in (PIER + BAY / 2, L - PIER - BAY / 2):   # the side bays come forward
        # the bays come out as far as the middle balcony and stop a floor short of
        # the eave; their tops are balconies behind a solid parapet with small slots
        box("Bay", (bx, -BD / 2, 12.7 / 2), (BAY, BD, 12.7), "phoenix")
        box("BayCornice", (bx, -BD / 2 - 0.05, 12.75), (BAY + 0.3, BD + 0.2, 0.2), "phoenix")   # tan (Adriaen)
        box("BayParapet", (bx, -BD + 0.1, 13.35), (BAY, 0.2, 1.0), "phoenix")
        for sx in (-1, 1):
            # stop at the front parapet's back: a shared front face renders as a black stripe
            box("BayParapet", (bx + sx * (BAY / 2 - 0.1), (-BD + 0.2) / 2, 13.35), (0.2, BD - 0.2, 1.0), "phoenix")
        for k in range(6):
            box("ParapetSlot", (bx - BAY / 2 + 0.6 + k * (BAY - 1.2) / 5, -BD - 0.02, 13.35), (0.25, 0.06, 0.35), "dark")
    rows = (7.2, 10.5, 13.8)   # spread over the wall, the top row clear of the frieze
    for z in rows:
        for x in (PIER / 2, L - PIER / 2):   # round-topped on the first and second floors, like the south wall
            window(x, z, WY, h=1.7 if z in rows[:2] else 2.1, arch=z in rows[:2])
        for bx in (PIER + BAY / 2, L - PIER - BAY / 2):
            for dx in (-1.6, 1.6):
                window(bx + dx, z, -BD if z < 12.7 else WY)
        for x in cols:
            if z == rows[0]:   # tall arched doors out onto the balcony
                # sill on the balcony, arch top level with the round-topped pier
                # windows, brick between the keystones and the windows above
                balcony_door(x, 6.705, 1.2, 2.4)
            else:
                window(x, z, WY, 1.05)   # narrower than the bay windows, brick either side
    window(L - PIER / 2, 3.4, WY, 1.4, 2.4)   # (none behind the restaurant; the north bay has its oriel)
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
    # (Adriaen: the low end must open onto the terrace, clear of the platform, and the
    # landing must be a real flat turn)
    RW, ml = 1.2, (T1 + LAND) / 2
    lx = cw + 1.6   # landing: cw..lx, deep enough to turn on
    x_lo = s0 - 1.5   # the lower leg starts here, at terrace level; s0 - 1.5..s0 is the way in
    slope(lx, x_lo, -RW, -2 * RW, ml, T1)
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
    rail((r0, -8.6), (r1, -8.6), 0.02, T1)   # outer side only (Adriaen: no rail along the glass)
    rail((r1, -8.6), (cw + 1.6, -8.6), T1, T1)   # on round the top without a gap
    rail((cw + 1.6, -8.6), (cw + 1.6, -TD - 1.6), T1, T1)
    rail((x_lo, -2 * RW), (lx, -2 * RW), T1, ml)   # outer rail, round the landing, between the legs
    rail((lx, -2 * RW), (cw, -2 * RW), ml, ml)
    rail((cw, -2 * RW), (cw, -0.1), ml, ml)
    rail((lx, -RW), (s0, -RW), ml, LAND)
    rail((s1 + 0.2, -PD - 0.1), (t1, -PD - 0.1), LAND, LAND)
    for x in (d0, d1):
        # top-aligned with the windows either side
        pane("DoorFrame", "s", x, LAND + 1.575, 2.1, 3.15, -0.01, "frame")
        pane("Door", "s", x, LAND + 1.2, 1.7, 2.4, -0.02, "door")
        pane("Fanlight", "s", x, LAND + 2.725, 1.7, 0.55, -0.02, "glass")
    for x in (cols[0], cols[3]):
        window(x, LAND + 1.7, WY, 1.5, 2.6)
    box("EntryBalcony", ((mid0 + mid1) / 2, -0.8, 5.3), (mid1 - mid0, 1.6, 0.3), "phoenix")
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
    RD, RS = REST_RD, REST_RS
    WT, R, RI = 2.4, 2.0, 1.1  # wall top, eave radius, radius of the strip on the building
    outer = [(cw, -RD), (-RS, -RD), (-RS, depth)]            # street edge, corner in the middle
    wall = [(cw, 0.0), (0.0, 0.0), (0.0, depth)]             # the building's walls
    quarter = [(math.cos(t), math.sin(t)) for t in (k / 6 * math.pi / 2 for k in range(7))]
    # eave: from upright at the wall top to flat at the roof, inward from the street edge
    sweep("RestaurantEave", outer, [(R - R * c, WT + R * sn) for c, sn in quarter], -1, "glass")
    # strip on the building: rises off the roof RI out from the wall and leans in onto it
    sweep("RestaurantLean", wall, [(RI * c, WT + R + RI * sn) for c, sn in quarter], 1, "glass")   # one glass everywhere (Adriaen)
    for x0, x1, y0, y1 in ((-RS, cw, -RD, 0.0), (-RS, 0.0, 0.0, depth)):
        cxa, cya, wx, wy = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
        box("RestaurantPlinth", (cxa, cya, 0.35), (wx, wy, 0.7), "granite")
        box("Restaurant", (cxa, cya, (0.7 + WT) / 2), (wx - 0.1, wy - 0.1, WT - 0.7), "glass")   # one window glass for all of Føniks (Adriaen)
        ux0, uy0 = x0 + R, y0 + (R if y0 < 0 else 0.0)   # the roof sits inside the eave
        box("RestaurantUpper", ((ux0 + x1) / 2, (uy0 + y1) / 2, WT + R / 2), (x1 - ux0, y1 - uy0, R), "glass")   # glazed where an arm ends
        box("RestaurantRoof", ((ux0 + x1) / 2, (uy0 + y1) / 2, WT + R), (x1 - ux0, y1 - uy0, 0.2), "dark")
    for x in [cw - 0.05 - i * 1.6 for i in range(int((cw + RS) / 1.6) + 1) if cw - 0.05 - i * 1.6 > -RS + 0.3]:   # frames on the street faces
        box("Mullion", (x, -RD, (0.7 + WT) / 2), (0.1, 0.12, WT - 0.7), "dark")
        if x > -RS + R:   # a rib this close to the corner would cross the mitred hip
            rib(outer, 0, x, quarter, R, WT, -1)
    for y in [depth - 0.05 - i * 1.6 for i in range(int((depth + RD) / 1.6) + 1) if depth - 0.05 - i * 1.6 > -RD + 0.3]:
        box("Mullion", (-RS, y, (0.7 + WT) / 2), (0.12, 0.1, WT - 0.7), "dark")
        if y > -RD + R:
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
        dormer(x, -0.2, eave, False)
    # The south side along Kongens gate (build -x face) is red brick, with the same
    # white-framed windows with crosses
    # the brick and the tan band are single quads laid on the cream wall (no slab of their
    # own), and the windows sit on the brick
    pane("SouthBrick", "w", depth / 2, (5.0 + eave - 1.2) / 2, depth, eave - 1.2 - 5.0, -0.01, "brick")   # cream ground floor
    pane("SouthBand", "w", depth / 2, eave - 0.6, depth, 1.2, -0.01, "phoenix")   # tan band under the eave
    # the north end (+x face) the same as the other sides (Adriaen): dark plinth, cream
    # ground floor, brick, tan band under the eave
    pane("NorthBrick", "e", depth / 2, (5.0 + eave - 1.2) / 2, depth, eave - 1.2 - 5.0, L + 0.01, "brick")
    pane("NorthBand", "e", depth / 2, eave - 0.6, depth, 1.2, L + 0.01, "phoenix")
    box("FoniksPlinth", (L + 0.12, depth / 2, 0.5), (0.3, depth, 1.0), "plinth")
    for y in SOUTH_COLS:   # three round-topped dormers on the south slope
        dormer(y, -0.2, eave, True)
    for z in rows:
        for y in SOUTH_COLS:
            window(y, z, -0.01, side=True, h=1.7 if z in rows[:2] else 2.1, arch=z in rows[:2])


# A half-folded wing (Adriaen's close photo): a rounded shoulder just above the head,
# the outer edge hanging straight down, the tip pointing down beside the outer lamp.
# (out from the body's centre, height above the body's centre)
WING = [(0.2, 0.2), (0.32, 0.5), (0.5, 0.62), (0.68, 0.58), (0.84, 0.42), (0.9, 0.1), (0.88, -0.3),
        (0.8, -0.65), (0.7, -0.82), (0.58, -0.6), (0.44, -0.35), (0.3, -0.1)]


def wing(name, centre, side):
    """One half-folded wing as a flat outline with a little thickness, cupped forward."""
    pts = [(centre[0] + side * u, centre[1] - 0.3 * (u - 0.2) ** 2, centre[2] + v) for u, v in WING]
    me = bpy.data.meshes.new(name)
    me.from_pydata(pts, [], [tuple(range(len(pts)))])
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M["bronze_dark"])
    o.modifiers.new("Thick", "SOLIDIFY").thickness = 0.06


def phoenix_fountain(cx, cy, z0=0.15):
    """The phoenix fountain in front of the Føniks entrance (Adriaen's photo): a low
    round basin with a thick stone rim, a dark tiled column, three globe lamps at the
    front and the bronze phoenix rising from its nest, wings half folded and pointing down."""
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
        wing("Wing", (cx, cy + 0.02, 2.3), side)
        for u, v in ((0.76, 0.42), (0.8, 0.24), (0.8, 0.04), (0.77, -0.16)):   # round bosses down the outer edge
            bpy.ops.mesh.primitive_uv_sphere_add(segments=4, ring_count=2, radius=0.06,
                                                 location=(cx + side * u, cy + 0.02 - 0.3 * (u - 0.2) ** 2 - 0.06, 2.3 + v))
            bpy.context.object.data.materials.append(M["steel"])
    for o in set(bpy.data.objects) - before:   # raised on a stone drum to the terrace's height
        o.location.z += z0
    cyl("Drum", (cx, cy, 0), 3.25, z0 + 0.3, "granite", 24)


# café furniture shared by the restaurant terrace and the annex's Frati terrace
def chair(x, y, a):   # two slabs: a back that runs down to the ground as the rear legs, and the seat
    c, s_ = math.cos(a), math.sin(a)
    box("Chair", (x, y, 0.45), (0.42, 0.42, 0.04), "dark", a)
    box("Chair", (x - 0.2 * c, y - 0.2 * s_, 0.45), (0.04, 0.42, 0.9), "dark", a)


def table(x, y, w=0.8, d=0.8, rot=0.0):
    box("CafeTable", (x, y, 0.73), (w, d, 0.04), "dark", rot)
    box("CafeTable", (x, y, 0.36), (0.08, 0.08, 0.72), "dark")


def parasol(x, y, size):
    box("ParasolPole", (x, y, 1.45), (0.05, 0.05, 2.9), "dark")   # raised 40 cm (Adriaen)
    o = cyl("Parasol", (x, y, 2.45), size / math.sqrt(2), 0.5, "canvas", 4, 0.04)
    o.rotation_euler.z = math.pi / 4   # a square canopy lined up with the street


def planter(x, y, s_=0.7):
    box("Planter", (x, y, 0.3), (s_, s_, 0.6), "dark")
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=s_ * 0.62, location=(x, y, 0.6 + s_ * 0.45))
    o = bpy.context.object
    o.name, o.scale.z = "Shrub", 0.8
    o.data.materials.append(M["tree"])


def outdoor_seating(variant):
    """The restaurant's outdoor seating (2024 drone photo, Adriaen's corner photo), in
    Føniks's build frame: a terrace on the Kongens gate side behind low dark
    windscreens, dark square planters with shrubs at the corner door and along the
    front, and (TRD_PICNIC=1) picnic tables out on the square. Variants keep their furniture apart:
    A = square parasols over four-seat tables, B = an awning along the glass over rows
    of two-seat bistro tables, C = long beer-garden tables with benches under big
    parasols. TRD_SEATING picks one; "none" leaves the square bare."""
    if variant == "none":
        return
    x0, x1 = -REST_RS - 0.4, -REST_RS - 3.8      # terrace: from the glass out toward the street
    y0, y1 = -REST_RD + 3.0, 11.6               # from past the corner door to near the annex
    xm = (x0 + x1) / 2

    def picnic(x, y):   # wooden table with fixed benches, long side along the front
        box("Picnic", (x, y, 0.74), (1.8, 0.75, 0.05), "wood")
        for k in (-1, 1):
            box("Picnic", (x, y + k * 0.6, 0.45), (1.8, 0.28, 0.05), "wood")
            box("Picnic", (x + k * 0.7, y, 0.36), (0.08, 1.4, 0.72), "wood")

    # dark windscreens round the terrace's open sides
    box("Windscreen", (x1, (y0 + y1) / 2, 0.5), (0.05, y1 - y0, 1.0), "dark")
    for y in (y0, y1):
        box("Windscreen", (xm, y, 0.5), (x0 - x1, 0.05, 1.0), "dark")
    for x, y in ((x1, y0), (x1, y1), (-REST_RS - 0.5, -REST_RD + 1.7), (-REST_RS + 1.7, -REST_RD - 0.55),
                 (-2.0, -REST_RD - 0.55), (1.6, -REST_RD - 0.55)):
        planter(x, y)
    if os.environ.get("TRD_PICNIC") == "1":   # picnic tables out on the square (Adriaen: off)
        for x in (-4.5, -1.0, 2.5):
            picnic(x, -REST_RD - 4.2)
    n = 5
    ys = [y0 + (i + 0.5) * (y1 - y0) / n for i in range(n)]
    if variant == "A":
        for y in ys:
            parasol(xm, y, 2.6)
            table(xm, y)
            for a in (0, math.pi / 2, math.pi, -math.pi / 2):
                chair(xm - 0.65 * math.cos(a), y - 0.65 * math.sin(a), a)
    elif variant == "B":
        hi, lo = 2.6, 2.2   # the awning: from just under the glass curve out over the terrace
        aw = box("Awning", (xm, (y0 + y1) / 2, (hi + lo) / 2), (x0 - x1 + 0.4, y1 - y0, 0.04), "canvas")
        aw.rotation_euler.y = math.atan2(hi - lo, x0 - x1 + 0.4)
        box("AwningValance", (x1 - 0.2, (y0 + y1) / 2, lo - 0.12), (0.03, y1 - y0, 0.25), "canvas")
        for x in (x0 - 0.9, x1 + 0.9):
            for i in range(7):
                y = y0 + 1.0 + i * (y1 - y0 - 2.0) / 6
                cyl("CafeTable", (x, y, 0.71), 0.32, 0.04, "dark", 6)
                box("CafeTable", (x, y, 0.36), (0.06, 0.06, 0.72), "dark")
                for k in (-1, 1):
                    chair(x, y + k * 0.55, -k * math.pi / 2)
    else:   # C: beer garden
        for y in ys[::2]:
            parasol(xm, y, 3.4)
        for y in ys:
            box("LongTable", (xm, y, 0.74), (0.8, 2.6, 0.05), "wood")
            box("LongTable", (xm, y, 0.36), (0.6, 0.08, 0.72), "wood")
            for k in (-1, 1):
                box("Bench", (xm + k * 0.65, y, 0.45), (0.3, 2.6, 0.05), "wood")
                box("Bench", (xm + k * 0.65, y, 0.22), (0.25, 0.08, 0.44), "wood")


FOUNT = (FW / 2, -6.5)   # phoenix fountain: centred on the doors, its back just clear of the platform steps
SOUTH_COLS = (2.9, 6.4, 9.9)   # south wall window columns, from the front (Kongens gate photo)
_before = set(bpy.data.objects)
foniks()
phoenix_fountain(*FOUNT)   # set into the terrace steps, in front of the doors
outdoor_seating(os.environ.get("TRD_SEATING", "A"))
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
bpy.context.view_layer.update()   # box() objects only get their matrix_world here
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
AS, JW = FONIKS_SOUTH - 0.4, 2.2   # annex street face (40 cm proud of Føniks, Adriaen), joint width
ax0, ax1 = FB - JW - 17.7, FB - JW   # 17.7 m wide (GPS pins on both street corners)
acx = (ax0 + ax1) / 2
EX = ax0 + 15.6   # the entrance bay under the box's east end starts here, set back to the joint's copper (Adriaen)
box("FoniksAnnex", ((ax0 + EX) / 2, AS + 10.5, 8.4), (EX - ax0, 21, 16.8), "travertine")
box("FoniksAnnex", ((EX + ax1) / 2, (FONIKS_SOUTH + AS + 21) / 2, 8.4), (ax1 - EX, AS + 21 - FONIKS_SOUTH, 16.8), "travertine")   # the copper top floor sits on it
# Street front, ground floor (winter photo): dark glass between copper piers on a granite
# base, then a travertine pier down to the ground and the glazed entrance under the
# box's east end
gx = ax0 + 11.4
box("FoniksAnnexBase", ((ax0 + gx) / 2, AS - 0.05, 2.65), (gx - ax0 - 0.2, 0.12, 5.3), "glass")
box("FoniksAnnexPlinth", ((ax0 + gx) / 2, AS - 0.12, 0.3), (gx - ax0, 0.24, 0.6), "granite")
for i in range(5):
    box("FoniksAnnexPier", (ax0 + 0.25 + i * (gx - ax0 - 0.5) / 4, AS - 0.14, 2.95), (0.5, 0.28, 4.7), "copper")
box("FoniksAnnexGroundPier", (gx + 2.1, AS - 0.5, 2.65), (4.2, 1.0, 5.3), "travertine")
pane("FoniksAnnexBase", "s", (EX + ax1) / 2 + 0.03, 1.75, ax1 - EX + 0.06, 3.5, FONIKS_SOUTH - 0.02, "glass")
pane("FoniksAnnexJoint", "s", (EX + ax1) / 2 + 0.03, 4.4, ax1 - EX + 0.06, 1.8, FONIKS_SOUTH - 0.02, "copper")   # copper above the canopy, lapping onto the joint so no tan seam shows
box("FoniksAnnexBox", (acx, (AS - 1.0 + FONIKS_SOUTH) / 2, 11.05), (ax1 - ax0, FONIKS_SOUTH - AS + 1.0, 11.5), "travertine")   # stands proud of the street, flush with the west wall and the annex's east side


def annex_win(c, z, w, h, face, mat="glass"):
    """A window on the annex: slim dark bronze frame flush on the wall (a raised
    one cast a shadow that read as a wireframe), glass (or lowered blinds) on it. face "s" = on the box's street face (c = x), "w" = on the west wall (c = y)."""
    if face == "s":
        pane("FoniksAnnexFrame", "s", c, z, w + 0.12, h + 0.12, AS - 1.01, "bronze_dark")
        pane("FoniksAnnexWin", "s", c, z, w, h, AS - 1.02, mat)
    else:
        pane("FoniksAnnexFrame", "w", c, z, w + 0.12, h + 0.12, ax0 - 0.01, "bronze_dark")
        pane("FoniksAnnexWin", "w", c, z, w, h, ax0 - 0.02, mat)


# The travertine box: six window columns, the first well in from the west corner; the
# top row runs to the floor behind a glass balustrade, the middle row has its blinds down
# Adriaen: one glass everywhere, so the lowered blinds and the glass balustrade from the
# photos are plain window glass unless TRD_BLINDS=1
if os.environ.get("TRD_BLINDS") != "1":
    M["blind"] = M["blind_green"] = M["glass"]
RAIL = "skylight" if os.environ.get("TRD_BLINDS") == "1" else "glass"
ROWS = ((7.0, 2.3, "glass"), (10.4, 2.3, "blind"), (13.9, 2.6, "glass"))
for z, h, mat in ROWS:
    for x in [ax0 + 3.5 + i * 2.5 for i in range(6)]:
        annex_win(x, z, 1.2, h, "s", mat)   # tall and narrow (summer street photos)
    # the corner window wraps round onto Bersvendveita with no pier at the corner
    # (Adriaen's markup): glass out to the box's corner, round its 1 m return, and on
    # into the first west window
    # one glass strip per face, meeting at the corner; frames only on the far edges
    cx0, cx1, cy1 = ax0, ax0 + 1.25, AS + 1.2
    pane("FoniksAnnexFrame", "s", (cx0 + cx1) / 2 + 0.06, z, cx1 - cx0, h + 0.12, AS - 1.01, "bronze_dark")
    pane("FoniksAnnexWin", "s", (cx0 + cx1) / 2 - 0.01, z, cx1 - cx0 + 0.02, h, AS - 1.02, mat)
    pane("FoniksAnnexFrame", "w", (AS - 1.01 + cy1) / 2 + 0.06, z, cy1 - AS + 1.01, h + 0.12, cx0 - 0.01, "bronze_dark")
    pane("FoniksAnnexWin", "w", (AS - 1.02 + cy1) / 2, z, cy1 - AS + 1.02, h, cx0 - 0.02, mat)
for x in [ax0 + 3.5 + i * 2.5 for i in range(6)]:
    box("FoniksAnnexRail", (x, AS - 1.1, 13.1), (1.2, 0.04, 0.9), RAIL)
box("FoniksAnnexRail", ((cx0 + cx1) / 2, AS - 1.1, 13.1), (cx1 - cx0, 0.04, 0.9), RAIL)
box("FoniksAnnexRail", (cx0 - 0.1, (AS - 1.1 + cy1) / 2, 13.1), (0.04, cy1 - AS + 1.1, 0.9), RAIL)
# Bersvendveita side (Adriaen's street photos): travertine for the first 13 m, five window
# columns with the corner one, the same rows, a shop window, a door and plain travertine below, then copper-clad all the way along the block:
# copper pilasters framing pairs and single windows with blinds, narrow bays of vertical
# grilles, and louvred vents, green blinds and dark glass on the ground floor
TW, BE = 13.0, FONIKS_SOUTH + FW   # where the copper starts, the block's north end
box("FoniksAnnexShop", (ax0 - 0.05, AS + 4.1, 2.6), (0.12, 7.0, 4.2), "glass")
box("FoniksAnnexDoor", (ax0 - 0.05, AS + 8.4, 1.25), (0.12, 1.2, 2.5), "door")
for z, h, mat in ROWS:
    for y in (AS + 3.6, AS + 6.2, AS + 8.8, AS + 11.4):   # the first column is the corner glass
        annex_win(y, z, 1.2, h, "w", mat)
# copper part, counted on Adriaen's photos from the travertine northwards to the yellow
# brick neighbour: each floor has ten windows in singles (S) and pairs (P) that step
# between floors, and a bay of vertical grilles (G) at the far end
BAYS = {13.9: "SPSPSPSG", 10.4: "SSPSPSPG", 7.0: "SPSPSPSG", 2.5: "GSGGSSGG"}
BW = {"S": 1.3, "P": 2.6, "G": 1.2}
CE = AS + TW + sum(BW[c] + 0.55 for c in BAYS[13.9]) + 0.3   # where the copper building ends
box("FoniksAnnexClad", (ax0 - 0.06, (AS + TW + CE) / 2, 8.4), (0.12, CE - AS - TW, 16.8), "copper")
for z, row in BAYS.items():
    y = AS + TW + 0.55
    h = 3.6 if z < 5 else 2.3
    for c in row:
        w = BW[c] * (len(row) * 1.75 / sum(BW[q] for q in row) if z < 5 else 1.0)   # ground floor bays stretched to fit
        if c == "G":
            box("FoniksAnnexGrille", (ax0 - 0.14, y + w / 2, z), (0.06, w, h), "bronze_dark")
        else:
            mat = "blind_green" if z < 5 else ("glass" if z == 7.0 else "blind")
            if z < 5:   # ground floor: one wide pane behind its blind
                box("FoniksAnnexWin", (ax0 - 0.14, y + w / 2, z), (0.06, w - 0.1, h), mat)
            else:
                for i in range(1 if c == "S" else 2):
                    box("FoniksAnnexWin", (ax0 - 0.14, y + 0.65 + i * 1.3, z), (0.06, 1.2, h), mat)
        y += w + 0.55


# Copper top floor (the cantina), set back about a metre from the travertine box on
# both streets (Adriaen, Google 3D), a good third of the box's height, reaching on
# over part of the joint
# It covers the whole travertine and copper building (Adriaen), so it runs on behind the
# joint to Føniks's back wall and north to the yellow neighbour
tx0, tx1, ty0, ty1 = ax0 + 0.9, ax1, AS + 0.0, CE   # stops at the joint: nothing over it above 13.6 m (Adriaen)
TT = 20.2
AGY1 = CE - 3.5   # where the glass atrium ends in the north (Adriaen: on nearly to the north end)
prism("FoniksAnnexTop", [(tx0, ty0), (tx1, ty0), (tx1, AGY1), (FB, AGY1), (FB, ty1), (tx0, ty1)], 16.75, TT, "copper")
# Its roof (Adriaen, Google 3D): a rooftop bar inside a curved fence that sweeps from
# the Bersvendveita side round to the street side, plain roof outside it along both
# streets, utility rooms with white doors (HVAC on top) at the back of the bar, and a
# glass roof bridging across to Føniks
FC, FR = (ax0 + 14.9, AS + 14.5), 11.0   # the fence's centre and radius (moved north off the street edge, Adriaen)
fence = [(FC[0] + FR * math.cos(math.pi + k * math.pi / 16), FC[1] + FR * math.sin(math.pi + k * math.pi / 16)) for k in range(9)]
for (x0_, y0_), (x1_, y1_) in zip(fence, fence[1:]):
    seg = box("RoofBarFence", ((x0_ + x1_) / 2, (y0_ + y1_) / 2, TT + 0.6), (math.hypot(x1_ - x0_, y1_ - y0_) + 0.05, 0.06, 1.2), "dark")
    seg.rotation_euler.z = math.atan2(y1_ - y0_, x1_ - x0_)
# decking over everything inside the inner fences (Adriaen), as two convex pieces: the
# quarter circle out to the joint-side railing, and the strip north of it up to the north room
DN = AS + 15.4   # where the joint-side railing turns in to the utility room
prism("RoofBarDeck", fence + [(tx1 - 0.1, fence[-1][1]), (tx1 - 0.1, DN), (fence[0][0], DN)], TT, TT + 0.06, "wood")
prism("RoofBarDeck", [(fence[0][0], DN), (ax0 + 16.0, DN), (ax0 + 16.0, CE - 6.0), (fence[0][0], CE - 6.0)], TT, TT + 0.06, "wood")
for k in range(7):   # seven tables round the fence, no parasols (Adriaen)
    a_ = math.radians(186 + k * 13)
    px_, py_ = FC[0] + (FR - 2.8) * math.cos(a_), FC[1] + (FR - 2.8) * math.sin(a_)
    box("RoofBarTable", (px_, py_, TT + 0.79), (0.8, 0.8, 0.04), "dark", a_)
    box("RoofBarTable", (px_, py_, TT + 0.42), (0.08, 0.08, 0.72), "dark")
    for side in (-1, 1):   # a chair either side, along the fence
        cx_, cy_ = px_ - side * 0.65 * math.sin(a_), py_ + side * 0.65 * math.cos(a_)
        box("RoofBarChair", (cx_, cy_, TT + 0.45), (0.42, 0.42, 0.04), "dark", a_)
        box("RoofBarChair", (cx_ - side * 0.2 * -math.sin(a_), cy_ - side * 0.2 * math.cos(a_), TT + 0.45), (0.42, 0.04, 0.9), "dark", a_)
# and a railing round the roof edge: the Bersvendveita side up to the north room, the street side and
# the joint side up to the utility rooms (Adriaen)
US = AS + 8.3   # the south utility room's south face, just clear of the bar's tables
for (x0_, y0_), (x1_, y1_) in (((tx0 + 0.1, CE - 4.0), (tx0 + 0.1, ty0 + 0.1)), ((tx0 + 0.1, CE - 4.0), (FC[0] - FR, CE - 4.0)),   # on to the north room, turning in to its wall (Adriaen)
                               ((tx0 + 0.1, ty0 + 0.1), (tx1 - 0.1, ty0 + 0.1)),
                               ((tx1 - 0.1, ty0 + 0.1), (tx1 - 0.1, US))):
    box("RoofBarEdgeFence", ((x0_ + x1_) / 2, (y0_ + y1_) / 2, TT + 0.55), (abs(x1_ - x0_) + 0.06, abs(y1_ - y0_) + 0.06, 1.1), "copper")   # the same rusty copper as the annex cladding (Adriaen)
# a flag pole on the roof's south-east corner, outside the bar (Adriaen)
# with the Aker BP banner like the masts out front (Adriaen)
_pre = set(bpy.data.objects)
flag_mast(tx1 - 1.5, ty0 + 1.2, 7.0, TT)
bpy.context.view_layer.update()
from mathutils import Matrix
_pole = Matrix.Translation((tx1 - 1.5, ty0 + 1.2, 0))
_turn = _pole @ Matrix.Rotation(math.radians(90 - 15), 4, "Z") @ _pole.inverted()   # the flag flies out to N15°E (Adriaen)
for o in set(bpy.data.objects) - _pre:
    o.name = "FoniksRoof" + o.name   # so the lean export keeps it
    o.matrix_world = _turn @ o.matrix_world
# and fences closing the bar off from the rest of the roof (Adriaen): the arc's south end
# out to the joint-side railing, and from the arc's west end north along the roof to the north utility room
for run in (((fence[-1][0], fence[-1][1]), (tx1 - 0.1, fence[-1][1])),
            ((fence[0][0], fence[0][1]), (fence[0][0], CE - 6.0))):
    for (x0_, y0_), (x1_, y1_) in zip(run, run[1:]):
        seg = box("RoofBarFence", ((x0_ + x1_) / 2, (y0_ + y1_) / 2, TT + 0.55), (math.hypot(x1_ - x0_, y1_ - y0_) + 0.06, 0.06, 1.1), "dark")
        seg.rotation_euler.z = math.atan2(y1_ - y0_, x1_ - x0_)
# a row of utility rooms down the middle, from a little south of where the copper starts
# to near the north end (Adriaen, Google Earth), in tiers
# the two middle ones run out to the joint side, the south one on into the bar (Adriaen)
for ux0, ux1, uy0, uy1, uh in ((ax0 + 11.0, tx1, US, AS + 18.5, 3.0), (ax0 + 7.0, tx1, AS + 18.5, CE - 6.0, 3.4),
                               (FC[0] - FR, ax0 + 15.0, CE - 6.0, CE - 1.5, 2.6)):   # the small west one is gone, the north one reaches out to the bar's fence (Adriaen)
    if uy0 == US:   # the south one is open to the sky: just walls round fans, ducts and pipes (Adriaen, Google Earth)
        WT = 0.5   # chunky parapet walls (Adriaen)
        for cx_, cy_, sx_, sy_ in (((ux0 + ux1) / 2, uy0 + WT / 2, ux1 - ux0 - 2 * WT, WT), (ux0 + WT / 2, (uy0 + uy1) / 2, WT, uy1 - uy0),
                                   (ux1 - WT / 2, (uy0 + uy1) / 2, WT, uy1 - uy0)):   # the north side is the next room's wall
            box("FoniksAnnexUtility", (cx_, cy_, TT + uh / 2), (sx_, sy_, uh), "roof_light")
        box("FoniksAnnexUtility", ((ux0 + ux1) / 2, (uy0 + uy1) / 2, TT + 0.05), (ux1 - ux0 - 0.1, uy1 - uy0 - 0.1, 0.1), "roof_light")   # felt floor over the deck
        for fy in (uy0 + 2.0, uy0 + 4.2):   # two big fan units by the joint side
            box("FoniksAnnexPlant", (ux1 - 1.6, fy, TT + 0.6), (1.8, 1.8, 1.2), "steel")
            cyl("FoniksAnnexFan", (ux1 - 1.6, fy, TT + 1.2), 0.6, 0.06, "dark", 8)
        box("FoniksAnnexPlant", (ux0 + 2.2, (uy0 + 5.5 + uy1 - 0.8) / 2, TT + 1.3), (0.9, uy1 - 0.8 - uy0 - 5.5, 0.9), "steel")   # a big duct
        cyl("FoniksAnnexPlant", (ux0 + 2.2, uy0 + 5.5, TT), 0.5, 1.8, "steel", 8)   # and its riser
        box("FoniksAnnexPlant", (ux0 + 3.4, uy1 - 1.8, TT + 0.7), (1.6, 1.4, 1.4), "steel")   # an air handler
        for k, py_ in enumerate((uy0 + 1.0, uy0 + 6.2, uy0 + 7.0)):   # pipe runs across
            box("FoniksAnnexPipe", ((ux0 + ux1) / 2, py_, TT + 0.4 + 0.3 * k), (ux1 - ux0 - 0.4, 0.16, 0.16), "frame" if k else "dark")
    else:
        box("FoniksAnnexUtility", ((ux0 + ux1) / 2, (uy0 + uy1) / 2, TT + uh / 2), (ux1 - ux0, uy1 - uy0, uh), "roof_light")
    # white doors onto the bar: the north room's in its south wall, the middle two's in
    # their west walls, a little north of the middle (Adriaen)
    if uy1 > CE - 2:
        box("FoniksAnnexUtilDoor", (ux0 + 1.2, uy0 - 0.03, TT + 1.05), (0.9, 0.06, 2.1), "frame")
    else:
        box("FoniksAnnexUtilDoor", (ux0 - 0.03, uy0 + 0.6 * (uy1 - uy0), TT + 1.05), (0.06, 0.9, 2.1), "frame")
    if uy0 != US:
        box("FoniksAnnexHVAC", ((ux0 + ux1) / 2, (uy0 + uy1) / 2, TT + uh + 0.5), (2.2, 1.6, 1.0), "steel")
# its street face: copper fins at both ends and the middle, two runs of three windows
for fc in (tx0 + 0.6, acx, tx1 - 0.6):
    box("FoniksAnnexFinBack", (fc, ty0 - 0.02, 18.5), (1.2, 0.06, 3.1), "bronze_dark")
    for k in (-1, 0, 1):
        box("FoniksAnnexFin", (fc + k * 0.4, ty0 - 0.14, 18.5), (0.1, 0.25, 3.1), "copper")
for g0, g1 in ((tx0 + 1.2, acx - 0.6), (acx + 0.6, tx1 - 1.2)):
    for k in range(3):
        w = (g1 - g0 - 0.6) / 3
        pane("FoniksAnnexTopWin", "s", g0 + w / 2 + k * (w + 0.3), 18.45, w, 2.3, ty0 - 0.02, "blind" if k == 1 else "glass")
for y in [AS + 2.6, AS + 5.6] + [AS + 9.0 + 3.2 * k for k in range(int((CE - AS - 10.5) / 3.2))]:
    pane("FoniksAnnexTopWin", "w", y, 18.45, 2.2, 2.3, tx0 - 0.02, "glass")
# The copper-clad joint onto Føniks: a tall glazed entrance, two windows above, rising
# past Føniks's eave; the glass atrium roof stands up behind it (winter photo)
# it stops about halfway up the box's top floor (Adriaen's photo, "the 3.5th floor"); above
# it the atrium's glass wall carries on in the same line up to the glass roof (no slot, Adriaen)
JH = 13.6
# the copper carries on Føniks's brick wall line (Adriaen), the annex stands proud of it
JY = FONIKS_SOUTH
box("FoniksAnnexJoint", (FB - JW / 2, (JY + AS + 21) / 2, JH / 2), (JW, AS + 21 - JY, JH), "copper")
# its entrance glass runs on flush with the annex's entrance glass (Adriaen)
# up to the canopy, both set back in the copper wall line (Adriaen)
pane("FoniksAnnexJointWin", "s", FB - JW / 2, 1.75, JW, 3.5, JY - 0.02, "glass")
# the entrance canopy (Adriaen's street photo): a deep copper box over the pavement on two
# dark posts, from the travertine pier across the annex's entrance glass to Føniks
CX0, CD = gx + 4.2, 3.2   # its west end, how far it reaches out from the annex glass
box("FoniksAnnexCanopy", ((CX0 + FB) / 2, (JY + AS - 0.11 - CD) / 2, 3.9), (FB - CX0, JY - AS + 0.11 + CD, 0.8), "copper")   # back to the joint wall, which runs on flush above it
for x in (CX0 + 0.15, FB - 0.15):
    box("FoniksAnnexCanopyPost", (x, AS - 0.11 - CD + 0.15, 1.75), (0.1, 0.1, 3.5), "dark")
pane("FoniksAnnexJointWin", "s", FB - JW / 2, 7.0, JW - 0.5, 2.3, JY - 0.02, "glass")
pane("FoniksAnnexJointWin", "s", FB - JW / 2, 10.4, JW - 0.5, 2.3, JY - 0.02, "blind")
# the glass roof bridging the annex and Føniks (Adriaen, Google Earth): from just under
# the roof terrace's edge it rises over the gap and lands on Føniks's upper slate slope
MS = lambda x: 16.8 + (x - (FB - 0.3)) * 3.6 / 2.0   # the mansard's height over x (eave 16.8, 2 m in over 3.6 m)
MU = lambda x: 20.4 + (x - (FB + 1.7)) * 2.6 / 4.69   # the upper roof's, up to the ridge
gx0, gz0, gz1 = FB - JW, TT - 0.2, 21.6
gx1 = FB + 1.7 + (gz1 - 20.4) * 4.69 / 2.6   # where the glass meets the slates
gy0, gy1 = JY + 4.6, AGY1   # it starts ~5 m back from the street (Adriaen); flat roof in front
glass = prism("FoniksAtrium", [(gx0, gy0), (gx1, gy0), (gx1, gy1), (gx0, gy1)], 0, 0.1, "glass")
for v in glass.data.vertices:
    v.co.z += gz0 + (gz1 - gz0) * (v.co.x - gx0) / (gx1 - gx0)
NB = round((gy1 - gy0) / 1.7) + 1   # glazing bars about 1.7 m apart
for k in range(NB):
    y_ = gy0 + 0.2 + k * (gy1 - gy0 - 0.4) / (NB - 1)
    bar = box("FoniksAtriumBar", ((gx0 + gx1) / 2, y_, (gz0 + gz1) / 2 + 0.14), (math.hypot(gx1 - gx0, gz1 - gz0), 0.08, 0.08), "dark")
    bar.rotation_euler.y = -math.atan2(gz1 - gz0, gx1 - gx0)
# in front of it the joint stays at 13.6 m (Adriaen); the glass's south end comes down
# to the joint's top and onto the slates
me = bpy.data.meshes.new("FoniksAtriumWall")
gs = [(gx0, JH), (FB, JH), (FB, MS(FB)), (FB + 1.7, MS(FB + 1.7)), (gx1, gz1), (gx0, gz0)]
me.from_pydata([(x, gy0 - 0.02, z) for x, z in gs], [], [tuple(range(len(gs)))])
me.materials.append(M["glass"])
scene.collection.objects.link(bpy.data.objects.new("FoniksAtriumWall", me))
# and its north end, from the cantina's roof and the slates up to the glass
me = bpy.data.meshes.new("FoniksAtriumWall")
gn = [(gx0 + (TT - gz0) * (gx1 - gx0) / (gz1 - gz0), TT), (FB, TT), (FB, MS(FB)), (FB + 1.7, MS(FB + 1.7)), (gx1, gz1)]
me.from_pydata([(x, gy1 + 0.02, z) for x, z in gn], [], [tuple(range(len(gn)))[::-1]])
me.materials.append(M["glass"])
scene.collection.objects.link(bpy.data.objects.new("FoniksAtriumWall", me))
# Føniks's west wall shows over the joint up to the atrium: brick with the tan band
# under the eave, like the south wall (Adriaen)
pane("FoniksWestBrick", "w", (JY + gy0) / 2, (JH + 15.6) / 2, gy0 - JY, 15.6 - JH, FB - 0.01, "brick")
pane("FoniksWestBand", "w", (JY + gy0) / 2, 16.2, gy0 - JY, 1.2, FB - 0.01, "phoenix")
# and north of the annex, where the west wall is in the open: plinth, cream ground floor,
# brick, tan band, like the other sides (Adriaen)
NE_ = FONIKS_SOUTH + FW
pane("FoniksWestBrick", "w", (CE + NE_) / 2, (5.0 + 15.6) / 2, NE_ - CE, 15.6 - 5.0, FB - 0.01, "brick")
pane("FoniksWestBand", "w", (CE + NE_) / 2, 16.2, NE_ - CE, 1.2, FB - 0.01, "phoenix")
box("FoniksWestPlinth", (FB - 0.12, (CE + NE_) / 2, 0.5), (0.3, NE_ - CE, 1.0), "plinth")
# Summer: a dark pergola with a canvas top over the glass bays (drone photos)
AWE = EX - 1.2   # the canvas runs on almost to the entrance, a strip of travertine short of it (Adriaen)
if os.environ.get("TRD_ANNEX_AWNING", "canvas") == "canvas":
    # it slopes from a cassette on the wall under the travertine box down to the front beam
    # (Adriaen's street photo)
    y0, z0, y1, z1 = AS - 1.0, 5.1, AS - 4.9, 3.0
    aw = box("FoniksAnnexAwning", ((ax0 + AWE) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (AWE - ax0, math.hypot(y0 - y1, z0 - z1), 0.08), "canvas")
    aw.rotation_euler.x = math.atan2(z0 - z1, y0 - y1)
    box("FoniksAnnexAwningBeam", ((ax0 + AWE) / 2, AS - 1.1, 5.15), (AWE - ax0, 0.25, 0.3), "dark")   # the cassette
    box("FoniksAnnexAwningBeam", ((ax0 + AWE) / 2, AS - 4.9, 2.85), (AWE - ax0, 0.15, 0.3), "dark")
else:   # the older all-dark pergola, over the whole front
    box("FoniksAnnexAwning", (acx, AS - 3.0, 3.0), (ax1 - ax0, 4.0, 0.15), "dark")
for i in range(6):
    box("PergolaPost", (ax0 + 0.5 + i * (AWE - ax0 - 1.0) / 5, AS - 4.9, 1.5), (0.15, 0.15, 3.0), "dark")
# Frati's terrace out in front of the awning (Adriaen's street photos): four-seat tables
# under square parasols behind a low dark fence, reaching as far out into Kongens gate as
# the restaurant's terrace round the corner
_pre = set(bpy.data.objects)
fy0, fy1 = AS - 5.2, FONIKS_SOUTH - REST_RS - 3.8   # from the awning's posts out to the restaurant terrace's line
fx0, fx1 = ax0 + 0.6, AWE
fym = (fy0 + fy1) / 2
box("Windscreen", ((fx0 + fx1) / 2, fy1, 0.5), (fx1 - fx0, 0.05, 1.0), "dark")
for x, yw in ((fx0, AS - 0.25), (fx1, AS - 1.0)):   # the sides run back to the wall (Adriaen): the plinth, the travertine pier
    box("Windscreen", (x, (yw + fy1) / 2, 0.5), (0.05, yw - fy1, 1.0), "dark")
for x, y in ((fx0, fy1), (fx1, fy1)):
    planter(x, y)
NF = 5
for i in range(NF):
    x = fx0 + (i + 0.5) * (fx1 - fx0) / NF
    parasol(x, fym, 2.6)
    table(x, fym)
    for a in (0, math.pi / 2, math.pi, -math.pi / 2):
        chair(x - 0.65 * math.cos(a), fym - 0.65 * math.sin(a), a)
for o in set(bpy.data.objects) - _pre:
    o.name = "FoniksFrati" + o.name
box("FoniksBack", ((ax0 + FB) / 2, (AS + 21 + CE) / 2, 8.4), (FB - ax0, CE - AS - 21, 16.8), "copper")   # the same building on along Bersvendveita
block("YellowBers", ax0, FB, CE, BE, 15.5, "c5", 5, ("-x",), None)   # then the yellow brick neighbour


def export_glb():
    """Føniks on its own for the spin-around viewer and story mode. Called as soon as
    Føniks and its annex are built, so the square, the town, the statue and the
    characters are never built for an export."""
    bpy.ops.object.select_all(action="DESELECT")
    keep = FONIKS_OBJS | {o for o in bpy.data.objects if o.name.startswith(("Foniks", "PergolaPost", "RoofBar"))}
    # Lean export: drop buried and flush-hidden faces, then one mesh per material
    import mesh_cleanup
    keep = [o for o in keep if o.type == "MESH"]
    mesh_cleanup.strip_hidden(keep)
    mesh_cleanup.fronts_only(keep, {"Win", "Mullion", "Transom", "Cartouche", "DormerWin", "Capital", "FoniksAnnexWin",
                                    "FoniksAnnexTopWin", "FoniksAnnexJointWin", "FoniksAnnexFrame", "FoniksAnnexRail", "FoniksAnnexFinBack", "FoniksAnnexGrille", "FoniksAnnexBalustrade", "Fanlight", "Door", "BrickPanel", "SouthBand", "NorthBand",
                                    "ParapetSlot", "PierStrip", "Keystone", "DoorArch", "SunHub", "ArchFill"})
    if os.environ.get("TRD_STATS"):   # triangles left per part, biggest first
        import collections, re
        tri, cnt = collections.Counter(), collections.Counter()
        for o in keep:
            tri[re.sub(r"\.\d+$", "", o.name)] += sum(len(p.vertices) - 2 for p in o.data.polygons)
            cnt[re.sub(r"\.\d+$", "", o.name)] += 1
        for k, v in tri.most_common(int(os.environ.get("TRD_STATS_N", 30))):
            print(f"  {k:24s}{v:6d}  x{cnt[k]}")
    merged = mesh_cleanup.merge_by_material(keep)
    import facade_textures   # TRD_TEX=varied (Adriaen's pick)|lines|photo|none
    merged = facade_textures.apply(merged, os.environ.get("TRD_TEX", "varied"), os.path.join(os.path.dirname(os.path.abspath(args.glb)), "tex"))
    for o in merged:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=args.glb, use_selection=True, export_apply=True, export_yup=True)
    print("wrote", args.glb)
    sys.exit(0)


if args.glb:
    export_glb()
# West of the annex: a block clad in copper-brown fins on a tight window grid
block("BrickW", -108, FB - 22, 13, 32, 17, "copper", 6, ("-y",), None)
# Right after Føniks at its north end, facing the square: the small pink wooden house
# with a steep grey roof and a cross gable, more old houses north of it on Munkegata
PH = (FONIKS_SOUTH + FW, FONIKS_SOUTH + FW + 22)   # a long low house on the square
block("PinkHouse", FONIKS_FRONT - 12, FONIKS_FRONT + 5, PH[0], PH[1], 8, "orange", 2, ("+x", "-y"), None)
frustum("PinkRoof", (FONIKS_FRONT - 3.5, (PH[0] + PH[1]) / 2), 8, 17.6, PH[1] - PH[0] + 0.6, 3, PH[1] - PH[0] - 9, 5.5, "roof_light")   # hipped, light grey
block("OldN", FONIKS_FRONT - 18, FONIKS_FRONT + 3, PH[1] + 1, PH[1] + 40, 12, "c1", 4, ("+x",), "slate", 4)
# North side east of Munkegata: the dark modern block with ribbon windows under a dark
# mansard and café awnings along its front, a white block beside it
block("GlassN", -6, 22, SQ_N + 0.5, 85, 15, "glass_block", 5, ("-y", "-x"), "slate", 3)
for i in range(6):
    box("CafeAwning", (-3 + i * 4.2, SQ_N - 2.2, 2.6), (3.8, 3.4, 0.15), "frame")
block("WhiteN", 22, 44, SQ_N + 0.5, 82, 14, "c3", 4, ("-y",), "slate", 4)
# Munkegata north runs off toward the fjord between tree rows
for y in range(50, 140, 9):
    for x in (-33, -12):
        cyl("Trunk", (x, y, 0), 0.15, 2.2, "trunk", 6)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=2.2, location=(x, y, 4.4))
        bpy.context.object.data.materials.append(M["tree"])
# West side south of Kongens gate: Trondheim Torg, beige with tall window strips, the
# red sign high up, shop windows and McDonald's at street level, a big screen; the
# green pavilion drum on its short post in front
TX, TY = -42.0, -32.0   # front line; Kongens gate (bus stops) lies between it and Føniks
box("Torg", (TX - 20, TY, 8), (40, 34, 16), "torg")
box("TorgTop", (TX - 22, TY, 17.5), (34, 32, 3), "glass_block")
box("TorgRoof", (TX - 20, TY, 16.1), (40.6, 34.6, 0.3), "dark")
box("TorgShops", (TX + 0.1, TY, 2.2), (0.3, 32, 4.0), "glass")
box("TorgFascia", (TX + 0.3, TY, 4.6), (0.3, 32, 0.6), "red")
for i in range(12):
    box("TorgStrip", (TX + 0.1, -47 + i * 2.7, 10.5), (0.25, 1.1, 10.0), "glass")
box("TorgSign", (TX + 0.4, -21, 15.2), (0.3, 10, 1.4), "red")
box("TorgScreen", (TX + 0.4, -36, 9.0), (0.3, 6, 3.0), "red")
cyl("PavilionPost", (-25, -21, 0), 1.2, 3.0, "frame", 12)
cyl("Pavilion", (-25, -21, 3.0), 5.5, 2.8, "verdigris", 32)
cyl("PavilionLid", (-25, -21, 5.8), 5.5, 0.15, "dark", 32)
# South side: the yellow 1950s office block facing north over the square, Munkegata
# running south past its east end
block("YellowS", -62, 11, -80, SQ_S, 18, "c5", 6, ("+y", "+x"), None)
block("SouthE", 39, 70, -100, -57, 10, "c2", 3, ("+y", "-x"), "roof", 4)
block("SouthW", -30, 10, -120, -86, 9, "brick_dark", 3, ("+y", "+x"), "slate", 4)
# East side: a white modern block with vertical fins (cafés in front), the yellow
# older house with dormers at the south-east corner
block("OfficeE", 51, 76, 18, 60, 16, "c3", 5, ("-x",), None)
for i in range(14):
    box("Fin", (50.8, 19.5 + i * 3.0, 9), (0.4, 0.3, 13), "frame")
block("YellowE", 51, 72, -55, -18, 12, "c5", 3, ("-x",), "slate", 4)
# Planters with young trees in rows along the edges of the square
for x, y in ([(-29, y) for y in (27, 18, 9, -10, -36)] + [(24, -60), (30, -72)]
             + [(37, y) for y in (28, 18, 8, -10, -20, -32)] + [(x, 33) for x in (-20, -3, 8, 18, 29)]
             + [(x, -43.5) for x in (-18, -6, 4.5, 23, 33)]):
    box("Planter", (x, y, 0.3), (2.6, 2.6, 0.6), "granite")
    cyl("Trunk", (x, y, 0.6), 0.12, 1.8, "trunk", 6)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.3, location=(x, y, 3.2))
    bpy.context.object.data.materials.append(M["tree"])
# The town behind: low roofs filling the blocks out to the fjord, so the horizon
# isn't empty street, then the fjord and the hills
import random
random.seed(7)
for _ in range(220):
    x, y = random.uniform(-320, 260), random.uniform(-260, 330)
    if -110 < x < 90 and -90 < y < 95:
        continue
    if -40 < x < -4 and y < 160:
        continue
    if math.hypot(x - 79, y + 47) < 140:   # keep the drone's own foreground clear
        continue
    w, d, h = random.uniform(12, 30), random.uniform(10, 26), random.uniform(8, 18)
    box("Town", (x, y, h / 2), (w, d, h), random.choice(("c1", "c3", "c4", "c5", "pink", "brick_dark")))
    box("TownRoof", (x, y, h + 0.6), (w + 0.4, d + 0.4, 1.2), random.choice(("slate", "roof", "brick")))
box("Fjord", (0, 560, -0.2), (1600, 500, 0.1), "water")
box("FjordW", (-700, 260, -0.22), (700, 500, 0.1), "water")   # the bay opens to the north-west
for x, y, sx, sz in [(-700, -150, 260, 120), (-500, 700, 400, 60), (300, 900, 500, 50)]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=(x, y, -5))
    bpy.context.object.scale = (sx, 80, sz)
    bpy.context.object.data.materials.append(M["hill"])
    bpy.context.object.visible_shadow = False   # far away; their shadows only blacken the fjord


def load_char(name, loc, yaw, mat=None, scale=1.0, pose=None):
    path = os.path.join(ROOT, "characters", name, name + ".glb")
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


# Statue: the base body in bronze, scaled 2x. Right arm down with the sword across the
# legs, left arm forward with the cup (2019 photo, 1921 drawing), facing south down Munkegata
statue, rig = load_char("bearded_operator", (0, 0, TOP), math.pi, "bronze", 2.0,
                        {"upper_arm.R": (-30, 30, 15), "upper_arm.L": (-60, -75, 30), "forearm.L": (-30, -15, -75)})
bpy.context.view_layer.update()
W = lambda bone, end="tail": rig.matrix_world @ getattr(rig.pose.bones[bone], end)
hand = W("hand.R")
tip = hand + Vector((0.95, -0.8, -0.95))   # blade across the legs to the left foot
sword = box("Sword", (hand + tip) / 2, (0.09, 0.03, (tip - hand).length), "bronze")
sword.rotation_euler = (tip - hand).to_track_quat("Z", "Y").to_euler()
box("Guard", hand + (tip - hand).normalized() * 0.12, (0.4, 0.08, 0.06), "bronze")
head, crown = W("head", "head"), W("head")
cyl("Helmet", (crown.x, crown.y, crown.z - 0.2), 0.27, 0.42, "bronze", 10, 0.03)   # conical nasal helmet
hips = W("hips", "head")
cyl("Mail", (hips.x, hips.y, hips.z - 0.8), 0.42, 1.2, "bronze", 10, 0.34)   # mail shirt down to the knees
cup = W("hand.L")
cyl("CupFoot", (cup.x, cup.y, cup.z - 0.05), 0.08, 0.2, "bronze", 8)
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.17, location=(cup.x, cup.y, cup.z + 0.28))
bpy.context.object.data.materials.append(M["bronze"])
cyl("CupCross", (cup.x, cup.y, cup.z + 0.42), 0.03, 0.22, "bronze", 4)
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.35, location=(0.35, 0.25, TOP + 0.15))
bpy.context.object.scale.z = 1.3   # the stone by his left foot
bpy.context.object.data.materials.append(M["bronze"])
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
    # P_*: from the spots of Adriaen's 2025 photos, for side-by-side checks
    "P_front_close": ((-32.0, 39.5, 1.6), (-44.5, 39.5, 9.0), 20.0, 0.61),
    "P_corner": ((-24.0, 12.0, 1.6), (-47.0, 30.0, 9.0), 20.0, 1.5),
    "P_kongens": ((-60.0, -1.5, 1.7), (-60.0, 20.5, 9.0), 22.0, 1.34),
    "P_fountain_steps": ((-30.0, 43.0, 1.6), (-44.5, 39.0, 3.5), 26.0, 0.97),
    "P_ramp_terrace": ((-30.0, 31.0, 1.6), (-44.5, 40.0, 6.0), 20.0, 0.56),
    "P_north_bay": ((-33.0, 46.0, 1.6), (-44.5, 52.0, 6.0), 22.0, 0.65),
    # the restaurant's outdoor seating on the Kongens gate side, from above and from the street
    "S_terrace": ((-29.0, -1.0, 13.0), (-47.0, 13.5, 0.5), 26.0, 1.5),
    "S_terrace_street": ((-37.0, 4.0, 1.7), (-50.0, 13.5, 1.4), 24.0, 1.5),
    # Straight down, orthographic (lens < 0 = ortho width in metres), for the satellite check
    "T_top": ((0.0, 10.0, 300.0), (0.0, 10.001, 0.0), -160.0, 1.0),
}
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
    cam.data.clip_end = 3000
    cam.location = pos
    cam.rotation_euler = (Vector(at) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = os.path.join(args.out, name + ".jpg")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)
