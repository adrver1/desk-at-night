"""The bronze phoenix on the Føniks fountain, low poly, from Adriaen's 2026 photo.

A green-patina bird stands upright on a gilded flame-and-branch stand, wings raised
high over its head and hanging down to tips beside the stand, four round lamp lenses
down the outer edge of each wing, head turned to its left with a hooked beak. Its
gilded claws grip a branch; three branches carry flared cups with white globe lamps
(left, front, right). The stand rises from a braided bronze ring.

    import phoenix_sculpture
    phoenix_sculpture.build(M, cx, cy, z, variant)   # M = the scene's material dict

Built facing -y (out of Føniks's front) at (cx, cy) with the braided ring's underside at
z. Variants (TRD_PHOENIX) keep the asset library:
    A  plate wings: each wing one flat slab, the leanest
    B  feather fan: a covert plate over six long primary feathers fanned below it
    C  sculpted: scalloped trailing edge, raised arm ridge, three-strand braid (Adriaen's pick, 2026-10-30)
    old  the 2026-10-24 bird (wings half folded, pointing down)
"""
import math

import bmesh
import bpy

MATS = {"patina": ("#486656", 0.5), "lens_rim": ("#6e3b2f", 0.45), "lens": ("#c3cbc8", 0.2)}

# wing outline (out from the body's centre, height above the ring): up from the
# shoulder to the rounded top over the head, down the outer edge to the tip beside
# the stand, back up the trailing edge to the hip
WING = [(0.14, 1.42), (0.17, 1.66), (0.22, 1.90), (0.30, 2.08), (0.40, 2.17), (0.49, 2.16), (0.57, 2.06),
        (0.63, 1.82), (0.68, 1.50), (0.71, 1.20), (0.71, 0.90), (0.68, 0.68), (0.62, 0.55),
        (0.56, 0.62), (0.48, 0.78), (0.38, 0.98), (0.28, 1.15), (0.20, 1.28)]
LENSES = [(0.52, 1.92), (0.575, 1.72), (0.615, 1.52), (0.64, 1.32)]   # down the outer edge
HEAD_TURN = math.radians(25)   # to its left (+x)
SPAN = 1.2    # wing outline stretched outward: about 1.9 m across seen from the front
SCALE = 1.1   # the whole bird: about 2.3 m from the ring to the wing tops (fountain photos)


