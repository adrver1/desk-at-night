"""
control_buddy: CtrlBuddy, the AI agent mascot from Adriaen's talk, as a
low-poly robot. A tall domed head with ear bolts, wide dark shades under
frowning brows, a big triangle nose and a flat mouth, short sleeves pointing out over
the shoulders, a grey tabard with a name badge, and segmented arms with
joint rings. Its team-mates share the body and swap the badge and hat:
the Scholar (COMPILER, mortarboard and bow tie), the Nurse (LINTER,
nurse cap and a first-aid patch) and Frankenbot (FRANKENBOT, the merged
knowledge bases' agent, after Adriaen's drawing: a square head with a black
flat-top, bolts sticking out above the ears, stitched scars on the face,
down the chest and round the arms, a riveted patch).

    python characters/control_buddy/build_control_buddy.py [--form walker|hover|desk|all]
                                                           [--role buddy|scholar|nurse|franken|all]

Forms (all kept; FORM picks the live one):
    walker  full size on legs, a crew member who walks and sits
    hover   full size, the legs swapped for a thruster: it floats
    desk    a 30 cm bust on a puck, a desk toy next to the keyboard

Every part is rigid on the shared humanoid rig, so the crew's clips
(idle, walk, point, talk, blink...) play on it. A robot has no skin to
bend: each vertex follows exactly one bone.
"""
import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import base_body as base  # noqa: E402  (imports bpy)
import bpy  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402

Mesh, X, Y, Z = base.Mesh, base.X, base.Y, base.Z
FORM = "hover"
# What covers the shoulders: "sleeves" (short sleeves of the tabard pointing
# straight out sideways, as on the presentation pictures; rooted on the chest,
# following the arm)
# or "flaps" (the earlier collar wedges)
SHOULDERS = "sleeves"
FORMS, ROLES = ("walker", "hover", "desk"), ("buddy", "scholar", "nurse", "franken")
DESK_SCALE, DESK_HEAD = 0.3, 1.6

# Colours
NOSE = "grey"   # a shade darker than the head, so the triangle reads from the front
METAL, DARK, TABARD, COLLAR, LENS, INK = "light_grey", "charcoal", "light_grey", "light_grey", "lens", "black"

# Head: rings of (z, half width, half depth, forward offset, region),
# a tall rounded box with a dome on top, as drawn
HEAD = [(1.470, 0.105, 0.098, 0.0, "head"),
        (1.490, 0.122, 0.112, 0.0, "head"),
        (1.740, 0.124, 0.114, 0.0, "head"),
        (1.805, 0.108, 0.100, 0.0, "head"),
        (1.850, 0.072, 0.068, 0.0, "head"),
        (1.868, 0.030, 0.028, 0.0, "head")]
# Frankenbot's head: the dome sawn off flat
HEAD_FLAT = HEAD[:3] + [(1.800, 0.122, 0.112, 0.0, "head"), (1.808, 0.112, 0.102, 0.0, "head")]
FACE_Y = 0.112          # the flat front of the head
EYE_Z, MOUTH_Z = 1.640, 1.548
TORSO = [(0.84, 0.150, 0.098, 0.0, "pelvis"),
         (0.95, 0.152, 0.100, 0.0, "torso"),
         (1.18, 0.180, 0.112, 0.0, "torso"),
         (1.34, 0.190, 0.105, 0.0, "torso"),
         (1.42, 0.110, 0.080, 0.0, "torso")]
TABARD_W, TABARD_TOP, TABARD_BOTTOM = 0.135, 1.40, 0.78
BADGE_Z = 1.31          # name badge high on the chest, as drawn
# 8-sided rings with wide flat faces front, back and sides: boxy metal
BOX8 = (25, 65, 115, 155, 205, 245, 295, 335)

