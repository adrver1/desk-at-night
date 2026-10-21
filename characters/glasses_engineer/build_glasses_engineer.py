"""
glasses_engineer: short brown hair swept up and over, a trimmed stubble
beard, thin dark rectangular glasses and a navy zip-neck sweater over a
white shirt collar. An original character, not a likeness.

    python characters/glasses_engineer/build_glasses_engineer.py [--outfit office|ppe|ppe_deck|all]
    python characters/glasses_engineer/build_glasses_engineer.py --reference ref.png --private DIR
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, SWEATER, RIB, SHIRT, ZIP = "hair_brown", "navy", "coverall_navy", "white", "steel"


def office(body):
    """Navy zip-neck sweater over a white shirt, grey chinos, brown shoes."""
    knit = clothes.sweater(SWEATER, RIB, neck="zip")
    return {"colors": {}, "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"sweater": knit, "zip": clothes.zip_line(knit, ZIP, 1.32, 1.465),
                      "collar": clothes.shirt_collar(SHIRT, spread=1.3, under=True)},
            "rigid": {"collar": "neck"}}


LOOK = crew.Look(
    "glasses_engineer", skin="skin_2", brow=HAIR, trousers="grey", shoes="leather_brown",
    hair=lambda helmet: hair.swept_up(HAIR, helmet=helmet),
    top={"upper_arm": SWEATER, "forearm": SWEATER},
    office=office,
    face=lambda body: {"stubble": faces.stubble("stubble_dark"), "smile": faces.smile(body)},
    glasses="rect_thin",
    notes=["Lower body is not in the reference: grey chinos and brown shoes."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
