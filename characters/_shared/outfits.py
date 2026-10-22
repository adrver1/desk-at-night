"""
Shared outfits: clothing any character can wear over the base body, built
from the base body's own rings so every shell fits every character.

An outfit is a dict:

    colors  base body regions to recolour (trousers, gloves, boots)
    hide    base body regions the outfit covers completely (dropped after
            skinning, to stay in the triangle budget)
    parts   {name: Mesh} shells and accessories
    rigid   {region: bone} parts that follow one bone (helmets)

Offshore PPE follows the Aker BP crew's two-tone hi-vis: a yellow jacket
with a navy collar, navy lower sleeves and cuffs, a reflective band round
the waist, the sleeves and the shins, reflective patches on the shoulders,
the company's ribbon logo big on the back and small on the chest pocket,
navy trousers and black safety boots. Out on deck add a white helmet with
the logo sticker, blue ear defenders, safety glasses and gloves.

For the helicopter ride out, `survival` is a North Sea immersion suit: an
orange one-piece with black neoprene neck and wrist seals, the hood rolled
up behind the neck, reflective tape on the shoulders and arms, integral
boots, and a yellow lifejacket vest over the chest with a black waist strap.
"""
import math

import base_body as base

Vector = base.Vector

HIVIS, NAVY, TAPE = "hivis_yellow", "coverall_navy", "reflective"
HELMET, RUBBER, CUP, GLOVE = "helmet_white", "rubber", "helmet_blue", "grey"
FRAME, SHIELD, CLIP = "glass", "glass_clear", "plastic_black"

# The Aker BP logo, simplified to three flat ribbons (magenta, orange,
# green) stacked in an S, as (swatch, outline) in a unit box seen from the
# front: u from left to right, v from bottom to top.
LOGO = [("logo_magenta", [(0.12, 0.95), (0.33, 1.0), (0.30, 0.83), (0.55, 0.70), (0.55, 0.53),
                          (0.02, 0.51), (0.05, 0.67), (0.18, 0.80)]),
        ("logo_orange", [(0.36, 0.56), (0.56, 0.67), (1.0, 0.73), (1.0, 0.46), (0.86, 0.40),
                         (0.46, 0.30), (0.22, 0.34)]),
        ("logo_green", [(0.0, 0.31), (0.40, 0.39), (0.72, 0.41), (0.62, 0.23), (0.32, 0.14),
                        (0.47, 0.0), (0.12, 0.02), (0.0, 0.11)])]


def logo(m, bvh, x, z, w, h, facing=1, region="logo"):
    """Put the logo centred at (x, z), w wide and h high, on the front
    (facing=1) or the back (facing=-1) of the mesh behind it."""
    # Seen from the front, the viewer's right is the character's left (-X)
    sx = -1 if facing == 1 else 1
    for k, (swatch, outline) in enumerate(LOGO):
        m.decal_poly(bvh, [(x + sx * (u - 0.5) * w, z + (v - 0.5) * h) for u, v in outline],
                     swatch, region, facing, lift=0.003 + 0.001 * k)

JACKET_OFF, SLEEVE_OFF = 0.022, 0.016
HEM = 0.86


def jacket():
    """Hi-vis jacket over the torso: hem at the hips, a reflective band round
    the waist, closed at the neck where the collar sits."""
    rings = []
    for z, reg in ((HEM, "jacket"), (0.94, "band"), (0.985, "jacket"), (1.18, "jacket"),
                   (1.35, "jacket"), (base.TORSO[-1][0], "jacket")):
        ru, rv, dv = base.ring_at(base.TORSO, z)
        rings.append((z, ru, rv, dv, reg))
    # the hem flares a little, like a jacket hanging over the trousers
    z, ru, rv, dv, reg = rings[0]
    rings[0] = (z, ru + 0.01, rv + 0.008, dv, reg)
    m = base.Mesh().tube(rings, colors={"jacket": HIVIS, "band": TAPE}, offset=JACKET_OFF,
                         cap_start=False)
    # Navy stand-up collar, zipped to the top
    m.tube([(1.40, 0.088, 0.084, -0.008, "collar"), (1.475, 0.078, 0.074, -0.006, "collar")],
           swatch=NAVY, angles=base.HEX6, angle_offset=30, cap_start=False, cap_end=False)
    bvh = m.bvh()
    # Chest pocket on his left: a navy zip line along the flap, the logo below
    m.decal(bvh, -0.10, 1.285, 0.075, 0.008, NAVY, "pocket")
    logo(m, bvh, -0.10, 1.235, 0.055, 0.065)
    # The logo big on the back, and reflective patches on the shoulder blades
    logo(m, bvh, 0.0, 1.16, 0.23, 0.29, facing=-1)
    for s in (1, -1):
        m.decal_poly(bvh, [(s * 0.105, 1.31), (s * 0.16, 1.31), (s * 0.16, 1.37), (s * 0.105, 1.37)],
                     TAPE, "band", facing=-1)
    return m


