# Secret River map sources

The game map is a cropped vector reconstruction of the Hawkesbury River,
Macdonald River and Wisemans Ferry area. The bundled source files were
downloaded on 28 August 2026 from NSW Spatial Services ArcGIS REST services.

Bounds (WGS84): `150.955,-33.410,151.010,-33.345`

- `source/nsw-hydro-area-main.geojson` — NSW Hydrography, layer 12
  (`HydroArea_Main`), fields `hydroname` and `hydronametype`.
- `source/nsw-road-segments.geojson` — NSW Transport Theme, layer 5
  (`RoadSegment`), with road name, hierarchy and surface fields.
- `source/nsw-ferry-routes.geojson` — NSW Transport Theme, layer 8
  (`FerryRoute`), with the public ferry name.

Source: © State of New South Wales (Spatial Services, a business unit of the
Department of Customer Service). The NSW Hydrography catalogue lists the data
under a [Creative Commons Attribution licence](https://data.nsw.gov.au/data/dataset/nsw-hydrography).

`scripts/build-map-data.mjs` clips, simplifies and normalises those source
features into `src/game/map-data.generated.mjs`. It does not fetch data during
gameplay.
