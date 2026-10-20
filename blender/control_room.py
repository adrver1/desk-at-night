"""
Blockout of an offshore-style control room: two curved operator desks on a
shared semicircle, six monitors on each (3 + 3), and a band of large
displays on posts a step behind them. The rest of the room (shell, chairs, window, meeting
table) is placeholder and free to change.

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
import build as b  # noqa: E402  (imports bpy)
import props  # noqa: E402

bpy, bmesh, Vector = b.bpy, b.bmesh, b.Vector
box, cylinder, mat_flat = b.box, b.cylinder, b.mat_flat

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

# Room shell
ROOM_X, ROOM_Y0, ROOM_Y1, ROOM_Z = 5.4, -3.6, 4.6, 2.9
WIN_Y0, WIN_Y1, WIN_Z0, WIN_Z1 = -2.4, 2.6, 0.85, 2.45  # window in the left (-X) wall


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
    stand = box(name + "Stand", (0.06, 0.03, MON_Z0 - (DESK_Z + SHELF_H)),
                pos - Vector((0, 0, (MON_Z0 - DESK_Z - SHELF_H) / 2 + h / 2 - 0.02)) + polar(0.03, a), m["bezel_white"])
    stand.rotation_euler.z = -a
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
        # Two posts per display, floor to just above the top
        for s in (-1, 1):
            pa = a + s * (WALL_W / 2 - 0.25) / WALL_R
            p = polar(WALL_R + 0.06, pa, (WALL_Z0 + WALL_H + 0.05) / 2)
            box(f"Wall{i}Post{s:+d}", (0.10, 0.08, WALL_Z0 + WALL_H + 0.05), p, m["post"], rot_z=-pa)
    # Red digital clock above the middle of the band
    box("Clock", (0.42, 0.05, 0.12), polar(WALL_R, 0, WALL_Z0 + WALL_H + 0.22), m["clock"])


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
    blockout boxes for the phone and touch panel."""
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

        def at(x, y, z, size, mat, name, rz=0.0):
            p = edge + right * (flip * x) + ahead * y
            return box(f"S{k}{name}", size, (p.x, p.y, z), mat, rot_z=-a + rz)
        at(-0.80, 0.30, DESK_Z + 0.04, (0.22, 0.20, 0.08), m["plastic"], "Phone", rz=0.3 * flip)
        at(0.95, 0.34, DESK_Z + 0.05, (0.20, 0.14, 0.10), m["plastic"], "TouchPanel", rz=-0.2 * flip)


# ------------------------------------------------------------------- chairs

def chair(name, pos, facing, m):
    """24/7 control-room chair: star base, column, seat, high back, headrest."""
    mat = m["chair"]
    yaw = -facing
    def part(n, size, local):
        off = b.Matrix.Rotation(yaw, 4, "Z") @ Vector(local)
        return box(name + n, size, pos + off, mat, rot_z=yaw)
    for i in range(5):
        ang = 2 * math.pi * i / 5
        box(f"{name}Leg{i}", (0.33, 0.05, 0.04), pos + Vector((0.16 * math.cos(ang), 0.16 * math.sin(ang), 0.06)), mat, rot_z=ang)
    cylinder(name + "Column", 0.03, 0.40, pos + Vector((0, 0, 0.26)), mat, verts=16)
    part("Seat", (0.52, 0.50, 0.09), (0, 0, 0.50))
    part("Back", (0.48, 0.09, 0.66), (0, -0.27, 0.90))
    part("Head", (0.30, 0.08, 0.16), (0, -0.27, 1.34))
    part("ArmL", (0.06, 0.32, 0.04), (-0.27, -0.02, 0.70))
    part("ArmR", (0.06, 0.32, 0.04), (0.27, -0.02, 0.70))


def build_chairs(m):
    for k, a in enumerate(DESKS):
        chair(f"Chair{k}", polar(r_front(a) - 0.35, a), a, m)


# --------------------------------------------------------------------- room

