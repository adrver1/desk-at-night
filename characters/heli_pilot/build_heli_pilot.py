"""
heli_pilot: the captain flying the crew out to the platform. Dark hair
greying at the temples, clean-shaven, a navy flight suit with captain's
epaulettes. An original character, not a likeness.

    python characters/heli_pilot/build_heli_pilot.py [--outfit office|flying|flying_headset|all]

office is the flight suit alone (walking out to the helicopter), flying
adds the white flight helmet with its visor up and a boom mic, and
flying_headset an over-ear headset with a boom mic instead. Pilots wear
their own kit, so the crew's PPE and survival outfits are left out.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))
import crew  # noqa: E402  (imports bpy)
import hair  # noqa: E402
import outfits  # noqa: E402

HAIR, TEMPLES = "hair_dark_brown", "hair_salt_pepper"


def office(body):
    """Navy flight suit and black boots, no helmet."""
    return outfits.flight_suit_only()


LOOK = crew.Look(
    "heli_pilot", skin="skin_4", brow=HAIR, trousers=outfits.FLIGHT, shoes="rubber",
    hair=lambda helmet: hair.crop_top(HAIR, TEMPLES, helmet=helmet),
    top={},
    office=office,
    shared=(),
    extra=outfits.FLIGHT_OUTFITS,
    notes=["Original character: no reference, no operator's logo or colours."])

if __name__ == "__main__":
    crew.main(LOOK, HERE)
