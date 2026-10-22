"""
Tileable textures for the platform, drawn with PIL, so its walls look as busy
as the photos without extra triangles:

    busy()        the inside of an open-framed module: pipe runs, vessels,
                  skids, grating walkways with handrails and deck lamps
    clad_busy()   clad grey module walls with what hangs on them outside:
                  walkways and handrails every storey, stair flights, doors,
                  louvres, cable trays and junction boxes
    quarters()    the quarters' light cladding with walkway bands, doors and
                  small kit; the cabin windows stay geometry

Each tile covers TILE metres square and is mapped by box projection in world
space (offshore_platform.py), so the storeys line up across modules.
Seeded, so every build draws the same images. Each returns the path of a PNG
in blender/build/platform_tex/.
"""
import os
import random

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build", "platform_tex")
TILE = 8.0   # metres per tile
N = 512      # pixels per tile
PX = N / TILE


def _rect(d, x0, y0, x1, y1, fill):
    """Rectangle drawn on all wrapped copies, so the tile repeats seamlessly."""
    for dx in (-N, 0, N):
        for dy in (-N, 0, N):
            d.rectangle((x0 + dx, y0 + dy, x1 + dx, y1 + dy), fill=fill)


def _lighter(c, k):
    return tuple(min(255, v + k) for v in c)


def _walkway(d, y, rail=(236, 236, 230), deck=(128, 132, 134), lamps=True, gaps=()):
    """Grating walkway at pixel row y (its top), handrail above, lamps under."""
    _rect(d, 0, y, N, y + 12, deck)
    _rect(d, 0, y, N, y + 3, (225, 225, 220))  # toe board
    for x in range(0, N, 4):
        d.line((x, y + 4, x, y + 12), fill=_lighter(deck, -30))
    hy, my = y - int(PX * 1.1), y - int(PX * 0.55)
    for x0, x1 in _spans(gaps):
        d.line((x0, hy, x1, hy), fill=rail, width=4)
        d.line((x0, my, x1, my), fill=_lighter(rail, -20), width=3)
        for x in range(int(x0), int(x1), int(PX * 1.5)):
            d.line((x, hy, x, y), fill=rail, width=3)
    if lamps:
        for x in range(int(PX * 2), N, int(PX * 4)):
            d.rectangle((x, y + 13, x + 6, y + 17), fill=(255, 236, 196))


def _spans(gaps):
    """Pieces of [0, N] left between the (x0, x1) gaps."""
    out, x = [], 0
    for g0, g1 in sorted(gaps):
        out.append((x, g0))
        x = g1
    out.append((x, N))
    return [(a, b) for a, b in out if b > a]


def _stair(d, x, y_top, y_bot, w, rail=(236, 236, 230)):
    """A stair flight from (x, y_bot) up to (x + w, y_top), with its rail."""
    n = 10
    for i in range(n):
        t = i / n
        sx, sy = x + w * t, y_bot + (y_top - y_bot) * t
        d.line((sx, sy, sx + w / n, sy), fill=(120, 124, 126), width=3)
    d.line((x, y_bot, x + w, y_top), fill=(120, 124, 126), width=5)
    d.line((x, y_bot - PX * 1.0, x + w, y_top - PX * 1.0), fill=rail, width=4)
    for i in range(0, n + 1, 3):
        t = i / n
        d.line((x + w * t, y_bot + (y_top - y_bot) * t, x + w * t, y_bot + (y_top - y_bot) * t - PX), fill=rail, width=3)


