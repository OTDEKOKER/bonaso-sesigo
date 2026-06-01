"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { aggregatesService } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { Aggregate } from "@/lib/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractTotal(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (v.total != null) return Number(v.total) || 0;
    return (Number(v.male) || 0) + (Number(v.female) || 0);
  }
  return 0;
}

function quarterLabel(periodStart: string): string {
  const d = new Date(periodStart);
  const m = d.getMonth() + 1;
  if (m === 5 || m === 6) return "Q1";
  if (m >= 7 && m <= 9) return "Q2";
  if (m >= 10 && m <= 12) return "Q3";
  return "Q4";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── types ────────────────────────────────────────────────────────────────────

interface FlaggedGroup {
  key: string;
  orgName: string;
  periodStart: string;
  periodEnd: string;
  median: number;
  aggregates: Aggregate[];
}

// ─── group flagged aggregates by org+period ───────────────────────────────────

function groupFlaggedAggregates(aggregates: Aggregate[]): FlaggedGroup[] {
  const map = new Map<string, Aggregate[]>();
  for (const agg of aggregates) {
    const key = `${agg.organization}__${agg.period_start}__${agg.period_end}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(agg);
  }
  const groups: FlaggedGroup[] = [];
  for (const [key, aggs] of map.entries()) {
    const totals = aggs.map((a) => extractTotal(a.value)).filter((t) => t > 0);
    const sorted = [...totals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    groups.push({
      key,
      orgName: aggs[0].organization_name ?? `Org #${aggs[0].organization}`,
      periodStart: aggs[0].period_start,
      periodEnd: aggs[0].period_end,
      median,
      aggregates: aggs,
    });
  }
  return groups.sort((a, b) => a.orgName.localeCompare(b.orgName));
}

// ─── AggRow ───────────────────────────────────────────────────────────────────

function AggRow({ agg }: { agg: Aggregate }) {
  const total = extractTotal(agg.value);
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0 text-sm">
      <span className="text-muted-foreground truncate max-w-[70%]">
        {agg.indicator_code ? (
          <span className="font-mono text-xs mr-1 text-foreground/60">{agg.indicator_code}</span>
        ) : null}
        {agg.indicator_name ?? `Indicator #${agg.indicator}`}
      </span>
      <span className="font-semibold tabular-nums text-destructive">{total.toLocaleString()}</span>
    </div>
  );
}

// ─── GroupCard ────────────────────────────────────────────────────────────────

