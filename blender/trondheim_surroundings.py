"""Everything around Torvet except Føniks: the streets leaving the square, the
neighbouring blocks, trees, the town filler, the fjord and the hills.

Called once from preview_trondheim.py with its globals (helpers, materials and the
square's layout constants). Variants are kept side by side (asset library rule); pick
one with TRD_SURROUND=v1|v2 (default v2).

    v1  round 6: every street and block square to the square
    v2  Munkegata at its true angle, ~14.5 degrees off the square's north-south axis
        (measured on the street map and the Google 3D top-down view; both legs run on
        one straight line), Burger King in the orange wooden house right north of
        Føniks with its acute corner on Munkegata, Stiftsgården on the east side of
        Munkegata north, and the blocks along both legs following the street
    dream  v3 cut down to a dream: only the first few blocks round the square, no river,
        fjord or hills, and everything here drawn white on a white ground under a pale
        sky, so only Føniks and the Olav column keep their colours (TRD_SURROUND=dream)
    v3  the town from open map data (blender/data, made by trondheim_mapdata.py): every
        building in about 1 km of Midtbyen with its real outline, height and roof, the
        terrain, streets, parks, trees and the river; Burger King, Trondheim Torg, the
        pavilion and the planters stay hand-built, Føniks belongs to preview_trondheim.py
"""
import gzip
import json
import math
import os
import random

_NAMES = ("bpy", "b", "M", "scene", "srgb", "box", "cyl", "frustum", "block", "paved", "paving",
          "SQ_W", "SQ_E", "SQ_S", "SQ_N", "FONIKS_FRONT", "FONIKS_SOUTH", "FW", "FB")


DREAM = False


def build(g, variant="v2"):
    global G, DREAM
    G = g
    globals().update({k: g[k] for k in _NAMES})
    DREAM = variant == "dream"
    before = set(bpy.data.objects)
    {"v1": v1, "v2": v2, "v3": v3, "dream": v3}[variant]()
    if DREAM:
        whiten((set(bpy.data.objects) - before)
               | {o for o in bpy.data.objects if o.name.startswith(("Ground", "Paving", "FoniksBack"))})


def finish(g):
    """After the scene's own sky and sun: the dream's pale sky."""
    if DREAM:
        bg = g["world"].node_tree.nodes["Background"]
        bg.inputs[0].default_value = (*srgb("#f1f3f4"), 1)
        bg.inputs[1].default_value = 1.6   # bright enough that the horizon all but melts away


DREAM_GROUND = "#a4a39e"   # clearly darker than the buildings, so they stand off it


def dream_ground():
    """The dream's ground: grey round the square, fading out to the sky's near-white
    with distance, so the horizon still melts away."""
    mat = bpy.data.materials.new("TrdDreamGround")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dist = nt.nodes.new("ShaderNodeVectorMath")
    dist.operation = "LENGTH"
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = 250.0
    fade.inputs["From Max"].default_value = 2500.0
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[6].default_value = (*srgb(DREAM_GROUND), 1)
    mix.inputs[7].default_value = (*srgb("#eceeef"), 1)
    nt.links.new(geo.outputs["Position"], dist.inputs[0])
    nt.links.new(dist.outputs["Value"], fade.inputs["Value"])
    nt.links.new(fade.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


def whiten(objs):
    """The dream look: one matte off-white for everything but Føniks and the column."""
    white = b.mat_flat("TrdDream", srgb("#eeede9"), 0.9)
    ground = dream_ground()
    for o in objs:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(ground if o.name.startswith(("Ground", "Paving", "Munkegata")) else white)


# --- shared by both variants -------------------------------------------------------

def brick_west(x1=None):
    # West of the annex: a block clad in copper-brown fins on a tight window grid
    block("BrickW", -108, FB - 22 if x1 is None else x1, 13, 32, 17, "copper", 6, ("-y",), None)


def north_cafe_blocks():
    # North side east of Munkegata: the dark modern block with ribbon windows under a dark
    # mansard and café awnings along its front, a white block beside it
    block("GlassN", -6, 22, SQ_N + 0.5, 85, 15, "glass_block", 5, ("-y", "-x"), "slate", 3)
    for i in range(6):
        box("CafeAwning", (-3 + i * 4.2, SQ_N - 2.2, 2.6), (3.8, 3.4, 0.15), "frame")
    block("WhiteN", 22, 44, SQ_N + 0.5, 82, 14, "c3", 4, ("-y",), "slate", 4)


def tree(x, y, r=2.2, h=2.2):
    cyl("Trunk", (x, y, 0), 0.15, h, "trunk", 6)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(x, y, h + r))
    bpy.context.object.data.materials.append(M["tree"])


def torg_and_pavilion():
    # West side south of Kongens gate: Trondheim Torg, beige with tall window strips, the
    # red sign high up, shop windows and McDonald's at street level, a big screen; the
    # green pavilion drum on its short post in front
    TX, TY = -42.0, -32.0   # front line; Kongens gate (bus stops) lies between it and Føniks
    box("Torg", (TX - 20, TY, 8), (40, 34, 16), "torg")
    box("TorgTop", (TX - 22, TY, 17.5), (34, 32, 3), "glass_block")
    box("TorgRoof", (TX - 20, TY, 16.1), (40.6, 34.6, 0.3), "dark")
    box("TorgShops", (TX + 0.1, TY, 2.2), (0.3, 32, 4.0), "glass")
    box("TorgFascia", (TX + 0.3, TY, 4.6), (0.3, 32, 0.6), "red")
    for i in range(12):
        box("TorgStrip", (TX + 0.1, -47 + i * 2.7, 10.5), (0.25, 1.1, 10.0), "glass")
    box("TorgSign", (TX + 0.4, -21, 15.2), (0.3, 10, 1.4), "red")
    box("TorgScreen", (TX + 0.4, -36, 9.0), (0.3, 6, 3.0), "red")
    cyl("PavilionPost", (-25, -21, 0), 1.2, 3.0, "frame", 12)
    cyl("Pavilion", (-25, -21, 3.0), 5.5, 2.8, "verdigris", 32)
    cyl("PavilionLid", (-25, -21, 5.8), 5.5, 0.15, "dark", 32)


def east_side():
    # East side: a white modern block with vertical fins (cafés in front), the yellow
    # older house with dormers at the south-east corner
    block("OfficeE", 51, 76, 18, 60, 16, "c3", 5, ("-x",), None)
    for i in range(14):
        box("Fin", (50.8, 19.5 + i * 3.0, 9), (0.4, 0.3, 13), "frame")
    block("YellowE", 51, 72, -55, -18, 12, "c5", 3, ("-x",), "slate", 4)


