"use client";

/**
 * The 'Where' geographic layer. Renders a Botswana district **choropleth** when
 * an approved GeoJSON is present at /geo/botswana-districts.geojson, and an exact
 * **ranked bar** fallback when it isn't (so the layer is honest + useful without
 * any boundary file). Coloured by orgs-present per district — presence is exact;
 * we never sum approved values per district (org coverage is multi-district).
 */
import { useEffect, useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";

import { EChart, registerSesigoMap } from "@/components/analysis/echarts/echart";
import { whereBarOption } from "@/components/analysis/echarts/options";
import { SESIGO_CHART_PALETTE } from "@/lib/chart-theme";
import type { DistrictCoverage } from "@/lib/intelligence/types";

const MAP_NAME = "botswana-districts";
const GEOJSON_URL = "/geo/botswana-districts.geojson";
// Name-property keys used across common public Botswana boundary sources.
const NAME_KEYS = ["name", "NAME_1", "shapeName", "district", "ADM1_EN", "DISTRICT"];

function detectNameProp(geojson: { features?: Array<{ properties?: Record<string, unknown> }> }): string {
  const props = geojson?.features?.[0]?.properties ?? {};
  return NAME_KEYS.find((k) => k in props) ?? "name";
}

export function CoverageMap({
  districts,
  attribution,
}: {
  districts: DistrictCoverage[];
  attribution: string;
}) {
  // null = loading the geojson, false = not present (fallback), true = map ready
  const [mapReady, setMapReady] = useState<boolean | null>(null);
  const [nameProp, setNameProp] = useState("name");

  useEffect(() => {
    let alive = true;
    fetch(GEOJSON_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no geojson"))))
      .then((geojson) => {
        if (!alive) return;
        registerSesigoMap(MAP_NAME, geojson);
        setNameProp(detectNameProp(geojson));
        setMapReady(true);
      })
      .catch(() => {
        if (alive) setMapReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const maxOrgs = useMemo(() => Math.max(1, ...districts.map((d) => d.orgs_present)), [districts]);
  const coordByName = useMemo(
    () => Object.fromEntries(districts.map((d) => [d.district, d.coordinators_present])),
    [districts],
  );

  const option = useMemo<EChartsCoreOption>(() => {
    if (mapReady) {
      return {
        tooltip: {
          trigger: "item",
          formatter: (p: { name?: string; value?: number }) => {
            const c = coordByName[p.name ?? ""] ?? 0;
            return `${p.name}<br/>${p.value ?? 0} org(s) present · ${c} coordinator(s)`;
          },
        },
        visualMap: {
          min: 0,
          max: maxOrgs,
          left: "left",
          bottom: "4%",
          calculable: true,
          text: ["more", "fewer"],
          inRange: { color: ["#e6f2f9", SESIGO_CHART_PALETTE[0], SESIGO_CHART_PALETTE[5]] },
        },
        series: [
          {
            type: "map",
            map: MAP_NAME,
            nameProperty: nameProp,
            roam: false,
            label: { show: false },
            emphasis: { label: { show: true }, itemStyle: { areaColor: "#f1a100" } },
            itemStyle: { borderColor: "#ffffff", borderWidth: 0.6, areaColor: "#f1f5f9" },
            data: districts.map((d) => ({ name: d.district, value: d.orgs_present })),
          },
        ],
      };
    }
    // fallback — exact ranked bar, no geojson required
    return whereBarOption(districts.map((d) => ({ name: d.district, value: d.orgs_present })));
  }, [mapReady, districts, maxOrgs, nameProp, coordByName]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Where — geographic coverage</div>
          <div className="text-[11px] text-muted-foreground">Organisations present per district · {attribution}</div>
        </div>
        {mapReady === false ? (
          <span className="shrink-0 rounded-full border border-[#f4dfba] bg-[#fffbeb] px-2 py-0.5 text-[10px] font-medium text-[#b45309]">
            ranked view · add /geo/botswana-districts.geojson to enable the map
          </span>
        ) : null}
      </div>
      <div className="h-[360px] w-full p-2">
        {mapReady === null ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <EChart option={option} ariaLabel="Geographic coverage" className="h-full w-full" />
        )}
      </div>
    </div>
  );
}
