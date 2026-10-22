"""
bearded_operator: a control room operator with a full ginger spade beard,
short hair swept up on top, a white shirt with an open collar, navy
trousers and brown shoes. An original character, not a likeness.

    python characters/bearded_operator/build_bearded_operator.py
    python characters/bearded_operator/build_bearded_operator.py --reference ref.png --private DIR

Writes bearded_operator.blend, .glb, turnaround.png, pose_check.png and
contact_sheet.png next to this script. With --reference, a second contact
sheet next to the reference goes to --private (never into this repo).
"""
import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import base_body as base  # noqa: E402  (imports bpy)
import outfits  # noqa: E402

Vector = base.Vector
NAME = "bearded_operator"
SKIN, HAIR, BEARD = "skin_2", "hair_strawberry", "hair_ginger"
SHIRT, EDGE, TROUSERS, SHOES, BELT = "white", "light_grey", "navy", "leather_brown", "charcoal"


def head_ring(i, offset=0.0, z=None):
    """Points of head ring i pushed out by offset, optionally moved to z."""
    rz, ru, rv, dv, _ = base.HEAD[i]
    pts = []
    for a in base.BOXY8:
        a = math.radians(a)
        pts.append(Vector(((ru + offset) * math.cos(a), dv + (rv + offset) * math.sin(a), z or rz)))
    return pts


# Hairline height (z) at each head ring angle: high on the forehead, above
# the ears at the sides (the beard takes over below), low at the nape.
HAIRLINE = {20: 1.655, 55: 1.708, 125: 1.708, 160: 1.655,
            200: 1.600, 235: 1.578, 305: 1.578, 340: 1.600}


def cap(offsets=(0.008, 0.012, 0.016), lifts=(0.0, 0.008, 0.02), hairline=HAIRLINE):
    """Close-cropped shell that hugs the skull from the hairline to the
    crown: three rows of the head's eight facets plus a flat crown."""
    m = base.Mesh()
    rows = []
    for k, f in enumerate((0.0, 0.55, 1.0)):
        rows.append([base.head_point(a, z + (1.75 - z) * f, offsets[k]) + Vector((0, 0, lifts[k]))
                     for a, z in ((a, hairline[a]) for a in base.BOXY8)])
    n = len(base.BOXY8)
    for k in range(len(rows) - 1):
        for i in range(n):
            j = (i + 1) % n
            m.face([rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]], HAIR, "hair")
    m.face(rows[-1], HAIR, "hair")
    return m


def hairline(angle):
    """Hairline height at any angle, between the HAIRLINE corners."""
    keys = sorted(HAIRLINE)
    a = angle % 360
    for k0, k1 in zip(keys[-1:] + keys, keys + keys[:1]):
        span = (k1 - k0) % 360
        if (a - k0) % 360 <= span:
            t = ((a - k0) % 360) / span
            return HAIRLINE[k0] + (HAIRLINE[k1] - HAIRLINE[k0]) * t
    return HAIRLINE[keys[0]]


def on_cap(angle, f, offset=0.011, lift=0.008):
    z = hairline(angle)
    return base.head_point(angle, z + (1.75 - z) * f, offset) + Vector((0, 0, lift))


def hair_quiff():
    """Short sides, a tapered quiff swept up and back from the forehead."""
    m = cap()
    pts = [on_cap(a, 0.15, 0.010) for a in (55, 125)] + [on_cap(a, 0.6) for a in (20, 55, 125, 160)]
    pts += [Vector((0.05, 0.112, 1.765)), Vector((-0.045, 0.108, 1.775)),   # front edge, a little uneven
            Vector((0.035, 0.085, 1.80)), Vector((-0.03, 0.08, 1.806)),    # top, narrower than the base
            Vector((0.04, -0.01, 1.795)), Vector((-0.04, -0.015, 1.798)),  # sweeping back
            Vector((0.0, -0.075, 1.772))]
    return m.hull(pts, HAIR, "hair")


