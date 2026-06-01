"use client";

import { useMemo } from "react";

import { ChartInsightFooter } from "@/components/analysis/chart-theme";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReportingCompletenessSummary } from "@/lib/analytics/query-builder";
import type { Organization } from "@/lib/types";

type ReportingCompletenessProps = {
  title: string;
  summary: ReportingCompletenessSummary;
  organizationsById: Map<string, Organization>;
};

function resolveOrgName(
  organizationsById: Map<string, Organization>,
  organizationId: string,
) {
  return organizationsById.get(organizationId)?.name || `Org ${organizationId}`;
}

export function ReportingCompleteness(props: ReportingCompletenessProps) {
  const { title, summary, organizationsById } = props;

  const submittedItems = useMemo(
    () =>
      summary.submittedOrgIds
        .map((orgId) => {
          const id = String(orgId);
          return {
            id,
            name: resolveOrgName(organizationsById, id),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [organizationsById, summary.submittedOrgIds],
  );

  const missingItems = useMemo(
    () =>
      summary.missingOrgIds
        .map((orgId) => {
          const id = String(orgId);
          return {
            id,
            name: resolveOrgName(organizationsById, id),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [organizationsById, summary.missingOrgIds],
  );

  const totalOrganizations = summary.submittedCount + summary.missingCount;

  const submittedPercent = Number.isFinite(summary.submittedPercent)
    ? summary.submittedPercent.toFixed(1)
    : "0.0";

  const missingPercent = Number.isFinite(summary.missingPercent)
    ? summary.missingPercent.toFixed(1)
    : "0.0";

  return (
    <Card className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <CardHeader className="gap-1.5 border-b border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.88)_100%)] px-5 py-4">
        <CardTitle className="text-base font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Submission coverage for organizations in the current dashboard scope.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 px-5 py-4">
        {totalOrganizations === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            No organizations are available in the current dashboard scope.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700/80">
                Submitted
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-3xl font-semibold tracking-[-0.03em] text-foreground">
                  {summary.submittedCount}
                </div>
                <div className="text-sm font-medium text-emerald-700">
                  {submittedPercent}%
                </div>
              </div>
              <div className="mt-3 max-h-[180px] overflow-auto rounded-xl border border-white/80 bg-background/90 px-3 py-3 text-sm text-slate-700">
                {submittedItems.length === 0 ? (
                  <div className="text-muted-foreground">No organizations submitted.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {submittedItems.map((item) => (
                      <li key={`submitted-${item.id}`}>{item.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800/80">
                Missing
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-3xl font-semibold tracking-[-0.03em] text-foreground">
                  {summary.missingCount}
                </div>
                <div className="text-sm font-medium text-amber-800">
                  {missingPercent}%
                </div>
              </div>
              <div className="mt-3 max-h-[180px] overflow-auto rounded-xl border border-white/80 bg-background/90 px-3 py-3 text-sm text-slate-700">
                {missingItems.length === 0 ? (
                  <div className="text-muted-foreground">No missing organizations.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {missingItems.map((item) => (
                      <li key={`missing-${item.id}`}>{item.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        <ChartInsightFooter
          text={`${summary.submittedCount} of ${totalOrganizations} organizations submitted data in the active scope.`}
        />
      </CardContent>
    </Card>
  );
}