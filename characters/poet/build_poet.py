"""
poet: a 19th-century language scholar and poet for the story's video
calls. Bald on top with a wispy white fringe from the temples round the
back of the head, a white chin-curtain beard along the jaw and under the
chin (no moustache), a dark frock coat over a white shirt front and a
black cravat tied high round the neck.

    python characters/poet/build_poet.py

He comes from another century, so he has no PPE or survival outfits:
only the office look. The fringe, beard and cravat are his own parts,
built from the shared head and face helpers.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402

base = faces.base
Vector = base.Vector

HAIR, BROW = "hair_white", "hair_grey"
COAT, LAPEL, SHIRT, CRAVAT = "charcoal", "black", "white", "black"

# Fringe from the right temple round the back to the left temple: angle,
# bottom, top and how far the middle row puffs out (wispy over the ears)
FRINGE = [(24, 1.650, 1.700, 0.0), (12, 1.610, 1.705, 0.030), (350, 1.585, 1.712, 0.046),
          (320, 1.555, 1.718, 0.046), (290, 1.535, 1.720, 0.040), (270, 1.530, 1.720, 0.038)]


def fringe(color, region="hair"):
    """A horseshoe of hair: three rows per angle (flush at the bottom and
    top, puffed out in between), mirrored to the left side."""
    # a column with no puff sinks just under the skin: the fringe tapers
    # into the temple without an edge showing
    pts = [[base.head_point(a, z0, 0.004 if puff else -0.004), base.head_point(a, (z0 + z1) / 2 - 0.01, puff or -0.004),
            base.head_point(a, z1, 0.004 if puff else -0.004)] for a, z0, z1, puff in FRINGE]
    left = [[Vector((-p.x, p.y, p.z)) for p in col] for col in pts[-2::-1]]
    cols = pts + left
    m = base.Mesh()
    for c0, c1 in zip(cols, cols[1:]):
        for k in range(2):
            m.face([c0[k], c1[k], c1[k + 1], c0[k + 1]], color, region)
    # close the ends at the temples so the shell has no open edge
    for col in (cols[0], cols[-1][::-1]):
        m.face(col, color, region)
    return m


# Chin curtain: from the sideburns down the jaw and under the chin, the
# cheeks, upper lip and the chin under the lip shaved
CURTAIN = {5: 1.605, 20: 1.565, 40: 1.528, 60: 1.502, 75: 1.494, 90: 1.490}


def chin_curtain(color, offset=0.020, chin=0.045, region="beard"):
    m = base.Mesh()

    def bottom(a):
        return faces.CHIN_Z - chin * max(0.0, math.cos(math.radians(a - 90))) ** 2

    def off(a, f):
        front = max(0.0, math.cos(math.radians(a - 90)))
        return offset * (0.6 + 0.4 * front) * (1.0 - 0.6 * f) + 0.003
    top = lambda a: faces._line(a, CURTAIN)  # noqa: E731
    faces._sheet(m, faces.ANGLES, top, bottom, off, color, region)
    under = [faces.face_point(a, bottom(a), off(a, 0)) for a in faces.ANGLES]
    inner = [Vector((p.x * 0.6, p.y * 0.55 + 0.01, faces.CHIN_Z - 0.004)) for p in under]
    for i in range(len(faces.ANGLES) - 1):
        m.face([inner[i], inner[i + 1], under[i + 1], under[i]], color, region)
    return m


def cravat(color, region="tie"):
    """A black stock wound high round the neck, tied in a small bow at the
    front."""
    m = clothes.neck_band(color, z0=1.395, z1=1.455, region=region)
    y, z = 0.084, 1.405
    m.hull([Vector((x, y + dy, z + dz)) for x in (-0.010, 0.010) for dy in (0.0, 0.012) for dz in (-0.010, 0.010)],
           color, region)
    for s in (1, -1):
        m.hull([Vector((s * 0.006, y + 0.004, z + dz)) for dz in (-0.008, 0.008)]
               + [Vector((s * 0.022, y + dy, z + dz)) for dy in (-0.010, 0.004) for dz in (-0.011, 0.011)],
               color, region)
    return m


def office(body):
    """Dark frock coat open over a white shirt front, black cravat."""
    return {"colors": {}, "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"coat": clothes.blazer(COAT, LAPEL, SHIRT, buttons=LAPEL), "cravat": cravat(CRAVAT),
                      "cuffs": clothes.shirt_cuffs(SHIRT)},
            "rigid": {"cravat": "neck"}}


LOOK = crew.Look(
    "poet", skin="skin_2", brow=BROW, trousers="black", shoes="black",
    hair=lambda helmet: fringe(HAIR),
    face=lambda body: {"beard": chin_curtain(HAIR)},
    top={"belly": SHIRT, "chest": SHIRT, "upper_arm": COAT, "forearm": COAT},
    office=office, shared=(), ears=1.1,
    notes=["19th-century look: no PPE outfits.", "Fringe, chin curtain and cravat are his own parts."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
