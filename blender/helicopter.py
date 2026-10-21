"""
Low-poly twin-engine offshore helicopter in the 8-tonne class (AW189-like),
parked with its rotors stopped, for the platform's helideck.

Proportions follow the public type figures: 17.6 m long with the rotors
turning, a 14.6 m five-blade main rotor, a 2.9 m four-blade tail rotor,
5.06 m high and 3.02 m across the sponsons. The fuselage is a loft of
14-point cross sections, so the paint lines of a livery follow its shape
the way real cheat lines do; every livery band is a ring of faces, not a
texture.

    python blender/helicopter.py                    # preview stills, every livery
    python blender/helicopter.py --samples 16       # faster, noisier
    python blender/helicopter.py --only deck-navy   # one shot

Like the platform, everything is merged into one mesh per material and no
textures are used. Origin is the ground under the main rotor mast, +X points
to the nose and +Z up. Liveries are kept side by side in LIVERIES (the asset
library); LIVERY picks the one the scene uses.

Renders go to blender/build/helicopter/, and the .blend is saved next to them.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import offshore_platform as op  # noqa: E402

bpy, Vector = b.bpy, b.Vector
from mathutils import Matrix  # noqa: E402


def srgb(h):
    """'#rrggbb' to linear RGB, so colours can be copied from a palette."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


NAVY, SLATE, SAND, WHITE = srgb("#02293c"), srgb("#73838d"), srgb("#d2ccb3"), srgb("#eceeee")
SIGNAL, DEEP_BLUE = srgb("#d8261c"), srgb("#1b2a6b")

# Paint bands of the cross section, bottom to top (see PROFILE): belly,
# lower side, stripe, pinstripe, upper side, window band, shoulder, roof. A
# livery names a colour key for each band, separately for the cabin and the
# tail boom, plus the fin, the engine cowling, the sponsons, the window
# frames (None for none) and the tail rotor blade and tip colours.
BANDS = ("belly", "lower", "stripe", "pin", "upper", "windows", "shoulder", "roof")
LIVERIES = {
    # Navy below, white above, a sand cheat line between, navy tail
    "navy": {"cabin": ("navy", "navy", "sand", "white", "white", "white", "white", "white"),
             "boom": ("navy", "navy", "sand", "navy", "navy", "navy", "navy", "navy"),
             "fin": "navy", "cowl": "white", "sponson": "navy"},
    # Navy all over with a white roof and cowling, slate tail, sand stripe
    "dark": {"cabin": ("navy", "navy", "sand", "navy", "navy", "navy", "white", "white"),
             "boom": ("slate", "slate", "sand", "slate", "slate", "slate", "slate", "slate"),
             "fin": "slate", "cowl": "white", "sponson": "navy"},
    # White with a slate belly, a navy band that widens along the boom, navy fin
    "white": {"cabin": ("slate", "white", "navy", "white", "white", "white", "white", "white"),
              "boom": ("slate", "navy", "navy", "navy", "navy", "navy", "white", "white"),
              "fin": "navy", "cowl": "white", "sponson": "slate"},
    # Offshore operator style: red top and nose, white below, a blue cheat
    # line with a white pinstripe that sweeps up into a blue boom and fin,
    # white window frames, red and white striped tail rotor
    "redtop": {"cabin": ("white", "white", "blue", "white", "signal", "signal", "signal", "signal"),
               "boom": ("white", "white", "blue", "white", "blue", "blue", "blue", "blue"),
               "fin": "blue", "cowl": "signal", "sponson": "white", "frame": "white",
               "tail_rotor": ("white", "signal")},
}
LIVERY = "redtop"

# Half cross section as (width, height) fractions, from the keel to the roof
# line; mirrored to a closed ring of 18 points (see _band for the paint).
PROFILE = [(0.0, 0.0), (0.82, 0.03), (1.0, 0.20), (1.0, 0.36), (1.0, 0.43),
           (1.0, 0.455), (1.0, 0.50), (0.95, 0.88), (0.0, 1.0)]
SHOULDER = (0.70, 0.977)  # extra point between the window top and the roof line

