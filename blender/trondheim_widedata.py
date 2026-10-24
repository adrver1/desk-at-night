"""Map data for the horizon round Trondheim's Midtbyen, beyond the 1 km core that
trondheim_mapdata.py packs: building outlines from Overture Maps within a few km, and
open terrain tiles over ~28 km, so the hills and the fjord shore are the real ones.

    .venv/bin/python blender/trondheim_widedata.py [--radius 4000] [--terrain 14000]

Downloads from Overture's public S3 bucket (pyarrow) and the Terrain Tiles on AWS
(terrarium PNGs), writes blender/data/trondheim_wide.json.gz. Same frame as the core:
metres from the Olav Tryggvason column, x east, y true north; heights above sea level
(the builder subtracts the ground height at the column). Licences: blender/data/README.md.
"""
import argparse
import gzip
import io
import json
import math
import os
import struct
import time
import urllib.request

LAT0, LON0 = 63.430500, 10.395058     # the column (Adriaen's GPS point)
MY = 111132.0                          # metres per degree of latitude here
MX = MY * math.cos(math.radians(LAT0))
RELEASE = "release/2026-10-21.0"
HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(HERE, "data", "trondheim_midtbyen.json.gz")
OUT = os.path.join(HERE, "data", "trondheim_wide.json.gz")
STEP = 75.0                            # terrain grid spacing, metres

# Heights by building class where Overture has neither height nor floors
CLASS_H = {"garage": 3.0, "garages": 3.0, "shed": 2.6, "carport": 2.6, "house": 6.5, "detached": 6.5,
           "semidetached_house": 6.5, "terrace": 7.5, "cabin": 4.5, "farm_auxiliary": 6.0, "barn": 7.0,
           "apartments": 12.0, "residential": 9.0, "commercial": 12.0, "retail": 8.0, "industrial": 9.0,
           "warehouse": 9.0, "office": 14.0, "school": 10.0, "university": 14.0, "hospital": 18.0,
           "church": 14.0, "cathedral": 25.0}
GABLE = {"house", "detached", "semidetached_house", "terrace", "cabin", "farm_auxiliary", "barn"}


def wkb_rings(g):
    """Outer rings of a WKB Polygon or MultiPolygon, as lists of (lon, lat)."""
    def poly(o, end):
        n = struct.unpack_from(end + "I", g, o)[0]
        o += 4
        rings = []
        for _ in range(n):
            m = struct.unpack_from(end + "I", g, o)[0]
            o += 4
            rings.append(list(struct.iter_unpack(end + "dd", g[o:o + 16 * m])))
            o += 16 * m
        return rings[:1], o
    end = "<" if g[0] == 1 else ">"
    kind = struct.unpack_from(end + "I", g, 1)[0]
    if kind == 3:
        return poly(5, end)[0]
    out, o = [], 9
    for _ in range(struct.unpack_from(end + "I", g, 5)[0]):
        e2 = "<" if g[o] == 1 else ">"
        r, o = poly(o + 5, e2)
        out += r
    return out


def simplify(pts, tol=0.6):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    L = math.hypot(x1 - x0, y1 - y0) or 1e-9
    i, dmax = 0, -1.0
    for k in range(1, len(pts) - 1):
        d = abs((x1 - x0) * (y0 - pts[k][1]) - (x0 - pts[k][0]) * (y1 - y0)) / L
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)


def area(r):
    return 0.5 * sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r)))


def core_box():
    with gzip.open(CORE, "rt") as f:
        v = json.load(f)["terrain"]["v"]
    xs, ys = v[0::3], v[1::3]
    return min(xs), max(xs), min(ys), max(ys)


