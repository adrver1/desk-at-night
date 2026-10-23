"""Throwaway preview: three ways to frame the "one year ago" Trondheim scene.

    .venv/bin/python blender/preview_trondheim.py [--samples 16] [--out DIR]

Question: which framing of Torvet (the Olav Tryggvason column, Føniks on the
corner, the bearded character in front) tells "one year ago" best?
Føniks is a placeholder block until we have reference photos.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)

bpy = b.bpy
Vector = b.Vector
ROOT = b.ROOT

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=16)
p.add_argument("--out", default=os.path.join(b.BUILD, "trondheim"))
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
    "torg": ("#cdbf9f", 0.8), "red": ("#d8262c", 0.5), "verdigris": ("#4f9a8f", 0.5), "hill": ("#3d5235", 1.0), "wood": ("#6b3f26", 0.6), "steel": ("#7d8488", 0.4), "flag": ("#f4f4f1", 0.8),
    "logo_magenta": ("#c42a72", 0.6), "logo_orange": ("#ec8a3c", 0.6), "logo_green": ("#2e9a52", 0.6), "tile": ("#2b3a3c", 0.5), "water": ("#2f7f86", 0.1), "frame": ("#efede6", 0.6), "slate": ("#3a3d42", 0.7),
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


# Ground: Torvet as it is today (Adriaen's drone photos): one big grey paved square
# running from Trondheim Torg in the west to the east side, the dark compass star
# round the column, Føniks across the north side, the fjord behind
M["lamp"] = b.mat_flat("TrdLamp", (1, 1, 1), 0.3)
box("Ground", (0, 0, -0.05), (400, 400, 0.1), "road")
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 4, 0.03))
sq = bpy.context.object
sq.scale = (116, 100, 1)
bpy.ops.object.transform_apply(scale=True)
sq.data.materials.append(paving("TrdPaving", 100))
for k in range(16):   # the compass star, dark stone, long and short points
    a = k / 16 * math.tau + math.pi / 16
    r = 15 if k % 2 == 0 else 9
    w = 0.2 if k % 2 == 0 else 0.3
    tri("Rose", [(r * math.cos(a), r * math.sin(a)), (6.5 * math.cos(a + w), 6.5 * math.sin(a + w)),
                 (6.5 * math.cos(a - w), 6.5 * math.sin(a - w))], 0.05, "dark")
cyl("RoseRing", (0, 0, 0), 7.2, 0.07, "dark", 32)
cyl("Octagon", (0, 0, 0), 6.2, 0.18, "granite", 8)
for i, w in enumerate((4.6, 3.7, 2.8)):
    frustum("Step", (0, 0), 0.18 + i * 0.35, w, w, w, w, 0.35, "granite")   # (octagon below)
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
PAL = {"logo_magenta": "#c42a72", "logo_orange": "#ec8a3c", "logo_green": "#2e9a52"}


def flag_mast(x, y, h=9.0):
    """A white mast with a hanging banner flag: white, the logo on both faces."""
    cyl("Mast", (x, y, 0), 0.06, h, "frame", 6)
    cyl("Truck", (x, y, h), 0.1, 0.12, "frame", 8)
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


def foniks():
    """Føniks (the 1916 Hotel Phoenix): four storeys of cream render with red brick
    pilasters, two projecting side bays with balconies, a steep slate mansard with
    eight dormers, the entrance on steps and a glass conservatory on the left."""
    x0, x1, yf, depth = 22.0, 70.0, 38.0, 22.0
    cx = (x0 + x1) / 2
    eave = 15.3
    box("Foniks", (cx, yf + depth / 2, eave / 2), (x1 - x0, depth, eave), "phoenix")
    box("FoniksBase", (cx, yf - 0.15, 0.6), (x1 - x0 + 0.3, 0.4, 1.2), "granite")
    frustum("FoniksMansard", (cx, yf + depth / 2), eave, x1 - x0 + 0.6, depth + 0.6, x1 - x0 - 4, depth - 4, 5.0, "slate")
    frustum("FoniksRoof", (cx, yf + depth / 2), eave + 5.0, x1 - x0 - 4, depth - 4, x1 - x0 - 16, 4, 2.2, "slate")
    box("FoniksCornice", (cx, yf + depth / 2, eave - 0.2), (x1 - x0 + 0.8, depth + 0.8, 0.4), "frame")
    for x in (x0 + 9, x1 - 9):
        box("Chimney", (x, yf + depth / 2, eave + 7.6), (1.6, 1.2, 2.0), "dark")
    # Side bays come forward 1.2 m, with a balcony on the top floor
    for bx in (x0 + 6.5, x1 - 6.5):
        box("Bay", (bx, yf - 0.6, eave / 2 - 1.1), (9, 1.2, eave - 2.2), "phoenix")
        box("Balcony", (bx, yf - 1.5, 11.9), (9.4, 1.0, 0.25), "frame")
        box("Rail", (bx, yf - 1.95, 12.45), (9.4, 0.08, 0.9), "dark")
    # Red brick bands at the corners and between the middle windows
    for x in (x0 + 0.9, x1 - 0.9, 33.0, 38.8, 44.0, 49.2, 54.4, 59.0):
        box("Brick", (x, yf - 0.08, 9.8), (1.4, 0.2, 10.6), "brick")
    def window(x, z, y, w=1.6, h=2.0, arch=False):
        box("WinFrame", (x, y - 0.05, z), (w + 0.3, 0.12, h + 0.3), "frame")
        box("Win", (x, y - 0.1, z), (w, 0.12, h), "glass")
        if arch:
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=w / 2 + 0.15, depth=0.12,
                                                location=(x, y - 0.05, z + h / 2), rotation=(math.pi / 2, 0, 0))
            bpy.context.object.data.materials.append(M["frame"])
    mids = (36.0, 41.4, 46.6, 51.8, 57.0)
    for z in (6.6, 10.2, 13.6):
        for x in mids:
            window(x, z, yf, arch=(z == 6.6))
        for bx in (x0 + 6.5, x1 - 6.5):
            for dx in (-2.0, 2.0):
                window(bx + dx, z, yf - 1.2, arch=(z == 6.6 and dx < 0))
    for x in (36.0, 41.4, 51.8, 57.0, x1 - 8.5, x1 - 4.5):
        window(x, 2.4, yf, 1.6, 2.2)
    # Entrance (Adriaen's photo): a raised landing with stairs in the middle and a
    # ramp along the front on the left, railings, two wooden doors with fanlights,
    # the balcony right across above, and four masts with Aker BP flags
    L = 0.9   # landing height
    box("Landing", (46.6, yf - 1.5, L / 2), (16.2, 3.0, L), "granite")
    for i in range(5):
        box("Stair", (46.6, yf - 3.0 - 0.2 - i * 0.4, (L - i * 0.18) / 2), (7.0, 0.4, L - i * 0.18), "granite")
    ramp = frustum("Ramp", (39.6, yf - 3.7), 0, 6.8, 1.4, 6.8, 1.4, 0.02, "granite")
    for v in ramp.data.vertices:   # slope it: low at the left end, landing height at the stairs
        if v.co.z > 0.01:
            v.co.z = 0.02 + L * (v.co.x - 36.2) / 6.8
    def rail(p0, p1, z0, z1):
        n = max(2, int((Vector(p1) - Vector(p0)).length / 1.2) + 1)
        for i in range(n):
            t = i / (n - 1)
            x, y = p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])
            cyl("Post", (x, y, z0 + t * (z1 - z0)), 0.03, 1.0, "steel", 6)
        a, c = Vector((*p0, z0 + 1.0)), Vector((*p1, z1 + 1.0))
        r = box("Handrail", (a + c) / 2, (0.05, 0.05, (c - a).length), "steel")
        r.rotation_euler = (c - a).to_track_quat("Z", "Y").to_euler()
    rail((36.2, yf - 4.4), (43.0, yf - 4.4), 0.02, L)            # ramp, outer side
    rail((50.1, yf - 3.0), (54.7, yf - 3.0), L, L)                # landing edge right of the stairs
    rail((54.7, yf - 3.0), (54.7, yf), L, L)
    rail((38.5, yf - 3.0), (38.5, yf), L, L)
    for x in (43.3, 49.9):                                        # stair handrails
        rail((x, yf - 3.0), (x, yf - 5.0), L, 0.0)
    for x in (44.0, 49.2):
        box("DoorFrame", (x, yf - 0.05, L + 1.75), (2.3, 0.14, 3.5), "frame")
        box("Door", (x, yf - 0.12, L + 1.35), (1.9, 0.12, 2.7), "wood")
        box("Fanlight", (x, yf - 0.12, L + 3.1), (1.9, 0.12, 0.6), "glass")
    for x in (40.6, 52.6):   # tall windows either side of the doors
        box("EntryWinF", (x, yf - 0.05, L + 1.6), (1.9, 0.12, 2.6), "frame")
        box("EntryWin", (x, yf - 0.1, L + 1.6), (1.6, 0.12, 2.3), "glass")
    box("EntryBalcony", (46.6, yf - 0.8, 4.6), (17, 1.6, 0.3), "frame")
    box("EntryRail", (46.6, yf - 1.55, 5.75), (17, 0.1, 0.08), "steel")
    for i in range(35):   # balusters
        box("Baluster", (38.2 + i * 0.494, yf - 1.55, 5.25), (0.04, 0.04, 0.9), "steel")
    for x in (41.5, 46.6, 51.7):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.16, location=(x, yf - 0.9, 4.3))
        bpy.context.object.data.materials.append(M["lamp"])
    for x in (39.0, 42.6, 50.6, 54.2):
        flag_mast(x, yf - 4.9)
    # Glass conservatory in front of the left bay
    box("Conservatory", (x0 + 7.0, yf - 4.0, 1.6), (13.6, 6.6, 3.2), "glass")
    for i in range(8):   # white mullions on the glass front
        box("Mullion", (x0 + 0.3 + i * 13.4 / 7, yf - 7.35, 1.6), (0.15, 0.1, 3.2), "frame")
    box("ConservatoryRoof", (x0 + 7.0, yf - 4.0, 3.7), (14.4, 7.4, 0.25), "dark")
    # Eight dormers on the mansard, white with round tops
    for i in range(8):
        x = x0 + 6.5 + i * (x1 - x0 - 13) / 7
        box("Dormer", (x, yf + 1.4, eave + 2.1), (2.0, 1.6, 2.4), "frame")
        box("DormerWin", (x, yf + 0.58, eave + 2.0), (1.2, 0.1, 1.6), "glass")
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=1.0, depth=1.6,
                                            location=(x, yf + 1.4, eave + 3.3), rotation=(math.pi / 2, 0, 0))
        bpy.context.object.data.materials.append(M["frame"])
    # Windows down the side street
    for z in (2.4, 6.6, 10.2, 13.6):
        for y in (yf + 4, yf + 9, yf + 14, yf + 19):
            box("SideWinF", (x0 - 0.05, y, z), (0.12, 1.9, 2.3), "frame")
            box("SideWin", (x0 - 0.1, y, z), (0.12, 1.6, 2.0), "glass")


_before = set(bpy.data.objects)
foniks()


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
    me.materials.append(M["bronze"])
    o.modifiers.new("Thick", "SOLIDIFY").thickness = 0.06


def phoenix_fountain(cx, cy):
    """The phoenix fountain in front of the Føniks entrance (Adriaen's photo): a low
    round basin with a thick stone rim, a dark tiled column, three globe lamps at the
    front and the bronze phoenix rising from its nest with both wings raised."""
    cyl("Water", (cx, cy, 0), 3.0, 0.32, "water", 32)
    bpy.ops.mesh.primitive_torus_add(major_radius=3.0, minor_radius=0.3, major_segments=40, minor_segments=8,
                                     location=(cx, cy, 0.3))
    bpy.context.object.scale.z = 1.3
    bpy.context.object.data.materials.append(M["granite"])
    cyl("Column", (cx, cy, 0), 0.3, 1.45, "tile", 12)
    cyl("Collar", (cx, cy, 1.45), 0.36, 0.12, "dark", 12)
    cyl("Nest", (cx, cy, 1.57), 0.3, 0.28, "bronze", 10, 0.5)
    for k in (-1, 0, 1):
        a = math.radians(-90 + k * 32)
        box("LampArm", (cx + 0.25 * math.cos(a), cy + 0.25 * math.sin(a), 1.32), (0.5, 0.05, 0.05), "dark", a)
    for k in (-1, 0, 1):   # three globe lamps on short arms at the front, below the bird
        a = math.radians(-90 + k * 32)
        x, y = cx + 0.5 * math.cos(a), cy + 0.5 * math.sin(a)
        cyl("LampStem", (x, y, 1.3), 0.03, 0.2, "dark", 6)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.15, location=(x, y, 1.62))
        bpy.context.object.data.materials.append(M["lamp"])
    for k in range(7):   # the nest of flames it rises from
        t = k / 7 * math.tau
        f = cyl("Flame", (cx + 0.2 * math.cos(t), cy + 0.2 * math.sin(t), 1.75), 0.08, 0.32, "bronze", 4, 0.0)
        f.rotation_euler = (0.35 * math.sin(t), -0.35 * math.cos(t), 0)
    tail = box("Tail", (cx, cy + 0.26, 1.95), (0.36, 0.05, 0.55), "bronze")
    tail.rotation_euler = (math.radians(-20), 0, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.26, location=(cx, cy, 2.25))
    bpy.context.object.scale = (1.0, 0.85, 1.55)   # stout upright body
    bpy.context.object.data.materials.append(M["bronze"])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.13, location=(cx + 0.04, cy - 0.08, 2.74))
    bpy.context.object.data.materials.append(M["bronze"])
    cyl("Neck", (cx + 0.02, cy - 0.04, 2.5), 0.12, 0.22, "bronze", 8, 0.1)
    beak = cyl("Beak", (cx + 0.16, cy - 0.12, 2.72), 0.045, 0.16, "bronze", 4, 0.0)
    beak.rotation_euler = (0, math.radians(95), math.radians(-20))   # head turned to its left
    for side in (-1, 1):
        wing("Wing", (cx + side * 0.18, cy + 0.02, 2.4), side, 0.95)


phoenix_fountain(46.6, 28.0)
DX = -26.0   # Føniks sits on the north side with the column in front of its left half
for o in set(bpy.data.objects) - _before:
    if o.parent is None:
        o.location.x += DX


def block(name, x0, x1, y0, y1, h, mat, floors, faces, roof=None, roof_h=4.0):
    """A neighbour, kept simple: the right colour, height, windows and roof shape."""
    facade(name, x0, x1, y0, y1, h, mat, floors, faces)
    if roof:
        along_x = (x1 - x0) >= (y1 - y0)
        w, d = x1 - x0 + 0.6, y1 - y0 + 0.6
        frustum(name + "Pitch", ((x0 + x1) / 2, (y0 + y1) / 2), h, w, d,
                w if along_x else 0.6, 0.6 if along_x else d, roof_h, roof)


# North side, either side of Føniks: the dark brick block on its left, the pink
# wooden house with its steep grey roof on its right, then a white block
block("BrickNW", -30, -5, 38, 62, 17, "brick_dark", 5, ("-y",), "slate", 5)
block("PinkHouse", 45, 60, 38, 52, 8, "pink", 2, ("-y", "+x"), "slate", 5)
block("WhiteN", 62, 86, 40, 62, 13, "c3", 4, ("-y",), "slate", 4)
block("GreyNW", -58, -32, 40, 62, 14, "c4", 4, ("-y",), None)
# West side: Trondheim Torg, long and beige with tall window strips, shop windows
# and the red sign, and the green pavilion drum on its post in front
box("Torg", (-72, 2, 10), (24, 84, 20), "torg")
box("TorgRoof", (-72, 2, 20.6), (24.6, 84.6, 1.2), "dark")
box("TorgShops", (-59.9, 2, 2.2), (0.3, 80, 4.0), "glass")
for i in range(26):
    box("TorgStrip", (-59.9, -36 + i * 3.0, 12.0), (0.25, 1.1, 11.5), "glass")
box("TorgSign", (-59.6, 14, 17.6), (0.3, 14, 1.6), "red")
cyl("PavilionPost", (-42, 6, 0), 1.0, 4.2, "dark", 12)
cyl("Pavilion", (-42, 6, 4.2), 7.0, 3.0, "verdigris", 32)
cyl("PavilionLid", (-42, 6, 7.2), 7.0, 0.15, "dark", 32)
# East side: the grey 1950s office block with café awnings along its front
block("OfficeE", 60, 84, -34, 30, 18, "c4", 5, ("-x",), None)
for i in range(7):
    box("Awning", (57.5, -26 + i * 8, 2.8), (4.0, 6.0, 0.2), "frame")
# South side: low old town, dark roofs
block("SouthW", -50, -10, -64, -46, 11, "c5", 3, ("+y",), "slate", 4)
block("SouthE", -6, 40, -66, -46, 12, "c1", 3, ("+y",), "slate", 4)
# Planters with young trees in rows along the edges of the square
for x, y in [(-50, -30), (-50, -18), (-50, -6), (-50, 18), (-50, 30), (-28, 33), (-12, 33),
             (34, 33), (50, -30), (50, -14), (50, 2), (50, 18), (-10, -42), (14, -42)]:
    box("Planter", (x, y, 0.3), (2.6, 5.0, 0.6), "granite")
    cyl("Trunk", (x, y, 0.6), 0.12, 1.8, "trunk", 6)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.3, location=(x, y, 3.2))
    bpy.context.object.data.materials.append(M["tree"])
# The fjord and the hills behind the town to the north
box("Fjord", (0, 230, -0.2), (900, 300, 0.1), "water")
for x, y, sx, sz in [(-170, 170, 120, 60), (240, 320, 260, 40), (-40, 360, 300, 30)]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=(x, y, -5))
    bpy.context.object.scale = (sx, 40, sz)
    bpy.context.object.data.materials.append(M["hill"])


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
# The bearded character (Adriaen, one year ago) in front of Føniks
me, _ = load_char("bearded_operator", (41.0 + DX, 31.8, 0), math.radians(200))

# Light: low autumn sun, overcast sky
world = bpy.data.worlds.new("Sky")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (*srgb("#9fb3c8"), 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
scene.world = world
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 3
sun.data.angle = math.radians(6)
sun.rotation_euler = (math.radians(70), 0, math.radians(35))
scene.collection.objects.link(sun)

scene.render.engine = "CYCLES"
scene.cycles.device = b.pick_device("auto")
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"
scene.render.resolution_x, scene.render.resolution_y = args.res, args.res * 9 // 16
scene.render.image_settings.file_format = "JPEG"

SHOTS = {
    # A: street level across the square, character in front of the door, statue on the left
    "A_street": ((34 + DX, 14, 1.6), (46 + DX, 38, 8.0), 28),
    # Entrance close-up: the phoenix fountain, the balcony and the doors
    "E_entrance": ((44.0 + DX, 19.5, 2.0), (46.6 + DX, 38, 4.0), 30),
    "F_phoenix": ((44.6 + DX, 24.4, 2.3), (46.6 + DX, 28, 2.4), 40),
    # B: establishing drone view from the south, like the photo: column centred, Føniks
    # behind on the north side, Trondheim Torg on the left, the fjord beyond
    "B_wide": ((4, -92, 46), (4, 24, 4), 32),
    # Close-up of the statue for the pose check
    "D_statue_close": ((-6.5, -6, 16.2), (0, 0, 15.8), 50),
    # C: over the character's shoulder at the office door, looking back up at the statue
    "C_statue": ((44.6 + DX, 35.6, 1.75), (2, 0, 10), 26),
}
for name, (pos, at, lens) in SHOTS.items():
    for o in scene.objects:   # the over-the-shoulder shot stands where the conservatory would block it
        if o.name.startswith(("Conservatory", "Mullion")):
            o.hide_render = name.startswith("C_")
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = lens
    cam.data.clip_end = 2000
    cam.location = pos
    cam.rotation_euler = (Vector(at) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = os.path.join(args.out, name + ".jpg")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)