PLANTER_SPOTS = ([(-29, y) for y in (27, 18, 9, -10, -36)] + [(24, -60), (30, -72)]
                 + [(37, y) for y in (28, 18, 8, -10, -20, -32)] + [(x, 33) for x in (-20, -3, 8, 18, 29)]
                 + [(x, -43.5) for x in (-18, -6, 4.5, 23, 33)])


def planters(style="v1"):
    # Planters with young trees in rows along the edges of the square
    if style == "v2":
        return planters_v2()
    for x, y in PLANTER_SPOTS:
        box("Planter", (x, y, 0.3), (2.6, 2.6, 0.6), "granite")
        cyl("Trunk", (x, y, 0.6), 0.12, 1.8, "trunk", 6)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.3, location=(x, y, 3.2))
        bpy.context.object.data.materials.append(M["tree"])


def planters_v2():
    """Today's planters (Adriaen's Kongens gate photo): a long box of dark grey stone with a
    thick rim, a clipped box hedge filling it flush to just above the rim, and a young
    linden on a pale trunk growing out of the hedge. Every third one holds a bed of yellow
    flowers instead of the hedge, with a wooden bench along its side facing the square."""
    for k, v in {"rim": ("#6f7375", 0.85), "hedge": ("#34502a", 1.0), "leaf": ("#6c8a3a", 1.0),
                 "birch": ("#bdb6a6", 0.9), "bloom": ("#e2b93b", 0.9)}.items():
        if k not in M:
            M[k] = b.mat_flat("Trd" + k, srgb(v[0]), v[1])
    L, W, H, T_ = 4.4, 2.6, 0.5, 0.35   # outer size, rim height and thickness
    for n, (x, y) in enumerate(PLANTER_SPOTS):
        along_x = y in (33, -43.5)   # the rows on the north and south edges
        sx, sy = (L, W) if along_x else (W, L)
        for dx, dy, wx, wy in ((0, (sy - T_) / 2, sx, T_), (0, -(sy - T_) / 2, sx, T_),
                               ((sx - T_) / 2, 0, T_, sy - 2 * T_), (-(sx - T_) / 2, 0, T_, sy - 2 * T_)):
            box("PlanterRim", (x + dx, y + dy, H / 2), (wx, wy, H), "rim")
        flowers = n % 3 == 1
        ix, iy = sx - 2 * T_, sy - 2 * T_
        if flowers:
            box("PlanterBed", (x, y, H - 0.1), (ix, iy, 0.2), "hedge")
            for j in range(7):
                fx, fy = (j * 0.618 % 1 - 0.5) * (ix - 0.4), ((j * 0.382 + 0.2) % 1 - 0.5) * (iy - 0.4)
                bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.28, location=(x + fx, y + fy, H + 0.05))
                bpy.context.object.scale.z = 0.6
                bpy.context.object.data.materials.append(M["bloom"])
            # the bench on the side toward the middle of the square
            if along_x:
                by, bx, rot = y + (-1 if y > 0 else 1) * (sy / 2 + 0.45), x, 0.0
            else:
                bx, by, rot = x + (1 if x < 0 else -1) * (sx / 2 + 0.45), y, math.pi / 2
            box("BenchSeat", (bx, by, 0.45), (1.8, 0.45, 0.06), "wood", rot=rot)
            off = -0.22 if (along_x and y > 0) or (not along_x and x < 0) else 0.22   # back away from the planter
            box("BenchBack", (bx + (0 if along_x else -off), by + (off if along_x else 0), 0.75), (1.8, 0.05, 0.4), "wood", rot=rot)
            for e in (-0.75, 0.75):
                box("BenchLeg", (bx + (e if along_x else 0), by + (0 if along_x else e), 0.21), (0.06, 0.4, 0.42), "dark", rot=rot)
        else:
            box("PlanterHedge", (x, y, 0.55), (ix + 0.06, iy + 0.06, 0.9), "hedge")   # clipped flat a little over the rim
        # the young linden, a little off centre
        tx, ty = (x - 0.6, y) if along_x else (x, y - 0.6)
        cyl("Trunk", (tx, ty, 0.5), 0.1, 2.6, "birch", 6)
        for r, (ox, oy, oz) in ((1.5, (0, 0, 4.3)), (1.1, (0.5, 0.3, 5.3)), (1.0, (-0.4, -0.4, 3.6))):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(tx + ox, ty + oy, oz))
            bpy.context.object.data.materials.append(M["leaf"])


def town(keep_clear):
    # The town behind: low roofs filling the blocks out to the fjord, so the horizon
    # isn't empty street
    random.seed(7)
    for _ in range(220):
        x, y = random.uniform(-320, 260), random.uniform(-260, 330)
        if keep_clear(x, y):
            continue
        w, d, h = random.uniform(12, 30), random.uniform(10, 26), random.uniform(8, 18)
        box("Town", (x, y, h / 2), (w, d, h), random.choice(("c1", "c3", "c4", "c5", "pink", "brick_dark")))
        box("TownRoof", (x, y, h + 0.6), (w + 0.4, d + 0.4, 1.2), random.choice(("slate", "roof", "brick")))


def fjord_and_hills():
    box("Fjord", (0, 560, -0.2), (1600, 500, 0.1), "water")
    box("FjordW", (-700, 260, -0.22), (700, 500, 0.1), "water")   # the bay opens to the north-west
    for x, y, sx, sz in [(-700, -150, 260, 120), (-500, 700, 400, 60), (300, 900, 500, 50)]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=(x, y, -5))
        bpy.context.object.scale = (sx, 80, sz)
        bpy.context.object.data.materials.append(M["hill"])
        bpy.context.object.visible_shadow = False   # far away; their shadows only blacken the fjord


# --- v1: round 6, everything square to the square -----------------------------------

