"""
Control room props for story mode's live slides, built by the same
functions as the room so they look the same.

    python blender/story_props_export.py

Writes web/public/story/props/workstation.glb: one desk monitor
(control_room.monitor, white bezel, its stand's foot at y 0) and one operator
chair (props.make_chair, sitter facing -Z in three.js axes, the monitor's
screen facing +Z). The screen is a plain emissive material named "Screen" so
the slide can paint its own picture on it (web/src/story/vscode.js).
Seconds to run; no bake needed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402  (imports bpy)
import control_room as cr  # noqa: E402
import props  # noqa: E402
from intro_export import export  # noqa: E402

bpy, Vector = b.bpy, b.Vector

OUT = os.path.join(b.ROOT, "web", "public", "story", "props")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    m = cr.materials()
    screen = cr.emissive("Screen", (0.62, 0.70, 0.80), 1.0)

    # The monitor at the origin, screen toward -Y (three's +Z); then lower the
    # whole thing so the stand's foot stands on z 0 instead of the desk shelf
    before = set(bpy.data.objects)
    mon = cr.monitor("Monitor", Vector((0, 0, cr.MON_Z0 + cr.MON_H / 2)), 0.0, m, screen)
    parts = [o for o in bpy.data.objects if o not in before]
    top = cr.DESK_Z + cr.SHELF_H
    for o in parts:
        if o.parent is None:
            o.location.z -= top
    mon.children[1].name = "MonitorScreen"

    # The chair 0.75 m back, its sitter facing the screen (+Y in Blender)
    chair = props.make_chair(props.materials(), "Chair")
    props.place(chair, 0.0, -0.75, 0.0, 0.0)

    export(os.path.join(OUT, "workstation.glb"), parts + [chair] + list(chair.children_recursive))


if __name__ == "__main__":
    main()
