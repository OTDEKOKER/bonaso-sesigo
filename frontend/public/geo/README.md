# Botswana districts GeoJSON (drop-in for the intelligence 'Where' map)

The Management Intelligence page (`/intelligence`) renders a Botswana **district
choropleth** when a boundary file is present here, and an exact **ranked bar**
fallback when it is not — so the feature works either way.

## To enable the choropleth
Place an approved boundary file at:

```
frontend/public/geo/botswana-districts.geojson
```

Requirements:
- **Format:** a GeoJSON `FeatureCollection` of Botswana admin-1 districts.
- **Region name property:** each feature's `properties` must carry the district
  name under one of: `name`, `NAME_1`, `shapeName`, `district`, `ADM1_EN`,
  `DISTRICT` (auto-detected by `CoverageMap`).
- **Names must match** the normalised labels the backend emits
  (`analysis/services/geography.py`): `Central`, `North West`, `Kweneng`,
  `Gaborone`, `Southern`, `North East`, `Kgatleng`, `South East`, `Chobe`,
  `Kgalagadi`, `Ghanzi`. If your source uses different spellings, either rename
  in the file or extend the normalisation map.

## Provenance / licensing
Use a source whose licence permits redistribution in this repo, e.g.:
- **geoBoundaries** (CC-BY 4.0) — attribute the source.
- **Natural Earth** (public domain).
Avoid GADM for production (non-commercial licence). This file is intentionally
**not committed** — the operator supplies a vetted one. Prefer a simplified
geometry (smaller payload) for the web.
