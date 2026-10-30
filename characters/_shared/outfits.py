"""
Shared outfits: clothing any character can wear over the base body, built
from the base body's own rings so every shell fits every character.

An outfit is a dict:

    colors  base body regions to recolour (trousers, gloves, boots)
    hide    base body regions the outfit covers completely (dropped after
            skinning, to stay in the triangle budget)
    parts   {name: Mesh} shells and accessories
    rigid   {region: bone} parts that follow one bone (helmets)

Offshore PPE follows the operator crew's two-tone hi-vis: a yellow jacket
with a navy collar, navy lower sleeves and cuffs, a reflective band round
the waist, the sleeves and the shins, reflective patches on the shoulders,
the company's wave logo big on the back and small on the chest pocket,
navy trousers and black safety boots. Out on deck add a white helmet with
the logo sticker, blue ear defenders, safety glasses and gloves.

For the helicopter ride out, `survival` is a North Sea immersion suit: an
orange one-piece with black neoprene neck and wrist seals, the hood rolled
up behind the neck, reflective tape on the shoulders and arms, integral
boots, a yellow lifejacket vest over the chest with a black waist strap, and
headband ear defenders.

Helicopter pilots wear their own kit (`FLIGHT_OUTFITS`, not part of the
crew's outfits): a navy one-piece flight suit with captain's epaulettes,
and either a white flight helmet with the visor up and a boom mic, or an
over-ear headset with a boom mic. Plain colours, no operator's logo.
"""
import json
import math
import os

import base_body as base

Vector = base.Vector

HIVIS, NAVY, TAPE = "hivis_yellow", "coverall_navy", "reflective"
HELMET, RUBBER, CUP, GLOVE = "helmet_white", "rubber", "helmet_blue", "grey"
FRAME, SHIELD, CLIP = "glass", "glass_clear", "plastic_black"

# The company logo: three wave bands (sky, teal, navy), the made-up operator
# "Nordhav Energi" of the public build, as (swatch, outline) in a unit box
# seen from the front: u from left to right, v from bottom to top. The real
# company's logo is private: point CREW_LOGO at a JSON file of the same
# [[swatch, [[u, v], ...]], ...] to build the private looks with it.
LOGO = [("logo_sky", [(0.0, 0.94), (0.17, 0.99), (0.33, 0.99), (0.5, 0.94), (0.67, 0.89), (0.83, 0.89), (1.0, 0.94),
                      (1.0, 0.72), (0.83, 0.67), (0.67, 0.67), (0.5, 0.72), (0.33, 0.77), (0.17, 0.77), (0.0, 0.72)]),
        ("logo_teal", [(0.0, 0.61), (0.17, 0.66), (0.33, 0.66), (0.5, 0.61), (0.67, 0.56), (0.83, 0.56), (1.0, 0.61),
                       (1.0, 0.39), (0.83, 0.34), (0.67, 0.34), (0.5, 0.39), (0.33, 0.44), (0.17, 0.44), (0.0, 0.39)]),
        ("logo_navy", [(0.0, 0.28), (0.17, 0.33), (0.33, 0.33), (0.5, 0.28), (0.67, 0.23), (0.83, 0.23), (1.0, 0.28),
                       (1.0, 0.06), (0.83, 0.01), (0.67, 0.01), (0.5, 0.06), (0.33, 0.11), (0.17, 0.11), (0.0, 0.06)])]
if os.environ.get("CREW_LOGO"):
    with open(os.environ["CREW_LOGO"]) as f:
        LOGO = [(sw, [tuple(p) for p in pts]) for sw, pts in json.load(f)]


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
    k = base.ring_at(base.TORSO, 1.35)[0] / 0.200   # narrower shoulders (slim figure) move them in
    for s in (1, -1):
        m.decal_poly(bvh, [(s * 0.105 * k, 1.31), (s * 0.16 * k, 1.31), (s * 0.16 * k, 1.37), (s * 0.105 * k, 1.37)],
                     TAPE, "band", facing=-1)
    return m


