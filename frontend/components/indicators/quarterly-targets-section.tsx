"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select"
import { useToast } from "@/hooks/use-toast"
import { projectsService } from "@/lib/api"
import { useAllOrganizations, useAllProjects } from "@/lib/hooks/use-api"
import type { ProjectIndicatorTarget } from "@/lib/types"

type QuarterlyTargetsSectionProps = {
  indicatorId: number
  projectTargets?: ProjectIndicatorTarget[]
  editable?: boolean
  onUpdated?: () => Promise<void> | void
}

const fiscalQuarters = [
  { key: "q1_target", label: "Q1", range: "1 Apr - 30 Jun" },
  { key: "q2_target", label: "Q2", range: "1 Jul - 30 Sep" },
  { key: "q3_target", label: "Q3", range: "1 Oct - 31 Dec" },
  { key: "q4_target", label: "Q4", range: "1 Jan - 31 Mar (following year)" },
] as const

type QuarterTargetKey = (typeof fiscalQuarters)[number]["key"]

type OrganizationTargetValues = Record<QuarterTargetKey, string> & {
  baselineValue: string
}

type TargetFormState = {
  projectId: string
  organizationIds: string[]
  targetsByOrganizationId: Record<string, OrganizationTargetValues>
}

const createEmptyTargetValues = (): OrganizationTargetValues => ({
  baselineValue: "",
  q1_target: "",
  q2_target: "",
  q3_target: "",
  q4_target: "",
})

const emptyForm: TargetFormState = {
  projectId: "",
  organizationIds: [],
  targetsByOrganizationId: {},
}

function parseOptionalNumber(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value: unknown): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "-"
  return numeric.toLocaleString()
}

function buildTargetValuesFromTarget(target: ProjectIndicatorTarget): OrganizationTargetValues {
  return {
    baselineValue:
      target.baseline_value === undefined || target.baseline_value === null
        ? ""
        : String(target.baseline_value),
    q1_target: target.q1_target === undefined || target.q1_target === null ? "" : String(target.q1_target),
    q2_target: target.q2_target === undefined || target.q2_target === null ? "" : String(target.q2_target),
    q3_target: target.q3_target === undefined || target.q3_target === null ? "" : String(target.q3_target),
    q4_target: target.q4_target === undefined || target.q4_target === null ? "" : String(target.q4_target),
  }
}

function resolveOrganizationToken(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" || typeof value === "number") return String(value).trim()
  if (typeof value === "object") {
    const source = value as Record<string, unknown>
    const nestedId = source.id ?? source.pk ?? source.value
    if (typeof nestedId === "string" || typeof nestedId === "number") {
      return String(nestedId).trim()
    }
  }
  return ""
}

function syncOrganizationTargets(args: {
  organizationIds: string[]
  currentTargetsByOrganizationId: Record<string, OrganizationTargetValues>
  existingTargetsByProjectOrg: Map<string, ProjectIndicatorTarget>
  projectId: string
}): Record<string, OrganizationTargetValues> {
  const nextTargetsByOrganizationId: Record<string, OrganizationTargetValues> = {}

  args.organizationIds.forEach((organizationId) => {
    const currentDraft = args.currentTargetsByOrganizationId[organizationId]
    if (currentDraft) {
      nextTargetsByOrganizationId[organizationId] = currentDraft
      return
    }

    const existingTarget = args.existingTargetsByProjectOrg.get(`${args.projectId}:${organizationId}`)
    nextTargetsByOrganizationId[organizationId] = existingTarget
      ? buildTargetValuesFromTarget(existingTarget)
      : createEmptyTargetValues()
  })

  return nextTargetsByOrganizationId
}