def v1():
    paved(-38, -6, SQ_N - 0.5, 140, "Munkegata", 0.036)   # Munkegata north, wide and pedestrian (a hair higher where it overlaps)
    paved(11.5, SQ_E, -70, SQ_S + 0.5, "SquareS", 0.036)       # the square runs on south, east of the yellow block
    paved(12, 34, -160, -69.5, "MunkegataS")           # Munkegata south toward the cathedral
    brick_west()
    # Right after Føniks at its north end, facing the square: the small pink wooden house
    # with a steep grey roof and a cross gable, more old houses north of it on Munkegata
    PH = (FONIKS_SOUTH + FW, FONIKS_SOUTH + FW + 22)   # a long low house on the square
    block("PinkHouse", FONIKS_FRONT - 12, FONIKS_FRONT + 5, PH[0], PH[1], 8, "orange", 2, ("+x", "-y"), None)
    frustum("PinkRoof", (FONIKS_FRONT - 3.5, (PH[0] + PH[1]) / 2), 8, 17.6, PH[1] - PH[0] + 0.6, 3, PH[1] - PH[0] - 9, 5.5, "roof_light")   # hipped, light grey
    block("OldN", FONIKS_FRONT - 18, FONIKS_FRONT + 3, PH[1] + 1, PH[1] + 40, 12, "c1", 4, ("+x",), "slate", 4)
    north_cafe_blocks()
    # Munkegata north runs off toward the fjord between tree rows
    for y in range(50, 140, 9):
        for x in (-33, -12):
            tree(x, y)
    torg_and_pavilion()
    # South side: the yellow 1950s office block facing north over the square, Munkegata
    # running south past its east end
    block("YellowS", -62, 11, -80, SQ_S, 18, "c5", 6, ("+y", "+x"), None)
    block("SouthE", 39, 70, -100, -57, 10, "c2", 3, ("+y", "-x"), "roof", 4)
    block("SouthW", -30, 10, -120, -86, 9, "brick_dark", 3, ("+y", "+x"), "slate", 4)
    east_side()
    planters()
    town(lambda x, y: (-110 < x < 90 and -90 < y < 95) or (-40 < x < -4 and y < 160)
         or math.hypot(x - 79, y + 47) < 140)   # keep the drone's own foreground clear
    fjord_and_hills()


# --- v2: Munkegata at its true angle --------------------------------------------------

# Munkegata crosses the square on one straight line, turned ~14.5 degrees from the
# square's north-south axis (north leg toward the north-north-west, south leg toward the
# south-south-east). Measured from the Google 3D top-down view (0.128 m/px): the street
# edges are the building faces along it.
T = math.tan(math.radians(14.5))


def w_north(y):
    """West edge of Munkegata north: Burger King's and its neighbours' street faces."""
    return -37.8 - (y - 59.0) * T


def e_north(y):
    """East edge of Munkegata north beyond the café block: Stiftsgården's street face."""
    return -12.8 - (y - 87.0) * T


def w_south(y):
    """West edge of Munkegata south: the yellow block's east end and the blocks after it."""
    return 6.0 + (-49.0 - y) * T


def e_south(y):
    """East edge of Munkegata south: the red-roofed block at the south-east corner and on."""
    return 39.0 + (-57.6 - y) * T


