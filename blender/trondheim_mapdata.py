"""Turn a topoexport.com 3D DXF of Trondheim's Midtbyen into the compact map data that
trondheim_surroundings.py (v3) builds the town from.

    .venv/bin/python blender/trondheim_mapdata.py topoexport_3D_modeling.dxf

The export is in metres, north up. Everything is stored relative to the Olav Tryggvason
column (the centre of the roundabout ring on Torvet), with heights relative to the
ground at the column; the result goes to blender/data/trondheim_midtbyen.json.gz.

Buildings, streets, trees and water are Overture Maps data (ODbL), the terrain is
Kartverket's 1 m terrain model (CC BY 4.0): see blender/data/README.md.
"""
import gzip
import json
import os
import sys

import ezdxf

STATUE = (397.27, 367.52)   # roundabout ring centre in the 1 km Midtbyen export
GROUND = 9.55               # terrain height at the column (NN2000)
OUT = os.path.join(os.path.dirname(__file__), "data", "trondheim_midtbyen.json.gz")


def pack(meshes, step=0.05):
    """Weld vertices on a 5 cm grid and store one flat vertex and triangle list."""
    index, V, F = {}, [], []
    for verts, faces in meshes:
        ids = []
        for x, y, z in verts:
            k = (round((x - STATUE[0]) / step), round((y - STATUE[1]) / step), round((z - GROUND) / step))
            if k not in index:
                index[k] = len(V) // 3
                V += [round(c * step, 2) for c in k]
            ids.append(index[k])
        for f in faces:
            for i in range(1, len(f) - 1):
                tri = (ids[f[0]], ids[f[i]], ids[f[i + 1]])
                if len(set(tri)) == 3:
                    F += tri
    return {"v": V, "f": F}


def meshes(msp, layer):
    return [(list(e.vertices), list(e.faces)) for e in msp.query(f'MESH[layer=="{layer}"]')]


def main(src):
    doc = ezdxf.readfile(src)
    msp = doc.modelspace()
    # one entry per building, so the builder can drop or restyle single buildings
    buildings = [pack([m]) for m in meshes(msp, "TPX_BUILDINGS")]
    kinds, trees = {}, []
    for e in msp.query('INSERT[layer=="TPX_VEGETATION_TREES_INDIVIDUAL"]'):
        if e.dxf.name not in kinds:
            zs = [p[2] for m in doc.blocks.get(e.dxf.name).query("MESH") for p in m.vertices]
            xs = [p[0] for m in doc.blocks.get(e.dxf.name).query("MESH") for p in m.vertices]
            kinds[e.dxf.name] = (len(kinds), round(max(zs) - min(zs), 1), round((max(xs) - min(xs)) / 2, 1))
        x, y, z = e.dxf.insert
        trees.append([round(x - STATUE[0], 1), round(y - STATUE[1], 1), round(z - GROUND, 1), kinds[e.dxf.name][0]])
    data = {
        "about": "Trondheim Midtbyen around Torvet. Metres, x east, y true north, z up; origin = the "
                 "Olav Tryggvason column at ground level. Overture Maps (ODbL) and Kartverket (CC BY 4.0).",
        "buildings": buildings,
        "terrain": pack(meshes(msp, "TPX_TERRAIN_TERRAIN_MESH")),
        "roads": pack(meshes(msp, "TPX_ROADS_HATCH")),
        "green": pack(meshes(msp, "TPX_VEGETATION_GREEN_SPACES_HATCH")),
        "water": pack(meshes(msp, "TPX_WATERWAYS_HATCH")),
        "tree_kinds": [[h, r] for _, h, r in sorted(kinds.values())],
        "trees": trees,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with gzip.open(OUT, "wt") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{len(buildings)} buildings, {sum(len(b['f']) for b in buildings) // 3} triangles, "
          f"{len(trees)} trees -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1])
