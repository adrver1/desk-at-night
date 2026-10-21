"""
The platform as the two deck cameras see it, for the live CCTV screens.

    python blender/cctv_platform.py

Builds the platform (offshore_platform.py), keeps only the faces the cameras
can see (~2k triangles), parks the helicopter (helicopter.py, ~1.6k) on the
helideck, moves it all into the room's frame and writes

    cctv.glb   the platform, one mesh per material, lamps and windows at
               their night strength (the browser dims them by day)
    cctv.json  each camera's position, aim and vertical field of view,
               in the room's frame (three.js axes)

to web/public/control/. The browser draws them under the live sky and sea
(web/src/cctv.js). Seconds to run; no bake needed.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import control_room as cr  # noqa: E402
import helicopter as heli  # noqa: E402
import offshore_platform as op  # noqa: E402

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402

OUT = os.path.join(b.ROOT, "web", "public", "control")

# Cameras in platform coordinates: id (the screen content they feed), name on
# the picture, location, aim, lens (mm on a 36 mm wide sensor, 16:9)
CAMS = {
    # On a mast at the corner of the quarters roof, looking down over the helideck
    "deckCam": ("CAM 04 · Helideck", (44.0, -16.0, 86.0), (68.0, 2.0, 73.0), 20),
    # On the corner shaft at the flare end, looking out along the boom to the tip
    "flareCam": ("CAM 11 · Flare boom", (-50.0, 15.0, 63.0), (-106.0, 0.0, 74.0), 26),
}


def room_frame(v):
    """Platform coordinates to the room's, in three.js axes (y up, -z north)."""
    p = Vector(v) - cr.PLATFORM_OFFSET
    return [round(p.x, 3), round(p.z, 3), round(-p.y, 3)]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    m = op.materials()
    objs, tris, _ = op.build_platform(m, z_cut=-1.0)
    # A few eyes around each lens, so faces a hair off the exact ray stay
    eyes = [Vector(loc) + Vector(j) for _, loc, _, _ in CAMS.values()
            for j in ((0, 0, 0), (0.5, 0, 0), (0, 0.5, 0), (0, 0, 0.5))]
    left = op.cull_to_view(objs, eyes)
    for o in list(objs):
        if not o.data.polygons:
            bpy.data.objects.remove(o)
            continue
        o.data.transform(Matrix.Translation(-cr.PLATFORM_OFFSET))
    print(f"platform for the cameras: {tris} -> {left} triangles", flush=True)
    # The helicopter parked on the helideck, whole (its rotors and gear move,
    # so it isn't culled); web/src/helicopter.js animates its parts
    hm = heli.materials()
    root, _, htris = heli.build_helicopter(hm, bpy.context.scene.collection, heli.DECK_LOC, heli.DECK_YAW)
    root.location -= cr.PLATFORM_OFFSET
    print(f"helicopter: {htris} triangles", flush=True)
    op.set_night(m, True)
    heli.set_night(hm, True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "cctv.glb"), export_format="GLB", export_cameras=False,
                              export_lights=False, export_materials="EXPORT", export_normals=True,
                              export_texcoords=False, export_apply=True, export_yup=True)
    cams = {k: {"name": name, "position": room_frame(loc), "aim": room_frame(aim),
                "fov": round(math.degrees(2 * math.atan(36 * 9 / 16 / 2 / lens)), 2)}
            for k, (name, loc, aim, lens) in CAMS.items()}
    with open(os.path.join(OUT, "cctv.json"), "w") as f:
        json.dump({"triangles": left + htris, "cameras": cams}, f, indent=1, ensure_ascii=False)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
