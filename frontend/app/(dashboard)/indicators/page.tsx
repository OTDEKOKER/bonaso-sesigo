"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Target, FileText, Hash, ToggleLeft, List, Type, Loader2, Calendar, Filter, GitMerge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { useAllIndicators, useAllProjectDetails, useAssessments } from "@/lib/hooks/use-api"
import { indicatorsService } from "@/lib/api"
import type { Indicator } from "@/lib/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import DisaggregationConfigEditor from "@/components/indicators/disaggregation-config-editor"
import {
  createEmptyDisaggregationConfig,
  type AggregateDisaggregationConfig,
} from "@/lib/indicators/disaggregation-presets"
import {
  canIndicatorBeActive,
  getIndicatorOrganizationIds,
  isIndicatorEffectivelyActive,
} from "@/lib/indicators/activation"
import { resolveIndicatorId } from "@/lib/indicators/id-aliases"
import {
  INDICATOR_CATEGORY_BADGE_CLASSES,
  INDICATOR_CATEGORY_OPTIONS,
  getIndicatorCategoryLabel,
} from "@/lib/indicators/categories"

const typeIcons: Record<string, typeof Target> = {
  yes_no: ToggleLeft,
  number: Hash,
  percentage: Hash,
  text: Type,
  select: List,
  multiselect: List,
  date: Calendar,
  multi_int: FileText,
}

const INDICATOR_LIST_STATE_KEY = "indicators:list-state"

const INITIAL_FORM = {
  name: "",
  short_name: "",
  code: "",
  description: "",
  category: "",
  type: "",
  unit: "",
  options: "",
  disaggregation_config: createEmptyDisaggregationConfig() as AggregateDisaggregationConfig,
  denominator_indicator: null as number | null,
}

function toCanonicalIndicatorKey(indicatorId: string | number | null | undefined) {
  const resolved = resolveIndicatorId(indicatorId)
  return Number.isFinite(resolved) ? String(resolved) : ""
}

function indicatorQualityScore(indicator: Indicator) {
  let score = 0
  const numericId = Number(indicator.id)
  const canonicalId = resolveIndicatorId(indicator.id)
  if (Number.isFinite(numericId) && numericId === canonicalId) score += 100
  if (indicator.short_name?.trim()) score += 10
  if (indicator.unit?.trim()) score += 5
  if (!indicator.code?.startsWith("AUTO_")) score += 2
  return score
}