# Sections along the fuselage: (x, keel z, roof z, half width). The nose is
# at +6.7, the main rotor mast at 0, the tail rotor hub at -8.85.
SECTIONS = [
    (6.70, 1.08, 1.40, 0.12),
    (6.45, 0.86, 1.78, 0.55),
    (5.85, 0.70, 2.18, 0.95),
    (5.05, 0.62, 2.56, 1.15),
    (4.25, 0.60, 2.76, 1.22),
    (3.00, 0.58, 2.80, 1.25),
    (-1.10, 0.58, 2.80, 1.25),
    (-2.05, 0.76, 2.76, 1.14),
    (-3.05, 1.25, 2.66, 0.78),
    (-4.10, 1.80, 2.56, 0.44),
    (-8.10, 2.16, 2.64, 0.28),
    (-8.90, 2.26, 2.70, 0.25),
]
# Engine cowling over the cabin roof: (x, height above the roof, half width)
COWL = [(3.30, 0.04, 0.40), (2.60, 0.50, 0.70), (1.20, 0.68, 0.80), (-1.30, 0.66, 0.80),
        (-2.30, 0.40, 0.55), (-2.80, 0.10, 0.35)]
CABIN_END = -2.05     # sections behind this take the "boom" paint
WINDSCREEN = (4.25, 6.45)
ROOF = 2.80
MAST_X, HUB_Z = 0.0, 4.25
ROTOR_R, TAIL_R = 7.3, 1.45
TAIL_HUB = Vector((-8.85, 0.42, 3.95))  # tail rotor on the left (port, +Y) of the fin


def materials():
    def emit(name, color, strength):
        m, _, bsdf = b._new_mat(name)
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
        return m

    return {
        "navy": b.mat_flat("HeliNavy", NAVY, 0.35),
        "slate": b.mat_flat("HeliSlate", SLATE, 0.4),
        "sand": b.mat_flat("HeliSand", SAND, 0.4),
        "white": b.mat_flat("HeliWhite", WHITE, 0.35),
        "signal": b.mat_flat("HeliSignal", SIGNAL, 0.35),
        "blue": b.mat_flat("HeliBlue", DEEP_BLUE, 0.35),
        "glass": b.mat_flat("HeliGlass", (0.015, 0.02, 0.025), 0.08),
        "blade": b.mat_flat("HeliBlade", (0.06, 0.06, 0.065), 0.5),
        "metal": b.mat_flat("HeliMetal", (0.25, 0.25, 0.26), 0.45),
        "tyre": b.mat_flat("HeliTyre", (0.02, 0.02, 0.02), 0.8),
        "yellow": b.mat_flat("HeliYellow", (0.80, 0.55, 0.02), 0.5),   # blade tips
        "disc": disc_material(),
        "red": emit("HeliRed", (1.0, 0.04, 0.02), 0.0),                  # beacons, port light
        "green": emit("HeliGreen", (0.05, 1.0, 0.15), 0.0),              # starboard light
    }


def disc_material():
    """Blur disc for Cycles previews: faint grey, see-through. The web draws
    its own streak texture on it."""
    mat, nt, bsdf = b._new_mat("HeliDisc")
    bsdf.inputs["Base Color"].default_value = (0.08, 0.08, 0.09, 1)
    bsdf.inputs["Alpha"].default_value = 0.22
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def set_night(m, on):
    for k, s in (("red", 40), ("green", 30)):
        m[k].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = s if on else 0.0


def _ring(x, zb, zt, hw):
    half = PROFILE[:-1] + [SHOULDER, PROFILE[-1]]
    pts = [Vector((x, u * hw, zb + v * (zt - zb))) for u, v in half]
    return pts + [Vector((p.x, -p.y, p.z)) for p in reversed(pts[1:-1])]


def loft(g, rings, mat, caps=True):
    """Skin consecutive rings; mat(i, k) gives the material of the face
    between rings i and i+1 on segment k."""
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for k in range(n):
            vs = [rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]]
            g.add(mat(i, k), vs, [(3, 2, 1, 0)])
    if caps:
        g.add(mat(0, 0), rings[0], [tuple(range(n))])
        g.add(mat(len(rings) - 2, 0), rings[-1], [tuple(reversed(range(n)))])


def _band(k):
    """Paint band of ring segment k: 9 segments per side from the keel up,
    then back down the other side."""
    k = k if k < 9 else 17 - k
    return (0, 0, 1, 2, 3, 4, 5, 6, 7)[k]


