"use client"

/**
 * Manage Workbook Layout
 *
 * Coordinator-level template that arranges indicators (and optional section
 * headings) into the preferred order for generated reporting workbooks. The
 * layout is project/period independent — it only controls indicator ORDER.
 * Project and period are chosen later, at workbook download time.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp,
  GripVertical, Heading, Plus, Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  workbookLayoutsService,
  type WorkbookLayoutAvailableIndicator,
} from "@/lib/api"

export interface WorkbookLayoutCoordinator {
  id: number
  name: string
}

interface EditorItem {
  key: string
  type: "indicator" | "heading"
  indicator?: number
  indicator_name?: string
  indicator_code?: string
  section_title: string
  is_required: boolean
}

let _keySeq = 0
const nextKey = () => `wl-${Date.now()}-${_keySeq++}`

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  coordinators: WorkbookLayoutCoordinator[]
  /** Whether the current user may edit (admin/manager/own coordinator). */
  canEdit?: boolean
}

export function ManageWorkbookLayoutDialog({ open, onOpenChange, coordinators, canEdit = true }: Props) {
  const { toast } = useToast()
  const [coordinatorId, setCoordinatorId] = useState<string>("")
  const [name, setName] = useState("")
  const [items, setItems] = useState<EditorItem[]>([])
  const [available, setAvailable] = useState<WorkbookLayoutAvailableIndicator[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const coordinatorName = useMemo(
    () => coordinators.find((c) => String(c.id) === coordinatorId)?.name ?? "",
    [coordinators, coordinatorId],
  )

  const usedIndicatorIds = useMemo(
    () => new Set(items.filter((i) => i.type === "indicator").map((i) => i.indicator)),
    [items],
  )
  const addableIndicators = useMemo(
    () => available.filter((ind) => !usedIndicatorIds.has(ind.id)),
    [available, usedIndicatorIds],
  )

  const indicatorCount = useMemo(() => items.filter((i) => i.type === "indicator").length, [items])
  const sectionCount = useMemo(() => items.filter((i) => i.type === "heading").length, [items])

  // Indent indicators that fall under a section heading, so the grouping is visible.
  const rows = useMemo(() => {
    let underSection = false
    return items.map((item) => {
      if (item.type === "heading") { underSection = true; return { item, indented: false } }
      return { item, indented: underSection }
    })
  }, [items])

  const loadCoordinator = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    try {
      const [layout, indicators] = await Promise.all([
        workbookLayoutsService.forCoordinator(Number(id)),
        workbookLayoutsService.availableIndicators(Number(id)),
      ])
      setAvailable(indicators)
      const coordName = coordinators.find((c) => String(c.id) === id)?.name ?? ""
      if (layout) {
        setName(layout.name)
        setItems(
          [...layout.items]
            .sort((a, b) => a.order_index - b.order_index)
            .map((it) => ({
              key: nextKey(),
              type: it.indicator ? "indicator" : "heading",
              indicator: it.indicator ?? undefined,
              indicator_name: it.indicator_name,
              indicator_code: it.indicator_code,
              section_title: it.section_title || "",
              is_required: Boolean(it.is_required),
            })),
        )
      } else {
        // No saved layout yet — seed with the available indicators in default
        // order and default the name to "<Coordinator> Workbook Layout".
        setName(`${coordName} Workbook Layout`.trim())
        setItems(
          indicators.map((ind) => ({
            key: nextKey(),
            type: "indicator" as const,
            indicator: ind.id,
            indicator_name: ind.name,
            indicator_code: ind.code,
            section_title: "",
            is_required: false,
          })),
        )
      }
    } catch (err) {
      toast({
        title: "Could not load layout",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [coordinators, toast])

  // Reset when the dialog closes; preselect a single coordinator on open.
  useEffect(() => {
    if (!open) {
      setCoordinatorId(""); setName(""); setItems([]); setAvailable([]); setAddOpen(false)
      return
    }
    if (!coordinatorId && coordinators.length === 1) {
      const only = String(coordinators[0].id)
      setCoordinatorId(only)
      loadCoordinator(only)
    }
  }, [open, coordinators, coordinatorId, loadCoordinator])

  const onSelectCoordinator = (id: string) => {
    setCoordinatorId(id)
    loadCoordinator(id)
  }

  const move = (index: number, delta: number) => {
    setItems((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const moveTo = (index: number, target: number) => {
    setItems((prev) => {
      if (target < 0 || target >= prev.length || target === index) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  const removeItem = (key: string) =>
    setItems((prev) => prev.filter((i) => i.key !== key))

  const addIndicator = (ind: WorkbookLayoutAvailableIndicator) => {
    setItems((prev) => [...prev, {
      key: nextKey(), type: "indicator", indicator: ind.id,
      indicator_name: ind.name, indicator_code: ind.code, section_title: "", is_required: false,
    }])
  }

  const addHeading = () => {
    setItems((prev) => [...prev, {
      key: nextKey(), type: "heading", section_title: "", is_required: false,
    }])
  }

  const setHeadingTitle = (key: string, title: string) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, section_title: title } : i)))

  const onDrop = (targetIndex: number) => {
    setItems((prev) => {
      if (dragIndex === null || dragIndex === targetIndex) return prev
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
    setDragIndex(null)
  }

  const handleSave = async () => {
    if (!coordinatorId) return
    if (!name.trim()) {
      toast({ title: "Name required", description: "Give the layout a name.", variant: "destructive" })
      return
    }
    if (items.some((i) => i.type === "heading" && !i.section_title.trim())) {
      toast({ title: "Empty heading", description: "Every section heading needs a title.", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      await workbookLayoutsService.save({
        coordinator_organization: Number(coordinatorId),
        name: name.trim(),
        items: items.map((it, idx) => ({
          indicator: it.type === "indicator" ? it.indicator ?? null : null,
          section_title: it.type === "heading" ? it.section_title.trim() : "",
          order_index: idx,
          is_required: it.is_required,
        })),
      })
      toast({ title: "Workbook layout saved", description: `${name.trim()} updated.` })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage Workbook Layout</DialogTitle>
          <DialogDescription>
            Set the order indicators appear in this coordinator&apos;s reporting workbooks. Add
            indicators, group them under section headings, and drag to reorder. The order is reused
            for every project and period.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Coordinator</Label>
              <Select value={coordinatorId} onValueChange={onSelectCoordinator}>
                <SelectTrigger><SelectValue placeholder="Select a coordinator" /></SelectTrigger>
                <SelectContent>
                  {coordinators.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Layout name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. BONEPWA Workbook Layout"
                disabled={!coordinatorId}
              />
            </div>
          </div>

          {coordinatorId && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Changing this layout will affect workbook downloads for {coordinatorName || "this coordinator"} and
                all of its sub-organisations.
              </span>
            </div>
          )}

          {coordinatorId && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Popover open={addOpen} onOpenChange={setAddOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={!canEdit || !addableIndicators.length}>
                      <Plus className="mr-1 h-4 w-4" /> Add indicator
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[340px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search indicators…" />
                      <CommandList>
                        <CommandEmpty>
                          {available.length ? "All indicators are already added." : "No indicators for this coordinator."}
                        </CommandEmpty>
                        <CommandGroup heading={`${addableIndicators.length} available`}>
                          {addableIndicators.map((ind) => (
                            <CommandItem
                              key={ind.id}
                              value={`${ind.name} ${ind.code}`}
                              onSelect={() => addIndicator(ind)}
                            >
                              <Plus className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                              <span className="truncate">{ind.name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button type="button" variant="outline" size="sm" onClick={addHeading} disabled={!canEdit}>
                  <Heading className="mr-1 h-4 w-4" /> Add section
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {indicatorCount} indicator{indicatorCount === 1 ? "" : "s"}
                {sectionCount > 0 && ` · ${sectionCount} section${sectionCount === 1 ? "" : "s"}`}
              </p>
            </div>
          )}

          <ScrollArea className="h-[48vh] min-h-[280px] rounded-md border">
            <ul>
              {loading && <li className="p-4 text-sm text-muted-foreground">Loading…</li>}
              {!loading && coordinatorId && items.length === 0 && (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  No indicators yet. Use “Add indicator” to build the layout.
                </li>
              )}
              {!loading && !coordinatorId && (
                <li className="p-6 text-center text-sm text-muted-foreground">Select a coordinator to begin.</li>
              )}
              {!loading && rows.map(({ item, indented }, index) => (
                <li
                  key={item.key}
                  draggable={canEdit}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(index)}
                  onDragEnd={() => setDragIndex(null)}
                  className={`group flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0 ${
                    item.type === "heading"
                      ? "border-l-4 border-l-primary bg-muted/60"
                      : `hover:bg-muted/40 ${indented ? "pl-8" : ""}`
                  } ${dragIndex === index ? "opacity-50" : ""}`}
                >
                  <GripVertical
                    className={`h-4 w-4 shrink-0 text-muted-foreground ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
                  />
                  {item.type === "heading" ? (
                    <>
                      <Badge variant="secondary" className="shrink-0">Section</Badge>
                      <Input
                        value={item.section_title}
                        onChange={(e) => setHeadingTitle(item.key, e.target.value)}
                        placeholder="Section name (e.g. HIV Testing)"
                        className="h-8 font-medium"
                        disabled={!canEdit}
                      />
                    </>
                  ) : (
                    <p className="min-w-0 flex-1 truncate text-sm" title={item.indicator_code || item.indicator_name}>
                      {item.indicator_name}
                    </p>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => moveTo(index, 0)} disabled={index === 0 || !canEdit} aria-label="Move to top">
                      <ChevronsUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => move(index, -1)} disabled={index === 0 || !canEdit} aria-label="Move up">
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => move(index, 1)} disabled={index === items.length - 1 || !canEdit} aria-label="Move down">
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => moveTo(index, items.length - 1)} disabled={index === items.length - 1 || !canEdit} aria-label="Move to bottom">
                      <ChevronsDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={() => removeItem(item.key)} disabled={!canEdit} aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!coordinatorId || saving || loading || !canEdit}>
            {saving ? "Saving…" : "Save layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ManageWorkbookLayoutDialog