export default function IndicatorsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { data: indicatorsData, isLoading, error, mutate } = useAllIndicators()
  const { data: projectsData } = useAllProjectDetails()
  const { data: assessmentsData } = useAssessments()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [formData, setFormData] = useState(INITIAL_FORM)
  const [deleteTarget, setDeleteTarget] = useState<Indicator | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const rawState = window.sessionStorage.getItem(INDICATOR_LIST_STATE_KEY)
      if (!rawState) return

      const parsed = JSON.parse(rawState) as {
        activeTab?: string
        statusFilter?: string
        searchQuery?: string
      }

      if (parsed.activeTab) setActiveTab(parsed.activeTab)
      if (parsed.statusFilter) setStatusFilter(parsed.statusFilter)
      if (typeof parsed.searchQuery === "string") setSearchQuery(parsed.searchQuery)
    } catch {
      // Ignore invalid persisted state and fall back to defaults.
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    window.sessionStorage.setItem(
      INDICATOR_LIST_STATE_KEY,
      JSON.stringify({
        activeTab,
        statusFilter,
        searchQuery,
      }),
    )
  }, [activeTab, searchQuery, statusFilter])

  const indicators = useMemo(() => {
    const source = indicatorsData || []
    const deduped = new Map<string, Indicator>()

    source.forEach((indicator) => {
      const canonicalKey = toCanonicalIndicatorKey(indicator.id)
      if (!canonicalKey) return
      const existing = deduped.get(canonicalKey)
      if (!existing) {
        deduped.set(canonicalKey, indicator)
        return
      }

      if (indicatorQualityScore(indicator) > indicatorQualityScore(existing)) {
        deduped.set(canonicalKey, indicator)
      }
    })

    return Array.from(deduped.values())
  }, [indicatorsData])
  const projects = useMemo(() => projectsData?.results || [], [projectsData?.results])
  const assessments = useMemo(() => assessmentsData?.results || [], [assessmentsData?.results])
  const assignedIndicatorIds = useMemo(() => {
    const ids = new Set<string>()

    projects.forEach((project) => {
      ;(project.project_indicators || []).forEach((entry) => {
        const canonicalIndicatorId = toCanonicalIndicatorKey(entry.indicator)
        if (canonicalIndicatorId) ids.add(canonicalIndicatorId)
      })
      ;(project.organization_targets || []).forEach((entry) => {
        const canonicalIndicatorId = toCanonicalIndicatorKey(entry.indicator)
        if (canonicalIndicatorId) ids.add(canonicalIndicatorId)
      })
    })

    return ids
  }, [projects])
  const assignedIndicatorOrganizationIds = useMemo(() => {
    const idsByIndicatorId = new Map<string, Set<string>>()

    projects.forEach((project) => {
      ;(project.organization_targets || []).forEach((entry) => {
        const indicatorId = toCanonicalIndicatorKey(entry.indicator)
        const organizationId = String(entry.organization || "").trim()
        if (!indicatorId || !organizationId) return

        if (!idsByIndicatorId.has(indicatorId)) {
          idsByIndicatorId.set(indicatorId, new Set<string>())
        }
        idsByIndicatorId.get(indicatorId)!.add(organizationId)
      })
    })

    return idsByIndicatorId
  }, [projects])
  const hasProjectAssignmentData = useMemo(
    () => projects.some((project) => Array.isArray(project.project_indicators) || Array.isArray(project.organization_targets)),
    [projects],
  )

  const isIndicatorActiveForList = useCallback(
    (indicator: Indicator) => {
      if (!indicator.is_active) return false

      const indicatorId = toCanonicalIndicatorKey(indicator.id)
      if (!indicatorId) return false
      const organizationIds = new Set(getIndicatorOrganizationIds(indicator))
      assignedIndicatorOrganizationIds.get(indicatorId)?.forEach((organizationId) => {
        organizationIds.add(organizationId)
      })
      const hasOrganizations = organizationIds.size > 0
      if (!hasOrganizations) return false

      if (hasProjectAssignmentData) {
        return assignedIndicatorIds.has(indicatorId)
      }

      if (indicator.project_targets !== undefined) {
        return canIndicatorBeActive(indicator)
      }

      return isIndicatorEffectivelyActive(indicator)
    },
    [assignedIndicatorIds, assignedIndicatorOrganizationIds, hasProjectAssignmentData],
  )

  const filteredIndicators = useMemo(() => {
    return indicators.filter((indicator) => {
      const matchesCategory = activeTab === "all" || indicator.category === activeTab
      const effectiveStatus = isIndicatorActiveForList(indicator) ? "active" : "inactive"
      const matchesStatus = statusFilter === "all" || effectiveStatus === statusFilter
      return matchesCategory && matchesStatus
    })
  }, [activeTab, indicators, isIndicatorActiveForList, statusFilter])

  const columns = useMemo(() => [
    {
      key: "name",
      label: "Indicator",
      sortable: true,
      render: (indicator: Indicator) => {
        const TypeIcon = typeIcons[indicator.type] || Target
        const displayName = indicator.short_name?.trim() || indicator.name
        return (
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-secondary p-2">
              <TypeIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">{displayName}</p>
              {indicator.short_name?.trim() ? (
                <p className="text-xs text-muted-foreground">{indicator.name}</p>
              ) : null}
            </div>
          </div>
        )
      },
    },
    {
      key: "category",
      label: "Category",
      sortable: true,
      render: (indicator: Indicator) => (
        <Badge variant="secondary" className={INDICATOR_CATEGORY_BADGE_CLASSES[indicator.category] || ""}>
          {getIndicatorCategoryLabel(indicator.category)}
        </Badge>
      ),
    },
    {
      key: "type",
      label: "Type",
      render: (indicator: Indicator) => (
        <span className="text-sm text-muted-foreground capitalize">
          {indicator.type.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "unit",
      label: "Unit",
      render: (indicator: Indicator) => (
        <span className="text-sm text-muted-foreground">{indicator.unit || "—"}</span>
      ),
    },
    {
      key: "is_active",
      label: "Status",
      render: (indicator: Indicator) => {
        const active = isIndicatorActiveForList(indicator)
        return (
          <Badge
            variant="secondary"
            className={active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}
          >
            {active ? "Active" : "Inactive"}
          </Badge>
        )
      },
    },
  ], [isIndicatorActiveForList])

  const handleCreate = async () => {
    if (!formData.name || !formData.code || !formData.category || !formData.type) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      await indicatorsService.create({
        name: formData.name,
        short_name: formData.short_name.trim() || undefined,
        code: formData.code,
        description: formData.description || undefined,
        category: formData.category as Indicator["category"],
        type: formData.type as Indicator["type"],
        unit: formData.unit || undefined,
        options: formData.options
          ? formData.options.split(",").map((opt) => opt.trim()).filter(Boolean)
          : undefined,
        // Legacy sub_labels are derived from the config's dimension labels for
        // backward-compatible readers, but the config is the source of truth.
        sub_labels: formData.disaggregation_config.enabled
          ? formData.disaggregation_config.dimensions.map((d) => d.label)
          : undefined,
        aggregate_disaggregation_config: formData.disaggregation_config,
        denominator_indicator:
          formData.type === "percentage" ? formData.denominator_indicator : null,
        is_active: false,
      })
      toast({ title: "Indicator created" })
      setIsCreateOpen(false)
      setFormData(INITIAL_FORM)
      mutate()
    } catch {
      toast({ title: "Error", description: "Failed to create indicator", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await indicatorsService.delete(Number(deleteTarget.id))
      toast({ title: "Indicator deleted" })
      mutate()
    } catch (err) {
      // Surface the server's reason (e.g. reporting-history protection) so the
      // user understands why deletion was blocked and what to do instead (retire).
      const description = err instanceof Error && err.message
        ? err.message
        : "Failed to delete indicator"
      toast({ title: "Cannot delete indicator", description, variant: "destructive" })
    } finally {
      setDeleteTarget(null)
    }
  }

  const actions = (indicator: Indicator) => [
    { label: "View Details", onClick: () => router.push(`/indicators/${indicator.id}`) },
    { label: "Edit", onClick: () => router.push(`/indicators/${indicator.id}/edit`) },
    { label: "Delete", onClick: () => setDeleteTarget(indicator), destructive: true },
  ]

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    const errorMessage = error instanceof Error && error.message ? error.message : "Failed to load indicators"
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="max-w-xl text-center text-muted-foreground">{errorMessage}</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indicators"
        description="Define and manage indicators for data collection"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Indicators" },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/indicators/deduplication")}>
              <GitMerge className="mr-2 h-4 w-4" />
              Deduplication
            </Button>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Indicator
            </Button>
          </div>
        }
      />

      {/* Summary stats */}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={`rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40 ${
            activeTab === "all" ? "border-primary bg-primary/5" : "border-border bg-card"
          }`}
        >
          <p className="text-[10px] leading-tight text-muted-foreground">All Indicators</p>
          <p className="text-base font-bold leading-tight text-foreground sm:text-lg">{indicators.length}</p>
        </button>
        {INDICATOR_CATEGORY_OPTIONS.map((category) => (
          <button
            key={category.value}
            type="button"
            onClick={() => setActiveTab(category.value)}
            className={`rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40 ${
              activeTab === category.value ? "border-primary bg-primary/5" : "border-border bg-card"
            }`}
          >
            <p className="text-[10px] leading-tight text-muted-foreground">{category.label}</p>
            <p className="text-base font-bold leading-tight text-foreground sm:text-lg">
              {indicators.filter((indicator) => indicator.category === category.value).length}
            </p>
          </button>
        ))}
        <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
          <p className="text-[10px] leading-tight text-muted-foreground">Assessments</p>
          <p className="text-base font-bold leading-tight text-muted-foreground sm:text-lg">{assessments.length}</p>
        </div>
      </div>

      <DataTable
        key={`${activeTab}-${statusFilter}`}
        data={filteredIndicators}
        columns={columns}
        searchPlaceholder="Search name, code, category..."
        searchKey="name"
        searchKeys={["name", "short_name", "code", "category", "type"]}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        actions={actions}
        toolbarActions={
          <div className="ml-auto w-full sm:w-[220px]">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Filter by status" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {filteredIndicators.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-14">
          <Target className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {indicators.length === 0 ? "No indicators yet." : "No indicators match the current filters."}
          </p>
          {indicators.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create First Indicator
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Indicator</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Indicator</DialogTitle>
            <DialogDescription>
              Define a new indicator for data collection. New indicators start inactive until they are assigned to at least one project and one organization.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              handleCreate()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="name">Indicator Name *</Label>
                <Input
                  id="name"
                  placeholder="Enter indicator name"
                  value={formData.name}
                  disabled={isSubmitting}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="short_name">Short Name</Label>
                <Input
                  id="short_name"
                  placeholder="e.g., HIV Messages"
                  value={formData.short_name}
                  disabled={isSubmitting}
                  onChange={(e) => setFormData({ ...formData, short_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  placeholder="e.g., HIV_TEST"
                  value={formData.code}
                  disabled={isSubmitting}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of the indicator"
                rows={2}
                value={formData.description}
                disabled={isSubmitting}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">Category *</Label>
                <Select
                  value={formData.category}
                  disabled={isSubmitting}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDICATOR_CATEGORY_OPTIONS.map((category) => (
                      <SelectItem key={category.value} value={category.value}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Response Type *</Label>
                <Select
                  value={formData.type}
                  disabled={isSubmitting}
                  onValueChange={(value) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes_no">Yes/No</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="select">Single Select</SelectItem>
                    <SelectItem value="multiselect">Multiselect</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="multi_int">Multiple Integers</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="unit">Unit</Label>
                <Input
                  id="unit"
                  placeholder="e.g., people, sessions"
                  value={formData.unit}
                  disabled={isSubmitting}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="options">Options (comma-separated)</Label>
                <Input
                  id="options"
                  placeholder="Option A, Option B"
                  value={formData.options}
                  disabled={isSubmitting}
                  onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                />
              </div>
            </div>
            <DisaggregationConfigEditor
              value={formData.disaggregation_config}
              disabled={isSubmitting}
              onChange={(next) =>
                setFormData((prev) => ({ ...prev, disaggregation_config: next }))
              }
              indicatorType={formData.type}
              denominatorId={formData.denominator_indicator}
              onDenominatorChange={(id) =>
                setFormData((prev) => ({ ...prev, denominator_indicator: id }))
              }
              denominatorOptions={indicators.map((i) => ({ id: Number(i.id), name: i.name, code: i.code }))}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Indicator
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
