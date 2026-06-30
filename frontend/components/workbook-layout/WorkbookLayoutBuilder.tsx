"use client"

/**
 * Workbook Builder — professional two-pane layout editor for a coordinator's
 * reporting-workbook indicator order.
 *
 *   • LEFT  — Indicator Library (fixed 320px): searchable, category-grouped,
 *             multi-select for bulk assignment. Sticky search/filter controls.
 *   • RIGHT — Workbook: ordered sections rendered as collapsible cards with
 *             per-section counts, dense 36px rows, sticky headers, and
 *             drag-and-drop of indicators within and BETWEEN sections.
 *
 * Data model (unchanged, for save/load + optimistic concurrency): the layout is
 * ONE flat ordered list of items where a section heading is just an item with
 * no indicator. The card UI is a *view* derived from that flat list; every drag,
 * bulk-add and section move is translated back to a flat-list mutation so the
 * saved payload stays a simple ordered array. Project/period independent.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, ChevronDown, ChevronRight, FolderPlus, GripVertical,
  Layers, Loader2, Maximize2, Minimize2, Plus, RotateCcw, Save, Search, Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { PageHeader } from "@/components/shared/page-header"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
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

/** A section as rendered: an optional heading item plus its indicator rows. */
interface RenderSection {
  key: string
  headingKey: string | null
  headingFlatIndex: number | null
  title: string
  rows: { item: EditorItem; flatIndex: number; number: number }[]
}

/** One placement of a duplicated indicator (row key, 1-based position, section). */
interface DuplicateOccurrence {
  key: string
  position: number
  section: string
}
/** An indicator that appears more than once, with all of its placements. */
interface DuplicateGroup {
  indicatorId: number
  name: string
  occurrences: DuplicateOccurrence[]
}

const UNGROUPED_KEY = "__ungrouped__"

let _seq = 0
const nextKey = () => `wl-${Date.now()}-${_seq++}`

