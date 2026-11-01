"""
Bake the light of the Trondheim scene (story mode's Torvet), from the models trondheim_surroundings.py and
preview_trondheim.py --glb export. The dream look stays: only the ground and Føniks get baked light.

    python blender/bake_trondheim.py                         # 3072², 1024 samples, about 3 min on an RTX card
    python blender/bake_trondheim.py -- --res 1024 --samples 32 --out /tmp/t   # quick test

Writes to web/public/story/trondheim/:

    ground.png       the shadows on the ground, 1 in the open, seen from above over GROUND_SIZE round the square.
                     The other buildings keep the scene's live light (their 26 000 tree facets defeat any atlas)
    foniks_lit.glb   Føniks with a second UV set for its light
    foniks_light.png its light (sky and sun), stored as light / 2 in sRGB
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "web", "public", "story", "trondheim")
GROUND_WEIGHTS = 0.55, 0.45                         # the ground: sky and sun, each at 1 on open ground
FONIKS_WEIGHTS = 0.7, 0.55                          # Føniks: the same, kept low so highlights do not wash the shadows out in the tone map
FONIKS_FLOOR = 0.3                                  # least light on Føniks: parts the bake reads as black (inside-out faces) stay readable
GROUND_CENTRE, GROUND_SIZE = (-20.0, 25.0), 340.0   # m: the plane's map covers this square
SUN = Vector((60.0, -40.0, 90.0))                   # toward the sun: trondheim.js's light, in Blender's axes
WEIGHTS = {"foniks": 3.0, "Dream": 1.0}             # share of the atlas by world area: the camera ends at Føniks's door
HUGE = 3000.0                                       # m²: a face this big is ground out to the horizon, not a building


PARTS = {"palette": 12.0, "Lamp": 6.0, "glass": 1.0, "water": 0.2}   # Føniks's share of the atlas per m²: thin parts need the most, or they get a texel or none


def weight(o):
    return PARTS.get(o.name.split(".")[0], 2.0)


def mast_shadows(width=0.24):
    """A narrow board behind each flag mast as seen from the sun, in the sun's bake only. The masts are 12 cm thick,
    too thin to leave a clear shadow in the maps. Standing behind them it casts a wider one without darkening the mast
    itself. Hoists from flags.json sit 9 cm to the mast's -x, at its top."""
    with open(os.path.join(SRC, "flags.json")) as f:
        hoists = json.load(f)["hoists"]
    away = -Vector((SUN.x, SUN.y, 0)).normalized()
    out = []
    for x, y, top in hoists:
        z0 = max(0.0, top - 9.68)   # the masts on the ground are 9.68 m up to the hoist; the roof's stands on the roof
        me = bpy.data.meshes.new("MastShadow")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new("MastShadow", me)
        o.scale = (0.04, width, top - z0)
        o.rotation_euler = (0, 0, math.atan2(away.y, away.x))
        o.location = Vector((x + 0.09, y, (z0 + top) / 2)) + away * 0.12
        bpy.context.scene.collection.objects.link(o)
        out.append(o)
    return out

def unwrap(objs):
    """Each object's own islands in a "Light" UV set, scaled to its share, then all joined and packed in one atlas."""
    for o in objs:
        me = o.data
        if not me.uv_layers:
            me.uv_layers.new(name="UVMap")
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
        uv = bm.loops.layers.uv["Light"]
        area = sum(f.calc_area() for f in bm.faces)
        uv_area = sum(0.5 * abs(sum(l[uv].uv.x * f.loops[i - 1][uv].uv.y - f.loops[i - 1][uv].uv.x * l[uv].uv.y
                                    for i, l in enumerate(f.loops))) for f in bm.faces)
        s = math.sqrt(area * weight(o) / max(uv_area, 1e-9))
        for f in bm.faces:
            for l in f.loops:
                l[uv].uv *= s
        bm.to_mesh(me)
        bm.free()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = "FoniksLit"
    joined.data.uv_layers.active = joined.data.uv_layers["Light"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=0.002, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    return joined


def ground_uvs(o):
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    light = me.uv_layers.new(name="Light")
    me.uv_layers.active = light
    for loop in me.loops:
        p = o.matrix_world @ me.vertices[loop.vertex_index].co
        light.data[loop.index].uv = ((p.x - GROUND_CENTRE[0]) / GROUND_SIZE + 0.5, (p.y - GROUND_CENTRE[1]) / GROUND_SIZE + 0.5)


def bake(obj, image):
    obj.data.uv_layers["Light"].active_render = True   # the layer the bake writes through
    for mat in obj.data.materials:
        nodes = mat.node_tree.nodes
        node = nodes.get("BakeTarget") or nodes.new("ShaderNodeTexImage")
        node.name = "BakeTarget"
        node.image = image
        nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True, margin=8, margin_type="EXTEND")


def pixels(image):
    res = image.size[0]
    a = np.empty(res * res * 4, np.float32)
    image.pixels.foreach_get(a)
    return np.flipud(a.reshape(res, res, 4)[:, :, :3])


