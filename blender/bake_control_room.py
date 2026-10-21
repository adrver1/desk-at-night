"""
Bake the control room's lighting and export it for the web viewer.

    python blender/bake_control_room.py                       # 2048² atlas, 64 samples
    python blender/bake_control_room.py --res 512 --samples 8 # quick test

Same scheme as build.py, with three light groups instead of moon and lamp:

    light_ceiling.png  irradiance from the ceiling panels, clock and the
                       platform's lamps outside the window
    light_screens.png  irradiance from the desk monitors and the video wall
    light_sky.png      irradiance from a plain white sky (radiance 1), which
                       the browser tints with the live sky (outdoor.js)
    board_*.png        what is pinned and written on the whiteboards, drawn
                       by boards.py; too fine for the atlas, so each board
                       surface has a second UV set onto its own image

so the browser can dim the room for the night shift and let the screens
carry it. Everything that glows (screens, panels, clock, platform lights,
flare) is left out of the bake and exported as separate meshes named
Emit<Group>; meta.json gives each one's colour and strength. The platform is
split back out of the room as "Outside", so the browser can add sunlight to
it. The sea only shades the bake; the browser draws its own.

Outputs go to web/public/control/.
"""
import argparse
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import control_room as cr  # noqa: E402
from mathutils import Matrix  # noqa: E402

bpy = b.bpy
OUT = os.path.join(b.ROOT, "web", "public", "control")

# Emissive materials, grouped by which light map they feed
GROUPS = {
    "Screen": "screens", "ScreenCam": "screens", "ExitSign": "screens",  # the exit sign never goes off
    "LedPanel": "ceiling", "Clock": "ceiling", "PlatformLight": "ceiling", "Flare": "ceiling",
    "PlatformWindow": "ceiling", "PlatformRed": "ceiling",
}


def texel_weight(name):
    """Atlas share per object: what the operator sees up close gets the most."""
    if name == "Sea":
        return 1e-6  # 800 m across: by area alone it would take the whole atlas
    if name.startswith(("Plat", "Flare")):
        return 0.006  # only the culled shell outside the window is left; seen through glass, 5+ m away
    if name in ("WallRear",):
        return 0.08
    if name in ("Ceiling", "CeilingNook") or name.startswith(("AirCassette", "WallNook", "Bulkhead")):
        return 0.2   # looked at more than expected: smudges show around the panels
    if name.startswith(("Sofa", "CoffeeTable", "Kitchenette", "PlantNook", "FloorNook")):
        return 0.15  # the rest corner, only seen from its doorway or up close
    if name.startswith(("Wall", "Floor", "Mullion", "Transom", "Link", "Meeting", "Glass", "Nook", "Pillar")):
        return 0.2
    if name.startswith("Whiteboard"):
        return 2.0   # flat and bright, thin frames: light-map noise shows on them
    if name.startswith("S") and name[1:2].isdigit():
        return 3.0   # desk props
    if name.startswith("Desk") and "Mon" not in name:
        return 1.0
    return 0.5       # monitors, chairs, posts


def emissive(obj):
    return obj.type == "MESH" and obj.data.materials and obj.data.materials[0].name in GROUPS


def strength(mat):
    return mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]


# The viewer draws live content for every screen into one canvas (see
# web/src/screens.js). Each screen gets a slot in it, in pixels, and its UVs
# map its face onto that slot. Wall and link screens are 16:9, desk monitors
# about 5:3; together they fill a 2048² canvas.
SCREEN_CANVAS = 2048
WALL_SLOT, DESK_SLOT = (640, 360), (512, 305)


