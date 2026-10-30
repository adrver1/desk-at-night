"""
Live desk phones for story mode: a base that stays on the desk and a handset
the operator picks up, joined in the browser by a live coiled cord
(web/src/coilCord.js). Three looks are kept side by side in STYLES (the asset
library):

    office      today's IP phone: a wedge with a screen and keypad, the
                handset in a cradle along its left edge (default, matches
                the baked room phone of props.make_deskphone)
    rotary      a 1950s black bakelite phone: a rounded hump, a dial on the
                front slope, the handset across two cradle horns
    pushbutton  a 1980s cream phone: a low wedge, twelve keys on the slope,
                the handset in a trough across the top

STYLE is the one the story uses; every style is written so the others stay
one setting away.

    python blender/desk_phone.py                 # all styles
    python blender/desk_phone.py --style rotary  # one

Each style goes to web/public/story/props/desk_phone_<style>.glb with these
nodes (three.js names; Blender's +Z up becomes +Y, its -Y, the operator's
side, becomes +Z):

    DeskPhone   the base, origin on the desk top at the phone's middle
    Handset     the handset at rest in its cradle, a sibling of DeskPhone
                (so it can be handed to a bone); origin at its middle, its
                long axis along local +X (the earpiece end), the ear and
                mouth cups facing local -Y in three.js
    CordSocket  child of DeskPhone: where the cord leaves the base
    CordPlug    child of Handset: where the cord enters the mouthpiece end

DeskPhone carries the cord's colour (extras cordColor) and Handset how far
its earpiece cup sits from its middle (extras earOffset, metres), for
holding it to an ear.

Handsets are a touch bigger than life (HANDSET_SCALE), which reads better
on the low-poly cast. No textures; one material per colour.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import props  # noqa: E402

bpy = b.bpy
Vector, Matrix = b.Vector, b.Matrix
_rot = props._rot

STYLES = ("office", "rotary", "pushbutton")
STYLE = "office"
HANDSET_SCALE = 1.2
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "story", "props")

# colours per style: body, trim (dial, keys), the cord (drawn in the browser)
LOOKS = {
    "office": {"body": (0.016, 0.018, 0.020), "trim": (0.27, 0.29, 0.31), "cord": "#1c1e20"},
    "rotary": {"body": (0.008, 0.009, 0.010), "trim": (0.80, 0.77, 0.70), "cord": "#17181a"},
    "pushbutton": {"body": (0.69, 0.61, 0.44), "trim": (0.26, 0.20, 0.11), "cord": "#cbbd9e"},
}


def materials(style):
    look = LOOKS[style]
    gloss = 0.3 if style == "rotary" else 0.55
    return {
        "body": b.mat_flat(f"Phone_{style}_body", look["body"], gloss),
        "trim": b.mat_flat(f"Phone_{style}_trim", look["trim"], 0.5),
        "dark": b.mat_flat(f"Phone_{style}_dark", (0.004, 0.004, 0.005), 0.7),
        "screen": b.mat_flat(f"Phone_{style}_screen", (0.06, 0.12, 0.17), 0.2),
    }


def frustum(p, w, d, h, top, at, mat, radius=0.006):
    """A rounded box w x d x h standing on `at`, narrowing to `top` x its
    footprint at the top."""
    def bend(v):
        k = 1.0 - (1.0 - top) * (v.z / h + 0.5)
        return Vector((v.x * k, v.y * k, v.z))
    p.rbox((w, d, h), at + Vector((0, 0, h / 2)), mat, radius, segs=2, bend=bend)


def handset(m, length, cup, bar, mouth_drop=0.0):
    """The handset at the origin, long axis +X (earpiece at +X), cups facing
    down (-Z), scaled by HANDSET_SCALE. Returns the mesh and the cord plug's
    place in the handset's frame."""
    s = HANDSET_SCALE
    h = props.Builder("Handset")
    handle = length - cup * 1.2
    # the handle bows up a little between the cups
    half = handle * s / 2
    bow = lambda v: Vector((v.x, v.y, v.z + 0.005 * s * (1 - (v.x / half) ** 2)))
    h.rbox((handle * s, bar * 1.25 * s, bar * s), Vector(), m["body"], 0.008 * s, segs=2, bend=bow)
    for sx in (1, -1):
        x = sx * (length / 2 - cup * 0.5) * s
        drop = (mouth_drop if sx < 0 else 0.0) * s
        h.cyl(cup * 0.5 * s, cup * 0.42 * s, cup * 0.6 * s, Vector((x, 0, -(cup * 0.25) * s - drop)), m["body"], segs=12,
              orient=_rot(x=math.pi))
        h.cyl(cup * 0.3 * s, cup * 0.3 * s, 0.002, Vector((x, 0, -(cup * 0.56) * s - drop)), m["dark"], segs=12)
    plug = Vector(((-length / 2 + cup * 0.15) * s, 0, -(cup * 0.45 + mouth_drop) * s))
    o = h.done()
    o["earOffset"] = round((length / 2 - cup * 0.5) * s, 4)   # glTF extras: middle to earpiece cup
    return o, plug