def sleeves():
    """Hi-vis upper sleeves and navy forearms, each with a reflective band."""
    pts = sorted({r[0] for r in base.ARM} | {0.10, 0.14, 0.34, 0.38})
    rings = []
    for t in pts:
        reg = "band" if t in (0.10, 0.34) else "cuff" if t >= 0.25 else "sleeve"
        ru, rv = _arm_radius(t)
        rings.append((t, ru, rv, 0.0, reg))
    right = base.Mesh().tube(rings, origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)),
                             angles=base.HEX6, angle_offset=30, offset=SLEEVE_OFF,
                             colors={"sleeve": HIVIS, "band": TAPE, "cuff": NAVY},
                             cap_start=False, cap_end=False)
    return right.extend(right.mirrored())


def _arm_radius(t):
    a = base.ARM
    for (t0, u0, v0, _, _), (t1, u1, v1, _, _) in zip(a, a[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0)
            return u0 + (u1 - u0) * f, v0 + (v1 - v0) * f
    return a[-1][1], a[-1][2]


def leg_bands():
    """A reflective band round each shin and a boot shaft round each ankle."""
    right = base.Mesh()
    x = base.LEG_X
    right.tube([(0.30, 0.068, 0.072, -0.004, "band"), (0.345, 0.067, 0.071, -0.003, "band")],
               origin=(x, 0, 0), swatch=TAPE, angles=base.HEX6, angle_offset=30, offset=0.006,
               cap_start=False, cap_end=False)
    right.tube([(0.07, 0.058, 0.064, 0.005, "boot"), (0.17, 0.056, 0.060, 0.0, "boot")],
               origin=(x, 0, 0), swatch=RUBBER, angles=base.HEX6, angle_offset=30, offset=0.008,
               cap_start=False, cap_end=False)
    return right.extend(right.mirrored())


def helmet():
    """White safety helmet: a faceted dome, a short peak at the front and
    ear defenders on arms from the side slots, the logo sticker on
    the front."""
    rings = []
    # (height, head ring height it follows, offset): the top two rings round
    # the dome off over the crown
    for z, zh, off in ((1.655, 1.655, 0.034), (1.72, 1.70, 0.034), (1.775, 1.72, 0.022),
                       (1.80, 1.74, 0.0), (1.812, 1.75, -0.02)):
        ru, rv, dv = base.ring_at(base.HEAD, zh)
        rings.append((z, ru + off, rv + off, dv, "helmet"))
    m = base.Mesh().tube(rings, swatch=HELMET, cap_start=False)
    # the peak
    m.hull([Vector((x, y, z)) for x in (-0.085, 0.085) for y, z in ((0.10, 1.668), (0.185, 1.655), (0.10, 1.655))],
           HELMET, "helmet")
    logo(m, m.bvh(), 0.0, 1.705, 0.042, 0.05)
    for s in (1, -1):
        ear_defender(m, s)
    return m


def ear_defender(m, s):
    """Helmet-mounted ear defender on side s: a black clip plugged into the
    slot on the helmet's side, an arm down from it, a wire yoke round the
    cup to two pivots, and the blue cup on a black cushion over the ear."""
    cy, cz = -0.012, 1.594          # cup centre (over the ear)
    # Cushion against the head and the blue shell outside it, both oval
    for x0, x1, ru, rv, sw in ((0.128, 0.146, 0.068, 0.054, RUBBER), (0.146, 0.180, 0.066, 0.052, CUP)):
        shrink = 0.82 if sw == CUP else 1.0
        pts = []
        for x, k in ((x0, 1.0), (x1, shrink)):
            for i in range(8):
                a = math.radians(22.5 + 45 * i)
                pts.append(Vector((s * x, cy + k * rv * math.cos(a), cz + k * ru * math.sin(a))))
        m.hull(pts, sw, "ear_cup")
    # Clip in the helmet's side slot, just above the rim
    m.hull([Vector((s * x, cy + dy, z)) for x in (0.146, 0.172) for dy in (-0.016, 0.016)
            for z in (1.664, 1.692)], CLIP, "ear_cup")
    # Arm from the clip down past the rim to the top of the yoke
    top = (s * 0.180, cy, 1.660)
    m.bar((s * 0.176, cy, 1.676), top, 0.006, CLIP, "ear_cup")
    # Yoke: two wires from the arm out to pivots at the cup's front and back
    for dy in (0.058, -0.058):
        m.bar(top, (s * 0.180, cy + dy, cz), 0.0035, CLIP, "ear_cup")
        m.hull([Vector((s * x, cy + dy * 0.98 + ddy, cz + dz)) for x in (0.160, 0.186)
                for ddy in (-0.008, 0.008) for dz in (-0.008, 0.008)], CLIP, "ear_cup")


def glasses():
    """Wraparound safety glasses, drawn as their frame only so the eyes show:
    a brow bar curving round the face, a thin lower rim under each lens, a
    nose bridge, clear side shields at the temples and arms to the ears."""
    m = base.Mesh()
    off = 0.014
    top0, top1 = 1.634, 1.645       # brow bar
    # The brow bar follows the face from temple to temple
    angles = (36, 63, 90, 117, 144)
    for a0, a1 in zip(angles, angles[1:]):
        pts = []
        for a in (a0, a1):
            for z in (top0, top1):
                pts += [base.head_point(a, z, off - 0.003), base.head_point(a, z, off + 0.003)]
        m.hull(pts, FRAME, "glasses")
    for s in (1, -1):
        def ang(a):
            return a if s == 1 else 180 - a
        # Lower rim: from the bridge it dips under the eye and climbs to the shield
        rim = ((84, 1.606), (66, 1.593), (44, 1.604))
        for (a0, z0), (a1, z1) in zip(rim, rim[1:]):
            pts = []
            for a, z in ((ang(a0), z0), (ang(a1), z1)):
                for dz in (0.0, 0.005):
                    pts += [base.head_point(a, z + dz, off - 0.003), base.head_point(a, z + dz, off + 0.002)]
            m.hull(pts, FRAME, "glasses")
        # Nose pad: from the brow bar down to the rim beside the nose
        m.hull([base.head_point(ang(a), z, off + d) for a in (84, 89) for z in (1.606, top0)
                for d in (-0.003, 0.002)], FRAME, "glasses")
        # Side shield: a clear wedge from the brow bar to the rim at the temple
        m.hull([base.head_point(ang(a), z, off + d) for a, z in ((36, top1), (44, top0), (44, 1.604), (34, 1.612))
                for d in (-0.003, 0.002)], SHIELD, "glasses")
        # Arm back to the ear
        a = base.head_point(ang(36), 1.638, off)
        m.bar((a.x, a.y, a.z), (s * 0.122, -0.022, 1.630), 0.003, FRAME, "glasses")
    return m


def ppe():
    """Indoor PPE: hi-vis jacket, navy trousers with bands, safety boots."""
    return {"colors": {"hips": NAVY, "thigh": NAVY, "shin": NAVY, "shoe": RUBBER},
            "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"jacket": jacket(), "sleeves": sleeves(), "leg_bands": leg_bands()},
            "rigid": {}}


def ppe_deck():
    """PPE for out on deck: adds the helmet with ear defenders and gloves."""
    o = ppe()
    o["colors"]["hand"] = GLOVE
    o["parts"]["helmet"] = helmet()
    o["parts"]["glasses"] = glasses()
    o["rigid"] = {"helmet": "head", "ear_cup": "head", "glasses": "head"}
    return o


SUIT, SEAL, VEST, STRAP = "coverall_orange", "rubber", "hivis_yellow", "plastic_black"


def survival_suit():
    """Orange one-piece torso, sleeves with tape bands and wrist seals, a
    neck seal and the hood rolled behind the neck."""
    rings = []
    for z in (HEM, 0.94, 1.18, 1.35, base.TORSO[-1][0]):
        ru, rv, dv = base.ring_at(base.TORSO, z)
        rings.append((z, ru, rv, dv, "suit"))
    m = base.Mesh().tube(rings, swatch=SUIT, offset=0.022, cap_start=False)
    m.tube([(1.40, 0.072, 0.068, -0.008, "seal"), (1.49, 0.064, 0.060, -0.006, "seal")],
           swatch=SEAL, angles=base.HEX6, angle_offset=30, cap_start=False, cap_end=False)
    # the hood, rolled into a fat collar round the back of the neck
    roll = []
    for a in range(180, 361, 30):
        a = math.radians(a)
        for r, z in ((0.080, 1.425), (0.112, 1.445), (0.104, 1.505), (0.076, 1.50)):
            roll.append(Vector((r * 1.05 * math.cos(a), -0.008 + r * math.sin(a), z)))
    m.hull(roll, SUIT, "hood")
    pts = sorted({r[0] for r in base.ARM} | {0.07, 0.11, 0.42, 0.45})
    arm = []
    for t in pts:
        reg = "band" if t == 0.07 else "seal" if t >= 0.42 else "sleeve"
        ru, rv = _arm_radius(t)
        arm.append((t, ru, rv, 0.0, reg))
    right = base.Mesh().tube(arm, origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)),
                             angles=base.HEX6, angle_offset=30, offset=0.016,
                             colors={"sleeve": SUIT, "band": TAPE, "seal": SEAL},
                             cap_start=False, cap_end=False)
    x = base.LEG_X
    right.tube([(0.30, 0.068, 0.072, -0.004, "band"), (0.345, 0.067, 0.071, -0.003, "band")],
               origin=(x, 0, 0), swatch=TAPE, angles=base.HEX6, angle_offset=30, offset=0.008,
               cap_start=False, cap_end=False)
    right.tube([(0.07, 0.058, 0.064, 0.005, "boot"), (0.19, 0.057, 0.061, 0.0, "boot")],
               origin=(x, 0, 0), swatch=RUBBER, angles=base.HEX6, angle_offset=30, offset=0.010,
               cap_start=False, cap_end=False)
    return m.extend(right).extend(right.mirrored())


def lifejacket():
    """Yellow vest over the chest, zipped up the front, with a black strap
    round the waist below it."""
    rings = []
    for z in (1.17, 1.20, 1.35, base.TORSO[-1][0]):
        ru, rv, dv = base.ring_at(base.TORSO, z)
        rings.append((z, ru, rv, dv, "strap" if z < 1.19 else "vest"))
    m = base.Mesh().tube(rings, colors={"vest": VEST, "strap": STRAP}, offset=0.042, cap_start=True)
    bvh = m.bvh()
    m.decal(bvh, 0.0, 1.31, 0.008, 0.20, STRAP, "zip")
    m.decal(bvh, 0.0, 1.185, 0.05, 0.03, "steel", "buckle")
    return m


def survival():
    """Helicopter travel: immersion suit and lifejacket, no helmet."""
    return {"colors": {"hips": SUIT, "thigh": SUIT, "shin": SUIT, "shoe": RUBBER},
            "hide": {"belly", "chest", "upper_arm", "forearm"},
            "parts": {"suit": survival_suit(), "lifejacket": lifejacket()},
            "rigid": {}}


OUTFITS = {"ppe": ppe, "ppe_deck": ppe_deck, "survival": survival}