def screen_slots():
    slots = {}
    big = [f"Wall{i}Screen" for i in range(cr.WALL_N)] + ["LinkScreen", "TvScreen"]
    for k, name in enumerate(big):
        slots[name] = ((k % 3) * WALL_SLOT[0], (k // 3) * WALL_SLOT[1]) + WALL_SLOT
    y0 = 3 * WALL_SLOT[1] + 3
    desk = [f"Desk{d}Mon{i}Screen" for d in range(len(cr.DESKS)) for i in range(6)]
    for k, name in enumerate(desk):
        slots[name] = ((k % 4) * DESK_SLOT[0], y0 + (k // 4) * DESK_SLOT[1]) + DESK_SLOT
    return slots


def screen_uvs(scene):
    """Give each screen mesh one UV layer that maps its face onto its slot."""
    slots = screen_slots()
    for name, (x, y, w, h) in slots.items():
        o = scene.objects[name]
        me = o.data
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        uv = me.uv_layers.new(name="UVMap")
        xs = [v.co.x for v in me.vertices]
        zs = [v.co.z for v in me.vertices]
        # Screens face local -Y; the link screen faces the other way round the room
        flip = name == "LinkScreen"
        for loop in me.loops:
            co = me.vertices[loop.vertex_index].co
            u = (co.x - min(xs)) / (max(xs) - min(xs))
            v = (co.z - min(zs)) / (max(zs) - min(zs))
            if flip:
                u = 1 - u
            # glTF UVs start top left, the canvas too
            uv.data[loop.index].uv = ((x + u * w) / SCREEN_CANVAS, 1 - (y + (1 - v) * h) / SCREEN_CANVAS)
    return {"canvas": SCREEN_CANVAS, "slots": {n: list(s) for n, s in slots.items()}}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--res", type=int, default=2048)
    p.add_argument("--samples", type=int, default=128)
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
    cr.build_boards(m)
    cr.build_rear(m)
    cr.build_lounge(m)
    cr.build_ceiling_mics(m)
    cr.build_outside(m)
    # A plain white sky, baked on its own. The live sky's colour and
    # brightness multiply it in the browser.
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    sky = world.node_tree.nodes["Background"].inputs
    sky["Color"].default_value = (1, 1, 1, 1)
    sky["Strength"].default_value = 1.0
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
            movable[o.name] = (o.matrix_world.translation.copy(), o.matrix_world.to_euler().z)
            o.vertex_groups.new(name=o.name).add(range(len(o.data.vertices)), 1.0, "REPLACE")
            if o.name.endswith("Mug"):  # the coffee drops as it's drunk, so it moves on its own
                slot = [i for i, mt in enumerate(o.data.materials) if mt.name == "PropCoffee"][0]
                vs = {v for f in o.data.polygons if f.material_index == slot for v in f.vertices}
                coffee = o.name[:-3] + "Coffee"
                o.vertex_groups.new(name=coffee).add(list(vs), 1.0, "REPLACE")
                movable[coffee] = movable[o.name]

    # The platform outside: found again after the join, to split it back out
    outside = [o for o in scene.objects if o.type == "MESH" and o.name.startswith(("Plat", "Flare")) and not emissive(o)]
    for o in outside:
        o.vertex_groups.new(name="Outside").add(range(len(o.data.vertices)), 1.0, "REPLACE")

    # Whiteboard surfaces are baked with the room too, but the atlas is far
    # too coarse for their writing: they are split out afterwards and get a
    # second UV set for a texture of their own. Remember each one's frame.
    boards = {}
    for name, (draw, size, *_) in cr.BOARDS.items():
        o = scene.objects[f"Whiteboard{name}Face"]
        boards[o.name] = (o.matrix_world.inverted(), size, draw)
        o.vertex_groups.new(name=o.name).add(range(len(o.data.vertices)), 1.0, "REPLACE")

    glowing = [o for o in scene.objects if emissive(o)]
    b.texel_weight = texel_weight  # unwrap_weighted() looks it up by name
    sea = scene.objects["Sea"]  # shades the bake, but is not exported
    room = b.join_static(glowing + [sea])
    print(f"room: {len(room.data.polygons)} faces, {len(glowing)} emissive meshes", flush=True)

    imgs = {k: bpy.data.images.new(k, args.res, args.res, float_buffer=True, alpha=False)
            for k in ("albedo", "ceiling", "screens", "sky")}
    mats = {mat.name: mat for o in glowing for mat in o.data.materials}
    full = {name: strength(mat).default_value for name, mat in mats.items()}
    sky_full = sky["Strength"].default_value

    def only(group):
        for name, mat in mats.items():
            strength(mat).default_value = full[name] if GROUPS[name] == group else 0.0
        sky["Strength"].default_value = sky_full if group == "sky" else 0.0

    print(f"baking {args.res}x{args.res} atlases, {args.samples} samples", flush=True)
    scene.cycles.samples = 1
    b.bake(room, imgs["albedo"], {"COLOR"}, "albedo")
    scene.cycles.samples = args.samples
    only("ceiling")
    b.bake(room, imgs["ceiling"], {"DIRECT", "INDIRECT"}, "ceiling")
    only("screens")
    b.bake(room, imgs["screens"], {"DIRECT", "INDIRECT"}, "screens")
    only("sky")
    b.bake(room, imgs["sky"], {"DIRECT", "INDIRECT"}, "sky")
    only(None)
    bpy.data.objects.remove(sea)

    b.save_albedo(b.pixels(imgs["albedo"]), os.path.join(OUT, "albedo.png"))
    meta = {
        "scaleCeiling": b.save_light(b.pixels(b.denoise(imgs["ceiling"])), os.path.join(OUT, "light_ceiling.png")),
        "scaleScreens": b.save_light(b.pixels(b.denoise(imgs["screens"])), os.path.join(OUT, "light_screens.png")),
        "scaleSky": b.save_light(b.pixels(b.denoise(imgs["sky"])), os.path.join(OUT, "light_sky.png")),
        "seaLevel": round(-cr.PLATFORM_OFFSET.z, 3),  # in the room's frame, m
        "encoding": "L = pow(texel, 3) * scale",
        "resolution": args.res,
        "samples": args.samples,
        "emitters": {},
    }

    # Split the movable objects back out, each with its origin where it stands
    coffees = sorted(n for n in movable if n.endswith("Coffee"))
    for name in coffees + sorted(n for n in movable if n not in coffees) + sorted(boards):
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
        scene.cursor.location = movable[name][0] if name in movable else boards[name][0].inverted().translation
        bpy.ops.object.select_all(action="DESELECT")
        part.select_set(True)
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        if name in movable:  # and its turn, so its own frame faces the way it was placed
            yaw = movable[name][1]
            part.data.transform(Matrix.Rotation(-yaw, 4, "Z"))
            part.rotation_euler.z = yaw
    # The platform, with its origin left at the room's
    if outside:
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = room
        room.select_set(True)
        room.vertex_groups.active_index = room.vertex_groups["Outside"].index
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.vertex_group_select()
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        part = [o for o in bpy.context.selected_objects if o is not room][0]
        part.name = part.data.name = "Outside"
        part.vertex_groups.clear()
    for o in [room] + [scene.objects[n] for n in [*movable, *boards]]:
        o.vertex_groups.clear()

    # Board UVs: the face's own x across and z up, 0-1 over the writing
    # surface (the glTF exporter flips V, so the PNG's top row lands on top)
    meta["boards"] = {}
    for name, (to_local, (w, h), draw) in boards.items():
        o = scene.objects[name]
        uv = o.data.uv_layers.new(name="BoardUV")
        turn = to_local.to_3x3() @ o.matrix_world.to_3x3()
        for f in o.data.polygons:
            front = (turn @ f.normal).y < -0.5  # the writing faces -Y
            for li in f.loop_indices:
                if not front:  # back and edges: the blank corner, not the writing mirrored
                    uv.data[li].uv = (0.002, 0.998)
                    continue
                p = to_local @ (o.matrix_world @ o.data.vertices[o.data.loops[li].vertex_index].co)
                uv.data[li].uv = (p.x / w + 0.5, 0.5 + p.z / h)
        png = "board_" + name[len("Whiteboard"):-len("Face")].lower() + ".png"
        shutil.copy(draw(), os.path.join(OUT, png))
        meta["boards"][name] = png

    # Floor plan for the first-person walk: what the player can't walk through
    # (Blender X/Y in metres; the viewer converts to its own axes)
    step = (cr.WALL_W + 0.03) / cr.WALL_R
    meta["layout"] = {
        "desks": [round(d, 5) for d in cr.DESKS], "deskHalf": round(cr.DESK_HALF, 5),
        "rFront": cr.R_FRONT, "bayDepth": cr.BAY_DEPTH, "rBack": cr.R_BACK,
        "wallR": cr.WALL_R, "wallHalf": round(cr.WALL_N / 2 * step, 5),
        "tv": [round(cr.TV_A, 5), round(cr.TV_W / 2 / cr.WALL_R, 5), cr.TV_TOP - cr.TV_H],  # angle, half-width, bottom
        "room": [-cr.ROOM_X, cr.ROOM_Y0, cr.ROOM_X, cr.ROOM_Y1],
        "table": list(cr.TABLE),  # centre and radii of the meeting table
        "nook": [cr.NOOK_X0, cr.NOOK_Y0, cr.ROOM_X, cr.ROOM_Y0],  # the rest corner behind the rear wall
        "nookDoor": list(cr.NOOK_DOOR),  # the opening into it, an x range in the rear wall
        "boxes": [[round(v, 4) for v in o] for o in cr.obstacles()],  # centre x, y, half sizes, yaw
        "deskZ": cr.DESK_Z,
        "window": [-cr.ROOM_X, cr.WIN_Y0, cr.WIN_Y1, cr.WIN_Z0, cr.WIN_Z1],  # x of the wall, y range, z range
    }
    meta["movable"] = sorted(movable)

    meta["screens"] = screen_uvs(scene)

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
