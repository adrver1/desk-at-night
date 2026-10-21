"""
Blockout of an offshore-style control room: two curved operator desks on a
shared semicircle, six monitors on each (3 + 3), and a band of large
displays on posts a step behind them, against a dark wall. Behind the
operators: the meeting table and video-link screen, the hardwired ESD
panel, binders and a pillar, and through an opening at the rear right a
small rest corner with a sofa, a coffee machine and a mini fridge. Laid out
after the reference photos and video (see control-room-game/reference/ in
the project files); the window in the left wall is the one deliberate
liberty.

    python blender/control_room.py                 # clay + night + plan stills
    python blender/control_room.py --samples 16    # faster, noisier

Renders quick Cycles stills only. Nothing is baked: light maps for this room
belong on a GPU. Saves blender/build/control_room.blend for inspection.

Layout: the desks are arcs around the origin, one operator per desk sitting
inside the curve and facing outward. Angles are measured from +Y, positive
toward +X.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import boards  # noqa: E402
import build as b  # noqa: E402  (imports bpy)
import offshore_platform as op  # noqa: E402
import props  # noqa: E402

bpy, bmesh, Vector = b.bpy, b.bmesh, b.Vector
from mathutils import Matrix  # noqa: E402
box, cylinder, mat_flat = b.box, b.cylinder, b.mat_flat

LIGHT_PLANTS = True  # True: the lighter plants, about half the triangles (props.make_plant)
CLOCK_STYLE = "station"  # wall clock in the rest corner: station, office or dark (props.make_wall_clock)

# Desks (metres): two arcs of 80 degrees with a small gap between them
DESK_Z, DESK_T = 0.74, 0.04
DESK_HALF, DESK_GAP = math.radians(40), math.radians(3)
DESKS = [-(DESK_HALF + DESK_GAP / 2), DESK_HALF + DESK_GAP / 2]  # centre angle of each desk
R_BACK = 2.95                         # outer (screen-side) edge
R_FRONT, BAY_DEPTH = 1.95, 0.20       # operator edge at the desk ends, and how far it recedes at the chair
SHELF_R0, SHELF_H = 2.62, 0.07        # raised rail the monitors stand on
LEG_ANGLE = math.radians(26)          # two legs per desk, this far either side of its centre

# Desk monitors: 24" class, white bezels, 3 + 3 per desk with a small gap
MON_R, MON_PITCH, MON_GAP = 2.78, 0.575, 0.10
MON_W, MON_H, MON_D, MON_Z0 = 0.56, 0.36, 0.05, DESK_Z + SHELF_H + 0.10
MON_TILT = math.radians(8)

# Video wall: 65" class displays on posts, 1-1.5 m behind the monitor row
WALL_R, WALL_N = MON_R + 1.25, 7  # one continuous band across both desks
WALL_W, WALL_H, WALL_Z0 = 1.45, 0.83, 1.32
TV_W, TV_H, TV_TOP = 1.24, 0.72, 2.40  # black 55" TV hung beyond the left end of the band
TV_A = -(WALL_N - 1) / 2 * (WALL_W + 0.03) / WALL_R - (WALL_W / 2 + 0.15 + TV_W / 2) / WALL_R  # its centre angle

# Room shell: the control room proper, plus the rest corner behind its
# rear wall at the right, reached through an opening next to the door
ROOM_X, ROOM_Y0, ROOM_Y1, ROOM_Z = 5.4, -3.6, 4.6, 2.9
WIN_Y0, WIN_Y1, WIN_Z0, WIN_Z1 = -2.4, 2.6, 0.85, 2.45  # window in the left (-X) wall
NOOK_X0, NOOK_Y0 = 0.4, -5.6           # rest corner: x from here to ROOM_X, y from here to ROOM_Y0
FLOOR_LAMP = (NOOK_X0 + 2.62, NOOK_Y0 + 0.30)  # at the sofa's right end, Blender x, y
NOOK_DOOR = (3.55, 4.55)               # opening in the rear wall into it (x range)
DOOR_Y, DOOR_W, DOOR_H = ROOM_Y0 + 1.1, 0.95, 2.10  # door in the right wall, near the rear
GLASS_X0 = 2.0                         # behind the display band: dark wall left of this, glass to the right
BULKHEAD = (GLASS_X0, 0.6, 0.38)       # white soffit over the glass: from x, depth, drop; carries the clock

# Behind the operators
TABLE = (2.15, -2.35, 1.0, 0.55)       # meeting table: centre x, y and the two radii of its oval top
LINK = (2.15, ROOM_Y0 + 0.42)          # video-link screen on its floor stand, facing the table
PILLAR = (0.15, -2.55, 0.40)           # concrete column: x, y, side
SHELVING = (1.6, 0.40, 1.80)           # binder shelving on the rear wall: width, depth, height


def polar(r, a, z=0.0):
    return Vector((r * math.sin(a), r * math.cos(a), z))


# ---------------------------------------------------------------- materials

def materials():
    m = {
        "birch": b.mat_wood("Birch", (0.62, 0.48, 0.32), (0.74, 0.60, 0.42), scale=1.5),
        "desk_body": mat_flat("DeskBody", (0.05, 0.05, 0.055), 0.6),
        "shelf": mat_flat("Shelf", (0.10, 0.10, 0.11), 0.5),
        "bezel_white": mat_flat("BezelWhite", (0.78, 0.79, 0.80), 0.4),
        "bezel_black": mat_flat("BezelBlack", (0.02, 0.02, 0.02), 0.4),
        "post": mat_flat("Post", (0.45, 0.46, 0.47), 0.4),
        "chair": mat_flat("Chair", (0.02, 0.02, 0.022), 0.7),
        "plastic": mat_flat("Plastic", (0.03, 0.03, 0.03), 0.5),
        "wall": mat_flat("Wall", (0.62, 0.63, 0.62), 0.85),
        "ceiling": mat_flat("Ceiling", (0.80, 0.80, 0.78), 0.9),
        "frame": mat_flat("Frame", (0.25, 0.26, 0.27), 0.5),
        "table": mat_flat("Table", (0.72, 0.58, 0.40), 0.5),
        "deck": mat_flat("Deck", (0.06, 0.065, 0.07), 0.8),
        "wall_dark": mat_flat("WallDark", (0.035, 0.036, 0.04), 0.9),   # behind the display band
        "glass": mat_flat("Glass", (0.40, 0.46, 0.50), 0.08),          # partitions: opaque stand-in for glass
        "frosted": mat_flat("Frosted", (0.70, 0.73, 0.74), 0.5),       # the frosted band across them
        "sea": mat_flat("SeaMat", (0.005, 0.01, 0.02), 0.08),
    }
    # Dark checkered carpet tiles
    mt, nt, bsdf = b._new_mat("Carpet")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Color1"].default_value = (0.045, 0.045, 0.05, 1)
    chk.inputs["Color2"].default_value = (0.08, 0.08, 0.085, 1)
    chk.inputs["Scale"].default_value = 2.0  # 0.5 m tiles
    nt.links.new(geo.outputs["Position"], chk.inputs["Vector"])
    nt.links.new(chk.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    m["carpet"] = mt
    m["screen"] = screen("Screen", (0.62, 0.70, 0.80), 2.0)       # light-grey HMI graphics
    m["screen_cam"] = screen("ScreenCam", (0.18, 0.26, 0.40), 1.6)  # camera feed, darker
    m["led_panel"] = emissive("LedPanel", (1.0, 0.92, 0.80), 1.5)
    m["clock"] = emissive("Clock", (1.0, 0.05, 0.02), 6.0)
    m["platform_light"] = emissive("PlatformLight", (1.0, 0.75, 0.40), 40.0)
    m["flare"] = emissive("Flare", (1.0, 0.45, 0.10), 80.0)
    m["platform_window"] = emissive("PlatformWindow", (1.0, 0.85, 0.6), 2.5)  # lit cabins in the quarters
    m["platform_red"] = emissive("PlatformRed", (1.0, 0.05, 0.02), 60.0)      # obstruction lights
    m["exit_sign"] = emissive("ExitSign", (0.10, 1.0, 0.30), 4.0)
    # The rest corner's floor lamp, a light the player can switch
    m["floor_lamp_shade"] = emissive("FloorLampShade", (1.0, 0.78, 0.52), 1.2)
    m["floor_lamp_glow"] = emissive("FloorLampGlow", (1.0, 0.74, 0.46), 4.0)
    m["door"] = mat_flat("Door", (0.50, 0.52, 0.53), 0.5)
    return m


def screen(name, color, strength):
    """Stand-in for HMI graphics: panes separated by thin dark lines. Will be
    replaced by live canvas textures in the viewer."""
    m, nt, bsdf = b._new_mat(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.inputs["Color1"].default_value = (*color, 1)
    brick.inputs["Color2"].default_value = tuple(0.85 * c for c in color) + (1,)
    brick.inputs["Mortar"].default_value = (0.08, 0.10, 0.14, 1)
    brick.inputs["Scale"].default_value = 3.0
    brick.inputs["Mortar Size"].default_value = 0.012
    brick.inputs["Brick Width"].default_value = 0.6
    brick.inputs["Row Height"].default_value = 0.3
    nt.links.new(tc.outputs["Generated"], brick.inputs["Vector"])
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    nt.links.new(brick.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.3
    return m


def emissive(name, color, strength):
    m, _, bsdf = b._new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    bsdf.inputs["Emission Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.3
    return m


# --------------------------------------------------------------------- desk

def r_front(a):
    """Operator edge: closest to the centre at the desk ends, receding into a
    bay around the chair so the desk wraps the operator."""
    c = min(DESKS, key=lambda d: abs(a - d))
    return R_FRONT + BAY_DEPTH * math.cos(0.5 * math.pi * min(abs(a - c) / DESK_HALF, 1)) ** 2


def arc_slab(name, r_in, r_out, z0, z1, a0, a1, mat, n=96):
    """A closed slab between two radius functions over [a0, a1]."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        ri, ro = r_in(a), r_out(a)
        rings.append([bm.verts.new(polar(ri, a, z0)), bm.verts.new(polar(ro, a, z0)),
                      bm.verts.new(polar(ro, a, z1)), bm.verts.new(polar(ri, a, z1))])
    for i in range(n):
        p, q = rings[i], rings[i + 1]
        for k in range(4):
            bm.faces.new((p[k], q[k], q[(k + 1) % 4], p[(k + 1) % 4]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return b._link(o, mat)


def build_desk(m):
    const = lambda r: (lambda a: r)  # noqa: E731
    for k, c in enumerate(DESKS):
        a0, a1 = c - DESK_HALF, c + DESK_HALF
        arc_slab(f"Desk{k}Top", r_front, const(R_BACK), DESK_Z - DESK_T, DESK_Z, a0, a1, m["birch"])
        arc_slab(f"Desk{k}Shelf", const(SHELF_R0), const(R_BACK - 0.02), DESK_Z, DESK_Z + SHELF_H,
                 a0 + 0.01, a1 - 0.01, m["shelf"])
        # Cable spine under the back edge, carried by two T-legs
        arc_slab(f"Desk{k}Spine", const(R_BACK - 0.30), const(R_BACK - 0.10), 0.50, DESK_Z - DESK_T,
                 a0 + 0.05, a1 - 0.05, m["desk_body"])
        for s in (-1, 1):
            a = c + s * LEG_ANGLE
            r = R_BACK - 0.35
            box(f"Desk{k}Leg{s:+d}", (0.12, 0.12, DESK_Z - DESK_T), polar(r, a, (DESK_Z - DESK_T) / 2), m["post"], rot_z=-a)
            box(f"Desk{k}Foot{s:+d}", (0.08, 0.75, 0.04), polar(r - 0.05, a, 0.02), m["post"], rot_z=-a)
            box(f"Desk{k}Arm{s:+d}", (0.08, 0.70, 0.04), polar(r - 0.10, a, DESK_Z - DESK_T - 0.02), m["post"], rot_z=-a)


def monitor(name, pos, a, m, screen_mat):
    """Desk monitor on a short stand, its screen facing the centre."""
    w, h, d = MON_W, MON_H, MON_D
    parts = [
        box(name + "Bezel", (w, d, h), (0, 0, 0), m["bezel_white"]),
        b.quad(name + "Screen", [(-w / 2 + 0.02, -d / 2 - 0.001, -h / 2 + 0.03), (w / 2 - 0.02, -d / 2 - 0.001, -h / 2 + 0.03),
                                 (w / 2 - 0.02, -d / 2 - 0.001, h / 2 - 0.02), (-w / 2 + 0.02, -d / 2 - 0.001, h / 2 - 0.02)],
               screen_mat, (0, -1, 0)),
    ]
    parent = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(parent)
    for p in parts:
        p.parent = parent
    parent.location = pos
    parent.rotation_euler = (-MON_TILT, 0, -a)
    # Stand: a foot on the shelf, a neck up the back, and a mounting block
    # bolted to the back of the (tilted) monitor
    top = DESK_Z + SHELF_H
    neck_h = pos.z - top
    flat_pos = Vector((pos.x, pos.y, 0))
    box(name + "Foot", (0.22, 0.16, 0.012), flat_pos + polar(0.02, a, top + 0.006), m["bezel_white"], rot_z=-a)
    box(name + "Neck", (0.06, 0.035, neck_h), flat_pos + polar(0.055, a, top + neck_h / 2), m["bezel_white"], rot_z=-a)
    box(name + "Mount", (0.10, 0.03, 0.10), flat_pos + polar(0.035, a, pos.z), m["bezel_white"], rot_z=-a)
    return parent


def build_monitors(m):
    n = 0
    for k, c in enumerate(DESKS):
        for i in range(6):
            s = (i - 2.5) * MON_PITCH + (MON_GAP / 2 if i >= 3 else -MON_GAP / 2)  # arc length from centre
            a = c + s / MON_R
            monitor(f"Desk{k}Mon{i}", polar(MON_R, a, MON_Z0 + MON_H / 2), a, m, m["screen"])
            n += 1
    return n


def build_video_wall(m):
    step = (WALL_W + 0.03) / WALL_R
    for i in range(WALL_N):
        a = (i - (WALL_N - 1) / 2) * step
        c = polar(WALL_R, a, WALL_Z0 + WALL_H / 2)
        box(f"Wall{i}Bezel", (WALL_W, 0.06, WALL_H), c, m["bezel_black"], rot_z=-a)
        mat = m["screen_cam"] if i == 0 else m["screen"]  # leftmost shows a camera feed
        box(f"Wall{i}Screen", (WALL_W - 0.03, 0.002, WALL_H - 0.03), c - polar(0.031, a), mat, rot_z=-a)
        # Wide grey posts behind every other seam, each carrying the two
        # displays either side of it (and one at the right-hand end)
        if i % 2 == 0 or i == WALL_N - 1:
            pa = a + step / 2 if i < WALL_N - 1 else a + (WALL_W / 2 - 0.12) / WALL_R
            p = polar(WALL_R + 0.08, pa, (WALL_Z0 + WALL_H + 0.05) / 2)
            box(f"Wall{i}Post", (0.18, 0.09, WALL_Z0 + WALL_H + 0.05), p, m["post"], rot_z=-pa)
    # Beyond the leftmost display, a black TV hangs from the ceiling with a
    # PTZ conference camera on its own pole just in front of it
    pm = props.materials()
    a = TV_A
    p = polar(WALL_R, a, ROOM_Z)
    props.place(props.make_ceiling_tv(pm, "RearTv", (TV_W, TV_H), ROOM_Z - TV_TOP), p.x, p.y, p.z, -a)
    # Its picture is a screen like the others, just in front of the dark glass
    box("TvScreen", (TV_W - 0.03, 0.002, TV_H - 0.03), polar(WALL_R - 0.0185, a, TV_TOP - TV_H / 2), m["screen_cam"], rot_z=-a)
    p = polar(WALL_R - 0.12, a, ROOM_Z)
    props.place(props.make_ptz_camera(pm, "PtzCameraWall", ROOM_Z - TV_TOP - 0.20), p.x, p.y, p.z, -a)
    # Red digital clock on the white bulkhead over the right part of the band
    bx, depth, drop = BULKHEAD
    box("ClockCase", (0.46, 0.04, 0.15), (bx + 1.1, ROOM_Y1 - depth - 0.02, ROOM_Z - drop / 2), m["bezel_black"])
    box("Clock", (0.40, 0.005, 0.10), (bx + 1.1, ROOM_Y1 - depth - 0.043, ROOM_Z - drop / 2), m["clock"])


# Per station, in the operator's frame: x to their right, y away from them
# (toward the monitors), measured from the desk edge at the chair. The second
# station mirrors the first so the two desks don't look copy-pasted.
STATION_PROPS = [  # (maker, x, y, yaw in degrees, z above the desk)
    (props.make_keyboard, 0.00, 0.17, 0, 0.0),
    (props.make_mousepad, 0.42, 0.17, 0, 0.0),
    (props.make_mouse, 0.43, 0.16, -8, 0.0),
    (props.make_mic, -0.30, 0.36, 12, 0.0),
    (props.make_notepad, -0.58, 0.16, 14, 0.0),
    (props.make_pencil, -0.57, 0.15, 40, 0.0089),  # lies on the pad
    (props.make_mug, 0.68, 0.30, 30, 0.0),
]


def build_desk_props(m):
    """Keyboard, mouse, PA mic, notepad, pencil and mug at each station, plus
    the desk phone and touch panel."""
    pm = props.materials()
    for k, a in enumerate(DESKS):
        flip = -1 if k else 1
        edge = polar(r_front(a), a, DESK_Z)
        right, ahead = Vector((math.cos(a), -math.sin(a), 0)), Vector((math.sin(a), math.cos(a), 0))
        for make, x, y, yaw, dz in STATION_PROPS:
            if make is not props.make_keyboard and make is not props.make_mousepad and make is not props.make_mouse:
                x = flip * x  # mirror the left/right extras, keep the mouse on the right
            pos = edge + right * x + ahead * y
            props.place(make(pm, f"S{k}{make.__name__[5:].title()}"), pos.x, pos.y, DESK_Z + dz,
                        -a + math.radians(flip * yaw))
        p = edge + right * (flip * -0.80) + ahead * 0.30
        props.place(props.make_deskphone(pm, f"S{k}Phone"), p.x, p.y, DESK_Z, -a + 0.3 * flip)
        # Shallow grey drawer hung under the top, to the operator's left
        p = edge + right * (flip * -0.62) + ahead * 0.22
        box(f"Desk{k}Drawer", (0.46, 0.38, 0.07), (p.x, p.y, DESK_Z - DESK_T - 0.035), m["post"], rot_z=-a)
        p = edge + right * (flip * -0.62) + ahead * 0.028
        box(f"Desk{k}DrawerPull", (0.14, 0.012, 0.018), (p.x, p.y, DESK_Z - DESK_T - 0.04), m["desk_body"], rot_z=-a)
        p = edge + right * (flip * 0.95) + ahead * 0.24
        props.place(props.make_touchpanel(pm, f"S{k}TouchPanel"), p.x, p.y, DESK_Z, -a - 0.2 * flip)


# Hanging ceiling microphones for room audio: (radius or None, angle or x, y, drop)
CEILING_MICS = [
    # above each operator, a little to either side of the chair
    *[(2.35, d + s * 0.22, None, 0.55) for d in DESKS for s in (-1, 1)],
    (None, TABLE[0], TABLE[1], 0.70),  # over the meeting table
]


def build_ceiling_mics(m):
    pm = props.materials()
    for i, (r, a, y, drop) in enumerate(CEILING_MICS):
        p = polar(r, a) if r is not None else Vector((a, y, 0))
        props.place(props.make_ceiling_mic(pm, f"CeilingMic{i}", drop), p.x, p.y, ROOM_Z)


# ------------------------------------------------------------------- chairs

def build_chairs(m):
    pm = props.materials()
    for k, a in enumerate(DESKS):
        p = polar(r_front(a) - 0.35, a)
        props.place(props.make_chair(pm, f"Chair{k}"), p.x, p.y, 0.0, -a + math.radians(6 if k else -6))


# --------------------------------------------------------------------- room

def glass_wall(name, p0, p1, z0, z1, m, inside, pane=1.2):
    """A glazed partition from p0 to p1 (x, y) between heights z0 and z1:
    glass panes with a frosted band at eye height and thin frames. The
    glass is an opaque stand-in; the bake cannot see through it anyway."""
    p0, p1 = Vector((*p0, 0)), Vector((*p1, 0))
    run = p1 - p0
    n = max(1, round(run.length / pane))
    yaw = math.atan2(run.y, run.x)
    for nm, (za, zb, mat) in {"Low": (z0, 1.05, m["glass"]), "Band": (1.05, 1.55, m["frosted"]),
                              "High": (1.55, z1, m["glass"])}.items():
        q = [p0 + Vector((0, 0, za)), p1 + Vector((0, 0, za)), p1 + Vector((0, 0, zb)), p0 + Vector((0, 0, zb))]
        b.quad(f"{name}{nm}", [tuple(v) for v in q], mat, inside)
    for i in range(n + 1):
        c = p0 + run * (i / n)
        box(f"{name}Frame{i}", (0.05, 0.06, z1 - z0), (c.x, c.y, (z0 + z1) / 2), m["frame"], rot_z=yaw)
    for z in (z0 + 0.03, z1 - 0.03):
        c = (p0 + p1) / 2
        box(f"{name}Rail{z:.2f}", (run.length, 0.06, 0.06), (c.x, c.y, z), m["frame"], rot_z=yaw)


def build_shell(m):
    X, Y0, Y1, Z = ROOM_X, ROOM_Y0, ROOM_Y1, ROOM_Z
    NX, NY = NOOK_X0, NOOK_Y0
    c = (0, 0, Z / 2)
    cn = ((NX + X) / 2, (NY + Y0) / 2, Z / 2)  # inside the rest corner
    b.quad("Floor", [(-X, Y0, 0), (X, Y0, 0), (X, Y1, 0), (-X, Y1, 0)], m["carpet"], c)
    b.quad("Ceiling", [(-X, Y0, Z), (X, Y0, Z), (X, Y1, Z), (-X, Y1, Z)], m["ceiling"], c)
    b.quad("FloorNook", [(NX, NY, 0), (X, NY, 0), (X, Y0, 0), (NX, Y0, 0)], m["carpet"], cn)
    b.quad("CeilingNook", [(NX, NY, Z), (X, NY, Z), (X, Y0, Z), (NX, Y0, Z)], m["ceiling"], cn)
    # Behind the display band: a dark wall, then glass at the right under a
    # white bulkhead (with the clock on it)
    gx = GLASS_X0
    bx, depth, drop = BULKHEAD
    b.quad("WallBack", [(-X, Y1, 0), (gx, Y1, 0), (gx, Y1, Z), (-X, Y1, Z)], m["wall_dark"], c)
    glass_wall("GlassBack", (gx, Y1), (X, Y1), 0.0, Z - drop, m, c)
    box("Bulkhead", (X - bx, depth, drop), ((bx + X) / 2, Y1 - depth / 2, Z - drop / 2), m["ceiling"])
    # Rear wall: solid to the left (ESD panel, binders), then glass behind
    # the video-link screen, the opening into the rest corner, and a stub
    d0, d1 = NOOK_DOOR
    b.quad("WallRear", [(-X, Y0, 0), (NX, Y0, 0), (NX, Y0, Z), (-X, Y0, Z)], m["wall"], c)
    glass_wall("GlassRear", (NX, Y0), (d0, Y0), 0.0, Z, m, c)
    b.quad("WallRearStub", [(d1, Y0, 0), (X, Y0, 0), (X, Y0, Z), (d1, Y0, Z)], m["wall"], c)
    b.quad("WallRearHeader", [(d0, Y0, 2.15), (d1, Y0, 2.15), (d1, Y0, Z), (d0, Y0, Z)], m["wall"], c)
    for x in (d0, d1):
        box(f"NookJamb{x:.2f}", (0.06, 0.12, 2.15), (x, Y0, 1.075), m["frame"])
    box("NookHead", (d1 - d0 + 0.06, 0.12, 0.05), ((d0 + d1) / 2, Y0, 2.15), m["frame"])
    # The rest corner's own walls (the back of the rear wall faces it too)
    b.quad("WallNookFront", [(NX, Y0 - 0.01, 0), (d0, Y0 - 0.01, 0), (d0, Y0 - 0.01, Z), (NX, Y0 - 0.01, Z)], m["wall"], cn)
    b.quad("WallNookFrontR", [(d1, Y0 - 0.01, 0), (X, Y0 - 0.01, 0), (X, Y0 - 0.01, Z), (d1, Y0 - 0.01, Z)], m["wall"], cn)
    b.quad("WallNookBack", [(NX, NY, 0), (X, NY, 0), (X, NY, Z), (NX, NY, Z)], m["wall"], cn)
    b.quad("WallNookL", [(NX, NY, 0), (NX, Y0, 0), (NX, Y0, Z), (NX, NY, Z)], m["wall"], cn)
    b.quad("WallR", [(X, NY, 0), (X, Y1, 0), (X, Y1, Z), (X, NY, Z)], m["wall"], c)
    # Left wall with a wide window: four panels around the opening
    for nm, (y0, y1, z0, z1) in {"L0": (Y0, WIN_Y0, 0, Z), "L1": (WIN_Y1, Y1, 0, Z),
                                 "LB": (WIN_Y0, WIN_Y1, 0, WIN_Z0), "LT": (WIN_Y0, WIN_Y1, WIN_Z1, Z)}.items():
        b.quad("Wall" + nm, [(-X, y0, z0), (-X, y1, z0), (-X, y1, z1), (-X, y0, z1)], m["wall"], c)
    for i in range(5):  # mullions
        y = WIN_Y0 + (WIN_Y1 - WIN_Y0) * i / 4
        box(f"Mullion{i}", (0.08, 0.06, WIN_Z1 - WIN_Z0), (-X, y, (WIN_Z0 + WIN_Z1) / 2), m["frame"])
    box("Transom", (0.08, WIN_Y1 - WIN_Y0, 0.06), (-X, (WIN_Y0 + WIN_Y1) / 2, WIN_Z0), m["frame"])
    # Recessed LED panels on the 0.6 m ceiling-tile grid, placed irregularly
    # like the real room (they follow the ducts, not a pattern), plus
    # air-conditioning cassettes; two more panels light the rest corner
    for i, (gx_, gy) in enumerate([(-7, -4), (-4, -5), (-1, -3), (3, -5), (6, -3), (-6, 0), (-2, 1), (2, -1),
                                   (5, 1), (8, -1), (-5, 4), (0, 5), (4, 4), (-8, 6), (-2, 7), (2, 8, ), (2, -8), (6, -8)]):
        box(f"Led{i}", (0.58, 0.58, 0.01), (gx_ * 0.6, gy * 0.6, Z - 0.004), m["led_panel"])
    for i, (gx_, gy) in enumerate([(-3, 3), (6, -5), (-6, -4)]):
        box(f"AirCassette{i}", (0.62, 0.62, 0.04), (gx_ * 0.6, gy * 0.6, Z - 0.02), m["post"])
    # Door at the rear of the right-hand wall, with a green exit sign above it
    dy, dw, dh = DOOR_Y, DOOR_W, DOOR_H
    box("DoorFrame", (0.04, dw + 0.10, dh + 0.05), (X - 0.02, dy, (dh + 0.05) / 2), m["frame"])
    box("DoorLeaf", (0.03, dw, dh), (X - 0.045, dy, dh / 2), m["door"])
    box("DoorHandle", (0.06, 0.14, 0.025), (X - 0.08, dy + dw / 2 - 0.10, 1.05), m["post"])
    box("DoorKickPlate", (0.004, dw - 0.04, 0.25), (X - 0.062, dy, 0.14), m["post"])
    box("ExitSignBox", (0.05, 0.38, 0.16), (X - 0.025, dy, dh + 0.25), m["ceiling"])
    box("ExitSign", (0.004, 0.34, 0.12), (X - 0.052, dy, dh + 0.25), m["exit_sign"])
    # Light switch panel beside the door, on the handle side
    props.place(props.make_lightpanel(props.materials(), "WallLightPanel"), X, dy + dw / 2 + 0.25, 1.20, -math.pi / 2)


def build_meeting_corner(m):
    """Oval table behind the operators, with the large video-link screen on
    a floor stand at its far end, in front of the glass that screens off
    the rest corner."""
    tx, ty, rx, ry = TABLE
    t = cylinder("MeetingTable", rx, 0.04, (tx, ty, 0.74), m["table"], verts=48)
    t.scale = (1.0, ry / rx, 1.0)
    # Two pedestal legs like a sit-stand table: a column on a flat foot,
    # a top arm under the table, and a beam joining them
    for s in (-1, 1):
        x = tx + s * 0.55
        box(f"MeetingTableLeg{s:+d}", (0.10, 0.07, 0.66), (x, ty, 0.37), m["post"])
        box(f"MeetingTableFoot{s:+d}", (0.08, 0.72, 0.03), (x, ty, 0.015), m["post"])
        box(f"MeetingTableArm{s:+d}", (0.06, 0.70, 0.03), (x, ty, 0.705), m["post"])
    box("MeetingTableBeam", (1.10, 0.06, 0.05), (tx, ty, 0.66), m["post"])
    lx, ly = LINK
    pm = props.materials()
    props.place(props.make_link_stand(pm, "LinkStand"), lx, ly, 0.0, math.pi)
    box("LinkScreenBezel", (1.9, 0.08, 1.08), (lx, ly + 0.02, 1.55), m["bezel_black"])
    box("LinkScreen", (1.85, 0.002, 1.03), (lx, ly + 0.061, 1.55), m["screen_cam"])
    props.place(props.make_ptz_camera(pm, "PtzCameraLink", 0.45), lx, ly + 0.20, ROOM_Z, math.pi)


def binders_board():
    """The painted binder spines for the shelving, rows lined up with its shelves."""
    w, h, z0 = props.shelving_face(SHELVING)
    return boards.binder_spines((w, h), [z - z0 for z in props.shelf_heights(SHELVING[2])])


# Boards: name -> where it hangs or stands. "wall" boards hang on a wall,
# "stand" boards are mobile ones on castors, "esd" is the hardwired ESD
# panel's printed front. Each gets its own sharp texture in the bake.
# (draw, size, (x, y, z of the face's middle back), yaw, kind)
BOARDS = {
    "Pnid": (boards.pnid_board, (2.4, 1.2), (ROOM_X, 1.45, 1.45), -math.pi / 2, "wall"),
    "Shift": (boards.shift_board, (1.2, 0.9), (*polar(3.55, TV_A - 0.13).to_2d(), 1.25), -(TV_A - 0.13), "stand"),
    "Notes": (boards.notes_board, (1.2, 0.9), (*polar(3.80, 1.47).to_2d(), 1.25), -1.47, "stand"),
    "Esd": (boards.esd_panel, (1.6, 2.0), (-3.0, ROOM_Y0, 0.0), 0.0, "esd"),
    "Binders": (binders_board, props.shelving_face(SHELVING)[:2], (-1.05, ROOM_Y0, 0.0), 0.0, "shelf"),
}


def build_boards(m):
    """The P&ID whiteboard on the right-hand wall, a shift board on castors
    by the hanging TV, a mobile whiteboard at the right end of the band,
    the hardwired ESD panel on the rear wall with its fire & gas unit, and
    the binder shelving beside it."""
    pm = props.materials()
    for name, (draw, size, (x, y, z), yaw, kind) in BOARDS.items():
        face = props.board_material("Board" + name, draw(), size)
        if kind == "shelf":
            props.place(props.make_shelving(pm, "Whiteboard" + name, SHELVING, face), x, y, z, yaw + math.pi)
            continue
        if kind == "esd":
            o = props.make_esd_panel(pm, "Whiteboard" + name, face, size)
            props.place(o, x, y, z, yaw + math.pi)
            props.place(props.make_fg_panel(pm, "FgPanel"), x - size[0] / 2 - 0.35, y, 1.45, yaw + math.pi)
            continue
        o = props.make_whiteboard(pm, "Whiteboard" + name, size, face, stand=z if kind == "stand" else None)
        props.place(o, x, y, z, yaw)


def build_rear(m):
    """Along the rear wall, left of the meeting table, the free-standing
    concrete pillar and a plant (the binder shelving is with the boards)."""
    pm = props.materials()
    px, py, side = PILLAR
    props.place(props.make_pillar(pm, "Pillar", (side, side), ROOM_Z), px, py, 0.0)
    props.place(props.make_plant(pm, "PlantRear", light=LIGHT_PLANTS), -4.85, ROOM_Y0 + 0.35, 0.0)


def build_lounge(m):
    """The rest corner behind the rear wall: a sofa against the back wall
    with a low table, and a counter with a coffee machine and a mini
    fridge, by the opening."""
    pm = props.materials()
    NX, NY = NOOK_X0, NOOK_Y0
    props.place(props.make_sofa(pm, "Sofa", 2.0), NX + 1.35, NY, 0.0, math.pi)
    props.place(props.make_coffee_table(pm, "CoffeeTable"), NX + 1.35, NY + 1.30, 0.0)
    kx = ROOM_X - 0.9
    props.place(props.make_kitchenette(pm, "Kitchenette", 1.8), kx, NY, 0.0, math.pi)
    # On the counter (0.90 high), left of the coffee machine and at the far end; the clock above it
    props.place(props.make_kettle(pm, "Kettle"), kx + 0.68, NY + 0.27, 0.90, math.pi - 0.3)
    props.place(props.make_fern(pm, "Fern"), kx - 0.68, NY + 0.30, 0.90, math.pi)
    for o in props.make_wall_clock(pm, "WallClock", CLOCK_STYLE, live=True):  # the hands follow the game's clock
        props.place(o, kx + 0.1, NY, 1.95, math.pi)
    props.place(props.make_plant(pm, "PlantNook", 1.2, light=LIGHT_PLANTS), NX + 0.30, ROOM_Y0 - 0.30, 0.0)
    # A floor lamp at the sofa's right end, which the player switches
    fx, fy = FLOOR_LAMP
    for o in props.make_floor_lamp(pm, m["floor_lamp_glow"], m["floor_lamp_shade"], "FloorLamp", split=True):
        props.place(o, fx, fy, 0.0)


# Floor-plan obstacles beyond the desks, band and table, for the walk:
# oriented boxes (centre x, y, half sizes, yaw), in Blender metres
def obstacles():
    px, py, side = PILLAR
    lx, ly = LINK
    ex, ey = BOARDS["Esd"][2][:2]
    out = [
        (px, py, side / 2, side / 2, 0.0),
        (-1.05, ROOM_Y0 + 0.20, 0.82, 0.20, 0.0),          # shelving
        (ex, ey + 0.23, 0.83, 0.23, 0.0),                  # ESD panel
        (lx, ly + 0.02, 0.50, 0.36, 0.0),                  # link-screen stand feet
        (NOOK_X0 + 1.35, NOOK_Y0 + 0.42, 1.0, 0.43, 0.0),  # sofa
        (NOOK_X0 + 1.35, NOOK_Y0 + 1.30, 0.55, 0.28, 0.0),  # coffee table
        (ROOM_X - 0.9, NOOK_Y0 + 0.30, 0.9, 0.30, 0.0),    # counter
        (-4.85, ROOM_Y0 + 0.35, 0.22, 0.22, 0.0),          # plants
        (NOOK_X0 + 0.30, ROOM_Y0 - 0.30, 0.22, 0.22, 0.0),
        (*FLOOR_LAMP, 0.16, 0.16, 0.0),                    # floor lamp
    ]
    for name in ("Shift", "Notes"):
        (x, y, _), yaw = BOARDS[name][2], BOARDS[name][3]
        out.append((x, y, BOARDS[name][1][0] / 2 + 0.06, 0.32, yaw))
    return out


# Where the room sits in the platform (offshore_platform.py coordinates): on
# the top floor of the quarters, its window in the quarters' end wall facing
# the flare, high enough to look out over the stepped plant blocks below.
PLATFORM_OFFSET = Vector((op.LQ_X0 + ROOM_X, 6.0, 69.2))  # platform point at the room origin


def build_outside(m):
    """The platform around the room, seen through the window: the process
    end, the crane and the flare boom with its pilot burning. Built from
    offshore_platform.py, carved where the room sits, then cut down to the
    faces some point in front of the window can see (~9k -> a few thousand
    triangles). Its lamps, cabin windows, obstruction lights and the flare
    use the room's emissive groups so the viewer can drive them."""
    pm = op.materials()
    pm.update(lamp=m["platform_light"], flare=m["flare"], window=m["platform_window"], red=m["platform_red"])
    objs, tris, _ = op.build_platform(pm, z_cut=-1.0)
    off = PLATFORM_OFFSET
    op.carve(objs, off + Vector((-ROOM_X - 0.15, ROOM_Y0 - 0.15, -0.15)), off + Vector((ROOM_X + 0.15, ROOM_Y1 + 0.15, ROOM_Z + 0.15)))
    # Eyes where a player can stand or sit in front of the window
    eyes = [off + Vector((x, y, z)) for x in (-4.8, -3.0, 0.0) for y in (WIN_Y0 + 0.4, (WIN_Y0 + WIN_Y1) / 2, WIN_Y1 - 0.4)
            for z in (1.2, 1.7)]
    portal = (off.x - ROOM_X, off.y + WIN_Y0, off.y + WIN_Y1, off.z + WIN_Z0, off.z + WIN_Z1)
    left = op.cull_to_view(objs, eyes, portal=portal)
    for o in objs:
        if not o.data.polygons:  # a material with nothing left in view (the bake can't unwrap an empty mesh)
            bpy.data.objects.remove(o)
            continue
        o.data.transform(Matrix.Translation(-off))
    print(f"platform outside the window: {tris} -> {left} triangles", flush=True)
    sea = 2000.0
    b.quad("Sea", [(-sea, -sea, -off.z), (sea, -sea, -off.z), (sea, sea, -off.z), (-sea, sea, -off.z)], m["sea"], (0, 0, 0))


# ------------------------------------------------------------------- render

def cameras():
    def cam(name, loc, aim, lens):
        d = bpy.data.cameras.new(name)
        d.lens = lens
        d.clip_end = 3000
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.collection.objects.link(o)
        return o
    main = cam("Camera", (3.0, -2.6, 1.65), (-0.6, 2.2, 0.95), 20)
    a = DESKS[1]
    seat = cam("Operator", polar(r_front(a) - 0.30, a, 1.22), polar(WALL_R, a, 1.25), 16)
    st = DESKS[0]
    edge = polar(r_front(st), st, 0)
    right, ahead = Vector((math.cos(st), -math.sin(st), 0)), Vector((math.sin(st), math.cos(st), 0))
    station = cam("Station", edge - right * 0.85 - ahead * 0.45 + Vector((0, 0, 1.40)),  # over the left shoulder
                  edge + right * 0.10 + ahead * 0.25 + Vector((0, 0, DESK_Z)), 22)
    window = cam("Window", (-3.6, 0.1, 1.5), (-20.0, 0.5, -0.5), 20)  # out over the process end to the flare
    plan_d = bpy.data.cameras.new("Plan")
    plan_d.type = "ORTHO"
    plan_d.ortho_scale = 11.6
    plan = bpy.data.objects.new("Plan", plan_d)
    plan.location = (0, (NOOK_Y0 + ROOM_Y1) / 2, 20)
    bpy.context.collection.objects.link(plan)
    return main, seat, station, window, plan


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--res", type=int, default=1280)
    p.add_argument("--out", default=os.path.join(b.BUILD, "control_room"))
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

    m = materials()
    build_desk(m)
    n_mon = build_monitors(m)
    build_video_wall(m)
    build_desk_props(m)
    build_chairs(m)
    build_shell(m)
    build_meeting_corner(m)
    build_boards(m)
    build_rear(m)
    build_lounge(m)
    build_ceiling_mics(m)
    build_outside(m)
    print(f"{len(DESKS)} desks, {n_mon} desk monitors, {WALL_N} wall displays", flush=True)

    world = bpy.data.worlds.new("Night")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.012, 0.02, 0.045, 1)
    scene.world = world
    main_cam, seat_cam, station_cam, win_cam, plan_cam = cameras()

    def shot(cam, name, w, h):
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.render.filepath = os.path.join(args.out, name + ".png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scene.render.filepath, flush=True)

    w = args.res
    # Night: screens and dimmed ceiling panels are the only light
    m["led_panel"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.3
    shot(main_cam, "night", w, w * 9 // 16)
    shot(seat_cam, "night-operator", w, w * 9 // 16)
    shot(station_cam, "night-station", w, w * 9 // 16)
    shot(win_cam, "night-window", w, w * 9 // 16)

    # Clay: everything grey under full ceiling light, to judge shapes and proportions
    clay = mat_flat("Clay", (0.6, 0.6, 0.6), 0.8)
    keep = {"LedPanel", "Screen", "ScreenCam", "ExitSign"}
    for o in scene.objects:
        if o.type == "MESH":
            for i, mt in enumerate(o.data.materials):
                if mt.name not in keep:
                    o.data.materials[i] = clay
    m["led_panel"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 6.0
    bg.inputs["Color"].default_value = (0.5, 0.55, 0.6, 1)
    shot(main_cam, "clay", w, w * 9 // 16)
    shot(station_cam, "clay-station", w, w * 9 // 16)
    for o in scene.objects:  # look down through the roof
        if o.name.startswith(("Ceiling", "Led", "Bulkhead")):
            o.hide_render = True
    shot(plan_cam, "clay-plan", w * 3 // 4, w * 3 // 4)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(b.BUILD, "control_room.blend"))


if __name__ == "__main__":
    main()