def poly_paving(name, pts, z):
    """A paved area of any outline, slabs at the same size as the square's."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x, y, z) for x, y in pts], [], [tuple(range(len(pts)))])
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co.x, co.y)   # UVs in metres
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(paving("TrdPaving" + name, 1.0))
    return o


def offset(pts, d):
    """Move every edge of a counter-clockwise outline inward by d (outward when d < 0)."""
    n = len(pts)
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        L = math.hypot(x1 - x0, y1 - y0)
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        lines.append(((x0 + nx * d, y0 + ny * d), (x1 - x0, y1 - y0)))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        den = r[0] * s[1] - r[1] * s[0]
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
        out.append((p[0] + t * r[0], p[1] + t * r[1]))
    return out


def loft(name, lo, z0, hi, z1, mat):
    """A solid between a bottom outline at z0 and a top outline at z1 (same vertex count)."""
    n = len(lo)
    v = [(x, y, z0) for x, y in lo] + [(x, y, z1) for x, y in hi]
    f = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(M[mat])
    return o


def edge(pts, i):
    """Start point, unit direction, length, outward normal and angle of outline edge i."""
    (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    return (x0, y0), (ux, uy), L, (uy, -ux), math.atan2(uy, ux)


def windows(name, pts, i, z, w, h, mat="glass", spacing=3.2, margin=0.0, out=0.05):
    (x0, y0), (ux, uy), L, (nx, ny), a = edge(pts, i)
    n = max(1, int((L - 2 * margin) / spacing))
    for k in range(n):
        s = margin + (k + 0.5) * (L - 2 * margin) / n
        box(name, (x0 + ux * s + nx * out, y0 + uy * s + ny * out, z), (w, 0.2, h), mat, rot=a)


def poly_block(name, pts, h, mat, floors, faces, roof=None, roof_h=4.0, ground=False, roof_pts=None):
    """block() for any convex outline (counter-clockwise): windows on the listed edges,
    a hipped roof when roof is given, else the same flat dark top as block()."""
    loft(name, pts, 0, pts, h, mat)
    fh = h / floors
    for i in faces:
        for f in range(0 if ground else 1, floors):
            windows(name + "W", pts, i, f * fh + fh * 0.45, 1.3, fh * 0.5)
    rp = roof_pts or pts
    if roof:
        short = min(edge(rp, i)[2] for i in range(len(rp)))
        loft(name + "Pitch", offset(rp, -0.3), h, offset(rp, short / 2 - 0.3), h + roof_h, roof)
    else:
        top = offset(rp, 0.5)
        loft(name + "Roof", top, h, top, h + 2.4, "roof")


def street_row(name, ya, yb, depth, h, mat, floors, roof=None, side="w"):
    """A block on Munkegata north whose street face follows the street line."""
    if side == "w":
        f = w_north
        pts = [(f(ya) - depth, ya), (f(ya), ya), (f(yb), yb), (f(yb) - depth, yb)]
        face = 1
    else:
        f = e_north
        pts = [(f(ya), ya), (f(ya) + depth, ya), (f(yb) + depth, yb), (f(yb), yb)]
        face = 3
    poly_block(name, pts, h, mat, floors, (face,), roof, 4.0)


def skylight(roof, i, f, H, slope, inset=2.0, over=0.45):
    """A roof window lying on the slope above edge i of the roof outline, f along it."""
    (x0, y0), (ux, uy), L, (nx, ny), a = edge(roof, i)
    x, y = x0 + ux * L * f - nx * inset, y0 + uy * L * f - ny * inset
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, H + (inset + over) * slope + 0.05),
                                    rotation=(math.atan(slope), 0, a))
    o = bpy.context.object
    o.name, o.scale = "BurgerKingSkylight", (1.0, 1.3, 0.12)
    o.data.materials.append(M["glass"])


def burger_king():
    """Munkegata 28: the two-storey orange wooden house right north of Føniks, Burger King
    on its ground floor. Its south front faces the open corner of the square in front of
    Føniks's north end, the long side follows Munkegata, and the corner between them is
    acute (~75 degrees) with a narrow cut-off holding the door. Light grey hipped roof
    with skylights, white trim bands, big shop windows on a grey stone plinth. No
    lettering or logo (Adriaen)."""
    y0, y1, xw = FONIKS_SOUTH + FW + 0.1, 78.0, -52.0
    se = (w_north(y0), y0)
    pts = [(xw, y0), (se[0] - 1.6, y0), (w_north(y0 + 1.6), y0 + 1.6), (w_north(y1), y1), (xw, y1)]
    H = 7.6
    loft("BurgerKing", pts, 0, pts, H, "orange")
    loft("BurgerKingPlinth", offset(pts, -0.08), 0, offset(pts, -0.08), 0.7, "plinth")
    loft("BurgerKingTrim", offset(pts, -0.12), 3.75, offset(pts, -0.12), 4.0, "frame")   # sill band
    loft("BurgerKingEave", offset(pts, -0.25), H - 0.35, offset(pts, -0.25), H, "frame")
    roof = [(xw, y0), se, (w_north(y1), y1), (xw, y1)]
    loft("BurgerKingRoof", offset(roof, -0.45), H, offset(roof, 4.4), H + 4.8, "roof_light")
    for i, ss in ((1, (0.35, 0.65)), (0, (0.75,))):   # skylights flush on the east and south slopes
        for f in ss:
            skylight(roof, i, f, H, 4.8 / 4.85)
    # The south front (only the part clear of Føniks shows) and the Munkegata side:
    # shop windows below the trim band, sash windows in white frames above
    for i, lo in ((0, FONIKS_FRONT + 0.6), (2, None)):
        (x0, y0_), (ux, uy), L, (nx, ny), a = edge(pts, i)
        s0 = (lo - x0) / ux if lo is not None else 0.6
        n = max(1, int((L - s0 - 0.6) / 3.3))
        for k in range(n):
            s = s0 + (k + 0.5) * (L - s0 - 0.6) / n
            x, y = x0 + ux * s, y0_ + uy * s
            box("BurgerKingShop", (x + nx * 0.06, y + ny * 0.06, 2.2), (2.5, 0.2, 2.6), "glass", rot=a)
            box("BurgerKingSashFrame", (x + nx * 0.05, y + ny * 0.05, 5.6), (1.5, 0.2, 2.1), "frame", rot=a)
            box("BurgerKingSash", (x + nx * 0.1, y + ny * 0.1, 5.6), (1.1, 0.2, 1.7), "glass", rot=a)
    (x0, y0_), (ux, uy), L, (nx, ny), a = edge(pts, 1)   # the cut-off corner: door
    cx, cy = x0 + ux * L / 2, y0_ + uy * L / 2
    box("BurgerKingDoor", (cx + nx * 0.06, cy + ny * 0.06, 1.8), (1.2, 0.2, 2.4), "glass", rot=a)


def stiftsgarden():
    """Stiftsgården on the east side of Munkegata north: the long two-storey royal
    residence in pale yellow wood under a dark hipped roof, its wing toward the east."""
    if "stift" not in M:
        M["stift"] = b.mat_flat("Trdstift", srgb("#e2d3a4"), 0.8)
    ya, yb = 88.0, 146.0
    pts = [(e_north(ya), ya), (e_north(ya) + 16, ya), (e_north(yb) + 16, yb), (e_north(yb), yb)]
    poly_block("Stiftsgarden", pts, 10, "stift", 2, (3,), "slate", 5.0, ground=True)
    poly_block("StiftsgardenWing", [(2.0, 91.0), (30.0, 91.0), (30.0, 105.0), (2.0, 105.0)],
               9, "stift", 2, (0,), "slate", 4.5, ground=True)


def v2():
    # Munkegata north: from the square between Burger King and the café block, then
    # between the old houses and Stiftsgården toward the fjord
    yN = 300.0
    poly_paving("Munkegata", [(w_north(SQ_N - 0.5), SQ_N - 0.5), (-6.0, SQ_N - 0.5), (-6.0, 86.0),
                              (e_north(86.0), 86.0), (e_north(yN), yN), (w_north(yN), yN)], 0.036)
    # Munkegata south: past the yellow block's slanted east end toward the cathedral
    yS = -250.0
    poly_paving("MunkegataS", [(w_south(SQ_S + 0.5), SQ_S + 0.5), (w_south(yS), yS), (e_south(yS), yS),
                               (e_south(-57.6), -57.6), (SQ_E, SQ_S + 0.5)], 0.036)
    brick_west(G.get("ax0"))   # right up to the annex's west end (from the GPS pins)
    burger_king()
    # More old houses north of it, their fronts on the street line
    street_row("OldN", 78.6, 100.0, 15, 12, "c1", 4, "slate")
    street_row("OldN2", 100.6, 124.0, 16, 14, "c3", 4)
    street_row("OldN3", 124.6, 165.0, 14, 12, "brick_dark", 4, "slate")
    north_cafe_blocks()
    stiftsgarden()
    # Small trees in the open corner by Burger King, then rows along Munkegata north
    for x, y in ((-34.6, 73.6), (-16.6, 73.0), (-30.0, 62.0), (-11.0, 57.0)):
        tree(x, y, 1.6, 1.8)
    for y in range(92, 166, 9):
        tree(w_north(y) + 4.0, y)
        tree(e_north(y) - 4.0, y)
    torg_and_pavilion()
    # South side: the yellow 1950s office block facing north over the square, its east
    # end cut along Munkegata; the blocks beyond follow the street on both sides
    poly_block("YellowS", [(-62, -80), (w_south(-80), -80), (w_south(SQ_S), SQ_S), (-62, SQ_S)],
               18, "c5", 6, (1, 2))
    poly_block("SouthW", [(-30, -120), (w_south(-120) - 0.5, -120), (w_south(-86) - 0.5, -86), (-30, -86)],
               9, "brick_dark", 3, (1, 2), "slate", 4)
    poly_block("SouthW2", [(-10, -165), (w_south(-165) - 0.5, -165), (w_south(-124) - 0.5, -124), (-10, -124)],
               11, "c1", 4, (1,), "slate", 4)
    poly_block("SouthE", [(e_south(-100), -100), (70, -100), (70, -57.6), (39, -57.6)],
               10, "c2", 3, (2, 3), "roof", 4)
    poly_block("SouthE2", [(e_south(-165), -165), (e_south(-165) + 20, -165), (e_south(-104) + 20, -104),
                           (e_south(-104), -104)], 12, "c3", 4, (3,), "slate", 4)
    poly_block("SouthW3", [(0, -245), (w_south(-245) - 0.5, -245), (w_south(-169) - 0.5, -169), (0, -169)],
               10, "c4", 3, (1,), "slate", 4)
    poly_block("SouthE3", [(e_south(-245), -245), (e_south(-245) + 20, -245), (e_south(-169) + 20, -169),
                           (e_south(-169), -169)], 11, "c5", 4, (3,), "roof", 4)
    for y in range(-64, -166, -10):   # trees along Munkegata south
        tree(e_south(y) - 3.5, y, 1.8)
    east_side()
    planters("v2")

    def keep_clear(x, y):   # a box reaches up to 15 m from its centre
        if (-110 < x < 90 and -90 < y < 95) or (-90 < x < 45 and 0 < y < 175):
            return True
        if y > 40 and w_north(y) - 15 < x < e_north(y) + 15:
            return True
        if y < -40 and w_south(y) - 15 < x < e_south(y) + 15:
            return True
        return math.hypot(x - 79, y + 47) < 140   # keep the drone's own foreground clear
    town(keep_clear)
    fjord_and_hills()


# --- v3: the town from open map data ------------------------------------------------

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "trondheim_midtbyen.json.gz")
FLAT_R0, FLAT_R1 = 130.0, 260.0   # the map's ground is held level out to here, then follows the terrain
SEA = -9.3                        # sea level below the ground at the column

# The hand-built looks carried over onto the map's outlines: a point inside the building
# (square-aligned frame, as the v2 blocks were measured) -> walls, roof
STYLE = [((8, 64), "glass_block", "slate"),        # the dark café block on the north side
         ((33, 62), "c3", "slate"),                # the white block beside it
         ((63, 39), "c3", "roof"),                 # the white office block on the east side
         ((61, -36), "c5", "slate"),               # the yellow house at the south-east corner
         ((-30, -65), "c5", "roof"),               # the yellow 1950s block on the south side
         ((55, -80), "c2", "roof"),                # the red-roofed block across Munkegata south
         ((-52.6, 89), "c1", "slate"), ((-59, 112), "c3", "slate"), ((-67, 145), "brick_dark", "slate"),
         ((-12.6, 117), "stift", "slate", (11.0, 16.5)),   # Stiftsgården: the map has it 6 m tall
         ((-95, 22), "copper", "roof")]            # the copper-clad block west of the annex
WALLS = ("c1", "c3", "c4", "c5", "c1", "c3", "pink", "brick_dark", "c2", "torg")
ROOFS = ("slate", "slate", "roof", "brick", "roof_light")


def from_true(x, y):
    """The map's true-north metres into the square-aligned frame (true_world() turns back)."""
    c, s = math.cos(-TRUE_TURN), math.sin(-TRUE_TURN)
    return ((c * x - s * y) / TRUE_SCALE, (s * x + c * y) / TRUE_SCALE)


