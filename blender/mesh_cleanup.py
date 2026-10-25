"""Make a kit-built model cheap to draw: drop faces nobody can see, then merge.

Scenes like the Trondheim preview are built from hundreds of primitives (boxes for
window frames, panels, steps, cylinders for posts and arches). Many of their faces are
buried: the back of a window frame sits inside the wall, the bottom of a step sits on
the ground, half an arch is inside the frame below it. strip_hidden() deletes every
face that lies inside or flush against another solid; merge_by_material() then joins
what is left into one mesh per material, so a viewer draws the model in a few calls.

    import mesh_cleanup
    mesh_cleanup.strip_hidden(objs)
    merged = mesh_cleanup.merge_by_material(objs)
"""
import bmesh
import bpy
import numpy as np
from mathutils import Vector

EPS = 0.012     # how far past a face we look for solid material
TOL = 1e-4      # plane tolerance for "inside"


def _world_bmesh(o):
    """The object's evaluated mesh (modifiers applied) as a bmesh in world space."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = o.evaluated_get(dg).to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    o.evaluated_get(dg).to_mesh_clear()
    bm.transform(o.matrix_world)
    bm.normal_update()
    return bm


def _convex_planes(bm):
    """Face planes (n, d) when the mesh is a closed convex solid, else None."""
    if len(bm.faces) < 4 or any(not e.is_manifold for e in bm.edges):
        return None
    verts = np.array([v.co[:] for v in bm.verts])
    planes = []
    for f in bm.faces:
        n = np.array(f.normal[:])
        if not n.any():
            continue
        d = n @ np.array(f.calc_center_median()[:])
        if (verts @ n - d).max() > 1e-3:   # a vertex in front of a face: not convex
            return None
        planes.append((*n, d))
    return np.array(planes)


def _samples(f, mw):
    """World-space points spread over face f: the centre, points towards each corner
    and, for quads, a 4 x 4 grid, so a big face that is only partly covered (a brick
    panel behind a column of windows) is not mistaken for a buried one."""
    vs = [mw @ v.co for v in f.verts]
    c = mw @ f.calc_center_median()
    pts = [c] + [c.lerp(v, 0.85) for v in vs]
    if len(vs) == 4:
        for u in (0.08, 0.36, 0.64, 0.92):
            a, b = vs[0].lerp(vs[1], u), vs[3].lerp(vs[2], u)
            pts += [a.lerp(b, t) for t in (0.08, 0.36, 0.64, 0.92)]
    else:
        pts += [c.lerp(vs[i].lerp(vs[(i + 1) % len(vs)], 0.5), 0.85) for i in range(len(vs))]
    return pts


def strip_hidden(objs, ground=0.0):
    """Delete faces of objs that are buried in, or pressed flat against, another solid
    (any closed convex mesh in objs), and faces lying on or under the ground plane."""
    # rotations set after an object is made only reach matrix_world on the next update;
    # without it a rotated part is tested where it would sit unrotated
    bpy.context.view_layer.update()
    objs = [o for o in objs if o.type == "MESH"]
    solids = []   # (object, planes, aabb min, aabb max)
    for o in objs:
        bm = _world_bmesh(o)
        p = _convex_planes(bm)
        if p is not None:
            vs = np.array([v.co[:] for v in bm.verts])
            solids.append((o, p, vs.min(0) - EPS, vs.max(0) + EPS))
        bm.free()
    lo = np.array([s[2] for s in solids])
    hi = np.array([s[3] for s in solids])
    removed = kept = 0
    for o in objs:
        # Apply modifiers so the mesh we edit is the one we tested
        if o.modifiers:
            dg = bpy.context.evaluated_depsgraph_get()
            o.data = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
            o.modifiers.clear()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        mw, mw3 = o.matrix_world, o.matrix_world.to_3x3()
        # An open sheet (a decal such as a logo) can be seen from both sides: only
        # bury it when both sides are inside something
        sides = (1, -1) if any(not e.is_manifold for e in bm.edges) else (1,)
        dead = []
        for f in bm.faces:
            n = (mw3 @ f.normal).normalized()
            c = mw @ f.calc_center_median()
            pts = _samples(f, mw)
            if max(p.z for p in pts) <= ground + 0.02 and n.z < -0.5:
                dead.append(f)
                continue
            if max(p.z for p in pts) < ground - 0.005:
                dead.append(f)
                continue
            # every sample point, nudged off the face, must be inside a solid other
            # than this object
            ok = True
            for q in (np.array((p + n * (s * EPS))[:]) for s in sides for p in pts):
                cand = np.nonzero(np.all((q >= lo) & (q <= hi), axis=1))[0]
                if not any(solids[i][0] is not o and
                           (solids[i][1][:, :3] @ q - solids[i][1][:, 3]).max() <= TOL
                           for i in cand):
                    ok = False
                    break
            if ok:
                dead.append(f)
        removed += len(dead)
        kept += len(bm.faces) - len(dead)
        bmesh.ops.delete(bm, geom=dead, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
    print(f"strip_hidden: removed {removed} faces, kept {kept}")
    return removed, kept


def merge_by_material(objs):
    """Join objs into one object per material (named after it); weld duplicate
    vertices and drop empty meshes. Returns the merged objects."""
    groups = {}
    for o in objs:
        if o.type != "MESH" or not o.data.polygons:
            if o.type == "MESH":
                bpy.data.objects.remove(o)
            continue
        mat = o.data.materials[0] if o.data.materials else None
        groups.setdefault(mat, []).append(o)
    out = []
    for mat, group in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = (mat.name if mat else "nomat").removeprefix("Trd")
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(o.data)
        bm.free()
        out.append(o)
    return out


def fronts_only(objs, names):
    """For thin parts pressed against a wall (window glass, glazing bars, reliefs)
    whose back strip_hidden() already removed, keep only the front face: their sides
    are a few centimetres deep and vanish at any viewing distance. The front is the
    one face left without an opposite face; parts that don't fit that pattern stay."""
    trimmed = 0
    for o in objs:
        if o.type != "MESH" or o.name.split(".")[0] not in names:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        lone = [f for f in bm.faces
                if not any(g is not f and f.normal.dot(g.normal) < -0.99 for g in bm.faces)]
        if len(lone) == 1 and len(bm.faces) > 1:
            dead = [f for f in bm.faces if f is not lone[0]]
            trimmed += len(dead)
            bmesh.ops.delete(bm, geom=dead, context="FACES")
            bm.to_mesh(o.data)
        bm.free()
    print(f"fronts_only: removed {trimmed} side faces")


