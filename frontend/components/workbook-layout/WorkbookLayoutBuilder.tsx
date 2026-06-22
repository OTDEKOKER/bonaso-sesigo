"use client"

/**
 * Workbook Layout Builder (Phase 1 of the modal → page redesign).
 *
 * A two-panel builder for a coordinator's reporting-workbook indicator order:
 *   • LEFT  — Library: every in-scope indicator, searchable, grouped by category,
 *             filterable by placed/unplaced. Click to add.
 *   • RIGHT — Layout: the ordered table-of-contents (sections + numbered
 *             indicators), with an "unplaced" tray, drag + accessible move
 *             controls, auto-group-by-category and reset-to-default.
 *
 * Sections are interleaved items in ONE ordered list (a section heading is just
 * an item with no indicator), so a single flat sortable list covers grouping —
 * no nested drag contexts needed. The layout is project/period independent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, ChevronUp, ChevronsDown,
  ChevronsUp, GripVertical, Heading, Layers, Loader2, Plus, RotateCcw, Save, Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import {
  workbookLayoutsService,
  type WorkbookLayoutAvailableIndicator,
} from "@/lib/api"

interface EditorItem {
  key: string
  type: "indicator" | "heading"
  indicator?: number
  indicator_name?: string
  indicator_code?: string
  category_display?: string
  section_title: string
  is_required: boolean
}

let _seq = 0
const nextKey = () => `wl-${Date.now()}-${_seq++}`

type ConfirmKind = null | "reset" | "autogroup"

export function WorkbookLayoutBuilder({
  coordinatorId,
  coordinatorName,
  backProjectId,
}: {
  coordinatorId: number
  coordinatorName?: string
  backProjectId?: string
}) {
  const { toast } = useToast()
  const router = useRouter()

  const [name, setName] = useState("")
  const [resolvedCoordName, setResolvedCoordName] = useState(coordinatorName || "")
  const [items, setItems] = useState<EditorItem[]>([])
  const [available, setAvailable] = useState<WorkbookLayoutAvailableIndicator[]>([])
  const [layoutId, setLayoutId] = useState<number | null>(null)
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | undefined>(undefined)
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmKind>(null)

  // Library controls
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [unplacedOnly, setUnplacedOnly] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const mutate = useCallback((updater: (prev: EditorItem[]) => EditorItem[]) => {
    setItems(updater)
    setDirty(true)
  }, [])

  // ── Load ────────────────────────────────────────────────────────────────
  // The saved layout and the indicator library are loaded INDEPENDENTLY: a
  // failure of one must not discard the other. (A coupled Promise.all here once
  // let a failing available-indicators call wipe a successfully-loaded layout,
  // leaving an empty editor.) Each surfaces its own error.
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const layoutP = workbookLayoutsService.forCoordinator(coordinatorId)
    const indicatorsP = workbookLayoutsService.availableIndicators(coordinatorId)

    // Library is best-effort: on failure we keep an empty library but still let
    // a saved layout render (its items carry their own names from the API).
    indicatorsP
      .then((indicators) => { if (!cancelled) setAvailable(indicators) })
      .catch((err) => {
        if (cancelled) return
        toast({
          title: "Could not load indicator library",
          description: err instanceof Error ? err.message : "Add-indicator search is unavailable; saved items still show.",
          variant: "destructive",
        })
      })

    // The layout is the primary artifact. Use whatever indicators we managed to
    // load (possibly none) purely to enrich category labels — never to gate the
    // layout rendering.
    Promise.all([layoutP, indicatorsP.catch(() => [] as WorkbookLayoutAvailableIndicator[])])
      .then(([layout, indicators]) => {
        if (cancelled) return
        if (layout) {
          setLayoutId(layout.id)
          setName(layout.name)
          setResolvedCoordName(layout.coordinator_name || coordinatorName || "")
          setLoadedUpdatedAt(layout.updated_at)
          setLastSavedAt(layout.updated_at)
          setItems(
            [...layout.items]
              .sort((a, b) => a.order_index - b.order_index)
              .map((it) => ({
                key: nextKey(),
                type: it.indicator ? "indicator" : "heading",
                indicator: it.indicator ?? undefined,
                indicator_name: it.indicator_name,
                indicator_code: it.indicator_code,
                category_display: indicators.find((a) => a.id === it.indicator)?.category_display,
                section_title: it.section_title || "",
                is_required: Boolean(it.is_required),
              })),
          )
        } else {
          // No saved layout — seed with all indicators in default (category, name) order.
          setLayoutId(null)
          setName(`${coordinatorName || "Coordinator"} Workbook Layout`.trim())
          setItems(indicators.map(toIndicatorItem))
        }
        setDirty(false)
      })
      .catch((err) => {
        if (cancelled) return
        toast({
          title: "Could not load workbook layout",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        })
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [coordinatorId, coordinatorName, toast])

  // Warn on browser unload while there are unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  // ── Derived ───────────────────────────────────────────────────────────────
  const usedIndicatorIds = useMemo(
    () => new Set(items.filter((i) => i.type === "indicator").map((i) => i.indicator)),
    [items],
  )
  const unplaced = useMemo(
    () => available.filter((a) => !usedIndicatorIds.has(a.id)),
    [available, usedIndicatorIds],
  )
  const indicatorCount = useMemo(
    () => items.filter((i) => i.type === "indicator").length,
    [items],
  )
  const sectionCount = useMemo(
    () => items.filter((i) => i.type === "heading").length,
    [items],
  )

  // Running 1..N numbering + section indent, computed once per items change.
  const rows = useMemo(() => {
    let num = 0
    let underSection = false
    return items.map((item) => {
      if (item.type === "heading") { underSection = true; return { item, number: 0, indented: false } }
      num += 1
      return { item, number: num, indented: underSection }
    })
  }, [items])

  const categories = useMemo(() => {
    const set = new Map<string, string>()
    available.forEach((a) => set.set(a.category, a.category_display || a.category || "Uncategorised"))
    return Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [available])

  // Library list (filtered) grouped by category_display.
  const libraryGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const pool = available.filter((a) => {
      if (unplacedOnly && usedIndicatorIds.has(a.id)) return false
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false
      if (q && !(`${a.name} ${a.code}`.toLowerCase().includes(q))) return false
      return true
    })
    const groups = new Map<string, WorkbookLayoutAvailableIndicator[]>()
    pool.forEach((a) => {
      const label = a.category_display || a.category || "Uncategorised"
      const arr = groups.get(label) || []
      arr.push(a)
      groups.set(label, arr)
    })
    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, list]) => [label, list.sort((x, y) => x.name.localeCompare(y.name))] as const)
  }, [available, search, categoryFilter, unplacedOnly, usedIndicatorIds])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addIndicator = (a: WorkbookLayoutAvailableIndicator) =>
    mutate((prev) => [...prev, toEditorItem(a)])

  const addAllUnplaced = () =>
    mutate((prev) => [...prev, ...unplaced.map(toEditorItem)])

  const addHeading = () =>
    mutate((prev) => [...prev, {
      key: nextKey(), type: "heading", section_title: "", is_required: false,
    }])

  const setHeadingTitle = (key: string, title: string) =>
    mutate((prev) => prev.map((i) => (i.key === key ? { ...i, section_title: title } : i)))

  const removeItem = (key: string) => mutate((prev) => prev.filter((i) => i.key !== key))

  const move = (index: number, delta: number) =>
    mutate((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const moveTo = (index: number, target: number) =>
    mutate((prev) => {
      if (target < 0 || target >= prev.length || target === index) return prev
      const next = [...prev]
      const [m] = next.splice(index, 1)
      next.splice(target, 0, m)
      return next
    })

  const onDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); return }
    mutate((prev) => {
      const next = [...prev]
      const [m] = next.splice(dragIndex, 1)
      next.splice(targetIndex, 0, m)
      return next
    })
    setDragIndex(null)
  }

  // Restructure currently-placed indicators into one section per category.
  const autoGroupByCategory = () => {
    setConfirm(null)
    mutate((prev) => {
      const placed = prev.filter((i) => i.type === "indicator")
      const byCat = new Map<string, EditorItem[]>()
      placed.forEach((i) => {
        const label = i.category_display || "Uncategorised"
        const arr = byCat.get(label) || []
        arr.push(i)
        byCat.set(label, arr)
      })
      const out: EditorItem[] = []
      Array.from(byCat.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([label, list]) => {
          out.push({ key: nextKey(), type: "heading", section_title: label, is_required: false })
          list
            .sort((a, b) => (a.indicator_name || "").localeCompare(b.indicator_name || ""))
            .forEach((i) => out.push(i))
        })
      return out
    })
  }

  const resetToDefault = () => {
    setConfirm(null)
    mutate(() => available.map(toEditorItem))
  }

  // ── Save (explicit, with optimistic concurrency) ────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", description: "Give the layout a name.", variant: "destructive" })
      return
    }
    if (items.some((i) => i.type === "heading" && !i.section_title.trim())) {
      toast({ title: "Empty section", description: "Every section needs a name.", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const payload = {
        coordinator_organization: coordinatorId,
        name: name.trim(),
        items: items.map((it, idx) => ({
          indicator: it.type === "indicator" ? it.indicator ?? null : null,
          section_title: it.type === "heading" ? it.section_title.trim() : "",
          order_index: idx,
          is_required: it.is_required,
        })),
      }
      const saved = layoutId
        ? await workbookLayoutsService.update(layoutId, { ...payload, expected_updated_at: loadedUpdatedAt })
        : await workbookLayoutsService.create(payload)
      setLayoutId(saved.id)
      setLoadedUpdatedAt(saved.updated_at)
      setLastSavedAt(saved.updated_at)
      setDirty(false)
      toast({ title: "Workbook layout saved", description: `${saved.name} updated.` })
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 409) {
        toast({
          title: "Layout changed elsewhere",
          description: "Someone saved a newer version. Reload the page to get it, then re-apply your changes.",
          variant: "destructive",
        })
      } else {
        toast({
          title: "Save failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        })
      }
    } finally {
      setSaving(false)
    }
  }

  const goBack = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return
    router.push(backProjectId ? `/projects/${backProjectId}` : "/projects")
  }

  const toggleCategory = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="-ml-2 h-7 text-muted-foreground" onClick={goBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            Workbook Layout — {resolvedCoordName || `Coordinator #${coordinatorId}`}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Set the order indicators appear in this coordinator&apos;s reporting workbooks. Reused for
            every project and period; all sub-organisations inherit it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleString()}` : "Not saved yet"}
          </span>
          <Button onClick={handleSave} disabled={saving || loading || (!dirty && layoutId !== null)}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save layout
          </Button>
        </div>
      </div>

      {unplaced.length > 0 && !loading && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {unplaced.length} indicator{unplaced.length === 1 ? "" : "s"} not yet placed. They appear under
            “Unplaced indicators” in generated workbooks until you add them.
          </span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={addAllUnplaced}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add all
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading layout…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* LEFT — Library */}
          <section className="flex flex-col rounded-lg border">
            <div className="space-y-2 border-b p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Indicator library</h2>
                <span className="text-xs text-muted-foreground">{unplaced.length} unplaced</span>
              </div>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search indicators…" className="h-8" />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="all">All categories</option>
                  {categories.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <Button
                  size="sm" variant={unplacedOnly ? "default" : "outline"} className="h-8"
                  onClick={() => setUnplacedOnly((v) => !v)}
                >
                  {unplacedOnly ? "Unplaced only" : "Showing all"}
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[56vh]">
              {libraryGroups.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {unplacedOnly ? "Every indicator is placed in the layout." : "No indicators match your search."}
                </p>
              ) : (
                libraryGroups.map(([label, list]) => {
                  const isCollapsed = collapsed.has(label)
                  return (
                    <div key={label}>
                      <button
                        type="button"
                        onClick={() => toggleCategory(label)}
                        className="sticky top-0 z-10 flex w-full items-center gap-1 bg-muted/80 px-3 py-1.5 text-left text-xs font-semibold backdrop-blur"
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {label}
                        <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">{list.length}</Badge>
                      </button>
                      {!isCollapsed && list.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => addIndicator(a)}
                          title={a.code}
                          className="flex w-full items-center gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/40"
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{a.name}</span>
                        </button>
                      ))}
                    </div>
                  )
                })
              )}
            </ScrollArea>
          </section>

          {/* RIGHT — Layout */}
          <section className="flex flex-col rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setDirty(true) }}
                  placeholder="Layout name"
                  className="h-8 max-w-xs font-medium"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {indicatorCount} indicator{indicatorCount === 1 ? "" : "s"}
                  {sectionCount > 0 && ` · ${sectionCount} section${sectionCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8" onClick={addHeading}>
                  <Heading className="mr-1 h-3.5 w-3.5" /> Section
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirm("autogroup")}>
                  <Layers className="mr-1 h-3.5 w-3.5" /> Auto-group
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirm("reset")}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[56vh]">
              {items.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Empty layout. Add indicators from the library, or use Reset to start from the default order.
                </p>
              ) : (
                <ul>
                  {rows.map(({ item, number, indented }, index) => (
                    <li
                      key={item.key}
                      draggable
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(index)}
                      onDragEnd={() => setDragIndex(null)}
                      className={`group flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0 ${
                        item.type === "heading"
                          ? "sticky top-0 z-10 border-l-4 border-l-primary bg-muted/80 backdrop-blur"
                          : `hover:bg-muted/40 ${indented ? "pl-8" : ""}`
                      } ${dragIndex === index ? "opacity-50" : ""}`}
                    >
                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
                      {item.type === "heading" ? (
                        <>
                          <Badge variant="secondary" className="shrink-0">Section</Badge>
                          <Input
                            value={item.section_title}
                            onChange={(e) => setHeadingTitle(item.key, e.target.value)}
                            placeholder="Section name (e.g. HIV Testing)"
                            className="h-8 font-medium"
                          />
                        </>
                      ) : (
                        <>
                          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{number}.</span>
                          <span className="min-w-0 flex-1 truncate text-sm" title={item.indicator_code || item.indicator_name}>
                            {item.indicator_name}
                          </span>
                        </>
                      )}
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <IconBtn label="Move to top" onClick={() => moveTo(index, 0)} disabled={index === 0}><ChevronsUp className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Move up" onClick={() => move(index, -1)} disabled={index === 0}><ChevronUp className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Move down" onClick={() => move(index, 1)} disabled={index === items.length - 1}><ChevronDown className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Move to bottom" onClick={() => moveTo(index, items.length - 1)} disabled={index === items.length - 1}><ChevronsDown className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Remove" onClick={() => removeItem(item.key)} destructive><Trash2 className="h-4 w-4" /></IconBtn>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </section>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "reset" ? "Reset to default order?" : "Auto-group by category?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "reset"
                ? "This replaces the current layout with every indicator in the default order (no sections). You can still Discard by leaving without saving."
                : "This rearranges the indicators you have placed into one section per category, sorted by name. Unplaced indicators are unaffected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm === "reset" ? resetToDefault : autoGroupByCategory}>
              {confirm === "reset" ? "Reset" : "Auto-group"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function IconBtn({
  label, onClick, disabled, destructive, children,
}: {
  label: string; onClick: () => void; disabled?: boolean; destructive?: boolean; children: React.ReactNode
}) {
  return (
    <Button
      type="button" variant="ghost" size="icon" aria-label={label} title={label}
      className={`h-7 w-7 ${destructive ? "text-destructive" : ""}`}
      onClick={onClick} disabled={disabled}
    >
      {children}
    </Button>
  )
}

function toEditorItem(a: WorkbookLayoutAvailableIndicator): EditorItem {
  return {
    key: nextKey(), type: "indicator", indicator: a.id,
    indicator_name: a.name, indicator_code: a.code,
    category_display: a.category_display, section_title: "", is_required: false,
  }
}
const toIndicatorItem = toEditorItem

export default WorkbookLayoutBuilder
