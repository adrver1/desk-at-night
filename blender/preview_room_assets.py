"""Close-up Cycles stills of the control room's newer assets, in the room,
before anything is baked: desk phone, rear TV with its PTZ camera, the
whiteboards, the meeting table and the hanging ceiling microphones.

    python blender/preview_room_assets.py [--samples 64] [--out blender/build/room_assets]
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
p.add_argument("--samples", type=int, default=64)
p.add_argument("--res", type=int, default=1280)
p.add_argument("--out", default=os.path.join(b.BUILD, "room_assets"))
p.add_argument("--device", default="auto")
p.add_argument("--only", default="", help="comma-separated shot names")
p.add_argument("--exposure", type=float, default=0.0, help="stops brighter, for judging shapes")
args = p.parse_args()
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = b.pick_device(args.device)
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = args.exposure

m = cr.materials()
cr.build_desk(m)
cr.build_monitors(m)
cr.build_video_wall(m)
cr.build_desk_props(m)
cr.build_chairs(m)
cr.build_shell(m)
cr.build_meeting_corner(m)
cr.build_boards(m)
cr.build_rear(m)
cr.build_lounge(m)
cr.build_ceiling_mics(m)
cr.build_outside(m)
world = bpy.data.worlds.new("Night")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.02, 0.045, 1)
scene.world = world
m["led_panel"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 4.0  # lights on


def camera(name, loc, aim, lens):
    d = bpy.data.cameras.new(name)
    d.lens = lens
    d.clip_start = 0.01
    d.clip_end = 300
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(o)
    return o


a0 = cr.DESKS[0]
edge = cr.polar(cr.r_front(a0), a0, 0)
right, ahead = Vector((math.cos(a0), -math.sin(a0), 0)), Vector((math.sin(a0), math.cos(a0), 0))
phone = edge - right * 0.80 + ahead * 0.30 + Vector((0, 0, cr.DESK_Z + 0.05))
a_tv = cr.TV_A
tv = cr.polar(cr.WALL_R, a_tv, cr.TV_TOP - cr.TV_H / 2)

mic = cr.polar(2.35, a0 + 0.22, cr.ROOM_Z - 0.58)
shots = {  # name: (location, aim, lens, width, height)
    "mic-close": (mic + Vector((0, 0, -0.10)) - ahead * 0.35 + right * 0.1, mic + Vector((0, 0, 0.12)), 45, 2, 3),
    "mics-from-floor": (Vector((0.4, -1.6, 1.5)), cr.polar(2.35, 0, 2.5), 22, 16, 9),
    "phone": (phone - ahead * 0.38 + right * 0.12 + Vector((0, 0, 0.22)), phone, 45, 3, 2),
    "tv-camera": (cr.polar(1.6, a_tv + 0.15, 1.55), tv + Vector((0, 0, 0.15)), 30, 3, 2),
    "tv-from-seat": (cr.polar(cr.r_front(a0) - 0.30, a0, 1.22), tv, 18, 16, 9),
    "whiteboards": (Vector((1.6, 0.6, 1.55)), Vector((cr.ROOM_X, 0.75, 1.40)), 20, 16, 9),
    "pnid-close": (Vector((4.1, 1.2, 1.55)), Vector((cr.ROOM_X, 1.35, 1.45)), 28, 3, 2),
    "shift-close": (Vector((4.4, -0.45, 1.5)), Vector((cr.ROOM_X, -0.45, 1.5)), 35, 4, 3),
    "meeting-table": (Vector((0.6, -1.2, 1.25)), Vector((2.6, -2.9, 0.55)), 24, 3, 2),
    "link-camera": (Vector((2.0, -1.6, 1.9)), Vector((2.6, -3.3, 2.3)), 35, 3, 2),
    "overview": (Vector((-3.0, -3.2, 2.2)), Vector((2.0, 1.5, 1.0)), 16, 16, 9),
    "rear-from-desk": (cr.polar(cr.r_front(a0) + 0.1, a0 + 0.3, 1.5), Vector((1.2, -3.6, 1.0)), 16, 16, 9),
    "esd-panel": (Vector((-2.4, -1.4, 1.45)), Vector((-3.1, cr.ROOM_Y0, 1.15)), 24, 3, 2),
    "esd-close": (Vector((-3.0, -2.0, 1.45)), Vector((-3.0, cr.ROOM_Y0, 1.40)), 30, 4, 3),
    "nook-doorway": (Vector((4.0, -1.2, 1.6)), Vector((4.0, -4.8, 0.9)), 22, 16, 9),
    "nook-inside": (Vector((5.0, -3.8, 1.55)), Vector((1.0, -5.3, 0.6)), 18, 16, 9),
    "fruit-bowl": (Vector((cr.NOOK_X0 + 1.10 + 0.30, cr.NOOK_Y0 + 1.30 + 0.38, 0.78)), Vector((cr.NOOK_X0 + 1.10, cr.NOOK_Y0 + 1.30, 0.47)), 50, 4, 3),
    "fruit-bowl-side": (Vector((cr.NOOK_X0 + 1.10 - 0.42, cr.NOOK_Y0 + 1.30 + 0.10, 0.62)), Vector((cr.NOOK_X0 + 1.10, cr.NOOK_Y0 + 1.30, 0.48)), 50, 4, 3),
    "coffee-table": (Vector((cr.NOOK_X0 + 2.0, cr.NOOK_Y0 + 1.75, 1.10)), Vector((cr.NOOK_X0 + 1.35, cr.NOOK_Y0 + 1.30, 0.45)), 35, 4, 3),
    "desk-apron": (cr.polar(0.8, a0 + 0.85, 0.80), cr.polar(cr.r_front(a0 + 0.45), a0 + 0.45, 0.62), 26, 16, 9),
    "binders": (Vector((-1.05, -2.05, 1.25)), Vector((-1.05, cr.ROOM_Y0, 0.85)), 30, 16, 9),
    "binders-close": (Vector((-0.75, -2.95, 1.05)), Vector((-1.25, cr.ROOM_Y0, 0.75)), 32, 16, 9),
    "band-right": (Vector((-1.2, -0.6, 1.5)), Vector((3.2, 3.6, 2.0)), 20, 16, 9),
}
only = set(filter(None, args.only.split(",")))
for name, (loc, aim, lens, rw, rh) in shots.items():
    if only and name not in only:
        continue
    scene.camera = camera(name, loc, aim, lens)
    scene.render.resolution_x, scene.render.resolution_y = args.res, args.res * rh // rw
    scene.render.filepath = os.path.join(args.out, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)
