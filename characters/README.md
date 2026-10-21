# Characters

Stylized low-poly characters (800 to 2,500 triangles) built by deterministic
bpy scripts. Every character shares one base body, one palette texture and one
material, so the cast looks like it belongs to the same game.

```bash
.venv/bin/python characters/_shared/palette.py                                   # palette.png + palette.json
.venv/bin/python characters/_shared/base_body.py                                 # bare base body
.venv/bin/python characters/bearded_operator/build_bearded_operator.py           # one character
```

Each script writes `<name>.blend`, `<name>.glb` (skinned, with armature),
`turnaround.png`, `closeup.png`, `pose_check.png` and `contact_sheet.png` next
to itself. Never edit the .blend or .glb by hand; change the script.

Reference images never go in this repo. Pass `--reference IMG --private DIR`
to also write a contact sheet next to the reference into a private folder.

## Conventions

- 1.75 m adult, head about 1/6 of the height, A-pose at 45°, origin at the
  feet, +Z up, facing +Y, right hand on +X. glTF export turns this into +Y up
  with the character facing -Z.
- Flat-shaded facets only. Every face maps onto the centre of one 16 px
  swatch in `_shared/palette.png` (nearest filtering), so colours stay flat
  at every mip level. Add colours in empty cells; never move a swatch.
- Faces carry a `region` attribute (torso, thigh, beard...), so a character
  recolours the base body by region and drops faces its clothing covers.
- Rig: root, hips, spine, chest, neck, head, upper_arm, forearm, hand,
  thigh, shin, foot (.L/.R), no finger bones. Bone heat weights on the base
  body; hair, beards and helmets follow one bone, and clothing shells copy
  the weights of the skin under them.

## Cast

| Character | Triangles | Palette | Check |
|---|---|---|---|
| `_shared/base_body` | 654 | undersuit, skin_3, charcoal | Knees crumple a little past 90°, normal for 3-ring joints |
| `bearded_operator` | 868 | skin_2, hair_strawberry, hair_ginger, white, light_grey, navy, leather_brown, charcoal, steel | Lower body invented (reference is a head-and-shoulders shot): shirt tucked in, belt, navy trousers, brown shoes. Beard is a single convex hull, so it reads as a spade from the front but a wedge from the side |
