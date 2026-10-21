"""Turn downloaded CC0 models into small, untextured meshes for the room.

    python blender/import_assets.py --kettle path/to/electrickeetle.blend

The room's bake gives every mesh a fresh UV atlas, so image textures can't
survive it. This keeps a model's shape and turns its texture into flat
colours: each face takes the colour under its centre, snapped to the
nearest of a few named swatches. props.py maps the swatch names onto its
own materials. Writes blender/assets/<name>.glb; sources and licences are
in blender/assets/README.md.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)

bpy, Vector = b.bpy, b.Vector
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")


def load_blend(path):
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = src.objects
    objs = [o for o in dst.objects if o and o.type == "MESH"]
    for o in objs:
        bpy.context.scene.collection.objects.link(o)
    return objs


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def stand(o, height, yaw=0.0):
    """Scale to `height`, turn by `yaw` about Z, and stand the base centre
    on the origin."""
    me = o.data
    lo = Vector([min(v.co[i] for v in me.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in me.vertices) for i in range(3)])
    s = height / (hi.z - lo.z)
    base = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    rot = b.Matrix.Rotation(yaw, 3, "Z")
    for v in me.vertices:
        v.co = rot @ ((v.co - base) * s)


def flatten(o, swatches):
    """Give each face the swatch nearest to the texture colour under its
    centre. `swatches` maps a material name to an sRGB colour."""
    me = o.data
    img = next(n.image for mat in me.materials for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
    w, h = img.size
    px = list(img.pixels[:])
    uv = me.uv_layers.active.data
    names = list(swatches)
    me.materials.clear()
    for n in names:
        me.materials.append(bpy.data.materials.get(n) or b.mat_flat(n, swatches[n]))
    for f in me.polygons:
        u = sum(uv[li].uv.x for li in f.loop_indices) / f.loop_total
        v = sum(uv[li].uv.y for li in f.loop_indices) / f.loop_total
        x, y = min(int(u % 1 * w), w - 1), min(int(v % 1 * h), h - 1)
        c = [px[(y * w + x) * 4 + i] ** (1 / 2.2) for i in range(3)]
        f.material_index = min(range(len(names)), key=lambda k: sum((c[i] - swatches[names[k]][i]) ** 2 for i in range(3)))
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])


def export(o, name):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    path = os.path.join(ASSETS, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_materials="EXPORT",
                              export_texcoords=False, export_normals=True, export_yup=True)
    print("wrote", path, len(o.data.polygons), "faces", flush=True)


p = argparse.ArgumentParser()
p.add_argument("--kettle", help="electrickeetle.blend from opengameart.org/content/electric-keetle")
args = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
os.makedirs(ASSETS, exist_ok=True)

if args.kettle:
    k = join(load_blend(args.kettle), "ElectricKettle")
    stand(k, 0.245)
    flatten(k, {"KettleBlack": (0.03, 0.03, 0.03), "KettleGrey": (0.22, 0.22, 0.22),
                "KettleWindow": (0.78, 0.78, 0.78), "KettleOrange": (1.0, 0.5, 0.1)})
    export(k, "electric_kettle")