def merge_palette(objs, skip, rough=0.7):
    """Join the flat-coloured objects of objs (one per material, as merge_by_material
    leaves them) into one mesh whose colours ride in a vertex colour attribute, so they
    all draw in one call. Objects named in skip (textured, glossy or ones a viewer looks
    up by name) stay as they are. Costs the merged materials their own roughness: all
    take rough. Returns the objects to export."""
    flat = [o for o in objs if o.name not in skip and o.data.materials]
    if len(flat) < 2:
        return objs
    keep_names = {o.name for o in objs} - {o.name for o in flat}
    for o in flat:
        bsdf = next(n for n in o.data.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        col = tuple(bsdf.inputs["Base Color"].default_value)
        attr = o.data.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        attr.data.foreach_set("color", col * len(o.data.loops))
    bpy.ops.object.select_all(action="DESELECT")
    for o in flat:
        o.select_set(True)
    bpy.context.view_layer.objects.active = flat[0]
    bpy.ops.object.join()
    pal = bpy.context.view_layer.objects.active
    pal.name = "palette"
    m = bpy.data.materials.new("TrdPalette")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = rough
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    pal.data.materials.clear()
    pal.data.materials.append(m)
    for p in pal.data.polygons:
        p.material_index = 0
    rest = [bpy.data.objects[n] for n in keep_names]
    return rest + [pal]