def build_fuselage(g, m, liv):
    rings = [_ring(*sec) for sec in SECTIONS]

    def paint(i, k):
        x0, x1 = SECTIONS[i][0], SECTIONS[i + 1][0]
        band = _band(k)
        if WINDSCREEN[0] <= x1 and x0 <= WINDSCREEN[1] + 0.01 and band >= 5:
            return m["glass"]           # windscreen and the eyebrow panes
        return m[(liv["boom"] if x1 < CABIN_END - 0.01 else liv["cabin"])[band]]

    loft(g, rings, paint, caps=False)
    g.add(m[liv["cabin"][4]], rings[0], [tuple(range(len(rings[0])))])               # nose cap
    g.add(m[liv["boom"][4]], rings[-1], [tuple(reversed(range(len(rings[-1]))))])    # boom end
    # Centre post and frame of the windscreen
    g.beam(m[liv["cabin"][5]], (4.25, 0, ROOF + 0.02), (6.42, 0, 1.80), 0.12)


def side_quad(g, mat, x0, x1, z0, z1, y):
    """Window or door panel flat on the side of the cabin, on both sides."""
    for s in (1, -1):
        vs = [Vector((x0, s * y, z0)), Vector((x1, s * y, z0)), Vector((x1, s * y, z1)), Vector((x0, s * y, z1))]
        g.add(mat, vs, [(0, 1, 2, 3) if s > 0 else (3, 2, 1, 0)])


def build_cabin_details(g, m, liv):
    y = 1.255
    zw0, zw1 = 0.58 + 0.50 * 2.22 + 0.06, 0.58 + 0.88 * 2.22 - 0.07
    # Crew door window, then four big square cabin windows (the last behind the sliding door)
    wins = [(3.15, 4.10, zw0 - 0.15)] + [(x - 0.46, x + 0.46, zw0) for x in (2.05, 0.80, -0.45)]
    wins.append((-1.55, -1.05, zw0 + 0.05))
    for x0, x1, z0 in wins:
        side_quad(g, m["glass"], x0, x1, z0, zw1, y + 0.01)
        if liv.get("frame"):
            side_quad(g, m[liv["frame"]], x0 - 0.07, x1 + 0.07, z0 - 0.07, zw1 + 0.07, y + 0.005)
    # Sliding door seam and crew door seam: thin dark lines
    for x in (1.30, -1.0):
        side_quad(g, m["metal"], x, x + 0.05, 0.95, zw1 + 0.10, y + 0.012)
    side_quad(g, m["metal"], 2.98, 3.02, 0.80, zw1 + 0.10, y + 0.012)
    # Sponsons with the main gear, and a step
    sp = m[liv["sponson"]]
    for s in (1, -1):
        g.box(sp, (-0.25, s * 1.365, 1.035), (2.9, 0.47, 0.77))
        g.box(sp, (1.35, s * 1.30, 1.02), (0.5, 0.30, 0.45))
        g.box(m["metal"], (2.6, s * 1.30, 0.62), (0.5, 0.18, 0.05))
    # Engine cowling: a low hump over the cabin roof with two exhausts aft
    cw = m[liv["cowl"]]
    rings = [_ring(x, ROOF - 0.05, ROOF + h, hw) for x, h, hw in COWL]
    loft(g, rings, lambda i, k: cw)
    g.box(m["metal"], (0.0, 0, ROOF + 0.72), (1.3, 0.9, 0.16))           # gearbox fairing
    for s in (1, -1):
        g.tube(m["metal"], (-1.9, s * 0.55, ROOF + 0.40), (-2.35, s * 0.85, ROOF + 0.48), 0.20, 8)
        g.box(m["glass"], (1.6, s * 0.79, ROOF + 0.36), (0.9, 0.02, 0.22))  # intake grilles


