"""
Build the desk scene from scratch, bake its lighting with Cycles, and export
everything the web viewer needs.

    python blender/build.py                      # defaults
    python blender/build.py --res 2048 --samples 512 --reference

Outputs (web/public/scene/):
    scene.glb          geometry + camera, one UV set shared by all atlases
    albedo.png         surface color, no light (sRGB)
    light_ambient.png  irradiance from moon + sky only   (encoded, see meta)
    light_lamp.png     irradiance from the desk lamp only (encoded, see meta)
    meta.json          decode scales for the light maps
    reference.png      (optional) full Cycles render, lamp on, for QA diffs

Light transport is linear, so ambient + lamp maps add up exactly to the
"everything on" solution. The browser blends them with per-frame weights.
"""
import argparse
import json
import math
import os
import sys
import time

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "public", "scene")
BUILD = os.path.join(ROOT, "blender", "build")

# Room extents (metres, Blender is Z-up)
RX, RY, RZ = 2.0, 2.0, 2.6
WIN_X, WIN_Z0, WIN_Z1, WALL_T = 0.55, 1.0, 1.95, 0.15

LAMP_POS = Vector((0.25, 1.62, 1.10))  # inside the shade, pointing down

# Newton's cradle on the desk, under the lamp. Its frame is baked with the
# room; the balls swing, so they stay separate and the browser lights them.
TOY_POS = Vector((0.20, 1.71, 0.75))
TOY_YAW = math.radians(-20)
TOY_BALLS, TOY_R = 5, 0.0125
TOY_RAIL_Z, TOY_BALL_Z, TOY_HALF_Y = 0.15, 0.04, 0.04  # local, above the base top


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--res", type=int, default=1024, help="atlas resolution")
    p.add_argument("--samples", type=int, default=256, help="Cycles samples per light bake")
    p.add_argument("--reference", action="store_true", help="also render a Cycles reference still")
    p.add_argument("--ref-samples", type=int, default=64, help="samples for the reference render (it is denoised)")
    p.add_argument("--device", choices=["auto", "cpu", "optix", "cuda", "metal", "hip"], default="auto",
                   help="Cycles device; auto tries OptiX, CUDA, Metal, HIP, then falls back to CPU")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    return p.parse_args(argv)


# ---------------------------------------------------------------- materials

def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    return m, nt, bsdf


def mat_flat(name, color, rough=0.6):
    m, _, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def mat_metal(name, color, rough=0.2):
    m, _, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = rough
    return m


def _ramp(nt, fac_socket, c0, c1):
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*c0, 1)
    ramp.color_ramp.elements[1].color = (*c1, 1)
    nt.links.new(fac_socket, ramp.inputs["Fac"])
    return ramp


def mat_wood(name, dark, light, scale=4.0):
    """Wave bands distorted by noise: the classic procedural grain."""
    m, nt, bsdf = _new_mat(name)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = scale
    wave.inputs["Distortion"].default_value = 8.0
    wave.inputs["Detail"].default_value = 4.0
    wave.bands_direction = "X"
    nt.links.new(geo.outputs["Position"], wave.inputs["Vector"])
    ramp = _ramp(nt, wave.outputs["Fac"], dark, light)
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.45
    return m


