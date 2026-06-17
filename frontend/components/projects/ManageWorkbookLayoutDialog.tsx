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
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical, Heading, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
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
  const [indicatorToAdd, setIndicatorToAdd] = useState<string>("")
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
      setCoordinatorId(""); setName(""); setItems([]); setAvailable([]); setIndicatorToAdd("")
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
    setIndicatorToAdd("")
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

  const removeItem = (key: string) =>
    setItems((prev) => prev.filter((i) => i.key !== key))

  const addIndicator = () => {
    const id = Number(indicatorToAdd)
    const ind = available.find((a) => a.id === id)
    if (!ind) return
    setItems((prev) => [...prev, {
      key: nextKey(), type: "indicator", indicator: ind.id,
      indicator_name: ind.name, indicator_code: ind.code, section_title: "", is_required: false,
    }])
    setIndicatorToAdd("")
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Workbook Layout</DialogTitle>
          <DialogDescription>
            Arrange indicators into the preferred order for reporting workbooks. This order is
            saved per coordinator and reused for every project and period — it does not depend on
            project, year, quarter or month.
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
            <div className="flex flex-wrap items-center gap-2">
              <Select value={indicatorToAdd} onValueChange={setIndicatorToAdd}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder={addableIndicators.length ? "Add an indicator…" : "All indicators added"} />
                </SelectTrigger>
                <SelectContent>
                  {addableIndicators.map((ind) => (
                    <SelectItem key={ind.id} value={String(ind.id)}>{ind.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={addIndicator} disabled={!indicatorToAdd || !canEdit}>
                <Plus className="mr-1 h-4 w-4" /> Add indicator
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={addHeading} disabled={!canEdit}>
                <Heading className="mr-1 h-4 w-4" /> Add section heading
              </Button>
            </div>
          )}

          <ScrollArea className="h-[320px] rounded-md border">
            <ul className="divide-y">
              {loading && <li className="p-4 text-sm text-muted-foreground">Loading…</li>}
              {!loading && coordinatorId && items.length === 0 && (
                <li className="p-4 text-sm text-muted-foreground">
                  No indicators available for this coordinator yet.
                </li>
              )}
              {!loading && !coordinatorId && (
                <li className="p-4 text-sm text-muted-foreground">Select a coordinator to begin.</li>
              )}
              {!loading && items.map((item, index) => (
                <li
                  key={item.key}
                  draggable={canEdit}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(index)}
                  className={`flex items-center gap-2 px-3 py-2 ${item.type === "heading" ? "bg-muted/60" : ""}`}
                >
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                  {item.type === "heading" ? (
                    <>
                      <Badge variant="secondary" className="shrink-0">Section</Badge>
                      <Input
                        value={item.section_title}
                        onChange={(e) => setHeadingTitle(item.key, e.target.value)}
                        placeholder="Section heading (e.g. HIV Testing)"
                        className="h-8"
                        disabled={!canEdit}
                      />
                    </>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.indicator_name}</p>
                      {item.indicator_code && (
                        <p className="truncate text-xs text-muted-foreground">{item.indicator_code}</p>
                      )}
                    </div>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => move(index, -1)} disabled={index === 0 || !canEdit} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => move(index, 1)} disabled={index === items.length - 1 || !canEdit} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
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