class _Kit:
    def __init__(self, M, cx, cy, z):
        self.M, self.o = M, (cx, cy, z)
        for k, (h, r) in MATS.items():
            if k not in M:
                M[k] = _mat("Trd" + k, h, r)

    def mesh(self, name, verts, faces, mat):
        ox, oy, oz = self.o
        me = bpy.data.meshes.new(name)
        me.from_pydata([(SCALE * x + ox, SCALE * y + oy, SCALE * z + oz) for x, y, z in verts], [], faces)
        me.validate()
        if len(faces) > 1:   # faces out, whatever order the outline came in (a lone face keeps its order)
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
        me.materials.append(self.M[mat])
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o

    def loft(self, name, rings, mat, cap=(True, True)):
        """Join rings of equal size bottom to top, capping the ends."""
        n = len(rings[0])
        v = [p for r in rings for p in r]
        f = [(i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j)
             for i in range(len(rings) - 1) for j in range(n)]
        if cap[0]:
            f.append(tuple(range(n))[::-1])
        if cap[1]:
            f.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
        return self.mesh(name, v, f, mat)

    def tube(self, name, path, r, mat, n=5, twist=0.0, cap=(True, True)):
        """A tube along path; r is one radius or one per point; twist turns each ring
        on from the last (a twisted square tube reads as rope)."""
        rs = r if isinstance(r, (list, tuple)) else [r] * len(path)
        rings = []
        for i, p in enumerate(path):
            a, b_ = path[max(i - 1, 0)], path[min(i + 1, len(path) - 1)]
            t = _norm(_sub(b_, a))
            u = _norm(_cross(t, (0, 0, 1) if abs(t[2]) < 0.9 else (1, 0, 0)))
            w = _cross(t, u)
            rings.append([_add(p, _add(_mul(u, rs[i] * math.cos(k / n * math.tau + twist * i)),
                                       _mul(w, rs[i] * math.sin(k / n * math.tau + twist * i)))) for k in range(n)])
        return self.loft(name, rings, mat, cap)

    def ball(self, name, c, r, mat, seg=8, rings=5, scale=(1, 1, 1)):
        v = [(c[0], c[1], c[2] - r * scale[2])]
        for i in range(1, rings):
            ph = math.pi * i / rings - math.pi / 2
            for k in range(seg):
                t = k / seg * math.tau
                v.append((c[0] + r * scale[0] * math.cos(ph) * math.cos(t), c[1] + r * scale[1] * math.cos(ph) * math.sin(t),
                          c[2] + r * scale[2] * math.sin(ph)))
        v.append((c[0], c[1], c[2] + r * scale[2]))
        top, f = len(v) - 1, []
        for k in range(seg):
            f.append((0, 1 + (k + 1) % seg, 1 + k))
            f.append((top, 1 + (rings - 2) * seg + k, 1 + (rings - 2) * seg + (k + 1) % seg))
        for i in range(rings - 2):
            for k in range(seg):
                a, b_ = 1 + i * seg, 1 + (i + 1) * seg
                f.append((a + k, a + (k + 1) % seg, b_ + (k + 1) % seg, b_ + k))
        return self.mesh(name, v, f, mat)

    def disc(self, name, c, r, normal, depth, mat, n=8, cap=(True, True)):
        """A short cylinder of radius r along normal, from c to c + normal * depth."""
        t = _norm(normal)
        u = _norm(_cross(t, (0, 0, 1)))
        w = _cross(t, u)
        ring = [_add(c, _add(_mul(u, r * math.cos(k / n * math.tau)), _mul(w, r * math.sin(k / n * math.tau)))) for k in range(n)]
        return self.loft(name, [ring, [_add(p, _mul(t, depth)) for p in ring]], mat, cap)

    def slab(self, name, pts, back, mat):
        """A flat outline pts (3D, counter-clockwise from the front) with thickness: the
        back face is pts moved by the vector back."""
        n = len(pts)
        v = list(pts) + [_add(p, back) for p in pts]
        f = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
        return self.mesh(name, v, f, mat)


def _mat(name, hexcol, rough):
    import build as b
    h = hexcol.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return b.mat_flat(name, tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c), rough)


def _add(a, b_): return (a[0] + b_[0], a[1] + b_[1], a[2] + b_[2])
def _sub(a, b_): return (a[0] - b_[0], a[1] - b_[1], a[2] - b_[2])
def _mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def _cross(a, b_): return (a[1] * b_[2] - a[2] * b_[1], a[2] * b_[0] - a[0] * b_[2], a[0] * b_[1] - a[1] * b_[0])


def _norm(a):
    m = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2) or 1.0
    return (a[0] / m, a[1] / m, a[2] / m)


def _turn(p, a, pivot=(0.0, 0.0)):
    """p turned by a about the vertical through pivot."""
    x, y = p[0] - pivot[0], p[1] - pivot[1]
    return (pivot[0] + x * math.cos(a) - y * math.sin(a), pivot[1] + x * math.sin(a) + y * math.cos(a), p[2])


def _wing_y(u):   # wings cup forward toward the tips, set just behind the body's centre
    return 0.05 - 0.22 * (u - 0.14) ** 2


def _ring(z, y, rx, ry, n, x=0.0):
    return [(x + rx * math.cos(k / n * math.tau), y + ry * math.sin(k / n * math.tau), z) for k in range(n)]


