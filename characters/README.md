# Characters

Stylized low-poly characters (800 to 2,500 triangles) built by deterministic
bpy scripts. Every character shares one base body, one palette texture and one
material, so the cast looks like it belongs to the same game.

```bash
.venv/bin/python characters/_shared/palette.py                                   # palette.png + palette.json
.venv/bin/python characters/_shared/base_body.py                                 # bare base body
.venv/bin/python characters/bearded_operator/build_bearded_operator.py           # one character
for f in characters/*/build_*.py; do .venv/bin/python $f; done                    # the whole cast
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
  body, then the limbs get clean hinge weights (rigid segments, one shared
  ring at each knee and elbow, pelvis on the hips bone). Hair, beards and
  helmets follow one bone, and clothing shells copy the weights of the skin
  under them.
- Outfits (`_shared/outfits.py`) are shells built from the base body's own
  rings, so they fit every character: `ppe` (Aker BP hi-vis jacket with
  the ribbon logo on the back and chest pocket, navy lower sleeves and
  trousers, reflective bands, safety boots) and `ppe_deck` (adds a white
  helmet with logo sticker, blue ear defenders on black clip arms from the
  helmet's side slots, wraparound safety glasses drawn as frame and clear
  side shields, gloves).
  Logos are flat polygons projected onto the shell (`Mesh.decal_poly`). A character script builds every outfit by default
  (`--outfit office|ppe|ppe_deck|all`); each one writes its own
  `<name>_<outfit>.glb` on the same rig, plus suffixed renders.
- Shared kit for the crew: `hair.py` (a cap that hugs the skull from a
  hairline per head angle, plus styles: side sweep, swept up, curly top on
  a fade, swept back, curly mullet, buzz), `faces.py` (stubble, short
  beard, goatee as shells on the head's flat facets with a gap at the
  mouth, and an open or closed smile), `clothes.py` (shirt and polo
  collars, plackets and buttons, sweaters with crew or zip necks, an open
  blazer with lapels, short or long sleeves, belt, watch) and
  `accessories.py` (glasses in four styles, a headset). `crew.py` turns a
  short `Look` into all three outfits, so the newer character scripts are
  just a list of choices. Characters with their own glasses keep them on
  deck instead of the clear safety specs.
- Renders use a neutral white studio light (`STUDIO_LIGHT`) so colours
  stay true to the palette; Blender's built-in ones are tinted.
- `pose_check.png` shows reach, seated and crouch poses, grounded with the
  feet kept flat.

## Cast

| Character | Triangles | Palette | Check |
|---|---|---|---|
| `_shared/base_body` | 654 | undersuit, skin_3, charcoal | Past about 120° the calf passes into the thigh |
| `bearded_operator` | 878 | skin_2, hair_strawberry, hair_ginger, white, light_grey, navy, leather_brown, charcoal, steel | Outfits: office 878, `ppe` 1,000, `ppe_deck` 1,489 triangles. Hair variants `side_part` (live), `quiff`, `crop`: `--hair` or `HAIR_STYLE`. Lower body invented (reference is a head-and-shoulders shot): shirt tucked in, belt, navy trousers, brown shoes. Beard is a single convex hull, so it reads as a spade from the front but a wedge from the side |
| `blazer_lead` | 951 | skin_2, hair_dark_brown, stubble, navy, coverall_navy, white, charcoal, leather_brown | `ppe` 1,022, `ppe_deck` 1,509. Navy blazer open over a white shirt, side-swept hair, light stubble. Lower body invented |
| `curly_fade_tech` | 980 | skin_2, hair_dark_brown, hair_fade, stubble, black, charcoal, white, denim, lip_dark, teeth | `ppe` 1,122, `ppe_deck` 1,517. Curly top on a skin fade, big open smile, black button shirt. Reference is black and white, so the colours are guesses. Lower body invented |
| `glasses_engineer` | 994 | skin_2, hair_brown, stubble_dark, navy, coverall_navy, white, steel, charcoal, grey, leather_brown | `ppe` 1,110, `ppe_deck` 1,443. Zip-neck sweater, thin dark glasses (kept on deck), open smile. Lower body invented |
| `grey_beard_lead` | 1,032 | skin_2, hair_salt_pepper, hair_grey, navy, coverall_navy, light_blue, steel, charcoal, black | `ppe` 1,150, `ppe_deck` 1,455. Wavy hair swept back, greyer temples, short grey beard, thin metal glasses, crew-neck sweater over a blue collar. Built from the newest references of the same man |
| `crop_supervisor` | 814 | skin_2, hair_light_brown, pale_blue, light_blue, white, navy, black, lip | `ppe` 958, `ppe_deck` 1,467. Very short receding crop, clean-shaven, closed smile, pale blue shirt. Reference is black and white, so the colours are guesses |
| `curly_analyst` | 1,220 | skin_3, hair_dark_brown, stubble, stubble_dark, turquoise, turquoise_dark, hivis_orange, plastic_black, khaki, leather_brown | `ppe` 1,304, `ppe_deck` 1,575. Curly mullet receding on top, dark glasses, goatee, turquoise polo, orange watch. Two references of the same man. `HEADSET = True` adds the shared headset (off in the live look) |