def build_tail(g, m, liv):
    fin = m[liv["fin"]]
    # Swept fin rising from the end of the boom, a slab of two quads per side
    x0, x1, z0, z1 = -7.75, -9.05, 2.55, 2.70
    top = (-9.55, 4.95, -10.05, 5.00)
    t = 0.13
    vs = [Vector(v) for v in ((x0, -t, z0), (x1, -t, z1), (top[2], -t * 0.7, top[3]), (top[0], -t * 0.7, top[1]),
                              (x0, t, z0), (x1, t, z1), (top[2], t * 0.7, top[3]), (top[0], t * 0.7, top[1]))]
    g.add(fin, vs, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 3, 7, 4), (3, 2, 6, 7), (2, 1, 5, 6)])
    # Horizontal stabiliser across the boom ahead of the fin, with end plates
    g.box(fin, (-7.2, 0, 2.55), (0.85, 3.4, 0.08))
    for s in (1, -1):
        g.box(fin, (-7.25, s * 1.70, 2.65), (0.75, 0.05, 0.55))
    # Tail skid and beacon on the fin
    g.beam(m["metal"], (-8.2, 0, 2.20), (-8.7, 0, 1.70), 0.08)
    g.prism(m["red"], (-9.85, 0), 0.07, 5.00, 5.10, 6)


def build_tail_rotor(g, m, liv, hub=Vector((0, 0, 0))):
    """Four blades on the left of the fin, around hub; turns about Y."""
    g.tube(m["metal"], hub + Vector((0, -0.30, 0)), hub, 0.12, 8)
    for i in range(4):
        a = math.radians(20 + 90 * i)
        d = Vector((math.cos(a), 0, math.sin(a)))
        if "tail_rotor" in liv:     # striped blades: three bands, tip in the second colour
            c0, c1 = (m[k] for k in liv["tail_rotor"])
            for j, (r0, r1) in enumerate(((0.15, 0.6), (0.6, 0.9), (0.9, 1.15), (1.15, TAIL_R))):
                g.beam(c1 if j % 2 else c0, hub + d * r0, hub + d * r1, 0.20, 0.04)
        else:
            g.beam(m["blade"], hub + d * 0.15, hub + d * (TAIL_R - 0.2), 0.20, 0.04)
            g.beam(m["yellow"], hub + d * (TAIL_R - 0.2), hub + d * TAIL_R, 0.20, 0.04)


def build_mast(g, m):
    g.tube(m["metal"], (MAST_X, 0, ROOF + 0.75), (MAST_X, 0, HUB_Z), 0.16, 8)


def build_rotor(g, m, droop=0.30, phase=math.radians(18)):
    """Hub and five blades around the origin (the hub); turns about Z."""
    g.prism(m["metal"], (0, 0), 0.55, -0.12, 0.10, 5, phase)
    g.prism(m["metal"], (0, 0), 0.22, 0.10, 0.32, 6)
    for i in range(5):
        a = phase + 2 * math.pi * i / 5
        d = Vector((math.cos(a), math.sin(a), 0))
        root = d * 0.55
        tip = d * ROTOR_R + Vector((0, 0, -droop))
        knee = root.lerp(tip, 0.94)
        # Blades at rest droop toward the tip; flat boards with a yellow tip
        g.beam(m["blade"], root, knee, 0.58, 0.07)
        g.beam(m["yellow"], knee, tip, 0.58, 0.07)


def build_disc(g, mat, r, n=24, cone=0.0, axis="z"):
    """Flat ring the blades sweep when they spin fast: a stand-in for motion
    blur, drawn with a radial streak texture (planar UVs from -r..r to 0..1).
    Hidden while the rotor turns slowly."""
    r0 = 0.5
    vs, uvs = [], []
    for rr, dz in ((r0, 0.0), (r, cone)):
        for i in range(n):
            t = 2 * math.pi * i / n
            u, v = rr * math.cos(t), rr * math.sin(t)
            vs.append(Vector((u, v, dz)) if axis == "z" else Vector((u, dz, v)))
            uvs.append((0.5 + u / (2 * r), 0.5 + v / (2 * r)))
    fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    if axis != "z":
        fs = [tuple(reversed(f)) for f in fs]
    g.add(mat, vs, fs)
    g.uvs = getattr(g, "uvs", {})
    g.uvs.setdefault(mat, []).extend(uvs)


