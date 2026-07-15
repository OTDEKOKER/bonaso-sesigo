"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { fetchGeographicCoverage, fetchManagementIntelligence } from "@/lib/api/services/intelligence";
import type { GeographicCoverageResponse, ManagementIntelligenceResponse } from "@/lib/intelligence/types";
import { IntelligenceCard } from "@/components/intelligence/intelligence-card";
import { CoverageMap } from "@/components/intelligence/coverage-map";

function IntelligenceContent() {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  const [data, setData] = useState<ManagementIntelligenceResponse | null>(null);
  const [coverage, setCoverage] = useState<GeographicCoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const projectId = projectParam ? Number(projectParam) : undefined;
    fetchManagementIntelligence({ projectId })
      .then((res) => alive && setData(res))
      .catch((e) => alive && setError(e?.message ?? "Failed to load management intelligence."))
      .finally(() => alive && setLoading(false));
    fetchGeographicCoverage(projectId)
      .then((res) => alive && setCoverage(res))
      .catch(() => alive && setCoverage(null));
    return () => {
      alive = false;
    };
  }, [projectParam]);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">Management Intelligence</h1>
          {data?.period ? (
            <>
              <span className="rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {data.project.name} · {data.period.label}
              </span>
              {data.period.window_state ? (
                <span className="rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  window: {String(data.period.window_state).replace(/_/g, " ")}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          One decision-ready card per coordinator — what happened, where, why it matters, what needs
          attention, and the recommended action. Approved data only.
        </p>
      </header>

      {coverage && coverage.districts.length > 0 ? (
        <CoverageMap districts={coverage.districts} attribution={coverage.attribution} />
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[560px] animate-pulse rounded-2xl border border-border/60 bg-muted/40" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-[#f3c1c1] bg-[#fdf2f2] px-5 py-4 text-sm text-[#b91c1c]">{error}</div>
      ) : !data?.cards?.length ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
          {data?.detail ?? "No coordinator intelligence available for this project and period."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.cards.map((card) => (
            <IntelligenceCard key={card.coordinator_id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function IntelligencePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <IntelligenceContent />
    </Suspense>
  );
}
