"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, RefreshCw, Loader2, GitMerge, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from "lucide-react"
import { mutate as mutateCache } from "swr"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { useToast } from "@/hooks/use-toast"
import { indicatorsService } from "@/lib/api"
import type { DuplicateCandidatePair, MergeIndicatorRequest } from "@/lib/api"
import { useAllIndicators } from "@/lib/hooks/use-api"
import type { Indicator } from "@/lib/types"
import { getIndicatorCategoryLabel } from "@/lib/indicators/categories"
import useSWR from "swr"

// ── Deprecated indicators panel ────────────────────────────────────────────

function DeprecatedPanel() {
  const { toast } = useToast()
  const [restoring, setRestoring] = useState<string | null>(null)

  const { data, isLoading, mutate } = useSWR(
    ["indicators-deprecated"],
    () => indicatorsService.listAll({ is_deprecated: "true" }),
  )

  const deprecated = data || []

  const handleRestore = async (indicator: Indicator) => {
    setRestoring(String(indicator.id))
    try {
      await indicatorsService.restore(indicator.id)
      toast({ title: "Restored", description: `${indicator.name} is active again.` })
      await Promise.all([
        mutate(),
        mutateCache((key) => Array.isArray(key) && (key[0] === "indicators-all" || key[0] === "indicators"), undefined, { revalidate: true }),
      ])
    } catch {
      toast({ title: "Error", description: "Could not restore indicator.", variant: "destructive" })
    } finally {
      setRestoring(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading deprecated indicators…
      </div>
    )
  }

  if (deprecated.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">No deprecated indicators.</p>
    )
  }

  return (
    <div className="space-y-2">
      {deprecated.map((ind) => (
        <div
          key={ind.id}
          className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-amber-300/60 bg-amber-50/30 p-3 dark:bg-amber-950/10"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium leading-tight">{ind.name}</p>
            <p className="text-xs text-muted-foreground">{ind.code}</p>
            {ind.canonical_indicator_detail && (
              <p className="text-xs text-muted-foreground">
                Merged into:{" "}
                <span className="font-medium text-foreground">
                  {ind.canonical_indicator_detail.name}
                </span>
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-xs"
            disabled={restoring === String(ind.id)}
            onClick={() => handleRestore(ind)}
          >
            {restoring === String(ind.id) ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="mr-1 h-3 w-3" />
            )}
            Restore
          </Button>
        </div>
      ))}
    </div>
  )
}

// ── Merge dialog ────────────────────────────────────────────────────────────

interface MergeDialogProps {
  pair: DuplicateCandidatePair
  onClose: () => void
  onMerged: () => void
}

function MergeDialog({ pair, onClose, onMerged }: MergeDialogProps) {
  const { toast } = useToast()
  const [canonicalId, setCanonicalId] = useState<string>(String(pair.indicator_a.id))
  const [targetGroup, setTargetGroup] = useState("")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const canonical = canonicalId === String(pair.indicator_a.id) ? pair.indicator_a : pair.indicator_b
  const duplicate = canonicalId === String(pair.indicator_a.id) ? pair.indicator_b : pair.indicator_a

  const handleMerge = async () => {
    setIsSubmitting(true)
    try {
      const req: MergeIndicatorRequest = {
        canonical_id: canonical.id,
        target_group: targetGroup.trim() || undefined,
        notes: notes.trim() || undefined,
      }
      await indicatorsService.mergeInto(duplicate.id, req)
      toast({
        title: "Merged",
        description: `"${duplicate.name}" is now deprecated. Its name is an alias for "${canonical.name}".`,
      })
      await mutateCache(
        (key) => Array.isArray(key) && (key[0] === "indicators-all" || key[0] === "indicators" || key[0] === "indicators-deprecated"),
        undefined,
        { revalidate: true },
      )
      onMerged()
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Failed to merge indicators."
      toast({ title: "Error", description: msg, variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge duplicate indicators</DialogTitle>
          <DialogDescription>
            Choose which is the canonical (master) indicator. The other becomes deprecated and its
            name is registered as an alias. Historical data is preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Canonical (master) indicator</Label>
            <Select value={canonicalId} onValueChange={setCanonicalId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(pair.indicator_a.id)}>
                  {pair.indicator_a.name} — {pair.indicator_a.code}
                </SelectItem>
                <SelectItem value={String(pair.indicator_b.id)}>
                  {pair.indicator_b.name} — {pair.indicator_b.code}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3 text-sm space-y-1">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              <div>
                <p className="font-medium">Canonical: {canonical.name}</p>
                <p className="text-xs text-muted-foreground">{canonical.code}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="font-medium">Will be deprecated: {duplicate.name}</p>
                <p className="text-xs text-muted-foreground">
                  {duplicate.code} · Name becomes an alias · Historical data preserved
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-group">
              Target group embedded in deprecated name
              <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="target-group"
              value={targetGroup}
              onChange={(e) => setTargetGroup(e.target.value)}
              placeholder="e.g. PLHIV, AYP (10-24), Women, KP"
            />
            <p className="text-xs text-muted-foreground">
              If the deprecated name embedded a target group (&ldquo;PLHIV reached&hellip;&rdquo;), record it here so
              project assignments can use the canonical + target_group field going forward.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">
              Notes
              <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for merge…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Candidate pair card ──────────────────────────────────────────────────────

interface PairCardProps {
  pair: DuplicateCandidatePair
  onMerge: (pair: DuplicateCandidatePair) => void
}

function PairCard({ pair, onMerge }: PairCardProps) {
  const [expanded, setExpanded] = useState(false)

  const similarityPct = Math.round(pair.similarity * 100)
  const color =
    similarityPct >= 90 ? "destructive" : similarityPct >= 80 ? "default" : "secondary"

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <button
          className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <Badge variant={color} className="mt-0.5 shrink-0 tabular-nums">
            {similarityPct}%
          </Badge>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium leading-snug">{pair.indicator_a.name}</p>
            <p className="text-xs text-muted-foreground">vs.</p>
            <p className="text-sm font-medium leading-snug">{pair.indicator_b.name}</p>
          </div>
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>

        {expanded && (
          <div className="border-t px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[pair.indicator_a, pair.indicator_b].map((ind) => (
                <div key={ind.id} className="rounded-md border bg-muted/20 p-2 space-y-1">
                  <p className="font-semibold text-sm leading-snug">{ind.name}</p>
                  <p className="text-muted-foreground">{ind.code}</p>
                  <div className="flex gap-1 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {getIndicatorCategoryLabel(ind.category)}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {ind.type.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onMerge(pair)}>
                <GitMerge className="mr-2 h-3.5 w-3.5" />
                Merge
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function IndicatorDeduplicationPage() {
  const router = useRouter()
  const { toast } = useToast()

  const [threshold, setThreshold] = useState(0.72)
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [isFetching, setIsFetching] = useState(false)
  const [candidates, setCandidates] = useState<DuplicateCandidatePair[] | null>(null)
  const [mergeTarget, setMergeTarget] = useState<DuplicateCandidatePair | null>(null)
  const [showDeprecated, setShowDeprecated] = useState(false)

  const { data: allIndicators } = useAllIndicators()
  const indicators = allIndicators || []

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const result: { value: string; label: string }[] = []
    for (const ind of indicators) {
      if (!seen.has(ind.category)) {
        seen.add(ind.category)
        result.push({ value: ind.category, label: getIndicatorCategoryLabel(ind.category) })
      }
    }
    return result.sort((a, b) => a.label.localeCompare(b.label))
  }, [indicators])

  const handleScan = async () => {
    setIsFetching(true)
    try {
      const result = await indicatorsService.detectDuplicates({
        threshold,
        category: categoryFilter === "all" ? undefined : categoryFilter,
      })
      setCandidates(result.results)
      if (result.count === 0) {
        toast({ title: "No duplicates found", description: "All indicators look distinct at this threshold." })
      }
    } catch {
      toast({ title: "Scan failed", description: "Could not load duplicate candidates.", variant: "destructive" })
    } finally {
      setIsFetching(false)
    }
  }

  const handleMerged = (pair: DuplicateCandidatePair) => {
    setMergeTarget(null)
    setCandidates((prev) =>
      prev
        ? prev.filter(
            (p) =>
              !(
                (String(p.indicator_a.id) === String(pair.indicator_a.id) &&
                  String(p.indicator_b.id) === String(pair.indicator_b.id)) ||
                (String(p.indicator_a.id) === String(pair.indicator_b.id) &&
                  String(p.indicator_b.id) === String(pair.indicator_a.id))
              ),
          )
        : prev,
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indicator Deduplication"
        description="Detect and merge duplicate indicators. Merging keeps historical data intact and registers the old name as an alias."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Indicators", href: "/indicators" },
          { label: "Deduplication" },
        ]}
        actions={
          <Button variant="outline" onClick={() => router.push("/indicators")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      {/* Scan controls */}
      <Card>
        <CardHeader>
          <CardTitle>Scan for duplicates</CardTitle>
          <CardDescription>
            Indicators are compared structurally &mdash; target-group terms (PLHIV, youth, women&hellip;) are
            normalized out so names like &ldquo;PLHIV reached with NCD messages&rdquo; match the canonical
            &ldquo;people reached with NCD prevention messages&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5 w-40">
              <Label htmlFor="threshold">Similarity threshold</Label>
              <Input
                id="threshold"
                type="number"
                min={0.5}
                max={1}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <p className="text-[10px] text-muted-foreground">0.72 = 72% similar</p>
            </div>
            <div className="space-y-1.5 min-w-[180px]">
              <Label htmlFor="category-filter">Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger id="category-filter">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleScan} disabled={isFetching}>
            {isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Scan indicators
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {candidates !== null && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Candidate pairs</CardTitle>
                <CardDescription>
                  {candidates.length === 0
                    ? "No similar pairs found at this threshold."
                    : `${candidates.length} pair${candidates.length === 1 ? "" : "s"} found — expand to compare and merge.`}
                </CardDescription>
              </div>
              {candidates.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {candidates.length}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidates.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 text-green-500/60" />
                <p className="text-sm">No duplicates detected at this threshold.</p>
              </div>
            ) : (
              candidates.map((pair, idx) => (
                <PairCard
                  key={`${pair.indicator_a.id}-${pair.indicator_b.id}-${idx}`}
                  pair={pair}
                  onMerge={setMergeTarget}
                />
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* Deprecated indicators */}
      <Card>
        <CardHeader>
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowDeprecated((v) => !v)}
          >
            <div>
              <CardTitle>Deprecated indicators</CardTitle>
              <CardDescription>Previously merged. Restore to make active again.</CardDescription>
            </div>
            {showDeprecated ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {showDeprecated && (
          <CardContent>
            <DeprecatedPanel />
          </CardContent>
        )}
      </Card>

      {mergeTarget && (
        <MergeDialog
          pair={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onMerged={() => handleMerged(mergeTarget)}
        />
      )}
    </div>
  )
}
