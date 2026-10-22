"""
grey_beard_lead: wavy salt-and-pepper hair swept back, greyer at the
temples, a short grey beard, thin metal glasses and a charcoal V-neck
sweater over a light-blue shirt, with khaki trousers. An original character, not a
likeness.

    python characters/grey_beard_lead/build_grey_beard_lead.py [--outfit office|ppe|ppe_deck|all]
    python characters/grey_beard_lead/build_grey_beard_lead.py --reference ref.png --private DIR
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, TEMPLES, BEARD, SWEATER, RIB, SHIRT = ("hair_salt_pepper", "hair_grey", "hair_grey", "charcoal",
                                             "black", "light_blue")


def office(body):
    """Charcoal V-neck sweater over a light-blue shirt, khaki trousers."""
    return {"colors": {}, "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"sweater": clothes.sweater(SWEATER, RIB, neck="v", shirt=SHIRT),
                      "collar": clothes.shirt_collar(SHIRT, under=True)},
            "rigid": {"collar": "neck"}}


LOOK = crew.Look(
    "grey_beard_lead", skin="skin_2", brow=TEMPLES, trousers="khaki", shoes="leather_brown",
    hair=lambda helmet: hair.swept_back(HAIR, TEMPLES, helmet=helmet),
    top={"upper_arm": SWEATER, "forearm": SWEATER},
    office=office,
    face=lambda body: {"beard": faces.beard(BEARD)},
    glasses="thin_metal",
    notes=["Built from the two newer references; the older one only for the face shape.",
           "Lower body from the cartoon: khaki trousers and brown shoes."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
