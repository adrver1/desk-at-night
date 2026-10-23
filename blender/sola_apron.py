"""
The helicopter apron at the heliport before the flight out (story mode's
optional opening, web/src/story/sola.js): concrete apron with its yellow
markings, the terminal with the gate passengers walk out of, a perimeter
fence, a hangar, light masts, a windsock, and a pallet of chemical IBCs
waiting by the fence (the cargo that missed the boat in Act 1).

    python blender/sola_apron.py           # write web/public/story/sola/sola.glb
    python blender/sola_apron.py --render  # also a preview still in blender/build/sola/
    python blender/sola_apron.py --materials split --detail full   # the first version

Low poly, flat colours. In the browser every colour is one 16 px cell of a
small palette image (and a roughness image laid out the same way), so the
whole apron is one material and draws in a handful of calls; the
see-through fence mesh and IBC bottles keep their own materials, since
sola.js changes those. --materials split exports one material per colour
instead (28 draw calls). --detail full keeps the closed beam ends, post
bottoms and the smoother sign letters that nobody sees. Origin is the helicopter's
parking spot, +X east, +Y north, +Z up; the helicopter parks nose north.
The parts the browser needs on their own are separate objects:

    SolaApron     everything static
    SolaPallet    the IBC pallet (hidden for the "it has gone" still)
    SolaSock      the windsock cone, pivoting at the pole top
    SolaSign      SOLA HELIPORT over the hangar doors
    SolaFence*    the fence's mesh panels, made see-through in the browser
"""
import argparse
import math
import os
import random
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import helicopter as heli  # noqa: E402
import offshore_platform as op  # noqa: E402

bpy, Vector = b.bpy, b.Vector
srgb = heli.srgb

OUT = os.path.join(b.ROOT, "web", "public", "story", "sola")

# Layout (metres)
APRON = (-90, 90, -32, 70)       # x0, x1, y0, y1 of the concrete
FENCE_Y = -32.5                  # the fence along the apron's south edge
GATE = (-15.0, -9.0)             # the gate in it, in x
TERMINAL = (-34, 12, -48, -36)   # x0, x1, y0, y1
HANGAR = (-78, -46, -8, 30)
PALLET = Vector((5.0, -30.6, 0))  # by the fence, apron side
IBC = (1.2, 1.0, 1.16)           # an IBC: length, width, height
# Variants (asset library: both stay buildable)
MATERIALS = "palette"            # "palette": one material for every flat colour; "split": one each
DETAIL = "lean"                  # "lean": no hidden faces, simpler letters; "full": the first version
KEEP = ("SolaFenceMesh", "SolaTank")   # own materials, made see-through by sola.js
CELL, COLS = 16, 8               # palette cell size (px) and cells per row


def materials():
    f = b.mat_flat
    return {
        "concrete": f("SolaConcrete", srgb("#a9aba6"), 0.9),
        "asphalt": f("SolaAsphalt", srgb("#4b4e51"), 0.9),
        "grass": f("SolaGrass", srgb("#61763f"), 1.0),
        "hills": f("SolaHills", srgb("#56683f"), 1.0),
        "yellow": f("SolaYellow", srgb("#e2b01e"), 0.6),
        "paint": f("SolaPaint", srgb("#eceeea"), 0.6),
        "wall": f("SolaWall", srgb("#d8dbd8"), 0.7),
        "band": f("SolaBand", srgb("#2d5c8a"), 0.5),
        "glass": f("SolaGlass", srgb("#2a3944"), 0.1),
        "roof": f("SolaRoof", srgb("#6d7377"), 0.7),
        "hangar": f("SolaHangar", srgb("#b9bdbd"), 0.6),
        "door": f("SolaDoor", srgb("#8d9398"), 0.5),
        "steel": f("SolaSteel", srgb("#9aa0a3"), 0.4),
        "mesh": f("SolaFenceMesh", srgb("#8a9094"), 0.5),
        "dark": f("SolaDark", srgb("#2a2c2e"), 0.6),
        "orange": f("SolaOrange", srgb("#e0571b"), 0.6),
        "red": f("SolaRed", srgb("#b0281f"), 0.5),
        "tank": f("SolaTank", srgb("#e9e8df"), 0.35),   # the IBC's milky bottle (see-through in the browser)
        "liquid": f("SolaLiquid", srgb("#c98a1e"), 0.3),   # the chemical inside, amber
        "sheet": f("SolaSheet", srgb("#f4f4ef"), 0.6),     # the product label
        "cage": f("SolaCage", srgb("#b4b8ba"), 0.35),
        "pallet": f("SolaPalletBase", srgb("#1f2123"), 0.7),
        "label": f("SolaLabel", srgb("#f08a1c"), 0.5),
        "strap": f("SolaStrap", srgb("#d8261c"), 0.6),
        "sock": f("SolaSock", srgb("#ff6a1a"), 0.7),
    }


