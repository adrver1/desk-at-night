"""Tiling facade textures for the lean Føniks export: slate roof tiles, brick, travertine
slabs and copper panels, drawn with PIL and mapped by world position, so a pattern
runs on across neighbouring faces and every wall of one material still exports as a
single mesh (no extra draw calls).

Styles (TRD_TEX): "lines" = flat colour with joint lines only, "varied" = lines plus a
little colour variation per brick, slab, panel and tile, "photo" = CC0 Poly Haven photo
textures (Rob Tuytel) for brick and slate, recoloured to the palette, with the "varied"
travertine and copper, "none" = untextured."""
import math
import os
import random

import bmesh
import bpy
from PIL import Image, ImageDraw, ImageFilter

PX = 256   # texture size; a repeat covers TILE metres


def _hex(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _jitter(rgb, rnd, amount):
    k = 1.0 + rnd.uniform(-amount, amount)
    return tuple(max(0, min(255, int(c * k))) for c in rgb)


def _courses(img, rows, cols, base, joint, jw, amount, rnd, offset=0.5):
    """Running bond: rows of units, every other row shifted by offset of a unit."""
    d = ImageDraw.Draw(img)
    w, h = img.size
    rh, cw = h / rows, w / cols
    for r in range(rows):
        sh = (r % 2) * offset * cw
        for c in range(-1, cols + 1):
            x0 = c * cw + sh
            d.rectangle([x0, r * rh, x0 + cw, (r + 1) * rh], fill=_jitter(base, rnd, amount))
            d.rectangle([x0, r * rh, x0 + jw - 1, (r + 1) * rh], fill=joint)
        d.rectangle([0, r * rh, w, r * rh + jw - 1], fill=joint)


# material: (repeat width m, repeat height m, painter)
def _brick(img, rnd, amt):   # 228 x 65 mm bricks, 10 mm joints: 8 courses, 4 bricks a repeat
    _courses(img, 8, 4, _hex("#8a5442"), _hex("#a39282"), 3, amt * 1.6, rnd)


def _travertine(img, rnd, amt):   # big slabs about 1.2 x 0.6 m, staggered (street photos)
    _courses(img, 2, 2, _hex("#ddd3c0"), _hex("#b8ad9a"), 2, amt * 0.5, rnd, 0.35)
    if amt:   # faint horizontal veins
        d = ImageDraw.Draw(img)
        for _ in range(40):
            y, x = rnd.uniform(0, PX), rnd.uniform(0, PX)
            d.line([x, y, x + rnd.uniform(20, 90), y + rnd.uniform(-1, 1)], fill=_hex("#cfc4ae"), width=1)


def _copper(img, rnd, amt):   # weathered copper sheets about 1.0 x 0.5 m (Frati photo)
    _courses(img, 2, 2, _hex("#7f4c45"), _hex("#5a332e"), 2, amt * 1.2, rnd, 0.0)
    if amt:   # soft mottling
        noise = Image.effect_noise((PX // 8, PX // 8), 40).resize((PX, PX), Image.BILINEAR)
        img.paste(Image.blend(img, Image.merge("RGB", [noise] * 3), 0.08))


def _slate(img, rnd, amt):   # slate rows with a 0.2 m exposure, 0.3 m wide, staggered
    _courses(img, 4, 4, _hex("#403839"), _hex("#2a2425"), 3, amt * 1.4, rnd)


TEX = {"brick": (0.96, 0.6, _brick), "travertine": (2.4, 1.2, _travertine),
       "copper": (2.0, 1.0, _copper), "slate": (1.2, 0.8, _slate)}


# photo style: Poly Haven asset, its real repeat in metres, the palette colour it is recoloured to
PHOTO = {"brick": ("medieval_red_brick", 2.0, "#8a5442"), "slate": ("roof_slates_03", 3.0, "#403839")}
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "polyhaven")


def _photo(asset, colour, contrast=1.0):
    """The asset's 1k diffuse map (downloaded once into blender/.cache), shrunk to 512 px
    and recoloured so its average is the palette colour: from afar the wall still reads as
    the flat colour, close up the photo's bricks and slates show."""
    import json, urllib.request
    path = os.path.join(CACHE, asset + ".jpg")
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        ua = {"User-Agent": "desk-at-night facade textures"}
        files = json.load(urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/files/{asset}", headers=ua)))
        data = urllib.request.urlopen(urllib.request.Request(files["Diffuse"]["1k"]["jpg"]["url"], headers=ua)).read()
        open(path, "wb").write(data)
    img = Image.open(path).convert("RGB").resize((512, 512), Image.LANCZOS)
    lum = img.convert("L")
    mean = sum(i * n for i, n in enumerate(lum.histogram())) / (512 * 512)
    base = _hex(colour)
    px = [tuple(max(0, min(255, int(c * (1 + contrast * (l / mean - 1))))) for c in base) for l in lum.getdata()]
    out = Image.new("RGB", img.size)
    out.putdata(px)
    return Image.blend(out, img, 0.25)   # keep a little of the photo's own colour variation


def make_images(style, outdir):
    os.makedirs(outdir, exist_ok=True)
    amt = 0.0 if style == "lines" else 0.07
    out = {}
    for name, (_, _, paint) in TEX.items():
        if name == "roof_felt":   # no smoothing: the grain is the point
            img = Image.new("RGB", (PX, PX))
            paint(img, random.Random(name), amt)
        elif style == "photo" and name in PHOTO:
            asset, size, colour = PHOTO[name]
            img = _photo(asset, colour)
            TEX[name] = (size, size, paint)
        else:
            img = Image.new("RGB", (PX, PX))
            paint(img, random.Random(name), amt)
            img = img.filter(ImageFilter.SMOOTH)
        path = os.path.join(outdir, f"{name}.png" if img.size[0] == PX and name not in ("roof_felt", "copper") else f"{name}.jpg")   # noisy maps as JPEG
        img.save(path, quality=85) if path.endswith(".jpg") else img.save(path)
        out[name] = path
    return out


def _uv_box(o, tw, th):
    """World-space box projection: a wall gets (along, up) in metres over the repeat
    size, a roof or soffit gets (x, y)."""
    mw = o.matrix_world
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uv = bm.loops.layers.uv.verify()
    rot = mw.to_3x3()
    for f in bm.faces:
        n = (rot @ f.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = mw @ lp.vert.co
            if ax == 2:
                u, v = p.x, p.y
            elif ax == 0:
                u, v = p.y * (1 if n.x > 0 else -1), p.z   # read left to right from outside
            else:
                u, v = p.x * (1 if n.y < 0 else -1), p.z
            lp[uv].uv = (u / tw, v / th)
    bm.to_mesh(o.data)
    bm.free()


FELT_FROM = ("copper", "travertine", "roof_light")   # materials whose flat tops are felted
FELT_UP = 0.9   # a face counts as a flat top when its normal points this much up


def _felt(img, rnd, amt):   # bitumen roofing felt: fine sandpaper grain on dark grey
    base = _hex("#4b4c4e")
    img.putdata([_jitter(base, rnd, 0.18) for _ in range(PX * PX)])


TEX["roof_felt"] = (1.0, 1.0, _felt)


def _split_tops(objs):
    """Move the flat tops of FELT_FROM meshes into one dark grey roofing felt mesh (the
    annex's roof terrace, utility rooms, cantina ledge and canopy tops: Adriaen's Google
    Earth view). Costs one draw call."""
    tops = []
    for o in [o for o in objs if o.name in FELT_FROM]:
        rot = o.matrix_world.to_3x3()
        t = o.copy()
        t.data = o.data.copy()
        bpy.context.collection.objects.link(t)
        for ob, keep_up in ((o, False), (t, True)):
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            gone = [f for f in bm.faces if ((rot @ f.normal).normalized().z > FELT_UP) != keep_up]
            bmesh.ops.delete(bm, geom=gone, context="FACES")
            bm.to_mesh(ob.data)
            bm.free()
        if t.data.polygons:
            tops.append(t)
        else:
            bpy.data.objects.remove(t)
    if not tops:
        return objs
    bpy.ops.object.select_all(action="DESELECT")
    for t in tops:
        t.select_set(True)
    bpy.context.view_layer.objects.active = tops[0]
    if len(tops) > 1:
        bpy.ops.object.join()
    felt = bpy.context.view_layer.objects.active
    felt.name = "roof_felt"
    m = bpy.data.materials.new("Trdroof_felt")
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.95
    bsdf.inputs["Base Color"].default_value = (0.07, 0.07, 0.075, 1)
    felt.data.materials.clear()
    felt.data.materials.append(m)
    return [o for o in objs if o.name in bpy.data.objects and o.data.polygons] + [felt]


def apply(objs, style, outdir):
    """Felt the flat tops, then UV-map and texture the merged per-material objects in
    objs. Returns the objects to export."""
    objs = _split_tops(objs)
    imgs = make_images(style, outdir)
    for o in objs:
        key = o.name
        if key not in TEX or not o.data.materials or (style == "none" and key != "roof_felt"):
            continue
        tw, th, _ = TEX[key]
        _uv_box(o, tw, th)
        m = o.data.materials[0].copy()   # leave the shared palette material alone
        o.data.materials[0] = m
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(imgs[key])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return objs
