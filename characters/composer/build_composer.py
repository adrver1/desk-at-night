"""
composer: a 19th-century composer for the story's video calls. A big
greying mane swept back from a high forehead and bushing out over the
ears to the collar, a heavy walrus moustache over a clean-shaven chin, a
dark frock coat over a white shirt with a wing collar and a black bow tie.

    python characters/composer/build_composer.py

He comes from another century, so besides his own look he has only the
indoor PPE (`--outfit ppe`), for the story's video call from offshore
(Adriaen, 2026-10-29); no deck PPE or survival suit. The mane, moustache and bow tie are his own parts,
built from the shared hair and face helpers.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

base = hair.base
Vector = base.Vector
per = hair.per

HAIR, SIDES, BROW = "hair_white", "hair_white", "hair_grey"
COAT, LAPEL, SHIRT, TIE = "charcoal", "black", "white", "black"
# High forehead, the hair starting well back from the brows
HAIRLINE = {**hair.FULL, 55: 1.722, 125: 1.722, 20: 1.660, 160: 1.660}


def mane(color, sides, helmet=False):
    """A big shell swept back from the forehead, highest over the crown,
    plus a bush from above the ears round the back down to the collar."""
    rows = [(0.0, per(0.008, 0.016, 0.030, 0.034), 0.0),
            (0.22, per(0.030, 0.040, 0.050, 0.054), per(0.012, 0.008, 0.002, 0.0)),
            (0.55, per(0.040, 0.044, 0.050, 0.050), per(0.036, 0.026, 0.018, 0.010)),
            (0.86, per(0.030, 0.032, 0.034, 0.034), per(0.054, 0.048, 0.040, 0.032))]
    colors = [per(color, sides, sides, sides), per(color, color, sides, sides), color, color]
    m = hair.shell(HAIRLINE, rows, colors, (0.0, -0.02, hair.CROWN + 0.07))
    n = len(m.faces)
    h = HAIRLINE
    bush = [hair.on_cap(h, a, f, 0.050, 0.0) for a in (200, 235, 305, 340) for f in (0.0, 0.3)]
    bush += [Vector(p) for p in ((0.150, -0.020, 1.585), (-0.150, -0.020, 1.585), (0.140, -0.075, 1.53),
                                 (-0.140, -0.075, 1.53), (0.08, -0.125, 1.475), (-0.08, -0.125, 1.475),
                                 (0.0, -0.15, 1.50), (0.125, 0.0, 1.64), (-0.125, 0.0, 1.64))]
    m.hull(bush, sides, "hair")
    return m.cull_inside(range(n, len(m.faces)), range(n))


def walrus(color, offset=0.020, region="beard"):
    """A heavy walrus moustache: two halves from under the nose over the
    upper lip, drooping past the mouth corners."""
    m = base.Mesh()
    for s in (1, -1):
        a0, a1 = (90, 52) if s == 1 else (90, 128)
        pts = []
        for a, z0, z1, d in ((a0, 1.527, 1.562, offset), ((a0 + a1) / 2, 1.515, 1.556, offset),
                             (a1, 1.488, 1.530, offset * 0.6)):
            for z in (z0, z1):
                for dd in (0.003, d):
                    pts.append(faces.face_point(a, z, dd))
        m.hull(pts, color, region)
    return m


def bow_tie(color, region="tie"):
    """Black bow tie at the throat: a knot and two wings."""
    m = base.Mesh()
    y, z = 0.086, 1.402
    m.hull([Vector((x, y + dy, z + dz)) for x in (-0.009, 0.009) for dy in (0.0, 0.012) for dz in (-0.009, 0.009)],
           color, region)
    for s in (1, -1):
        m.hull([Vector((s * 0.006, y + 0.004, z + dz)) for dz in (-0.008, 0.008)]
               + [Vector((s * 0.040, y + dy, z + dz)) for dy in (-0.010, 0.004) for dz in (-0.018, 0.018)],
               color, region)
    return m


def office(body):
    """Dark frock coat open over a white shirt, wing collar, black bow tie."""
    return {"colors": {}, "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"coat": clothes.blazer(COAT, LAPEL, SHIRT, buttons=LAPEL),
                      "collar": clothes.shirt_collar(SHIRT, spread=0.7), "tie": bow_tie(TIE),
                      "cuffs": clothes.shirt_cuffs(SHIRT)},
            "rigid": {"collar": "neck", "tie": "neck"}}


LOOK = crew.Look(
    "composer", skin="skin_1", brow=BROW, trousers="black", shoes="black",
    hair=lambda helmet: mane(HAIR, SIDES, helmet),
    face=lambda body: {"beard": walrus(HAIR)},
    top={"belly": SHIRT, "chest": SHIRT, "upper_arm": COAT, "forearm": COAT},
    office=office, shared=("ppe",), ears=1.0,
    notes=["19th-century look; indoor PPE only, for the story's video call from offshore.", "Mane and walrus moustache are his own parts."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