def lean():
    return DETAIL == "lean"


def bar(g, mat, a, c, w):
    """A beam that meets others at both ends: its end caps are hidden (lean)."""
    g.beam(mat, a, c, w, caps=not lean())


def post(g, mat, center, r, z0, z1, n):
    """A vertical post standing on the ground: its bottom is hidden (lean)."""
    if not lean():
        g.prism(mat, center, r, z0, z1, n)
        return
    cx, cy = center
    ring = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    vs = [Vector((x, y, z0)) for x, y in ring] + [Vector((x, y, z1)) for x, y in ring]
    g.add(mat, vs, [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(range(n, 2 * n))])


def flat(g, mat, x0, x1, y0, y1, z):
    """A quad facing up."""
    g.add(mat, [Vector((x0, y0, z)), Vector((x1, y0, z)), Vector((x1, y1, z)), Vector((x0, y1, z))], [(0, 1, 2, 3)])


def stripe(g, mat, a, c, w, z=0.015):
    """A painted line from a to c, w wide."""
    a, c = Vector((*a, z)), Vector((*c, z))
    d = (c - a).normalized()
    n = Vector((-d.y, d.x, 0)) * w / 2
    g.add(mat, [a - n, c - n, c + n, a + n], [(0, 1, 2, 3)])


def circle_line(g, mat, r, w, z=0.015, n=48):
    vs = []
    for rr in (r - w / 2, r + w / 2):
        vs += [Vector((rr * math.cos(2 * math.pi * i / n), rr * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
    g.add(mat, vs, [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)])


def build_ground(g, m):
    x0, x1, y0, y1 = APRON
    g.span(m["concrete"], x0, x1, y0, y1, -0.2, 0)
    # The taxiway north of the apron and the grass round it all
    g.span(m["asphalt"], -400, 400, y1, y1 + 30, -0.2, -0.01)
    for (a0, a1, b0, b1) in ((-1200, 1200, y1 + 30, 1200), (-1200, 1200, -1200, -60), (-1200, x0, -60, y1 + 30), (x1, 1200, -60, y1 + 30)):
        flat(g, m["grass"], a0, a1, b0, b1, -0.05)
    # Landside: a road strip behind the terminal
    g.span(m["asphalt"], -120, 120, -60, FENCE_Y - 0.5, -0.2, -0.02)
    # Low hills far off, a ring of hummocks
    rnd = random.Random(4)
    n = 40
    for i in range(n):
        t0, t1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        r0, r1 = 1100 + rnd.uniform(-80, 80), 1100 + rnd.uniform(-80, 80)
        h = rnd.uniform(25, 70)
        a, c = Vector((r0 * math.cos(t0), r0 * math.sin(t0), -0.1)), Vector((r1 * math.cos(t1), r1 * math.sin(t1), -0.1))
        top = (a + c) / 2 * 1.08
        top.z = h
        g.add(m["hills"], [a, c, top], [(0, 2, 1)])


def build_markings(g, m):
    # The parking spot: a yellow circle with a white H, a lead-in line from the taxiway
    circle_line(g, m["yellow"], 10.0, 0.3)
    stripe(g, m["paint"], (-1.6, -2.2), (-1.6, 2.2), 0.45)
    stripe(g, m["paint"], (1.6, -2.2), (1.6, 2.2), 0.45)
    stripe(g, m["paint"], (-1.6, 0), (1.6, 0), 0.45)
    stripe(g, m["yellow"], (0, 10), (0, APRON[3] + 6), 0.25)
    # Two more stands, empty, to the east
    for x in (32, 64):
        vs = []
        n = 48
        for rr in (9.85, 10.15):
            vs += [Vector((x + rr * math.cos(2 * math.pi * i / n), rr * math.sin(2 * math.pi * i / n), 0.015)) for i in range(n)]
        g.add(m["yellow"], vs, [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)])
        stripe(g, m["yellow"], (x, 10), (x, APRON[3] + 6), 0.25)
    # The walkway from the gate to the cabin door, edged in yellow, dashed in the middle
    gx = (GATE[0] + GATE[1]) / 2
    path = [(gx, FENCE_Y), (gx, -14), (-4.5, -6), (-2.2, -1.0)]
    for (ax, ay), (cx, cy) in zip(path, path[1:]):
        d = Vector((cx - ax, cy - ay, 0))
        n_ = Vector((-d.y, d.x, 0)).normalized() * 1.1
        stripe(g, m["yellow"], (ax - n_.x, ay - n_.y), (cx - n_.x, cy - n_.y), 0.15)
        stripe(g, m["yellow"], (ax + n_.x, ay + n_.y), (cx + n_.x, cy + n_.y), 0.15)
    # A safety line round the stand: nobody past it while the rotors turn
    stripe(g, m["red"], (-14, -12), (14, -12), 0.3)


def build_fence(g, m, mesh):
    x0, x1 = APRON[0], APRON[1]
    h = 2.4
    x = x0
    while x < x1:
        post(g, m["steel"], (x, FENCE_Y), 0.04, 0, h + 0.3, 6)
        x += 3.0
    for (a, c) in ((x0, GATE[0]), (GATE[1], x1)):
        bar(g, m["steel"], (a, FENCE_Y, h), (c, FENCE_Y, h), 0.05)
        bar(g, m["steel"], (a, FENCE_Y, 0.1), (c, FENCE_Y, 0.1), 0.04)
        # The mesh, both ways round (one-sided faces would vanish from behind)
        vs = [Vector((a, FENCE_Y, 0.05)), Vector((c, FENCE_Y, 0.05)), Vector((c, FENCE_Y, h)), Vector((a, FENCE_Y, h))]
        mesh.add(m["mesh"], vs, [(0, 1, 2, 3), (3, 2, 1, 0)])
    # The gate leaves, swung open onto the apron
    for gx, s in ((GATE[0], 1), (GATE[1], -1)):
        post(g, m["steel"], (gx, FENCE_Y), 0.07, 0, h + 0.3, 8)
        tip = Vector((gx + s * 0.4, FENCE_Y + 2.9, 0))
        bar(g, m["steel"], (gx, FENCE_Y, h - 0.1), (tip.x, tip.y, h - 0.1), 0.05)
        bar(g, m["steel"], (gx, FENCE_Y, 0.15), (tip.x, tip.y, 0.15), 0.05)
        bar(g, m["steel"], (tip.x, tip.y, 0.15), (tip.x, tip.y, h - 0.1), 0.05)
        mesh.add(m["mesh"], [Vector((gx, FENCE_Y, 0.15)), Vector((tip.x, tip.y, 0.15)), Vector((tip.x, tip.y, h - 0.1)), Vector((gx, FENCE_Y, h - 0.1))], [(0, 1, 2, 3), (3, 2, 1, 0)])


def build_terminal(g, m):
    x0, x1, y0, y1 = TERMINAL
    g.span(m["wall"], x0, x1, y0, y1, 0, 8.0)
    g.span(m["roof"], x0 - 0.4, x1 + 0.4, y0 - 0.4, y1 + 0.4, 8.0, 8.4)
    # Window bands on the airside face, and the blue band under the roof
    for z0, z1 in ((1.0, 2.6), (4.6, 6.4)):
        g.span(m["glass"], x0 + 1, x1 - 1, y1, y1 + 0.05, z0, z1)
    g.span(m["band"], x0, x1, y1, y1 + 0.06, 7.0, 7.8)
    # The departures door, under a canopy, lined up with the gate
    gx = (GATE[0] + GATE[1]) / 2
    g.span(m["glass"], gx - 1.6, gx + 1.6, y1, y1 + 0.08, 0, 2.6)
    g.span(m["roof"], gx - 3, gx + 3, y1, y1 + 3.5, 3.0, 3.25)
    for sx in (-2.8, 2.8):
        post(g, m["steel"], (gx + sx, y1 + 3.3), 0.08, 0, 3.0, 6)
    # A covered walkway from the door to the gate
    for y in (y1 + 3.3, FENCE_Y - 0.3):
        for sx in (-1.5, 1.5):
            post(g, m["steel"], (gx + sx, y), 0.06, 0, 2.7, 6)
    g.span(m["roof"], gx - 1.8, gx + 1.8, FENCE_Y - 0.3, y1 + 3.3, 2.7, 2.85)
    # A tower for the heliport's control, at the east end
    g.span(m["wall"], x1 - 7, x1 - 2, y0 + 2, y0 + 7, 8.4, 14.0)
    g.span(m["glass"], x1 - 7.4, x1 - 1.6, y0 + 1.6, y0 + 7.4, 14.0, 16.4)
    g.span(m["roof"], x1 - 7.8, x1 - 1.2, y0 + 1.2, y0 + 7.8, 16.4, 16.8)


def build_hangar(g, m):
    x0, x1, y0, y1 = HANGAR
    h = 12.0
    g.span(m["hangar"], x0, x1, y0, y1, 0, h)
    # A low-pitched roof, and the big sliding doors facing the apron (east)
    g.add(m["roof"], [Vector((x0 - 0.5, y0 - 0.5, h)), Vector((x1 + 0.5, y0 - 0.5, h)), Vector((x1 + 0.5, y0 - 0.5, h + 2)), Vector((x0 - 0.5, y0 - 0.5, h + 2))], [(0, 3, 2, 1)])
    roof = [Vector((x0 - 0.5, y0 - 0.5, h)), Vector((x1 + 0.5, y0 - 0.5, h)), Vector((x1 + 0.5, (y0 + y1) / 2, h + 2)), Vector((x0 - 0.5, (y0 + y1) / 2, h + 2)),
            Vector((x0 - 0.5, y1 + 0.5, h)), Vector((x1 + 0.5, y1 + 0.5, h))]
    g.add(m["roof"], roof, [(0, 1, 2, 3), (3, 2, 5, 4)])
    g.add(m["hangar"], [Vector((x1, y0, h)), Vector((x1, y1, h)), Vector((x1, (y0 + y1) / 2, h + 2))], [(0, 1, 2)])
    g.add(m["hangar"], [Vector((x0, y0, h)), Vector((x0, y1, h)), Vector((x0, (y0 + y1) / 2, h + 2))], [(0, 2, 1)])
    n = 6
    for i in range(n):
        ya, yb = y0 + 1 + i * (y1 - y0 - 2) / n, y0 + 1 + (i + 1) * (y1 - y0 - 2) / n
        g.span(m["door"], x1, x1 + 0.12 + 0.06 * (i % 2), ya + 0.05, yb - 0.05, 0, h - 1.5)
    g.span(m["band"], x1, x1 + 0.2, y0, y1, h - 1.4, h - 0.6)
    # A wider band over the doors carries the name
    g.span(m["band"], x1, x1 + 0.22, y0 + 4, y1 - 4, h - 1.45, h + 0.6)


def build_sign(m, coll, text="SOLA HELIPORT"):
    """White letters on the hangar's band over the doors, facing the apron."""
    x0, x1, y0, y1 = HANGAR
    cu = bpy.data.curves.new("SolaSignText", "FONT")
    cu.body = text
    cu.size = 1.6
    cu.extrude = 0.03
    cu.resolution_u = 3 if lean() else 12   # curve steps per letter segment; 3 still reads round from the apron
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    tmp = bpy.data.objects.new("SolaSignText", cu)
    coll.objects.link(tmp)
    # Text lies in XY facing +Z: stand it up facing +X (east)
    tmp.rotation_euler = (math.radians(90), 0, math.radians(90))
    tmp.location = (x1 + 0.26, (y0 + y1) / 2, 12.0 - 0.45)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    o = bpy.data.objects.new("SolaSign", me)
    o.matrix_world = tmp.matrix_world.copy()
    me.materials.clear()
    me.materials.append(m["paint"])
    coll.objects.link(o)
    bpy.data.objects.remove(tmp)
    return o


def build_masts(g, m):
    for x, y in ((-36, 50), (44, 50), (44, -20)):
        post(g, m["steel"], (x, y), 0.25, 0, 20, 8)
        g.span(m["dark"], x - 1.2, x + 1.2, y - 0.4, y + 0.4, 19.6, 20.6)
        g.span(m["paint"], x - 1.1, x + 1.1, y - 0.42, y - 0.38, 19.7, 20.2)


def build_extras(g, m):
    # A ground power unit by the stand and some cones
    g.span(m["red"], 7.5, 9.7, -5.5, -4.3, 0.35, 1.5)
    g.span(m["dark"], 7.5, 9.7, -5.5, -4.3, 0.1, 0.35)
    for x, y in ((-6, 9), (6, 9), (11, -3), (-11, 2)):
        g.prism(m["orange"], (x, y), 0.17, 0, 0.05, 8)
        g.add(m["orange"], [Vector((x + 0.15 * math.cos(2 * math.pi * i / 8), y + 0.15 * math.sin(2 * math.pi * i / 8), 0.05)) for i in range(8)] + [Vector((x, y, 0.75))],
              [(i, (i + 1) % 8, 8) for i in range(8)])
    # The windsock's pole and frame (the sock itself is its own object)
    post(g, m["steel"], (40, 22), 0.08, 0, 6.0, 8)


def build_sock(m, coll):
    g = op.Mesh()
    n, ln = 10, 3.6
    rings = [(0.0, 0.45), (ln * 0.25, 0.4), (ln * 0.5, 0.34), (ln * 0.75, 0.28), (ln, 0.22)]
    for k, ((x0, r0), (x1, r1)) in enumerate(zip(rings, rings[1:])):
        vs = []
        for x, r in ((x0, r0), (x1, r1)):
            vs += [Vector((x, r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n))) for i in range(n)]
        fs = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        g.add(m["sock"] if k % 2 == 0 else m["paint"], vs, fs + [tuple(reversed(f)) for f in fs])
    o = g.single("SolaSock", coll, (0, 0, 0))
    o.location = (40, 22, 5.6)
    return o


