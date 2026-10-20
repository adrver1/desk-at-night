"""
Bake the control room's lighting and export it for the web viewer.

    python blender/bake_control_room.py                       # 2048² atlas, 64 samples
    python blender/bake_control_room.py --res 512 --samples 8 # quick test

Same scheme as build.py, with two light groups instead of moon and lamp:

    light_ceiling.png  irradiance from the ceiling panels, clock, sky and the
                       platform outside the window
    light_screens.png  irradiance from the desk monitors and the video wall

so the browser can dim the room for the night shift and let the screens
carry it. Everything that glows (screens, panels, clock, platform lights,
flare) is left out of the bake and exported as separate meshes named
Emit<Group>; meta.json gives each one's colour and strength.

Outputs go to web/public/control/.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import control_room as cr  # noqa: E402

bpy = b.bpy
OUT = os.path.join(b.ROOT, "web", "public", "control")

# Emissive materials, grouped by which light map they feed
GROUPS = {
    "Screen": "screens", "ScreenCam": "screens", "ExitSign": "screens",  # the exit sign never goes off
    "LedPanel": "ceiling", "Clock": "ceiling", "PlatformLight": "ceiling", "Flare": "ceiling",
}


def texel_weight(name):
    """Atlas share per object: what the operator sees up close gets the most."""
    if name == "Sea":
        return 1e-6  # 800 m across: by area alone it would take the whole atlas
    if name.startswith(("Plat", "Flare")):
        return 0.002
    if name in ("Ceiling", "WallRear") or name.startswith("AirCassette"):
        return 0.08
    if name.startswith(("Wall", "Floor", "Mullion", "Transom", "Link", "Meeting")):
        return 0.2
    if name.startswith("S") and name[1:2].isdigit():
        return 3.0   # desk props
    if name.startswith("Desk") and "Mon" not in name:
        return 1.0
    return 0.5       # monitors, chairs, posts


def emissive(obj):
    return obj.type == "MESH" and obj.data.materials and obj.data.materials[0].name in GROUPS


def strength(mat):
    return mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--res", type=int, default=2048)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--device", default="auto")
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(b.BUILD, exist_ok=True)
    t0 = time.time()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = b.pick_device(args.device)
    scene.render.bake.use_selected_to_active = False

    print("building scene", flush=True)
    m = cr.materials()
    cr.build_desk(m)
    cr.build_monitors(m)
    cr.build_video_wall(m)
    cr.build_desk_props(m)
    cr.build_chairs(m)
    cr.build_shell(m)
    cr.build_meeting_corner(m)
    cr.build_outside(m)
    world = bpy.data.worlds.new("Night")
    world.use_nodes = True
    sky = world.node_tree.nodes["Background"].inputs
    sky["Color"].default_value = (0.012, 0.02, 0.045, 1)
    scene.world = world
    main_cam = cr.cameras()[0]
    scene.camera = main_cam

    # Monitors are empties parenting a bezel and a screen: flatten them first
    for o in scene.objects:
        if o.parent:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    for o in [o for o in scene.objects if o.type == "EMPTY"]:
        bpy.data.objects.remove(o)

    # Things the player can move or use (chairs spin, mugs get picked up,
    # light panels get pressed) are baked with the room so they carry its
    # light, then split back out afterwards.
    # A vertex group per object survives the join and finds them again.
    movable = {}
    for o in scene.objects:
        if o.name.startswith("Chair") or o.name.endswith(("Mug", "TouchPanel", "LightPanel")):
            movable[o.name] = o.matrix_world.translation.copy()
            o.vertex_groups.new(name=o.name).add(range(len(o.data.vertices)), 1.0, "REPLACE")
            if o.name.endswith("Mug"):  # the coffee drops as it's drunk, so it moves on its own
                slot = [i for i, mt in enumerate(o.data.materials) if mt.name == "PropCoffee"][0]
                vs = {v for f in o.data.polygons if f.material_index == slot for v in f.vertices}
                coffee = o.name[:-3] + "Coffee"
                o.vertex_groups.new(name=coffee).add(list(vs), 1.0, "REPLACE")
                movable[coffee] = movable[o.name]

    glowing = [o for o in scene.objects if emissive(o)]
    b.texel_weight = texel_weight  # unwrap_weighted() looks it up by name
    room = b.join_static(glowing)
    print(f"room: {len(room.data.polygons)} faces, {len(glowing)} emissive meshes", flush=True)

    imgs = {k: bpy.data.images.new(k, args.res, args.res, float_buffer=True, alpha=False)
            for k in ("albedo", "ceiling", "screens")}
    mats = {mat.name: mat for o in glowing for mat in o.data.materials}
    full = {name: strength(mat).default_value for name, mat in mats.items()}
    sky_full = sky["Strength"].default_value

    def only(group):
        for name, mat in mats.items():
            strength(mat).default_value = full[name] if GROUPS[name] == group else 0.0
        sky["Strength"].default_value = sky_full if group == "ceiling" else 0.0

    print(f"baking {args.res}x{args.res} atlases, {args.samples} samples", flush=True)
    scene.cycles.samples = 1
    b.bake(room, imgs["albedo"], {"COLOR"}, "albedo")
    scene.cycles.samples = args.samples
    only("ceiling")
    b.bake(room, imgs["ceiling"], {"DIRECT", "INDIRECT"}, "ceiling")
    only("screens")
    b.bake(room, imgs["screens"], {"DIRECT", "INDIRECT"}, "screens")
    only(None)

    b.save_albedo(b.pixels(imgs["albedo"]), os.path.join(OUT, "albedo.png"))
    meta = {
        "scaleCeiling": b.save_light(b.pixels(b.denoise(imgs["ceiling"])), os.path.join(OUT, "light_ceiling.png")),
        "scaleScreens": b.save_light(b.pixels(b.denoise(imgs["screens"])), os.path.join(OUT, "light_screens.png")),
        "encoding": "L = pow(texel, 3) * scale",
        "resolution": args.res,
        "samples": args.samples,
        "emitters": {},
    }

    # Split the movable objects back out, each with its origin where it stands
    coffees = sorted(n for n in movable if n.endswith("Coffee"))
    for name in coffees + sorted(n for n in movable if n not in coffees):
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = room
        room.select_set(True)
        room.vertex_groups.active_index = room.vertex_groups[name].index
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.vertex_group_select()
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        part = [o for o in bpy.context.selected_objects if o is not room][0]
        part.name = part.data.name = name
        scene.cursor.location = movable[name]
        bpy.ops.object.select_all(action="DESELECT")
        part.select_set(True)
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    for o in [room] + [scene.objects[n] for n in movable]:
        o.vertex_groups.clear()

    # Floor plan for the first-person walk: what the player can't walk through
    # (Blender X/Y in metres; the viewer converts to its own axes)
    step = (cr.WALL_W + 0.03) / cr.WALL_R
    meta["layout"] = {
        "desks": [round(d, 5) for d in cr.DESKS], "deskHalf": round(cr.DESK_HALF, 5),
        "rFront": cr.R_FRONT, "bayDepth": cr.BAY_DEPTH, "rBack": cr.R_BACK,
        "wallR": cr.WALL_R, "wallHalf": round(cr.WALL_N / 2 * step, 5),
        "room": [-cr.ROOM_X, cr.ROOM_Y0, cr.ROOM_X, cr.ROOM_Y1],
        "table": [2.6, -2.8, 1.0, 0.55],  # centre and radii of the meeting table
        "deskZ": cr.DESK_Z,
    }
    meta["movable"] = sorted(movable)

    # Join the glowing meshes per material and name them for the viewer
    for name, mat in mats.items():
        objs = [o for o in scene.objects if emissive(o) and o.data.materials[0] is mat]
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.active_object
        joined.name = "Emit" + name
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        col = bsdf.inputs["Emission Color"]
        rgb = list(col.default_value)[:3]
        if col.is_linked:  # the screens' brick pattern: use its average colour
            brick = col.links[0].from_node
            c1, c2 = brick.inputs["Color1"].default_value, brick.inputs["Color2"].default_value
            rgb = [(c1[i] + c2[i]) / 2 for i in range(3)]
        meta["emitters"][joined.name] = {"color": [round(c, 4) for c in rgb], "strength": full[name],
                                         "group": GROUPS[name]}
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print("exporting", flush=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "scene.glb"), export_format="GLB",
                              export_cameras=True, export_lights=False, export_materials="NONE",
                              export_texcoords=True, export_normals=True, export_apply=True, export_yup=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(b.BUILD, "control_baked.blend"))
    print(f"done in {time.time() - t0:.1f}s -> {OUT}", flush=True)


if __name__ == "__main__":
    main()