function GroupCard({
  group,
  onUnflag,
  unflagging,
}: {
  group: FlaggedGroup;
  onUnflag: (group: FlaggedGroup) => void;
  unflagging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const quarter = quarterLabel(group.periodStart);

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold truncate">{group.orgName}</CardTitle>
              <Badge variant="outline" className="text-xs shrink-0">
                {quarter} &mdash; {formatDate(group.periodStart)}
              </Badge>
              <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-xs shrink-0">
                {group.aggregates.length} indicators &nbsp;&bull;&nbsp; all &asymp;{group.median.toLocaleString()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Same value reported across {group.aggregates.length} different indicators &mdash; likely beneficiary total copied.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-primary shrink-0 h-7 text-xs px-2"
            onClick={() => onUnflag(group)}
            disabled={unflagging}
          >
            {unflagging ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <CheckCircle2 className="h-3 w-3 mr-1" />
            )}
            Verified correct
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide" : "Show"} indicators
        </button>
        {expanded && (
          <div className="rounded border border-border/40 bg-muted/20 px-3 py-1">
            {group.aggregates.map((agg) => (
              <AggRow key={agg.id} agg={agg} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const SWR_KEY = ["aggregates-flagged-dq"];

export default function DataQualityPage() {
  const { toast } = useToast();

  const { data, isLoading, mutate } = useSWR(SWR_KEY, async () => {
    const result = await aggregatesService.list({
      status: "flagged",
      page_size: "500",
    });
    return (result.results ?? []) as Aggregate[];
  });

  const groups = useMemo(() => groupFlaggedAggregates(data ?? []), [data]);

  // Unflag dialog state
  const [pendingGroup, setPendingGroup] = useState<FlaggedGroup | null>(null);
  const [unflagNotes, setUnflagNotes] = useState("");
  const [unflagging, setUnflagging] = useState(false);

  // Re-detect state
  const [detecting, setDetecting] = useState(false);

  async function handleUnflagConfirm() {
    if (!pendingGroup) return;
    setUnflagging(true);
    try {
      await Promise.all(
        pendingGroup.aggregates.map((agg) =>
          aggregatesService.unflag(Number(agg.id), unflagNotes)
        )
      );
      toast({
        title: "Records verified",
        description: `${pendingGroup.aggregates.length} aggregates for ${pendingGroup.orgName} marked as approved.`,
      });
      setPendingGroup(null);
      setUnflagNotes("");
      mutate();
    } catch {
      toast({ title: "Error", description: "Could not unflag records.", variant: "destructive" });
    } finally {
      setUnflagging(false);
    }
  }

  async function handleReDetect() {
    setDetecting(true);
    try {
      const result = await aggregatesService.detectCopyPaste({ min_count: 5, tolerance: 0.05 });
      toast({
        title: "Detection complete",
        description: `${result.groups_detected ?? 0} groups found, ${result.flags_created ?? 0} new flags created.`,
      });
      mutate();
    } catch {
      toast({ title: "Error", description: "Detection failed.", variant: "destructive" });
    } finally {
      setDetecting(false);
    }
  }

  const totalAggregates = data?.length ?? 0;
  const totalOrgs = groups.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data Quality Review"
        description="Aggregates flagged for copy-paste data entry patterns"
        actions={
          <Button variant="outline" size="sm" onClick={handleReDetect} disabled={detecting}>
            {detecting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Re-run detection
          </Button>
        }
      />

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">Flagged aggregates</span>
            </div>
            <p className="text-2xl font-bold mt-1">{totalAggregates.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground">Organizations affected</span>
            </div>
            <p className="text-2xl font-bold mt-1">{totalOrgs}</p>
          </CardContent>
        </Card>
        <Card className="sm:col-span-1 col-span-2">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Status</span>
            </div>
            <p className="text-sm font-medium mt-1 text-muted-foreground">
              {totalAggregates === 0
                ? "No issues detected"
                : "Excluded from dashboard totals until reviewed"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Groups */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading flagged records&hellip;
        </div>
      ) : totalAggregates === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-primary" />
            <p className="font-medium">No flagged records</p>
            <p className="text-sm mt-1">All aggregate data passes the copy-paste check.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {totalOrgs} organization{totalOrgs !== 1 ? "s" : ""} with suspicious entries. Click
            &ldquo;Verified correct&rdquo; if the data is genuinely accurate, or leave flagged
            until the organization re-submits corrected figures.
          </p>
          {groups.map((group) => (
            <GroupCard
              key={group.key}
              group={group}
              onUnflag={(g) => {
                setPendingGroup(g);
                setUnflagNotes("");
              }}
              unflagging={unflagging && pendingGroup?.key === group.key}
            />
          ))}
        </div>
      )}

      {/* Confirm unflag dialog */}
      <Dialog open={pendingGroup !== null} onOpenChange={(o) => !o && setPendingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as verified correct?</DialogTitle>
            <DialogDescription>
              This will dismiss all data-quality flags for{" "}
              <strong>{pendingGroup?.orgName}</strong> ({pendingGroup?.aggregates.length}{" "}
              records) and restore them to approved status. Only do this if you have confirmed
              the data is genuinely accurate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="unflag-notes">Notes (optional)</Label>
            <Textarea
              id="unflag-notes"
              placeholder="e.g. Verified with program coordinator — correct beneficiary count per indicator"
              value={unflagNotes}
              onChange={(e) => setUnflagNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingGroup(null)} disabled={unflagging}>
              Cancel
            </Button>
            <Button onClick={handleUnflagConfirm} disabled={unflagging}>
              {unflagging ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying&hellip;
                </>
              ) : (
                "Mark as verified"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