def sleeves():
    """Hi-vis upper sleeves and navy forearms, each with a reflective band."""
    # the band ring at 0.10 takes over from the arm's 0.06 ring
    pts = sorted({r[0] for r in base.ARM if r[0] != 0.06} | {0.10, 0.14, 0.34, 0.38})
    rings = []
    for t in pts:
        reg = "band" if t in (0.10, 0.34) else "cuff" if t >= 0.25 else "sleeve"
        ru, rv = _arm_radius(t)
        rings.append((t, ru, rv, 0.0, reg))
    right = base.Mesh().tube(rings, origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)),
                             angles=base.HEX6, angle_offset=30, offset=SLEEVE_OFF,
                             colors={"sleeve": HIVIS, "band": TAPE, "cuff": NAVY},
                             cap_start=True, cap_end=False)
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
    right.tube(base.legs_k([(0.30, 0.068, 0.072, -0.004, "band"), (0.345, 0.067, 0.071, -0.003, "band")]),
               origin=(x, 0, 0), swatch=TAPE, angles=base.HEX6, angle_offset=30, offset=0.006,
               cap_start=False, cap_end=False)
    right.tube(base.legs_k([(0.07, 0.058, 0.064, 0.005, "boot"), (0.17, 0.056, 0.060, 0.0, "boot")]),
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


CUP_X, CUP_Y, CUP_Z = 0.110, -0.012, 1.594   # ear defender cup: inner face, centre over the ear


def _cup(m, s, shell=CUP):
    """Black cushion against the head and the blue shell outside it: one
    oval hexagonal tube, open where it meets the head, capped outside."""
    # a right-handed frame on either side, so the faces point outward;
    # the oval is 0.054 front to back and 0.068 tall
    if s > 0:
        axes, ru, rv = (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))), 0.054, 0.068
    else:
        axes, ru, rv = (Vector((0, 0, 1)), Vector((0, 1, 0)), Vector((-1, 0, 0))), 0.068, 0.054
    # the cushion starts just inside the head's facets, so no gap shows
    # the ear (which the outfits hide anyway) between head and cup
    sub = base.Mesh().tube([(CUP_X, ru, rv, 0, "cushion"), (CUP_X + 0.02, ru, rv, 0, "shell"),
                            (CUP_X + 0.054, ru * 0.82, rv * 0.82, 0, "shell")],
                           origin=(0, CUP_Y, CUP_Z), axes=axes, angles=base.HEX6,
                           colors={"cushion": RUBBER, "shell": shell}, cap_start=False)
    for ids, sw, _ in sub.faces:
        m.face([sub.verts[i] for i in ids], sw, "ear_cup")


def ear_muffs(shell=CUP, region="ear_cup"):
    """Headband ear defenders, as worn by helicopter passengers: the same
    blue cups as the helmet's, on a black band over the head."""
    import accessories
    m = base.Mesh()
    for s in (1, -1):
        _cup(m, s, shell)
    m.faces = [(ids, sw, region) for ids, sw, _ in m.faces]
    return accessories.headband(m, CLIP, region, clear=0.022, cy=CUP_Y, end=(CUP_X + 0.040, 1.650),
                                width=0.013, thick=0.008)


def ear_defender(m, s):
    """Helmet-mounted ear defender on side s: a black clip plugged into the
    slot on the helmet's side, an arm down from it, a wire yoke round the
    cup's front and back, and the blue cup on a black cushion over the ear."""
    cy, cz = CUP_Y, CUP_Z
    _cup(m, s)
    # Clip in the helmet's side slot, just above the rim
    m.hull([Vector((s * x, cy + dy, z)) for x in (0.146, 0.172) for dy in (-0.016, 0.016)
            for z in (1.664, 1.692)], CLIP, "ear_cup")
    # Arm from the clip down past the rim to the top of the yoke
    top = (s * (CUP_X + 0.054), cy, 1.660)
    m.bar((s * 0.176, cy, 1.676), top, 0.006, CLIP, "ear_cup")
    # Yoke: two wires from the arm down to the cup's front and back
    for dy in (0.058, -0.058):
        m.bar(top, (s * (CUP_X + 0.040), cy + dy * 0.84, cz), 0.0035, CLIP, "ear_cup")


