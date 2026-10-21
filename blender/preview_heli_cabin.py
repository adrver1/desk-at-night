"""Throwaway preview: the view from inside the helicopter, flying in to the
platform at dusk. Which seat should the intro use?

    python blender/preview_heli_cabin.py [--samples 32] [--res 1280]

Renders the starboard window seat looking out, the same seat looking
forward to the cockpit, the jump seat behind the pilots, and a chase view
from outside. Stills go to blender/build/heli-cabin/.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import helicopter as heli  # noqa: E402
import offshore_platform as op  # noqa: E402

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=32)
p.add_argument("--res", type=int, default=1280)
p.add_argument("--out", default=os.path.join(b.BUILD, "heli-cabin"))
p.add_argument("--device", default="auto")
p.add_argument("--only", default="")
p.add_argument("--dist", type=float, default=520.0, help="metres from the platform")
args = p.parse_args()
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = b.pick_device(args.device)
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"

# Dusk: the sun just under 3 degrees, low in the south-west behind the platform's long side
SUN_EL, SUN_AZ = math.radians(2.5), math.radians(215)
world = bpy.data.worlds.new("Dusk")
world.use_nodes = True
nt = world.node_tree
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "MULTIPLE_SCATTERING"
sky.sun_elevation, sky.sun_rotation = SUN_EL, SUN_AZ
nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
nt.nodes["Background"].inputs["Strength"].default_value = 0.5
scene.world = world
sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.energy, sun_d.angle, sun_d.color = 1.2, math.radians(1), (1.0, 0.62, 0.38)
sun = bpy.data.objects.new("Sun", sun_d)
sun.rotation_euler = (math.radians(90) - SUN_EL, 0, SUN_AZ + math.pi / 2)
scene.collection.objects.link(sun)

pm = op.materials()
op.build_platform(pm, scene.collection, z_cut=-1.0)
op.set_night(pm, True)
sea_m, _, bsdf = b._new_mat("Sea")
bsdf.inputs["Base Color"].default_value = (0.008, 0.02, 0.03, 1)
bsdf.inputs["Roughness"].default_value = 0.12
g = op.Mesh()
g.span(sea_m, -6000, 6000, -6000, 6000, -0.2, 0)
g.objects("Sea", scene.collection)

# The helicopter: 120 m up, args.dist out off the quarters end, heading
# past the platform's left so it shows on the right; place() turns it so
# the platform sits where a shot wants it
target = Vector((20, 0, 50))
here = Vector((args.dist * 0.80, -args.dist * 0.60, 118.0))
hm = heli.materials()
root, parts, tris = heli.build_helicopter(hm, scene.collection, here, 0.0, interior=True)
heli.pose(parts, gear=0.0, rotor=math.radians(10))
for k in ("MainRotor", "TailRotor"):
    parts[k].hide_render = True       # spinning: the blur discs instead
for k in ("MainDisc", "TailDisc"):
    parts[k].hide_render = False
heli.set_night(hm, True)
print(f"helicopter with cabin: {tris} triangles", flush=True)


def place(off_deg):
    """Point the nose off_deg to the left of the platform; returns the matrix."""
    to = target - here
    yaw = math.atan2(to.y, to.x) + math.radians(off_deg)
    root.rotation_euler = (0, 0, yaw)
    bpy.context.view_layer.update()
    return Matrix.Translation(here) @ Matrix.Rotation(yaw, 4, "Z")


def cam(name, loc, aim, lens):
    d = bpy.data.cameras.new(name)
    d.lens, d.clip_start, d.clip_end = lens, 0.05, 20000
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(o)
    return o


def shot(c, name, w, h):
    if args.only and name not in args.only.split(","):
        return
    scene.camera = c
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(args.out, name + ".jpg")
    scene.render.image_settings.file_format = "JPEG"
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)


w, h = args.res, args.res * 9 // 16
M = place(72)   # platform out of the right-hand window
seat = M @ heli.EYE_SEAT
shot(cam("Window", seat, target, 15), "a-window-seat", w, h)
# Closer in, on short final: the platform fills the window
here.x, here.y, here.z = 210, -150, 95
root.location = here
M = place(70)
shot(cam("WindowClose", M @ heli.EYE_SEAT, target + Vector((25, 0, 10)), 15), "a-window-close", w, h)
here.x, here.y, here.z = args.dist * 0.80, -args.dist * 0.60, 118.0
root.location = here
aisle = M @ Vector((heli.EYE_SEAT.x, heli.SEAT_Y[1], heli.FLOOR + 1.25))
M = place(22)
aisle = M @ Vector((heli.EYE_SEAT.x, heli.SEAT_Y[1], heli.FLOOR + 1.25))
shot(cam("Forward", aisle, M @ Vector((6.0, -0.4, heli.FLOOR + 1.1)), 16), "a-seat-forward", w, h)
jump = M @ heli.EYE_JUMP
shot(cam("Jump", jump, M @ Vector((12.0, -2.5, heli.FLOOR + 0.6)), 18), "b-jump-seat", w, h)
chase = M @ Vector((-26, 16, 7))
shot(cam("Chase", chase, (M @ Vector((0, 0, 2))) * 0.3 + target * 0.7, 28), "chase", w, h)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "heli-cabin.blend"))