def level(x, y, z):
    """Ground height to use: level round the square, the real terrain further out."""
    t = min(1.0, max(0.0, (math.hypot(x, y) - FLAT_R0) / (FLAT_R1 - FLAT_R0)))
    return z * t * t * (3 - 2 * t)


def windowed(key):
    """A wall colour with a grid of dark windows, ~3.2 m floors and ~3 m bays, drawn by
    the shader on vertical faces only, so the map's walls need no extra geometry."""
    name = "TrdWin" + key
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    base = M[key].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value[:]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.75
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    nrm = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], pos.inputs[0])
    nt.links.new(geo.outputs["Normal"], nrm.inputs[0])

    def op(kind, a, b_=None, v=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = kind
        for i, x in enumerate((a, b_)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                nt.links.new(x, n.inputs[i])
        return n.outputs[0]

    # distance along the wall: position across the face normal
    along = op("ADD", op("MULTIPLY", pos.outputs["X"], op("MULTIPLY", nrm.outputs["Y"], -1.0)),
               op("MULTIPLY", pos.outputs["Y"], nrm.outputs["X"]))
    u = op("FRACT", op("DIVIDE", along, 3.0))
    v = op("FRACT", op("DIVIDE", pos.outputs["Z"], 3.2))
    win = op("MULTIPLY", op("MULTIPLY", op("GREATER_THAN", u, 0.3), op("LESS_THAN", u, 0.72)),
             op("MULTIPLY", op("GREATER_THAN", v, 0.3), op("LESS_THAN", v, 0.78)))
    wall = op("LESS_THAN", op("ABSOLUTE", nrm.outputs["Z"]), 0.3)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(op("MULTIPLY", win, wall), mix.inputs["Factor"])
    mix.inputs[6].default_value = base
    mix.inputs[7].default_value = (*srgb("#26303a"), 1)
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


def map_mesh(name, part, mats, z_up=0.0, mat_of=None):
    """One object from a packed map part, its vertices put level and into the frame."""
    V, F = part["v"], part["f"]
    verts = []
    for i in range(0, len(V), 3):
        x, y, z = V[i:i + 3]
        verts.append((*from_true(x, y), level(x, y, z) + z_up))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [tuple(F[i:i + 3]) for i in range(0, len(F), 3)])
    for m in mats:
        me.materials.append(m)
    if mat_of:
        for p in me.polygons:
            p.material_index = mat_of(p)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def inside(pt, verts, tris):
    x, y = pt
    for a, b_, c in tris:
        (x1, y1), (x2, y2), (x3, y3) = verts[a][:2], verts[b_][:2], verts[c][:2]
        d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        if abs(d) < 1e-9:
            continue
        l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d
        l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d
        if l1 >= 0 and l2 >= 0 and l1 + l2 <= 1:
            return True
    return False


BK_BACK, BK_Y0, BK_Y1 = -51.8, 58.0, 78.5   # Burger King's back wall and its ends (see burger_king())


def hand_built(x, y):
    """Where v3 keeps the hand-built model and drops the map's building or tree."""
    if SQ_W - 1 < x < SQ_E + 1 and SQ_S - 1 < y < SQ_N + 1:
        return True                                                          # the square
    if G["ax0"] - 1 < x < FONIKS_FRONT + 1 and FONIKS_SOUTH - 2 < y < FONIKS_SOUTH + FW + 1:
        return True                                                          # Føniks and its annex
    return -83 < x < -41 and -50 < y < -14                                   # Trondheim Torg


DREAM_R = 230.0   # the dream keeps the map's buildings out to here (true metres from the column)


def map_buildings(data):
    """Every building in the map but the hand-built ones, in one object: walls in a
    colour per building with shader windows, pitched roofs in a roof colour, flat tops
    dark. The map's base heights are replaced by the level ground under each building."""
    if "stift" not in M:
        M["stift"] = b.mat_flat("Trdstift", srgb("#e2d3a4"), 0.8)
    walls = sorted(set(WALLS) | {st[1] for st in STYLE})
    if "felt" not in M:
        M["felt"] = b.mat_flat("Trdfelt", srgb("#6a6c6c"), 0.9)
    mats = [windowed(w) for w in walls] + [M[r] for r in ROOFS] + [M["felt"]]
    roof_ix = {r: len(walls) + i for i, r in enumerate(ROOFS)}
    V, F, mi, kept = [], [], [], 0
    for n, bd in enumerate(data["buildings"]):
        bv = [bd["v"][i:i + 3] for i in range(0, len(bd["v"]), 3)]
        tris = [bd["f"][i:i + 3] for i in range(0, len(bd["f"]), 3)]
        cx = sum(p[0] for p in bv) / len(bv)
        cy = sum(p[1] for p in bv) / len(bv)
        mx, my = from_true(cx, cy)
        if hand_built(mx, my) or (DREAM and math.hypot(cx, cy) > DREAM_R):
            continue
        kept += 1
        rnd = random.Random(n)
        wall, roof, fix = rnd.choice(WALLS), rnd.choice(ROOFS), None
        for pt, w, r, *f in STYLE:
            if inside(to_true((*pt, 0))[:2], bv, tris):
                wall, roof, fix = w, r, (f or [None])[0]
        z0 = min(p[2] for p in bv)
        if fix:
            # stretch walls to the eave and the roof to the ridge (heights above the base)
            top = max(p[2] for p in bv)
            ups = [p[2] for p in bv if p[2] > z0 + 0.1]
            eave = max(set(ups), key=ups.count)   # most of the outline's top corners sit at the eave
            E, R = fix
            bv = [(x, y, z0 + (z - z0) * E / (eave - z0) if z <= eave
                   else z0 + E + (z - eave) * (R - E) / max(top - eave, 0.01)) for x, y, z in bv]
        dz = level(cx, cy, z0) - z0
        o = len(V)
        pts = [from_true(x, y) for x, y, _ in bv]
        if any(BK_BACK < px < w_north(py) + 2 and BK_Y0 < py < BK_Y1 for px, py in pts):
            # the map's block round Burger King is the house and the taller building behind
            # it in one: keep only the part behind, ending at the house's back wall
            pts = [(min(px, BK_BACK), py) for px, py in pts]
        V += [(px, py, p[2] + dz) for (px, py), p in zip(pts, bv)]
        for t in tris:
            F.append(tuple(o + i for i in t))
            mi.append((walls.index(wall), roof_ix[roof]))
    me = bpy.data.meshes.new("Midtbyen")
    me.from_pydata(V, [], F)
    for m in mats:
        me.materials.append(m)
    for p, (w, r) in zip(me.polygons, mi):
        nz = abs(p.normal.z)
        p.material_index = w if nz < 0.3 else (len(mats) - 1 if nz > 0.97 else r)   # flat tops: grey felt
    o = bpy.data.objects.new("Midtbyen", me)
    scene.collection.objects.link(o)
    print(f"v3: {kept} map buildings, {len(F)} triangles")
    return o


def map_trees(data):
    """The map's trees outside the square, low poly: a trunk and one or two leaf blobs,
    all in one object."""
    import bmesh
    from mathutils import Matrix
    bm = bmesh.new()
    kinds = data["tree_kinds"]
    for x, y, z, k in data["trees"]:
        mx, my = from_true(x, y)
        if hand_built(mx, my) or (DREAM and math.hypot(x, y) > DREAM_R):
            continue
        h, r = kinds[k]
        # the map's tree models are generous; town trees here are younger and smaller
        h, r = max(5.0, min(h * 0.55, 11.0)), max(1.6, min(r * 0.45, 3.2))
        gz = level(x, y, z)
        bmesh.ops.create_cone(bm, cap_ends=False, segments=5, radius1=0.2, radius2=0.12, depth=h * 0.45,
                              matrix=Matrix.Translation((mx, my, gz + h * 0.225)))
        crown = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r,
                                           matrix=Matrix.Translation((mx, my, gz + h - r * 0.9))
                                           @ Matrix.Diagonal((1, 1, max(0.6, (h * 0.55) / (2 * r)), 1)))
        for v in crown["verts"]:
            for f in v.link_faces:
                f.material_index = 1
    me = bpy.data.meshes.new("MidtbyenTrees")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M["trunk"])
    me.materials.append(M["tree"])
    o = bpy.data.objects.new("MidtbyenTrees", me)
    scene.collection.objects.link(o)


