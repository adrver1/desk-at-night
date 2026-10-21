"""PROTOTYPE (throwaway): the flare and helideck CCTV cameras, from the 3D
platform model, two ways.

    python blender/preview_cctv.py [--samples 16] [--out blender/build/cctv]

B: Cycles stills from each camera, day and night, to show what a baked
picture of the model looks like on a screen.
A: the platform cut down to what the two cameras see, exported in the room's
frame to web/public/cctv-prototype/platform.glb, for a live render in the
browser (web/cctv-prototype.html). Prints each camera's pose for the page.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import offshore_platform as op  # noqa: E402
import control_room as cr  # noqa: E402

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402

# Camera poses in platform coordinates: (location, aim, lens mm)
CAMS = {
    # On a mast at the corner of the quarters roof, looking down over the helideck to sea
    "heli": ((44.0, -16.0, 86.0), (68.0, 2.0, 73.0), 20),
    # On the corner shaft at the flare end, looking out along the boom to the tip
    "flare": ((-50.0, 15.0, 63.0), (-106.0, 0.0, 68.0), 26),
}

p = argparse.ArgumentParser()
p.add_argument("--samples", type=int, default=16)
p.add_argument("--res", type=int, default=768)
p.add_argument("--out", default=os.path.join(b.BUILD, "cctv"))
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

m = op.materials()
objs, tris, tip = op.build_platform(m, z_cut=-1.0)
print(f"platform: {tris} triangles", flush=True)

sea_m, _, bsdf = b._new_mat("Sea")
bsdf.inputs["Base Color"].default_value = (0.01, 0.03, 0.04, 1)
bsdf.inputs["Roughness"].default_value = 0.12
sea = b.quad("Sea", [(-3000, -3000, 0), (3000, -3000, 0), (3000, 3000, 0), (-3000, 3000, 0)], sea_m, (0, 0, 0))

sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.angle = math.radians(2)
sun = bpy.data.objects.new("Sun", sun_d)
sun.rotation_euler = (math.radians(55), 0, math.radians(-120))
scene.collection.objects.link(sun)
world = bpy.data.worlds.new("Sky")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
scene.world = world


def cam(name, loc, aim, lens):
    d = bpy.data.cameras.new(name)
    d.lens, d.clip_end = lens, 5000
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(o)
    return o


cams = {k: cam(k, *v) for k, v in CAMS.items()}
w = args.res
for light, (col, strength, sun_e) in {"day": ((0.55, 0.65, 0.78), 1.0, 3.5), "night": ((0.01, 0.015, 0.03), 1.0, 0.03)}.items():
    bg.inputs["Color"].default_value = (*col, 1)
    bg.inputs["Strength"].default_value = strength
    sun_d.energy = sun_e
    op.set_night(m, light == "night")
    for k, c in cams.items():
        scene.camera = c
        scene.render.resolution_x, scene.render.resolution_y = w, w * 9 // 16
        scene.render.filepath = os.path.join(args.out, f"B-{k}-{light}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scene.render.filepath, flush=True)

# A: cut to what the cameras see, in the room's frame, lamps at night strength
bpy.data.objects.remove(sea)
eyes = [Vector(v[0]) + Vector(j) for v in CAMS.values() for j in ((0, 0, 0), (0.5, 0, 0), (0, 0.5, 0), (0, 0, 0.5))]
left = op.cull_to_view(objs, eyes)
off = cr.PLATFORM_OFFSET
for o in list(objs):
    if not o.data.polygons:
        bpy.data.objects.remove(o)
        continue
    o.data.transform(Matrix.Translation(-off))
print(f"cut to the cameras' view: {tris} -> {left} triangles", flush=True)
op.set_night(m, True)
web = os.path.join(b.ROOT, "web", "public", "cctv-prototype")
os.makedirs(web, exist_ok=True)
for c in cams.values():
    bpy.data.objects.remove(c)
bpy.data.objects.remove(sun)
bpy.ops.export_scene.gltf(filepath=os.path.join(web, "platform.glb"), export_format="GLB", export_cameras=False,
                          export_lights=False, export_materials="EXPORT", export_normals=True, export_apply=True, export_yup=True)
for k, (loc, aim, lens) in CAMS.items():
    to3 = lambda v: [round(v[0] - off.x, 2), round(v[2] - off.z, 2), round(-(v[1] - off.y), 2)]  # noqa: E731
    fov = math.degrees(2 * math.atan(18 / lens / (16 / 9)))  # vertical, 36 mm sensor width
    print(f"CAM {k} pos={to3(loc)} aim={to3(aim)} fov={fov:.1f}", flush=True)