# Landing gear legs: (part, pivot, wheel centre below it, wheels as (dy, radius, width)).
# Retracting swings each leg forward about Y, nose wheels into the nose,
# main wheels into the sponsons.
GEAR = [("NoseGear", Vector((4.55, 0, 1.15)), 0.30, ((0.17, 0.30, 0.22), (-0.17, 0.30, 0.22))),
        ("MainGearL", Vector((-0.30, 1.43, 1.05)), 0.34, ((0.0, 0.34, 0.26),)),
        ("MainGearR", Vector((-0.30, -1.43, 1.05)), 0.34, ((0.0, 0.34, 0.26),))]
GEAR_SWING = math.radians(-90)  # gear up: legs point forward


def build_leg(g, m, pivot, wheel_z, wheels):
    """One gear leg around its pivot (the origin), pointing down."""
    drop = wheel_z - pivot.z
    side = 0.0 if pivot.y == 0 else -math.copysign(0.17, pivot.y)  # strut inboard of a main wheel
    g.beam(m["metal"], (0, side, 0.05), (0, side, drop), 0.12)
    for dy, r, w in wheels:
        g.tube(m["tyre"], (0, dy - w / 2, drop), (0, dy + w / 2, drop), r, 10)


def build_lights(g, m):
    g.prism(m["red"], (-1.8, 0), 0.08, ROOF + 0.55, ROOF + 0.67, 6)       # beacon on the cowling
    g.prism(m["red"], (0.6, 0), 0.08, 0.50, 0.58, 6)                      # belly beacon
    g.box(m["red"], (-0.2, 1.61, 1.05), (0.12, 0.04, 0.08))              # port (left): red
    g.box(m["green"], (-0.2, -1.61, 1.05), (0.12, 0.04, 0.08))           # starboard: green


def _part_object(name, g, pivot, parent, collection):
    """One object per moving part, all its materials as slots. The geometry
    is built around the origin and the object sits at its pivot."""
    me = bpy.data.meshes.new(name)
    vs, fs, mats = [], [], []
    for mat, (pv, pf) in g.parts.items():
        o = len(vs)
        vs += [Vector(v) for v in pv]
        fs += [tuple(i + o for i in f) for f in pf]
        mats += [len(me.materials)] * len(pf)
        me.materials.append(mat)
    me.from_pydata([tuple(v) for v in vs], [], fs)
    for poly, mi in zip(me.polygons, mats):
        poly.material_index = mi
    if getattr(g, "uvs", None):
        layer = me.uv_layers.new(name="UVMap")
        flat = [(0.5, 0.5)] * len(vs)
        o = 0
        for mat, (pv, pf) in g.parts.items():
            for i, t in enumerate(g.uvs.get(mat, [])):
                flat[o + i] = t
            o += len(pv)
        for loop in me.loops:
            layer.data[loop.index].uv = flat[loop.vertex_index]
    me.validate()
    ob = bpy.data.objects.new(name, me)
    ob.location = pivot
    ob.parent = parent
    collection.objects.link(ob)
    return ob


def build_helicopter(m, collection=None, loc=(0, 0, 0), yaw=0.0, livery=None, droop=0.30, discs=True):
    """Build one helicopter into collection as a root empty with its moving
    parts as children; returns (root, parts, triangles). loc is the ground
    point under the mast, yaw turns the nose from +X. Parts: Body,
    MainRotor (turns about local Z), TailRotor (about local Y), MainDisc and
    TailDisc (blur discs, hidden), NoseGear, MainGearL, MainGearR (swing
    about local Y; see pose())."""
    collection = collection or bpy.context.collection
    liv = LIVERIES[livery or LIVERY]
    root = bpy.data.objects.new("Helicopter", None)
    root.location, root.rotation_euler = loc, (0, 0, yaw)
    collection.objects.link(root)
    meshes = {}

    def part(name):
        return meshes.setdefault(name, op.Mesh())

    body = part("Body")
    build_fuselage(body, m, liv)
    build_cabin_details(body, m, liv)
    build_tail(body, m, liv)
    build_mast(body, m)
    build_lights(body, m)
    build_rotor(part("MainRotor"), m, droop)
    build_tail_rotor(part("TailRotor"), m, liv)
    pivots = {"Body": Vector(), "MainRotor": Vector((MAST_X, 0, HUB_Z)), "TailRotor": TAIL_HUB}
    for name, pivot, wz, wheels in GEAR:
        build_leg(part(name), m, pivot, wz, wheels)
        pivots[name] = pivot
    if discs:
        build_disc(part("MainDisc"), m["disc"], ROTOR_R)
        build_disc(part("TailDisc"), m["disc"], TAIL_R, 12, axis="y")
        pivots["MainDisc"], pivots["TailDisc"] = pivots["MainRotor"], TAIL_HUB + Vector((0, 0.02, 0))
    parts = {name: _part_object("Heli" + name, g, pivots[name], root, collection) for name, g in meshes.items()}
    for name in ("MainDisc", "TailDisc"):
        if name in parts:
            parts[name].hide_render = True
    tris = sum(g.tris for name, g in meshes.items() if "Disc" not in name)
    return root, parts, tris


