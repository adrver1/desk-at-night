"""
Shared everyday clothing, built from the base body's rings so it fits
every character. Shirts mostly recolour the body (see TOPS); the parts
here add the silhouette and the details: collars, plackets, sleeves,
sweater and blazer shells, a belt, a watch.
"""
import math

import base_body as base

Vector = base.Vector


def _arm_radius(t):
    a = base.ARM
    for (t0, u0, v0, _, _), (t1, u1, v1, _, _) in zip(a, a[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0)
            return u0 + (u1 - u0) * f, v0 + (v1 - v0) * f
    return a[-1][1], a[-1][2]


def _both_arms(right):
    return right.extend(right.mirrored())


def torso_shell(color, hem=0.86, offset=0.018, flare=0.008, bands=(), region="shell"):
    """A shell over the torso from the hem up, closed over the shoulders.
    bands: (z0, z1, swatch) stripes, such as a ribbed hem."""
    zs = sorted({hem, 0.94, 1.0, 1.18, 1.35, base.TORSO[-1][0]} | {z for b in bands for z in b[:2]})
    zs = [z for z in zs if z >= hem]
    rings = []
    for z in zs:
        ru, rv, dv = base.ring_at(base.TORSO, z)
        reg = region
        for z0, z1, sw in bands:
            if z0 <= z < z1:
                reg = sw
        rings.append([z, ru, rv, dv, reg])
    rings[0][1] += flare
    rings[0][2] += flare
    colors = {region: color, **{sw: sw for _, _, sw in bands}}
    return base.Mesh().tube([tuple(r) for r in rings], colors=colors, offset=offset, cap_start=False)


def sleeves(color, length=0.47, offset=0.012, cuff=None, region="sleeve"):
    """Sleeves on both arms from the shoulder to `length` along the arm
    (0.47 is the wrist, about 0.2 a short sleeve), with an optional cuff
    band in another colour."""
    ts = [t for t, *_ in base.ARM if t < length - 0.03] + [length - 0.03, length]
    rings = []
    for t in ts:
        ru, rv = _arm_radius(t)
        reg = "cuff" if cuff and t >= length - 0.03 else region
        rings.append((t, ru, rv, 0.0, reg))
    # the sleeve's last ring flares a little past the arm
    t, ru, rv, d, reg = rings[-1]
    rings[-1] = (t, ru + 0.006, rv + 0.006, d, reg)
    right = base.Mesh().tube(rings, origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)),
                             angles=base.HEX6, angle_offset=30, offset=offset,
                             colors={region: color, "cuff": cuff or color}, cap_start=False, cap_end=False)
    return _both_arms(right)


def shirt_collar(color, region="collar", spread=1.0, under=False):
    """Open shirt collar: a band round the back of the neck and two points
    lying on the chest. under=True: short points that show just above a
    sweater's neck."""
    m = base.Mesh()
    band = []
    for a in range(200, 341, 35):
        a = math.radians(a)
        for r, z in ((0.068, 1.395), (0.072, 1.465), (0.078, 1.40)):
            band.append(Vector((r * math.cos(a), -0.008 + r * math.sin(a), z)))
    m.hull(band, color, region)
    for s in (1, -1):
        k = spread
        if under:
            m.hull([Vector((s * 0.07, -0.02, 1.462)), Vector((s * 0.075, 0.01, 1.457)),
                    Vector((s * 0.062, 0.06, 1.432)), Vector((s * 0.03 * k, 0.098, 1.405)),
                    Vector((s * 0.085, 0.075, 1.418)), Vector((s * 0.09, -0.02, 1.43))], color, region)
            continue
        flap = [Vector((s * 0.07, -0.02, 1.46)), Vector((s * 0.075, 0.01, 1.455)),
                Vector((s * 0.06, 0.06, 1.42)), Vector((s * 0.035 * k, 0.105, 1.355)),
                Vector((s * 0.105, 0.07, 1.375)), Vector((s * 0.09, -0.02, 1.40)),
                Vector((s * 0.06, 0.075, 1.40))]
        m.hull(flap, color, region)
    return m


