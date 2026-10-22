"""
curly_analyst: dark curly hair, receding on top and long at the back and
sides (a curly mullet), dark rectangular glasses, stubble and a dark
goatee, a turquoise polo and a chunky orange watch. An original
character, not a likeness.

    python characters/curly_analyst/build_curly_analyst.py [--outfit office|ppe|ppe_deck|all]
    python characters/curly_analyst/build_curly_analyst.py --reference ref.png --private DIR

The live look is the polo plus the shared PPE outfits. EXTRA_LOOKS = True
also builds two kept variants: `jacket` (an amber zip jacket over the
polo, dark trousers, grey gloves, boots) and `winter` (the jacket plus a
red beanie and ski goggles).
HEADSET = True puts the shared headset on him; the live look leaves it off.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import accessories  # noqa: E402  (imports bpy)
import clothes  # noqa: E402
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, POLO, TRIM, BUTTONS = "hair_dark_brown", "turquoise", "turquoise_dark", "white"
STRAP, DIAL = "hivis_orange", "plastic_black"
JACKET, JACKET_HEM, OUT_TROUSERS, GLOVES, BOOTS = "jacket_amber", "jacket_amber_dark", "charcoal", "grey", "rubber"
BEANIE, LENS = "red", "hivis_orange"
HEADSET = False
EXTRA_LOOKS = False


def office(body):
    """Turquoise polo over khaki trousers, an orange watch on the left wrist."""
    return {"colors": {}, "hide": set(),
            "parts": {"sleeves": clothes.sleeves(POLO, length=0.2, offset=0.01, cuff=TRIM),
                      "collar": clothes.polo_collar(POLO),
                      "placket": clothes.placket(body, TRIM, 1.30, 1.40, BUTTONS, n=2, width=0.02),
                      "watch": clothes.watch(STRAP, DIAL)},
            "rigid": {"collar": "neck", "watch": "forearm.L"}}


def jacket():
    """Amber zip jacket over the polo, dark trousers, grey gloves and boots."""
    return {"colors": {"hips": OUT_TROUSERS, "thigh": OUT_TROUSERS, "shin": OUT_TROUSERS, "shoe": BOOTS,
                       "hand": GLOVES},
            "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"jacket": clothes.zip_jacket(JACKET, JACKET_HEM)},
            "rigid": {}}


def winter():
    """The amber jacket with a red beanie and ski goggles."""
    o = jacket()
    o["parts"]["beanie"] = accessories.beanie(BEANIE)
    o["parts"]["goggles"] = accessories.goggles(LENS)
    o["covered"], o["glasses"] = True, False
    return o


def face(body):
    return {"stubble": faces.stubble("stubble"), "beard": faces.goatee(HAIR)}


LOOK = crew.Look(
    "curly_analyst", skin="skin_3", brow=HAIR, trousers="khaki", shoes="leather_brown",
    hair=lambda helmet: hair.curly_mullet(HAIR, helmet=helmet),
    top={"belly": POLO, "chest": POLO, "upper_arm": POLO},
    office=office, face=face, glasses="rect_thick", headset=HEADSET,
    extra={"jacket": jacket, "winter": winter} if EXTRA_LOOKS else None,
    notes=["Two references of the same man plus Adriaen's cartoon: polo and watch from the photos,",
           "goatee from the photos, long curls and the amber jacket looks from the cartoon. Lower body invented."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
