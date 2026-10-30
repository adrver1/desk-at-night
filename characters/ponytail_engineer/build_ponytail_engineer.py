"""
ponytail_engineer: the cast's first woman, on the slim figure. Long brown
hair pulled back into a ponytail with a dark hair tie, slightly tanned
skin, fine brows and lashes, pearl stud earrings, a burgundy crew-neck
sweater, dark jeans and white trainers. An original character, not a
likeness.

    python characters/ponytail_engineer/build_ponytail_engineer.py [--outfit office|ppe|ppe_deck|survival|all]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import accessories  # noqa: E402  (imports bpy)
import base_body as base  # noqa: E402
import clothes  # noqa: E402
import crew  # noqa: E402
import hair  # noqa: E402

HAIR, SWEATER, JEANS, SHOES = "hair_brown", "burgundy", "denim", "white"


def office(body):
    """Burgundy crew-neck sweater, dark jeans, white trainers."""
    return {"colors": {}, "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"sweater": clothes.sweater(SWEATER, neck="crew")}, "rigid": {}}


def face(body):
    """Upper lashes a little wider than the eyes, and the pearls."""
    lashes = base.Mesh()
    bvh = body.bvh()
    for s in (1, -1):
        lashes.decal(bvh, s * 0.042, 1.6305, 0.026, 0.0042, "eye", "lashes", tilt=-s * 4)
    return {"lashes": lashes, "earrings": accessories.earrings()}


LOOK = crew.Look(
    "ponytail_engineer", skin="skin_3", brow=HAIR, trousers=JEANS, shoes=SHOES,
    hair=lambda helmet: hair.ponytail(HAIR, helmet=helmet),
    top={"upper_arm": SWEATER, "forearm": SWEATER},
    office=office, face=face, figure="slim",
    notes=["Slim figure (base_body.FIGURES['slim']) on the shared rig.",
           "Pearl studs hang under the ear lobes; under ear defenders the cups cover them."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
