"""
Shared base for every low-poly character: one body topology, one palette
texture, one material, one rig and one turnaround setup, so the whole cast
looks like it belongs to the same game.

    python characters/_shared/base_body.py      # the bare base body: .blend, .glb, turnaround, pose check

A character script does:

    import base_body as base
    m = base.body(colors={"torso": "coverall_orange"}, hide={"thigh"})
    m.tube(...) / m.hull(...)        # hair, clothing shells, accessories
    base.finish("name", {"body": m, "hair": hair}, out_dir)

Conventions: 1.75 m adult, A-pose, origin at the feet, +Z up, the
character faces +Y and its right hand is on +X. Every face gets one palette
swatch: all its UVs sit on that swatch's centre, so colours stay flat at
any mip level. Faces carry a region name (torso, thigh, head...), so a
character can recolour a region or drop the faces its clothing covers.
"""
import math
import os
import sys

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import palette  # noqa: E402

HEIGHT = 1.75
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

# Ring angles, counted from the right (+X) towards the front (+Y). Uneven
# spacing gives wide flat facets front and back, which reads chunkier than a
# regular octagon and leaves a flat face for the eyes.
BOXY8 = (20, 55, 125, 160, 200, 235, 305, 340)
HEX6 = (0, 60, 120, 180, 240, 300)
QUAD4 = (45, 135, 225, 315)

# ---------------------------------------------------------------- body data
# Vertical parts: rings of (z, half width, half depth, forward offset, region
# of the segment above this ring). A-pose arm parts are rings along the arm:
# (distance from the shoulder joint, half thickness, half width, 0, region).
TORSO = [(0.78, 0.110, 0.085, 0.000, "hips"),
         (0.87, 0.175, 0.110, -0.005, "hips"),
         (1.00, 0.162, 0.102, 0.000, "belly"),
         (1.18, 0.190, 0.118, 0.010, "chest"),
         (1.35, 0.200, 0.105, -0.005, "chest"),
         (1.43, 0.105, 0.075, -0.010, "chest")]
NECK = [(1.38, 0.060, 0.056, -0.008, "neck"),
        (1.52, 0.056, 0.054, -0.004, "neck")]
HEAD = [(1.465, 0.055, 0.038, 0.052, "head"),
        (1.505, 0.100, 0.088, 0.020, "head"),
        (1.580, 0.118, 0.118, 0.005, "head"),
        (1.660, 0.120, 0.122, 0.000, "head"),
        (1.720, 0.102, 0.104, -0.005, "head"),
        (1.750, 0.055, 0.058, -0.010, "head")]
LEG_X = 0.10
LEG = [(0.90, 0.088, 0.092, 0.000, "thigh"),
       (0.70, 0.080, 0.086, 0.000, "thigh"),
       (0.52, 0.066, 0.071, 0.005, "thigh"),
       (0.47, 0.064, 0.068, 0.008, "shin"),
       (0.42, 0.064, 0.068, 0.005, "shin"),
       (0.28, 0.068, 0.072, -0.005, "shin"),
       (0.09, 0.052, 0.056, 0.000, "shin")]
SHOULDER = Vector((0.175, -0.005, 1.36))    # right shoulder joint
ARM_ANGLE = 45                              # A-pose: degrees below horizontal
UPPER_ARM, FOREARM, HAND = 0.25, 0.23, 0.17
ARM = [(-0.03, 0.064, 0.066, 0.0, "upper_arm"),
       (0.06, 0.066, 0.068, 0.0, "upper_arm"),
       (0.20, 0.055, 0.058, 0.0, "upper_arm"),
       (0.25, 0.052, 0.055, 0.0, "forearm"),
       (0.30, 0.053, 0.056, 0.0, "forearm"),
       (0.42, 0.047, 0.050, 0.0, "forearm"),
       (0.48, 0.040, 0.043, 0.0, "forearm")]
# Mitten: flat in the plane of the arm and the forward axis, palm facing in
MITTEN = [(0.47, 0.034, 0.040, 0.0, "hand"),
          (0.53, 0.027, 0.056, 0.0, "hand"),
          (0.61, 0.025, 0.054, 0.0, "hand"),
          (0.65, 0.018, 0.042, 0.0, "hand")]
# Wedge shoe profile in the YZ plane (heel, toe, toe top, instep, heel top)
SHOE = [(-0.075, 0.0), (0.18, 0.0), (0.18, 0.05), (0.05, 0.115), (-0.075, 0.12)]
SHOE_HALF_W = 0.062