def build_shell(m):
    X, Y0, Y1, Z = ROOM_X, ROOM_Y0, ROOM_Y1, ROOM_Z
    c = (0, 0, Z / 2)
    b.quad("Floor", [(-X, Y0, 0), (X, Y0, 0), (X, Y1, 0), (-X, Y1, 0)], m["carpet"], c)
    b.quad("Ceiling", [(-X, Y0, Z), (X, Y0, Z), (X, Y1, Z), (-X, Y1, Z)], m["ceiling"], c)
    b.quad("WallBack", [(-X, Y1, 0), (X, Y1, 0), (X, Y1, Z), (-X, Y1, Z)], m["wall"], c)
    b.quad("WallRear", [(-X, Y0, 0), (X, Y0, 0), (X, Y0, Z), (-X, Y0, Z)], m["wall"], c)
    b.quad("WallR", [(X, Y0, 0), (X, Y1, 0), (X, Y1, Z), (X, Y0, Z)], m["wall"], c)
    # Left wall with a wide window: four panels around the opening
    for nm, (y0, y1, z0, z1) in {"L0": (Y0, WIN_Y0, 0, Z), "L1": (WIN_Y1, Y1, 0, Z),
                                 "LB": (WIN_Y0, WIN_Y1, 0, WIN_Z0), "LT": (WIN_Y0, WIN_Y1, WIN_Z1, Z)}.items():
        b.quad("Wall" + nm, [(-X, y0, z0), (-X, y1, z0), (-X, y1, z1), (-X, y0, z1)], m["wall"], c)
    for i in range(5):  # mullions
        y = WIN_Y0 + (WIN_Y1 - WIN_Y0) * i / 4
        box(f"Mullion{i}", (0.08, 0.06, WIN_Z1 - WIN_Z0), (-X, y, (WIN_Z0 + WIN_Z1) / 2), m["frame"])
    box("Transom", (0.08, WIN_Y1 - WIN_Y0, 0.06), (-X, (WIN_Y0 + WIN_Y1) / 2, WIN_Z0), m["frame"])
    # Recessed LED panels on the 0.6 m ceiling-tile grid, placed irregularly
    # like the real room (they follow the ducts, not a pattern), plus two
    # air-conditioning cassettes
    for i, (gx, gy) in enumerate([(-7, -4), (-4, -5), (-1, -3), (3, -5), (6, -3), (-6, 0), (-2, 1), (2, -1),
                                  (5, 1), (8, -1), (-5, 4), (0, 5), (4, 4), (7, 6), (-8, 6), (-2, 7)]):
        box(f"Led{i}", (0.58, 0.58, 0.01), (gx * 0.6, gy * 0.6, Z - 0.004), m["led_panel"])
    for i, (gx, gy) in enumerate([(-3, 3), (6, -6)]):
        box(f"AirCassette{i}", (0.62, 0.62, 0.04), (gx * 0.6, gy * 0.6, Z - 0.02), m["post"])


def build_meeting_corner(m):
    """Oval table behind the operators with a large video-link screen."""
    t = cylinder("MeetingTable", 1.0, 0.04, (2.6, -2.8, 0.74), m["table"], verts=48)
    t.scale = (1.0, 0.55, 1.0)
    cylinder("MeetingTableLeg", 0.08, 0.72, (2.6, -2.8, 0.36), m["post"], verts=16)
    box("LinkScreenBezel", (1.9, 0.08, 1.08), (2.6, ROOM_Y0 + 0.15, 1.55), m["bezel_black"])
    box("LinkScreen", (1.85, 0.002, 1.03), (2.6, ROOM_Y0 + 0.19, 1.55), m["screen_cam"])
    box("LinkScreenStand", (0.12, 0.10, 1.0), (2.6, ROOM_Y0 + 0.13, 0.5), m["post"])


def build_outside(m):
    """Placeholder platform seen through the window: a deck, a few modules,
    a derrick, deck lights and a flare tip. To be replaced with a low-detail
    model of the real platform."""
    ox, oy = -60.0, 8.0
    box("PlatDeck", (40, 26, 2), (ox, oy, -6), m["deck"])
    lights = 0
    for i, (dx, dy, sx, sy, sz) in enumerate([(-8, -6, 10, 9, 8), (4, -5, 9, 10, 11), (-6, 6, 12, 8, 6), (8, 7, 8, 7, 14)]):
        box(f"PlatModule{i}", (sx, sy, sz), (ox + dx, oy + dy, -5 + sz / 2), m["deck"])
        # Deck lights along the face that looks toward the control room
        for j in range(int(sy // 3)):
            for k in range(int(sz // 4)):
                y, z = oy + dy - sy / 2 + 1.5 + 3 * j, -3 + 4 * k
                cylinder(f"PlatLight{lights}", 0.15, 0.15, (ox + dx + sx / 2 + 0.2, y, z), m["platform_light"], verts=8)
                lights += 1
    box("PlatDerrick", (3, 3, 26), (ox + 12, oy - 8, 8), m["deck"])
    box("FlareBoom", (1, 1, 14), (ox + 6, oy + 14, 1), m["deck"])
    cylinder("FlareTip", 1.0, 2.5, (ox + 6, oy + 14, 9), m["flare"], verts=16)
    b.quad("Sea", [(-400, -400, -30), (400, -400, -30), (400, 400, -30), (-400, 400, -30)], m["sea"], (0, 0, 0))


# ------------------------------------------------------------------- render

def cameras():
    def cam(name, loc, aim, lens):
        d = bpy.data.cameras.new(name)
        d.lens = lens
        d.clip_end = 300
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
    window = cam("Window", (-1.6, 0.2, 1.45), (-5.4, 1.0, 1.45), 24)
    plan_d = bpy.data.cameras.new("Plan")
    plan_d.type = "ORTHO"
    plan_d.ortho_scale = 14.0
    plan = bpy.data.objects.new("Plan", plan_d)
    plan.location = (0, 0.4, 20)
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
    keep = {"LedPanel", "Screen", "ScreenCam"}
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
        if o.name == "Ceiling" or o.name.startswith("Led"):
            o.hide_render = True
    shot(plan_cam, "clay-plan", w * 3 // 4, w * 3 // 4)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(b.BUILD, "control_room.blend"))


if __name__ == "__main__":
    main()
