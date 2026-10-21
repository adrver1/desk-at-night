"""
blazer_lead: short dark-brown hair swept to one side, light stubble, a navy
blazer open over a white shirt with an open collar. An original
character, not a likeness.

    python characters/blazer_lead/build_blazer_lead.py [--outfit office|ppe|ppe_deck|all]
    python characters/blazer_lead/build_blazer_lead.py --reference ref.png --private DIR
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, BLAZER, LAPEL, SHIRT = "hair_dark_brown", "navy", "coverall_navy", "white"


def office(body):
    """Navy blazer open over a white shirt, charcoal trousers, brown shoes."""
    return {"colors": {}, "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"blazer": clothes.blazer(BLAZER, LAPEL, SHIRT), "collar": clothes.shirt_collar(SHIRT)},
            "rigid": {"collar": "neck"}}


LOOK = crew.Look(
    "blazer_lead", skin="skin_2", brow=HAIR, trousers="charcoal", shoes="leather_brown",
    hair=lambda helmet: hair.side_sweep(HAIR, helmet=helmet),
    top={"belly": SHIRT, "chest": SHIRT, "upper_arm": BLAZER, "forearm": BLAZER},
    office=office,
    face=lambda body: {"stubble": faces.stubble("stubble")},
    notes=["Lower body is not in the reference: charcoal trousers and brown shoes."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
