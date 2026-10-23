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
"""
import math
import random

_NAMES = ("bpy", "b", "M", "scene", "srgb", "box", "cyl", "frustum", "block", "paved", "paving",
          "SQ_W", "SQ_E", "SQ_S", "SQ_N", "FONIKS_FRONT", "FONIKS_SOUTH", "FW", "FB")


def build(g, variant="v2"):
    globals().update({k: g[k] for k in _NAMES})
    {"v1": v1, "v2": v2}[variant]()


# --- shared by both variants -------------------------------------------------------

def brick_west():
    # West of the annex: a block clad in copper-brown fins on a tight window grid
    block("BrickW", -108, FB - 22, 13, 32, 17, "copper", 6, ("-y",), None)


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


def planters():
    # Planters with young trees in rows along the edges of the square
    for x, y in ([(-29, y) for y in (27, 18, 9, -10, -36)] + [(24, -60), (30, -72)]
                 + [(37, y) for y in (28, 18, 8, -10, -20, -32)] + [(x, 33) for x in (-20, -3, 8, 18, 29)]
                 + [(x, -43.5) for x in (-18, -6, 4.5, 23, 33)]):
        box("Planter", (x, y, 0.3), (2.6, 2.6, 0.6), "granite")
        cyl("Trunk", (x, y, 0.6), 0.12, 1.8, "trunk", 6)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.3, location=(x, y, 3.2))
        bpy.context.object.data.materials.append(M["tree"])


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


def text(body, loc, a, size, mat):
    """Upright lettering on a wall whose along-the-wall angle is a, facing outward."""
    bpy.ops.object.text_add(location=loc, rotation=(math.pi / 2, 0, a))
    o = bpy.context.object
    o.data.body, o.data.size, o.data.extrude = body, size, 0.02
    o.data.align_x, o.data.align_y = "CENTER", "CENTER"
    o.data.materials.append(M[mat])
    return o


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
    acute (~75 degrees) with a narrow cut-off holding the round logo. Light grey hipped
    roof with skylights, white trim, big shop windows on a grey stone plinth."""
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
    for i in (1, 3):   # the white corner boards
        x, y = pts[i]
        box("BurgerKingCorner", (x, y, H / 2), (0.35, 0.35, H), "frame")
    # The south front (only the part clear of Føniks shows) and the Munkegata side:
    # shop windows below the sign band, sash windows in white frames above
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
        # the sign band between the floors, near the corner on both faces
        at, size = (s0 + (L - s0) / 2, 0.45) if i == 0 else (5.0, 0.8)
        text("BURGER KING", (x0 + ux * at + nx * 0.14, y0_ + uy * at + ny * 0.14, 4.4), a, size, "flag")
    (x0, y0_), (ux, uy), L, (nx, ny), a = edge(pts, 1)   # the cut-off corner: door below, logo above
    cx, cy = x0 + ux * L / 2, y0_ + uy * L / 2
    box("BurgerKingDoor", (cx + nx * 0.06, cy + ny * 0.06, 1.8), (1.2, 0.2, 2.4), "glass", rot=a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.45, depth=0.08,
                                        location=(cx + nx * 0.12, cy + ny * 0.12, 4.4), rotation=(math.pi / 2, 0, a))
    bpy.context.object.name = "BurgerKingLogo"
    bpy.context.object.data.materials.append(M["logo_orange"])


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
    brick_west()
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
    planters()

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


# Extra preview shots for the surroundings: (camera, target, lens mm, aspect)
SHOTS = {
    # Like Adriaen's street photo: from the open corner by Føniks's north end, looking
    # west at Burger King's acute corner, Munkegata running off to the right
    "BK_street": ((-18.0, 52.0, 1.7), (-40.0, 66.0, 4.5), 22.0, 16 / 9),
    # From the square up Munkegata north and down Munkegata south
    "N_munkegata": ((-12.0, 25.0, 1.7), (-34.0, 110.0, 5.0), 26.0, 16 / 9),
    "S_munkegata": ((8.0, -25.0, 1.7), (31.0, -115.0, 5.0), 26.0, 16 / 9),
}
