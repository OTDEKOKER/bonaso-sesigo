"use client";

/**
 * Botswana CSO location map. Renders — and only ever renders — the Botswana
 * national boundary, the district boundaries + names, and one marker per mapped
 * CSO, using the shared SESIGO ECharts engine and the vetted geoBoundaries
 * GeoJSON assets. Markers are coloured + shaped by organisation type; clicking a
 * marker shows the organisation name, type, district, village/town and physical
 * address (where available).
 *
 * Boundary layers: geo[0] districts (the coordinate system the points sit on and
 * the layer the user roams) + geo[1] the national outline drawn on top with a
 * stronger border; both share `boundingCoords` so they line up, and geo[1] is
 * kept in step whenever the user roams.
 *
 * The legend, title and organisation count live ON the ECharts canvas, so the
 * PNG / PDF / Print exports (which rasterise the canvas) contain them and exclude
 * all application chrome. Filters, the legend collapse toggle and the zoom / Fit
 * controls are React overlays and are deliberately never part of an export.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  MapPin,
  Maximize2,
  Printer,
  RefreshCw,
  RotateCcw,
  Sheet,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { EChart, registerSesigoMap, type EChartEventHandlers } from "@/components/analysis/echarts/echart";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { csoMappingService, type CsoLocation } from "@/lib/api/services/csoMapping";
import {
  EXPORT_BASENAME,
  MAP_TITLE,
  exportMapPdf,
  exportMapPng,
  printMap,
} from "@/components/cso-mapping/map-export";

const DISTRICTS_MAP = "botswana-subdistricts";
// Authoritative OCHA/COD-AB sub-district boundaries (28) — the vector behind the
// district map. Its ADM3 localities also back the village→district lookup.
const DISTRICTS_URL = "/geo/botswana-subdistricts.geojson";
const NATIONAL_MAP = "botswana-national";
const NATIONAL_URL = "/geo/botswana-national.geojson";
// Botswana populated-places gazetteer (GeoNames, CC-BY). The form has no
// village/town field, so a CSO's village is DERIVED from its GPS point: the
// nearest settlement within MAX_SETTLEMENT_KM (blank beyond — never guessed
// further). This is the "nearest known settlement", not a respondent's answer.
const SETTLEMENTS_URL = "/geo/botswana-settlements.json";
const MAX_SETTLEMENT_KM = 20;

// [name, latitude, longitude] tuples, as bundled.
type Settlement = [string, number, number];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nearest bundled settlement to the point within the cap, or "" if none/too far. */
function nearestSettlement(lng: number, lat: number, settlements: Settlement[]): string {
  let best = "";
  let bestKm = MAX_SETTLEMENT_KM;
  for (const [name, sLat, sLng] of settlements) {
    // Cheap bounding-box reject before the trig (≈0.25° ~ 27km latitude).
    if (Math.abs(sLat - lat) > 0.25 || Math.abs(sLng - lng) > 0.3) continue;
    const km = haversineKm(lat, lng, sLat, sLng);
    if (km < bestKm) {
      bestKm = km;
      best = name;
    }
  }
  return best;
}

// Shared geo-extent for both layers (tight around Botswana: true bbox is
// lng 19.99..29.37, lat -26.90..-17.78) so the district + national layers align
// exactly and the map fills the frame with minimal white space.
const BOUNDING_COORDS: [[number, number], [number, number]] = [
  [19.85, -17.55],
  [29.55, -27.05],
];
const BW_CENTER: [number, number] = [
  (BOUNDING_COORDS[0][0] + BOUNDING_COORDS[1][0]) / 2,
  (BOUNDING_COORDS[0][1] + BOUNDING_COORDS[1][1]) / 2,
];
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;
const CLUSTER_SERIES = "__clusters__";
const CLUSTER_CELL_PX = 46; // markers within this pixel cell collapse into a cluster

