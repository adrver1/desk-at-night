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
    "brick": ("#8e3b2e", 0.85), "water": ("#2f7f86", 0.1), "frame": ("#efede6", 0.6), "slate": ("#3a3d42", 0.7),
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


# Ground: Torvet, dark cobbles with the light granite compass rose (1960s aerial photo)
M["lamp"] = b.mat_flat("TrdLamp", (1, 1, 1), 0.3)
box("Ground", (0, 0, -0.05), (260, 260, 0.1), "road")
box("Torvet", (0, 0, 0.02), (76, 76, 0.04), "cobble")
for k in range(16):
    a = k / 16 * math.tau
    r = 30 if k % 2 == 0 else 18
    w = 0.16 if k % 2 == 0 else 0.22
    tri("Rose", [(r * math.cos(a), r * math.sin(a)), (8 * math.cos(a + w), 8 * math.sin(a + w)),
                 (8 * math.cos(a - w), 8 * math.sin(a - w))], 0.05, "granite")
bpy.ops.mesh.primitive_torus_add(major_radius=30, minor_radius=0.3, major_segments=64, location=(0, 0, 0.04))
bpy.context.object.scale.z = 0.15
bpy.context.object.data.materials.append(M["granite"])
cyl("Island", (0, 0, 0), 7.5, 0.18, "granite", 32)   # the round island the column stands on
cyl("Curb", (0, 0, 0), 7.7, 0.12, "dark", 32)
for x, y in [(5, 4), (-5, 4), (5, -4), (-5, -4), (0, 6.2), (0, -6.2)]:   # flower tubs
    cyl("Tub", (x, y, 0.18), 0.45, 0.5, "dark", 8)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.55, location=(x, y, 0.95))
    bpy.context.object.data.materials.append(M["tree"])

# The column, square granite as on Rasmussen's 1921 drawing: three square steps,
# shaft, zigzag band, flared capital (170 cm) under a 260 cm slab, statue plinth
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
    for x in (44.0, 49.2):   # the two entrance doors, steps and the name board
        box("Door", (x, yf - 0.1, 1.9), (2.0, 0.15, 3.2), "dark")
    # Balcony right across the entrance (Adriaen's photo), lamps underneath
    box("EntryBalcony", (46.6, yf - 0.8, 4.4), (17, 1.6, 0.3), "frame")
    box("EntryRail", (46.6, yf - 1.55, 5.5), (17, 0.1, 0.08), "dark")
    for i in range(35):   # balusters
        box("Baluster", (38.2 + i * 0.494, yf - 1.55, 5.03), (0.04, 0.04, 0.9), "dark")
    for x in (40.5, 44.6, 48.6, 52.7):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.16, location=(x, yf - 0.9, 4.1))
        bpy.context.object.data.materials.append(M["lamp"])
    for x in (38.6, 42.0, 51.2, 54.6):   # flagpoles along the steps
        cyl("Flagpole", (x, yf - 2.6, 0), 0.06, 9.0, "frame", 6)
    for i in range(4):
        box("Step", (46.6, yf - 1.0 - i * 0.4, 0.15 + (3 - i) * 0.15), (9, 0.4 + i * 0.0, 0.3 + (3 - i) * 0.3), "granite")
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


foniks()


def phoenix_fountain(cx, cy):
    """The phoenix fountain in front of the Føniks entrance: a round tiled basin, a
    dark pedestal and a bronze phoenix with raised wings over three globe lamps."""
    cyl("BasinRim", (cx, cy, 0), 3.4, 0.6, "granite", 24)
    cyl("Water", (cx, cy, 0), 3.0, 0.62, "water", 24)
    cyl("Pedestal", (cx, cy, 0), 0.5, 1.9, "dark", 10, 0.42)
    cyl("Nest", (cx, cy, 1.9), 0.55, 0.35, "bronze", 10, 0.7)
    for k in (-1, 0, 1):   # three globe lamps on arms below the bird
        a = math.radians(-90 + k * 35)
        x, y = cx + 0.95 * math.cos(a), cy + 0.95 * math.sin(a)
        box("LampArm", ((cx + x) / 2, (cy + y) / 2, 2.15), (0.06, 0.95, 0.06), "dark", a + math.pi / 2)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.22, location=(x, y, 2.4))
        bpy.context.object.data.materials.append(M["lamp"])
    cyl("Body", (cx, cy, 2.2), 0.24, 1.0, "bronze", 8, 0.14)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.14, location=(cx, cy - 0.06, 3.3))
    bpy.context.object.data.materials.append(M["bronze"])
    cyl("Beak", (cx, cy - 0.2, 3.26), 0.05, 0.14, "bronze", 4, 0.0)
    for side in (-1, 1):   # wings raised high, tips curling out
        w = box("Wing", (cx + side * 0.42, cy + 0.08, 3.35), (0.55, 0.06, 1.3), "bronze")
        w.rotation_euler = (0, side * math.radians(-14), 0)
        t = box("WingTip", (cx + side * 0.62, cy + 0.08, 4.05), (0.35, 0.06, 0.5), "bronze")
        t.rotation_euler = (0, side * math.radians(-40), 0)


phoenix_fountain(46.6, 31.0)
# Neighbours: low old wooden-town blocks with pitched roofs, as round Torvet in the old photos
facade("NW", -92, -38, 38, 80, 12, "c3", 3, ("-y", "+x"))
facade("SW", -92, -38, -80, -38, 12, "c1", 3, ("+y", "+x"))
facade("SE", 38, 92, -80, -38, 11, "c4", 3, ("+y", "-x"))
facade("NE2", 74, 110, 38, 70, 10, "c2", 3, ("-y",))
for x, y in [(-30, 30), (-30, -30), (30, -30), (-14, 30), (14, -30), (12, 34), (78, 34)]:
    cyl("Trunk", (x, y, 0), 0.25, 2.5, "trunk", 6)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=2.6, location=(x, y, 4.6))
    bpy.context.object.data.materials.append(M["tree"])


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
me, _ = load_char("bearded_operator", (41.8, 33.2, 0), math.radians(200))

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
    "A_street": ((34, 14, 1.6), (46, 38, 8.0), 28),
    # Entrance close-up: the phoenix fountain, the balcony and the doors
    "E_entrance": ((45.0, 21.5, 2.0), (46.6, 38, 4.2), 30),
    # B: establishing drone view from the south-west, column centred, Føniks on the far corner
    "B_wide": ((-40, -66, 30), (20, 24, 6), 30),
    # Close-up of the statue for the pose check
    "D_statue_close": ((-6.5, -6, 16.2), (0, 0, 15.8), 50),
    # C: over the character's shoulder at the office door, looking back up at the statue
    "C_statue": ((44.6, 35.6, 1.75), (2, 0, 10), 26),
}
for name, (pos, at, lens) in SHOTS.items():
    for o in scene.objects:   # the over-the-shoulder shot stands where the conservatory would block it
        if o.name.startswith(("Conservatory", "Mullion")):
            o.hide_render = name.startswith("C_")
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = lens
    cam.location = pos
    cam.rotation_euler = (Vector(at) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = os.path.join(args.out, name + ".jpg")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)