def pose(parts, gear=1.0, rotor=0.0, tail=None):
    """gear 1 = down, 0 = up; rotor and tail are blade angles in radians."""
    for name, *_ in GEAR:
        parts[name].rotation_euler = (0, GEAR_SWING * (1 - gear), 0)
    parts["MainRotor"].rotation_euler = (0, 0, rotor)
    parts["TailRotor"].rotation_euler = (0, rotor * 5.0 if tail is None else tail, 0)


def export_glb(m, path, livery=None):
    """The default livery on its own, parts named for the browser to animate."""
    coll = bpy.data.collections.new("Export")
    bpy.context.scene.collection.children.link(coll)
    root, parts, _ = build_helicopter(m, coll, livery=livery)
    for o in parts.values():
        o.hide_render = False
    bpy.ops.object.select_all(action="DESELECT")
    for o in coll.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=False, export_yup=True)
    print("wrote", path, flush=True)
    bpy.data.collections.remove(coll)


# Where it parks: on the H of the platform's helideck, nose toward the quarters
DECK_LOC = (op.HELI_X - 0.8, 0.0, op.HELI_Z + 0.04)
DECK_YAW = math.pi


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--res", type=int, default=1280)
    p.add_argument("--out", default=os.path.join(b.BUILD, "helicopter"))
    p.add_argument("--device", default="auto")
    p.add_argument("--only", default="", help="comma list of shots to render")
    p.add_argument("--glb", action="store_true", help="also export the default livery to helicopter.glb")
    args = p.parse_args()
    os.makedirs(args.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = b.pick_device(args.device)
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"

    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    scene.world = world
    sun_d = bpy.data.lights.new("Sun", "SUN")
    sun_d.angle = math.radians(2)
    sun = bpy.data.objects.new("Sun", sun_d)
    sun.rotation_euler = (math.radians(45), 0, math.radians(-40))
    scene.collection.objects.link(sun)

    def cam(name, loc, aim, lens):
        d = bpy.data.cameras.new(name)
        d.lens, d.clip_end = lens, 5000
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)
        return o

    colls = {}

    def show(coll):
        for c in colls.values():
            c.hide_render = c is not coll

    def shot(c, name, w, h):
        if args.only and name not in args.only.split(","):
            return
        scene.camera = c
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.render.filepath = os.path.join(args.out, name + ".jpg")
        scene.render.image_settings.file_format = "JPEG"
        bpy.ops.render.render(write_still=True)
        print("wrote", scene.render.filepath, flush=True)

    m = materials()
    if args.glb:  # first, so the part names carry no .001 suffixes
        export_glb(m, os.path.join(args.out, "helicopter.glb"))
    # Studio: all liveries in a row, and each one alone
    floor_m = b.mat_flat("Floor", (0.35, 0.36, 0.37), 0.8)
    studio = colls["studio"] = bpy.data.collections.new("Studio")
    scene.collection.children.link(studio)
    g = op.Mesh()
    g.span(floor_m, -60, 60, -60, 60, -0.1, 0)
    g.objects("Floor", studio)
    names = list(LIVERIES)
    studio_parts = {}
    for i, name in enumerate(names):
        c = colls[name] = bpy.data.collections.new("Studio_" + name)
        scene.collection.children.link(c)
        _, parts, tris = build_helicopter(m, c, (0, 0, 0), 0.0, name)
        studio_parts[name] = parts
        g = op.Mesh()
        g.span(floor_m, -60, 60, -60, 60, -0.1, 0)
        g.objects("Floor_" + name, c)
        print(f"helicopter ({name}): {tris} triangles", flush=True)
    line = colls["lineup"] = bpy.data.collections.new("Lineup")
    scene.collection.children.link(line)
    for i, name in enumerate(names):
        build_helicopter(m, line, ((i - 1.5) * 16.0, (i - 1.5) * -2.0, 0), math.radians(-25), name)
    g = op.Mesh()
    g.span(floor_m, -80, 80, -60, 60, -0.1, 0)
    g.objects("Floor_lineup", line)

    w = args.res
    bg.inputs["Color"].default_value = (0.72, 0.78, 0.86, 1)
    bg.inputs["Strength"].default_value = 1.0
    sun_d.energy = 3.0
    set_night(m, False)
    show(line)
    shot(cam("Lineup", (6, -58, 17), (0, 0, 2.0), 35), "lineup", w, w * 9 // 16)
    for name in names:
        show(colls[name])
        shot(cam("Q_" + name, (13, -15, 5.5), (0, 0, 2.2), 35), "quarter-" + name, w, w * 9 // 16)
    show(colls[LIVERY])
    shot(cam("Side", (-1.5, -40, 2.6), (-1.5, 0, 2.6), 50), "side", w, w * 9 // 16)
    shot(cam("Rear", (-18, 12, 7), (-2, 0, 2.5), 35), "rear", w, w * 9 // 16)
    shot(cam("Top", (0, 0, 40), (0, 0.01, 0), 35), "top", w, w * 9 // 16)
    # Gear up, and the rotors spinning at flight speed with real motion blur
    # (the reference look for the web's blur discs)
    hp = studio_parts[LIVERY]
    pose(hp, gear=0.0)
    shot(cam("GearUp", (11, -13, 1.2), (0, 0, 1.6), 35), "gear-up", w, w * 9 // 16)
    pose(hp, gear=1.0)
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5           # 1/50 s at 25 fps
    scene.render.fps = 25
    rev = 2 * math.pi * 4.8 / 25                     # main rotor ~290 rpm, per frame
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for f in (0, 1, 2):
        pose(hp, rotor=(f - 1) * rev, tail=(f - 1) * rev * 5.4)
        for n in ("MainRotor", "TailRotor"):
            hp[n].keyframe_insert("rotation_euler", frame=f)
    for n in ("MainRotor", "TailRotor"):
        hp[n].cycles.motion_steps = 6                # follow the arc, not a straight smear
    scene.frame_set(1)
    shot(cam("Spin", (13, -15, 5.5), (0, 0, 2.2), 35), "spin-blur", w, w * 9 // 16)
    scene.render.use_motion_blur = False

    # On the helideck, seen from the platform's helideck CCTV camera, per livery
    pm = op.materials()
    for name in names:
        c = colls["deck-" + name] = bpy.data.collections.new("Deck_" + name)
        scene.collection.children.link(c)
        op.build_platform(pm, c)
        build_helicopter(m, c, DECK_LOC, DECK_YAW, name)
    sea_m = b.mat_flat("Sea", (0.01, 0.03, 0.04), 0.15)
    for name in names:
        g = op.Mesh()
        g.span(sea_m, -2000, 2000, -2000, 2000, -0.1, 0)
        g.objects("Sea_" + name, colls["deck-" + name])
    bg.inputs["Color"].default_value = (0.55, 0.65, 0.78, 1)
    for name in names:
        show(colls["deck-" + name])
        shot(cam("Deck_" + name, (44, -16, 86), (68, 2, 73), 20), "deck-" + name, w, w * 9 // 16)
    show(colls["deck-" + LIVERY])
    shot(cam("DeckWide", (150, -120, 95), (60, 0, 70), 50), "deck-wide", w, w * 9 // 16)
    # Night on the helideck camera: deck lights, beacons and nav lights
    bg.inputs["Color"].default_value = (0.01, 0.015, 0.03, 1)
    sun_d.energy = 0.04
    set_night(m, True)
    op.set_night(pm, True)
    shot(cam("DeckNight", (44, -16, 86), (68, 2, 73), 20), "deck-night", w, w * 9 // 16)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, "helicopter.blend"))


if __name__ == "__main__":
    main()
