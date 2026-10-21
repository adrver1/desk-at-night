"""
Shared facial hair and expressions. Facial hair is a thin shell on the
head's own flat facets (not the rounder ring ellipse), with a gap round
the mouth so the mouth decal shows.

    stubble(color)                shadow on the jaw, chin and upper lip
    beard(color)                  short full beard: thicker, a squarer chin
    goatee(color)                 chin and moustache only
    smile(body, teeth=True)       a wider open mouth with a row of teeth
"""
import math

import base_body as base

Vector = base.Vector
A = base.BOXY8

# Beard line: how high the facial hair reaches at each angle, from the
# sideburn (5) round the cheek to under the lower lip (90)
BEARD_LINE = {5: 1.615, 20: 1.585, 40: 1.552, 60: 1.522, 75: 1.512, 90: 1.508}
CHIN_Z = 1.468
MOUTH = (1.531, 1.551)              # moustache strip, above the mouth


def face_point(angle, z, offset=0.0):
    """Point on the head's flat facet at an angle and height: between the
    two ring corners either side of the angle, pushed out by offset."""
    a = angle % 360
    for a0, a1 in zip(A, A[1:] + (A[0] + 360,)):
        if a0 <= a < a1 or a0 <= a + 360 < a1:
            t = ((a - a0) % 360) / (a1 - a0)
            p0, p1 = base.head_point(a0, z), base.head_point(a1, z)
            p = p0.lerp(p1, t)
            n = Vector(((p1 - p0).y, -(p1 - p0).x, 0)).normalized()
            return p + n * offset
    return base.head_point(angle, z, offset)


def _line(angle, table=BEARD_LINE):
    a = angle if angle <= 90 else 180 - angle
    keys = sorted(table)
    for k0, k1 in zip(keys, keys[1:]):
        if k0 <= a <= k1:
            return table[k0] + (table[k1] - table[k0]) * (a - k0) / (k1 - k0)
    return table[keys[0]] if a < keys[0] else table[keys[-1]]


def _sheet(m, angles, top, bottom, offsets, color, region, rows=3):
    """Shell over the facets between a bottom and a top height per angle."""
    grid = []
    for k in range(rows):
        f = k / (rows - 1)
        grid.append([face_point(a, bottom(a) + (top(a) - bottom(a)) * f, offsets(a, f)) for a in angles])
    for k in range(rows - 1):
        for i in range(len(angles) - 1):
            m.face([grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]], color, region)
    return m


ANGLES = (5, 20, 40, 60, 75, 90, 105, 120, 140, 160, 175)


def stubble(color="stubble", moustache=True, offset=0.0035, region="stubble"):
    """A thin shadow on the jaw, chin and upper lip."""
    m = base.Mesh()
    _sheet(m, ANGLES, _line, lambda a: CHIN_Z, lambda a, f: offset, color, region)
    if moustache:
        _sheet(m, (62, 75, 90, 105, 118), lambda a: MOUTH[1] - abs(a - 90) * 0.0002, lambda a: MOUTH[0],
               lambda a, f: offset, color, region, rows=2)
    return m


def beard(color, moustache=True, offset=0.009, chin=0.022, region="beard"):
    """Short full beard: thicker towards the chin, which drops a little and
    squares off."""
    m = base.Mesh()

    def bottom(a):
        # the front of the chin drops below the jaw
        return CHIN_Z - chin * max(0.0, math.cos(math.radians(a - 90))) ** 2

    def off(a, f):
        front = max(0.0, math.cos(math.radians(a - 90)))
        return offset * (0.5 + 0.5 * front) * (1.0 - 0.6 * f) + 0.003
    _sheet(m, ANGLES, _line, bottom, off, color, region)
    # close the underside so the drop reads as a solid block from below
    under = [face_point(a, bottom(a), off(a, 0)) for a in ANGLES]
    inner = [Vector((p.x * 0.6, p.y * 0.55 + 0.01, CHIN_Z - 0.004)) for p in under]
    for i in range(len(ANGLES) - 1):
        m.face([inner[i], inner[i + 1], under[i + 1], under[i]], color, region)
    if moustache:
        _sheet(m, (60, 75, 90, 105, 120), lambda a: MOUTH[1] + 0.002, lambda a: MOUTH[0] - 0.002,
               lambda a, f: offset * 0.6 + 0.003, color, region, rows=2)
    return m


def goatee(color, offset=0.006, region="beard"):
    """Chin and moustache only, joined at the mouth corners."""
    m = base.Mesh()
    _sheet(m, (60, 75, 90, 105, 120), lambda a: 1.508 + abs(a - 90) * 0.0006, lambda a: CHIN_Z + 0.004,
           lambda a, f: offset, color, region)
    _sheet(m, (60, 75, 90, 105, 120), lambda a: MOUTH[1], lambda a: MOUTH[0], lambda a, f: offset, color, region,
           rows=2)
    return m


def smile(body, teeth=True, width=0.054):
    """A wide smile on top of the base mouth with the corners turned up:
    open, dark lips round a row of teeth, or closed (teeth=False)."""
    m = base.Mesh()
    bvh = body.bvh()
    lip = "lip_dark" if teeth else "lip"
    m.decal(bvh, 0, 1.521, width, 0.016 if teeth else 0.008, lip, "smile", lift=0.0025)
    if teeth:
        m.decal(bvh, 0, 1.524, width - 0.012, 0.007, "teeth", "smile", lift=0.0035)
    for s in (1, -1):
        m.decal(bvh, s * width * 0.5, 1.526, 0.010, 0.006, lip, "smile", tilt=s * 30, lift=0.0028)
    return m
