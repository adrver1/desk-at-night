"""
curly_fade_tech: dark curls on top of a skin fade, a stubble beard, a big
smile and a black button shirt with white buttons. An original character,
not a likeness.

    python characters/curly_fade_tech/build_curly_fade_tech.py [--outfit office|ppe|ppe_deck|all]
    python characters/curly_fade_tech/build_curly_fade_tech.py --reference ref.png --private DIR
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, FADE, SHIRT, PLACKET, BUTTONS = "hair_dark_brown", "hair_fade", "black", "charcoal", "white"


def office(body):
    """Black shirt with white buttons tucked into dark jeans, black trainers."""
    return {"colors": {}, "hide": set(),
            "parts": {"collar": clothes.shirt_collar(SHIRT),
                      "placket": clothes.placket(body, PLACKET, 1.02, 1.36, BUTTONS, n=5),
                      "belt": clothes.belt("black")},
            "rigid": {"collar": "neck"}}


LOOK = crew.Look(
    "curly_fade_tech", skin="skin_2", brow=HAIR, trousers="denim", shoes="black",
    hair=lambda helmet: hair.curly_top(HAIR, FADE, helmet=helmet),
    top={"belly": SHIRT, "chest": SHIRT, "upper_arm": SHIRT, "forearm": SHIRT},
    office=office,
    face=lambda body: {"stubble": faces.stubble("stubble"), "smile": faces.smile(body)},
    notes=["Reference is black and white: dark-brown hair is a guess.",
           "Lower body is not in the reference: dark jeans and black trainers."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
