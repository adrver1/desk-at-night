"""
glasses_ceo: a short greying crop, heavy round black glasses, light grey
stubble, a wide smile, and a blue blazer open over a white shirt. An
original character, not a likeness.

    python characters/glasses_ceo/build_glasses_ceo.py [--outfit office|ppe|ppe_deck|all]
    python characters/glasses_ceo/build_glasses_ceo.py --reference ref.png --private DIR

The live look is the blazer plus the shared PPE outfits. EXTRA_LOOKS = True
also builds a kept variant, `casual`: a charcoal overshirt open over a
light-blue T-shirt and jeans.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import clothes  # noqa: E402  (imports bpy)
import crew  # noqa: E402
import faces  # noqa: E402
import hair  # noqa: E402

HAIR, TEMPLES = "hair_brown", "hair_salt_pepper"
BLAZER, LAPEL, SHIRT = "blue", "denim", "white"
OVERSHIRT, TEE, BUTTONS = "charcoal", "light_blue", "light_grey"
EXTRA_LOOKS = False


def office(body):
    """Blue blazer open over a white shirt, charcoal trousers, black shoes."""
    return {"colors": {}, "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"blazer": clothes.blazer(BLAZER, LAPEL, SHIRT, buttons="navy"),
                      "collar": clothes.shirt_collar(SHIRT), "cuffs": clothes.shirt_cuffs(SHIRT)},
            "rigid": {"collar": "neck"}}


def casual():
    """Charcoal overshirt open over a light-blue T-shirt, dark jeans."""
    return {"colors": {"hips": "denim", "thigh": "denim", "shin": "denim", "shoe": "black"},
            "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"overshirt": clothes.blazer(OVERSHIRT, OVERSHIRT, TEE, buttons=BUTTONS),
                      "collar": clothes.shirt_collar(OVERSHIRT), "neckband": clothes.neck_band(TEE)},
            "rigid": {"collar": "neck"}}


LOOK = crew.Look(
    "glasses_ceo", skin="skin_2", brow=HAIR, trousers="charcoal", shoes="black",
    hair=lambda helmet: hair.crop_top(HAIR, TEMPLES, helmet=helmet),
    top={"belly": SHIRT, "chest": SHIRT, "upper_arm": BLAZER, "forearm": BLAZER},
    office=office,
    face=lambda body: {"stubble": faces.stubble("stubble"), "smile": faces.smile(body)},
    glasses="round_thick", extra={"casual": casual} if EXTRA_LOOKS else None,
    notes=["Lower body is not in the references: charcoal trousers and black shoes."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