// ── Organisation-type styling (the 11 categories, matched to the backend's
// `organisation_nature` labels). Distinct colour per type; shapes reused across
// types but paired so the common ones stay visually separable. ──────────────
type OrgTypeStyle = { label: string; color: string; symbol: string };
const ORG_TYPE_STYLES: OrgTypeStyle[] = [
  { label: "Non-Governmental Organisation (NGO)", color: "#2563eb", symbol: "circle" },
  { label: "Community-Based Organisation (CBO)", color: "#16a34a", symbol: "triangle" },
  { label: "Faith-Based Organisation (FBO)", color: "#9333ea", symbol: "diamond" },
  { label: "Trust", color: "#d97706", symbol: "rect" },
  { label: "Network, umbrella or coordinating body", color: "#0891b2", symbol: "roundRect" },
  { label: "Association", color: "#dc2626", symbol: "pin" },
  { label: "Foundation", color: "#db2777", symbol: "arrow" },
  { label: "Government or local-authority structure", color: "#475569", symbol: "rect" },
  { label: "Development Partner", color: "#ca8a04", symbol: "diamond" },
  { label: "Private-sector organisation", color: "#0d9488", symbol: "triangle" },
  { label: "Other", color: "#64748b", symbol: "circle" },
];
const OTHER_LABEL = "Other";
const ORG_STYLE_BY_LABEL = new Map(ORG_TYPE_STYLES.map((s) => [s.label, s]));

/** Map a raw organisation-type string to one of the known categories. */
function categoryOf(orgType: string): string {
  const t = (orgType || "").trim();
  return t && ORG_STYLE_BY_LABEL.has(t) ? t : OTHER_LABEL;
}

type BoundaryState = "loading" | "ready" | "error";
type BusyExport = null | "png" | "pdf" | "excel" | "geojson" | "print";