def braid(k, strands, n, sides, twists=7):
    """The braided bronze ring round a 0.4 m circle: strands helices, or with one
    strand a twisted square rope."""
    if strands == 1:
        path = [(0.4 * math.cos(i / n * math.tau), 0.4 * math.sin(i / n * math.tau), 0.08) for i in range(n + 1)]
        k.tube("PhoenixBraid", path, 0.085, "bronze_dark", 4, math.tau / 4 * 0.5)
    for s in range(strands if strands > 1 else 0):
        path = []
        for i in range(n + 1):
            t = i / n * math.tau
            ph = twists * t + s * math.tau / strands
            r, dz = 0.4 + 0.045 * math.cos(ph), 0.08 + 0.04 * math.sin(ph)
            path.append((r * math.cos(t), r * math.sin(t), dz))
        k.tube("PhoenixBraid", path, 0.055, "bronze_dark", sides, cap=(False, False))   # a closed loop
    k.loft("PhoenixRingTop", [_ring(0.05, 0, 0.38, 0.38, 8), _ring(0.12, 0, 0.36, 0.36, 8)], "bronze_dark", (False, True))


def stand(k, v):
    """Gilded flame trunk with three branches to the lamp cups, globe lamps on top."""
    k.tube("PhoenixTrunk", [(0, 0.02, 0.1), (0.01, 0.02, 0.25), (0, 0.02, 0.42)], [0.11, 0.085, 0.06], "gold", 6)
    n = {"A": 6, "B": 9, "C": 7}[v]
    for i in range(n):   # flame tongues licking up round the trunk
        t = i / n * math.tau
        h = 0.25 + 0.12 * ((i * 5) % 3) / 2
        b0 = (0.1 * math.cos(t), 0.02 + 0.1 * math.sin(t), 0.12)
        tip = (0.17 * math.cos(t + 0.4), 0.02 + 0.17 * math.sin(t + 0.4), 0.12 + h)
        side = (-0.045 * math.sin(t), 0.045 * math.cos(t), 0)
        k.slab("PhoenixFlame", [_add(b0, _mul(side, -1)), _add(b0, side), tip], (0.015 * math.cos(t), 0.015 * math.sin(t), 0), "gold")
    cups = {"left": [(0, 0.02, 0.36), (-0.15, 0.0, 0.42), (-0.32, -0.03, 0.43), (-0.42, -0.05, 0.52)],
            "right": [(0.02, 0.03, 0.38), (0.2, 0.06, 0.45), (0.36, 0.04, 0.55), (0.42, 0.02, 0.62)],
            "front": [(0, 0.0, 0.33), (0.06, -0.12, 0.40), (0.1, -0.22, 0.47)]}
    for path in cups.values():
        k.tube("PhoenixBranch", path, [0.045] + [0.035] * (len(path) - 1), "gold", 4, cap=(False, False))
        c = path[-1]
        if v == "A":
            k.loft("PhoenixCup", [_ring(c[2], c[1], 0.035, 0.035, 6, c[0]), _ring(c[2] + 0.09, c[1], 0.09, 0.09, 6, c[0])], "gold")
        else:   # a crown of leaves: the rim's points alternate out and in (the globe hides its inside)
            m = 8 if v == "C" else 12
            rim = [(c[0] + r * math.cos(t), c[1] + r * math.sin(t), c[2] + 0.09 + 0.03 * (j % 2 == 0))
                   for j in range(m) for t, r in [(j / m * math.tau, 0.1 if j % 2 == 0 else 0.07)]]
            k.loft("PhoenixCup", [_ring(c[2], c[1], 0.035, 0.035, m, c[0]), rim], "gold", cap=(v != "C", False))
            if v != "C":
                k.mesh("PhoenixCup", [(c[0], c[1], c[2] + 0.07)] + rim, [(0, j, j % m + 1) for j in range(1, m + 1)], "gold")
        k.ball("PhoenixGlobe", (c[0], c[1], c[2] + 0.24), 0.16, "lamp", {"A": 8, "B": 10, "C": 8}[v], {"A": 5, "B": 6, "C": 4}[v])
    # the perch the claws grip, across the front
    k.tube("PhoenixBranch", [(-0.24, -0.06, 0.40), (0, -0.1, 0.43), (0.22, -0.06, 0.41)], 0.04, "gold", 4)


