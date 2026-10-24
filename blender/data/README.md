# Map data

`trondheim_midtbyen.json.gz` holds about 1 km × 1 km of Trondheim's Midtbyen around
Torvet: building shapes with heights and roofs, terrain, streets, parks, trees and the
river. `blender/trondheim_surroundings.py` (variant v3) builds the town from it, and
`blender/trondheim_mapdata.py` regenerates it from a topoexport.com 3D DXF export.

Sources and licences:

- Buildings, streets, parks, trees and waterways: © Overture Maps Foundation
  (Overture Maps Buildings, Transportation and Base 2026), which includes data
  © OpenStreetMap contributors. Licensed under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  This file is a derived database and is itself made available under the ODbL.
- Terrain: © Kartverket, Høydedata DTM 1 m (2024), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Tree sizes: Meta and World Resources Institute, Global Canopy Height Maps v2,
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The export was made with [topoexport.com](https://topoexport.com).
