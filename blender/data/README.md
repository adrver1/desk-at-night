# Map data

`trondheim_midtbyen.json.gz` holds about 1 km × 1 km of Trondheim's Midtbyen around
Torvet: building shapes with heights and roofs, terrain, streets, parks, trees and the
river. `blender/trondheim_surroundings.py` (variant v3) builds the town from it, and
`blender/trondheim_mapdata.py` regenerates it from a topoexport.com 3D DXF export.

`trondheim_wide.json.gz` is the horizon around that core: building outlines out to
~4 km and terrain out to ~14 km. `blender/trondheim_widedata.py` downloads it again
from Overture's public S3 bucket and the Terrain Tiles on AWS.

Sources and licences:

- Buildings, streets, parks, trees and waterways: © Overture Maps Foundation
  (Overture Maps Buildings, Transportation and Base 2026), which includes data
  © OpenStreetMap contributors. Licensed under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  These files are derived databases and are themselves made available under the ODbL.
- Terrain: © Kartverket, Høydedata DTM 1 m (2024), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Tree sizes: Meta and World Resources Institute, Global Canopy Height Maps v2,
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Horizon terrain: Terrain Tiles on AWS (Mapzen / Tilezen), compiled from public
  elevation sources; see the
  [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

The core export was made with [topoexport.com](https://topoexport.com).