def hair_crop():
    """Textured crop: the cropped cap with a few low angular tufts on the
    front half of the top, all leaning back."""
    m = cap()
    # Low angular tufts sitting on the cap, each leaning back and up
    for a, f in ((60, 0.5), (90, 0.55), (120, 0.5), (75, 0.95), (105, 0.95),
                 (30, 0.6), (150, 0.6)):
        c = on_cap(a, f + 0.12, 0.02, 0.02)
        m.hull([on_cap(a - 17, f, 0.006, 0.004), on_cap(a + 17, f, 0.006, 0.004),
                on_cap(a, min(f + 0.3, 1.0), 0.006, 0.004), c + Vector((0, -0.012, 0.012))], HAIR, "hair")
    return m


def hair_side_part():
    """Side part: a cropped cap and one fringe block swept from a parting on
    his left across the top to the right temple."""
    m = cap()
    pts = [on_cap(a, f) for a, f in ((20, 0.2), (55, 0.1), (125, 0.35), (20, 0.75), (55, 0.7), (340, 0.6))]
    pts += [Vector((-0.045, 0.10, 1.765)), Vector((-0.04, 0.02, 1.79)), Vector((-0.04, -0.05, 1.775)),  # parting
            Vector((0.02, 0.112, 1.765)), Vector((0.07, 0.10, 1.738)), Vector((0.112, 0.06, 1.70)),   # fringe edge
            Vector((0.03, 0.03, 1.80)), Vector((0.085, 0.0, 1.765))]
    return m.hull(pts, HAIR, "hair")


# Every hair variant stays in the library; HAIR_STYLE picks the live one.
HAIR_STYLES = {"quiff": hair_quiff, "crop": hair_crop, "side_part": hair_side_part}
HAIR_STYLE = "side_part"


def beard():
    """Full spade beard from the sideburns down to the collarbone."""
    pts = []
    for s in (1, -1):
        pts += [Vector((s * 0.124, 0.012, 1.63)), Vector((s * 0.126, 0.03, 1.585)),
                Vector((s * 0.122, 0.015, 1.56)), Vector((s * 0.12, 0.0, 1.51)),
                Vector((s * 0.045, 0.112, 1.482)), Vector((s * 0.10, 0.075, 1.45)),
                Vector((s * 0.07, 0.118, 1.41)), Vector((s * 0.028, 0.112, 1.36)),
                Vector((s * 0.08, -0.02, 1.50)), Vector((s * 0.05, 0.02, 1.43)),
                Vector((s * 0.035, 0.05, 1.385))]
    pts += [Vector((0, 0.117, 1.479)), Vector((0, 0.10, 1.35))]
    return base.Mesh().hull(pts, BEARD, "beard")


def moustache():
    """Two halves, so the mouth shows between them and the beard."""
    m = base.Mesh()
    for s in (1, -1):
        m.hull([Vector((s * 0.004, 0.108, 1.558)), Vector((s * 0.045, 0.104, 1.552)),
                Vector((s * 0.062, 0.096, 1.515)), Vector((s * 0.03, 0.112, 1.54)),
                Vector((s * 0.004, 0.112, 1.542)), Vector((s * 0.004, 0.098, 1.56)),
                Vector((s * 0.05, 0.092, 1.552))], BEARD, "moustache")
    return m


def collar():
    """Open spread collar: a band round the back of the neck and two points."""
    m = base.Mesh()
    band = []
    for a in range(200, 341, 35):
        a = math.radians(a)
        for r, z in ((0.068, 1.395), (0.072, 1.465), (0.078, 1.40)):
            band.append(Vector((r * math.cos(a), -0.008 + r * math.sin(a), z)))
    m.hull(band, SHIRT, "collar")
    for s in (1, -1):
        flap = [Vector((s * 0.07, -0.02, 1.46)), Vector((s * 0.075, 0.01, 1.455)),
                Vector((s * 0.06, 0.06, 1.42)), Vector((s * 0.035, 0.105, 1.355)),
                Vector((s * 0.105, 0.07, 1.375)), Vector((s * 0.09, -0.02, 1.40)),
                Vector((s * 0.06, 0.075, 1.40))]
        m.hull(flap, SHIRT, "collar")
    return m


