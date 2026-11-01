"""
Textures for the control room's whiteboards, drawn with PIL:

    pnid_board()   a whiteboard with made-up P&ID sheets held by magnets,
                   marked up with highlighter, plus sticky notes and scribbles
    shift_board()  a shift-status board: a marker grid with magnetic labels
                   for who is on shift, who is on call, and open work
    notes_board()  a mobile whiteboard with a hand-drawn process sketch
    esd_panel()    the printed front of the hardwired ESD matrix panel
    photo_print()  the picture in the desk photo frame, plain
                   or with hearts doodled around it in marker
    notepad_page() the ruled lines on the desk notepads' open page
    ceiling_vent() the grilles on the ceiling's air cassettes

Everything is generic and seeded, so the same image comes out every build.
Each returns the path of a PNG in blender/build/boards/.
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build", "boards")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_HAND = "/usr/share/fonts/truetype/freefont/FreeSansOblique.ttf"

BOARD = (238, 240, 240)
INK = (30, 32, 36)
MARKER = {"blue": (30, 60, 150), "red": (180, 30, 30), "black": (35, 35, 40), "green": (20, 110, 50)}
NOTEPAD_PAGE = (0.146, 0.198), -0.006  # (width, depth) in m, and its centre along the pad, from props.make_notepad


def _font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


# ---------------------------------------------------------------- notepad

def notepad_page(w=512, rule=0.007, ink=0.0008):
    """Faint blue lines every 7 mm on paper, the page of props.make_notepad."""
    (pw, ph), cy = NOTEPAD_PAGE
    s = 4  # drawn large, then scaled down for soft edges
    h = round(w * ph / pw)
    ppm = w / pw
    img = Image.new("RGB", (w * s, h * s), (239, 238, 230))
    d = ImageDraw.Draw(img)
    k = math.ceil((cy - ph / 2) / rule)
    while k * rule < cy + ph / 2:
        row = (cy + ph / 2 - k * rule) * ppm * s
        d.rectangle((0, row - ink / 2 * ppm * s, w * s, row + ink / 2 * ppm * s), fill=(169, 190, 225))
        k += 1
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "notepad_page.png")
    img.resize((w, h), Image.LANCZOS).save(path, optimize=True)
    return path


# ---------------------------------------------------------------- ceiling

VENT_BODY, VENT_EDGE, VENT_SLOT = (205, 207, 208), (172, 174, 176), (38, 40, 44)


def ceiling_vent(style=None, s=512):
    """The face of a ceiling air cassette, looking down. Three looks:
    cassette   four long outlets round a fine return grille (the default)
    squares    a square diffuser: rings of slots, smaller toward a solid middle
    louvres    one big grille of parallel slats"""
    style = style or os.environ.get("VENT_STYLE", "cassette")
    k = 4  # drawn large, then scaled down for soft edges
    S = s * k
    img = Image.new("RGB", (S, S), VENT_BODY)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, S - 1, S - 1), outline=VENT_EDGE, width=int(S * 0.018))
    if style == "squares":
        for m, w in ((0.09, 0.040), (0.19, 0.036), (0.285, 0.032), (0.37, 0.028)):
            a, t = int(S * m), int(S * w)
            d.rectangle((a, a, S - a, S - a), outline=VENT_SLOT, width=t)
    elif style == "louvres":
        m = int(S * 0.07)
        d.rectangle((m, m, S - m, S - m), fill=VENT_EDGE)
        n = 22
        for i in range(n):
            y = m + int((S - 2 * m) * (i + 0.5) / n)
            t = int((S - 2 * m) / n * 0.55)
            d.rectangle((m + int(S * 0.012), y - t // 2, S - m - int(S * 0.012), y + t // 2), fill=VENT_SLOT)
    else:
        m, t, inset = int(S * 0.055), int(S * 0.075), int(S * 0.16)
        for box in ((inset, m, S - inset, m + t), (inset, S - m - t, S - inset, S - m),
                    (m, inset, m + t, S - inset), (S - m - t, inset, S - m, S - inset)):
            d.rounded_rectangle(box, radius=t // 3, fill=VENT_SLOT)
        g = int(S * 0.24)
        d.rectangle((g, g, S - g, S - g), fill=VENT_EDGE)
        n = 16
        for i in range(n):
            y = g + int((S - 2 * g) * (i + 0.5) / n)
            h = int((S - 2 * g) / n * 0.5)
            d.rectangle((g + int(S * 0.012), y - h // 2, S - g - int(S * 0.012), y + h // 2), fill=VENT_SLOT)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "ceiling_vent.png")
    img.resize((s, s), Image.LANCZOS).save(path, optimize=True)
    return path


# ---------------------------------------------------------------- surfaces
# Small repeating images for the big surfaces: the atlas is far too coarse for
# fibres and grain. Each wraps at its edges.

def _soft(shape, sigma, rng):
    """Random noise blurred with a wrap-around Gaussian (sigma in pixels, y and x), so it tiles. About -1 to 1."""
    h, w = shape
    fy, fx = np.fft.fftfreq(h)[:, None], np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2 * (math.pi ** 2) * ((fy * sigma[0]) ** 2 + (fx * sigma[1]) ** 2))
    a = np.fft.irfft2(np.fft.rfft2(rng.standard_normal((h, w))) * g, s=(h, w))
    return a / (a.std() * 2.5)


def _tile(a, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)).save(path, optimize=True)
    return path


CARPET_SQUARE = (  # one carpet square, as bands of rectangles: (band's share of the square, ((share of the band, grey, ribbed), ...))
    # the darkest stays off the edges: touching it would line up with the turned neighbours into a zigzag
    (0.28, ((0.58, 94, False), (0.42, 104, False))),
    (0.44, ((0.22, 104, False), (0.54, 78, True), (0.24, 91, False))),
    (0.28, ((0.36, 99, False), (0.64, 89, False))),
)


def tile_carpet(s=1024):
    """The real carpet, 2 m across: 1 m squares, each made of the same rectangles (CARPET_SQUARE), turned a quarter
    from each square to the next, so squares side by side run opposite ways and diagonal ones the same."""
    rng = np.random.default_rng(21)
    t = s // 2
    square = np.empty((t, t))
    y = 0
    for j, (share, cells) in enumerate(CARPET_SQUARE):
        Y = t if j == len(CARPET_SQUARE) - 1 else y + round(share * t)
        x = 0
        for i, (part, grey, ribbed) in enumerate(cells):
            X = t if i == len(cells) - 1 else x + round(part * t)
            square[y:Y, x:X] = grey
            if ribbed:  # ribs about 12 mm apart, along the band
                square[y:Y, x:X] += 11 * np.sin(np.arange(Y - y) * 2 * math.pi / 6)[:, None]
            x = X
        y = Y
    grey = np.block([[square, np.rot90(square)], [np.rot90(square), square]])
    grey += _soft((s, s), (0.7, 0.7), rng) * 6 + _soft((s, s), (1.5, 1.5), rng) * 5
    return _tile(grey[..., None] * np.array((1.0, 0.985, 0.99)), "tile_carpet.png")


def tile_desk(s=1024):
    """Pale birch veneer, 1 m square, as on the real desks: nearly even, with the faintest grain along the desk."""
    rng = np.random.default_rng(5)
    grain = _soft((s, s), (1.2, 120), rng) * 0.5 + _soft((s, s), (7, 220), rng) * 0.5
    return _tile(np.array((217, 197, 161), float) + grain[..., None] * np.array((5, 5, 6), float), "tile_desk.png")


def tile_ceiling(s=768):
    """A suspended ceiling's 0.6 m tile, its grid at the edges in line with the light panels: fissured mineral
    board with a pale metal T-bar."""
    rng = np.random.default_rng(9)
    a = np.full((s, s, 3), 231.0)
    a += (_soft((s, s), (0.9, 0.9), rng) * 9 + _soft((s, s), (1.2, 7), rng) * 5)[..., None]
    bar = max(2, round(s * 0.008 / 0.6))
    for m in (a[:bar], a[-bar:], a[:, :bar], a[:, -bar:]):
        m[...] = 176
    return _tile(a, "tile_ceiling.png")


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


# The CAP panel (fire & gas / ESD) front, in metres across and down from the
# face's top-left corner. Shared with props.make_esd_panel, which raises
# the buttons and key switches out of the print at these spots.
# kind: "red" lit push button, "grey" square push button, "key" key switch,
# "lamp" white square lamp, "black"/"blue" push buttons
ESD_PARTS = (
    [(0.158, y, "red") for y in (0.563, 0.630, 0.697, 0.760)] + [(0.205, 0.760, "grey"),
    (0.167, 0.927, "key"), (0.243, 0.922, "lamp"), (0.306, 0.922, "key"), (0.373, 0.918, "lamp"),
    (0.506, 0.918, "red"), (0.626, 0.520, "red"), (1.161, 0.542, "red"), (1.197, 0.542, "red"),
    (0.999, 0.743, "red"), (1.031, 0.743, "red"), (1.161, 0.740, "red"), (1.197, 0.740, "red")] +
    [(x, y, "red") for y in (0.747, 0.810) for x in (0.801, 0.866, 0.932)] +
    [(0.180, 1.116, "grey"), (0.252, 1.116, "grey"), (0.180, 1.180, "black"),
     (0.186, 1.240, "black"), (0.252, 1.240, "blue"), (0.186, 1.302, "grey"), (0.252, 1.302, "grey"),
     (0.380, 1.116, "red"), (0.380, 1.244, "red"), (0.616, 1.300, "red")] +
    [(0.482, y, "red") for y in (1.111, 1.181, 1.244, 1.309)] +
    [(x, y, "red") for x in (0.713, 0.810, 0.907) for y in (1.102, 1.166, 1.233, 1.296)] +
    [(x, y, "grey") for x in (1.069, 1.166) for y in (1.102, 1.165, 1.233)]
)
ESD_SCREENS = [(1.118, y) for y in (1.102, 1.165, 1.233)]  # fire water pump buttons with a green display
ESD_DISPLAYS = [(1.346, 1.093), (1.346, 1.156)]           # red seven-segment flow readouts


def esd_panel(w=2048, h=2560, seed=5):
    """1.6 x 2.0 m front of a fire & gas / ESD CAP cabinet: a grey steel
    header with red label plates, then the printed panel on a grid of
    square tiles, with black section strips, a mimic of the platform's
    fire areas, little BRANN/GASS lamps and the labels under each button
    (the buttons themselves are geometry, see ESD_PARTS), and the lower
    door below. Norwegian section names as on such panels, generic
    otherwise: no brand or tag numbers."""
    rng = random.Random(seed)
    img = Image.new("RGB", (w, h), (214, 216, 214))
    d = ImageDraw.Draw(img)
    px = w / 1.6
    P = lambda x, y: (int(x * px), int(y * px))  # noqa: E731
    ink, strip, mimic = (40, 44, 48), (34, 37, 43), (138, 142, 146)
    head = _font(FONT_BOLD, int(0.020 * px))
    tiny = _font(FONT, int(0.0085 * px))
    small = _font(FONT, int(0.011 * px))

    def rect(x0, y0, x1, y1, **kw):
        d.rectangle([*P(x0, y0), *P(x1, y1)], **kw)

    # Header: an emblem plate top left and red label plates top right
    rect(0.04, 0.05, 0.19, 0.09, fill=(88, 120, 140))
    d.text(P(0.115, 0.07), "F&G / ESD", fill=(235, 238, 240), font=small, anchor="mm")
    rect(1.37, 0.03, 1.57, 0.11, fill=(200, 30, 30))
    d.text(P(1.47, 0.058), "F&G / ESD", fill=(250, 240, 240), font=small, anchor="mm")
    d.text(P(1.47, 0.085), "CAP", fill=(250, 240, 240), font=small, anchor="mm")
    rect(1.33, 0.13, 1.57, 0.21, fill=(200, 30, 30))
    for k, t in enumerate(["ISOLATE IN UPS A", "ISOLATE IN UPS B"]):
        d.text(P(1.45, 0.155 + 0.03 * k), t, fill=(250, 240, 240), font=tiny, anchor="mm")
    for y in (0.0, 0.235):  # header seams
        rect(0.0, y, 1.6, y + 0.004, fill=(170, 172, 170))

    # The printed panel, on square tiles
    X0, Y0, X1, Y1 = 0.05, 0.24, 1.52, 1.41
    rect(X0, Y0, X1, Y1, fill=(240, 240, 237))
    t = 0.036
    x = X0
    while x < X1:
        d.line([*P(x, Y0), *P(x, Y1)], fill=(218, 220, 218), width=2)
        x += t
    y = Y0
    while y < Y1:
        d.line([*P(X0, y), *P(X1, y)], fill=(218, 220, 218), width=2)
        y += t
    rect(X0, Y0, X1, Y1, outline=(190, 192, 190), width=3)

    def band(y0, y1, sections):
        rect(X0, y0, X1, y1, fill=strip)
        for x0, x1, text in sections:
            f, size = head, int(0.020 * px)
            while d.textlength(text, font=f) > (x1 - x0 - 0.012) * px:  # shrink to fit the section
                size -= 2
                f = _font(FONT_BOLD, size)
            d.text(P((x0 + x1) / 2, (y0 + y1) / 2), text, fill=(236, 236, 236), font=f, anchor="mm")
            if x0 > X0:
                d.line([*P(x0, y0), *P(x0, y1)], fill=(240, 240, 237), width=3)

    def vline(x, y0, y1, width=4):
        d.line([*P(x, y0), *P(x, y1)], fill=strip, width=width)

    band(0.24, 0.268, [(X0, 0.407, "NAS SYSTEM"), (0.407, X1, "OVERSIKT BRANNOMRÅDER")])
    vline(0.407, 0.268, 0.986)
    band(0.986, 1.012, [(X0, 0.33, "ALARMER"), (0.33, 0.43, "TENNKILDE"),
                        (0.43, 0.99, "MANUELL ELEKTRISK ISOLERING"), (0.99, X1, "BRANNVANNSPUMPER")])
    for xx in (0.33, 0.43, 0.99):
        vline(xx, 1.012, Y1)
    vline(0.567, 1.04, Y1, 2)
    rect(0.43, 1.012, 0.99, 1.04, outline=strip, width=2)
    d.text(P(0.498, 1.026), "BOLIGKVARTER", fill=ink, font=tiny, anchor="mm")
    d.text(P(0.778, 1.026), "HJELPESYSTEMER", fill=ink, font=tiny, anchor="mm")

    # Mimic of the topsides: quarters, utilities, wellbay and process area
    # in grey, a derrick and a crane boom in outline, the helideck and the
    # lifeboat station by the quarters, and a separate drill floor box
    blocks = [(0.684, 0.468, 0.783, 0.830, "BOLIGKVARTER"), (0.783, 0.536, 0.948, 0.830, "HJELPESYSTEMER"),
              (0.948, 0.594, 1.113, 0.830, "BRØNNOMRÅDE"), (1.113, 0.500, 1.242, 0.830, None),
              (0.783, 0.830, 1.242, 0.858, None)]
    for x0, y0, x1, y1, name in blocks:
        rect(x0, y0, x1, y1, fill=mimic, outline=(70, 74, 78), width=3)
    rect(1.113, 0.457, 1.212, 0.500, fill=mimic, outline=(70, 74, 78), width=3)
    for x0, y0, x1, y1, name in blocks:
        if name:
            d.text(P(x0 + 0.006, y0 - 0.010), name, fill=ink, font=tiny, anchor="lm")
    d.text(P(1.118, 0.447), "PROSESSOMRÅDE", fill=ink, font=tiny, anchor="lm")
    for x0, y0, x1 in [(0.684, 0.468, 0.783), (0.783, 0.536, 0.948), (0.948, 0.594, 1.113), (1.113, 0.520, 1.242)]:
        for k, word in enumerate(["BRANN", "GASS"]):  # fire and gas indicators per area
            cx, cy = x0 + 0.030, y0 + 0.040 + k * 0.032
            if x0 == 0.783:
                cy += 0.030
            d.ellipse([*P(cx - 0.005, cy - 0.005), *P(cx + 0.005, cy + 0.005)], fill=(210, 212, 210), outline=(80, 80, 80), width=2)
            d.text(P(cx + 0.012, cy), word, fill=(30, 32, 34), font=tiny, anchor="lm")
    rect(0.912, 0.378, 0.948, 0.594, outline=(60, 64, 68), width=3)  # derrick
    for k, word in enumerate(["BRANN", "GASS"]):
        cy = 0.445 + k * 0.032
        d.ellipse([*P(0.925, cy - 0.005), *P(0.935, cy + 0.005)], fill=(210, 212, 210), outline=(80, 80, 80), width=2)
        d.text(P(0.952, cy), word, fill=ink, font=tiny, anchor="lm")
    bx0, bx1, by0, by1 = 0.948, 1.32, 0.382, 0.402  # crane boom, a lattice
    rect(bx0, by0, bx1, by1, outline=(70, 74, 78), width=2)
    xx = bx0
    while xx < bx1 - 0.01:
        d.line([*P(xx, by1), *P(xx + 0.01, by0), *P(xx + 0.02, by1)], fill=(70, 74, 78), width=2)
        xx += 0.02
    d.line([*P(1.32, 0.392), *P(1.33, 0.415)], fill=(70, 74, 78), width=3)
    d.line([*P(1.242, 0.560), *P(1.33, 0.470)], fill=(60, 64, 68), width=3)  # flare boom
    d.line([*P(1.242, 0.660), *P(1.33, 0.585)], fill=(60, 64, 68), width=3)
    rect(1.346, 0.586, 1.444, 0.682, outline=(60, 64, 68), width=3)
    d.text(P(1.395, 0.600), "BOREDEKK", fill=ink, font=tiny, anchor="mm")
    for k, word in enumerate(["BRANN", "GASS"]):
        cy = 0.630 + k * 0.030
        d.ellipse([*P(1.365, cy - 0.005), *P(1.375, cy + 0.005)], fill=(210, 212, 210), outline=(80, 80, 80), width=2)
        d.text(P(1.383, cy), word, fill=ink, font=tiny, anchor="lm")
    rect(0.604, 0.498, 0.684, 0.514, outline=(60, 64, 68), width=3)  # helideck
    d.line([*P(0.660, 0.514), *P(0.684, 0.540)], fill=(60, 64, 68), width=3)
    d.text(P(0.606, 0.488), "HELIDEKK", fill=ink, font=tiny, anchor="lm")
    d.text(P(0.660, 0.488), "BRANN", fill=ink, font=tiny, anchor="lm")
    for k in range(4):  # lifeboat station: boats on a ramp
        x0 = 0.592 + k * 0.018
        d.polygon([P(x0, 0.800), P(x0 + 0.03, 0.770), P(x0 + 0.036, 0.776), P(x0 + 0.006, 0.806)], outline=(60, 64, 68))
    d.line([*P(0.590, 0.808), *P(0.684, 0.744)], fill=(60, 64, 68), width=3)
    d.text(P(0.580, 0.750), "LIVBÅT", fill=ink, font=tiny, anchor="lm")
    d.text(P(0.580, 0.764), "STASJON", fill=ink, font=tiny, anchor="lm")

    # NAS column labels
    d.text(P(0.240, 0.760), "TRYKKAVLASTING\nPÅGÅR", fill=ink, font=tiny, anchor="lm")
    d.text(P(0.120, 0.880), "BEGRENSET BLOKKERING", fill=ink, font=tiny, anchor="lm")
    d.text(P(0.290, 0.880), "AKTIVER ONSHORE KAP", fill=ink, font=tiny, anchor="lm")
    d.text(P(0.506, 0.890), "SENTRAL NØDSTOPP", fill=ink, font=tiny, anchor="mm")

    # Bezels and labels for the parts
    for x, y, kind in ESD_PARTS:
        s = 0.020 if kind != "key" else 0.022
        if kind == "key":
            d.ellipse([*P(x - s, y - s), *P(x + s, y + s)], fill=(200, 202, 200), outline=(110, 112, 110), width=2)
        else:
            rect(x - s, y - s, x + s, y + s, fill=(250, 250, 248), outline=(150, 152, 150), width=2)
        if y > 1.0 or kind == "red" and x > 0.6:
            for k in range(2):
                ww = rng.uniform(0.02, 0.035)
                d.line([*P(x - ww, y - s - 0.016 + k * 0.007), *P(x + ww, y - s - 0.016 + k * 0.007)], fill=(120, 124, 128), width=3)
    # The buzzer grille in the alarm section
    for k in range(9):
        cx, cy = 0.252 + 0.007 * (k % 3 - 1), 1.180 + 0.007 * (k // 3 - 1)
        d.ellipse([*P(cx - 0.002, cy - 0.002), *P(cx + 0.002, cy + 0.002)], fill=(60, 60, 60))
    # Fire water pumps: buttons with a green display, flow readouts
    for x, y in ESD_SCREENS:
        rect(x - 0.034, y - 0.022, x + 0.034, y + 0.022, fill=(20, 22, 24))
        rect(x - 0.026, y - 0.015, x + 0.026, y + 0.015, fill=(40, 120, 90))
        d.text(P(x, y), "START PUMPE", fill=(200, 240, 220), font=tiny, anchor="mm")
        d.text(P(x + 0.07, y - 0.012), "STOPP", fill=ink, font=tiny, anchor="lm")
    d.text(P(1.346, 1.060), "TRYKK BRANNVANNSRINGLEDNING", fill=ink, font=tiny, anchor="mm")
    seg = _font(FONT_BOLD, int(0.026 * px))
    for x, y in ESD_DISPLAYS:
        rect(x - 0.065, y - 0.018, x + 0.065, y + 0.018, fill=(16, 8, 8))
        d.text(P(x, y), "12.84", fill=(255, 40, 40), font=seg, anchor="mm")
        d.text(P(x + 0.075, y + 0.010), "bar", fill=ink, font=tiny, anchor="lm")

    # The lower door, with a seam, a drawer front and its lock
    rect(0.0, 1.44, 1.6, 1.446, fill=(170, 172, 170))
    rect(0.03, 1.49, 1.57, 1.99, outline=(170, 172, 170), width=4)
    for x, y in ((0.13, 1.60), (1.42, 1.60)):
        d.ellipse([*P(x - 0.012, y - 0.012), *P(x + 0.012, y + 0.012)], fill=(150, 152, 154), outline=(90, 90, 90), width=2)
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
    img = Image.new("RGB", (W, H), (96, 98, 102))  # the bake darkens it a lot: any darker and the gaps go pure black
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


# ------------------------------------------------------------ photo frame

# The pictures the frame can hold: a source (an image file in assets/, or a
# function drawing the picture at a size) and the point (fractions of the
# image) a crop is centred on. The public pictures are drawn here; the private
# build's portraits live outside the repo (PRIVATE_PICTURES, a folder of
# <key>.jpg, e.g. /mnt/project-files/control-room-game/private-assets/pictures)
# and join this list when that folder is there.
PORTRAITS = {
    "coast": ("coast", (0.5, 0.5)),       # a lighthouse on a rocky point, a grey print
    "boat": ("boat", (0.5, 0.5)),         # a small sailing boat off the same coast
}
PRIVATE_PICTURES = os.environ.get("PRIVATE_PICTURES", "/mnt/project-files/control-room-game/private-assets/pictures")
if os.path.isdir(PRIVATE_PICTURES):
    for f in sorted(os.listdir(PRIVATE_PICTURES)):
        if f.endswith(".jpg"):
            PORTRAITS.setdefault(f[:-4], (os.path.join(PRIVATE_PICTURES, f), (0.5, 0.42)))
HEART_RED, HEART_PINK = (200, 30, 55), (232, 96, 150)


def heart(n=48):
    """Unit heart outline, x across and y up, about 1 wide and 0.9 tall,
    centred on the middle of its bounding box (shared with props.py)."""
    pts = [(16 * math.sin(t) ** 3, 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
           for t in (2 * math.pi * i / n for i in range(n))]
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    return [(x / 32, (y - (y0 + y1) / 2) / 32) for x, y in pts]


def _heart_doodle(d, rng, x, y, s, color, filled):
    """A marker heart of width s at (x, y), a little wobbly and turned."""
    a = rng.uniform(-0.45, 0.45)
    pts = []
    for hx, hy in heart(36):
        hx, hy = hx * s * rng.uniform(0.97, 1.03), -hy * s * rng.uniform(0.97, 1.03)
        pts.append((x + hx * math.cos(a) - hy * math.sin(a), y + hx * math.sin(a) + hy * math.cos(a)))
    if filled:
        d.polygon(pts, fill=color)
    d.line(pts + pts[:2], fill=color, width=max(3, int(s * 0.09)), joint="curve")


def _drawn(kind, W=800, H=1000, seed=3):
    """A made-up grey print for the public frames: sky, sea and a rocky point,
    with a lighthouse ("coast") or a sailing boat ("boat")."""
    rng = random.Random(seed)
    im = Image.new("L", (W, H))
    d = ImageDraw.Draw(im)
    hz = int(H * 0.55)
    for y in range(hz):                      # sky, lighter towards the horizon
        d.line([(0, y), (W, y)], fill=int(150 + 70 * y / hz))
    sx, sy = (W * 0.7, H * 0.3) if kind == "coast" else (W * 0.3, H * 0.33)
    for r in range(160, 0, -4):              # the sun's glow
        d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=min(255, int(222 + 30 * (1 - r / 160))))
    for y in range(hz, H):                   # sea, darker towards the viewer, with glints
        v = int(130 - 70 * (y - hz) / (H - hz))
        d.line([(0, y), (W, y)], fill=v)
    for _ in range(420):
        y = rng.uniform(hz + 4, H)
        x, L = rng.uniform(0, W), rng.uniform(8, 40) * (1 + (y - hz) / (H - hz))
        d.line([(x, y), (x + L, y)], fill=int(170 - 60 * (y - hz) / (H - hz)), width=2)
    flip = (lambda x: W - x) if kind == "boat" else (lambda x: x)
    rock = [(0, hz - 60), (W * 0.12, hz - 110), (W * 0.22, hz - 95), (W * 0.34, hz - 30), (W * 0.42, hz + 40),
            (W * 0.30, H * 0.78), (0, H * 0.86)]
    d.polygon([(flip(x), y) for x, y in rock], fill=48)
    if kind == "coast":                      # a white tower with a dark lantern
        x0 = W * 0.13
        d.polygon([(x0 - 26, hz - 104), (x0 + 26, hz - 104), (x0 + 16, hz - 330), (x0 - 16, hz - 330)], fill=232)
        for k in (0, 1):
            y = hz - 160 - k * 90
            d.polygon([(x0 - 24 + 2 * k, y), (x0 + 24 - 2 * k, y), (x0 + 22 - 2 * k, y - 26), (x0 - 22 + 2 * k, y - 26)], fill=70)
        d.rectangle([x0 - 20, hz - 372, x0 + 20, hz - 330], fill=60)
        d.polygon([(x0 - 24, hz - 372), (x0 + 24, hz - 372), (x0, hz - 400)], fill=40)
    else:                                    # a small boat out on the water
        bx, by = W * 0.42, hz + 70
        d.polygon([(bx - 70, by), (bx + 80, by), (bx + 60, by + 24), (bx - 55, by + 24)], fill=40)
        d.polygon([(bx, by - 4), (bx, by - 190), (bx + 75, by - 8)], fill=238)
        d.polygon([(bx - 6, by - 6), (bx - 6, by - 150), (bx - 60, by - 8)], fill=205)
    return im


DRAWN = ("coast", "boat")


def _portrait(w, h, picture="coast", centre=None):
    """A picture from PORTRAITS cropped to w:h around `centre` (fractions of
    the image), printed: a touch warm, the paper a little lighter."""
    path, default = PORTRAITS[picture]
    centre = centre or default
    im = _drawn(path) if path in DRAWN else Image.open(os.path.join(HERE, "assets", path)).convert("L")
    iw, ih = im.size
    cw, ch = (iw, iw * h / w) if iw / ih < w / h else (ih * w / h, ih)
    cx, cy = centre[0] * iw, centre[1] * ih
    x0, y0 = min(max(cx - cw / 2, 0), iw - cw), min(max(cy - ch / 2, 0), ih - ch)
    im = im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch))).resize((w, h), Image.LANCZOS)
    im = im.point(lambda v: min(255, int(v * 1.08 + 6)))
    return Image.merge("RGB", [im.point(lambda v, k=k: int(v * k)) for k in (1.0, 0.97, 0.91)])


def photo_print(style="stickers", size=(0.105, 0.132), picture="coast", ppm=5000, seed=14):
    """The print behind the glass, size (w, h) in metres. "doodle": on a
    cream card mount with red and pink marker hearts all round it; "heart":
    cropped tighter on the face, for a heart-shaped window; otherwise the
    plain portrait with a thin white print border. `picture` is a key
    of PORTRAITS."""
    W, H = round(size[0] * ppm), round(size[1] * ppm)
    rng = random.Random(seed)
    if style == "doodle":
        img = Image.new("RGB", (W, H), (240, 234, 222))
        m = round(0.016 * ppm)
        img.paste(_portrait(W - 2 * m, H - 2 * m, picture), (m, m))
        d = ImageDraw.Draw(img)
        spots = [(0.07, 0.06, 1.0), (0.93, 0.07, 0.8), (0.06, 0.94, 0.8), (0.92, 0.93, 1.1), (0.50, 0.04, 0.6),
                 (0.05, 0.50, 0.6), (0.95, 0.42, 0.7), (0.30, 0.96, 0.6), (0.70, 0.965, 0.55), (0.96, 0.68, 0.5),
                 (0.04, 0.26, 0.5), (0.04, 0.73, 0.55), (0.27, 0.035, 0.5), (0.73, 0.035, 0.55),
                 (0.86, 0.80, 0.9), (0.15, 0.17, 0.7)]  # the last two stray onto the drawing's corners
        for i, (x, y, s) in enumerate(spots):
            _heart_doodle(d, rng, x * W, y * H, s * m * 1.15, HEART_RED if i % 3 else HEART_PINK, i % 4 == 0)
        return _save(img, f"photo_doodle_{picture}.png")
    if style == "heart":
        x, y = PORTRAITS[picture][1]
        return _save(_portrait(W, H, picture, (x + 0.02, y - 0.08)), f"photo_heart_{picture}.png")
    img = Image.new("RGB", (W, H), (246, 245, 240))
    m = round(0.004 * ppm)
    img.paste(_portrait(W - 2 * m, H - 2 * m, picture), (m, m))
    return _save(img, f"photo_{style}_{picture}.png")


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