def build_office(m):
    """Like props.make_deskphone: a wedge rising away from the operator (at
    -Y), the face tilted back, a screen upper right, keypad lower right, the
    handset in a cradle along the left edge."""
    p = props.Builder("DeskPhone")
    w, d = 0.23, 0.19
    slope = math.radians(28)
    body = lambda v: v + Vector((0, 0, (v.y / d + 0.5) * 0.05))
    p.rbox((w, d, 0.03), Vector((0, 0, 0.015)), m["body"], 0.008, bend=body)
    tilt = _rot(x=slope)
    face = lambda u, v, lift=0.0: Vector((u, v * math.cos(slope), 0.032 + (v / d + 0.5) * 0.05 + lift))
    p.box((0.10, 0.006, 0.055), face(0.035, 0.045, 0.002), m["trim"], orient=tilt @ _rot(x=-math.pi / 2))
    p.box((0.092, 0.002, 0.047), face(0.035, 0.045, 0.005), m["screen"], orient=tilt @ _rot(x=-math.pi / 2))
    for i in range(4):
        p.box((0.014, 0.008, 0.004), face(-0.03, 0.068 - i * 0.015, 0.003), m["trim"], orient=tilt)
    for r in range(4):
        for c in range(3):
            p.rbox((0.017, 0.011, 0.005), face(0.012 + c * 0.023, -0.012 - r * 0.016, 0.003), m["trim"], 0.002,
                   segs=1, orient=tilt)
    # the cradle: a low trough along the left edge
    hx = -0.085
    p.rbox((0.06, 0.19, 0.012), Vector((hx, 0.0, 0.045)), m["body"], 0.004, segs=1, orient=tilt)
    hs, plug = handset(m, 0.19, 0.05, 0.026)
    # earpiece toward the back, lying in the cradle on the slope
    rest = Matrix.Translation((hx, 0.0, 0.082)) @ tilt @ _rot(z=math.pi / 2)
    return p.done(), hs, plug, rest, Vector((-0.11, -0.04, 0.012))


def build_rotary(m):
    """A rounded hump, the dial facing the operator on the front slope, two
    cradle horns on top holding the handset across."""
    p = props.Builder("DeskPhone")
    frustum(p, 0.20, 0.22, 0.075, 0.72, Vector((0, 0, 0)), m["body"], radius=0.012)
    p.rbox((0.15, 0.12, 0.03), Vector((0, 0.01, 0.085)), m["body"], 0.01, segs=2)
    # the dial, square to the front slope and just proud of it: a ring of ten
    # finger holes round a cream face, a finger stop
    a = math.atan2(0.92, 0.38)
    orient = _rot(x=a)        # local Z toward the operator (-Y) and up
    n = orient.to_3x3() @ Vector((0, 0, 1))
    u, v = Vector((1, 0, 0)), orient.to_3x3() @ Vector((0, 1, 0))
    centre = Vector((0, -0.0893, 0.05)) + n * 0.006
    p.cyl(0.042, 0.040, 0.008, centre, m["trim"], segs=24, orient=orient)
    for i in range(10):
        t = -0.9 + i * 0.47
        p.cyl(0.0065, 0.0065, 0.002, centre + (math.cos(t) * u + math.sin(t) * v) * 0.029 + n * 0.0045, m["dark"],
              segs=8, orient=orient)
    p.cyl(0.013, 0.013, 0.004, centre + n * 0.004, m["trim"], segs=16, orient=orient)
    p.box((0.004, 0.010, 0.006), centre + (math.cos(-1.4) * u + math.sin(-1.4) * v) * 0.040 + n * 0.006, m["dark"],
          orient=orient)   # finger stop
    for sx in (1, -1):
        p.rbox((0.022, 0.05, 0.035), Vector((sx * 0.06, 0.015, 0.112)), m["body"], 0.006, segs=1)
    hs, plug = handset(m, 0.22, 0.058, 0.026)
    rest = Matrix.Translation((0, 0.015, 0.158))
    return p.done(), hs, plug, rest, Vector((-0.09, 0.06, 0.012))


def build_pushbutton(m):
    """A low wedge, twelve keys on the front slope, the handset lying in a
    trough across the raised back."""
    p = props.Builder("DeskPhone")
    frustum(p, 0.19, 0.22, 0.06, 0.86, Vector((0, 0, 0)), m["body"], radius=0.008)
    p.rbox((0.17, 0.08, 0.035), Vector((0, 0.05, 0.07)), m["body"], 0.008, segs=2)
    tilt = _rot(x=0.30)
    pad = Vector((0, -0.045, 0.058))
    for r in range(4):
        for c in range(3):
            off = tilt.to_3x3() @ Vector(((c - 1) * 0.03, (1.5 - r) * 0.02, 0.003))
            p.rbox((0.022, 0.014, 0.006), pad + off, m["trim"], 0.002, segs=1, orient=tilt)
    hs, plug = handset(m, 0.21, 0.05, 0.03, mouth_drop=0.006)
    rest = Matrix.Translation((0, 0.05, 0.122))
    return p.done(), hs, plug, rest, Vector((-0.095, 0.03, 0.012))


BUILDERS = {"office": build_office, "rotary": build_rotary, "pushbutton": build_pushbutton}


def export(style):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    m = materials(style)
    base, hs, plug, rest, socket = BUILDERS[style](m)
    hs.matrix_world = rest
    for name, parent, at in (("CordSocket", base, socket), ("CordPlug", hs, plug)):
        e = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(e)
        e.parent = parent
        e.matrix_parent_inverse = Matrix()
        e.location = at
    base["cordColor"] = LOOKS[style]["cord"]   # glTF extras: the cord's colour
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"desk_phone_{style}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_yup=True, export_texcoords=False, export_normals=True,
                              export_extras=True)
    tris = sum(len(p.vertices) - 2 for o in (base, hs) for p in o.data.polygons)
    print(f"wrote {path} ({tris} tris)", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", choices=STYLES)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    for s in ([args.style] if args.style else STYLES):
        export(s)