def glasses():
    """Wraparound safety glasses, drawn as their frame only so the eyes show:
    a brow bar curving round the face, a thin lower rim under each lens, a
    nose bridge, clear side shields at the temples and arms to the ears."""
    m = base.Mesh()
    off = 0.014
    top0, top1 = 1.634, 1.645       # brow bar
    # The brow bar follows the face from temple to temple
    angles = (36, 63, 90, 117, 144)
    # bars are bent bands open on the side that faces the skin

    def section(a, z0, z1, d0=-0.003, d1=0.003):
        return [base.head_point(a, z0, off + d0), base.head_point(a, z0, off + d1),
                base.head_point(a, z1, off + d1), base.head_point(a, z1, off + d0)]
    m.loft([section(a, top0, top1) for a in angles], FRAME, "glasses", closed=False)
    for s in (1, -1):
        def ang(a):
            return a if s == 1 else 180 - a
        # Lower rim: from the bridge it dips under the eye and climbs to the shield
        rim = ((84, 1.606), (66, 1.593), (44, 1.604))
        m.loft([section(ang(a), z, z + 0.005, d1=0.002) for a, z in rim], FRAME, "glasses", closed=False)
        # Nose pad: from the brow bar down to the rim beside the nose
        m.loft([[base.head_point(ang(a), z, off + d) for a, d in ((84, -0.003), (84, 0.002), (89, 0.002), (89, -0.003))]
                for z in (1.606, top0)], FRAME, "glasses", closed=False, caps=False)
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
    o["hide"] = o["hide"] | {"ear"}   # under the ear cups: never seen
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
    pts = sorted({r[0] for r in base.ARM if r[0] != 0.06} | {0.07, 0.11, 0.42, 0.45})
    arm = []
    for t in pts:
        reg = "band" if t == 0.07 else "seal" if t >= 0.42 else "sleeve"
        ru, rv = _arm_radius(t)
        arm.append((t, ru, rv, 0.0, reg))
    right = base.Mesh().tube(arm, origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)),
                             angles=base.HEX6, angle_offset=30, offset=0.016,
                             colors={"sleeve": SUIT, "band": TAPE, "seal": SEAL},
                             cap_start=True, cap_end=False)
    x = base.LEG_X
    right.tube(base.legs_k([(0.30, 0.068, 0.072, -0.004, "band"), (0.345, 0.067, 0.071, -0.003, "band")]),
               origin=(x, 0, 0), swatch=TAPE, angles=base.HEX6, angle_offset=30, offset=0.008,
               cap_start=False, cap_end=False)
    right.tube(base.legs_k([(0.07, 0.058, 0.064, 0.005, "boot"), (0.19, 0.057, 0.061, 0.0, "boot")]),
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
    """Helicopter travel: immersion suit, lifejacket and headband ear
    defenders (always on in the helicopter), no helmet."""
    return {"colors": {"hips": SUIT, "thigh": SUIT, "shin": SUIT, "shoe": RUBBER},
            "hide": {"belly", "chest", "upper_arm", "forearm", "ear"},   # ears under the cups
            "parts": {"suit": survival_suit(), "lifejacket": lifejacket(), "ear_muffs": ear_muffs()},
            "rigid": {"ear_cup": "head"}}


OUTFITS = {"ppe": ppe, "ppe_deck": ppe_deck, "survival": survival}


FLIGHT, FLIGHT_TRIM, STRIPE = "coverall_navy", "black", "gold"


def flight_suit():
    """Pilot's one-piece flight suit: a navy torso and full sleeves with
    black wrist cuffs, a stand collar, a zip up the front, gold wings over a
    name tag on the left chest, a zipped pocket on the right and epaulettes
    with four gold stripes. The legs are the body's own, recoloured."""
    import clothes
    rings = []
    for z in (HEM, 0.94, 1.18, 1.35, base.TORSO[-1][0]):
        ru, rv, dv = base.ring_at(base.TORSO, z)
        rings.append((z, ru, rv, dv, "suit"))
    m = base.Mesh().tube(rings, swatch=FLIGHT, offset=0.018, cap_start=False)
    bvh = m.bvh()
    m.extend(clothes.zip_line(m, FLIGHT_TRIM, 0.90, 1.40))
    # wings over the name tag on his left, a pocket zip on his right
    m.decal_poly(bvh, [(-0.050, 1.300), (-0.098, 1.292), (-0.146, 1.300), (-0.098, 1.278)], STRIPE, "badge")
    m.decal(bvh, -0.098, 1.258, 0.066, 0.022, FLIGHT_TRIM, "badge")
    m.decal(bvh, 0.098, 1.288, 0.070, 0.006, FLIGHT_TRIM, "pocket")
    m.extend(clothes.stand_collar(FLIGHT, region="suit_collar"))
    pts = sorted({r[0] for r in base.ARM if r[0] != 0.06} | {0.44})
    arm = []
    for t in pts:
        ru, rv = _arm_radius(t)
        arm.append((t, ru, rv, 0.0, "cuff" if t >= 0.44 else "sleeve"))
    right = base.Mesh().tube(arm, origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)),
                             angles=base.HEX6, angle_offset=30, offset=0.014,
                             colors={"sleeve": FLIGHT, "cuff": FLIGHT_TRIM}, cap_start=True, cap_end=False)
    # epaulettes lie on the shoulder seam, over the sleeve's top
    top = base.Mesh().extend(m).extend(right).extend(right.mirrored()).bvh()
    for s in (1, -1):
        epaulette(m, top, s)
    # thigh pockets: flat black flaps on the front of each leg (the leg
    # rings run top down, so reverse them for outward faces)
    leg = base.Mesh().tube(base.LEG[::-1], origin=(base.LEG_X, 0, 0), angles=base.HEX6, angle_offset=30, swatch=FLIGHT)
    right.decal(leg.bvh(), base.LEG_X + 0.02, 0.66, 0.075, 0.012, FLIGHT_TRIM, "pocket", lift=0.003)
    right.tube(base.legs_k([(0.07, 0.058, 0.064, 0.005, "boot"), (0.17, 0.056, 0.060, 0.0, "boot")]),
               origin=(base.LEG_X, 0, 0), swatch=RUBBER, angles=base.HEX6, angle_offset=30, offset=0.008,
               cap_start=False, cap_end=False)
    return m.extend(right).extend(right.mirrored())