export function QuarterlyTargetsSection({
  indicatorId,
  projectTargets = [],
  editable = false,
  onUpdated,
}: QuarterlyTargetsSectionProps) {
  const { toast } = useToast()
  const { data: projectsData } = useAllProjects()
  const { data: organizationsData } = useAllOrganizations()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingTarget, setEditingTarget] = useState<ProjectIndicatorTarget | null>(null)
  const [form, setForm] = useState<TargetFormState>(emptyForm)

  const projects = useMemo(() => projectsData?.results || [], [projectsData?.results])
  const organizations = useMemo(() => organizationsData?.results || [], [organizationsData?.results])

  const sortedTargets = useMemo(
    () =>
      [...projectTargets].sort((left, right) =>
        `${left.project_name || ""} ${left.organization_name || ""}`.localeCompare(
          `${right.project_name || ""} ${right.organization_name || ""}`,
        ),
      ),
    [projectTargets],
  )

  const availableProjects = useMemo(
    () => [...projects].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""))),
    [projects],
  )

  const selectedProject = useMemo(
    () => availableProjects.find((project) => String(project.id) === form.projectId),
    [availableProjects, form.projectId],
  )

  const organizationNameById = useMemo<Map<string, string>>(
    () =>
      new Map(
        organizations.map((organization) => [String(organization.id), String(organization.name || "Organization")]),
      ),
    [organizations],
  )

  const existingTargetsByProjectOrg = useMemo(
    () =>
      new Map(
        projectTargets.map((target) => [`${target.project}:${target.organization}`, target] as const),
      ),
    [projectTargets],
  )

  const selectedProjectOrganizationIds = useMemo(() => {
    if (!selectedProject) return []
    const rawValues = Array.isArray((selectedProject as { organizations?: unknown[] }).organizations)
      ? ((selectedProject as { organizations?: unknown[] }).organizations || [])
      : []

    return rawValues
      .map((value) => resolveOrganizationToken(value))
      .filter((value) => value.length > 0)
  }, [selectedProject])

  const availableOrganizations = useMemo(() => {
    if (!selectedProject) return []

    const allowedOrganizationIds = new Set(selectedProjectOrganizationIds)
    const filteredOrganizations =
      allowedOrganizationIds.size > 0
        ? organizations.filter((organization) =>
            allowedOrganizationIds.has(resolveOrganizationToken(organization.id)),
          )
        : organizations

    return filteredOrganizations.sort((left, right) =>
      String(left.name || "").localeCompare(String(right.name || "")),
    )
  }, [organizations, selectedProject, selectedProjectOrganizationIds])

  useEffect(() => {
    if (editingTarget || !form.projectId || form.organizationIds.length > 0 || availableOrganizations.length !== 1) {
      return
    }

    const onlyOrganization = availableOrganizations[0]
    if (!onlyOrganization) return

    const nextOrganizationIds = [String(onlyOrganization.id)]
    setForm((prev) => ({
      ...prev,
      organizationIds: nextOrganizationIds,
      targetsByOrganizationId: syncOrganizationTargets({
        organizationIds: nextOrganizationIds,
        currentTargetsByOrganizationId: prev.targetsByOrganizationId,
        existingTargetsByProjectOrg,
        projectId: prev.projectId,
      }),
    }))
  }, [availableOrganizations, editingTarget, existingTargetsByProjectOrg, form.organizationIds.length, form.projectId])

  const openCreateDialog = () => {
    setEditingTarget(null)
    setForm(emptyForm)
    setIsDialogOpen(true)
  }

  const openEditDialog = (target: ProjectIndicatorTarget) => {
    const organizationId = String(target.organization)
    setEditingTarget(target)
    setForm({
      projectId: String(target.project),
      organizationIds: [organizationId],
      targetsByOrganizationId: {
        [organizationId]: buildTargetValuesFromTarget(target),
      },
    })
    setIsDialogOpen(true)
  }

  const closeDialog = () => {
    if (isSaving) return
    setIsDialogOpen(false)
    setEditingTarget(null)
    setForm(emptyForm)
  }

  const updateOrganizationTargets = (organizationIds: string[]) => {
    setForm((prev) => ({
      ...prev,
      organizationIds,
      targetsByOrganizationId: syncOrganizationTargets({
        organizationIds,
        currentTargetsByOrganizationId: prev.targetsByOrganizationId,
        existingTargetsByProjectOrg,
        projectId: prev.projectId,
      }),
    }))
  }

  const updateOrganizationField = (
    organizationId: string,
    field: keyof OrganizationTargetValues,
    value: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      targetsByOrganizationId: {
        ...prev.targetsByOrganizationId,
        [organizationId]: {
          ...(prev.targetsByOrganizationId[organizationId] || createEmptyTargetValues()),
          [field]: value,
        },
      },
    }))
  }

  const handleSave = async () => {
    if (!form.projectId) {
      toast({
        title: "Validation Error",
        description: "Please select a project.",
        variant: "destructive",
      })
      return
    }

    if (form.organizationIds.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one organization.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    try {
      await Promise.all(
        form.organizationIds.map((organizationId) => {
          const values = form.targetsByOrganizationId[organizationId] || createEmptyTargetValues()
          return projectsService.setTarget(Number(form.projectId), {
            indicator_id: indicatorId,
            organization_id: Number(organizationId),
            q1_target: parseOptionalNumber(values.q1_target),
            q2_target: parseOptionalNumber(values.q2_target),
            q3_target: parseOptionalNumber(values.q3_target),
            q4_target: parseOptionalNumber(values.q4_target),
            baseline_value: parseOptionalNumber(values.baselineValue),
          })
        }),
      )

      toast({
        title: "Targets saved",
        description:
          form.organizationIds.length > 1
            ? "Quarterly targets updated for the selected organizations."
            : "Quarterly targets updated successfully.",
      })

      await onUpdated?.()
      closeDialog()
    } catch (error) {
      const description =
        error instanceof Error && error.message ? error.message : "Failed to save quarterly targets."

      toast({
        title: "Error",
        description,
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Organization Quarterly Targets</CardTitle>
          <CardDescription>
            Each organization has its own financial-year target for this indicator, even when the indicator is shared.
          </CardDescription>
        </div>
        {editable ? (
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Organization Target
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {fiscalQuarters.map((quarter) => (
            <div key={quarter.key} className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{quarter.label}</p>
              <p className="text-xs text-muted-foreground">{quarter.range}</p>
            </div>
          ))}
        </div>

        {sortedTargets.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Q1</TableHead>
                  <TableHead>Q2</TableHead>
                  <TableHead>Q3</TableHead>
                  <TableHead>Q4</TableHead>
                  <TableHead>Annual Total</TableHead>
                  <TableHead>Progress</TableHead>
                  {editable ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTargets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{target.project_name || "Project"}</p>
                        <p className="text-xs text-muted-foreground">{target.project_code || "-"}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{target.organization_name || "Organization"}</p>
                        <p className="text-xs text-muted-foreground">{target.organization_code || "-"}</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatNumber(target.q1_target)}</TableCell>
                    <TableCell>{formatNumber(target.q2_target)}</TableCell>
                    <TableCell>{formatNumber(target.q3_target)}</TableCell>
                    <TableCell>{formatNumber(target.q4_target)}</TableCell>
                    <TableCell className="font-medium">{formatNumber(target.target_value)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{`${target.progress || 0}%`}</Badge>
                    </TableCell>
                    {editable ? (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(target)}>
                          Edit
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            No quarterly targets have been set for this indicator yet.
          </div>
        )}
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : closeDialog())}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingTarget ? "Edit Quarterly Targets" : "Add Quarterly Targets"}</DialogTitle>
            <DialogDescription>
              {editingTarget
                ? "Enter quarterly targets for this organization using the April to March financial year. Leave blanks where targets are not available yet."
                : "Select one or more organizations, then enter quarterly targets for each organization separately."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-2">
            <div className="space-y-2">
              <Label>Project *</Label>
              <Select
                value={form.projectId}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    projectId: value,
                    organizationIds: editingTarget ? prev.organizationIds : [],
                    targetsByOrganizationId: editingTarget ? prev.targetsByOrganizationId : {},
                  }))
                }
                disabled={Boolean(editingTarget)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Organizations *</Label>
              <OrganizationMultiSelect
                organizations={availableOrganizations.map((organization) => ({
                  id: organization.id,
                  name: organization.name,
                }))}
                selectedIds={form.organizationIds}
                onChange={updateOrganizationTargets}
                disabled={!form.projectId || Boolean(editingTarget)}
                placeholder={form.projectId ? "Select organizations" : "Select project first"}
                emptyLabel={form.projectId ? "Select organizations" : "Select project first"}
                allLabel="All available organizations"
                selectAllLabel="Select all organizations"
              />
            </div>

            {form.organizationIds.length > 0 ? (
              <ScrollArea className="min-h-0 flex-1 pr-4">
                <div className="space-y-4 pb-4">
                  {form.organizationIds.map((organizationId) => {
                    const targetValues = form.targetsByOrganizationId[organizationId] || createEmptyTargetValues()
                    const organizationName = organizationNameById.get(organizationId) || "Organization"

                    return (
                      <div key={organizationId} className="space-y-4 rounded-lg border border-border p-4">
                        <div className="space-y-1">
                          <p className="font-medium">{organizationName}</p>
                          <p className="text-xs text-muted-foreground">
                            Quarterly targets and baseline for this organization.
                          </p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          {fiscalQuarters.map((quarter) => (
                            <div key={`${organizationId}-${quarter.key}`} className="space-y-2">
                              <Label htmlFor={`${organizationId}-${quarter.key}`}>{quarter.label}</Label>
                              <Input
                                id={`${organizationId}-${quarter.key}`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={targetValues[quarter.key]}
                                onChange={(event) =>
                                  updateOrganizationField(organizationId, quarter.key, event.target.value)
                                }
                              />
                              <p className="text-xs text-muted-foreground">{quarter.range}</p>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${organizationId}-baselineValue`}>Baseline Value</Label>
                          <Input
                            id={`${organizationId}-baselineValue`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={targetValues.baselineValue}
                            onChange={(event) =>
                              updateOrganizationField(organizationId, "baselineValue", event.target.value)
                            }
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            ) : null}
          </div>

          <DialogFooter className="mt-2 shrink-0 border-t pt-4">
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Targets
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export default QuarterlyTargetsSection