def map_ground(data):
    """Terrain from the map, held level round the square; streets and parks draped on
    it; the sea and the river at sea level; a wide skirt of land past the map's edge."""
    import bmesh
    if "grass" not in M:
        M["grass"] = b.mat_flat("Trdgrass", srgb("#5d7a3e"), 1.0)
        M["pavement"] = b.mat_flat("Trdpavement", srgb("#8c8b86"), 0.9)
    if "Ground" in bpy.data.objects:   # the flat 500 m box is replaced by the terrain
        bpy.data.objects.remove(bpy.data.objects["Ground"])
    if "land" not in M:
        M["land"] = b.mat_flat("Trdland", srgb("#6d7660"), 1.0)
        M["felt"] = b.mat_flat("Trdfelt", srgb("#6a6c6c"), 0.9)
    t = map_mesh("Terrain", data["terrain"], [M["pavement"], M["land"]], -0.03)
    if os.path.exists(WIDE):   # the horizon comes from the wide map data instead
        map_wide()
        map_mesh("MapRoads", data["roads"], [M["road"]], 0.0)
        map_mesh("MapParks", data["green"], [M["grass"]], 0.005)
        map_mesh("MapRiver", data["water"], [M["water"]], 0.15)
        box("Sea", (0, 0, SEA), (40000, 40000, 0.1), "water")
        return
    bm = bmesh.new()
    bm.from_mesh(t.data)
    rim = [e for e in bm.edges if e.is_boundary]
    edge_pts = [(v.co.x, v.co.y, v.co.z) for v in {v for e in rim for v in e.verts}]
    ext = bmesh.ops.extrude_edge_only(bm, edges=rim)
    cx = sum(v.co.x for v in bm.verts) / len(bm.verts)
    cy = sum(v.co.y for v in bm.verts) / len(bm.verts)
    for g in ext["geom"]:
        if isinstance(g, bmesh.types.BMVert):
            dx, dy = g.co.x - cx, g.co.y - cy
            d = math.hypot(dx, dy)
            g.co.x, g.co.y = g.co.x + dx / d * 2500, g.co.y + dy / d * 2500
        elif isinstance(g, bmesh.types.BMFace):
            g.material_index = 1
    bm.to_mesh(t.data)
    bm.free()
    # Past the map's edge: low blocks thinning out over the skirt, so the town doesn't
    # stop at a line; on land only (the skirt keeps the edge's height)
    rnd = random.Random(11)
    x0, x1 = min(p[0] for p in edge_pts), max(p[0] for p in edge_pts)
    y0, y1 = min(p[1] for p in edge_pts), max(p[1] for p in edge_pts)
    for _ in range(500):
        x, y = rnd.uniform(x0 - 700, x1 + 700), rnd.uniform(y0 - 700, y1 + 700)
        out = max(x0 - x, x - x1, y0 - y, y - y1)
        if out < 15 or rnd.random() < out / 700:
            continue
        z = min(edge_pts, key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2)[2]
        if z < SEA + 1.0:
            continue
        w, d, h = rnd.uniform(12, 30), rnd.uniform(10, 24), rnd.uniform(7, 16)
        box("Town", (x, y, z + h / 2), (w, d, h), rnd.choice(("c1", "c3", "c4", "c5", "pink", "brick_dark")))
        box("TownRoof", (x, y, z + h + 0.6), (w + 0.4, d + 0.4, 1.2), rnd.choice(("slate", "roof", "brick")))
    map_mesh("MapRoads", data["roads"], [M["road"]], 0.0)
    map_mesh("MapParks", data["green"], [M["grass"]], 0.005)
    map_mesh("MapRiver", data["water"], [M["water"]], 0.15)
    box("Sea", (0, 0, SEA), (8000, 8000, 0.1), "water")


