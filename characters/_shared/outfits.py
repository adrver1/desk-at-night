"""
Shared outfits: clothing any character can wear over the base body, built
from the base body's own rings so every shell fits every character.

An outfit is a dict:

    colors  base body regions to recolour (trousers, gloves, boots)
    hide    base body regions the outfit covers completely (dropped after
            skinning, to stay in the triangle budget)
    parts   {name: Mesh} shells and accessories
    rigid   {region: bone} parts that follow one bone (helmets)

Offshore PPE follows the two-tone hi-vis worn by the platform crew: a
yellow jacket with navy collar and cuffs, reflective bands round the chest,
waist, sleeves and shins, navy trousers and black safety boots. Out on
deck add a white helmet with ear defenders and gloves.
"""
import base_body as base

Vector = base.Vector

HIVIS, NAVY, TAPE = "hivis_yellow", "coverall_navy", "reflective"
HELMET, RUBBER, CUP, GLOVE = "helmet_white", "rubber", "plastic_black", "grey"

JACKET_OFF, SLEEVE_OFF = 0.022, 0.016
HEM = 0.86


def jacket():
    """Hi-vis jacket over the torso: hem at the hips, two reflective bands,
    closed at the neck where the collar sits."""
    rings = []
    for z, reg in ((HEM, "jacket"), (0.94, "band"), (0.985, "jacket"), (1.13, "band"),
                   (1.175, "jacket"), (1.35, "jacket"), (base.TORSO[-1][0], "jacket")):
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
    # A plain navy patch on the left chest
    bvh = m.bvh()
    m.decal(bvh, -0.10, 1.255, 0.075, 0.045, NAVY, "patch")
    return m


def sleeves():
    """Hi-vis sleeves with a band above and below the elbow and navy cuffs."""
    pts = sorted({r[0] for r in base.ARM} | {0.10, 0.14, 0.34, 0.38, 0.43})
    rings = []
    for t in pts:
        reg = "band" if t in (0.10, 0.34) else "cuff" if t >= 0.43 else "sleeve"
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
    ear defenders clipped under the rim at the sides."""
    rings = []
    for z, off in ((1.655, 0.034), (1.72, 0.032), (1.765, 0.03), (1.795, 0.0), (1.81, 0.0)):
        ru, rv, dv = base.ring_at(base.HEAD, min(z, base.HEAD[-1][0]))
        if z > 1.79:
            ru, rv = (0.085, 0.09) if z < 1.8 else (0.045, 0.05)
        rings.append((z, ru + off, rv + off, dv, "helmet"))
    m = base.Mesh().tube(rings, swatch=HELMET, cap_start=False)
    # the peak
    m.hull([Vector((x, y, z)) for x in (-0.085, 0.085) for y, z in ((0.10, 1.668), (0.185, 1.655), (0.10, 1.655))],
           HELMET, "helmet")
    for s in (1, -1):
        # cup over the ear, its top tucked under the helmet rim
        m.hull([Vector((s * (0.122 + dx), -0.012 + dy, 1.605 + dz))
                for dx in (0.0, 0.035) for dy in (-0.04, 0.035) for dz in (-0.045, 0.05)], CUP, "ear_cup")
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
    o["rigid"] = {"helmet": "head", "ear_cup": "head"}
    return o


OUTFITS = {"ppe": ppe, "ppe_deck": ppe_deck}
