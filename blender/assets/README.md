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

| File | Source | Licence | Author |
| --- | --- | --- | --- |
| `ivar_aasen_rusti.jpg` | Charcoal portrait of Ivar Aasen, signed "Olav Rusti", scaled down to 800 px greyscale | Public domain (artist died 1920) | Olav Rusti |
| `ivar_aasen_photo.jpg` | Studio photograph of Ivar Aasen (died 1896), print border trimmed, 800 px greyscale | Public domain (19th-century photograph) | Unknown photographer |

`boards.photo_print()` puts them in the desk photo frames (`props.make_photo_frame`,
`control_room.PHOTO_FRAMES`).
