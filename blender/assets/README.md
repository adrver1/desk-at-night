# Third-party models

Meshes here come from openly licensed sources. `blender/import_assets.py` converts them: it
keeps the shape, turns the texture into a few flat colours, and writes a small `.glb` with no
textures. `props.py` maps those colours onto our prop materials.

| File | Source | Licence | Author |
| --- | --- | --- | --- |
| `electric_kettle.glb` | [Electric Keetle](https://opengameart.org/content/electric-keetle), OpenGameArt (`electrickeetle.blend`) | CC0 | DREAM_SEARCH_REPEAT |

To rebuild it:

    .venv/bin/python blender/import_assets.py -- --kettle path/to/electrickeetle.blend

## Images

The desk photo frames (`props.make_photo_frame`, `control_room.PHOTO_FRAMES`)
show pictures `boards.photo_print()` draws itself. The private build's
portraits are not in this repo (`boards.PRIVATE_PICTURES`).
