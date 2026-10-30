"""Quick Cycles stills of the desk photo frame styles (pictures with
hearts), on a strip of desk with the station's other props, before the
frame goes into the room and before any baking.

    python blender/preview_photo_frame.py [--samples 16] [--out blender/build/photo_frame]

Renders a line-up of every style in props.PHOTO_STYLES, then each style
where it would stand on the desk, seen from the operator's seat, and close.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import boards  # noqa: E402
import build as b  # noqa: E402  (imports bpy)
import props  # noqa: E402

bpy, Vector = b.bpy, b.Vector

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=16)
p.add_argument("--res", type=int, default=960)
p.add_argument("--out", default=os.path.join(b.BUILD, "photo_frame"))
p.add_argument("--device", default="auto")
args = p.parse_args()
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = b.pick_device(args.device)
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"

# Desk top with its operator edge at y = EDGE; station props at their
# STATION_PROPS spots (x right, y ahead of the edge)
EDGE = -0.30
birch = b.mat_wood("Birch", (0.62, 0.48, 0.32), (0.74, 0.60, 0.42), scale=1.5)
b.box("DeskTop", (2.2, 1.0, 0.04), (0.0, EDGE + 0.5, -0.02), birch)
m = props.materials()
for make, x, y, yaw in ((props.make_keyboard, 0.0, 0.17, 0), (props.make_mousepad, 0.42, 0.17, 0),
                        (props.make_mouse, 0.43, 0.16, -8), (props.make_mic, -0.30, 0.36, 12),
                        (props.make_notepad, -0.58, 0.16, 14), (props.make_mug, 0.68, 0.30, 30),
                        (props.make_deskphone, -0.80, 0.30, 17)):
    props.place(make(m), x, EDGE + y, 0.0, math.radians(yaw))
props.place(props.make_pencil(m), -0.57, EDGE + 0.15, 0.0089, math.radians(40))

SPOT = (-0.52, EDGE + 0.50, math.radians(28))  # behind the notepad, turned to the chair
frames = {}
for style, size in props.PHOTO_STYLES.items():
    face = props.board_material("Photo" + style.title(), boards.photo_print(style, size), size)
    frames[style] = props.make_photo_frame(m, "PhotoFrame" + style.title(), style, face)

# Light: soft overhead panel like the ceiling LEDs, a cool glow from the monitors
for name, size, energy, color, loc, rot in (
        ("Panel", 0.6, 45, (1.0, 0.95, 0.88), (0.0, 0.3, 1.6), (0, 0, 0)),
        ("ScreenGlow", 1.4, 10, (0.7, 0.8, 1.0), (0.0, 0.9, 0.4), (math.radians(-80), 0, 0))):
    d = bpy.data.lights.new(name, "AREA")
    d.size, d.energy, d.color = size, energy, color
    o = bpy.data.objects.new(name, d)
    o.location, o.rotation_euler = loc, rot
    bpy.context.collection.objects.link(o)
world = bpy.data.worlds.new("Room")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.055, 0.065, 1)


def camera(name, aim, eye, lens):
    d = bpy.data.cameras.new(name)
    d.lens, d.clip_start = lens, 0.005
    o = bpy.data.objects.new(name, d)
    o.location = Vector(eye)
    o.rotation_euler = (Vector(aim) - o.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(o)
    return o


def shot(cam, name, w, h):
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(args.out, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)


def show(only):
    for style, o in frames.items():
        for x in (o, *o.children):
            x.hide_render = style not in only


w = args.res
# All three side by side, on the clear right-hand part of the desk
for i, (style, o) in enumerate(frames.items()):
    props.place(o, 0.05 + 0.24 * i, EDGE + 0.62, 0.0)
show(frames)
for x in bpy.data.objects:  # keep the line-up clear of the keyboard and mug
    if x.name in ("Mug", "Mouse", "MousePad"):
        x.hide_render = True
shot(camera("Lineup", (0.29, EDGE + 0.62, 0.08), (0.29, EDGE - 0.10, 0.30), 38), "lineup", w, w * 9 // 16)
for x in bpy.data.objects:
    x.hide_render = False if not x.name.startswith("PhotoFrame") else x.hide_render

# Each style at its spot: from the operator's eyes (seated, ~0.45 m above
# the desk, 0.35 m back from its edge) and close
for style, o in frames.items():
    show([style])
    props.place(o, SPOT[0], SPOT[1], 0.0, SPOT[2])
    seat = (0.0, EDGE - 0.35, 0.45)
    shot(camera("Seat", (-0.25, EDGE + 0.45, 0.05), seat, 30), f"seat-{style}", w, w * 9 // 16)
    aim = (SPOT[0], SPOT[1], 0.08)
    shot(camera("Close", aim, (SPOT[0] + 0.14, SPOT[1] - 0.36, 0.17), 50), f"close-{style}", w * 2 // 3, w * 2 // 3)