def polo_collar(color, region="collar"):
    """Soft polo collar: a low band and two short rounded points."""
    m = base.Mesh()
    band = []
    for a in range(200, 341, 35):
        a = math.radians(a)
        for r, z in ((0.068, 1.40), (0.071, 1.45), (0.078, 1.405)):
            band.append(Vector((r * math.cos(a), -0.008 + r * math.sin(a), z)))
    m.hull(band, color, region)
    for s in (1, -1):
        m.hull([Vector((s * 0.07, -0.01, 1.448)), Vector((s * 0.068, 0.04, 1.43)), Vector((s * 0.03, 0.098, 1.395)),
                Vector((s * 0.075, 0.075, 1.385)), Vector((s * 0.095, 0.02, 1.405)), Vector((s * 0.05, 0.08, 1.41))],
               color, region)
    return m


def neck_band(color, z0=1.405, z1=1.44, region="neckband"):
    """Crew neck: a ring round the base of the neck."""
    return base.Mesh().tube([(z0, 0.084, 0.080, -0.008, region), (z1, 0.074, 0.070, -0.006, region)],
                            swatch=color, angles=base.HEX6, angle_offset=30, cap_start=False, cap_end=False)


def stand_collar(color, region="neckband"):
    """Zip-neck stand collar, up the neck."""
    return base.Mesh().tube([(1.40, 0.088, 0.084, -0.008, region), (1.47, 0.076, 0.072, -0.006, region)],
                            swatch=color, angles=base.HEX6, angle_offset=30, cap_start=False, cap_end=False)


def placket(surface, color, z0, z1, buttons=None, n=0, width=0.016, region="placket"):
    """A strip down the front of `surface` (a Mesh) from z0 to z1, with n
    buttons in another colour."""
    m = base.Mesh()
    bvh = surface.bvh()
    m.decal(bvh, 0, (z0 + z1) / 2, width, z1 - z0, color, region)
    for k in range(n):
        z = z1 - (k + 0.5) * (z1 - z0) / n
        m.decal(bvh, 0, z, 0.009, 0.009, buttons, "button", lift=0.003)
    return m


def zip_line(surface, color, z0, z1, region="zip", width=0.006):
    """A thin zip down the front, in steps so it follows the curve."""
    n = max(2, int((z1 - z0) / 0.04))
    zs = [z0 + (z1 - z0) * k / n for k in range(n + 1)]
    return base.Mesh().decal_band(surface.bvh(), zs, lambda z: -width / 2, lambda z: width / 2, color, region)


def belt(color="charcoal", buckle="steel", region="belt"):
    m = base.Mesh().tube([(0.955, 0.162, 0.102, 0.0, region), (1.005, 0.162, 0.102, 0.0, region)],
                         swatch=color, cap_start=False, cap_end=False, offset=0.008)
    ru, rv, dv = base.ring_at(base.TORSO, 0.98)
    y = dv + rv * math.sin(math.radians(55)) + 0.008
    m.hull([Vector((x, y + dy, 0.98 + z)) for x in (-0.025, 0.025) for dy in (0.0, 0.012) for z in (-0.02, 0.02)],
           buckle, "buckle")
    return m


