"""
Builds a crew character's looks from one description, so every
character script stays a short list of choices:

    office     the character's own clothes, from the reference
    ppe        indoor PPE (outfits.ppe)
    ppe_deck   deck PPE with helmet, ear defenders, gloves (outfits.ppe_deck)
    survival   helicopter immersion suit and lifejacket (outfits.survival)

A character is a `Look`: skin, brows, trousers and shoes, a hair function
(taking helmet=True|False), facial hair and expression parts, optional
glasses, the body colours of the office clothes (`top`) and an
office(body) function returning their parts as an outfit dict
(colors, hide, parts, rigid), the same shape as outfits.OUTFITS.

Characters with their own glasses keep them on deck (prescription safety
glasses) instead of the clear safety specs.

`extra` adds a character's own outfits ({name: function returning an
outfit dict}). Such a dict may also say "covered": True (a hat: keep only
the hair below its rim) and "glasses": False (goggles instead).
`ears` scales how far the ears stick out (1.0 is the base body) and
`ear_flare` swings their back edges away from the head (metres).
"""
import argparse
import sys

import accessories
import base_body as base
import outfits

HEAD_PARTS = ("hair", "stubble", "beard", "smile", "glasses", "headset", "beanie", "goggles")


class Look:
    def __init__(self, name, skin, brow, trousers, shoes, hair, top, office, face=None, glasses=None,
                 headset=False, notes=(), extra=None, ears=1.0, ear_flare=0.0):
        self.name, self.skin, self.brow, self.top = name, skin, brow, top
        self.trousers, self.shoes = trousers, shoes
        self.hair, self.office, self.face = hair, office, face or (lambda body: {})
        self.glasses, self.headset, self.notes = glasses, headset, list(notes)
        self.extra = extra or {}
        self.ears, self.ear_flare = ears, ear_flare


def build(look, outfit, out, reference=None, private_dir=None):
    base.reset()
    legs = {"hips": look.trousers, "thigh": look.trousers, "shin": look.trousers, "shoe": look.shoes}
    if outfit == "office":
        body = base.body(skin=look.skin, brow=look.brow, colors={**legs, **look.top}, ear_scale=look.ears, ear_flare=look.ear_flare)
        o = look.office(body)        # details that sit on the body (plackets, buttons) need it
    else:
        o = (look.extra.get(outfit) or outfits.OUTFITS[outfit])()
        body = base.body(skin=look.skin, brow=look.brow, colors={**legs, **o["colors"]}, ear_scale=look.ears, ear_flare=look.ear_flare)
    helmet = "helmet" in o["parts"] or o.get("covered", False)
    parts = {"body": body, "hair": look.hair(helmet=helmet), **look.face(body)}
    if look.glasses and o.get("glasses", True):
        parts["glasses"] = accessories.glasses(look.glasses)
        o["parts"].pop("glasses", None)
    if look.headset and not helmet:
        parts["headset"] = accessories.headset()
    parts.update(o["parts"])
    rigid = {**{p: "head" for p in HEAD_PARTS}, **o["rigid"]}
    if not look.glasses and "glasses" in parts:
        rigid["glasses"] = "head"
    notes = list(look.notes)
    if outfit in look.extra:
        notes.append(look.extra[outfit].__doc__.strip().splitlines()[0])
    elif outfit != "office":
        notes.append("Offshore PPE: hi-vis jacket, navy trousers, reflective bands, safety boots."
                     + (" Helmet with ear defenders, safety glasses and gloves." if helmet else ""))
    notes.append("Hair, facial hair and glasses follow the head bone only.")
    base.finish(look.name, parts, out, notes=notes, rigid=rigid, hide=o["hide"],
                variant=None if outfit == "office" else outfit,
                reference=reference, private_dir=private_dir)


def main(look, here):
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", help="reference image for the private contact sheet")
    ap.add_argument("--private", help="folder for the private contact sheet")
    names = ["office", *outfits.OUTFITS, *look.extra]
    ap.add_argument("--outfit", default="all", choices=[*names, "all"])
    ap.add_argument("--out", default=here, help="output folder")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    for outfit in (names if args.outfit == "all" else [args.outfit]):
        build(look, outfit, args.out, args.reference, args.private)