def busy(seed=3):
    rng = random.Random(seed)
    im = Image.new("RGB", (N, N), (58, 63, 68))
    d = ImageDraw.Draw(im)
    for x in range(0, N, int(PX * 2)):  # the back wall's panels
        d.line((x, 0, x, N), fill=(70, 75, 80), width=1)
    greys = [(120, 126, 130), (140, 146, 150), (96, 104, 112), (150, 155, 158), (110, 118, 124)]
    for _ in range(14):  # vessels, skids and cabinets
        w, h = rng.uniform(0.5, 1.6) * PX, rng.uniform(0.6, 1.8) * PX
        x, y = rng.uniform(0, N), rng.uniform(0, N)
        c = rng.choice(greys * 3 + [(160, 70, 60), (70, 95, 120), (190, 160, 60)])
        _rect(d, x, y, x + w, y + h, c)
        _rect(d, x, y, x + w, y + 2, _lighter(c, 40))
    pipes = [(175, 180, 184), (195, 198, 200), (150, 156, 160)]
    for _ in range(40):  # vertical pipes, a highlight down one side
        x, w = rng.uniform(0, N), rng.choice([2, 3, 4, 5, 6, 8])
        y0, ln = rng.uniform(0, N), rng.uniform(0.3, 1.0) * N
        c = rng.choice(pipes)
        _rect(d, x, y0, x + w, y0 + ln, c)
        _rect(d, x, y0, x + max(1, w // 3), y0 + ln, _lighter(c, 35))
    for _ in range(24):  # horizontal pipe runs
        y, w = rng.uniform(0, N), rng.choice([2, 3, 4, 5])
        x0, ln = rng.uniform(0, N), rng.uniform(0.3, 1.0) * N
        _rect(d, x0, y, x0 + ln, y + w, rng.choice(pipes + [(205, 205, 200)]))
    for k in range(2):  # a walkway every 4 m
        for dy in (0, N):
            _walkway(d, int(k * N / 2 + PX * 0.2) + dy)
    return _save(im, "busy")


def clad_busy(seed=5, base=(196, 200, 203), name="clad_busy", stairs=True):
    rng = random.Random(seed)
    im = Image.new("RGB", (N, N), base)
    d = ImageDraw.Draw(im)
    seam = _lighter(base, -46)
    for x in range(0, N, 6):  # corrugation
        d.line((x, 0, x, N), fill=_lighter(base, -16), width=1)
    for x in range(0, N, int(PX * 2)):  # panel seams
        d.line((x, 0, x, N), fill=seam, width=2)
    for y in range(0, N, int(PX * 2)):
        d.line((0, y, N, y), fill=_lighter(base, -30), width=1)
    for _ in range(50):  # rain streaks
        x, y = rng.uniform(0, N), rng.uniform(0, N)
        d.line((x, y, x, y + rng.uniform(10, 60)), fill=_lighter(base, -22), width=1)
    for k in range(2):  # a storey every 4 m: doors, louvres, boxes on the wall, then the walkway
        floor = int(k * N / 2 + PX * 0.2)        # walkway top, pixel row
        top = floor - int(PX * 4) + 6            # the storey above's walkway
        for _ in range(2):
            x = rng.uniform(0, N - PX * 1.2)
            _rect(d, x, floor - PX * 2.2, x + PX * 1.0, floor - 1, _lighter(base, -40))  # door
            _rect(d, x + PX * 0.75, floor - PX * 1.2, x + PX * 0.85, floor - PX * 1.1, (40, 40, 40))
        x = rng.uniform(0, N - PX * 2.5)
        for j in range(8):  # louvre
            y = floor - PX * 3.4 + j * 5
            _rect(d, x, y, x + PX * 2.2, y + 2, _lighter(base, -60))
        for _ in range(5):  # junction boxes, signs, extinguisher cabinets
            x, w = rng.uniform(0, N), rng.uniform(0.2, 0.5) * PX
            c = rng.choice([_lighter(base, -50)] * 4 + [(170, 50, 40), (60, 120, 70)])
            _rect(d, x, floor - PX * 1.8, x + w, floor - PX * 1.8 + w, c)
        y = floor - PX * 3.0  # cable tray along the storey
        _rect(d, 0, y, N, y + 3, _lighter(base, -55))
        gap = ()
        if stairs:  # one stair flight per storey, up to the walkway above
            x = rng.uniform(PX, N - PX * 4)
            gap = ((x - 2, x + PX * 3.0 + 2),)
        for dy in (0, N):  # again a tile lower, so what crosses the top edge wraps
            if stairs:
                _stair(d, x, top + dy, floor + dy, PX * 3.0)
            _walkway(d, floor + dy, gaps=gap)
    for _ in range(6):  # vertical pipes down the wall
        x = rng.uniform(0, N)
        _rect(d, x, 0, x + 3, N, (170, 174, 178))
    return _save(im, name)


def quarters(seed=9):
    return clad_busy(seed, base=(214, 217, 219), name="quarters", stairs=False)


def _save(im, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".png")
    im.save(path)
    return path


if __name__ == "__main__":
    for f in (busy, clad_busy, quarters):
        print(f())