def save_maps(raw, out):
    sky, sun = raw["sky", "ground"].max(axis=2), raw["sun", "ground"].max(axis=2)
    full_sky, full_sun = float(np.percentile(sky, 99)), float(np.percentile(sun, 90))   # open ground
    shadow = np.clip(GROUND_WEIGHTS[0] * sky / full_sky + GROUND_WEIGHTS[1] * sun / full_sun, 0, 1)
    h, w = shadow.shape
    yy, xx = np.mgrid[0:h, 0:w]
    k = np.clip(np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]) / (0.08 * w), 0, 1)   # open ground at the map's edge
    Image.fromarray(((shadow * k + (1 - k)) * 255 + 0.5).astype(np.uint8), "L").save(os.path.join(out, "ground.png"), optimize=True)
    light = FONIKS_WEIGHTS[0] * raw["sky", "buildings"] / full_sky + FONIKS_WEIGHTS[1] * raw["sun", "buildings"] / full_sun
    light = np.clip(np.maximum(light, FONIKS_FLOOR) / 2, 0, 1) ** (1 / 2.2)
    Image.fromarray((light * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "foniks_light.png"), optimize=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--res", type=int, default=3072)
    p.add_argument("--samples", type=int, default=1024)
    p.add_argument("--out", default=SRC)
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

    meshes = []
    for name, w in (("torvet.glb", 1.0), ("foniks.glb", WEIGHTS["foniks"])):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name))
        for o in set(bpy.data.objects) - before:
            if o.type == "MESH":
                o["weight"] = w
                meshes.append(o)
    ground = next(o for o in meshes if o.name == "DreamGroundFlat")
    meshes.remove(ground)
    # Flatten the import's parents, so each object's world is its own
    for o in meshes + [ground]:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    # The scene's other huge faces run out to the horizon too: by area they would take the whole atlas. Over to the ground.
    for o in list(meshes):
        big = [f for f in o.data.polygons if f.area > HUGE]
        if not big:
            continue
        print("huge faces in", o.name, len(big), round(sum(f.area for f in big)), flush=True)
        for f in o.data.polygons:
            f.select = f.area > HUGE
        for e in o.data.edges:
            e.select = False
        for v in o.data.vertices:
            v.select = False
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="FACE")
        bpy.ops.object.mode_set(mode="OBJECT")
        for f in o.data.polygons:
            f.select = f.area > HUGE
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        part = [x for x in bpy.context.selected_objects if x is not o][0]
        bpy.ops.object.select_all(action="DESELECT")
        part.select_set(True)
        ground.select_set(True)
        bpy.context.view_layer.objects.active = ground
        bpy.ops.object.join()
    ground_uvs(ground)
    built = unwrap([o for o in meshes if o.get("weight", 1.0) == WEIGHTS["foniks"]])   # the trees' 26 000 facets defeat any atlas: only Føniks gets one
    # The bake takes the diffuse pass only, and a metal has none: its light would come out black.
    # The game draws these with their base colour and this light, so only the bake sees this.
    for mat in bpy.data.materials:
        bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
        if bsdf:
            for name in ("Metallic", "Transmission Weight"):
                sock = bsdf.inputs[name]
                if sock.is_linked:
                    mat.node_tree.links.remove(sock.links[0])
                sock.default_value = 0.0
    # A plain colour too while it bakes: light on a black texel or vertex comes out black, and the game has its colour
    colours = []
    for mat in bpy.data.materials:
        bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
        if bsdf:
            sock = bsdf.inputs["Base Color"]
            colours.append((mat, sock, sock.links[0].from_socket if sock.is_linked else None, tuple(sock.default_value)))
            if sock.is_linked:
                mat.node_tree.links.remove(sock.links[0])
            sock.default_value = (0.6, 0.6, 0.6, 1)
    masts = mast_shadows()
    print("faces", len(built.data.polygons), "ground", len(ground.data.polygons), "masts", len(masts), flush=True)

    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    sky = world.node_tree.nodes["Background"].inputs
    sky["Color"].default_value = (1, 1, 1, 1)
    scene.world = world
    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.angle = math.radians(0.6)   # any wider and a mast's shadow blurs away before it lands
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = SUN.to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(sun)

    raw = {}
    for label, sky_on, sun_on in (("sky", 1.0, 0.0), ("sun", 0.0, 1.0)):
        sky["Strength"].default_value = sky_on
        sun_data.energy = sun_on
        for what, obj in (("buildings", built), ("ground", ground)):
            for o in masts:
                o.hide_render = label == "sky"
            image = bpy.data.images.new(f"{label}_{what}", args.res, args.res, float_buffer=True, alpha=False)
            bake(obj, image)
            raw[label, what] = pixels(image)
            print("baked", label, what, flush=True)
    save_maps(raw, args.out)
    bpy.data.objects.remove(sun)
    for o in masts:
        bpy.data.objects.remove(o)
    for mat, sock, source, value in colours:
        sock.default_value = value
        if source:
            mat.node_tree.links.new(source, sock)
    bpy.ops.object.select_all(action="DESELECT")
    built.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, "foniks_lit.glb"), export_format="GLB", export_cameras=False, use_selection=True,
                              export_lights=False, export_apply=True, export_yup=True, export_vertex_color="ACTIVE")
    print("done", flush=True)


if __name__ == "__main__":
    main()
