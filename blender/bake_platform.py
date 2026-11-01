"""
Bake shading for the prologue's platform, from the model intro_export.py writes. The sky stays live, so it can change
with the weather: this only darkens what the platform itself hides.

    python blender/bake_platform.py                           # 2048², 512 samples
    python blender/bake_platform.py -- --res 1024 --samples 32 --out /tmp/p   # quick test

Writes to web/public/intro/:

    platform_lit.glb    the platform with a second UV set
    platform_light.png  red: how much sky each spot sees; green: whether the sun reaches it, at SUN, the intro's
                        morning (intro.js uses them for its sky and sun light)
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "public", "intro")
SUN = Vector((0.2374, 0.9182, 0.3171))   # toward the sun, in Blender's axes: outdoor.js's at the intro's 11:00
SHARE = {"PlatHelideck": 3.0, "PlatLamp": 0.2, "PlatLampWhite": 0.2, "PlatSign": 0.2, "PlatInterior": 0.2}   # atlas per m²


def unwrap(objs):
    """Every object's own islands in a "Light" UV set, sized by area, then packed together in one atlas."""
    for o in objs:
        me = o.data
        if not me.uv_layers:
            me.uv_layers.new(name="UVMap")   # so Light is the second set on all of them
        me.uv_layers.active = me.uv_layers.new(name="Light")
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0)
        bpy.ops.object.mode_set(mode="OBJECT")
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.transform(o.matrix_world)
        uv = bm.loops.layers.uv["Light"]
        area = sum(f.calc_area() for f in bm.faces)
        uv_area = sum(0.5 * abs(sum(l[uv].uv.x * f.loops[i - 1][uv].uv.y - f.loops[i - 1][uv].uv.x * l[uv].uv.y
                                    for i, l in enumerate(f.loops))) for f in bm.faces)
        s = math.sqrt(area * SHARE.get(o.name.split("_")[-1].split(".")[0], 1.0) / max(uv_area, 1e-9))
        for f in bm.faces:
            for l in f.loops:
                l[uv].uv *= s
        bm.transform(o.matrix_world.inverted())
        bm.to_mesh(me)
        bm.free()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=0.002, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(objs, image, kind, **options):
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        node = nodes.get("BakeTarget") or nodes.new("ShaderNodeTexImage")
        node.name = "BakeTarget"
        node.image = image
        nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type=kind, use_clear=True, margin=8, margin_type="EXTEND", **options)
    res = image.size[0]
    a = np.empty(res * res * 4, np.float32)
    image.pixels.foreach_get(a)
    return np.flipud(a.reshape(res, res, 4)[:, :, :3])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--res", type=int, default=2048)
    p.add_argument("--samples", type=int, default=512)
    p.add_argument("--out", default=OUT)
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.cycles.device = "GPU"
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.samples = args.samples
    scene.render.bake.use_selected_to_active = False

    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "platform.glb"))
    objs = [o for o in scene.objects if o.type == "MESH"]
    unwrap(objs)
    # Plain surfaces while baking, so that colour, metal and glow don't count; the export gets the real ones back
    saved = []
    for mat in bpy.data.materials:
        bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
        if not bsdf:
            continue
        for name, value in (("Base Color", (0.6, 0.6, 0.6, 1)), ("Metallic", 0.0), ("Transmission Weight", 0.0), ("Emission Strength", 0.0)):
            sock = bsdf.inputs[name]
            saved.append((mat, sock, sock.links[0].from_socket if sock.is_linked else None, sock.default_value if name != "Base Color" else tuple(sock.default_value)))
            if sock.is_linked:
                mat.node_tree.links.remove(sock.links[0])
            sock.default_value = value

    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world
    sky_image = bpy.data.images.new("sky", args.res, args.res, float_buffer=True, alpha=False)
    sky = bake(objs, sky_image, "DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}).max(axis=2)
    print("baked sky", flush=True)

    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    lamp = bpy.data.lights.new("Sun", "SUN")
    lamp.angle = math.radians(1.5)
    lamp.energy = 1.0
    sun = bpy.data.objects.new("Sun", lamp)
    sun.rotation_euler = SUN.to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(sun)
    sun_image = bpy.data.images.new("sun", args.res, args.res, float_buffer=True, alpha=False)
    seen = bake(objs, sun_image, "SHADOW").max(axis=2)
    print("baked sun", flush=True)
    bpy.data.objects.remove(sun)

    # A spot that gets no sky at all is inside-out (or never seen): left to the live light, not black
    dark = sky <= 0.01
    sky, seen = np.where(dark, 1.0, np.clip(sky, 0, 1)), np.where(dark, 1.0, np.clip(seen, 0, 1))
    print("dark share", round(float(dark.mean()), 3), "seen mean", round(float(seen.mean()), 3), "sky mean", round(float(sky.mean()), 3), flush=True)
    rgb = np.stack((sky, seen, np.zeros_like(sky)), axis=2)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(os.path.join(args.out, "platform_light.png"), optimize=True)

    for mat, sock, source, value in saved:
        sock.default_value = value
        if source:
            mat.node_tree.links.new(source, sock)
    for mat in bpy.data.materials:
        if mat.use_nodes and mat.node_tree.nodes.get("BakeTarget"):
            mat.node_tree.nodes.remove(mat.node_tree.nodes["BakeTarget"])
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, "platform_lit.glb"), export_format="GLB", use_selection=True,
                              export_cameras=False, export_lights=False, export_apply=True, export_yup=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