WIDE = os.path.join(os.path.dirname(DATA), "trondheim_wide.json.gz")
GROUND = 9.55   # metres above sea at the column


def map_wide():
    """Outside the 1 km core (trondheim_widedata.py): terrain out to ~14 km so the real
    hills and fjord shores make the horizon, and Overture's building outlines out to
    ~4 km as plain blocks, gabled where they are houses."""
    with gzip.open(WIDE, "rt") as f:
        wide = json.load(f)
    if "forest" not in M:
        M["forest"] = b.mat_flat("Trdforest", srgb("#3f5a33"), 1.0)
    T_, n, S = wide["terrain"]["dm"], wide["terrain"]["n"], wide["terrain"]["step"]
    h0 = (n - 1) // 2
    cx0, cx1, cy0, cy1 = wide["core"]

    def z_at(x, y):   # metres relative to the column's ground
        u, v = x / S + h0, y / S + h0
        i, j = min(max(int(u), 0), n - 2), min(max(int(v), 0), n - 2)
        fu, fv = u - i, v - j
        z = (T_[j * n + i] * (1 - fu) * (1 - fv) + T_[j * n + i + 1] * fu * (1 - fv)
             + T_[(j + 1) * n + i] * (1 - fu) * fv + T_[(j + 1) * n + i + 1] * fu * fv)
        return level(x, y, z / 10 - GROUND)

    # terrain grid with a hole where the core lies; cells reaching into it sit a little
    # lower so the core's own terrain wins there
    verts, faces, mats = [], [], []
    for j in range(n):
        for i in range(n):
            x, y = (i - h0) * S, (j - h0) * S
            verts.append((*from_true(x, y), level(x, y, T_[j * n + i] / 10 - GROUND)))
    for j in range(n - 1):
        for i in range(n - 1):
            x, y = (i - h0) * S, (j - h0) * S
            if cx0 < x and x + S < cx1 and cy0 < y and y + S < cy1:
                continue
            q = (j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i)
            faces.append(q)
            mats.append(1 if sum(T_[k] for k in q) / 40 > 70 else 0)
    for q in faces:
        if any(cx0 - S < (k % n - h0) * S < cx1 + S and cy0 - S < (k // n - h0) * S < cy1 + S for k in q):
            for k in q:
                x, y, z = verts[k]
                verts[k] = (x, y, z - 0.6)
    me = bpy.data.meshes.new("WideTerrain")
    me.from_pydata(verts, [], faces)
    me.materials.append(M["land"])
    me.materials.append(M["forest"])
    for p, m in zip(me.polygons, mats):
        p.material_index = m
    o = bpy.data.objects.new("WideTerrain", me)
    scene.collection.objects.link(o)

    # buildings: walls in town colours (shader windows), flat felt tops or gabled roofs
    walls = list(dict.fromkeys(WALLS))
    roofs = ("slate", "roof", "brick", "slate")
    mat_list = [windowed(w) for w in walls] + [M[r] for r in roofs] + [M["felt"]]
    V, F, MI = [], [], []
    rnd = random.Random(5)
    for bd in wide["buildings"]:
        h, gable, ring = bd[0], bd[1], bd[2:]
        pts = [(ring[i] / 10, ring[i + 1] / 10) for i in range(0, len(ring), 2)]
        k = len(pts)
        z0 = min(z_at(x, y) for x, y in pts) - 0.3
        if z0 < SEA:
            continue
        wall, roof = rnd.randrange(len(walls)), len(walls) + rnd.randrange(len(roofs))
        o = len(V)
        mp = [from_true(x, y) for x, y in pts]
        V += [(x, y, z0) for x, y in mp] + [(x, y, z0 + h) for x, y in mp]
        for i in range(k):
            F.append((o + i, o + (i + 1) % k, o + k + (i + 1) % k, o + k + i))
            MI.append(wall)
        if gable and k == 4:
            # ridge along the long side, over the middle of the two short edges
            e = [math.dist(mp[i], mp[(i + 1) % 4]) for i in range(4)]
            s0 = 0 if e[0] + e[2] < e[1] + e[3] else 1           # the short edges: s0 and s0 + 2
            short = (e[s0] + e[s0 + 2]) / 2
            a, b2 = mp[s0], mp[s0 + 1]
            c, d = mp[s0 + 2], mp[(s0 + 3) % 4]
            r1 = ((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2, z0 + h + short * 0.32)
            r2 = ((c[0] + d[0]) / 2, (c[1] + d[1]) / 2, z0 + h + short * 0.32)
            ia, ib, ic, id_ = (o + k + s0, o + k + s0 + 1, o + k + s0 + 2, o + k + (s0 + 3) % 4)
            V += [r1, r2]
            R1, R2 = len(V) - 2, len(V) - 1
            F += [(ia, ib, R1), (ic, id_, R2), (ib, ic, R2, R1), (id_, ia, R1, R2)]
            MI += [wall, wall, roof, roof]
        else:
            F.append(tuple(range(o + k, o + 2 * k)))
            MI.append(len(mat_list) - 1)
    me = bpy.data.meshes.new("WideTown")
    me.from_pydata(V, [], F)
    for m in mat_list:
        me.materials.append(m)
    for p, m in zip(me.polygons, MI):
        p.material_index = m
    o = bpy.data.objects.new("WideTown", me)
    scene.collection.objects.link(o)
    print(f"v3 wide: {len(F)} faces, terrain {n}x{n}")


def v3():
    with gzip.open(DATA, "rt") as f:
        data = json.load(f)
    if DREAM:   # a flat ground running off into the pale sky
        if "Ground" in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects["Ground"])
        box("Ground", (0, 0, -0.05), (20000, 20000, 0.1), "road")
    else:
        map_ground(data)
    map_buildings(data)
    map_trees(data)
    # Munkegata's slabs both ways from the square, as in v2
    poly_paving("Munkegata", [(w_north(SQ_N - 0.5), SQ_N - 0.5), (-6.0, SQ_N - 0.5), (-6.0, 86.0),
                              (e_north(86.0), 86.0), (e_north(150.0), 150.0), (w_north(150.0), 150.0)], 0.036)
    poly_paving("MunkegataS", [(w_south(SQ_S + 0.5), SQ_S + 0.5), (w_south(-130.0), -130.0), (e_south(-130.0), -130.0),
                               (e_south(-57.6), -57.6), (SQ_E, SQ_S + 0.5)], 0.036)
    burger_king()
    torg_and_pavilion()
    planters("v2")
    if os.path.exists(WIDE) or DREAM:
        return   # the real hills are in the wide terrain; the dream has none
    # far hills round the fjord, down at sea level
    for x, y, sx, sz in [(-1900, -400, 700, 260), (-1500, 1900, 1000, 160), (900, 2400, 1300, 140),
                         (2400, -600, 900, 220)]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=(x, y, SEA - 5))
        bpy.context.object.scale = (sx, 300, sz)
        bpy.context.object.data.materials.append(M["hill"])
        bpy.context.object.visible_shadow = False


# Extra preview shots for the surroundings: (camera, target, lens mm, aspect)
SHOTS = {
    # Like Adriaen's street photo: from the open corner by Føniks's north end, looking
    # west at Burger King's acute corner, Munkegata running off to the right
    "BK_street": ((-18.0, 52.0, 1.7), (-40.0, 66.0, 4.5), 22.0, 16 / 9),
    # From the square up Munkegata north and down Munkegata south
    "N_munkegata": ((-12.0, 25.0, 1.7), (-34.0, 110.0, 5.0), 26.0, 16 / 9),
    # Like Adriaen's Kongens gate photo: along the planter rows on the west and south edges
    "P_planters": ((-25.5, -15.0, 1.7), (-29.5, 30.0, 1.2), 26.0, 16 / 9),
    "P_south_row": ((12.0, -38.5, 1.7), (-22.0, -44.5, 1.0), 26.0, 16 / 9),
    # Straight down over Føniks, its annex and Kongens gate, for the GPS pins
    "T_west": ((-50.0, 20.0, 300.0), (-50.0, 20.001, 0.0), -80.0, 1.0),
    "T_north": ((-40.0, 80.0, 300.0), (-40.0, 80.001, 0.0), -80.0, 1.0),
    "S_munkegata": ((8.0, -25.0, 1.7), (31.0, -115.0, 5.0), 26.0, 16 / 9),
    # Close-ups of Olav and his column (he faces south down Munkegata)
    "O_front": ((0.0, -7.5, 16.0), (0.0, 0.0, 15.6), 50.0, 3 / 4),
    "O_side": ((7.0, -2.5, 15.2), (0.0, 0.0, 15.7), 50.0, 3 / 4),
    "O_top": ((-3.5, -5.0, 13.8), (0.0, 0.0, 13.6), 35.0, 16 / 9),
    "O_base": ((5.5, -8.0, 1.6), (0.0, 0.0, 2.6), 28.0, 16 / 9),
    "O_full": ((12.0, -20.0, 1.7), (0.0, 0.0, 9.0), 24.0, 3 / 4),
    # Stiftsgården's long front on Munkegata north, from across the street
    "N_stift": ((-40.0, 92.0, 1.7), (-14.0, 122.0, 7.0), 24.0, 16 / 9),
    # v3: high over the harbour looking south over Midtbyen to the square, and straight
    # down over the whole map
    "C_city": ((-260.0, 620.0, 260.0), (10.0, 0.0, 0.0), 28.0, 16 / 9),
    "T_town": ((0.0, 100.0, 1500.0), (0.0, 100.001, 0.0), -1100.0, 1.0),
}


# Adriaen's GPS points (the statue, the phoenix, Føniks's south-east roof corner, the four
# corners of the rectangle through the planter rows and the pavilion's centre) against the
# layout above, which was measured on a screenshot: fitted with the statue fixed, it is
# 4.5% too small, and the square is turned so that its own "north" faces true bearing
# ~4.6 degrees (the planter rectangle alone: 69.6 x 80.6 m, turned 4.2). Residuals are
# 0.3-1.5 m. true_world() puts the built scene on true north at true size; to_true()
# does the same for a single point such as a camera.
TRUE_SCALE, TRUE_TURN = 1.045, math.radians(-4.6)


def to_true(p):
    c, s = math.cos(TRUE_TURN), math.sin(TRUE_TURN)
    x, y = p[0] * TRUE_SCALE, p[1] * TRUE_SCALE
    return (c * x - s * y, s * x + c * y, p[2])


def true_world():
    """Scale meshes horizontally (heights were measured separately) and turn the whole
    scene; characters and other non-mesh roots are only moved and turned, lights stay."""
    from mathutils import Matrix
    R = Matrix.Rotation(TRUE_TURN, 4, "Z")
    W = R @ Matrix.Diagonal((TRUE_SCALE, TRUE_SCALE, 1.0, 1.0))
    for o in list(bpy.data.objects):
        if o.parent is not None or o.type in ("LIGHT", "CAMERA"):
            continue
        if o.type == "MESH" and o.data.users == 1 and not o.children:
            o.data.transform(o.matrix_world)
            o.data.transform(W)
            o.matrix_world = Matrix.Identity(4)
        else:
            old = o.matrix_world.translation.copy()
            o.matrix_world = Matrix.Translation(W @ old) @ R @ Matrix.Translation(-old) @ o.matrix_world