def body(k, v):
    n = {"A": 6, "B": 8, "C": 8}[v]
    # (height, y, half width, half depth): vent, belly, chest, shoulders, neck
    rings = [(0.72, 0.08, 0.08, 0.06), (0.84, 0.03, 0.16, 0.13), (1.00, -0.03, 0.21, 0.17), (1.18, -0.06, 0.235, 0.185),
             (1.36, -0.05, 0.22, 0.165), (1.50, -0.02, 0.17, 0.13), (1.60, -0.02, 0.11, 0.10)]
    k.loft("PhoenixBody", [_ring(z, y, rx, ry, n) for z, y, rx, ry in rings], "patina")
    # the head turned to its left: crown and the hooked beak
    head = [(1.55, -0.03, 0.105, 0.105), (1.67, -0.05, 0.12, 0.13), (1.77, -0.06, 0.115, 0.13), (1.85, -0.05, 0.08, 0.10),
            (1.90, -0.03, 0.03, 0.05)]
    k.loft("PhoenixHead", [[_turn(p, HEAD_TURN) for p in _ring(z, y, rx, ry, n)] for z, y, rx, ry in head], "patina")
    beak = [(-0.12, 1.76, 0.05, 0.06), (-0.2, 1.76, 0.04, 0.05), (-0.26, 1.735, 0.025, 0.035), (-0.285, 1.67, 0.008, 0.01)]
    k.loft("PhoenixBeak", [[_turn((x, y, z + dz), HEAD_TURN) for x, dz in ((-w, 0), (w, 0), (w * 0.4, h), (-w * 0.4, h))]
                           for y, z, w, h in [(b_[0], b_[1] - b_[3] / 2, b_[2], b_[3]) for b_ in beak]], "patina")
    if v == "C":   # brows over the eyes
        for s in (-1, 1):
            k.tube("PhoenixBrow", [_turn(p, HEAD_TURN) for p in ((s * 0.03, -0.17, 1.80), (s * 0.085, -0.13, 1.80), (s * 0.11, -0.07, 1.78))],
                   0.018, "patina", 4)
    # tail feathers down behind the stand
    k.slab("PhoenixTail", [(-0.09, 0.1, 0.80), (0.09, 0.1, 0.80), (0.15, 0.32, 0.30), (0, 0.36, 0.24), (-0.15, 0.32, 0.30)],
           (0, -0.03, -0.01), "patina")
    for s in (-1, 1):   # feathered thighs, bare shanks, toes gripping the perch
        k.tube("PhoenixThigh", [(s * 0.09, 0.0, 0.92), (s * 0.095, -0.03, 0.72), (s * 0.09, -0.05, 0.56)], [0.085, 0.075, 0.045], "patina", 6, cap=(False, True))   # tops inside the body
        k.tube("PhoenixShank", [(s * 0.09, -0.05, 0.58), (s * 0.09, -0.07, 0.47)], 0.028, "patina", 4)
        for d in (-0.035, 0.0, 0.035):
            k.tube("PhoenixClaw", [(s * 0.09, -0.07, 0.47), (s * 0.09 + d, -0.13, 0.47), (s * 0.09 + d * 1.2, -0.15, 0.40)], [0.02, 0.016, 0.008], "patina", 3)
        k.tube("PhoenixClaw", [(s * 0.09, -0.07, 0.47), (s * 0.09, -0.02, 0.43)], [0.018, 0.008], "patina", 3)


