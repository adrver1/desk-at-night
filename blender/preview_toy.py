"""Quick Cycles stills of the desk toy in the room, before any baking.

    python blender/preview_toy.py [--samples 64] [--out blender/build/toy]

Renders a close-up at rest, a close-up mid-swing, and the main camera view
mid-swing, all with real path-traced lighting (moon + lamp).
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)

bpy = b.bpy
Vector = b.Vector

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=64)
p.add_argument("--res", type=int, default=960)
p.add_argument("--out", default=os.path.join(b.BUILD, "toy"))
p.add_argument("--device", default="auto")
p.add_argument("--gif-frames", type=int, default=0, help="also render a looping close-up GIF")
args = p.parse_args()
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = b.pick_device(args.device)
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"

bulb = b.build_room()
b.build_lights()
main_cam = b.build_camera()
balls = b.build_toy()

# Make the bulb glow like it does in the reference render
bsdf = bulb.data.materials[0].node_tree.nodes["Principled BSDF"]
bsdf.inputs["Emission Strength"].default_value = 20
bsdf.inputs["Emission Color"].default_value = (1, 0.8, 0.55, 1)
bulb.visible_shadow = False

close_data = bpy.data.cameras.new("Close")
close_data.lens = 50
close = bpy.data.objects.new("Close", close_data)
bpy.context.collection.objects.link(close)
aim = b.TOY_POS + Vector((0, 0, 0.085))
close.location = aim + Vector((0.20, -0.38, 0.14))
close.rotation_euler = (aim - close.location).to_track_quat("-Z", "Y").to_euler()


def shot(cam, name, w, h):
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(args.out, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)


rest = [0.0] * b.TOY_BALLS
lifted = [-math.radians(35)] + [0.0] * (b.TOY_BALLS - 1)
w = args.res
b.swing(balls, rest)
shot(close, "close-rest", w, w * 2 // 3)
b.swing(balls, lifted)
shot(close, "close-swing", w, w * 2 // 3)
shot(main_cam, "room-swing", w, w * 9 // 16)

if args.gif_frames:
    from PIL import Image
    frames = []
    A = math.radians(35)
    for k in range(args.gif_frames):
        phi = 2 * math.pi * k / args.gif_frames
        angles = [0.0] * b.TOY_BALLS
        angles[0] = -A * max(math.cos(phi), 0.0)
        angles[-1] = A * max(-math.cos(phi), 0.0)
        b.swing(balls, angles)
        shot(close, f"_gif{k:02d}", w // 2, w // 3)
        frames.append(Image.open(os.path.join(args.out, f"_gif{k:02d}.png")).convert("RGB"))
    gif = os.path.join(args.out, "close-swing.gif")
    frames[0].save(gif, save_all=True, append_images=frames[1:], duration=70, loop=0)
    for k in range(args.gif_frames):
        os.remove(os.path.join(args.out, f"_gif{k:02d}.png"))
    print("wrote", gif, flush=True)
