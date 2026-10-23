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
    "copper": ("#6e3a2c", 0.55), "plinth": ("#59625d", 0.8), "door": ("#4a2c1e", 0.5),
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
    if arch:
        rot = (math.pi / 2, 0, math.pi / 2) if side else (math.pi / 2, 0, 0)
        loc = (y - 0.05, x, z + h / 2) if side else (x, y - 0.05, z + h / 2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=w / 2 + 0.15, depth=0.12, location=loc, rotation=rot)
        bpy.context.object.data.materials.append(M["frame"])


def curved_eave(x, y, length, rot_deg, r=1.0, z=3.1):
    """The conservatory's rounded glass eave: a quarter barrel along one outer edge."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=length, location=(x, y, z),
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
    eave, depth = 16.8, 20.0
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
    for x in cols:
        box("BrickPanel", (x, -0.05, (5.2 + eave - 0.6) / 2), (bw - 1.4, 0.12, eave - 0.6 - 5.2), "brick")
        box("Cartouche", (x, -0.14, 12.95), (1.3, 0.12, 0.7), "phoenix")   # carved relief between the upper windows
    for i in range(5):   # capitals on the cream pilasters under the cornice
        box("Capital", (mid0 + i * bw, -0.16, eave - 1.2), (1.9, 0.2, 0.7), "phoenix")
    box("BayCanopy", (L - PIER - BAY / 2, -1.25, 5.0), (BAY + 0.4, 0.8, 0.2), "dark")   # curved canopy over the north bay window
    for bx in (PIER + BAY / 2, L - PIER - BAY / 2):   # the side bays come forward
        box("Bay", (bx, -0.45, eave / 2), (BAY, 0.9, eave - 0.4), "phoenix")
        box("Balcony", (bx, -1.3, 13.0), (BAY + 0.4, 1.0, 0.25), "frame")
        box("BalconyRail", (bx, -1.75, 13.5), (BAY + 0.4, 0.08, 0.8), "dark")
    rows = (8.1, 11.3, 14.6)
    for z in rows:
        for x in (PIER / 2, L - PIER / 2):
            window(x, z, -0.12)
        for bx in (PIER + BAY / 2, L - PIER - BAY / 2):
            for dx in (-1.6, 1.6):
                window(bx + dx, z, -0.9)
        for x in cols:
            window(x, z, -0.12, arch=(z == rows[0]))
    for x in (PIER / 2, L - PIER / 2, L - PIER - BAY / 2 - 1.6, L - PIER - BAY / 2 + 1.6):
        window(x, 3.4, -0.9 if abs(x - (L - PIER - BAY / 2)) < 2 else -0.12, 1.4, 2.4)
    # Entrance: landing 0.9 m up in front of the middle bays, stairs in front of the
    # doors, a ramp from the left along the front, rails, two wooden doors with
    # fanlights, tall windows either side, the balcony with balusters across above
    LAND = 0.9
    d0, d1 = cols[1], cols[2]
    box("Landing", ((mid0 + mid1) / 2 + 1.5, -1.6, LAND / 2), (mid1 - mid0 + 3.0, 3.2, LAND), "granite")
    for i in range(5):
        box("Stair", ((d0 + d1) / 2, -3.2 - 0.2 - i * 0.4, (LAND - i * 0.18) / 2), (d1 - d0 + 3.4, 0.4, LAND - i * 0.18), "granite")
    r0, r1 = (d0 + d1) / 2 + (d1 - d0 + 3.4) / 2, (d0 + d1) / 2 + (d1 - d0 + 3.4) / 2 + 7.0   # ramp: rises from the north to the landing
    ramp = frustum("Ramp", ((r0 + r1) / 2, -3.9), 0, r1 - r0, 1.4, r1 - r0, 1.4, 0.02, "granite")
    for v in ramp.data.vertices:
        if v.co.z > 0.01:
            v.co.z = 0.02 + LAND * (r1 - v.co.x) / (r1 - r0)

    def rail(p0, p1, z0, z1):
        n = max(2, int((Vector(p1) - Vector(p0)).length / 1.2) + 1)
        for i in range(n):
            t = i / (n - 1)
            cyl("Post", (p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1]), z0 + t * (z1 - z0)), 0.03, 1.0, "steel", 6)
        a, c = Vector((*p0, z0 + 1.0)), Vector((*p1, z1 + 1.0))
        r = box("Handrail", (a + c) / 2, (0.05, 0.05, (c - a).length), "steel")
        r.rotation_euler = (c - a).to_track_quat("Z", "Y").to_euler()
    rail((r0, -4.6), (r1, -4.6), 0.02, LAND)
    rail((r0, -3.2), (r1, -3.2), 0.02, LAND)
    rail(((d0 + d1) / 2 + (d1 - d0 + 3.4) / 2, -3.2), (mid1 + 3.0, -3.2), LAND, LAND)
    for x in ((d0 + d1) / 2 - (d1 - d0 + 3.4) / 2 + 0.3, (d0 + d1) / 2 + (d1 - d0 + 3.4) / 2 - 0.3):
        rail((x, -3.2), (x, -5.2), LAND, 0.0)
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
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.16, location=(x, -0.9, 5.0))
        bpy.context.object.data.materials.append(M["lamp"])
    for x in (d0 - 2.6, d0 - 0.4, d1 + 0.4, d1 + 2.6):   # four masts, two each side of the stairs
        flag_mast(x, -5.6)
    # Glass conservatory across the left pier and bay
    cw = mid0 + 0.6
    # (2024 photos: a stone plinth, black frames, curved glass eaves, a flat roof
    # dotted with round skylights, a door with steps on the corner)
    box("ConservatoryPlinth", (cw / 2, -3.3, 0.45), (cw, 6.6, 0.9), "granite")
    box("Conservatory", (cw / 2, -3.0, 2.0), (cw, 6.0, 2.2), "glass")
    for i in range(10):
        box("Mullion", (0.15 + i * (cw - 0.3) / 9, -6.05, 2.0), (0.12, 0.1, 2.2), "dark")
    box("ConservatoryRoof", (cw / 2 - 0.5, -2.5, 3.95), (cw - 1.0, 5.0, 0.2), "dark")
    curved_eave((cw - 1.0) / 2, -5.0, cw - 1.0, 0.0)
    box("CornerDoor", (cw + 0.05, -5.4, 1.95), (0.1, 1.2, 2.3), "dark")
    for i in range(3):
        box("CornerStep", (cw + 0.5 + i * 0.35, -5.4, (0.9 - i * 0.3) / 2), (0.35, 1.8, 0.9 - i * 0.3), "granite")
    # ...and it turns the corner, running on along the south side on Kongens gate
    SW = depth   # the whole south wall
    box("ConservatorySidePlinth", (-2.5, (SW - 6.6) / 2, 0.45), (5.0, SW + 6.6, 0.9), "granite")
    box("ConservatorySide", (-2.5, (SW - 6.6) / 2, 2.0), (5.0, SW + 6.6, 2.2), "glass")
    for i in range(12):
        box("Mullion", (-5.05, -6.5 + i * (SW + 6.4) / 11, 2.0), (0.1, 0.12, 2.2), "dark")
    box("ConservatorySideRoof", (-2.0, (SW - 6.6) / 2 + 0.5, 3.95), (4.0, SW + 5.6, 0.2), "dark")
    curved_eave(-4.0, (SW - 6.6) / 2 + 0.5, SW + 5.6, 90.0)
    # the restaurant's flat glass roof is dotted with round white skylights
    for i in range(int(cw / 2.2)):
        for j in (-3.6, -1.4):
            cyl("Skylight", (1.1 + i * 2.2, j, 4.02), 0.6, 0.12, "frame", 12)
    for i in range(int((SW + 4) / 2.2)):
        cyl("Skylight", (-1.8, -4.0 + i * 2.2, 4.02), 0.6, 0.12, "frame", 12)
    # Eight round-topped dormers
    for i in range(8):
        x = 4.0 + i * (L - 8.0) / 7
        box("Dormer", (x, 1.3, eave + 1.7), (1.9, 1.6, 2.2), "frame")
        box("DormerWin", (x, 0.48, eave + 1.6), (1.1, 0.1, 1.5), "glass")
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.95, depth=1.6,
                                            location=(x, 1.3, eave + 2.8), rotation=(math.pi / 2, 0, 0))
        bpy.context.object.data.materials.append(M["frame"])
    # The south side along Kongens gate (build -x face) is red brick, with the same
    # white-framed windows with crosses
    box("SouthBrick", (-0.04, depth / 2, eave / 2), (0.08, depth, eave - 0.6), "brick")
    for y in (0.7, depth - 0.7):   # cream quoins at both corners
        box("Quoin", (-0.09, y, eave / 2), (0.1, 1.4, eave - 0.6), "phoenix")
    for z in (3.4,) + rows:
        for y in (3.5, 8.0, 12.5, 17.0):
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
    cyl("Nest", (cx, cy, 1.57), 0.3, 0.28, "bronze_dark", 10, 0.5)
    for k in (-1, 0, 1):
        a = math.radians(-90 + k * 32)
        box("LampArm", (cx + 0.25 * math.cos(a), cy + 0.25 * math.sin(a), 1.32), (0.5, 0.05, 0.05), "gold", a)
    for k in (-1, 0, 1):   # three globe lamps on short arms at the front, below the bird
        a = math.radians(-90 + k * 32)
        x, y = cx + 0.5 * math.cos(a), cy + 0.5 * math.sin(a)
        cyl("LampStem", (x, y, 1.3), 0.03, 0.2, "dark", 6)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.15, location=(x, y, 1.62))
        bpy.context.object.data.materials.append(M["lamp"])
    for k in range(7):   # the nest of flames it rises from
        t = k / 7 * math.tau
        f = cyl("Flame", (cx + 0.2 * math.cos(t), cy + 0.2 * math.sin(t), 1.75), 0.08, 0.32, "gold", 4, 0.0)
        f.rotation_euler = (0.35 * math.sin(t), -0.35 * math.cos(t), 0)
    tail = box("Tail", (cx, cy + 0.26, 1.95), (0.36, 0.05, 0.55), "bronze_dark")
    tail.rotation_euler = (math.radians(-20), 0, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.26, location=(cx, cy, 2.25))
    bpy.context.object.scale = (1.0, 0.85, 1.55)   # stout upright body
    bpy.context.object.data.materials.append(M["bronze_dark"])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.13, location=(cx + 0.04, cy - 0.08, 2.74))
    bpy.context.object.data.materials.append(M["bronze_dark"])
    cyl("Neck", (cx + 0.02, cy - 0.04, 2.5), 0.12, 0.22, "bronze_dark", 8, 0.1)
    beak = cyl("Beak", (cx + 0.16, cy - 0.12, 2.72), 0.045, 0.16, "bronze_dark", 4, 0.0)
    beak.rotation_euler = (0, math.radians(95), math.radians(-20))   # head turned to its left
    for side in (-1, 1):
        wing("Wing", (cx + side * 0.18, cy + 0.02, 2.4), side, 0.95)
        for u, v in ((0.82, 0.95), (0.86, 0.75), (0.8, 0.55), (0.7, 0.36)):   # round bosses along each wing
            bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.06,
                                                 location=(cx + side * (0.18 + 1.19 * u), cy + 0.02 - 0.27 * u * u - 0.06, 2.4 + 0.855 * v))
            bpy.context.object.data.materials.append(M["steel"])


_before = set(bpy.data.objects)
foniks()
phoenix_fountain(FW / 2, -8.0)   # on the axis of the doors, in front of the stairs
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
FB = FONIKS_FRONT - 20.0   # Føniks's back wall
# (2024 photos: pale travertine, tall windows, dark glass ground floor with a black
# pergola canopy, a copper-clad top floor, a copper strip where it meets Føniks)
block("FoniksAnnex", FB - 22, FB, FONIKS_SOUTH - 1, FONIKS_SOUTH + 20, 17, "travertine", 5, ("-y",), None)
box("FoniksAnnexTop", (FB - 11, FONIKS_SOUTH + 9, 18.6), (21.4, 19, 3.2), "copper")
box("FoniksAnnexBase", (FB - 11, FONIKS_SOUTH - 1.05, 1.9), (21.6, 0.12, 3.6), "glass")
box("FoniksAnnexJoint", (FB - 0.6, FONIKS_SOUTH - 1.1, 9), (1.4, 0.3, 18), "copper")
box("FoniksAnnexAwning", (FB - 11, FONIKS_SOUTH - 3.0, 3.0), (21, 4.0, 0.15), "dark")
for i in range(6):
    box("PergolaPost", (FB - 21 + i * 4, FONIKS_SOUTH - 4.9, 1.5), (0.15, 0.15, 3.0), "dark")
block("FoniksBack", FB - 22, FB, FONIKS_SOUTH + 20, FONIKS_SOUTH + FW, 15, "brick_dark", 4, (), None)
box("FoniksAtrium", (FB - 11, FONIKS_SOUTH + FW / 2 + 10, 15.4), (21, 8, 0.4), "glass_block")
# West of the annex: a block clad in copper-brown fins on a tight window grid
block("BrickW", -108, FB - 22, 13, 32, 17, "copper", 6, ("-y",), None)
box("AnnexPlinth", (FB - 11, FONIKS_SOUTH - 1.0, 0.45), (22, 0.2, 0.9), "dark")
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
me, _ = load_char("bearded_operator", FL(14.6, -7.0), math.radians(200) + TURN)
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
if args.glb:   # Føniks on its own for the spin-around viewer
    bpy.ops.object.select_all(action="DESELECT")
    keep = FONIKS_OBJS | {o for o in bpy.data.objects if o.name.startswith(("Foniks", "AnnexPlinth", "PergolaPost"))}
    for o in keep:
        if o.type == "MESH":
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=args.glb, use_selection=True, export_apply=True, export_yup=True)
    print("wrote", args.glb)
    sys.exit(0)

SHOTS = {
    "B_wide": (B_POS, aim(B_POS, 303.3, 16.3), 24.0, 1.5),
    "B1_overcast": (B1_POS, aim(B1_POS, 318.4, 18.0), 24.0, 5 / 3),
    # The glide from B down to A, part way: over the square, Føniks filling the frame
    "G_glide": ((22.0, -2.0, 16.0), FL(17.0, 0.0, 6.0), 26.0, 16 / 9),
    # A: street level in front of Føniks, the character by the fountain, doors behind
    "A_street": (A_POS, A_AT, 28.0, 16 / 9),
    "E_entrance": (FL(18.0, -19.0, 2.0), FL(18.0, 0.0, 4.2), 30.0, 16 / 9),
    "F_phoenix": (FL(16.6, -14.6, 2.3), FL(18.0, -10.0, 2.4), 40.0, 16 / 9),
    "D_statue_close": ((-6.5, -6, 16.2), (0, 0, 15.8), 50.0, 16 / 9),
    # C: over the character's shoulder at the door, looking back at the statue
    "C_statue": (FL(14.0, -4.6, 1.75), (2, 0, 10), 26.0, 16 / 9),
    # Like Adriaen's Google 3D view: over Kongens gate, Føniks's brick south wall and its annex
    "K_kongens": ((-12.0, -22.0, 38.0), (-46.0, 24.0, 6.0), 30.0, 16 / 9),
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