def mat_planks(name, c0, c1):
    """Floorboards: a brick texture with long thin bricks and dark gaps."""
    m, nt, bsdf = _new_mat(name)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.inputs["Color1"].default_value = (*c0, 1)
    brick.inputs["Color2"].default_value = (*c1, 1)
    brick.inputs["Mortar"].default_value = (0.03, 0.02, 0.015, 1)
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = 0.004
    brick.inputs["Brick Width"].default_value = 1.2
    brick.inputs["Row Height"].default_value = 0.14
    brick.offset = 0.37
    nt.links.new(geo.outputs["Position"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.5
    return m


def mat_plaster(name, c0, c1):
    m, nt, bsdf = _new_mat(name)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 8.0
    nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
    ramp = _ramp(nt, noise.outputs["Fac"], c0, c1)
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


# ----------------------------------------------------------------- geometry

def _link(obj, mat):
    obj.data.materials.append(mat)
    return obj


def box(name, size, center, mat, rot_z=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=(0, 0, rot_z))
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    return _link(o, mat)


def cylinder(name, r, h, center, mat, verts=32):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=center, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    return _link(o, mat)


def quad(name, verts, mat, facing):
    """A single quad whose normal is flipped to face `facing` (a point)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    f = bm.faces.new(vs)
    bm.normal_update()
    centre = sum((Vector(v) for v in verts), Vector()) / 4
    if f.normal.dot(Vector(facing) - centre) < 0:
        f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return _link(o, mat)


def rect_yz_wall(name, x, y0, y1, z0, z1, mat):
    return quad(name, [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat, (0, 0, RZ / 2))


def rect_xz_wall(name, y, x0, x1, z0, z1, mat, facing=(0, 0, RZ / 2)):
    return quad(name, [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat, facing)


def build_room():
    wall = mat_plaster("Wall", (0.42, 0.47, 0.38), (0.50, 0.54, 0.45))   # muted sage
    ceiling = mat_plaster("Ceiling", (0.70, 0.68, 0.62), (0.78, 0.76, 0.70))
    floor = mat_planks("Floor", (0.20, 0.11, 0.06), (0.26, 0.15, 0.08))
    frame = mat_flat("WindowFrame", (0.75, 0.73, 0.68), 0.5)
    desk_wood = mat_wood("DeskWood", (0.16, 0.08, 0.04), (0.32, 0.18, 0.09))
    lamp_enamel = mat_flat("LampEnamel", (0.04, 0.16, 0.10), 0.35)
    brass = mat_flat("LampBrass", (0.45, 0.33, 0.12), 0.35)
    book_red = mat_flat("BookRed", (0.45, 0.06, 0.05), 0.7)
    book_blue = mat_flat("BookBlue", (0.06, 0.12, 0.35), 0.7)
    paper = mat_flat("Paper", (0.80, 0.79, 0.74), 0.9)
    mug = mat_flat("Mug", (0.75, 0.70, 0.58), 0.3)

    c = (0, 0, RZ / 2)
    quad("Floor", [(-RX, -RY, 0), (RX, -RY, 0), (RX, RY, 0), (-RX, RY, 0)], floor, c)
    quad("Ceiling", [(-RX, -RY, RZ), (RX, -RY, RZ), (RX, RY, RZ), (-RX, RY, RZ)], ceiling, c)
    rect_yz_wall("WallL", -RX, -RY, RY, 0, RZ, wall)
    rect_yz_wall("WallR", RX, -RY, RY, 0, RZ, wall)
    rect_xz_wall("WallFront", -RY, -RX, RX, 0, RZ, wall)

    # Back wall with a window hole
    rect_xz_wall("WallBackL", RY, -RX, -WIN_X, 0, RZ, wall)
    rect_xz_wall("WallBackR", RY, WIN_X, RX, 0, RZ, wall)
    rect_xz_wall("WallBackB", RY, -WIN_X, WIN_X, 0, WIN_Z0, wall)
    rect_xz_wall("WallBackT", RY, -WIN_X, WIN_X, WIN_Z1, RZ, wall)
    # Window reveal (the wall's thickness), facing into the opening
    y0, y1 = RY, RY + WALL_T
    hole_c = (0, RY, (WIN_Z0 + WIN_Z1) / 2)
    quad("RevealL", [(-WIN_X, y0, WIN_Z0), (-WIN_X, y1, WIN_Z0), (-WIN_X, y1, WIN_Z1), (-WIN_X, y0, WIN_Z1)], wall, hole_c)
    quad("RevealR", [(WIN_X, y0, WIN_Z0), (WIN_X, y1, WIN_Z0), (WIN_X, y1, WIN_Z1), (WIN_X, y0, WIN_Z1)], wall, hole_c)
    quad("RevealT", [(-WIN_X, y0, WIN_Z1), (WIN_X, y0, WIN_Z1), (WIN_X, y1, WIN_Z1), (-WIN_X, y1, WIN_Z1)], wall, hole_c)
    # Sill, mullions
    box("Sill", (1.3, 0.22, 0.03), (0, RY + 0.02, WIN_Z0 - 0.015), frame)
    box("MullionV", (0.04, 0.04, WIN_Z1 - WIN_Z0), (0, RY + 0.1, (WIN_Z0 + WIN_Z1) / 2), frame)
    box("MullionH", (2 * WIN_X, 0.04, 0.04), (0, RY + 0.1, 1.47), frame)

    # Desk: top, legs, drawer unit
    top_z = 0.75
    box("DeskTop", (1.4, 0.7, 0.04), (0, 1.6, top_z - 0.02), desk_wood)
    for i, (lx, ly) in enumerate([(-0.66, 1.29), (0.66, 1.29), (-0.66, 1.91), (0.66, 1.91)]):
        box(f"Leg{i}", (0.05, 0.05, top_z - 0.04), (lx, ly, (top_z - 0.04) / 2), desk_wood)
    box("Drawers", (0.4, 0.6, 0.5), (-0.44, 1.6, top_z - 0.04 - 0.25), desk_wood)

    # Things on the desk
    box("BookA", (0.22, 0.30, 0.04), (-0.38, 1.62, top_z + 0.02), book_red, rot_z=0.08)
    box("BookB", (0.20, 0.28, 0.035), (-0.37, 1.63, top_z + 0.0575), book_blue, rot_z=-0.18)
    box("Paper", (0.21, 0.297, 0.002), (-0.02, 1.48, top_z + 0.001), paper, rot_z=0.12)
    cylinder("Mug", 0.04, 0.10, (0.12, 1.42, top_z + 0.05), mug)

    # Lamp: base, stem, arm, shade (hollow, so light only leaves downward)
    lx, ly = 0.45, 1.72
    cylinder("LampBase", 0.08, 0.02, (lx, ly, top_z + 0.01), brass)
    cylinder("LampStem", 0.012, 0.40, (lx, ly, top_z + 0.22), brass, verts=16)
    arm_start, arm_end = Vector((lx, ly, top_z + 0.41)), Vector((LAMP_POS.x, LAMP_POS.y, top_z + 0.41))
    arm = cylinder("LampArm", 0.01, (arm_end - arm_start).length, (arm_start + arm_end) / 2, brass, verts=16)
    arm.rotation_euler = (arm_end - arm_start).to_track_quat("Z", "Y").to_euler()
    bpy.ops.mesh.primitive_cone_add(radius1=0.11, radius2=0.035, depth=0.14, vertices=48,
                                    end_fill_type="NOTHING", location=(LAMP_POS.x, LAMP_POS.y, LAMP_POS.z + 0.04))
    shade = bpy.context.active_object
    shade.name = "LampShade"
    _link(shade, lamp_enamel)
    sol = shade.modifiers.new("thickness", "SOLIDIFY")
    sol.thickness = 0.004
    bpy.context.view_layer.objects.active = shade
    bpy.ops.object.modifier_apply(modifier=sol.name)

    # The bulb stays a separate, unbaked object: the browser lights it live.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=LAMP_POS + Vector((0, 0, 0.0)))
    bulb = bpy.context.active_object
    bulb.name = "Bulb"
    _link(bulb, mat_flat("BulbMat", (1, 0.9, 0.7)))
    bpy.ops.object.shade_smooth()
    return bulb


def build_toy():
    """Newton's cradle: a walnut base, four steel posts, two rails, and five
    chrome balls, each hung from both rails by a V of thread. Returns the
    balls; each one's origin is its pivot on the rail axis, so swinging is a
    rotation about the object's local Y."""
    walnut = mat_wood("ToyWalnut", (0.10, 0.05, 0.025), (0.22, 0.12, 0.06), scale=30.0)
    steel = mat_metal("ToySteel", (0.62, 0.62, 0.64), 0.3)
    chrome = mat_metal("ToyChrome", (0.92, 0.92, 0.94), 0.06)
    thread = mat_flat("ToyThread", (0.85, 0.84, 0.80), 0.8)

    place = Matrix.Translation(TOY_POS) @ Matrix.Rotation(TOY_YAW, 4, "Z")
    base_h, half_x = 0.015, 0.085

    def put(o):
        bpy.context.view_layer.update()  # matrix_world lags behind rotation_euler
        o.matrix_world = place @ o.matrix_world
        return o

    put(box("ToyBase", (0.20, 0.11, base_h), (0, 0, base_h / 2), walnut))
    top = base_h + TOY_RAIL_Z
    for i, (px, py) in enumerate([(-half_x, -TOY_HALF_Y), (half_x, -TOY_HALF_Y),
                                  (-half_x, TOY_HALF_Y), (half_x, TOY_HALF_Y)]):
        put(cylinder(f"ToyPost{i}", 0.0028, TOY_RAIL_Z, (px, py, base_h + TOY_RAIL_Z / 2), steel, verts=12))
    for i, py in enumerate((-TOY_HALF_Y, TOY_HALF_Y)):
        rail = cylinder(f"ToyRail{i}", 0.0028, 2 * half_x, (0, py, top), steel, verts=12)
        rail.rotation_euler = (0, math.pi / 2, 0)
        put(rail)

    balls = []
    pitch = 2 * TOY_R + 0.0003
    ball_z = base_h + TOY_BALL_Z
    for i in range(TOY_BALLS):
        x = (i - (TOY_BALLS - 1) / 2) * pitch
        parts = []
        bpy.ops.mesh.primitive_uv_sphere_add(radius=TOY_R, segments=32, ring_count=16, location=(x, 0, ball_z))
        bpy.ops.object.shade_smooth()
        parts.append(_link(bpy.context.active_object, chrome))
        hook = Vector((x, 0, ball_z + TOY_R * 0.95))
        for py in (-TOY_HALF_Y, TOY_HALF_Y):
            a, b = hook, Vector((x, py, top))
            s_ = cylinder("thread", 0.0006, (b - a).length, (a + b) / 2, thread, verts=6)
            s_.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
            parts.append(s_)
        bpy.ops.object.select_all(action="DESELECT")
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.join()
        ball = bpy.context.active_object
        ball.name = f"Ball{i}"
        # Pivot on the line between the two rails, straight above the ball
        pivot = Vector((x, 0, top))
        ball.data.transform(Matrix.Translation(-pivot))
        ball.location = place @ pivot
        ball.rotation_euler = (0, 0, TOY_YAW)
        balls.append(ball)
    return balls


def swing(balls, angles):
    """Pose the cradle: one angle (radians) per ball, positive swings toward +X."""
    for ball, a in zip(balls, angles):
        ball.rotation_euler = (0, -a, TOY_YAW)


def build_lights():
    # Moon: a low, cool sun shining in through the window
    d = Vector((0.25, -1.0, -0.75)).normalized()
    sun_data = bpy.data.lights.new("Moon", "SUN")
    sun_data.energy = 2.2
    sun_data.color = (0.55, 0.66, 1.0)
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("Moon", sun_data)
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(sun)

    # Night sky: only reaches the room through the window
    world = bpy.data.worlds.new("Night")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.03, 0.045, 0.10, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world

    # Desk lamp: a warm spot inside the shade
    spot_data = bpy.data.lights.new("Lamp", "SPOT")
    spot_data.energy = 75.0
    spot_data.color = (1.0, 0.72, 0.42)
    spot_data.spot_size = math.radians(120)
    spot_data.spot_blend = 0.5
    spot_data.shadow_soft_size = 0.02
    spot = bpy.data.objects.new("Lamp", spot_data)
    spot.location = LAMP_POS
    bpy.context.collection.objects.link(spot)  # points down (-Z) by default
    return sun, world, spot


def build_camera():
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 22
    cam = bpy.data.objects.new("Camera", cam_data)
    cam.location = (1.25, -0.55, 1.45)
    cam.rotation_euler = (Vector((-0.05, 1.65, 0.92)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


# --------------------------------------------------------------------- bake

def texel_weight(name):
    """Relative texel density per object. The camera never sees the front
    wall and barely sees the ceiling, while the desk is the whole point, so
    spend atlas pixels accordingly."""
    if name == "WallFront":
        return 0.03
    if name == "Ceiling":
        return 0.08
    if name.startswith(("Wall", "Floor", "Reveal")):
        return 0.25
    if name.startswith(("Desk", "Lamp", "Book", "Paper", "Mug")):
        return 2.0
    return 1.0


def unwrap_weighted(objs):
    """Unwrap each object separately, rescale its UVs so atlas area is
    proportional to (world area x weight), then join and pack everything
    into one non-overlapping atlas (required for baking)."""
    for o in objs:
        me = o.data
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name="UVMap")
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
        uv = bm.loops.layers.uv.active
        world_area = sum(f.calc_area() for f in bm.faces)
        uv_area = 0.0
        for f in bm.faces:
            pts = [l[uv].uv for l in f.loops]
            uv_area += 0.5 * abs(sum(pts[i].x * pts[i - 1].y - pts[i - 1].x * pts[i].y for i in range(len(pts))))
        s = math.sqrt(world_area * texel_weight(o.name) / max(uv_area, 1e-9))
        for f in bm.faces:
            for l in f.loops:
                l[uv].uv *= s
        bm.transform(o.matrix_world.inverted())
        bm.to_mesh(me)
        bm.free()


def join_static(bulb):
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not bulb]
    unwrap_weighted(meshes)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    room = bpy.context.active_object
    room.name = "Room"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.006, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    return room


def bake(room, image, pass_filter, label):
    """Point every material's active image node at `image`, then bake into it."""
    for mat in room.data.materials:
        nodes = mat.node_tree.nodes
        node = nodes.get("BakeTarget") or nodes.new("ShaderNodeTexImage")
        node.name = "BakeTarget"
        node.image = image
        nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    room.select_set(True)
    bpy.context.view_layer.objects.active = room
    t = time.time()
    bpy.ops.object.bake(type="DIFFUSE", pass_filter=pass_filter, use_clear=True,
                        margin=12, margin_type="EXTEND")
    print(f"  baked {label:8s} in {time.time() - t:5.1f}s", flush=True)


def pixels(image):
    res = image.size[0]
    a = np.empty(res * res * 4, np.float32)
    image.pixels.foreach_get(a)
    return np.flipud(a.reshape(res, res, 4)[:, :, :3])  # Blender is bottom-up


def denoise(image):
    """Run Intel OpenImageDenoise (Blender's Denoise compositor node) on a
    baked image. Bakes don't get Cycles' built-in denoiser, so we route the
    image through a throwaway scene whose only job is compositing."""
    res = image.size[0]
    sc = bpy.data.scenes.get("Denoise") or bpy.data.scenes.new("Denoise")
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.filepath = os.path.join(BUILD, f"{image.name}_denoised.exr")

    ng = bpy.data.node_groups.new("Denoise", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    src = ng.nodes.new("CompositorNodeImage")
    src.image = image
    dn = ng.nodes.new("CompositorNodeDenoise")
    dn.inputs["HDR"].default_value = True
    out = ng.nodes.new("NodeGroupOutput")
    ng.links.new(src.outputs["Image"], dn.inputs["Image"])
    ng.links.new(dn.outputs["Image"], out.inputs[0])
    sc.compositing_node_group = ng

    bpy.ops.render.render(write_still=True, scene=sc.name)
    result = bpy.data.images.load(sc.render.filepath, check_existing=False)
    bpy.data.node_groups.remove(ng)
    return result


def save_light(light, path):
    """HDR irradiance -> 8-bit PNG. Stored = (L / scale)^(1/3), so the
    shader decodes with pow(texel, 3) * scale. Cube-root encoding spends
    more of the 256 levels on dark values, where banding is most visible."""
    scale = float(np.percentile(light.max(axis=2), 99.8)) or 1.0
    enc = np.clip(light / scale, 0, 1) ** (1 / 3)
    Image.fromarray((enc * 255 + 0.5).astype(np.uint8)).save(path, optimize=True)
    return scale


def save_albedo(rgb, path):
    c = np.clip(rgb, 0, 1)
    srgb = np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    Image.fromarray((srgb * 255 + 0.5).astype(np.uint8)).save(path, optimize=True)


def pick_device(choice):
    """Enable the fastest GPU backend available and return the scene device.
    An RTX card uses OptiX; Apple Silicon uses Metal; no GPU means CPU."""
    if choice == "cpu":
        print("device: CPU", flush=True)
        return "CPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    backends = ["OPTIX", "CUDA", "METAL", "HIP"] if choice == "auto" else [choice.upper()]
    for backend in backends:
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue  # backend not compiled into this build
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == backend
            print(f"device: {backend} ({', '.join(d.name for d in gpus)})", flush=True)
            return "GPU"
    print("device: CPU (no supported GPU found)", flush=True)
    return "CPU"


# --------------------------------------------------------------------- main

def main():
    args = parse_args()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    t0 = time.time()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = pick_device(args.device)
    scene.render.bake.use_selected_to_active = False

    print("building scene", flush=True)
    bulb = build_room()
    sun, world, spot = build_lights()
    build_camera()
    room = join_static(bulb)

    # The bulb would occlude the spot inside it, so hide it from the renderer.
    bulb.hide_render = True
    bg = world.node_tree.nodes["Background"].inputs["Strength"]
    res = args.res
    imgs = {k: bpy.data.images.new(k, res, res, float_buffer=True, alpha=False)
            for k in ("albedo", "ambient", "lamp")}

    print(f"baking {res}x{res} atlases, {args.samples} samples", flush=True)
    scene.cycles.samples = 1
    bake(room, imgs["albedo"], {"COLOR"}, "albedo")

    scene.cycles.samples = args.samples
    spot.data.energy, energy_lamp = 0.0, spot.data.energy
    bake(room, imgs["ambient"], {"DIRECT", "INDIRECT"}, "ambient")

    spot.data.energy = energy_lamp
    sun.data.energy, energy_sun = 0.0, sun.data.energy
    bg.default_value, bg_strength = 0.0, bg.default_value
    bake(room, imgs["lamp"], {"DIRECT", "INDIRECT"}, "lamp")

    save_albedo(pixels(imgs["albedo"]), os.path.join(OUT, "albedo.png"))
    meta = {
        "scaleAmbient": save_light(pixels(denoise(imgs["ambient"])), os.path.join(OUT, "light_ambient.png")),
        "scaleLamp": save_light(pixels(denoise(imgs["lamp"])), os.path.join(OUT, "light_lamp.png")),
        "encoding": "L = pow(texel, 3) * scale",
        "resolution": res,
        "samples": args.samples,
    }
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    # Restore everything for the reference render and the saved .blend
    sun.data.energy, bg.default_value = energy_sun, bg_strength

    if args.reference:
        bulb.hide_render = False
        bulb.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 20
        bulb.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1, 0.8, 0.55, 1)
        bulb.visible_shadow = False
        scene.render.resolution_x, scene.render.resolution_y = 1280, 720
        scene.cycles.samples = args.ref_samples
        scene.cycles.use_denoising = True
        scene.render.filepath = os.path.join(OUT, "reference.png")
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"  reference render in {time.time() - t:5.1f}s", flush=True)

    print("exporting", flush=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "scene.glb"), export_format="GLB",
                              export_cameras=True, export_lights=False, export_materials="NONE",
                              export_texcoords=True, export_normals=True, export_apply=True, export_yup=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, "scene.blend"))
    print(f"done in {time.time() - t0:.1f}s -> {OUT}", flush=True)


if __name__ == "__main__":
    main()