DEFAULT_COLORS = {"hips": "undersuit", "belly": "undersuit", "chest": "undersuit",
                  "thigh": "undersuit", "shin": "undersuit", "shoe": "charcoal",
                  "upper_arm": "skin", "forearm": "skin", "hand": "skin", "neck": "skin",
                  "head": "skin", "ear": "skin", "nose": "skin",
                  "eye": "eye", "brow": "hair_dark_brown", "mouth": "lip"}


def arm_dir(side=1):
    a = math.radians(ARM_ANGLE)
    return Vector((side * math.cos(a), 0, -math.sin(a)))


def frame(w, hint=Y):
    """Right-handed (u, v, w) with v as close to `hint` as possible."""
    w = w.normalized()
    v = (hint - w * hint.dot(w)).normalized()
    return v.cross(w), v, w


def ring_at(rings, z):
    """(half width, half depth, forward offset) of a vertical part at height z,
    interpolated between its rings: shells and bands follow the body."""
    z = min(max(z, rings[0][0]), rings[-1][0])
    for (z0, u0, v0, d0, _), (z1, u1, v1, d1, _) in zip(rings, rings[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, d0 + (d1 - d0) * t


def head_point(angle, z, offset=0.0):
    """Point on the head surface (or `offset` outside it) at a ring angle and
    height, interpolated between the HEAD rings: hair and hats hug it."""
    rings = HEAD
    z = min(max(z, rings[0][0]), rings[-1][0])
    for (z0, u0, v0, d0, _), (z1, u1, v1, d1, _) in zip(rings, rings[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            ru, rv, dv = u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, d0 + (d1 - d0) * t
            break
    a = math.radians(angle)
    return Vector(((ru + offset) * math.cos(a), dv + (rv + offset) * math.sin(a), z))


# -------------------------------------------------------------- mesh builder
class Mesh:
    """Collects faces with a swatch and a region each; becomes one object."""

    def __init__(self):
        self.verts, self.faces = [], []   # faces: (vertex indices, swatch, region)

    def _v(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def face(self, pts, swatch, region):
        self.faces.append(([self._v(p) for p in pts], swatch, region))

    def tube(self, rings, origin=(0, 0, 0), axes=(X, Y, Z), angles=BOXY8, swatch=None,
             cap_start=True, cap_end=True, offset=0.0, colors=None, angle_offset=0.0):
        """Loft rings of (t, ru, rv, dv, region) along axes (u, v, w) from origin.
        `offset` inflates every ring (clothing and hair shells); `swatch`
        forces one colour, otherwise `colors[region]` is used."""
        o, (u, v, w) = Vector(origin), axes
        colors = colors or {}
        ids = []
        for t, ru, rv, dv, _ in rings:
            ring = []
            for a in angles:
                a = math.radians(a + angle_offset)
                p = o + w * t + u * ((ru + offset) * math.cos(a)) + v * (dv + (rv + offset) * math.sin(a))
                ring.append(self._v(p))
            ids.append(ring)
        n = len(angles)
        pick = lambda reg: swatch or colors.get(reg, reg)  # noqa: E731
        for k in range(len(rings) - 1):
            reg = rings[k][4]
            for i in range(n):
                j = (i + 1) % n
                self.faces.append(([ids[k][i], ids[k][j], ids[k + 1][j], ids[k + 1][i]], pick(reg), reg))
        if cap_start:
            self.faces.append((ids[0][::-1], pick(rings[0][4]), rings[0][4]))
        if cap_end:
            self.faces.append((ids[-1][:], pick(rings[-2][4]), rings[-2][4]))
        return self

    def hull(self, pts, swatch, region):
        """Convex hull of points: the quick way to a closed blocky part."""
        bm = bmesh.new()
        for p in pts:
            bm.verts.new(p)
        bmesh.ops.convex_hull(bm, input=bm.verts[:])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        # Merge coplanar triangles back into quads: same triangle count,
        # cleaner wireframe
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts[:], edges=bm.edges[:])
        for f in bm.faces:
            self.face([v.co.copy() for v in f.verts], swatch, region)
        bm.free()
        return self

    def bar(self, a, b, w, swatch, region):
        """A thin square bar from a to b, w thick each way: wires, arms, frames."""
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        u = d.cross(Z if abs(d.z) < 0.9 else X).normalized()
        v = d.cross(u)
        return self.hull([p + u * su * w + v * sv * w for p in (a, b) for su in (-1, 1) for sv in (-1, 1)],
                         swatch, region)

    def mirrored(self):
        """Copy mirrored across X (the character's right to left)."""
        m = Mesh()
        m.verts = [Vector((-p.x, p.y, p.z)) for p in self.verts]
        m.faces = [(ids[::-1], s, r) for ids, s, r in self.faces]
        return m

    def extend(self, other):
        base = len(self.verts)
        self.verts += [p.copy() for p in other.verts]
        self.faces += [([i + base for i in ids], s, r) for ids, s, r in other.faces]
        return self

    def drop(self, regions):
        self.faces = [f for f in self.faces if f[2] not in regions]
        return self

    def recolor(self, colors):
        self.faces = [(ids, colors.get(r, s), r) for ids, s, r in self.faces]
        return self

    def tris(self):
        return sum(len(ids) - 2 for ids, _, _ in self.faces)

    def bvh(self):
        return BVHTree.FromPolygons(self.verts, [ids for ids, _, _ in self.faces])

    def decal(self, bvh, x, z, w, h, swatch, region, tilt=0.0, lift=0.0015):
        """Tiny flat quad stuck on the surface in front of (x, z): eyes, brows, mouth."""
        hit, n, _, _ = bvh.ray_cast(Vector((x, 1.0, z)), -Y)
        assert hit is not None, (region, x, z)
        t1 = n.cross(Z).normalized()
        t2 = t1.cross(n)
        r = Matrix.Rotation(math.radians(tilt), 3, n)
        t1, t2 = r @ t1, r @ t2
        c = hit + n * lift
        self.face([c - t1 * w / 2 - t2 * h / 2, c - t1 * w / 2 + t2 * h / 2,
                   c + t1 * w / 2 + t2 * h / 2, c + t1 * w / 2 - t2 * h / 2], swatch, region)
        return self

    def decal_poly(self, bvh, pts, swatch, region, facing=1, lift=0.003):
        """Flat polygon stuck on the surface: each (x, z) corner is projected
        onto the mesh from the front (facing=1) or the back (facing=-1).
        For logos and badges made of a few flat-coloured shapes."""
        out, normal = [], Vector()
        for x, z in pts:
            hit, n, _, _ = bvh.ray_cast(Vector((x, facing * 1.0, z)), Vector((0, -facing, 0)))
            assert hit is not None, (region, x, z)
            out.append(hit + n * lift)
            normal += n
        # Newell normal of the polygon; flip the winding to face outwards
        nw = Vector()
        for a, b in zip(out, out[1:] + out[:1]):
            nw += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        self.face(out if nw.dot(normal) > 0 else out[::-1], swatch, region)
        return self

    def decal_band(self, bvh, zs, left, right, swatch, region, lift=0.003):
        """A strip stuck on the front of the mesh between two edges, left(z)
        and right(z), as one row of quads per step in zs. Unlike one big
        flat polygon it follows a curved surface (a V of shirt, lapels)."""
        rows = []
        for z in zs:
            row = []
            for x in (left(z), right(z)):
                hit, n, _, _ = bvh.ray_cast(Vector((x, 1.0, z)), -Y)
                assert hit is not None, (region, x, z)
                row.append(hit + n * lift)
            rows.append(row)
        for (a0, b0), (a1, b1) in zip(rows, rows[1:]):
            pts = [a0, b0, b1, a1]
            n = (b0 - a0).cross(a1 - a0)
            self.face(pts if n.y > 0 else pts[::-1], swatch, region)
        return self

    def to_object(self, name, collection=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.verts], [], [ids for ids, _, _ in self.faces])
        # Swatch and region ride along as face attributes, so they stay with
        # their faces when validating or welding drops a degenerate one
        regions = sorted({r for _, _, r in self.faces})
        swatches = sorted({s for _, s, _ in self.faces})
        attr = me.attributes.new("region", "INT", "FACE")
        sw_attr = me.attributes.new("swatch", "INT", "FACE")
        for i, (_, sw, reg) in enumerate(self.faces):
            attr.data[i].value = regions.index(reg)
            sw_attr.data[i].value = swatches.index(sw)
        me.validate()
        # Parts are built face by face; weld shared corners so the mesh is
        # connected (bone heat weighting needs that).
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        bm.to_mesh(me)
        bm.free()
        uvl = me.uv_layers.new(name="UVMap")
        sw_attr = me.attributes["swatch"]
        for poly in me.polygons:
            u, v = palette.uv(swatches[sw_attr.data[poly.index].value])
            for li in poly.loop_indices:
                uvl.data[li].uv = (u, v)
            poly.use_smooth = False
        me.attributes.remove(sw_attr)
        me["regions"] = regions
        me.materials.append(material())
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        return ob


# --------------------------------------------------------------- base body
def body(skin="skin_3", colors=None, hide=(), brow=None, ears=True, ear_scale=1.0):
    """The shared base body as a Mesh. `colors` maps regions to swatches
    (e.g. {"chest": "coverall_orange"}); `hide` drops regions a clothing
    shell covers completely, to stay within the triangle budget."""
    cols = dict(DEFAULT_COLORS)
    for r, s in cols.items():
        if s == "skin":
            cols[r] = skin
    if brow:
        cols["brow"] = brow
    cols.update(colors or {})

    m = Mesh()
    m.tube(TORSO, colors=cols)
    m.tube(NECK, colors=cols, cap_start=False, cap_end=False, angles=HEX6, angle_offset=30)
    head = Mesh().tube(HEAD, colors=cols)
    m.extend(head)

    right = Mesh()
    right.tube(LEG, origin=(LEG_X, 0, 0), colors=cols, angles=HEX6, angle_offset=30,
               cap_start=False, cap_end=False)
    shoe = [Vector((LEG_X + sx * SHOE_HALF_W, y, z)) for sx in (-1, 1) for y, z in SHOE]
    right.hull(shoe, cols["shoe"], "shoe")
    arm = frame(arm_dir(1))
    right.tube(ARM, origin=SHOULDER, axes=arm, colors=cols, angles=HEX6, angle_offset=30,
               cap_start=False, cap_end=False)
    right.tube(MITTEN, origin=SHOULDER, axes=arm, colors=cols, angles=HEX6, angle_offset=30,
               cap_start=False)
    u, v, w = arm
    palm = SHOULDER + w * 0.505 + v * 0.035
    tdir = (w * 0.55 + v * 0.8).normalized()
    right.tube([(0.0, 0.019, 0.016, 0, "hand"), (0.06, 0.014, 0.012, 0, "hand")], origin=palm,
               axes=frame(tdir, u), angles=QUAD4, colors=cols, cap_start=False)
    if ears:
        k = 1 + (ear_scale - 1) * 0.6  # ear_scale sets how far they stick out, height grows less
        ear = [Vector((0.113 + dx * ear_scale, -0.012 + dy * k, 1.60 + dz * k))
               for dx in (0, 0.022) for dy in (-0.02, 0.018) for dz in (-0.035, 0.03)]
        right.hull(ear, cols["ear"], "ear")
    m.extend(right).extend(right.mirrored())

    # Nose: a small wedge on the front facet
    bvh = head.bvh()
    hit, n, _, _ = bvh.ray_cast(Vector((0, 1, 1.585)), -Y)
    tip = hit + Y * 0.022 - Z * 0.012
    m.hull([hit + X * 0.018 - Z * 0.02 - Y * 0.01, hit - X * 0.018 - Z * 0.02 - Y * 0.01,
            hit + Z * 0.03 - Y * 0.01, tip], cols["nose"], "nose")
    for s in (1, -1):
        m.decal(bvh, s * 0.040, 1.615, 0.020, 0.028, cols["eye"], "eye")
        m.decal(bvh, s * 0.042, 1.652, 0.040, 0.010, cols["brow"], "brow", tilt=-s * 6)
    m.decal(bvh, 0, 1.522, 0.044, 0.009, cols["mouth"], "mouth")
    return m.drop(set(hide))


# ---------------------------------------------------------------- material
def material():
    mat = bpy.data.materials.get("M_CharacterPalette")
    if mat:
        return mat
    path = os.path.join(HERE, "palette.png")
    if not os.path.exists(path):
        palette.write(path)
    img = bpy.data.images.load(path, check_existing=True)
    img.pack()
    mat = bpy.data.materials.new("M_CharacterPalette")
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Specular IOR Level"].default_value = 0.2
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image, tex.interpolation = img, "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.nodes.active = tex
    return mat


# ---------------------------------------------------------------------- rig
def bones():
    """(name, head, tail, parent) of the shared humanoid armature."""
    b = [("root", (0, 0, 0), (0, 0.25, 0), None),
         ("hips", (0, 0, 0.88), (0, 0, 1.0), "root"),
         ("spine", (0, 0, 1.0), (0, 0, 1.18), "hips"),
         ("chest", (0, 0, 1.18), (0, -0.005, 1.38), "spine"),
         ("neck", (0, -0.005, 1.38), (0, -0.004, 1.50), "chest"),
         ("head", (0, -0.004, 1.50), (0, -0.004, 1.76), "neck")]
    for side, tag in ((1, "R"), (-1, "L")):
        s = Vector((side * SHOULDER.x, SHOULDER.y, SHOULDER.z))
        d = arm_dir(side)
        e, wr = s + d * UPPER_ARM, s + d * (UPPER_ARM + FOREARM)
        b += [(f"upper_arm.{tag}", s, e, "chest"),
              (f"forearm.{tag}", e, wr, f"upper_arm.{tag}"),
              (f"hand.{tag}", wr, wr + d * HAND, f"forearm.{tag}")]
        x = side * LEG_X
        b += [(f"thigh.{tag}", (x, 0, 0.90), (x, 0.008, 0.47), "hips"),
              (f"shin.{tag}", (x, 0.008, 0.47), (x, 0, 0.09), f"thigh.{tag}"),
              (f"foot.{tag}", (x, 0, 0.09), (x, 0.15, 0.03), f"shin.{tag}")]
    return b


def armature(name="Armature"):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    for bn, h, t, parent in bones():
        eb = arm.edit_bones.new(bn)
        eb.head, eb.tail = Vector(h), Vector(t)
        eb.roll = 0
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = (eb.head - arm.edit_bones[parent].tail).length < 1e-4
        eb.use_deform = bn != "root"
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.display_type = "STICK"
    return ob


def _fill_from(kd, src_verts, ob, verts, groups):
    """Copy each vertex's weights from the nearest weighted source vertex."""
    for v in verts:
        for g in src_verts[kd.find(v.co)[1]].groups:
            name = groups[g.group].name
            vg = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
            vg.add([v.index], g.weight, "REPLACE")


def _kd(verts):
    from mathutils.kdtree import KDTree
    kd = KDTree(len(verts))
    for i, v in enumerate(verts):
        kd.insert(v.co, i)
    kd.balance()
    return kd


def _vertex_regions(ob):
    regions = ob.data["regions"]
    attr = ob.data.attributes["region"].data
    out = {}
    for poly in ob.data.polygons:
        for vi in poly.vertices:
            out.setdefault(vi, set()).add(regions[attr[poly.index].value])
    return out


def _set_weights(ob, vi, weights):
    for g in list(ob.data.vertices[vi].groups):
        ob.vertex_groups[g.group].remove([vi])
    for bone, w in weights.items():
        (ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)).add([vi], w, "REPLACE")


# Joint rings: everything above the ring follows the upper bone, everything
# below the lower one, and only the ring itself is shared half and half.
KNEE_Z, ELBOW_T, HIPS_TOP = 0.47, UPPER_ARM, 0.95
SPINE_BONES = {"hips", "spine", "chest", "neck", "head"}


def _hinge_limbs(ob):
    """Bone heat smears weights across a whole low-poly limb, so a bent knee
    or elbow folds into a crumpled cone. Limbs get clean hinge weights
    instead: rigid segments with one shared ring at each joint, the pelvis
    stays with the hips bone, and the torso keeps its heat weights along
    the spine but loses any pull from the arms and legs. The shoulder and
    hip joints then turn like an action figure's, with the top of the limb
    turning inside the torso."""
    for vi, regs in _vertex_regions(ob).items():
        co = ob.data.vertices[vi].co
        tag = "R" if co.x > 0 else "L"
        side = 1 if co.x > 0 else -1
        if regs & {"thigh", "shin"}:
            d = co.z - KNEE_Z
            w = {f"thigh.{tag}": 1.0} if d > 0.02 else {f"shin.{tag}": 1.0} if d < -0.02 else \
                {f"thigh.{tag}": 0.5, f"shin.{tag}": 0.5}
        elif regs & {"upper_arm", "forearm"}:
            s = Vector((side * SHOULDER.x, SHOULDER.y, SHOULDER.z))
            d = (co - s).dot(arm_dir(side)) - ELBOW_T
            w = {f"upper_arm.{tag}": 1.0} if d < -0.02 else {f"forearm.{tag}": 1.0} if d > 0.02 else \
                {f"upper_arm.{tag}": 0.5, f"forearm.{tag}": 0.5}
        elif "hand" in regs:
            w = {f"hand.{tag}": 1.0}
        elif "shoe" in regs:
            w = {f"foot.{tag}": 1.0}
        elif regs & {"hips", "belly", "chest"}:
            if co.z < HIPS_TOP:
                w = {"hips": 1.0}
            else:
                w = {ob.vertex_groups[g.group].name: g.weight for g in ob.data.vertices[vi].groups
                     if ob.vertex_groups[g.group].name in SPINE_BONES and g.weight > 0.01}
                total = sum(w.values()) or 1
                w = {k: v / total for k, v in w.items()} or {"chest": 1.0}
        else:
            continue
        _set_weights(ob, vi, w)


def skin_to(body_ob, arm_ob, extras=(), rigid=None):
    """Automatic (bone heat) weights on the base body, as the style guide
    asks. Bone heat needs a clean surface, so it runs on the body only:
    extra parts (hair, clothing shells, accessories) either follow one bone
    (`rigid` maps region -> bone) or copy the weights of the nearest body
    vertex, which makes a shell deform exactly like the skin under it."""
    bpy.ops.object.select_all(action="DESELECT")
    body_ob.select_set(True)
    arm_ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    vs = body_ob.data.vertices
    groups = body_ob.vertex_groups
    # Heat leaks between the legs (and from the arms into the chest sides):
    # a vertex off the centre line never follows the other side's bones.
    for v in vs:
        side = "R" if v.co.x > 0.02 else "L" if v.co.x < -0.02 else None
        for g in list(v.groups):
            n = groups[g.group].name
            if side and n[-2:] in (".L", ".R") and n[-1] != side:
                groups[g.group].remove([v.index])
    # Bone heat skips small floating islands (eyes, brows, ears): they take
    # the weights of the nearest weighted vertex and ride along with it.
    done = [v for v in vs if v.groups]
    _fill_from(_kd(done), done, body_ob, [v for v in vs if not v.groups], groups)
    _hinge_limbs(body_ob)

    kd = _kd(done)
    rigid = rigid or {}
    for ob in extras:
        regions = ob.data["regions"]
        attr = ob.data.attributes["region"].data
        stiff = {}
        for poly in ob.data.polygons:
            bone = rigid.get(regions[attr[poly.index].value])
            if bone:
                for vi in poly.vertices:
                    stiff[vi] = bone
        for vi, bone in stiff.items():
            vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
            vg.add([vi], 1.0, "REPLACE")
        _fill_from(kd, done, ob, [v for v in ob.data.vertices if v.index not in stiff], groups)
    for ob in (body_ob, *extras):
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)


def pose(arm_ob, rotations):
    """Rotations per bone as (axis, degrees), the axis given in the rest
    pose's armature space. Empty dict resets to the rest pose."""
    for pb in arm_ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
    for bn, (axis, deg) in rotations.items():
        m = arm_ob.data.bones[bn].matrix_local.to_3x3()
        r = Matrix.Rotation(math.radians(deg), 3, Vector(axis))
        arm_ob.pose.bones[bn].rotation_quaternion = (m.inverted() @ r @ m).to_quaternion()
    bpy.context.view_layer.update()


def bend(bone_dir, towards):
    """Axis that swings a bone pointing along bone_dir towards a direction."""
    return Vector(bone_dir).normalized().cross(Vector(towards)).normalized()


def _legs(r, tag, thigh, shin):
    """Bend a leg (degrees forward at the hip, back at the knee) and turn
    the foot so the sole stays level with the floor."""
    r[f"thigh.{tag}"] = (X, thigh)
    r[f"shin.{tag}"] = (-X, shin)
    r[f"foot.{tag}"] = (X, shin - thigh)


def pose_tests():
    """Poses that stress shoulders, elbows, hips and knees. Each is grounded
    (lowest point on the floor) when rendered; "seated" gets a chair seat."""
    up, fwd = Z, Y
    tests = {}
    r = {}
    for side, tag in ((1, "R"), (-1, "L")):
        d = arm_dir(side)
        r[f"upper_arm.{tag}"] = (bend(d, up), 75 if side == 1 else 30)
        r[f"forearm.{tag}"] = (bend(d, fwd), 100)
    _legs(r, "R", 80, 95)
    r["head"] = (Z, 30)
    tests["reach"] = r
    r = {}
    for side, tag in ((1, "R"), (-1, "L")):
        d = arm_dir(side)
        r[f"upper_arm.{tag}"] = (bend(d, fwd), 40)
        r[f"forearm.{tag}"] = (bend(d, fwd), 70)
        _legs(r, tag, 90, 90)
    tests["seated"] = r
    r = {}
    for side, tag in ((1, "R"), (-1, "L")):
        d = arm_dir(side)
        r[f"upper_arm.{tag}"] = (bend(d, fwd), 70)
        r[f"forearm.{tag}"] = (bend(d, up), 50)
        _legs(r, tag, 105, 125)
    r["spine"] = (X, 20)
    r["neck"] = (X, -20)
    tests["crouch"] = r
    return tests


def ground(ch, arm, seat=None):
    """Move the rig so its lowest vertex touches the floor. With a seat
    object, also put the seat top just under the backs of the thighs."""
    arm.location = (0, 0, 0)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ch.evaluated_get(dg)
    me = ev.to_mesh()
    pts = [ch.matrix_world @ v.co for v in me.vertices]
    regions, attr = ch.data["regions"], ch.data.attributes["region"].data
    thigh = set()
    for poly in ch.data.polygons:
        if regions[attr[poly.index].value] in ("thigh", "hips"):
            thigh.update(poly.vertices)
    ev.to_mesh_clear()
    lift = -min(p.z for p in pts)
    arm.location = (0, 0, lift)
    if seat:
        top = min(pts[i].z for i in thigh) + lift
        seat.scale = (0.25, 0.24, top / 2)
        seat.location = (0, 0.10, top / 2)
    bpy.context.view_layer.update()


# --------------------------------------------------------------- rendering
BG = (0.62, 0.64, 0.66)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    return sc


# Neutral white studio light for the turnarounds: ambient plus one key light
# from the upper left (view space), adding up to 1 on faces that look at the
# camera, so palette colours render close to their swatch and the facets
# still read. Blender's own studio lights are tinted and dim: they turned
# hi-vis yellow olive and the logo's magenta brown.
STUDIO_LIGHT = {"ambient": 0.58, "key": (0.5, (-0.4, 0.45, 0.8)), "fill": (0.1, (0.8, -0.3, 0.5))}


def _studio_light():
    import tempfile
    a = STUDIO_LIGHT["ambient"]
    lines = ["version 1"] + [f"light_ambient.{c} {a:.6f}" for c in "xyz"]
    lights = [STUDIO_LIGHT["key"], STUDIO_LIGHT["fill"], (0.0, (0, 0, 1)), (0.0, (0, 0, 1))]
    for i, (power, d) in enumerate(lights):
        d = Vector(d).normalized()
        lines += [f"light[{i}].flag {int(power > 0)}", f"light[{i}].smooth 0.000000"]
        lines += [f"light[{i}].col.{c} {power:.6f}" for c in "xyz"]
        lines += [f"light[{i}].spec.{c} 0.000000" for c in "xyz"]
        lines += [f"light[{i}].vec.{c} {v:.6f}" for c, v in zip("xyz", d)]
    path = os.path.join(tempfile.gettempdir(), "character_flat.sl")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    lights = bpy.context.preferences.studio_lights
    old = lights.get("character_flat.sl")
    if old:
        lights.remove(old)
    return lights.load(path, "STUDIO").name


def setup_render(res=(640, 960)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.studio_light = _studio_light()
    sh.color_type = "TEXTURE"
    sh.show_object_outline = True
    sh.object_outline_color = (0.12, 0.13, 0.14)
    sh.show_cavity = False
    sh.show_shadows = False
    sh.show_backface_culling = True
    sc.display.render_aa = "8"
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("Neutral")
    world.color = BG
    sc.world = world
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    sc.camera = cam
    return cam


def look(cam, yaw_deg, height=0.95, dist=6.0, scale=2.05, pitch_deg=4):
    """Orthographic camera orbiting the origin; yaw 0 looks at the front."""
    a, p = math.radians(yaw_deg), math.radians(pitch_deg)
    target = Vector((0, 0, height))
    cam.location = target + Vector((math.sin(a) * math.cos(p), math.cos(a) * math.cos(p), math.sin(p))) * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = scale


VIEWS = [("front", 0), ("3/4", 40), ("side", 90), ("back", 180)]


def render_views(cam, out_dir, prefix, views=VIEWS, **kw):
    paths = []
    for label, yaw in views:
        look(cam, yaw, **kw)
        p = os.path.join(out_dir, f"_{prefix}_{label.replace('/', '-')}.png")
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append((label, p))
    return paths


def strip(paths, out, title=None):
    """Lay renders side by side with a label under each."""
    from PIL import Image, ImageDraw, ImageFont
    ims = [(lbl, Image.open(p).convert("RGB")) for lbl, p in paths]
    w, h = ims[0][1].size
    top = 44 if title else 0
    sheet = Image.new("RGB", (w * len(ims), h + top + 36), tuple(int(c * 255) for c in BG))
    d = ImageDraw.Draw(sheet)
    font = _font(22)
    if title:
        d.text((16, 10), title, fill=(30, 32, 34), font=font)
    for i, (lbl, im) in enumerate(ims):
        sheet.paste(im, (i * w, top))
        d.text((i * w + 16, top + h + 6), lbl, fill=(30, 32, 34), font=font)
    _save(sheet, out)
    for _, p in paths:
        os.remove(p)
    return out


def _save(img, path, quantize=True):
    """Flat colours survive a 256-colour palette, at a fraction of the size.
    Octree without dithering keeps small accents (logos, clips) true: median
    cut merged them into their big neighbours and dithered the rest."""
    from PIL import Image
    if quantize:
        img = img.convert("RGB").quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    img.save(path, optimize=True)


def _font(size):
    from PIL import ImageFont
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def contact_sheet(turnaround, out, reference=None, notes=()):
    """Turnaround next to the reference (when given) with notes underneath.
    The reference is never committed: pass it only for private sheets."""
    from PIL import Image, ImageDraw
    t = Image.open(turnaround).convert("RGB")
    parts = [t]
    if reference:
        r = Image.open(reference).convert("RGB")
        r = r.resize((int(r.width * t.height / r.height), t.height))
        parts.insert(0, r)
    W = sum(p.width for p in parts)
    sheet = Image.new("RGB", (W, t.height + 30 + 30 * len(notes)), (236, 236, 232))
    x = 0
    for p in parts:
        sheet.paste(p, (x, 0))
        x += p.width
    d, font = ImageDraw.Draw(sheet), _font(20)
    for i, n in enumerate(notes):
        d.text((16, t.height + 12 + 30 * i), n, fill=(30, 32, 34), font=font)
    _save(sheet, out, quantize=not reference)
    return out


# ------------------------------------------------------------------- finish
def tri_count(obs):
    return sum(len(p.vertices) - 2 for ob in obs for p in ob.data.polygons)


def drop_regions(ob, regions):
    """Delete the faces of some regions (skin a clothing shell covers) and
    the vertices left without faces."""
    if not regions:
        return
    names = ob.data["regions"]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    layer = bm.faces.layers.int["region"]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if names[f[layer]] in regions], context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


def finish(name, meshes, out_dir, title=None, notes=(), rigid=None, reference=None, private_dir=None,
           hide=(), variant=None):
    """Turn Mesh parts into named objects, join them into one skinned mesh,
    rig it, render the turnaround and pose check, save .blend and .glb.

    The first part is the base body. `hide` drops body regions that clothing
    covers; that happens after skinning, so shells still copy the weights of
    the skin they cover. `variant` (an outfit) suffixes every output file."""
    os.makedirs(out_dir, exist_ok=True)
    sfx = f"_{variant}" if variant else ""
    obs = [m.to_object(f"{name}{sfx}_{part}") for part, m in meshes.items()]
    arm = armature(f"{name}{sfx}_rig")
    skin_to(obs[0], arm, obs[1:], rigid)
    drop_regions(obs[0], set(hide))
    tris = tri_count(obs)
    # One mesh, one material, one draw call. The parts stay findable through
    # the face attribute "region".
    bpy.ops.object.select_all(action="DESELECT")
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    regions = sorted({r for ob in obs for r in ob.data["regions"]})
    for ob in obs:  # remap per-object region indices to the joined list
        local = list(ob.data["regions"])
        for a in ob.data.attributes["region"].data:
            a.value = regions.index(local[a.value])
    bpy.ops.object.join()
    ch = obs[0]
    ch.name = ch.data.name = name + sfx
    ch.data["regions"] = regions

    cam = setup_render()
    turn = strip(render_views(cam, out_dir, "t"), os.path.join(out_dir, f"turnaround{sfx}.png"),
                 title or f"{name}{sfx}  ·  {tris} triangles")
    strip(render_views(cam, out_dir, "c", VIEWS[:3], height=1.56, scale=0.62),
          os.path.join(out_dir, f"closeup{sfx}.png"), "head close-up")
    seat = bpy.data.objects.new("seat", bpy.data.meshes.new("seat"))
    seat.data.from_pydata([(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], [],
                          [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    seat.data.materials.append(material())
    for poly in seat.data.polygons:
        poly.use_smooth = False
    uvl = seat.data.uv_layers.new()
    for l in uvl.data:
        l.uv = palette.uv("grey")
    bpy.context.scene.collection.objects.link(seat)
    shots = []
    for label, rot in pose_tests().items():
        pose(arm, rot)
        seat.hide_render = label != "seated"
        ground(ch, arm, seat if label == "seated" else None)
        shots += [(f"{label} 3/4", p) for _, p in render_views(cam, out_dir, f"p_{label}", [("3/4", 35)])]
        shots += [(f"{label} side", p) for _, p in render_views(cam, out_dir, f"p_{label}s", [("side", 90)])]
    pose(arm, {})
    arm.location = (0, 0, 0)
    bpy.data.objects.remove(seat)
    strip(shots, os.path.join(out_dir, f"pose_check{sfx}.png"), "pose check: shoulders, elbows, hips, knees")

    notes = [f"{tris} triangles, palette characters/_shared/palette.png"] + list(notes)
    contact_sheet(turn, os.path.join(out_dir, f"contact_sheet{sfx}.png"), notes=notes)
    if reference and private_dir:  # next to the reference: private project files only
        os.makedirs(private_dir, exist_ok=True)
        contact_sheet(turn, os.path.join(private_dir, f"{name}{sfx}_contact_sheet.png"), reference, notes)

    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{name}{sfx}.blend"), compress=True)
    bpy.ops.object.select_all(action="DESELECT")
    ch.select_set(True)
    arm.select_set(True)
    import anims  # imports this module
    anims.add_clips(arm)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, f"{name}{sfx}.glb"), export_format="GLB",
                              use_selection=True, export_apply=False, export_animations=True,
                              export_animation_mode="NLA_TRACKS", export_frame_range=False)
    print(f"{name}{sfx}: {tris} triangles -> {out_dir}")
    return tris, turn


if __name__ == "__main__":
    reset()
    m = body()
    finish("base_body", {"body": m}, HERE, notes=())
