"""Quick Cycles stills of the control-room desk props, before they go into
the room and before any baking.

    python blender/preview_props.py [--samples 64] [--out blender/build/props]

Lays every prop out on a strip of birch desk top and renders one overview
plus a close-up of each.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import props  # noqa: E402

bpy, Vector = b.bpy, b.Vector

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=64)
p.add_argument("--res", type=int, default=960)
p.add_argument("--out", default=os.path.join(b.BUILD, "props"))
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

# A strip of desk top to stand everything on
birch = b.mat_wood("Birch", (0.62, 0.48, 0.32), (0.74, 0.60, 0.42), scale=1.5)
b.box("DeskTop", (1.6, 0.8, 0.04), (0.25, 0.05, -0.02), birch)

m = props.materials()
layout = {  # name: (maker, x, y, yaw)
    "keyboard": (props.make_keyboard, 0.0, -0.05, 0.0),
    "mousepad": (props.make_mousepad, 0.42, -0.04, 0.0),
    "mouse": (props.make_mouse, 0.43, -0.05, math.radians(-8)),
    "mug": (props.make_mug, 0.70, 0.12, math.radians(30)),
    "mic": (props.make_mic, -0.20, 0.20, math.radians(15)),
    "notepad": (props.make_notepad, 0.80, -0.12, math.radians(-12)),
    "pencil": (props.make_pencil, 0.79, -0.13, math.radians(35)),  # lies on the pad
}
objs = {k: props.place(make(m), x, y, 0.0089 if k == "pencil" else 0.0, yaw) for k, (make, x, y, yaw) in layout.items()}

# Light: a soft overhead panel like the ceiling LEDs, plus a dim blue world
area_d = bpy.data.lights.new("Panel", "AREA")
area_d.size = 0.6
area_d.energy = 45
area_d.color = (1.0, 0.95, 0.88)
area = bpy.data.objects.new("Panel", area_d)
area.location = (0.3, 0.5, 1.6)
bpy.context.collection.objects.link(area)
screen_d = bpy.data.lights.new("ScreenGlow", "AREA")
screen_d.size = 1.2
screen_d.energy = 12
screen_d.color = (0.7, 0.8, 1.0)
glow = bpy.data.objects.new("ScreenGlow", screen_d)
glow.location = (0.3, 0.9, 0.4)
glow.rotation_euler = (math.radians(-80), 0, 0)  # faces the operator, like the monitor row
bpy.context.collection.objects.link(glow)
world = bpy.data.worlds.new("Room")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.055, 0.065, 1)


def camera(name, aim, offset, lens):
    d = bpy.data.cameras.new(name)
    d.lens = lens
    d.clip_start = 0.005
    o = bpy.data.objects.new(name, d)
    o.location = Vector(aim) + Vector(offset)
    o.rotation_euler = (Vector(aim) - o.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(o)
    return o


def shot(cam, name, w, h):
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(args.out, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)


w = args.res
shot(camera("Overview", (0.32, 0.06, 0.10), (0.05, -0.95, 0.60), 26), "overview", w, w * 9 // 16)
close = {  # prop: (aim, offset, lens)
    "keyboard": ((0.0, -0.05, 0.01), (0.10, -0.35, 0.22), 40),
    "mouse": ((0.43, -0.05, 0.02), (0.06, -0.18, 0.10), 45),
    "mug": ((0.70, 0.12, 0.05), (0.05, -0.30, 0.12), 45),
    "mic": ((-0.22, 0.12, 0.22), (0.40, -0.50, 0.05), 40),
    "pencil": ((0.80, -0.13, 0.01), (0.04, -0.14, 0.09), 50),
    "notepad": ((0.80, -0.12, 0.01), (0.05, -0.30, 0.25), 40),
}
for k, (aim, off, lens) in close.items():
    shot(camera("Close_" + k, aim, off, lens), "close-" + k, w * 2 // 3, w * 4 // 9)
