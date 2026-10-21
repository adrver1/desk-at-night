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


def hair():
    """Short sides and back, volume swept up at the front: one hull."""
    pts = head_ring(4, 0.009) + head_ring(3, 0.006, 1.675)
    # sides and back come down further than the front hairline, hugging the skull
    pts += [p for p in head_ring(2, 0.008, 1.615) if p.y < 0.0]
    pts += [Vector((x, -0.10, 1.585)) for x in (-0.05, 0.05)]
    # the swept-up top: a near-vertical front rising from the hairline,
    # sloping back to the crown
    pts += [Vector((x, 0.108, 1.70)) for x in (-0.07, 0.07)]
    pts += [Vector((x, 0.085, 1.795)) for x in (-0.055, 0.055)]
    pts += [Vector((x, -0.04, 1.78)) for x in (-0.065, 0.065)]
    return base.Mesh().hull(pts, HAIR, "hair")


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
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    base.reset()
    body = base.body(skin=SKIN, brow=BEARD, colors={
        "hips": TROUSERS, "thigh": TROUSERS, "shin": TROUSERS, "shoe": SHOES,
        "belly": SHIRT, "chest": SHIRT, "upper_arm": SHIRT, "forearm": SHIRT,
    })
    parts = {"body": body, "hair": hair(), "beard": beard(), "moustache": moustache(),
             "collar": collar(), "shirt_details": shirt_details(body)}
    rigid = {"hair": "head", "beard": "head", "moustache": "head", "collar": "neck"}
    notes = ["Lower body is not in the reference: shirt tucked in, belt, navy trousers, brown shoes.",
             "Beard and hair follow the head bone only; collar follows the neck."]
    base.finish(NAME, parts, HERE, notes=notes, rigid=rigid,
                reference=args.reference, private_dir=args.private)


if __name__ == "__main__":
    main()
