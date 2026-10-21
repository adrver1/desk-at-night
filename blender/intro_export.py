"""
The models for the intro, flying in to the platform by helicopter.

    python blender/intro_export.py

Writes to web/public/intro/:

    platform.glb  the whole platform down to the waterline, lamps at their
                  day strength (the flare burns), in platform coordinates
    heli.glb      the helicopter with its cabin (open windows, seats,
                  cockpit, sliding doors), at the origin with the nose along +X, parts
                  named for web/src/helicopter.js
    intro.json    where things are, in three.js axes (y up, Blender's Y
                  is three's -z): the helideck, where it parks, the seats
                  and the eye of the passenger we play

The browser draws them under outdoor.js's sky and sea (web/src/intro.js).
Seconds to run; no bake needed.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import helicopter as heli  # noqa: E402
import offshore_platform as op  # noqa: E402

bpy, Vector = b.bpy, b.Vector

OUT = os.path.join(b.ROOT, "web", "public", "intro")


def three(v):
    """Blender axes to three.js: z up becomes y up, y becomes -z."""
    v = Vector(v)
    return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_cameras=False,
                              export_lights=False, export_materials="EXPORT", export_normals=True,
                              export_texcoords=True, export_apply=False, export_yup=True)
    print("wrote", path, f"({os.path.getsize(path) // 1024} KB)", flush=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    # Helicopter first, so its part names carry no .001 suffixes
    hm = heli.materials()
    coll = bpy.data.collections.new("Heli")
    bpy.context.scene.collection.children.link(coll)
    root, parts, htris = heli.build_helicopter(hm, coll, interior=True)
    for o in parts.values():
        o.hide_render = False
    root.name = "Helicopter"
    heli.set_night(hm, True)   # nav lights and cabin lamps on in flight
    export(os.path.join(OUT, "heli.glb"), coll.objects)
    print(f"helicopter with cabin: {htris} triangles", flush=True)

    m = op.materials()
    objs, tris, _ = op.build_platform(m, z_cut=-1.0)
    op.set_night(m, False)
    m["flare"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 120
    export(os.path.join(OUT, "platform.glb"), [o for o in objs if o.data.polygons])
    print(f"platform: {tris} triangles", flush=True)

    seats = [three((x, y, heli.FLOOR + 0.50)) + [face] for x, face in zip(heli.SEAT_ROWS, heli.SEAT_FACE)
             for y in heli.SEAT_Y]
    info = {
        "triangles": {"platform": tris, "helicopter": htris},
        "helideck": {"centre": three((op.HELI_X, 0, op.HELI_Z)), "radius": op.HELI_R},
        "park": {"position": three(heli.DECK_LOC), "yaw": heli.DECK_YAW},
        "quarters": {"x": [op.LQ_X0, op.LQ_X1], "z": [-op.LQ_Y, op.LQ_Y], "roof": op.LQ_TOP},
        "eye": three(heli.EYE_SEAT),
        "seats": seats,          # x, y, z of the seat pan, then +1 facing forward or -1 aft
        "door": {"x": [heli.DOOR[0], heli.DOOR[1]], "sill": heli.DOOR[2], "slide": heli.DOOR_SLIDE},
        "floor": heli.FLOOR,
    }
    with open(os.path.join(OUT, "intro.json"), "w") as f:
        json.dump(info, f, indent=1)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