def shirt_details(body):
    """Placket cut down the front, a chest pocket, cuffs and the belt."""
    m = base.Mesh()
    bvh = body.bvh()
    for z0, z1 in ((1.02, 1.17), (1.19, 1.34)):
        m.decal(bvh, 0, (z0 + z1) / 2, 0.016, z1 - z0, EDGE, "placket")
    # pocket on the left chest: a grey outline under a white panel
    m.decal(bvh, -0.095, 1.235, 0.074, 0.08, EDGE, "pocket")
    m.decal(bvh, -0.095, 1.232, 0.062, 0.07, SHIRT, "pocket", lift=0.003)
    for side in (1, -1):
        cuff = base.Mesh().tube([(0.43, 0.046, 0.049, 0, "cuff"), (0.48, 0.044, 0.047, 0, "cuff")],
                                origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)),
                                angles=base.HEX6, angle_offset=30, swatch=SHIRT,
                                cap_start=False, cap_end=False, offset=0.008)
        m.extend(cuff if side == 1 else cuff.mirrored())
    belt = [(0.955, 0.162, 0.102, 0.0, "belt"), (1.005, 0.162, 0.102, 0.0, "belt")]
    m.tube(belt, swatch=BELT, cap_start=False, cap_end=False, offset=0.008)
    hit, n, _, _ = bvh.ray_cast(Vector((0, 1, 0.98)), -base.Y)
    m.hull([hit + Vector((x, y, z)) for x in (-0.025, 0.025) for y in (0.0, 0.016) for z in (-0.02, 0.02)],
           "steel", "buckle")
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", help="reference image for the private contact sheet")
    ap.add_argument("--private", help="folder for the private contact sheet")
    ap.add_argument("--hair", default=HAIR_STYLE, choices=sorted(HAIR_STYLES))
    ap.add_argument("--outfit", default="all", choices=["office", *outfits.OUTFITS, "all"])
    ap.add_argument("--out", default=HERE, help="output folder (previews of other variants)")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    for outfit in (["office", *outfits.OUTFITS] if args.outfit == "all" else [args.outfit]):
        build(outfit, args)


def office(body):
    """Today's look: white shirt tucked into navy trousers, brown shoes."""
    return {"colors": {}, "hide": set(), "rigid": {"collar": "neck"},
            "parts": {"collar": collar(), "shirt_details": shirt_details(body)}}


def build(outfit, args):
    base.reset()
    shirt = {"hips": TROUSERS, "thigh": TROUSERS, "shin": TROUSERS, "shoe": SHOES,
             "belly": SHIRT, "chest": SHIRT, "upper_arm": SHIRT, "forearm": SHIRT}
    if outfit == "office":
        body = base.body(skin=SKIN, brow=BEARD, colors=shirt)
        o = office(body)
    else:
        o = outfits.OUTFITS[outfit]()
        body = base.body(skin=SKIN, brow=BEARD, colors={**shirt, **o["colors"]})
    # Under a helmet only the cropped cap is left of the hair
    hair = cap() if "helmet" in o["parts"] else HAIR_STYLES[args.hair]()
    parts = {"body": body, "hair": hair, "beard": beard(), "moustache": moustache(), **o["parts"]}
    rigid = {"hair": "head", "beard": "head", "moustache": "head", **o["rigid"]}
    notes = {"office": ["Lower body is not in the reference: shirt tucked in, belt, navy trousers, brown shoes."],
             "survival": ["Helicopter immersion suit with a lifejacket."],
             }.get(outfit, ["Offshore PPE: hi-vis jacket, navy trousers, reflective bands, safety boots."
                            + (" Helmet with ear defenders and gloves." if outfit == "ppe_deck" else "")])
    notes.append("Beard and hair follow the head bone only.")
    base.finish(NAME, parts, args.out, notes=notes, rigid=rigid, hide=o["hide"],
                variant=None if outfit == "office" else outfit,
                reference=args.reference, private_dir=args.private)


if __name__ == "__main__":
    main()
