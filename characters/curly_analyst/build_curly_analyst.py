"""
curly_analyst: dark curly hair, receding on top and long at the back (a
curly mullet), dark rectangular glasses, stubble with a darker chin, a
turquoise polo and a chunky orange watch. An original character, not a
likeness.

    python characters/curly_analyst/build_curly_analyst.py [--outfit office|ppe|ppe_deck|all]
    python characters/curly_analyst/build_curly_analyst.py --reference ref.png --private DIR

HEADSET = True puts the shared headset on him; the live look leaves it off.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, POLO, TRIM, BUTTONS = "hair_dark_brown", "turquoise", "turquoise_dark", "white"
STRAP, DIAL = "hivis_orange", "plastic_black"
HEADSET = False


def office(body):
    """Turquoise polo over khaki trousers, an orange watch on the left wrist."""
    return {"colors": {}, "hide": set(),
            "parts": {"sleeves": clothes.sleeves(POLO, length=0.2, offset=0.01, cuff=TRIM),
                      "collar": clothes.polo_collar(POLO),
                      "placket": clothes.placket(body, TRIM, 1.30, 1.40, BUTTONS, n=2, width=0.02),
                      "watch": clothes.watch(STRAP, DIAL)},
            "rigid": {"collar": "neck", "watch": "forearm.L"}}


def face(body):
    return {"stubble": faces.stubble("stubble"), "beard": faces.goatee("stubble_dark")}


LOOK = crew.Look(
    "curly_analyst", skin="skin_3", brow=HAIR, trousers="khaki", shoes="leather_brown",
    hair=lambda helmet: hair.curly_mullet(HAIR, helmet=helmet),
    top={"belly": POLO, "chest": POLO, "upper_arm": POLO},
    office=office, face=face, glasses="rect_thick", headset=HEADSET,
    notes=["Two references of the same man: hair and polo from one, glasses and goatee from the other.",
           "Lower body is not in the reference: khaki trousers and brown shoes."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