def buildings(radius, box):
    import pyarrow.dataset as ds
    import pyarrow.fs as pfs
    from urllib.parse import urlparse
    proxy = {}
    if os.environ.get("HTTPS_PROXY"):
        p = urlparse(os.environ["HTTPS_PROXY"])
        proxy = {"proxy_options": {"scheme": p.scheme, "host": p.hostname, "port": p.port}}
    fs = pfs.S3FileSystem(anonymous=True, region="us-west-2", **proxy)
    d = ds.dataset(f"overturemaps-us-west-2/{RELEASE}/theme=buildings/type=building/", filesystem=fs, format="parquet")
    dlat, dlon = radius / MY, radius / MX
    f = ((ds.field("bbox", "xmin") > LON0 - dlon) & (ds.field("bbox", "xmax") < LON0 + dlon)
         & (ds.field("bbox", "ymin") > LAT0 - dlat) & (ds.field("bbox", "ymax") < LAT0 + dlat))
    t = d.to_table(columns=["geometry", "height", "num_floors", "roof_shape", "class"], filter=f).to_pydict()
    out = []
    x0, x1, y0, y1 = box
    for g, h, fl, roof, cls in zip(t["geometry"], t["height"], t["num_floors"], t["roof_shape"], t["class"]):
        for ring in wkb_rings(g):
            r = [((lon - LON0) * MX, (lat - LAT0) * MY) for lon, lat in ring]
            cx, cy = sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)
            if x0 < cx < x1 and y0 < cy < y1:
                continue   # the core has it, with roofs
            k = max(range(len(r)), key=lambda i: math.dist(r[0], r[i]))   # split the closed ring there
            r = simplify(r[:k + 1])[:-1] + simplify(r[k:])[:-1]
            a = area(r)
            if len(r) < 3 or abs(a) < 20:
                continue
            if a < 0:
                r.reverse()
            if h is None:
                h = fl * 3.2 + 1.0 if fl else CLASS_H.get(cls, 7.0 if abs(a) < 300 else 10.0)
            gable = roof in ("gabled", "hipped", "half_hipped") or (roof is None and (cls in GABLE or (cls is None and abs(a) < 200)))
            out.append([round(h, 1), int(gable)] + [round(c * 10) for p in r for c in p])
    return out


def terrain(radius):
    """Heights above sea on a STEP grid from the terrarium tiles at zoom 12."""
    from PIL import Image
    Z, tiles = 12, {}

    def px(lat, lon):
        n = 2 ** Z * 256
        return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n

    def tile(tx, ty):
        if (tx, ty) not in tiles:
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"
            for k in range(5):
                try:
                    tiles[tx, ty] = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=30).read())).convert("RGB")
                    break
                except OSError:
                    time.sleep(2 ** k)
            else:
                raise RuntimeError("could not fetch " + url)
        return tiles[tx, ty]

    def h(u, v):
        r, g, b = tile(int(u // 256), int(v // 256)).getpixel((int(u % 256), int(v % 256)))
        return r * 256 + g + b / 256 - 32768

    n = int(radius // STEP)
    grid = []
    for j in range(-n, n + 1):
        for i in range(-n, n + 1):
            u, v = px(LAT0 + j * STEP / MY, LON0 + i * STEP / MX)
            fu, fv = u - math.floor(u), v - math.floor(v)
            u0, v0 = math.floor(u), math.floor(v)
            z = (h(u0, v0) * (1 - fu) * (1 - fv) + h(u0 + 1, v0) * fu * (1 - fv)
                 + h(u0, v0 + 1) * (1 - fu) * fv + h(u0 + 1, v0 + 1) * fu * fv)
            grid.append(round(max(z, -5.0) * 10))
    return {"n": 2 * n + 1, "step": STEP, "dm": grid}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--radius", type=float, default=4000.0, help="buildings out to this many metres")
    ap.add_argument("--terrain", type=float, default=14000.0, help="terrain out to this many metres")
    a = ap.parse_args()
    box = core_box()
    data = {"about": "Round Trondheim's Midtbyen, outside the core map. Metres from the Olav Tryggvason "
                     "column, x east, y true north; buildings [height, gabled, x,y,... in decimetres], "
                     "terrain heights above sea in decimetres on a square grid, row by row from the south-west. "
                     "Overture Maps (ODbL), Terrain Tiles on AWS.",
            "core": box, "terrain": terrain(a.terrain), "buildings": buildings(a.radius, box)}
    with gzip.open(OUT, "wt") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{len(data['buildings'])} buildings, terrain {data['terrain']['n']}² -> {OUT} "
          f"({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
