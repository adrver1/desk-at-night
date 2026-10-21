"""Throwaway preview: the rest corner's counter with the reworked coffee
machine, pump thermos and mugs, the electric kettle and fern, and each of
the three wall clock styles above it. Draft Cycles stills, no bake.

    python blender/preview_rest_props.py [--samples 24] [--out blender/build/rest_props]
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import control_room as cr  # noqa: E402

bpy, Vector = b.bpy, b.Vector

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=24)
p.add_argument("--res", type=int, default=1100)
p.add_argument("--out", default=os.path.join(b.BUILD, "rest_props"))
p.add_argument("--styles", default="station,office,dark")
args = p.parse_args()
os.makedirs(args.out, exist_ok=True)


def camera(name, loc, aim, lens):
    d = bpy.data.cameras.new(name)
    d.lens = lens
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(o)
    return o


for style in args.styles.split(","):
    cr.CLOCK_STYLE = style
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = b.pick_device("auto")
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    m = cr.materials()
    for build in (cr.build_shell, cr.build_meeting_corner, cr.build_rear, cr.build_lounge):
        build(m)
    m["led_panel"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 6.0
    world = bpy.data.worlds.new("Night")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.03, 0.05, 1)
    scene.world = world
    kx, ny = cr.ROOM_X - 0.9, cr.NOOK_Y0
    shots = {
        "corner": camera("Corner", (1.6, cr.ROOM_Y0 - 0.25, 1.65), (kx, ny + 0.2, 1.25), 20),
        "counter": camera("Counter", (kx - 0.1, ny + 1.9, 1.6), (kx, ny + 0.1, 1.35), 24),
    }
    for name, cam in shots.items():
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = args.res, args.res * 9 // 16
        scene.render.filepath = os.path.join(args.out, f"{name}-{style}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scene.render.filepath, flush=True)