def wings(k, v):
    for s in (-1, 1):
        def at(u, z, dy=0.0):
            return (s * u * SPAN, _wing_y(u) + dy, z)

        def outline(pts):   # counter-clockwise from the front on both sides
            q = [at(u, z) for u, z in pts]
            return q if s < 0 else q[::-1]

        back = (0, 0.05, 0)
        if v == "A":
            k.slab("PhoenixWing", outline(WING), back, "bronze_dark")
        elif v == "B":   # a covert plate over six primaries fanned below it
            covert = WING[:9] + [(0.62, 1.30), (0.48, 1.22), (0.34, 1.24), (0.24, 1.28)]
            k.slab("PhoenixWing", outline(covert), back, "bronze_dark")
            for i in range(6):
                f = i / 5
                root = (0.26 + 0.36 * f, 1.36)
                tip = (0.56 + 0.12 * f, 1.04 - 0.45 * f + 0.05 * (1 - f))
                if i == 5:
                    tip = (0.62, 0.55)
                w = 0.075
                dx, dz = tip[0] - root[0], tip[1] - root[1]
                m = math.hypot(dx, dz)
                px, pz = -dz / m * w, dx / m * w
                pts = [(root[0] - px, root[1] - pz), (root[0] + px, root[1] + pz),
                       (tip[0] + px * 0.6 - dx / m * 0.08, tip[1] + pz * 0.6 - dz / m * 0.08), tip,
                       (tip[0] - px * 0.6 - dx / m * 0.08, tip[1] - pz * 0.6 - dz / m * 0.08)]
                q = [at(u, z, 0.012 * (6 - i)) for u, z in pts]
                k.slab("PhoenixFeather", q if s < 0 else q[::-1], (0, 0.025, 0), "bronze_dark")
        else:   # C: the trailing edge cut into feather tips, a raised arm along the top
            edge = WING[11:] + [WING[0]]
            scal = []
            for (u0, z0), (u1, z1) in zip(edge, edge[1:]):
                scal += [(u0, z0), ((u0 + u1) / 2 - 0.03, (z0 + z1) / 2 + 0.02)]
            k.slab("PhoenixWing", outline(WING[:11] + scal[:-1]), back, "bronze_dark")
            k.tube("PhoenixWingArm", [at(u, z, -0.015) for u, z in ((0.15, 1.44), (0.2, 1.76), (0.3, 2.04), (0.43, 2.14), (0.55, 2.07))],
                   [0.045, 0.04, 0.035, 0.03, 0.02], "bronze_dark", 4, cap=(False, True))
        for u, z in LENSES:
            slope = -0.44 * (u - 0.14) * s / SPAN  # face out along the cupped wing
            nrm = _norm((slope, -1, 0))
            c = at(u, z, 0.005)
            m = 8 if v == "B" else 6   # no backs: they sit on the wing
            k.disc("PhoenixLensRim", c, 0.058, nrm, 0.03, "lens_rim", m, (False, True))
            glass = _add(c, _mul(nrm, 0.032))   # one flat face just proud of the rim
            u = _norm(_cross(nrm, (0, 0, 1)))
            w = _cross(nrm, u)
            k.mesh("PhoenixLens", [_add(glass, _add(_mul(u, 0.04 * math.cos(j / m * math.tau)), _mul(w, 0.04 * math.sin(j / m * math.tau))))
                                   for j in range(m)], [tuple(range(m))], "lens")


def build(M, cx, cy, z, variant="C"):
    """The sculpture from the braided ring up; returns the objects it made."""
    before = set(bpy.data.objects)
    k = _Kit(M, cx, cy, z)
    if variant == "C":   # three triangular strands, five crossings round the ring
        braid(k, 3, 20, 3, 5)
    else:
        braid(k, 1, {"A": 24, "B": 32}[variant], 4)
    stand(k, variant)
    body(k, variant)
    wings(k, variant)
    return set(bpy.data.objects) - before
