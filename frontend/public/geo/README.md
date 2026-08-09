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
Avoid GADM for production (non-commercial licence). Prefer a simplified
geometry (smaller payload) for the web.

### Committed files (vetted)
Two boundary files are now committed here and used by the CSO Mapping map
(`/cso-mapping-map`) — the districts file is also reused by the intelligence
'Where' choropliceth:

- `botswana-districts.geojson` — 10 admin-1 districts, `properties.name`
  normalised to the SESIGO labels (Gaborone is a city, not an ADM1 unit, so it
  is not a separate polygon in this source).
- `botswana-national.geojson` — the single national (ADM0) outline, drawn as a
  distinct national boundary layer on the CSO map.
- `botswana-subdistricts.geojson` — the 28 **sub-districts (ADM2)** used by the
  CSO map's district layer. CSO points are labelled with their district by
  point-in-polygon against these. **Source:** OCHA / COD-AB "Botswana –
  Subnational Administrative Boundaries" (2011) via HDX (data.humdata.org),
  CC-BY 3.0 IGO; converted from shapefile with pyshp, coordinates rounded to 3dp.
  The same dataset's ADM3 layer (519 localities, each tagged with its ADM2
  district) is the source for a future district→village dropdown.
- `botswana-settlements.json` — Botswana **populated places** gazetteer (1,820
  points, `[name, latitude, longitude]`). The questionnaire has no village/town
  field, so the CSO map DERIVES each point's village/town as the nearest
  settlement within 20 km (blank beyond — never guessed further; it is the
  "nearest known settlement", not a respondent's answer). **Source:** GeoNames
  (geonames.org), `BW.zip` export dump, feature class `P`, CC-BY 4.0 — attribute
  the source. To refresh: download `download.geonames.org/export/dump/BW.zip`,
  keep rows with `feature_class == 'P'`, emit `[name, lat, lng]`.

**Source:** geoBoundaries (geoboundaries.org), release `gbOpen` BWA ADM1/ADM0
(year 2017), simplified geometry. ADM1 licence CC-BY-SA 2.0; ADM0 public domain.
Attribution is also carried in each file's top-level `attribution` property.
To refresh, re-run the download-and-normalise step documented in the CSO
Mapping feature notes (raw shapeName → normalised `name`).