# 3x5 pixel letters for the badges ('#' = filled)
FONT = {
    "B": ["##.", "#.#", "##.", "#.#", "##."], "C": ["###", "#..", "#..", "#..", "###"],
    "D": ["##.", "#.#", "#.#", "#.#", "##."], "E": ["###", "#..", "##.", "#..", "###"],
    "I": ["###", ".#.", ".#.", ".#.", "###"], "L": ["#..", "#..", "#..", "#..", "###"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#"], "N": ["#..#", "##.#", "#.##", "#..#", "#..#"],
    "O": ["###", "#.#", "#.#", "#.#", "###"], "P": ["##.", "#.#", "##.", "#..", "#.."],
    "R": ["##.", "#.#", "##.", "#.#", "#.#"], "T": ["###", ".#.", ".#.", ".#.", ".#."],
    "U": ["#.#", "#.#", "#.#", "#.#", "###"], "Y": ["#.#", "#.#", ".#.", ".#.", ".#."],
    "A": [".#.", "#.#", "###", "#.#", "#.#"], "F": ["###", "#..", "##.", "#..", "#.."],
    "K": ["#.#", "#.#", "##.", "#.#", "#.#"],
}
BADGE = {"buddy": "CTRLBUDDY", "scholar": "COMPILER", "nurse": "LINTER", "franken": "FRANKENBOT"}


def box(m, lo, hi, swatch, region):
    """Axis-aligned box from corner lo to corner hi."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    return m.hull([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], swatch, region)


def quad_y(m, x0, x1, z0, z1, y, swatch, region):
    """Flat rectangle facing +Y at depth y: badge plates and letters."""
    m.face([(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)], swatch, region)


def text(m, word, cx, cz, height, y, swatch="black", region="letters"):
    """A word in the pixel font, centred on (cx, cz), as merged rectangles:
    runs per row, stacked down while the run below is the same."""
    px = height / 5
    widths = [len(FONT[ch][0]) for ch in word]
    total = (sum(widths) + len(word) - 1) * px
    x = cx - total / 2
    for ch, w in zip(word, widths):
        rows = FONT[ch]
        runs = []
        for r, row in enumerate(rows):
            c = 0
            while c < w:
                if row[c] == "#":
                    s = c
                    while c < w and row[c] == "#":
                        c += 1
                    runs.append((r, s, c))
                else:
                    c += 1
        used = set()
        for r, s, e in runs:
            if (r, s, e) in used:
                continue
            r1 = r
            while (r1 + 1, s, e) in runs:
                r1 += 1
                used.add((r1, s, e))
            # the viewer faces -Y, so reading left to right runs towards -X
            quad_y(m, 2 * cx - (x + e * px), 2 * cx - (x + s * px), cz + height / 2 - (r1 + 1) * px, cz + height / 2 - r * px,
                   y, swatch, region)
        x += (w + 1) * px
    return total


# ---------------------------------------------------------------- the head
def flat_bar(m, a, b, w, y, region):
    """A dark strip painted on a flat front at depth y (no relief): a quad
    from a to b (x, z), w wide."""
    d = (b - a).normalized()
    n = Vector((-d.y, d.x)) * (w / 2)
    pts = [a - n, a + n, b + n, b - n]
    m.face([(p.x, y, p.y) for p in pts][::-1], INK, region)


def scar(m, a, b, stitches, y=FACE_Y + 0.0012, region="scar"):
    """A stitched scar painted on a flat front: a dark seam from a to b
    (x, z) at depth y, with short crossing stitches. Flat quads, like the
    badge letters, so it reads as a texture rather than raised geometry."""
    from mathutils import Vector as V2
    a, b = V2((a[0], a[1])), V2((b[0], b[1]))
    flat_bar(m, a, b, 0.006, y, region)
    d = (b - a).normalized()
    n = V2((-d.y, d.x)) * 0.013
    for i in range(stitches):
        c = a + (b - a) * ((i + 0.5) / stitches)
        flat_bar(m, c - n, c + n, 0.0045, y + 0.0004, region)


def face_scar(m, bvh, a, b, stitches, w=0.006):
    """A stitched scar painted onto the head: the seam cut into short pieces
    and each piece, like each stitch, projected onto the surface from the
    front, so it lies on the facets as it crosses them."""
    from mathutils import Vector as V2
    a, b = V2(a), V2(b)
    d = (b - a).normalized()
    n = V2((-d.y, d.x))

    def strip(p, q, width, lift):
        k = (q - p).normalized()
        k = V2((-k.y, k.x)) * (width / 2)
        pts = [p - k, q - k, q + k, p + k]
        m.decal_poly(bvh, [(v.x, v.y) for v in pts], INK, "scar", lift=lift)
    pieces = max(1, round((b - a).length / 0.02))
    for i in range(pieces):
        strip(a + (b - a) * (i / pieces), a + (b - a) * ((i + 1) / pieces), w, 0.002)
    for i in range(stitches):
        c = a + (b - a) * ((i + 0.5) / stitches)
        strip(c - n * 0.013, c + n * 0.013, 0.0045, 0.0026)


def arm_seam(m, o, u, v, w, t, r, region):
    """A stitched seam painted round a hex arm at t: on each of the six flat
    faces a thin band across and two stitches along the arm."""
    ap = r * math.cos(math.radians(30)) + 0.0012     # just off the face
    half = r * math.sin(math.radians(30))            # half a face's width
    for k in range(6):
        a = math.radians(30 + 60 * k)
        nrm, tan = u * math.cos(a) + v * math.sin(a), -u * math.sin(a) + v * math.cos(a)
        c = o + w * t + nrm * ap
        quad = lambda along, across, wa, wc: [c + w * along + tan * across + w * da * wa + tan * dc * wc  # noqa: E731
                                              for da, dc in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        m.face(quad(0, 0, 0.003, half), INK, region)
        for s in (-0.45, 0.45):
            m.face([p + nrm * 0.0004 for p in quad(0, s * half, 0.016, 0.0025)], INK, region)


def frankenstein(m):
    """As in Adriaen's drawing: a black flat-top with a jagged fringe, a bolt
    through the head sticking out above each ear, a stitched seam across the
    forehead and another down the cheek from the shades."""
    bvh = m.bvh()          # the bare head, for painting the scars onto
    # the flat-top: round in plan like the head, flat on top, its lower
    # edge cut into a jagged fringe all the way round
    top, z0, n = HEAD_FLAT[-1][0] + 0.030, 1.752, 20
    angles = [360 * i / n for i in range(n)]
    m.tube([(z0, 0.130, 0.120, 0.0, "hair"), (top, 0.130, 0.120, 0.0, "hair")], angles=angles,
           swatch="hair_black", cap_start=False)
    for i in range(n):
        a0, a1 = (math.radians(d) for d in (angles[i], angles[(i + 1) % n]))
        am = (a0 + a1) / 2
        rim = lambda a, z, k=1.0: (0.130 * k * math.cos(a), 0.120 * k * math.sin(a), z)  # noqa: E731
        m.face([rim(a0, z0), rim(am, z0 - 0.024, 0.985), rim(a1, z0)], "hair_black", "hair")
    for sx in (1, -1):
        m.bar((sx * 0.100, 0.0, 1.715), (sx * 0.178, 0.0, 1.715), 0.020, "steel", "ear_bolt")
        box(m, (sx * 0.162, -0.024, 1.691), (sx * 0.186, 0.024, 1.739), DARK, "ear_bolt")
    face_scar(m, bvh, (-0.108, 1.712), (0.090, 1.700), 7)
    face_scar(m, bvh, (-0.092, 1.612), (-0.080, 1.512), 4)


def head(role):
    m = Mesh().tube(HEAD_FLAT if role == "franken" else HEAD, angles=BOX8, swatch=METAL)
    if role == "franken":
        frankenstein(m)
    else:
        # ear bolts: flat boxes on the sides at eye height, a dark ring under each
        for s in (1, -1):
            box(m, (s * 0.118, -0.045, 1.575), (s * 0.150, 0.035, 1.680), METAL, "ear_bolt")
            box(m, (s * 0.150, -0.030, 1.595), (s * 0.160, 0.020, 1.660), DARK, "ear_bolt")
    # shades: two wide rectangular lenses on a bridge, standing off the face
    y0, y1 = FACE_Y, FACE_Y + 0.018
    for s in (1, -1):
        box(m, (s * 0.012, y0, EYE_Z - 0.022), (s * 0.092, y1, EYE_Z + 0.022), LENS, "lens")
    box(m, (-0.014, y0, EYE_Z + 0.004), (0.014, y1 - 0.004, EYE_Z + 0.018), LENS, "lens")
    # frowning brows: bars over the lenses, inner ends low
    for s in (1, -1):
        a = Vector((s * 0.018, y1 - 0.004, EYE_Z + 0.030))
        b = Vector((s * 0.088, y1 - 0.004, EYE_Z + 0.052))
        m.loft([[p + d for d in (Vector((0, 0, -0.006)), Vector((0, 0.008, -0.006)),
                                 Vector((0, 0.008, 0.006)), Vector((0, 0, 0.006)))] for p in (a, b)],
               DARK, f"brow.{'R' if s > 0 else 'L'}")
    # nose: a big triangular wedge under the bridge, as drawn
    m.hull([(0.030, FACE_Y - 0.004, 1.572), (-0.030, FACE_Y - 0.004, 1.572),
            (0.0, FACE_Y - 0.004, 1.620), (0.0, FACE_Y + 0.042, 1.578)], NOSE, "nose")
    # mouth: a short flat slot, rigid on the jaw so `talk` moves it
    box(m, (-0.026, FACE_Y - 0.002, MOUTH_Z - 0.004), (0.026, FACE_Y + 0.004, MOUTH_Z + 0.004), INK, "mouth")
    top = HEAD[-2][0]
    if role == "scholar":
        # mortarboard: a cap hugging the dome, a flat square board, a tassel
        m.tube([(1.79, 0.112, 0.104, 0, "hat"), (1.88, 0.090, 0.086, 0, "hat")], angles=BOX8,
               swatch=INK, cap_start=False)
        board = [Vector((0.0, 0.0, 1.89)) + Vector((math.cos(a) * 0.21, math.sin(a) * 0.21, 0))
                 for a in (math.radians(d) for d in (0, 90, 180, 270))]
        m.loft([board, [p + Z * 0.012 for p in board]], INK, "hat")
        m.bar((0, 0, 1.902), (0.14, 0.03, 1.902), 0.004, "gold", "hat")
        m.bar((0.14, 0.03, 1.902), (0.15, 0.04, 1.80), 0.006, "gold", "hat")
    elif role == "nurse":
        # nurse cap as drawn: perched on the dome, flaring wider towards
        # its flat top, with a red cross on the slanted front
        z0, z1 = 1.792, 1.905
        lo, hi = (0.106, 0.098), (0.130, 0.108)
        box_pts = [(sx * lo[0], sy * lo[1], z0) for sx in (-1, 1) for sy in (-1, 1)]
        box_pts += [(sx * hi[0], sy * hi[1], z1) for sx in (-1, 1) for sy in (-1, 1)]
        m.hull(box_pts, "white", "hat")

        def front(x, z):  # a point just proud of the cap's slanted front
            t = (z - z0) / (z1 - z0)
            return (x, lo[1] + (hi[1] - lo[1]) * t + 0.002, z)
        cz, a1, a2 = 1.852, 0.009, 0.030
        for x0, x1, za, zb in ((-a1, a1, cz - a2, cz + a2), (-a2, -a1, cz - a1, cz + a1), (a1, a2, cz - a1, cz + a1)):
            m.face([front(x0, za), front(x0, zb), front(x1, zb), front(x1, za)], "signal_red", "hat")
    return m


# ------------------------------------------------------------------ the body
def torso(role, form):
    rings = TORSO if form == "walker" else TORSO[1:]
    m = Mesh().tube(rings, angles=BOX8, swatch=METAL)
    m.tube([(1.38, 0.058, 0.055, 0, "neck"), (1.50, 0.050, 0.048, 0, "neck")], angles=base.HEX6,
           swatch=DARK, cap_start=False, cap_end=False)
    if SHOULDERS == "flaps":
        # collar flaps: one metal wedge over each shoulder, from the side of the neck
        # to a point past the top of the arm, its lower edge running back into
        # the side of the tabard (the tabard itself goes up to the neck)
        for sd in (1, -1):
            flap = []
            for y in (0.128, -0.128):
                flap += [(sd * 0.062, y * 0.80, 1.425), (sd * 0.062, y * 0.80, 1.395),
                         (sd * TABARD_W, y * 0.9, 1.262), (sd * 0.300, y * 0.45, 1.315), (sd * 0.290, y * 0.45, 1.290)]
            m.hull(flap, COLLAR, "collar")
    if SHOULDERS == "sleeves":
        for sd in (1, -1):
            m.extend(sleeve(sd))
    # tabard: a flat white panel front and back with a black name badge
    front = 0.118
    bottom = TABARD_BOTTOM if form == "walker" else 0.92
    for side in (1, -1):
        y0 = side * front
        y1 = side * (front + 0.014)
        box(m, (-TABARD_W, min(y0, y1), bottom), (TABARD_W, max(y0, y1), TABARD_TOP), TABARD, "tabard")
    fy = front + 0.0145
    bw = {"buddy": 0.205, "scholar": 0.19, "nurse": 0.14, "franken": 0.225}[role]
    # the Linter wears scrubs: a V-neck, the badge off to its right (the
    # viewer's left) under the V, and a first-aid pocket on the other side
    bx, bz = (0.048, 1.262) if role == "nurse" else (0.0, BADGE_Z)
    quad_y(m, bx - bw / 2 - 0.008, bx + bw / 2 + 0.008, bz - 0.028, bz + 0.028, fy, INK, "badge")
    quad_y(m, bx - bw / 2, bx + bw / 2, bz - 0.022, bz + 0.022, fy + 0.0015, "white", "badge")
    text(m, BADGE[role], bx, bz, 0.026, fy + 0.003)
    if role == "nurse":
        m.face([(0.0, fy, 1.312), (-0.062, fy, TABARD_TOP), (0.062, fy, TABARD_TOP)], NOSE, "tabard")
        px0, px1, pz0, pz1 = -0.118, -0.042, 1.168, 1.258    # first-aid pocket
        quad_y(m, px0, px1, pz0, pz1, fy, INK, "badge")
        quad_y(m, px0 + 0.005, px1 - 0.005, pz0 + 0.005, pz1 - 0.005, fy + 0.0015, "white", "badge")
        cx, cz = (px0 + px1) / 2, (pz0 + pz1) / 2
        quad_y(m, cx - 0.007, cx + 0.007, cz - 0.026, cz + 0.026, fy + 0.003, "signal_red", "badge")
        quad_y(m, cx - 0.026, cx + 0.026, cz - 0.007, cz + 0.007, fy + 0.003, "signal_red", "badge")
    if role == "franken":
        # a stitched seam down the chest and a riveted patch, as drawn
        scar(m, (-0.122, TABARD_TOP - 0.01), (-0.118, 0.94), 9, y=fy + 0.0012, region="tabard")
        px0, px1, pz0, pz1 = 0.050, 0.118, 1.000, 1.068
        quad_y(m, px0, px1, pz0, pz1, fy + 0.002, "grey", "tabard")
        for x in (px0 + 0.009, px1 - 0.009):
            for z in (pz0 + 0.009, pz1 - 0.009):
                box(m, (x - 0.004, fy + 0.002, z - 0.004), (x + 0.004, fy + 0.007, z + 0.004), DARK, "tabard")
    if role == "scholar":  # bow tie at the collar
        m.hull([(0, 0.112, 1.385), (0.055, 0.118, 1.415), (0.055, 0.118, 1.355), (0, 0.125, 1.385)], INK, "bowtie")
        m.hull([(0, 0.112, 1.385), (-0.055, 0.118, 1.415), (-0.055, 0.118, 1.355), (0, 0.125, 1.385)], INK, "bowtie")
        box(m, (-0.012, 0.115, 1.373), (0.012, 0.130, 1.397), INK, "bowtie")
    return m


def sleeve(side):
    """Short sleeve of the tabard. Built on the torso, its root follows the
    chest and the rest the upper arm (bone_for). As drawn it points straight out sideways: its top runs
    level from the neckline to a point past the shoulder, and its opening
    is cut at a slant back in to the armpit, where the arm comes out."""
    u, v, w = -Z, Y, X          # u down, v forward, w out along the shoulder
    o = Vector((0.0, 0.0, 1.335))
    angles = [math.radians(a) for a in range(0, 360, 45)]

    def ring(t_mid, t_slant, ru, rv, flare, shrink=1.0):
        pts = []
        for a in angles:
            top = max(0.0, -math.cos(a))           # 1 on top
            t = t_mid - t_slant * math.cos(a)
            k = shrink * (1 + flare * top ** 2)
            pts.append(o + w * t + u * (ru * k * math.cos(a)) + v * (rv * k * math.sin(a)))
        return pts
    m = Mesh().loft([ring(0.10, 0.0, 0.075, 0.105, 0.0), ring(0.255, 0.050, 0.085, 0.112, 0.15),
                     ring(0.250, 0.047, 0.085, 0.112, 0.15, shrink=0.75)], COLLAR, "sleeve")
    return m if side > 0 else m.mirrored()


def arm(side, role="buddy"):
    """Segmented arm in the A-pose with a dark ring at shoulder, elbow and
    wrist, and a blocky hand with a thumb. Frankenbot's are sewn on: a
    stitched seam round the upper arm and the forearm."""
    u, v, w = base.frame(base.arm_dir(1))
    o = base.SHOULDER
    m = Mesh()
    m.tube([(-0.02, 0.066, 0.066, 0, "upper_arm"), (0.235, 0.060, 0.060, 0, "upper_arm")], origin=o,
           axes=(u, v, w), angles=base.HEX6, swatch=METAL)
    m.tube([(0.265, 0.058, 0.058, 0, "forearm"), (0.465, 0.052, 0.052, 0, "forearm")], origin=o,
           axes=(u, v, w), angles=base.HEX6, swatch=METAL)
    for t, r, reg in ((0.25, 0.074, "elbow"), (0.475, 0.064, "wrist")):
        m.tube([(t - 0.018, r, r, 0, reg), (t + 0.018, r, r, 0, reg)], origin=o, axes=(u, v, w),
               angles=base.HEX6, swatch=DARK)
    # hand: a mitten block flat in the plane of the arm, thumb forward
    c = o + w * 0.49
    pts = []
    for t, hw, hd in ((0.0, 0.034, 0.050), (0.10, 0.030, 0.056), (0.15, 0.020, 0.042)):
        for su in (-1, 1):
            for sv in (-1, 1):
                pts.append(c + w * t + u * (su * hw) + v * (sv * hd))
    m.hull(pts, METAL, "hand")
    if role == "franken":
        arm_seam(m, o, u, v, w, 0.12, 0.0635, "upper_arm")
        arm_seam(m, o, u, v, w, 0.37, 0.0545, "forearm")
    tb = c + w * 0.03 + v * 0.050
    m.hull([tb - u * 0.014, tb + u * 0.014, tb - w * 0.02 - u * 0.012, tb - w * 0.02 + u * 0.012,
            tb + w * 0.05 + v * 0.025], METAL, "hand")
    return m if side > 0 else m.mirrored()


def leg(side):
    m = Mesh()
    x = base.LEG_X * 1.05
    m.tube([(0.90, 0.075, 0.078, 0, "thigh"), (0.50, 0.066, 0.068, 0, "thigh")], origin=(x, 0, 0),
           angles=base.HEX6, swatch=METAL, axes=(X, Y, Z))
    m.tube([(0.45, 0.062, 0.064, 0, "shin"), (0.11, 0.058, 0.060, 0, "shin")], origin=(x, 0, 0),
           angles=base.HEX6, swatch=METAL)
    m.tube([(0.445, 0.082, 0.084, 0, "knee"), (0.505, 0.082, 0.084, 0, "knee")], origin=(x, 0, 0),
           angles=base.HEX6, swatch=DARK)
    box(m, (x - 0.075, -0.09, 0.0), (x + 0.075, 0.17, 0.11), DARK, "boot")
    m.hull([(x - 0.075, 0.17, 0.0), (x + 0.075, 0.17, 0.0), (x - 0.07, 0.17, 0.09), (x + 0.07, 0.17, 0.09),
            (x - 0.07, 0.22, 0.0), (x + 0.07, 0.22, 0.0)], DARK, "boot")
    return m if side > 0 else m.mirrored()


def thruster():
    """Instead of legs: the torso tapers into a cone with a glowing ring."""
    m = Mesh()
    m.tube([(0.95, 0.152, 0.100, 0, "skirt"), (0.82, 0.120, 0.090, 0, "skirt"), (0.66, 0.065, 0.060, 0, "skirt")],
           angles=BOX8, swatch=METAL, cap_start=False, cap_end=False)
    m.tube([(0.66, 0.080, 0.080, 0, "skirt"), (0.60, 0.070, 0.070, 0, "skirt")], angles=base.HEX6, swatch=DARK)
    # a short cone of thrust under the nozzle
    m.tube([(0.598, 0.060, 0.060, 0, "glow"), (0.50, 0.0, 0.0, 0, "glow")], angles=base.HEX6,
           swatch="light_blue", cap_start=False, cap_end=False)
    return m


def puck():
    """Round desk stand for the desk form, at full scale under the waist."""
    m = Mesh()
    m.tube([(0.84, 0.22, 0.20, 0, "stand"), (0.92, 0.21, 0.19, 0, "stand")], angles=BOX8,
           swatch=DARK)
    m.tube([(0.92, 0.15, 0.10, 0, "stand"), (0.96, 0.15, 0.10, 0, "stand")], angles=BOX8, swatch=METAL)
    return m


# --------------------------------------------------------------------- rig
ARM_PARTS = {"upper_arm", "elbow", "forearm", "wrist", "hand"}


def bone_for(region, co, form):
    """Each vertex follows exactly one bone."""
    tag = "R" if co.x > 0 else "L"
    if region in ARM_PARTS:
        if region == "upper_arm":
            return f"upper_arm.{tag}"
        return f"hand.{tag}" if region == "hand" else f"forearm.{tag}"
    if region == "sleeve":
        # the sleeve's root stays on the chest and the rest rides on the
        # upper arm, so it stretches like cloth when the arm waves instead
        # of the arm passing through it
        return "chest" if abs(co.x) < 0.15 else f"upper_arm.{tag}"
    if region in ("thigh",):
        return f"thigh.{tag}"
    if region in ("knee", "shin"):
        return f"shin.{tag}"
    if region == "boot":
        return f"foot.{tag}"
    if region.startswith("brow."):
        return region
    if region == "mouth":
        return "jaw"
    if region in ("head", "ear_bolt", "lens", "nose", "hat", "scar", "hair"):
        return "head"
    if region == "neck":
        return "neck" if co.z > 1.43 else "chest"
    if region in ("pelvis", "skirt", "glow", "stand"):
        return "root" if region == "stand" else "hips"
    # torso, tabard, collar, badge, letters, bowtie: split along the spine
    return "chest" if co.z > 1.17 else "spine" if co.z > 0.99 else "hips"


def rigid_skin(ob, arm_ob, form):
    regions = ob.data["regions"]
    attr = ob.data.attributes["region"].data
    owner = {}
    for poly in ob.data.polygons:
        reg = regions[attr[poly.index].value]
        for vi in poly.vertices:
            owner.setdefault(vi, reg)
    for vi, reg in owner.items():
        bn = bone_for(reg, ob.data.vertices[vi].co, form)
        vg = ob.vertex_groups.get(bn) or ob.vertex_groups.new(name=bn)
        vg.add([vi], 1.0, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_ob
    ob.parent = arm_ob


def akimbo(arm_ob):
    """Hands on the hips, elbows out, as on the slides."""
    pose = {}
    for side, tag in ((1, "R"), (-1, "L")):
        sh = Vector((side * base.SHOULDER.x, base.SHOULDER.y, base.SHOULDER.z))
        elbow = Vector((side * 0.40, -0.07, 1.18))
        wrist = Vector((side * 0.245, 0.0, 0.98))
        hip = Vector((side * 0.17, 0.08, 0.87))
        world = Quaternion()
        for bn, a, b in ((f"upper_arm.{tag}", sh, elbow), (f"forearm.{tag}", elbow, wrist),
                         (f"hand.{tag}", wrist, hip)):
            bone = arm_ob.data.bones[bn]
            rest = (bone.tail_local - bone.head_local).normalized()
            q_world = rest.rotation_difference((b - a).normalized())
            # local rotation in rest armature space, applied after the parent
            q = world.inverted() @ q_world
            world = q_world
            axis, ang = q.to_axis_angle()
            pose[bn] = (tuple(axis), math.degrees(ang))
    pose["head"] = ((0, 0, 1), 0)
    return pose


# ------------------------------------------------------------------- build
def build(form, role, out, renders=True):
    base.reset()
    parts = {"head": head(role), "torso": torso(role, form), "arm.R": arm(1, role), "arm.L": arm(-1, role)}
    if form == "walker":
        parts["leg.R"], parts["leg.L"] = leg(1), leg(-1)
    elif form == "hover":
        parts["thruster"] = thruster()
    else:
        parts["stand"] = puck()
        # a desk toy gets a bobble head
        parts["head"].verts = [Vector((p.x * DESK_HEAD, p.y * DESK_HEAD, 1.47 + (p.z - 1.47) * DESK_HEAD))
                               for p in parts["head"].verts]
    name = "control_buddy" if role == "buddy" else f"control_buddy_{role}"
    sfx = "" if form == FORM else f"_{form}"
    obs = [m.to_object(f"{name}{sfx}_{p}") for p, m in parts.items()]
    regions = sorted({r for ob in obs for r in ob.data["regions"]})
    for ob in obs:
        local = list(ob.data["regions"])
        for a in ob.data.attributes["region"].data:
            a.value = regions.index(local[a.value])
    bpy.ops.object.select_all(action="DESELECT")
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ch = obs[0]
    ch.name = ch.data.name = name + sfx
    ch.data["regions"] = regions
    tris = base.tri_count([ch])
    arm_ob = base.armature(f"{name}{sfx}_rig")
    rigid_skin(ch, arm_ob, form)
    if form == "desk":
        # a desk toy: the whole rig shrinks and the puck stands on z = 0
        arm_ob.scale = (DESK_SCALE,) * 3
        arm_ob.location.z = -0.84 * DESK_SCALE
    os.makedirs(out, exist_ok=True)
    if renders:
        cam = base.setup_render()
        kw = {} if form != "desk" else {"height": 0.22, "scale": 0.7}
        title = f"{name}{sfx}  ·  {tris} triangles"
        shots = base.render_views(cam, out, "t", **kw)
        base.pose(arm_ob, akimbo(arm_ob))
        shots += [(f"hands on hips {lbl}", p) for lbl, p in
                  base.render_views(cam, out, "a", [("front", 0), ("3/4", 35)], **kw)]
        base.pose(arm_ob, {})
        base.strip(shots, os.path.join(out, f"turnaround_{role}{sfx}.png"), title)
        hk = {"height": 1.66, "scale": 0.62} if form != "desk" else {"height": 0.42 * 1.0, "scale": 0.25}
        if form == "desk":
            hk["height"] = (1.47 + 0.19 * DESK_HEAD - 0.84) * DESK_SCALE
            hk["scale"] = 0.62 * DESK_HEAD * DESK_SCALE
        base.strip(base.render_views(cam, out, "c", base.VIEWS[:3], **hk),
                   os.path.join(out, f"closeup_{role}{sfx}.png"), "head close-up")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f"{name}{sfx}.blend"), compress=True)
    bpy.ops.object.select_all(action="DESELECT")
    ch.select_set(True)
    arm_ob.select_set(True)
    import anims
    anims.add_clips(arm_ob)
    path = os.path.join(out, f"{name}{sfx}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False,
                              export_animations=True, export_animation_mode="NLA_TRACKS",
                              export_frame_range=False)
    anims.split_channels(path)
    print(f"{name}{sfx}: {tris} triangles -> {out}")
    return tris


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--form", default="all", choices=[*FORMS, "all"])
    ap.add_argument("--role", default="all", choices=[*ROLES, "all"])
    ap.add_argument("--out", default=HERE)
    ap.add_argument("--no-renders", action="store_true")
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    for form in (FORMS if a.form == "all" else [a.form]):
        for role in (ROLES if a.role == "all" else [a.role]):
            build(form, role, a.out, not a.no_renders)