def epaulette(m, bvh, s):
    """A black shoulder board on side s from the collar to the shoulder,
    lying on the suit, with four gold stripes at the shoulder end."""
    top = {}
    for x in (0.105, 0.175):
        for y in (-0.024, 0.020):
            hit, n, _, _ = bvh.ray_cast(Vector((s * x, y, 2.0)), Vector((0, 0, -1)))
            top[x, y] = (hit, n)
    pts = [h + n * k for h, n in top.values() for k in (0.001, 0.006)]
    m.hull(pts, FLIGHT_TRIM, "badge")
    (a0, na), (a1, _), (b0, _), (b1, _) = (top[0.105, -0.024], top[0.105, 0.020],
                                           top[0.175, -0.024], top[0.175, 0.020])
    lift = na * 0.0068
    for k in range(4):
        f0, f1 = 0.52 + k * 0.115, 0.52 + k * 0.115 + 0.07
        q = [a0.lerp(b0, f0), a0.lerp(b0, f1), a1.lerp(b1, f1), a1.lerp(b1, f0)]
        q = [p + lift for p in q]
        if (q[1] - q[0]).cross(q[2] - q[0]).z < 0:
            q = q[::-1]
        m.face(q, STRIPE, "badge")


# Flight helmet rim height by ring angle (90 is the front): above the brows
# at the front, down over the ears at the sides, to the nape at the back.
HELMET_RIM = {0: 1.548, 30: 1.625, 60: 1.668, 90: 1.676, 120: 1.668, 150: 1.625,
              180: 1.548, 210: 1.556, 240: 1.570, 270: 1.575, 300: 1.570, 330: 1.556}