def _lerp_table(table, z):
    for (z0, x0), (z1, x1) in zip(table, table[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return table[0][1] if z < table[0][0] else table[-1][1]


# Blazer front, as (z, x) along the edges: the V of shirt, and the outer
# edge of the lapel with its notch below the collar
V_EDGE = [(1.13, 0.0), (1.40, 0.072)]
LAPEL_EDGE = [(1.13, 0.008), (1.19, 0.065), (1.31, 0.122), (1.325, 0.10), (1.40, 0.112)]


def blazer(color, lapel, shirt, buttons="charcoal"):
    """Open blazer: a shell to the hips and full sleeves, with a V of
    shirt showing down the front between two notched lapels."""
    m = torso_shell(color, hem=0.80, offset=0.024, flare=0.012, region="blazer")
    bvh = m.bvh()
    zs = [1.13 + k * 0.03 for k in range(10)]
    m.decal_band(bvh, zs, lambda z: -_lerp_table(V_EDGE, z), lambda z: _lerp_table(V_EDGE, z), shirt, "shirt_v")
    for s in (1, -1):
        m.decal_band(bvh, zs, lambda z, s=s: s * _lerp_table(V_EDGE, z), lambda z, s=s: s * _lerp_table(LAPEL_EDGE, z),
                     lapel, "lapel", lift=0.004)
    m.decal(bvh, 0.0, 1.085, 0.012, 0.012, buttons, "button", lift=0.004)
    return m.extend(sleeves(color, offset=0.018, region="blazer_sleeve"))


V_NECK = [(1.25, 0.0), (1.42, 0.07)]


def sweater(color, rib=None, neck="crew", sleeve_cuff=None, shirt="white"):
    """Knit sweater over a shirt: a shell to the hips with a ribbed hem,
    full sleeves with ribbed cuffs, and a crew, zip or V neck (with the
    shirt showing in the V)."""
    rib = rib or color
    m = torso_shell(color, hem=0.90, offset=0.016, flare=0.004, bands=((0.90, 0.94, rib),) if rib != color else (),
                    region="sweater")
    if neck == "v":
        bvh = m.bvh()
        zs = [1.25 + k * 0.034 for k in range(6)]
        m.decal_band(bvh, zs, lambda z: -_lerp_table(V_NECK, z), lambda z: _lerp_table(V_NECK, z), shirt, "shirt_v")
        for s in (1, -1):
            m.decal_band(bvh, zs, lambda z, s=s: s * _lerp_table(V_NECK, z),
                         lambda z, s=s: s * (_lerp_table(V_NECK, z) + 0.014), rib, "neckband", lift=0.004)
    m.extend(sleeves(color, offset=0.012, cuff=sleeve_cuff or rib, region="sweater_sleeve"))
    if neck == "crew":
        m.extend(neck_band(rib))
    elif neck == "zip":
        m.extend(stand_collar(rib))
    return m


def shirt_cuffs(color, region="shirt_cuff"):
    """Shirt cuffs showing past a jacket sleeve."""
    right = base.Mesh().tube([(0.455, 0.044, 0.047, 0, region), (0.49, 0.042, 0.045, 0, region)],
                             origin=base.SHOULDER, axes=base.frame(base.arm_dir(1)), angles=base.HEX6,
                             angle_offset=30, swatch=color, cap_start=False, cap_end=False, offset=0.012)
    return _both_arms(right)


def zip_jacket(color, hem_color, zip_color="charcoal"):
    """Casual zip jacket to the hips: a banded hem and cuffs, a stand
    collar and a zip down the front."""
    m = torso_shell(color, hem=0.86, offset=0.026, flare=0.006, bands=((0.86, 0.91, hem_color),), region="jacket")
    m.extend(sleeves(color, offset=0.02, cuff=hem_color, region="jacket_sleeve"))
    collar = base.Mesh().tube([(1.40, 0.094, 0.090, -0.008, "neckband"), (1.475, 0.082, 0.078, -0.006, "neckband")],
                              swatch=color, angles=base.HEX6, angle_offset=30, cap_start=False, cap_end=False)
    m.extend(collar)
    m.extend(zip_line(m, zip_color, 0.88, 1.47))
    return m


def watch(strap, face, side=-1, region="watch"):
    """A chunky watch on one wrist (side -1 is the character's left)."""
    right = base.Mesh()
    axes = base.frame(base.arm_dir(1))
    right.tube([(0.425, 0.046, 0.049, 0, region), (0.455, 0.045, 0.048, 0, region)], origin=base.SHOULDER,
               axes=axes, angles=base.HEX6, angle_offset=30, swatch=strap, cap_start=False, cap_end=False,
               offset=0.006)
    u, v, w = axes
    c = base.SHOULDER + w * 0.44 + u * 0.052
    right.hull([c + u * du + v * dv + w * dw for du in (0.0, 0.012) for dv in (-0.018, 0.018) for dw in (-0.018, 0.018)],
               face, region)
    return right if side == 1 else right.mirrored()