/** Escape a dynamic value before it is placed into tooltip HTML. */
function esc(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function orNotProvided(value: string): string {
  return value && value.trim() ? esc(value) : "Not provided";
}

// ── Point-in-polygon: label a plotted point with its district from coordinates ──
type Ring = number[][];
type Geometry = { type: string; coordinates: unknown };
type DistrictFeature = { properties?: { name?: string }; geometry: Geometry };

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lng: number, lat: number, geom: Geometry): boolean {
  const polys =
    geom.type === "Polygon"
      ? [geom.coordinates as Ring[]]
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as Ring[][])
        : [];
  for (const poly of polys) {
    if (poly.length && pointInRing(lng, lat, poly[0])) {
      // Inside the outer ring — exclude if it falls in a hole.
      let inHole = false;
      for (let h = 1; h < poly.length; h += 1) {
        if (pointInRing(lng, lat, poly[h])) inHole = true;
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/** The district whose polygon contains the coordinate, or "" if none. */
function districtForPoint(lng: number, lat: number, features: DistrictFeature[]): string {
  for (const f of features) {
    if (f.geometry && pointInGeometry(lng, lat, f.geometry)) return f.properties?.name ?? "";
  }
  return "";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A point annotated with its computed district, derived village + resolved
// organisation category.
type AnnotatedPoint = CsoLocation & {
  geoDistrict: string;
  filterDistrict: string;
  village: string;
  category: string;
};
type Cluster = { lng: number; lat: number; count: number };
type ClusterResult = { sig: string; singles: AnnotatedPoint[]; clusters: Cluster[] };

const EMPTY_FILTERS = { district: "", village: "", orgType: "", name: "" };
type Filters = typeof EMPTY_FILTERS;

/**
 * Grid-cluster the points in screen space at the current zoom. Points sharing a
 * ~cell-sized pixel bucket with others collapse into one neutral cluster bubble;
 * the rest render as individual, type-coloured markers. Returns null if the geo
 * layer is not yet laid out (caller retries on the next frame).
 */
function computeClusters(
  chart: EChartsType,
  pts: AnnotatedPoint[],
): { singles: AnnotatedPoint[]; clusters: Cluster[] } | null {
  const convert = (chart as unknown as {
    convertToPixel?: (finder: unknown, value: number[]) => number[] | null;
  }).convertToPixel;
  if (typeof convert !== "function") return null;
  const buckets = new Map<string, AnnotatedPoint[]>();
  for (const p of pts) {
    const px = convert.call(chart, { geoIndex: 0 }, [p.longitude, p.latitude]);
    if (!px || !Number.isFinite(px[0]) || !Number.isFinite(px[1])) return null;
    const key = `${Math.floor(px[0] / CLUSTER_CELL_PX)}:${Math.floor(px[1] / CLUSTER_CELL_PX)}`;
    const group = buckets.get(key);
    if (group) group.push(p);
    else buckets.set(key, [p]);
  }
  const singles: AnnotatedPoint[] = [];
  const clusters: Cluster[] = [];
  for (const group of buckets.values()) {
    if (group.length >= 2) {
      const lng = group.reduce((s, g) => s + g.longitude, 0) / group.length;
      const lat = group.reduce((s, g) => s + g.latitude, 0) / group.length;
      clusters.push({ lng, lat, count: group.length });
    } else {
      singles.push(group[0]);
    }
  }
  return { singles, clusters };
}

export function BotswanaCsoMap() {
  const { toast } = useToast();
  const chartRef = useRef<EChartsType | null>(null);

  const [boundaryState, setBoundaryState] = useState<BoundaryState>("loading");
  const [districtFeatures, setDistrictFeatures] = useState<DistrictFeature[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [points, setPoints] = useState<CsoLocation[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyExport>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [clusterResult, setClusterResult] = useState<ClusterResult | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const [roamTick, setRoamTick] = useState(0);
  const roamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the vetted boundary assets (district polygons + national outline) and
  // register both with ECharts.
  useEffect(() => {
    let alive = true;
    setBoundaryState("loading");
    Promise.all([
      fetch(DISTRICTS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error("districts")))),
      fetch(NATIONAL_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error("national")))),
    ])
      .then(([districts, national]) => {
        if (!alive) return;
        registerSesigoMap(DISTRICTS_MAP, districts);
        registerSesigoMap(NATIONAL_MAP, national);
        setDistrictFeatures(districts?.features ?? []);
        setBoundaryState("ready");
      })
      .catch(() => {
        if (alive) setBoundaryState("error");
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Load the settlements gazetteer (non-blocking: the map works without it —
  // village/town simply stays "Not provided" if it fails to load).
  useEffect(() => {
    let alive = true;
    fetch(SETTLEMENTS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("settlements"))))
      .then((data: { places?: Settlement[] }) => {
        if (alive && Array.isArray(data?.places)) setSettlements(data.places);
      })
      .catch(() => {
        /* leave settlements empty — village derivation is skipped */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Load the map-safe CSO locations.
  const loadPoints = useCallback(() => {
    setDataLoading(true);
    setDataError(null);
    csoMappingService
      .locations()
      .then((rows) => setPoints(rows))
      .catch(() => setDataError("Could not load CSO locations. Please try again."))
      .finally(() => setDataLoading(false));
  }, []);
  useEffect(() => {
    loadPoints();
  }, [loadPoints, reloadKey]);

  // Annotate each point with its district (from coordinates) + organisation
  // category, once per data/boundary change.
  const annotatedPoints = useMemo<AnnotatedPoint[]>(
    () =>
      points.map((p) => {
        const geoDistrict = districtForPoint(p.longitude, p.latitude, districtFeatures);
        // Prefer a respondent-stated village if one ever exists; otherwise derive
        // the nearest known settlement from the coordinate.
        const stated = (p.village_town || "").trim();
        const village = stated || nearestSettlement(p.longitude, p.latitude, settlements);
        return {
          ...p,
          geoDistrict,
          filterDistrict: (geoDistrict || p.district || "").trim(),
          village,
          category: categoryOf(p.organisation_type),
        };
      }),
    [points, districtFeatures, settlements],
  );

  // Stable option lists for the filter dropdowns (from ALL points).
  const filterOptions = useMemo(() => {
    const districts = new Set<string>();
    const villages = new Set<string>();
    const orgTypes = new Set<string>();
    for (const p of annotatedPoints) {
      if (p.filterDistrict) districts.add(p.filterDistrict);
      if (p.village) villages.add(p.village);
      orgTypes.add(p.category);
    }
    const byOrder = (a: string, b: string) => {
      const ia = ORG_TYPE_STYLES.findIndex((s) => s.label === a);
      const ib = ORG_TYPE_STYLES.findIndex((s) => s.label === b);
      return ia - ib;
    };
    return {
      districts: [...districts].sort((a, b) => a.localeCompare(b)),
      villages: [...villages].sort((a, b) => a.localeCompare(b)),
      orgTypes: [...orgTypes].sort(byOrder),
    };
  }, [annotatedPoints]);

  const filteredPoints = useMemo(() => {
    const name = filters.name.trim().toLowerCase();
    return annotatedPoints.filter((p) => {
      if (filters.district && p.filterDistrict !== filters.district) return false;
      if (filters.village && p.village !== filters.village) return false;
      if (filters.orgType && p.category !== filters.orgType) return false;
      if (name && !(p.cso_name || "").toLowerCase().includes(name)) return false;
      return true;
    });
  }, [annotatedPoints, filters]);

  // Per-category counts (from the filtered set) — drive the legend labels.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of filteredPoints) c[p.category] = (c[p.category] ?? 0) + 1;
    return c;
  }, [filteredPoints]);

  // Categories currently on the map, in canonical order (legend rows).
  const categoriesPresent = useMemo(
    () => ORG_TYPE_STYLES.filter((s) => (counts[s.label] ?? 0) > 0).map((s) => s.label),
    [counts],
  );

  // Signature identifying the current point set; clusters are only trusted while
  // their signature matches (otherwise we fall back to individual markers).
  const pointsSig = useMemo(
    () =>
      `${filters.district}|${filters.village}|${filters.orgType}|${filters.name}|` +
      filteredPoints.map((p) => p.id).join(","),
    [filteredPoints, filters],
  );

  const filtersActive =
    !!filters.district || !!filters.village || !!filters.orgType || !!filters.name;

  const option = useMemo<EChartsCoreOption>(() => {
    const baseGeo = {
      map: DISTRICTS_MAP,
      boundingCoords: BOUNDING_COORDS,
      // Preserve Botswana's geographic proportions instead of stretching the
      // map to all four edges of a wide chart container. Both geo layers inherit
      // these exact layout settings, so the districts and national outline stay
      // perfectly aligned.
      layoutCenter: ["55%", "56%"],
      layoutSize: "78%",
      aspectScale: 1,
    };
    const districtsGeo = {
      ...baseGeo,
      z: 1,
      roam: true,
      // NB: center/zoom are intentionally omitted here. The option is re-applied
      // with replaceMerge:['series'] (see EChart preserveGeoRoam), so the geo
      // component is merged — hardcoding a view would reset the user's roam on
      // every filter/legend/cluster update. Initial fit comes from boundingCoords;
      // the zoom/Fit controls set the view imperatively.
      itemStyle: { areaColor: "#eef3f7", borderColor: "#c3d0db", borderWidth: 0.6 },
      emphasis: { disabled: true },
      select: { disabled: true },
      // District names with a white halo for readability over the fill/points.
      label: {
        show: true,
        fontSize: 9,
        color: "#5b6b7a",
        textBorderColor: "rgba(255,255,255,0.95)",
        textBorderWidth: 3,
      },
    };
    const nationalGeo = {
      ...baseGeo,
      map: NATIONAL_MAP,
      z: 2,
      roam: false,
      silent: true,
      // Stronger, darker outline than the thin internal district borders. View is
      // kept in step with geo[0] via syncNationalOutline on roam.
      itemStyle: { areaColor: "transparent", borderColor: "#1f2d3d", borderWidth: 2.4 },
      label: { show: false },
      emphasis: { disabled: true },
    };

    // Which points render as individual markers vs. are folded into clusters.
    const useClusters = clusterResult !== null && clusterResult.sig === pointsSig;
    const singles = useClusters ? clusterResult!.singles : filteredPoints;

    const byCategory = new Map<string, AnnotatedPoint[]>();
    for (const p of singles) {
      const arr = byCategory.get(p.category);
      if (arr) arr.push(p);
      else byCategory.set(p.category, [p]);
    }

    // One scatter series per present category (created even if all its points are
    // currently clustered, so the legend has a colour source).
    const typeSeries = categoriesPresent.map((label) => {
      const style = ORG_STYLE_BY_LABEL.get(label)!;
      return {
        name: label,
        type: "scatter",
        coordinateSystem: "geo",
        geoIndex: 0,
        symbol: style.symbol,
        symbolSize: 12,
        z: 10,
        itemStyle: { color: style.color, borderColor: "#ffffff", borderWidth: 1.4, opacity: 0.96 },
        emphasis: { scale: 1.35 },
        data: (byCategory.get(label) ?? []).map((p) => ({
          name: p.cso_name,
          value: [p.longitude, p.latitude],
          meta: p,
        })),
      };
    });

    const clusters = useClusters ? clusterResult!.clusters : [];
    const clusterSeries =
      clusters.length > 0
        ? [
            {
              name: CLUSTER_SERIES,
              type: "scatter",
              coordinateSystem: "geo",
              geoIndex: 0,
              symbol: "circle",
              z: 12,
              silent: false,
              symbolSize: (val: number[]) => 18 + Math.min(val[2] ?? 2, 40) * 0.8,
              itemStyle: {
                color: "rgba(30,41,59,0.92)",
                borderColor: "#ffffff",
                borderWidth: 2,
              },
              emphasis: { scale: 1.1 },
              label: {
                show: true,
                formatter: (p: { data?: { count?: number } }) => String(p.data?.count ?? ""),
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 11,
              },
              data: clusters.map((c) => ({ value: [c.lng, c.lat, c.count], count: c.count })),
            },
          ]
        : [];

    const total = filteredPoints.length;
    return {
      title: {
        text: MAP_TITLE,
        subtext: `${total} organisation${total === 1 ? "" : "s"}${filtersActive ? " (filtered)" : ""}`,
        left: "center",
        top: 6,
        textStyle: { fontSize: 16, fontWeight: 600, color: "#0f172a" },
        subtextStyle: { fontSize: 12, color: "#64748b" },
      },
      legend: {
        show: !legendCollapsed,
        type: "scroll",
        orient: "vertical",
        left: 8,
        top: 78,
        itemGap: 6,
        itemWidth: 14,
        itemHeight: 12,
        icon: "circle",
        selectedMode: false,
        backgroundColor: "rgba(255,255,255,0.92)",
        borderColor: "#e2e8f0",
        borderWidth: 1,
        borderRadius: 8,
        padding: [8, 12],
        pageIconSize: 10,
        textStyle: { fontSize: 11, color: "#334155" },
        data: categoriesPresent.map((label) => ({
          name: label,
          icon: ORG_STYLE_BY_LABEL.get(label)!.symbol,
        })),
        formatter: (name: string) => `${name}  (${counts[name] ?? 0})`,
      },
      tooltip: {
        trigger: "item",
        triggerOn: "click",
        confine: true,
        borderColor: "#dbe5ec",
        formatter: (p: {
          seriesName?: string;
          seriesType?: string;
          data?: { count?: number; meta?: AnnotatedPoint };
        }) => {
          if (p.seriesName === CLUSTER_SERIES) {
            const n = p.data?.count ?? 0;
            return (
              `<div style="line-height:1.5"><div style="font-weight:600;color:#0f172a">` +
              `${n} organisation${n === 1 ? "" : "s"} here</div>` +
              `<div style="color:#64748b;font-size:12px">Click to zoom in</div></div>`
            );
          }
          if (p.seriesType !== "scatter") return "";
          const m = p.data?.meta;
          if (!m) return "";
          return (
            `<div style="max-width:260px;line-height:1.5">` +
            `<div style="font-weight:600;color:#0f172a;margin-bottom:2px">${orNotProvided(m.cso_name)}</div>` +
            `<div style="color:#475569"><b>Type:</b> ${orNotProvided(m.category)}</div>` +
            `<div style="color:#475569"><b>District:</b> ${orNotProvided(m.geoDistrict || m.district)}</div>` +
            `<div style="color:#475569"><b>Village/Town:</b> ${orNotProvided(m.village)}</div>` +
            `<div style="color:#475569"><b>Physical address:</b> ${orNotProvided(m.physical_address)}</div>` +
            `</div>`
          );
        },
      },
      geo: [districtsGeo, nationalGeo],
      series: [...typeSeries, ...clusterSeries],
    };
  }, [
    filteredPoints,
    categoriesPresent,
    counts,
    clusterResult,
    pointsSig,
    legendCollapsed,
    filtersActive,
  ]);

  // ── Clustering: recompute in screen space after the geo lays out, and again
  // whenever the point set or the zoom (roamTick) changes. Retries for a few
  // frames until convertToPixel is ready. Tagged with the current signature so a
  // stale result is ignored by the option builder. ──────────────────────────
  useEffect(() => {
    if (boundaryState !== "ready" || !chartReady) return;
    const chart = chartRef.current;
    if (!chart) return;
    let raf = 0;
    let tries = 0;
    const attempt = () => {
      const c = chartRef.current;
      if (!c) return;
      const res = computeClusters(c, filteredPoints);
      if (res) setClusterResult({ sig: pointsSig, ...res });
      else if (tries++ < 6) raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [filteredPoints, pointsSig, boundaryState, chartReady, roamTick]);

  const bumpRoamTick = useCallback(() => {
    if (roamTimer.current) clearTimeout(roamTimer.current);
    roamTimer.current = setTimeout(() => setRoamTick((t) => t + 1), 140);
  }, []);

  // Keep the national outline (geo[1]) aligned with the roamed district layer.
  const syncNationalOutline = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const opt = chart.getOption() as { geo?: Array<{ center?: number[]; zoom?: number }> };
    const g0 = opt.geo?.[0];
    if (!g0) return;
    chart.setOption({ geo: [{}, { center: g0.center, zoom: g0.zoom }] });
  }, []);

  const onEvents = useMemo<EChartEventHandlers>(
    () => ({
      georoam: () => {
        syncNationalOutline();
        bumpRoamTick();
      },
      click: (p: { seriesName?: string; event?: { offsetX?: number; offsetY?: number } }) => {
        if (p.seriesName !== CLUSTER_SERIES) return;
        const chart = chartRef.current;
        if (!chart) return;
        // Zoom in towards the clicked cluster so it splits apart.
        chart.dispatchAction({
          type: "geoRoam",
          geoIndex: 0,
          zoom: 1.8,
          originX: p.event?.offsetX ?? chart.getWidth() / 2,
          originY: p.event?.offsetY ?? chart.getHeight() / 2,
        });
        syncNationalOutline();
        bumpRoamTick();
      },
    }),
    [syncNationalOutline, bumpRoamTick],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const chart = chartRef.current;
      if (!chart) return;
      const opt = chart.getOption() as { geo?: Array<{ center?: number[]; zoom?: number }> };
      const g0 = opt.geo?.[0] ?? {};
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g0.zoom ?? 1) * factor));
      const center = g0.center ?? BW_CENTER;
      chart.setOption({ geo: [{ center, zoom: nextZoom }, { center, zoom: nextZoom }] });
      bumpRoamTick();
    },
    [bumpRoamTick],
  );

  const fitBotswana = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption({
      geo: [
        { center: BW_CENTER, zoom: 1 },
        { center: BW_CENTER, zoom: 1 },
      ],
    });
    bumpRoamTick();
  }, [bumpRoamTick]);

  // Ensure the on-canvas legend is present in raster exports even if the user has
  // collapsed it on screen; restore the collapse state afterwards.
  const withLegendForExport = async (fn: () => Promise<void>) => {
    const chart = chartRef.current;
    const mustReveal = legendCollapsed && chart;
    if (mustReveal) chart!.setOption({ legend: { show: true } });
    try {
      await fn();
    } finally {
      if (mustReveal) chart!.setOption({ legend: { show: false } });
    }
  };

  const runExport = async (kind: Exclude<BusyExport, null>, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch {
      toast({
        title: "Export failed",
        description: "The export could not be generated. Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const requireChart = (): EChartsType => {
    const chart = chartRef.current;
    if (!chart) throw new Error("Map is not ready");
    return chart;
  };

  const chartReadyForExport = boundaryState === "ready";
  const rasterDisabled = !chartReadyForExport || busy !== null;

  const actions: Array<{
    key: Exclude<BusyExport, null>;
    label: string;
    icon: typeof ImageIcon;
    onClick: () => void;
    disabled: boolean;
  }> = [
    {
      key: "png",
      label: "Download Map as PNG",
      icon: ImageIcon,
      onClick: () => runExport("png", () => withLegendForExport(() => exportMapPng(requireChart()))),
      disabled: rasterDisabled,
    },
    {
      key: "pdf",
      label: "Download Map as PDF",
      icon: FileText,
      onClick: () => runExport("pdf", () => withLegendForExport(() => exportMapPdf(requireChart()))),
      disabled: rasterDisabled,
    },
    {
      key: "excel",
      label: "Export Locations to Excel",
      icon: Sheet,
      onClick: () =>
        runExport("excel", async () => {
          const blob = await csoMappingService.exportLocationsWorkbook();
          downloadBlob(blob, `${EXPORT_BASENAME()}.xlsx`);
        }),
      disabled: busy !== null,
    },
    {
      key: "geojson",
      label: "Export GeoJSON",
      icon: Download,
      onClick: () =>
        runExport("geojson", async () => {
          const blob = await csoMappingService.exportLocationsGeoJSON();
          downloadBlob(blob, `${EXPORT_BASENAME()}.geojson`);
        }),
      disabled: busy !== null,
    },
    {
      key: "print",
      label: "Print Map",
      icon: Printer,
      onClick: () => runExport("print", () => withLegendForExport(() => printMap(requireChart()))),
      disabled: rasterDisabled,
    },
  ];

  const mapDescription =
    boundaryState === "ready"
      ? `Map of Botswana showing national and district boundaries with ${filteredPoints.length} civil society organisation location${filteredPoints.length === 1 ? "" : "s"} plotted as points, coloured by organisation type.`
      : "Map of civil society organisations in Botswana.";

  const selectClass =
    "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300";

  return (
    <div className="space-y-4">
      {/* Export toolbar */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Map actions">
        {actions.map((a) => {
          const Icon = a.icon;
          const loading = busy === a.key;
          return (
            <Button
              key={a.key}
              variant="outline"
              size="sm"
              onClick={a.onClick}
              disabled={a.disabled}
              aria-label={a.label}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {a.label}
            </Button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Map filters">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          District
          <select
            className={selectClass}
            value={filters.district}
            onChange={(e) => setFilters((f) => ({ ...f, district: e.target.value }))}
            aria-label="Filter by district"
          >
            <option value="">All districts</option>
            {filterOptions.districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Village/Town
          <select
            className={selectClass}
            value={filters.village}
            onChange={(e) => setFilters((f) => ({ ...f, village: e.target.value }))}
            aria-label="Filter by village or town"
            disabled={filterOptions.villages.length === 0}
          >
            <option value="">All villages/towns</option>
            {filterOptions.villages.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Organisation type
          <select
            className={selectClass}
            value={filters.orgType}
            onChange={(e) => setFilters((f) => ({ ...f, orgType: e.target.value }))}
            aria-label="Filter by organisation type"
          >
            <option value="">All types</option>
            {filterOptions.orgTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Organisation name
          <input
            type="search"
            className={`${selectClass} min-w-[200px]`}
            value={filters.name}
            onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
            placeholder="Search name…"
            aria-label="Filter by organisation name"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFilters(EMPTY_FILTERS)}
          disabled={!filtersActive}
          aria-label="Reset filters"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Reset
        </Button>
      </div>

      {/* Screen-reader description + polite status for data loading. */}
      <p className="sr-only" role="status" aria-live="polite">
        {dataLoading ? "Loading CSO locations…" : mapDescription}
      </p>

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {boundaryState === "error" ? (
          <div className="flex h-[calc(100vh-var(--app-header-height,4rem)-18rem)] min-h-[520px] flex-col items-center justify-center gap-3 p-6 text-center">
            <MapPin className="h-8 w-8 text-amber-500" aria-hidden="true" />
            <p role="alert" className="text-sm font-medium text-slate-700">
              The Botswana map could not be loaded. Please try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : boundaryState === "loading" ? (
          <div
            className="flex h-[calc(100vh-var(--app-header-height,4rem)-18rem)] min-h-[520px] items-center justify-center gap-2 text-sm text-slate-500"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Loading the Botswana map…
          </div>
        ) : (
          // Fixed-height parent: the EChart wrapper renders at height:100%, so it
          // needs an explicitly-sized container or it collapses to a thin strip.
          // Fill the viewport below the app header + page chrome (floor 520px on
          // short screens); mirrors the WorkbookLayoutBuilder full-height pattern.
          <div className="relative h-[calc(100vh-var(--app-header-height,4rem)-18rem)] min-h-[520px] w-full">
            <EChart
              key={reloadKey}
              option={option}
              onEvents={onEvents}
              preserveGeoRoam
              onInit={(chart) => {
                chartRef.current = chart;
                setChartReady(true);
              }}
              ariaLabel={mapDescription}
              className="h-full w-full"
            />

            {/* Legend collapse toggle (top-left, above the on-canvas legend). */}
            <button
              type="button"
              onClick={() => setLegendCollapsed((v) => !v)}
              className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-xs font-medium text-slate-600 shadow-sm hover:bg-white"
              aria-expanded={!legendCollapsed}
              aria-label={legendCollapsed ? "Show legend" : "Hide legend"}
            >
              {legendCollapsed ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {legendCollapsed ? "Show legend" : "Hide legend"}
            </button>

            {/* Zoom / Fit controls (top-right). */}
            <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => zoomBy(1.6)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-white"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => zoomBy(1 / 1.6)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-white"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={fitBotswana}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-white"
                aria-label="Fit Botswana"
                title="Fit Botswana"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Empty state overlay — the Botswana map still shows behind it. */}
            {!dataLoading && !dataError && filteredPoints.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
                <span className="rounded-full border border-slate-200 bg-white/95 px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm">
                  {points.length === 0
                    ? "No CSO locations are available yet."
                    : "No organisations match the current filters."}
                </span>
              </div>
            ) : null}
            {dataError ? (
              <div className="absolute inset-x-0 bottom-16 flex justify-center">
                <span
                  role="alert"
                  className="flex items-center gap-2 rounded-full border border-red-200 bg-white/95 px-4 py-1.5 text-sm font-medium text-red-600 shadow-sm"
                >
                  {dataError}
                  <button
                    type="button"
                    onClick={loadPoints}
                    className="pointer-events-auto underline underline-offset-2"
                  >
                    Retry
                  </button>
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