def flight_helmet():
    """White flight helmet: a smooth twelve-sided shell over the ears with a
    black edge trim, round ear covers, a dark visor raised over the brow and
    a boom mic to the mouth."""
    m = base.Mesh()
    angles = sorted(HELMET_RIM)

    def ring(f, off, lift=0.0):
        return [base.head_point(a, z + (1.74 - z) * f, off) + Vector((0, 0, lift))
                for a, z in ((a, HELMET_RIM[a]) for a in angles)]
    rows = [ring(0.0, 0.028), ring(0.06, 0.031), ring(0.45, 0.034), ring(1.0, 0.030, 0.012)]
    crown = [base.head_point(a, 1.75, 0.0) + Vector((0, 0, 0.046)) for a in angles]
    m.loft(rows[:2], FLIGHT_TRIM, "helmet", caps=False)
    m.loft(rows[1:] + [crown], HELMET, "helmet", caps=False)
    m.face(crown, HELMET, "helmet")
    for s in (1, -1):
        # ear cover: a flat hexagonal dome on the side of the shell
        x0 = base.head_point(0, CUP_Z, 0.034).x
        pts = []
        for x, r in ((x0, 0.046), (x0 + 0.016, 0.036)):
            for i in range(6):
                a = math.radians(30 + 60 * i)
                pts.append(Vector((s * x, CUP_Y + r * math.cos(a), CUP_Z - 0.006 + r * math.sin(a))))
        m.hull(pts, HELMET, "helmet")
    # visor raised over the front, a tinted band clear of the shell
    secs = []
    for a in (38, 64, 90, 116, 142):
        secs.append([base.head_point(a, z, off) + Vector((0, 0, dz))
                     for z, off, dz in ((1.690, 0.037, 0.0), (1.690, 0.044, 0.0), (1.735, 0.044, 0.012), (1.735, 0.037, 0.012))])
    m.loft(secs, "lens", "visor")
    for s in (1, -1):
        p = base.head_point(90 - s * 54, 1.712, 0.040)
        m.hull([p + Vector((dx, dy, dz)) for dx in (-0.006, 0.006) for dy in (-0.008, 0.008) for dz in (-0.008, 0.008)],
               FLIGHT_TRIM, "visor")
    boom_mic(m, x0 + 0.010)
    return m


def boom_mic(m, x, side=-1):
    """Boom mic from the ear on his left (side -1) round to the mouth."""
    ear = (side * x, CUP_Y + 0.030, CUP_Z - 0.020)
    bend = (side * 0.112, 0.098, 1.540)
    tip = (side * 0.032, 0.136, 1.528)
    m.bar(ear, bend, 0.0035, CLIP, "mic")
    m.bar(bend, tip, 0.0035, CLIP, "mic")
    m.hull([Vector(tip) + Vector((dx, dy, dz)) for dx in (-0.012, 0.004) for dy in (-0.006, 0.006)
            for dz in (-0.007, 0.007)], CLIP, "mic")
    return m


def flying():
    """Flying: flight suit and white flight helmet, visor up, boom mic."""
    return {"colors": {"hips": FLIGHT, "thigh": FLIGHT, "shin": FLIGHT, "shoe": RUBBER},
            "hide": {"belly", "chest", "upper_arm", "forearm", "ear"},
            "parts": {"suit": flight_suit(), "helmet": flight_helmet()},
            "rigid": {"helmet": "head", "visor": "head", "mic": "head"},
            "bald": True}   # the shell reaches the nape: no hair shows


def flying_headset():
    """Flying: flight suit and an aviation headset with big olive
    ear-defender cups over the ears and a boom mic."""
    o = flying()
    del o["parts"]["helmet"], o["bald"]
    o["parts"]["headset"] = boom_mic(ear_muffs("olive", "headset"), CUP_X + 0.030)
    return o


def flying_headset_small():
    """Flying: flight suit and a lighter olive over-ear headset with a boom
    mic (an earlier pick, kept in the library)."""
    import accessories
    o = flying()
    del o["parts"]["helmet"], o["bald"]
    o["parts"]["headset"] = boom_mic(accessories.headset("olive", clear=0.018), 0.160)
    o["hide"] = o["hide"] - {"ear"}
    return o


def flight_suit_only():
    """Flight suit, no helmet: walking out to the helicopter."""
    o = flying()
    del o["parts"]["helmet"], o["bald"]
    o["hide"] = o["hide"] - {"ear"}
    return o


FLIGHT_OUTFITS = {"flying": flying, "flying_headset": flying_headset}