type ConfirmKind = null | "reset" | "autogroup"
type DragPayload =
  | { kind: "row"; key: string }
  | { kind: "section"; headingKey: string }
  | null

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
  const [focusMode, setFocusMode] = useState(false)

  // Library controls
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [unplacedOnly, setUnplacedOnly] = useState(true)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Workbook controls
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<DragPayload>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const mutate = useCallback((updater: (prev: EditorItem[]) => EditorItem[]) => {
    setItems(updater)
    setDirty(true)
  }, [])

  // ── Load ────────────────────────────────────────────────────────────────
  // Layout and library load INDEPENDENTLY: a failed library fetch must not
  // discard a successfully-loaded layout (which once left an empty editor).
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const layoutP = workbookLayoutsService.forCoordinator(coordinatorId)
    const indicatorsP = workbookLayoutsService.availableIndicators(coordinatorId)

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
          setLayoutId(null)
          setName(`${coordinatorName || "Coordinator"} Workbook Layout`.trim())
          setItems(indicators.map(toEditorItem))
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

  // Esc exits focus mode.
  useEffect(() => {
    if (!focusMode) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFocusMode(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focusMode])

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

  // Indicators placed more than once. The backend rejects a layout where the
  // same indicator id appears twice, so detect collisions here to drive the
  // warning banner (name, count, section + position of every occurrence),
  // highlight EVERY offending row, and let the user jump straight to each one.
  // Positions use the same running 1..N indicator numbering shown on each row;
  // section is the heading the row falls under ("Ungrouped" before the first).
  const duplicateInfo = useMemo(() => {
    const acc = new Map<number, DuplicateGroup>()
    let section = "Ungrouped"
    let num = 0
    for (const item of items) {
      if (item.type === "heading") {
        section = item.section_title.trim() || "Untitled section"
        continue
      }
      num += 1
      if (item.indicator == null) continue
      const group = acc.get(item.indicator) ?? {
        indicatorId: item.indicator,
        name: item.indicator_name || `Indicator ${item.indicator}`,
        occurrences: [],
      }
      if (item.indicator_name) group.name = item.indicator_name
      group.occurrences.push({ key: item.key, position: num, section })
      acc.set(item.indicator, group)
    }
    const groups: DuplicateGroup[] = []
    acc.forEach((g) => { if (g.occurrences.length > 1) groups.push(g) })
    const keys = new Set<string>(groups.flatMap((g) => g.occurrences.map((o) => o.key)))
    // Flat, position-ordered list of every duplicate occurrence — drives the
    // Previous/Next stepper.
    const occurrences = groups
      .flatMap((g) => g.occurrences.map((o) => ({ ...o, indicatorId: g.indicatorId, name: g.name })))
      .sort((a, b) => a.position - b.position)
    return { groups, keys, occurrences }
  }, [items])
  const hasDuplicates = duplicateInfo.groups.length > 0

  // Banner "jump to duplicate" navigation: which occurrence is active, and a
  // transient flash applied to the row we just scrolled to.
  const [activeDupIndex, setActiveDupIndex] = useState(0)
  const [flashKey, setFlashKey] = useState<string | null>(null)
  useEffect(() => {
    // Keep the stepper index in range as duplicates are resolved.
    if (activeDupIndex >= duplicateInfo.occurrences.length) setActiveDupIndex(0)
  }, [duplicateInfo.occurrences.length, activeDupIndex])

  // Flat list → section view, with a leading "ungrouped" bucket for indicators
  // placed before the first heading. Running 1..N numbering is global (it is the
  // order indicators appear in the generated workbook).
  const sections = useMemo<RenderSection[]>(() => {
    const out: RenderSection[] = []
    let current: RenderSection = {
      key: UNGROUPED_KEY, headingKey: null, headingFlatIndex: null,
      title: "Ungrouped", rows: [],
    }
    let num = 0
    items.forEach((item, flatIndex) => {
      if (item.type === "heading") {
        out.push(current)
        current = {
          key: item.key, headingKey: item.key, headingFlatIndex: flatIndex,
          title: item.section_title, rows: [],
        }
      } else {
        num += 1
        current.rows.push({ item, flatIndex, number: num })
      }
    })
    out.push(current)
    // Drop the leading ungrouped bucket only when it is empty and real sections exist.
    return out.filter((s, idx) => !(idx === 0 && s.headingKey === null && s.rows.length === 0 && out.length > 1))
  }, [items])

  const sectionCount = useMemo(
    () => sections.filter((s) => s.headingKey !== null).length,
    [sections],
  )

  // Jump to a specific duplicate occurrence: reveal it (expand its section and
  // clear any search filter that hides it), scroll it into view, and flash it.
  const goToOccurrence = useCallback((rowKey: string) => {
    const idx = duplicateInfo.occurrences.findIndex((o) => o.key === rowKey)
    if (idx >= 0) setActiveDupIndex(idx)
    setSearch("")
    const sectionKey = sections.find((s) => s.rows.some((r) => r.item.key === rowKey))?.key
    if (sectionKey) {
      setCollapsedSections((prev) => {
        if (!prev.has(sectionKey)) return prev
        const next = new Set(prev)
        next.delete(sectionKey)
        return next
      })
    }
    setFlashKey(rowKey)
    // Two frames: let the section expand / search clear re-render before we
    // measure and scroll to the row.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.getElementById(`wb-row-${rowKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      }),
    )
    window.setTimeout(() => setFlashKey((k) => (k === rowKey ? null : k)), 1300)
  }, [duplicateInfo.occurrences, sections])

  const stepDuplicate = useCallback((dir: 1 | -1) => {
    const list = duplicateInfo.occurrences
    if (list.length === 0) return
    const next = (activeDupIndex + dir + list.length) % list.length
    goToOccurrence(list[next].key)
  }, [duplicateInfo.occurrences, activeDupIndex, goToOccurrence])

  // The library search also narrows the PLACED side: when searching, show only
  // sections whose rows match, so an indicator can be found whether it is
  // already placed (right) or still in the library (left).
  const displaySections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sections
    return sections
      .map((s) => ({
        ...s,
        rows: s.rows.filter((r) =>
          `${r.item.indicator_name ?? ""} ${r.item.indicator_code ?? ""}`
            .toLowerCase()
            .includes(q),
        ),
      }))
      .filter((s) => s.rows.length > 0)
  }, [sections, search])

  const categories = useMemo(() => {
    const set = new Map<string, string>()
    available.forEach((a) => set.set(a.category, a.category_display || a.category || "Uncategorised"))
    return Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [available])

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

  const visibleLibraryIds = useMemo(
    () => libraryGroups.flatMap(([, list]) => list.map((a) => a.id)),
    [libraryGroups],
  )

  // ── Flat-list helpers ───────────────────────────────────────────────────
  // End boundary (exclusive insert index) of a section in the flat list.
  const sectionEndIndex = useCallback((headingKey: string | null): number => {
    if (headingKey === null) {
      // Ungrouped: ends just before the first heading (or at list end).
      const firstHeading = items.findIndex((i) => i.type === "heading")
      return firstHeading === -1 ? items.length : firstHeading
    }
    const start = items.findIndex((i) => i.key === headingKey)
    if (start === -1) return items.length
    let end = start + 1
    while (end < items.length && items[end].type !== "heading") end += 1
    return end
  }, [items])

  // ── Mutations ─────────────────────────────────────────────────────────────
  // Idempotent: an indicator already in the layout is never appended again
  // (the backend rejects a layout with the same indicator twice). This matches
  // the guard in addSelectedToSection/addAllUnplaced and prevents creating a
  // duplicate when the library is in "All" mode (which lists placed indicators).
  const addIndicatorToEnd = (a: WorkbookLayoutAvailableIndicator) =>
    mutate((prev) =>
      prev.some((i) => i.type === "indicator" && i.indicator === a.id)
        ? prev
        : [...prev, toEditorItem(a)],
    )

  const addSelectedToSection = (headingKey: string | null) => {
    if (selected.size === 0) return
    const chosen = available.filter((a) => selected.has(a.id) && !usedIndicatorIds.has(a.id))
    if (chosen.length === 0) { setSelected(new Set()); return }
    const at = sectionEndIndex(headingKey)
    mutate((prev) => {
      const next = [...prev]
      next.splice(at, 0, ...chosen.map(toEditorItem))
      return next
    })
    setSelected(new Set())
  }

  const addAllUnplaced = () =>
    mutate((prev) => [...prev, ...unplaced.map(toEditorItem)])

  const addHeading = () =>
    mutate((prev) => [...prev, {
      key: nextKey(), type: "heading", section_title: "", is_required: false,
    }])

  const setHeadingTitle = (key: string, title: string) =>
    mutate((prev) => prev.map((i) => (i.key === key ? { ...i, section_title: title } : i)))

  const removeItem = (key: string) => mutate((prev) => prev.filter((i) => i.key !== key))

  // Remove a whole section (heading + its indicator rows return to library).
  const removeSection = (headingKey: string) =>
    mutate((prev) => {
      const start = prev.findIndex((i) => i.key === headingKey)
      if (start === -1) return prev
      let end = start + 1
      while (end < prev.length && prev[end].type !== "heading") end += 1
      const next = [...prev]
      next.splice(start, end - start)
      return next
    })

  // Move a single item (by key) to land before `targetFlatIndex` in the original array.
  const relocateRow = (dragKey: string, targetFlatIndex: number) =>
    mutate((prev) => {
      const from = prev.findIndex((i) => i.key === dragKey)
      if (from === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      let to = targetFlatIndex
      if (from < targetFlatIndex) to -= 1
      to = Math.max(0, Math.min(to, next.length))
      next.splice(to, 0, moved)
      return next
    })

  // Reorder an entire section block relative to other blocks.
  const moveSection = (headingKey: string, dir: -1 | 1) =>
    mutate((prev) => {
      const blocks = toBlocks(prev)
      const idx = blocks.findIndex((b) => b.headingKey === headingKey)
      if (idx === -1) return prev
      const target = idx + dir
      // Never move above the leading ungrouped block (index 0 when present).
      const lower = blocks[0]?.headingKey === null ? 1 : 0
      if (target < lower || target >= blocks.length) return prev
      const next = [...blocks]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next.flatMap((b) => b.items)
    })

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const onRowDrop = (targetFlatIndex: number) => {
    if (drag?.kind === "row") relocateRow(drag.key, targetFlatIndex)
    clearDrag()
  }
  const onSectionDrop = (headingKey: string | null) => {
    // Dropping a row onto a section header/body appends it to that section.
    if (drag?.kind === "row") relocateRow(drag.key, sectionEndIndex(headingKey))
    else if (drag?.kind === "section" && headingKey && headingKey !== drag.headingKey) {
      mutate((prev) => {
        const blocks = toBlocks(prev)
        const from = blocks.findIndex((b) => b.headingKey === drag.headingKey)
        const to = blocks.findIndex((b) => b.headingKey === headingKey)
        if (from === -1 || to === -1) return prev
        const next = [...blocks]
        const [moved] = next.splice(from, 1)
        const insertAt = next.findIndex((b) => b.headingKey === headingKey)
        next.splice(insertAt, 0, moved)
        return next.flatMap((b) => b.items)
      })
    }
    clearDrag()
  }
  const clearDrag = () => { setDrag(null); setDropTarget(null) }

  // ── Bulk restructure ────────────────────────────────────────────────────
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

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", description: "Give the layout a name.", variant: "destructive" })
      return
    }
    if (items.some((i) => i.type === "heading" && !i.section_title.trim())) {
      toast({ title: "Empty section", description: "Every section needs a name.", variant: "destructive" })
      return
    }
    if (hasDuplicates) {
      // Save is disabled while duplicates exist; if we still get here, point the
      // user at the first one (the banner above lists them all).
      goToOccurrence(duplicateInfo.occurrences[0].key)
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
      const body = (err as { errors?: unknown })?.errors
      const serverDup =
        body && typeof body === "object" && (body as { error?: string }).error === "duplicate_indicators"
          ? (body as { duplicates?: { indicator_name?: string; positions?: number[] }[] }).duplicates ?? []
          : null
      if (serverDup) {
        // Backend safety net caught a duplicate (the reactive banner normally
        // catches it first). Jump to the first local occurrence if we have one,
        // otherwise surface the server's position list.
        if (duplicateInfo.occurrences.length > 0) {
          goToOccurrence(duplicateInfo.occurrences[0].key)
        } else {
          toast({
            title: "Cannot save layout",
            description: serverDup
              .map((d) => `${d.indicator_name ?? "Indicator"} (positions ${(d.positions ?? []).join(", ")})`)
              .join("; "),
            variant: "destructive",
          })
        }
      } else if (status === 409) {
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

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  const selectAllVisible = () => setSelected(new Set(visibleLibraryIds))
  const clearSelection = () => setSelected(new Set())
  const toggleCatCollapse = (label: string) =>
    setCollapsedCats((prev) => toggleInSet(prev, label))
  const toggleSectionCollapse = (key: string) =>
    setCollapsedSections((prev) => toggleInSet(prev, key))

  // ── Render ────────────────────────────────────────────────────────────────
  const headerActions = (
    <>
      <span className="self-center text-xs text-muted-foreground">
        {dirty ? "Unsaved changes" : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleString()}` : "Not saved yet"}
      </span>
      <Button variant="outline" size="sm" onClick={() => setFocusMode((v) => !v)} title="Focus mode (Esc to exit)">
        {focusMode ? <Minimize2 className="mr-1.5 h-4 w-4" /> : <Maximize2 className="mr-1.5 h-4 w-4" />}
        {focusMode ? "Exit focus" : "Focus"}
      </Button>
      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving || loading || hasDuplicates || (!dirty && layoutId !== null)}
        title={hasDuplicates ? "Resolve the duplicate indicators before saving" : undefined}
      >
        {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
        Save layout
      </Button>
    </>
  )

  const body = (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4", focusMode && "p-4 sm:p-6")}>
      {!focusMode && (
        <PageHeader
          title={`Workbook Builder — ${resolvedCoordName || `Coordinator #${coordinatorId}`}`}
          description="Set the order indicators appear in this coordinator's reporting workbooks. Reused for every project and period; all sub-organisations inherit it."
          breadcrumbs={[
            { label: "Projects", href: backProjectId ? `/projects/${backProjectId}` : "/projects" },
            { label: "Workbook Builder" },
          ]}
          actions={headerActions}
        />
      )}

      {focusMode && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-lg font-semibold">
            Workbook Builder — {resolvedCoordName || `Coordinator #${coordinatorId}`}
          </h2>
          <div className="flex items-center gap-2">{headerActions}</div>
        </div>
      )}

      {unplaced.length > 0 && !loading && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {unplaced.length} indicator{unplaced.length === 1 ? "" : "s"} not yet placed — they appear under
            “Unplaced indicators” in generated workbooks until added.
          </span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={addAllUnplaced}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add all
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading layout…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* LEFT — Library (fixed width) */}
          <aside className="flex w-[320px] shrink-0 flex-col rounded-xl border bg-card">
            <div className="sticky top-0 z-10 space-y-2 rounded-t-xl border-b bg-card p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Indicator Library</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{unplaced.length} unplaced</Badge>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search indicators…"
                  className="h-8 pl-7 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="all">All categories</option>
                  {categories.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <Button
                  size="sm" variant={unplacedOnly ? "default" : "outline"} className="h-8 px-2 text-xs"
                  onClick={() => setUnplacedOnly((v) => !v)}
                >
                  {unplacedOnly ? "Unplaced" : "All"}
                </Button>
              </div>
              {visibleLibraryIds.length > 0 && (
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <button type="button" className="hover:text-foreground" onClick={selectAllVisible}>
                    Select all ({visibleLibraryIds.length})
                  </button>
                  {selected.size > 0 && (
                    <button type="button" className="hover:text-foreground" onClick={clearSelection}>
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {libraryGroups.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {unplacedOnly ? "Every indicator is placed in the layout." : "No indicators match your search."}
                </p>
              ) : (
                libraryGroups.map(([label, list]) => {
                  const isCollapsed = collapsedCats.has(label)
                  return (
                    <div key={label}>
                      <button
                        type="button"
                        onClick={() => toggleCatCollapse(label)}
                        className="sticky top-0 z-[5] flex w-full items-center gap-1 bg-muted/90 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide backdrop-blur"
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        <span className="truncate">{label}</span>
                        <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px]">{list.length}</Badge>
                      </button>
                      {!isCollapsed && list.map((a) => {
                        const isPlaced = usedIndicatorIds.has(a.id)
                        return (
                        <div
                          key={a.id}
                          draggable={false}
                          className={cn(
                            "flex min-h-9 items-center gap-2 border-b px-2.5 py-1 last:border-b-0 hover:bg-muted/40",
                            isPlaced && "opacity-60",
                          )}
                        >
                          <Checkbox
                            checked={selected.has(a.id)}
                            onCheckedChange={() => toggleSelect(a.id)}
                            className="h-3.5 w-3.5 shrink-0"
                            aria-label={`Select ${a.name}`}
                          />
                          <button
                            type="button"
                            onClick={() => addIndicatorToEnd(a)}
                            disabled={isPlaced}
                            title={isPlaced ? `${a.code} — already in the layout` : a.code}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] disabled:cursor-default"
                          >
                            <span className="whitespace-normal break-words">{a.name}</span>
                          </button>
                          {isPlaced ? (
                            <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">Placed</Badge>
                          ) : (
                            <Plus
                              className="h-3.5 w-3.5 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                              onClick={() => addIndicatorToEnd(a)}
                            />
                          )}
                        </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>

            {/* Bulk assignment bar */}
            {selected.size > 0 && (
              <div className="flex items-center gap-2 border-t bg-muted/40 p-2">
                <span className="text-xs font-medium">{selected.size} selected</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="ml-auto h-7 text-xs">Add to…</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                    <DropdownMenuLabel>Add {selected.size} to section</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {sectionCount === 0 && (
                      <DropdownMenuItem onClick={() => addSelectedToSection(null)}>
                        End of workbook
                      </DropdownMenuItem>
                    )}
                    {sections
                      .filter((s) => s.headingKey !== null)
                      .map((s) => (
                        <DropdownMenuItem key={s.key} onClick={() => addSelectedToSection(s.headingKey)}>
                          <span className="truncate">{s.title || "Untitled section"}</span>
                          <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px]">{s.rows.length}</Badge>
                        </DropdownMenuItem>
                      ))}
                    {sections.some((s) => s.headingKey === null && s.rows.length > 0) && (
                      <DropdownMenuItem onClick={() => addSelectedToSection(null)}>Ungrouped</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </aside>

          {/* RIGHT — Workbook */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border bg-card">
            <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b bg-card p-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setDirty(true) }}
                  placeholder="Workbook layout name"
                  className="h-8 max-w-xs text-sm font-medium"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {indicatorCount} indicator{indicatorCount === 1 ? "" : "s"}
                  {sectionCount > 0 && ` · ${sectionCount} section${sectionCount === 1 ? "" : "s"}`}
                </span>
                {hasDuplicates && (
                  <Badge variant="destructive" className="h-5 shrink-0 gap-1 px-1.5 text-[10px] font-semibold" title="The same indicator is placed more than once — remove the highlighted duplicates before saving">
                    <AlertTriangle className="h-3 w-3" />
                    {duplicateInfo.groups.length} duplicate{duplicateInfo.groups.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8" onClick={addHeading}>
                  <FolderPlus className="mr-1 h-3.5 w-3.5" /> Section
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirm("autogroup")}>
                  <Layers className="mr-1 h-3.5 w-3.5" /> Auto-group
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirm("reset")}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
                </Button>
              </div>
            </div>

            {hasDuplicates && (
              <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive" role="alert">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-semibold">
                    Cannot save layout — {duplicateInfo.groups.length} duplicate indicator{duplicateInfo.groups.length === 1 ? "" : "s"}
                  </span>
                  {duplicateInfo.occurrences.length > 1 && (
                    <div className="ml-auto flex items-center gap-1">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => stepDuplicate(-1)}>
                        Previous
                      </Button>
                      <span className="text-[11px] tabular-nums">
                        {activeDupIndex + 1} / {duplicateInfo.occurrences.length}
                      </span>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => stepDuplicate(1)}>
                        Next
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-1.5 space-y-1 text-xs">
                  {duplicateInfo.groups.map((g) => (
                    <li key={g.indicatorId}>
                      <span className="font-medium">{g.name}</span>
                      <span className="text-destructive/80"> — appears {g.occurrences.length} times: </span>
                      {g.occurrences.map((o, i) => (
                        <span key={o.key}>
                          {i > 0 && <span className="text-destructive/50">, </span>}
                          <button
                            type="button"
                            onClick={() => goToOccurrence(o.key)}
                            className="rounded underline decoration-dotted underline-offset-2 hover:bg-destructive/15 hover:decoration-solid focus-visible:outline focus-visible:outline-1"
                            title="Jump to this occurrence"
                          >
                            {o.section} → Position {o.position}
                          </button>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-destructive/80">
                  Remove the extra copies (each indicator may appear only once), then save. Click a position to jump to it.
                </p>
              </div>
            )}

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
                  <Layers className="h-8 w-8 opacity-40" />
                  <p>Empty workbook. Add indicators from the library, create a section, or Reset to the default order.</p>
                </div>
              ) : search.trim() && displaySections.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
                  <Search className="h-8 w-8 opacity-40" />
                  <p>No placed indicators match “{search.trim()}”. Check the library on the left.</p>
                </div>
              ) : (
                displaySections.map((s) => (
                  <SectionCard
                    key={s.key}
                    section={s}
                    collapsed={collapsedSections.has(s.key)}
                    onToggleCollapse={() => toggleSectionCollapse(s.key)}
                    onTitleChange={(t) => s.headingKey && setHeadingTitle(s.headingKey, t)}
                    onRemoveSection={() => s.headingKey && removeSection(s.headingKey)}
                    onMoveSection={(dir) => s.headingKey && moveSection(s.headingKey, dir)}
                    onRemoveRow={removeItem}
                    duplicateKeys={duplicateInfo.keys}
                    flashKey={flashKey}
                    drag={drag}
                    setDrag={setDrag}
                    dropTarget={dropTarget}
                    setDropTarget={setDropTarget}
                    onRowDrop={onRowDrop}
                    onSectionDrop={onSectionDrop}
                  />
                ))
              )}
            </div>
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
                ? "This replaces the current layout with every indicator in the default order (no sections). You can still discard by leaving without saving."
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

  if (focusMode) {
    return <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">{body}</div>
  }
  return <div className="flex h-[calc(100vh-var(--app-header-height,4rem))] flex-col p-4 sm:p-6">{body}</div>
}

// ── Section card ────────────────────────────────────────────────────────────
function SectionCard({
  section, collapsed, onToggleCollapse, onTitleChange, onRemoveSection, onMoveSection,
  onRemoveRow, duplicateKeys, flashKey, drag, setDrag, dropTarget, setDropTarget, onRowDrop, onSectionDrop,
}: {
  section: RenderSection
  collapsed: boolean
  onToggleCollapse: () => void
  onTitleChange: (t: string) => void
  onRemoveSection: () => void
  onMoveSection: (dir: -1 | 1) => void
  onRemoveRow: (key: string) => void
  duplicateKeys: Set<string>
  flashKey: string | null
  drag: DragPayload
  setDrag: (d: DragPayload) => void
  dropTarget: string | null
  setDropTarget: (t: string | null) => void
  onRowDrop: (targetFlatIndex: number) => void
  onSectionDrop: (headingKey: string | null) => void
}) {
  const isUngrouped = section.headingKey === null
  const isSectionDropActive = dropTarget === `sec:${section.key}` && drag?.kind === "row"

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background shadow-sm",
        isUngrouped && "border-dashed",
        isSectionDropActive && "ring-2 ring-primary",
      )}
      onDragOver={(e) => { if (drag?.kind === "row") { e.preventDefault(); setDropTarget(`sec:${section.key}`) } }}
      onDrop={(e) => { e.preventDefault(); onSectionDrop(section.headingKey) }}
    >
      {/* Header (sticky) */}
      <div
        className="group sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-l-4 border-l-primary bg-muted/80 px-2 backdrop-blur"
        draggable={!isUngrouped}
        onDragStart={() => !isUngrouped && section.headingKey && setDrag({ kind: "section", headingKey: section.headingKey })}
        onDragEnd={() => setDrag(null)}
      >
        {!isUngrouped && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />}
        <button type="button" onClick={onToggleCollapse} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {isUngrouped ? (
          <span className="text-sm font-semibold text-muted-foreground">Ungrouped</span>
        ) : (
          <Input
            value={section.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Section name (e.g. HIV Testing)"
            className="h-7 max-w-sm border-transparent bg-transparent text-sm font-semibold focus-visible:border-input focus-visible:bg-background"
          />
        )}
        <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{section.rows.length}</Badge>
        {!isUngrouped && (
          <div className="ml-auto flex items-center gap-0.5">
            <IconBtn label="Move section up" onClick={() => onMoveSection(-1)}><ChevronUpSmall /></IconBtn>
            <IconBtn label="Move section down" onClick={() => onMoveSection(1)}><ChevronDownSmall /></IconBtn>
            <IconBtn label="Delete section" onClick={onRemoveSection} destructive><Trash2 className="h-4 w-4" /></IconBtn>
          </div>
        )}
      </div>

      {/* Rows */}
      {!collapsed && (
        <div>
          {section.rows.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-muted-foreground">
              Drag indicators here, or use “Add to…” from the library.
            </p>
          ) : (
            section.rows.map(({ item, flatIndex, number }) => {
              const isRowDrop = dropTarget === `row:${item.key}` && drag?.kind === "row" && drag.key !== item.key
              const isDuplicate = duplicateKeys.has(item.key)
              return (
                <div
                  key={item.key}
                  id={`wb-row-${item.key}`}
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "row", key: item.key }) }}
                  onDragOver={(e) => {
                    if (drag?.kind === "row") { e.preventDefault(); e.stopPropagation(); setDropTarget(`row:${item.key}`) }
                  }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onRowDrop(flatIndex) }}
                  onDragEnd={() => setDrag(null)}
                  className={cn(
                    "group flex min-h-9 items-center gap-2 border-b px-2 py-1 last:border-b-0 hover:bg-muted/40",
                    drag?.kind === "row" && drag.key === item.key && "opacity-40",
                    isRowDrop && "border-t-2 border-t-primary",
                    isDuplicate && "border border-destructive/60 bg-destructive/10 hover:bg-destructive/15",
                    flashKey === item.key && "wb-row-flash",
                  )}
                >
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
                  <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{number}.</span>
                  <span className="min-w-0 flex-1 whitespace-normal break-words text-[13px]" title={item.indicator_code || item.indicator_name}>
                    {item.indicator_name}
                  </span>
                  {isDuplicate && (
                    <Badge variant="destructive" className="h-5 shrink-0 gap-1 px-1.5 text-[10px] font-semibold" title="This indicator appears more than once — remove the extra before saving">
                      <AlertTriangle className="h-3 w-3" />
                      Duplicate
                    </Badge>
                  )}
                  <IconBtn label="Remove" onClick={() => onRemoveRow(item.key)} destructive>
                    <Trash2 className="h-4 w-4" />
                  </IconBtn>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function IconBtn({
  label, onClick, destructive, children,
}: {
  label: string; onClick: () => void; destructive?: boolean; children: React.ReactNode
}) {
  return (
    <Button
      type="button" variant="ghost" size="icon" aria-label={label} title={label}
      className={cn("h-6 w-6 shrink-0 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100 group-hover:opacity-100", destructive && "text-destructive")}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
const ChevronUpSmall = () => <ChevronDown className="h-4 w-4 rotate-180" />
const ChevronDownSmall = () => <ChevronDown className="h-4 w-4" />

// ── Pure helpers ──────────────────────────────────────────────────────────
function toEditorItem(a: WorkbookLayoutAvailableIndicator): EditorItem {
  return {
    key: nextKey(), type: "indicator", indicator: a.id,
    indicator_name: a.name, indicator_code: a.code,
    category_display: a.category_display, section_title: "", is_required: false,
  }
}

/** Split the flat list into blocks (leading ungrouped + one per heading). */
function toBlocks(items: EditorItem[]): { headingKey: string | null; items: EditorItem[] }[] {
  const blocks: { headingKey: string | null; items: EditorItem[] }[] = [{ headingKey: null, items: [] }]
  items.forEach((it) => {
    if (it.type === "heading") blocks.push({ headingKey: it.key, items: [it] })
    else blocks[blocks.length - 1].items.push(it)
  })
  return blocks.filter((b, i) => !(i === 0 && b.items.length === 0))
}

function toggleInSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev)
  if (next.has(value)) next.delete(value); else next.add(value)
  return next
}

export default WorkbookLayoutBuilder