def build_ibc(g, m, c, yaw=0.0):
    """One 1000 l IBC: a milky bottle in a steel cage on a black pallet."""
    L, W, H = IBC
    rot = b.Matrix.Rotation(yaw, 4, "Z")

    def P(x, y, z):
        return c + rot @ Vector((x, y, z))
    # Pallet base with its feet
    g.box(m["pallet"], P(0, 0, 0.075), (L, W, 0.15), yaw)
    # The bottle, a little inside the cage, filler cap on top, valve at the foot
    g.box(m["tank"], P(0, 0, 0.15 + (H - 0.17) / 2), (L - 0.08, W - 0.08, H - 0.2), yaw)
    fill = (H - 0.24) * 0.8
    g.box(m["liquid"], P(0, 0, 0.17 + fill / 2), (L - 0.14, W - 0.14, fill), yaw)
    g.prism(m["dark"], tuple(P(0, 0, 0))[:2], 0.11, 0.15 + H - 0.2, 0.15 + H - 0.12, 10)
    g.box(m["dark"], P(L / 2 - 0.02, 0, 0.27), (0.12, 0.12, 0.12), yaw)
    # The cage: posts at the corners and a grid of bars round the sides and top
    z0, z1 = 0.15, H
    corners = [P(sx * L / 2, sy * W / 2, 0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for k in range(4):
        a, d = corners[k], corners[(k + 1) % 4]
        for z in (z0 + 0.02, z0 + (z1 - z0) / 3, z0 + 2 * (z1 - z0) / 3, z1):
            bar(g, m["cage"], (a.x, a.y, z), (d.x, d.y, z), 0.022)
        span = (d - a).length
        for i in range(1, int(span / 0.3) + 1):
            p = a.lerp(d, i / (int(span / 0.3) + 1))
            bar(g, m["cage"], (p.x, p.y, z0), (p.x, p.y, z1), 0.018)
        bar(g, m["cage"], (a.x, a.y, z0), (a.x, a.y, z1), 0.035)
    for i in range(1, 4):
        a, d = P(-L / 2 + i * L / 4, -W / 2, z1), P(-L / 2 + i * L / 4, W / 2, z1)
        bar(g, m["cage"], a, d, 0.018)
    # A product label and a hazard diamond on the long side
    side_ = rot @ Vector((1, 0, 0))
    lc = P(-0.22, W / 2 + 0.014, 0.15 + H * 0.55)
    g.add(m["sheet"], [lc - side_ * 0.2 - Vector((0, 0, 0.14)), lc + side_ * 0.2 - Vector((0, 0, 0.14)), lc + side_ * 0.2 + Vector((0, 0, 0.14)), lc - side_ * 0.2 + Vector((0, 0, 0.14))], [(0, 1, 2, 3), (3, 2, 1, 0)])
    s = 0.16
    ctr = P(0.25, W / 2 + 0.016, 0.15 + H * 0.55)
    side = rot @ Vector((1, 0, 0))
    g.add(m["label"], [ctr + side * s, ctr + Vector((0, 0, s)), ctr - side * s, ctr - Vector((0, 0, s))], [(0, 1, 2, 3), (3, 2, 1, 0)])
    # and one on the end, for the shot along the row
    ctr = P(L / 2 + 0.016, 0, 0.15 + H * 0.55)
    across = rot @ Vector((0, 1, 0))
    g.add(m["label"], [ctr + across * s, ctr + Vector((0, 0, s)), ctr - across * s, ctr - Vector((0, 0, s))], [(0, 1, 2, 3), (3, 2, 1, 0)])


def build_pallet(m, coll):
    """Four IBCs side by side, strapped together, waiting by the fence."""
    g = op.Mesh()
    L, W, H = IBC
    for i in range(4):
        build_ibc(g, m, Vector(((i - 1.5) * (L + 0.06), 0, 0)))
    # A ratchet strap round the four of them
    x0, x1 = -2 * (L + 0.06) - 0.01, 2 * (L + 0.06) + 0.01
    for y in (-W / 2 - 0.03, W / 2 + 0.03):
        g.span(m["strap"], x0, x1, y - 0.005, y + 0.005, 0.68, 0.73)
    for x in (x0, x1):
        g.span(m["strap"], x - 0.005, x + 0.005, -W / 2 - 0.03, W / 2 + 0.03, 0.68, 0.73)
    o = g.single("SolaPallet", coll, (0, 0, 0))
    o.location = PALLET
    return o


def build_apron(m, coll):
    g, mesh = op.Mesh(), op.Mesh()
    build_ground(g, m)
    build_markings(g, m)
    build_fence(g, m, mesh)
    build_terminal(g, m)
    build_hangar(g, m)
    build_masts(g, m)
    build_extras(g, m)
    print(f"apron: {g.tris} triangles, fence mesh {mesh.tris}", flush=True)
    return [g.single("SolaApron", coll, (0, 0, 0)), mesh.single("SolaFence", coll, (0, 0, 0))]


def palette_material(mats):
    """One material for all the flat colours mats: a colour image and a
    roughness image (glTF's metallicRoughness: G roughness, B metal), one
    CELL x CELL cell per colour, read with nearest filtering. Returns the
    material and the cell centre (u, v) of each colour."""
    rows = (len(mats) + COLS - 1) // COLS
    w, h = COLS * CELL, rows * CELL
    col, rough = [0.0] * (w * h * 4), [0.0] * (w * h * 4)
    uv = {}

    def enc(x):   # linear to sRGB: the colour image is stored as sRGB bytes
        return x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    for k, mat in enumerate(mats):
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        c, r = bsdf.inputs["Base Color"].default_value, bsdf.inputs["Roughness"].default_value
        cx, cy = k % COLS, rows - 1 - k // COLS   # Blender images start at the bottom row
        uv[mat.name] = ((cx + 0.5) / COLS, (cy + 0.5) / rows)
        for y in range(cy * CELL, (cy + 1) * CELL):
            for x in range(cx * CELL, (cx + 1) * CELL):
                i = (y * w + x) * 4
                col[i:i + 4] = (enc(c[0]), enc(c[1]), enc(c[2]), 1.0)
                rough[i:i + 4] = (0.0, r, 0.0, 1.0)
    pal = b.mat_flat("SolaPalette", (1, 1, 1))
    # Double-sided like the split materials: some faces (the stand's ring, the hangar roof) are wound downwards
    nt = pal.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    for name, px, link in (("SolaPaletteColor", col, None), ("SolaPaletteRough", rough, "Roughness")):
        img = bpy.data.images.new(name, w, h)
        if link:
            img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(px)
        # On disk, not packed: the exporter reads a packed roughness image as missing (magenta)
        img.filepath_raw = os.path.join(tempfile.gettempdir(), f"{name}.png")
        img.file_format = "PNG"
        img.save()
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image, tex.interpolation = img, "Closest"
        if link:
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
            nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return pal, uv


def to_palette(objs):
    """Swap every flat material on objs (but KEEP) for the palette material,
    each face mapped onto the centre of its colour's cell."""
    mats = []
    for o in objs:
        for mat in o.data.materials:
            if mat.name not in KEEP and mat not in mats:
                mats.append(mat)
    pal, cells = palette_material(mats)
    for o in objs:
        me = o.data
        old = list(me.materials)
        new = [pal] if any(mat.name not in KEEP for mat in old) else []
        new += [mat for mat in old if mat.name in KEEP]
        if pal not in new:
            continue
        remap = [new.index(pal) if mat.name not in KEEP else new.index(mat) for mat in old]
        idx = [0] * len(me.polygons)
        me.polygons.foreach_get("material_index", idx)
        while me.uv_layers:   # the sign's text comes with a UV map of its own
            me.uv_layers.remove(me.uv_layers[0])
        layer = me.uv_layers.new(name="UVMap")
        uvs = [0.0] * (len(me.loops) * 2)
        for poly, mi in zip(me.polygons, idx):
            u, v = cells.get(old[mi].name, (0.0, 0.0))
            for li in poly.loop_indices:
                uvs[2 * li], uvs[2 * li + 1] = u, v
        layer.data.foreach_set("uv", uvs)
        me.materials.clear()   # (this resets the faces' material indices, so set them after)
        for mat in new:
            me.materials.append(mat)
        me.polygons.foreach_set("material_index", [remap[i] for i in idx])
    print(f"palette: {len(mats)} colours in one material, kept {', '.join(KEEP)}", flush=True)


def export(m, path):
    coll = bpy.data.collections.new("Sola")
    bpy.context.scene.collection.children.link(coll)
    build_apron(m, coll)
    build_pallet(m, coll)
    build_sock(m, coll)
    build_sign(m, coll)
    if MATERIALS == "palette":
        to_palette(list(coll.objects))
    for o in coll.objects:
        o.data.calc_loop_triangles()
    print(f"total: {sum(len(o.data.loop_triangles) for o in coll.objects)} triangles", flush=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in coll.objects:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=False, export_yup=True,
                              export_texcoords=MATERIALS == "palette", export_normals=True)
    print("wrote", path, flush=True)
    return coll


def render(out):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.85, 1)
    scene.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(60), 0, math.radians(-120))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 28
    cam.location = (14, -38, 4)
    cam.rotation_euler = (Vector((0, 0, 1.5)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    os.makedirs(out, exist_ok=True)
    scene.render.filepath = os.path.join(out, "apron.jpg")
    scene.render.image_settings.file_format = "JPEG"
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)


def main():
    global MATERIALS, DETAIL
    p = argparse.ArgumentParser()
    p.add_argument("--render", action="store_true")
    p.add_argument("--materials", choices=["palette", "split"], default=MATERIALS)
    p.add_argument("--detail", choices=["lean", "full"], default=DETAIL)
    p.add_argument("--out", default=os.path.join(OUT, "sola.glb"))
    args = p.parse_args()
    MATERIALS, DETAIL = args.materials, args.detail
    bpy.ops.wm.read_factory_settings(use_empty=True)
    m = materials()
    export(m, args.out)
    if args.render:
        render(os.path.join(b.BUILD, "sola"))


if __name__ == "__main__":
    main()
