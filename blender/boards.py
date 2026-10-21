"""
Textures for the control room's whiteboards, drawn with PIL:

    pnid_board()   a whiteboard with made-up P&ID sheets held by magnets,
                   marked up with highlighter, plus sticky notes and scribbles
    shift_board()  a shift-status board: a marker grid with magnetic labels
                   for who is on shift, who is on call, and open work
    notes_board()  a mobile whiteboard with a hand-drawn process sketch
    esd_panel()    the printed front of the hardwired ESD matrix panel

Everything is generic and seeded, so the same image comes out every build.
Each returns the path of a PNG in blender/build/boards/.
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build", "boards")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_HAND = "/usr/share/fonts/truetype/freefont/FreeSansOblique.ttf"

BOARD = (238, 240, 240)
INK = (30, 32, 36)
MARKER = {"blue": (30, 60, 150), "red": (180, 30, 30), "black": (35, 35, 40), "green": (20, 110, 50)}


def _font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


# ------------------------------------------------------------------ P&IDs

def _valve(d, x, y, s, vertical=False):
    """Gate valve: two triangles tip to tip."""
    if vertical:
        d.polygon([(x - s, y - s), (x + s, y - s), (x, y)], outline=INK, width=2)
        d.polygon([(x - s, y + s), (x + s, y + s), (x, y)], outline=INK, width=2)
    else:
        d.polygon([(x - s, y - s), (x - s, y + s), (x, y)], outline=INK, width=2)
        d.polygon([(x + s, y - s), (x + s, y + s), (x, y)], outline=INK, width=2)


def _bubble(d, x, y, r, tag, f):
    d.ellipse([x - r, y - r, x + r, y + r], outline=INK, fill=(255, 255, 255), width=2)
    d.line([x - r, y, x + r, y], fill=INK, width=1)
    a, n = tag.split(" ")
    d.text((x, y - r / 2), a, fill=INK, font=f, anchor="mm")
    d.text((x, y + r / 2), n, fill=INK, font=f, anchor="mm")


def _sheet(rng, w, h, number):
    """One landscape P&ID sheet: vessels and pumps joined by pipes, with
    valves and instrument bubbles, a border and a title block."""
    img = Image.new("RGB", (w, h), (250, 250, 246))
    d = ImageDraw.Draw(img)
    small, tiny = _font(FONT, max(9, h // 42)), _font(FONT, max(7, h // 60))
    m = h // 30
    d.rectangle([m, m, w - m, h - m], outline=INK, width=3)
    # Title block, bottom right
    tw, th = w // 4, h // 7
    tx, ty = w - m - tw, h - m - th
    d.rectangle([tx, ty, w - m, h - m], outline=INK, width=2)
    for k in range(1, 3):
        d.line([tx, ty + k * th // 3, w - m, ty + k * th // 3], fill=INK, width=1)
    d.text((tx + 8, ty + th // 6), "PIPING & INSTRUMENT DIAGRAM", fill=INK, font=tiny, anchor="lm")
    d.text((tx + 8, ty + th // 2), f"PROCESS AREA {number // 10}  -  SHEET {number % 10 + 1}", fill=INK, font=tiny, anchor="lm")
    d.text((tx + 8, ty + 5 * th // 6), f"DWG X-{1000 + number:04d}-P-{rng.randint(10, 99)}  REV {rng.choice('ABCD')}",
           fill=INK, font=tiny, anchor="lm")
    # Equipment along the sheet: vessels, a pump, a heat exchanger
    n = rng.randint(3, 4)
    xs = [m + (w - 2 * m) * (i + 0.6) / (n + 0.4) for i in range(n)]
    base = int(h * 0.62)
    nodes = []
    for i, x in enumerate(xs):
        kind = rng.choice(["vvessel", "hvessel", "pump", "hx"]) if i else "vvessel"
        if kind == "vvessel":
            vw, vh = w // 14, h // 2.6
            y0 = base - vh
            d.rounded_rectangle([x - vw / 2, y0, x + vw / 2, base], radius=vw / 2, outline=INK, width=3)
            d.line([x - vw / 2, y0 + vh * 0.55, x + vw / 2, y0 + vh * 0.55], fill=INK, width=1)  # liquid level
            nodes.append((x, y0 + vh * 0.25, x, base - vh * 0.15))
        elif kind == "hvessel":
            vw, vh = w // 6, h // 7
            d.rounded_rectangle([x - vw / 2, base - vh, x + vw / 2, base], radius=vh / 2, outline=INK, width=3)
            nodes.append((x - vw / 2, base - vh / 2, x + vw / 2, base - vh / 2))
        elif kind == "pump":
            r = h // 22
            d.ellipse([x - r, base - 2 * r, x + r, base], outline=INK, width=3)
            d.polygon([(x - r * 0.6, base - r * 1.6), (x - r * 0.6, base - r * 0.4), (x + r * 0.8, base - r)], outline=INK, width=2)
            nodes.append((x - r, base - r, x + r, base - 2 * r))
        else:
            r = h // 18
            d.ellipse([x - r, base - 3 * r, x + r, base - r], outline=INK, width=3)
            d.line([x - r, base - 2 * r, x - r / 3, base - 2.6 * r, x + r / 3, base - 1.4 * r, x + r, base - 2 * r], fill=INK, width=2)
            nodes.append((x - r, base - 2 * r, x + r, base - 2 * r))
        d.text((x, base + h // 22), f"{rng.choice('VPEK')}-{number}{i + 1:02d}", fill=INK, font=small, anchor="mm")
    # Pipes: from each item's outlet to the next item's inlet, routed orthogonally
    pipes = []
    for (_, _, ox, oy), (ix, iy, _, _) in zip(nodes, nodes[1:]):
        midx = (ox + ix) / 2
        path = [(ox, oy), (ox + 20, oy), (ox + 20, base + h // 9) if oy > base - 30 else (midx, oy), (midx, iy), (ix, iy)]
        if oy > base - 30:
            path = [(ox, oy), (ox, base + h // 9), (midx, base + h // 9), (midx, iy), (ix, iy)]
        d.line(path, fill=INK, width=3)
        pipes.append(path)
        # Arrow at the inlet
        ax, ay = ix, iy
        dx = 1 if ix > midx else -1
        d.polygon([(ax - dx * 14, ay - 7), (ax - dx * 14, ay + 7), (ax, ay)], fill=INK)
        # A valve and an instrument on the horizontal run
        vx, vy = (midx + ix) / 2, iy
        _valve(d, vx, vy, 9)
        d.line([vx, vy - 9, vx, vy - 26], fill=INK, width=2)
        d.rectangle([vx - 10, vy - 36, vx + 10, vy - 26], outline=INK, width=2)
        bx, by = (midx + ix) / 2 + rng.choice([-1, 1]) * 50, iy - h // 7
        d.line([bx, by + h // 30, bx, iy], fill=INK, width=1)
        _bubble(d, bx, by, h // 30, f"{rng.choice(['PT', 'TT', 'FT', 'LT', 'PIC', 'LIC'])} {rng.randint(100, 999)}", tiny)
    # Inlet and outlet lines off the edges, plus a few dashed signal lines
    first, last = nodes[0], nodes[-1]
    d.line([(m, first[1]), (first[0] - w // 28, first[1])], fill=INK, width=3)
    d.line([(last[2], last[3]), (w - m, last[3])], fill=INK, width=3)
    for _ in range(3):
        y = rng.randint(m * 3, base - h // 3)
        x0 = rng.randint(m * 3, w // 2)
        for x in range(x0, x0 + rng.randint(w // 8, w // 3), 14):
            d.line([x, y, x + 7, y], fill=INK, width=1)
    # Notes column, top left
    for k in range(rng.randint(3, 6)):
        d.line([m + 20, m + 20 + k * 14, m + 20 + rng.randint(60, w // 5), m + 20 + k * 14], fill=(110, 110, 110), width=2)
    return img, pipes


def _highlight(img, path, color, width):
    """Highlighter over a pipe run, a little sloppy, multiplied onto the paper."""
    over = Image.new("RGB", img.size, (255, 255, 255))
    ImageDraw.Draw(over).line(path, fill=color, width=width, joint="curve")
    from PIL import ImageChops
    return ImageChops.multiply(img, over)


def _scribble(d, rng, x, y, w, rows, color, f):
    """Marker handwriting: short made-up notes."""
    words = ["check", "PSV", "isol.", "open", "WO", "done", "drain", "PM", "flush", "hold", "ok", "night",
             "tag", "valve", "->", "reset", "bypass", "test"]
    for r in range(rows):
        line = " ".join(rng.choice(words) for _ in range(rng.randint(2, 4)))
        if rng.random() < 0.5:
            line += f" {rng.randint(10, 999)}"
        d.text((x, y + r * f.size * 1.4), line, fill=color, font=f)


def _magnet(d, x, y, r, color):
    d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    d.ellipse([x - r * 0.5, y - r * 0.7, x + r * 0.1, y - r * 0.2], fill=tuple(min(255, c + 60) for c in color))


def pnid_board(w=4096, h=2048, seed=7):
    """2.4 x 1.2 m whiteboard: eight A3 P&ID sheets, marked up."""
    rng = random.Random(seed)
    img = Image.new("RGB", (w, h), BOARD)
    d = ImageDraw.Draw(img)
    px = w / 2.4  # pixels per metre
    sw, sh = int(0.42 * px), int(0.297 * px)
    hand = _font(FONT_HAND, int(0.028 * px))
    marks = [(255, 240, 60), (255, 150, 200), (130, 230, 120)]
    spots = [(0.06, 0.06), (0.52, 0.05), (0.98, 0.07), (0.10, 0.42), (0.56, 0.44), (1.02, 0.40),
             (0.08, 0.80), (0.54, 0.82)]
    for i, (sx, sy) in enumerate(spots):
        sheet, pipes = _sheet(rng, sw, sh, 10 * (i // 3 + 1) + i % 3)
        for p in rng.sample(pipes, k=min(len(pipes), rng.randint(1, 2))):
            sheet = _highlight(sheet, p, rng.choice(marks), 14)
        sheet = sheet.rotate(rng.uniform(-1.2, 1.2), expand=True, fillcolor=BOARD)
        x, y = int(sx * px), int(sy * px)
        img.paste(sheet, (x, y))
        for cx, cy in ((x + 18, y + 18), (x + sheet.width - 18, y + 18)):
            _magnet(d, cx, cy, 13, rng.choice([(200, 40, 40), (40, 70, 170), (30, 30, 30)]))
    # Right-hand strip: sticky notes and marker notes
    x0 = int(1.55 * px)
    for k in range(5):
        x, y = x0 + int((k % 2) * 0.12 * px), int((0.10 + 0.12 * (k // 2) + 0.02 * k) * px)
        c = rng.choice([(255, 235, 90), (255, 180, 200), (170, 230, 255)])
        d.rectangle([x, y, x + int(0.075 * px), y + int(0.075 * px)], fill=c)
        for r in range(3):
            d.line([x + 10, y + 18 + r * 22, x + int(0.06 * px), y + 18 + r * 22], fill=(60, 60, 70), width=3)
    _scribble(d, rng, int(1.80 * px), int(0.12 * px), 0, 7, MARKER["blue"], hand)
    _scribble(d, rng, int(1.55 * px), int(0.62 * px), 0, 6, MARKER["black"], hand)
    _scribble(d, rng, int(1.55 * px), int(0.88 * px), 0, 3, MARKER["red"], hand)
    # Faint ghosting of old marker
    ghost = Image.new("RGB", (w, h), (255, 255, 255))
    gd = ImageDraw.Draw(ghost)
    for _ in range(40):
        x, y = rng.randint(0, w), rng.randint(0, h)
        gd.line([x, y, x + rng.randint(50, 300), y + rng.randint(-20, 20)], fill=(232, 234, 236), width=6)
    from PIL import ImageChops
    img = ImageChops.multiply(img, ghost)
    return _save(img, "pnid_board.png")


def shift_board(w=2048, h=1536, seed=3):
    """1.2 x 0.9 m shift-status board: printed grid, magnetic name strips."""
    rng = random.Random(seed)
    img = Image.new("RGB", (w, h), BOARD)
    d = ImageDraw.Draw(img)
    px = w / 1.2
    lab = _font(FONT_BOLD, int(0.019 * px))
    hand = _font(FONT_HAND, int(0.022 * px))
    cols = ["ON SHIFT - DAY", "ON SHIFT - NIGHT", "CALL-OUT NIGHT"]
    rows = ["CCR 1", "CCR 2", "AREA 1", "AREA 2", "MECH", "ELEC", "INSTR", "LEAD"]
    gx0, gy0 = int(0.17 * px), int(0.10 * px)
    cw, rh = int(0.29 * px), int(0.062 * px)
    grid = (120, 125, 130)
    for c in range(len(cols) + 1):
        d.line([gx0 + c * cw, gy0, gx0 + c * cw, gy0 + rh * len(rows)], fill=grid, width=3)
    for r in range(len(rows) + 1):
        d.line([int(0.03 * px), gy0 + r * rh, gx0 + cw * len(cols), gy0 + r * rh], fill=grid, width=3)

    def strip(x, y, text, color, wdt=None):
        wdt = wdt or int(lab.getlength(text) + 0.03 * px)
        d.rounded_rectangle([x, y, x + wdt, y + int(0.038 * px)], radius=6, fill=color)
        d.text((x + wdt / 2, y + int(0.019 * px)), text, fill=(255, 255, 255), font=lab, anchor="mm")
        return wdt

    blue, red, green, grey = (35, 85, 175), (190, 40, 40), (40, 140, 70), (90, 95, 100)
    for c, t in enumerate(cols):
        strip(gx0 + c * cw + 10, gy0 - int(0.05 * px), t, blue, cw - 20)
    for r, t in enumerate(rows):
        strip(int(0.035 * px), gy0 + r * rh + int(0.012 * px), t, grey, gx0 - int(0.05 * px))
    letters = "ABCDEFGHJKLMNOPRST"
    for r in range(len(rows)):
        for c in range(len(cols)):
            if c == 2 and r in (0, 1, 7):
                continue
            if rng.random() < 0.85:
                name = f"{rng.choice(letters)}{rng.choice(letters)}"
                x = strip(gx0 + c * cw + 14, gy0 + r * rh + int(0.012 * px), name, blue)
                if rng.random() < 0.25:
                    strip(gx0 + c * cw + 24 + x, gy0 + r * rh + int(0.012 * px), "RADIO", green)
    # Open work, written underneath
    y = gy0 + rh * len(rows) + int(0.04 * px)
    for k, (t, ink) in enumerate([("OPEN PERMITS", "black"), ("ISOLATIONS", "red"), ("OVERRIDES", "blue")]):
        strip(int((0.035 + 0.38 * k) * px), y, t, red)
        _scribble(d, rng, int((0.04 + 0.38 * k) * px), y + int(0.05 * px), 0, 4, MARKER[ink], hand)
    for _ in range(6):
        _magnet(d, rng.randint(int(1.08 * px), w - 30), rng.randint(int(0.1 * px), int(0.6 * px)), 14,
                rng.choice([(200, 40, 40), (40, 70, 170), (230, 190, 30)]))
    return _save(img, "shift_board.png")


def notes_board(w=2048, h=1536, seed=11):
    """1.2 x 0.9 m mobile whiteboard: a hand-drawn sketch of a process train
    from a handover, with notes around it."""
    rng = random.Random(seed)
    img = Image.new("RGB", (w, h), BOARD)
    d = ImageDraw.Draw(img)
    px = w / 1.2
    hand = _font(FONT_HAND, int(0.026 * px))
    big = _font(FONT_HAND, int(0.04 * px))
    blue, red, black = MARKER["blue"], MARKER["red"], MARKER["black"]
    d.text((int(0.06 * px), int(0.05 * px)), "Handover / plan", fill=black, font=big)
    # Separator train: three wobbly vessels joined by lines
    y = int(0.38 * px)
    xs = [int(f * px) for f in (0.16, 0.42, 0.68)]
    for i, x in enumerate(xs):
        vw, vh = int(0.10 * px), int(0.16 * px)
        d.rounded_rectangle([x - vw, y - vh, x + vw, y + vh], radius=int(0.09 * px), outline=blue, width=7)
        d.text((x, y + vh + int(0.04 * px)), f"{i + 1}st stage", fill=blue, font=hand, anchor="mm")
        if i:
            d.line([xs[i - 1] + vw, y, x - vw, y + rng.randint(-8, 8)], fill=blue, width=6)
            d.polygon([(x - vw, y), (x - vw - 24, y - 12), (x - vw - 24, y + 12)], fill=blue)
    d.line([xs[-1] + int(0.10 * px), y, int(1.10 * px), y], fill=blue, width=6)
    d.text((int(0.90 * px), y - int(0.06 * px)), "to export", fill=blue, font=hand)
    d.ellipse([xs[1] - int(0.14 * px), y - int(0.21 * px), xs[1] + int(0.14 * px), y + int(0.21 * px)],
              outline=red, width=6)
    d.text((xs[1] + int(0.15 * px), y - int(0.24 * px)), "level osc.?", fill=red, font=hand)
    _scribble(d, rng, int(0.06 * px), int(0.66 * px), 0, 5, black, hand)
    _scribble(d, rng, int(0.62 * px), int(0.66 * px), 0, 4, red, hand)
    ghost = Image.new("RGB", (w, h), (255, 255, 255))
    gd = ImageDraw.Draw(ghost)
    for _ in range(25):
        x, y = rng.randint(0, w), rng.randint(0, h)
        gd.line([x, y, x + rng.randint(50, 300), y + rng.randint(-20, 20)], fill=(232, 234, 236), width=6)
    from PIL import ImageChops
    img = ImageChops.multiply(img, ghost)
    return _save(img, "notes_board.png")


ESD_ZONES = ["WELLHEAD", "PROCESS", "UTILITY", "LIVING QTR", "ELEC"]


def esd_panel(w=2048, h=2560, seed=5):
    """1.6 x 2.0 m front of a hardwired ESD matrix panel: printed on a grid
    of square tiles, with a mimic of the platform's fire areas, black label
    strips, and the outlines that the lamps and key switches sit in (those
    are geometry, see props.make_esd_panel). Generic labels only."""
    rng = random.Random(seed)
    img = Image.new("RGB", (w, h), (226, 228, 228))
    d = ImageDraw.Draw(img)
    px = w / 1.6
    tile = int(0.08 * px)
    for x in range(0, w, tile):
        d.line([x, 0, x, h], fill=(205, 208, 208), width=2)
    for y in range(0, h, tile):
        d.line([0, y, w, y], fill=(205, 208, 208), width=2)
    lab = _font(FONT_BOLD, int(0.03 * px))
    small = _font(FONT, int(0.017 * px))
    strip = (45, 48, 52)

    def band(y, text, x0=0.04, x1=1.56):
        d.rectangle([int(x0 * px), int(y * px), int(x1 * px), int((y + 0.05) * px)], fill=strip)
        d.text((int((x0 + 0.03) * px), int((y + 0.025) * px)), text, fill=(235, 235, 235), font=lab, anchor="lm")

    band(0.08, "ESD SYSTEM")
    band(0.08, "FIRE AREAS", x0=0.62)
    # Vertical divider between the left column and the mimic
    d.line([int(0.58 * px), int(0.13 * px), int(0.58 * px), int(1.05 * px)], fill=strip, width=6)
    # Mimic: a stepped silhouette of the topsides, split into fire areas
    gx0, gy1 = 0.72, 0.92
    cols = [(0.16, 0.42), (0.14, 0.30), (0.14, 0.26), (0.14, 0.30), (0.16, 0.50)]
    x = gx0
    for i, (cw, ch) in enumerate(cols):
        x0, x1 = int(x * px), int((x + cw) * px)
        d.rectangle([x0, int((gy1 - ch) * px), x1, int(gy1 * px)], fill=(150, 172, 178), outline=(90, 110, 116), width=4)
        d.text(((x0 + x1) // 2, int((gy1 + 0.035) * px)), ESD_ZONES[i], fill=(40, 44, 48), font=small, anchor="mm")
        x += cw
    d.line([int((gx0 + 0.70) * px), int(0.22 * px), int((gx0 + 0.70) * px), int(0.42 * px)], fill=(90, 110, 116), width=6)
    # Labels over the lamp/key positions of the left column (see props)
    for k, t in enumerate(["ESD 1", "ESD 2", "PSD", "BLOWDOWN", "F&G OVERRIDE"]):
        d.text((int(0.10 * px), int((0.20 + 0.14 * k) * px)), t, fill=(40, 44, 48), font=small, anchor="lm")
    band(1.08, "ALARMS")
    band(1.08, "MANUAL ISOLATION", x0=0.62)
    band(1.62, "ONSHORE OPS", x0=0.04, x1=0.78)
    band(1.62, "MAINTENANCE BYPASS", x0=0.82)
    for k in range(rng.randint(14, 18)):
        cx, cy = rng.uniform(0.12, 1.50), rng.choice([1.24, 1.38, 1.50, 1.78, 1.90])
        d.text((int(cx * px), int((cy - 0.045) * px)), f"{rng.choice('ABCDEFGH')}{rng.randint(10, 99)}",
               fill=(70, 74, 78), font=small, anchor="mm")
    return _save(img, "esd_panel.png")


BINDER_COLOURS = [(80, 111, 173), (170, 170, 173), (194, 80, 70), (70, 70, 75), (218, 206, 124)]


def binder_spines(size, shelves, seed=4, ppm=1100):
    """Front of a shelving unit's binder rows, as one image: `size` is the
    face (w, h) in metres, `shelves` the heights of the shelf boards above
    its bottom edge. Each row is a run of coloured spines with a white
    label and a finger hole, the odd gap, and dark shelf interior above."""
    rng = random.Random(seed)
    w, h = size
    W, H = int(w * ppm), int(h * ppm)
    img = Image.new("RGB", (W, H), (38, 39, 41))
    d = ImageDraw.Draw(img)
    y = lambda z: H - int(z * ppm)  # noqa: E731  metres up from the bottom -> pixel row
    for z0 in shelves[:-1]:
        x = 0.03
        while x < w - 0.08:
            if rng.random() < 0.12:
                x += 0.12
                continue
            bw, bh = rng.choice([0.05, 0.075, 0.075, 0.08]), rng.choice([0.32, 0.32, 0.30])
            c = rng.choice(BINDER_COLOURS)
            x0, x1 = int(x * ppm), int((x + bw - 0.004) * ppm)
            d.rectangle([x0, y(z0 + bh), x1, y(z0)], fill=c)
            d.line([x1 - 2, y(z0 + bh), x1 - 2, y(z0)], fill=tuple(int(v * 0.7) for v in c), width=3)  # spine edge
            cx = (x0 + x1) // 2
            lw = int(0.0125 * ppm)
            d.rectangle([cx - lw, y(z0 + bh * 0.75 + 0.03), cx + lw, y(z0 + bh * 0.75 - 0.03)], fill=(232, 230, 222))
            for k in range(3):  # a few scribbled lines on the label
                yy = y(z0 + bh * 0.75 + 0.02 - k * 0.015)
                d.line([cx - lw + 4, yy, cx + lw - rng.randint(4, 10), yy], fill=(70, 70, 80), width=2)
            r = int(0.011 * ppm)
            d.ellipse([cx - r, y(z0 + 0.06) - r, cx + r, y(z0 + 0.06) + r], fill=(30, 30, 32))  # finger hole
            x += bw
    for z0 in shelves:  # the shelf boards, which sit in front of this face anyway
        d.rectangle([0, y(z0 + 0.0125), W, y(z0 - 0.0125)], fill=(150, 152, 154))
    return _save(img, "binders.png")


def _save(img, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    img.save(path)
    return path


if __name__ == "__main__":
    print(pnid_board())
    print(shift_board())
    print(notes_board())
    print(esd_panel())
