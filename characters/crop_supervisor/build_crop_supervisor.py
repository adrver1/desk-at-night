"""
crop_supervisor: a very short crop with a receding hairline, clean-shaven,
a friendly closed smile and a pale blue shirt open at the neck. An
original character, not a likeness.

    python characters/crop_supervisor/build_crop_supervisor.py [--outfit office|ppe|ppe_deck|all]
    python characters/crop_supervisor/build_crop_supervisor.py --reference ref.png --private DIR
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, SHIRT, PLACKET, BUTTONS = "hair_light_brown", "pale_blue", "light_blue", "white"


def office(body):
    """Pale blue shirt tucked into navy trousers, black shoes."""
    return {"colors": {}, "hide": set(),
            "parts": {"collar": clothes.shirt_collar(SHIRT),
                      "placket": clothes.placket(body, PLACKET, 1.02, 1.34, BUTTONS, n=4),
                      "belt": clothes.belt("black")},
            "rigid": {"collar": "neck"}}


LOOK = crew.Look(
    "crop_supervisor", skin="skin_2", brow=HAIR, trousers="navy", shoes="black",
    hair=lambda helmet: hair.buzz(HAIR, helmet=helmet),
    top={"belly": SHIRT, "chest": SHIRT, "upper_arm": SHIRT, "forearm": SHIRT},
    office=office,
    face=lambda body: {"smile": faces.smile(body, teeth=False, width=0.05)},
    notes=["Reference is black and white: light-brown hair and the pale blue shirt are guesses.",
           "Lower body is not in the reference: navy trousers and black shoes."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
