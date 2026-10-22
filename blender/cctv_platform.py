"""
The platform as the deck cameras see it, for the live CCTV screens.

    python blender/cctv_platform.py

Builds the platform (offshore_platform.py), keeps only the faces the cameras
can see (~4k triangles, the boom camera's whole swing included), parks the helicopter (helicopter.py, ~1.6k) on the
helideck, moves it all into the room's frame and writes

    cctv.glb   the platform, one mesh per material, lamps and windows at
               their night strength (the browser dims them by day); the big
               crane's turning part is one more object, CraneSlew, with its
               origin on the slewing ring, so the browser can swing it
    cctv.json  each camera's position, aim and vertical field of view,
               in the room's frame (three.js axes), and for the boom camera
               the object it rides on

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

OUT = os.path.join(b.ROOT, "web", "public", "control")

# Cameras in platform coordinates: id (the screen content they feed), name on
# the picture, location, aim, lens (mm on a 36 mm wide sensor, 16:9)
CAMS = {
    # On a mast at the corner of the quarters roof, looking down over the helideck
    "deckCam": ("CAM 04 · Helideck", (46.0, -16.0, 65.0), (op.HELI_X - 4.0, 2.0, op.HELI_Z), 20),
    # On the plant module roof, looking over the process module along the boom to the tip
    "flareCam": ("CAM 11 · Flare boom", (12.0, 17.5, 63.0), (-95.0, 0.0, 85.0), 24),
    # Fixed on the big crane's pedestal under the cab, looking down at the
    # supply vessel's berth (supply_vessel.py BERTH_LOC) on the crane side
    "craneCam": ("CAM 07 · Supply vessel berth", (op.CRANE_X, -17.5, 58.0), (op.CRANE_X + 4.5, -45.0, 2.0), 22),
    # Under the boom head of the big crane, looking down past the hook; it
    # turns with the crane (BOOM_CAM: the browser parents it to CRANE_SLEW).
    # Placed as the boom is stowed: level, pointing -X from the slewing ring.
    "boomCam": ("CAM 08 · Crane boom", (op.CRANE_X - 3.2 - op.CRANE_BOOM - 1.0, op.CRANE_Y, op.CRANE_RING - 0.6),
                (op.CRANE_X - 3.2 - op.CRANE_BOOM - 4.0, op.CRANE_Y, op.CRANE_RING - 60.0), 16),
}
BOOM_CAM = "boomCam"
# Where the boom swings while the game runs (vessel.js slews it from stowed
# toward the supply vessel's cargo deck): plan bearings from the ring, degrees
# counterclockwise from +X, for the eyes that decide what the boom camera sees
BOOM_SWING = range(180, 256, 8)


def boom_eyes():
    """The boom camera's position at each angle of its swing."""
    _, loc, _, _ = CAMS[BOOM_CAM]
    dx, dy = loc[0] - op.CRANE_X, loc[1] - op.CRANE_Y
    r = math.hypot(dx, dy)
    return [Vector((op.CRANE_X + r * math.cos(math.radians(a)), op.CRANE_Y + r * math.sin(math.radians(a)), loc[2]))
            for a in BOOM_SWING]


def room_frame(v):
    """Platform coordinates to the room's, in three.js axes (y up, -z north)."""
    p = cr.PLATFORM_TO_ROOM @ Vector(v)
    return [round(p.x, 3), round(p.z, 3), round(-p.y, 3)]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    m = op.materials()
    objs, tris, _ = op.build_platform(m, z_cut=-1.0, crane_slew=True)
    # The crane's turning part stays whole (the browser swings it) and out
    # of the way while the rest is culled
    slew = bpy.data.objects[op.CRANE_SLEW]
    bpy.context.scene.collection.objects.unlink(slew)
    # A few eyes around each lens, so faces a hair off the exact ray stay
    eyes = [Vector(loc) + Vector(j) for k, (_, loc, _, _) in CAMS.items() if k != BOOM_CAM
            for j in ((0, 0, 0), (0.5, 0, 0), (0, 0.5, 0), (0, 0, 0.5))] + boom_eyes()
    left = op.cull_to_view(objs, eyes)
    for o in list(objs):
        if not o.data.polygons:
            bpy.data.objects.remove(o)
            continue
        o.data.transform(cr.PLATFORM_TO_ROOM)
    bpy.context.scene.collection.objects.link(slew)
    bpy.context.view_layer.update()  # matrix_world catches up with the location set at build
    slew.matrix_world = cr.PLATFORM_TO_ROOM @ slew.matrix_world
    stris = sum(len(p.vertices) - 2 for p in slew.data.polygons)
    left += stris
    print(f"platform for the cameras: {tris} -> {left} triangles ({stris} in {op.CRANE_SLEW})", flush=True)
    # The helicopter parked on the helideck, whole (its rotors and gear move,
    # so it isn't culled); web/src/helicopter.js animates its parts
    hm = heli.materials()
    root, _, htris = heli.build_helicopter(hm, bpy.context.scene.collection, heli.DECK_LOC, heli.DECK_YAW)
    bpy.context.view_layer.update()
    root.matrix_world = cr.PLATFORM_TO_ROOM @ root.matrix_world
    print(f"helicopter: {htris} triangles", flush=True)
    op.set_night(m, True)
    heli.set_night(hm, True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "cctv.glb"), export_format="GLB", export_cameras=False,
                              export_lights=False, export_materials="EXPORT", export_normals=True,
                              export_texcoords=True, export_image_format="JPEG", export_jpeg_quality=80,
                              export_apply=True, export_yup=True)
    cams = {k: {"name": name, "position": room_frame(loc), "aim": room_frame(aim),
                "fov": round(math.degrees(2 * math.atan(36 * 9 / 16 / 2 / lens)), 2)}
            for k, (name, loc, aim, lens) in CAMS.items()}
    cams[BOOM_CAM]["parent"] = op.CRANE_SLEW   # turns with it
    with open(os.path.join(OUT, "cctv.json"), "w") as f:
        json.dump({"triangles": left + htris, "cameras": cams}, f, indent=1, ensure_ascii=False)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
