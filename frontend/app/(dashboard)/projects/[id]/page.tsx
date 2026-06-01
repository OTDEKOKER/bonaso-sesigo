"use client"

import React, { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Calendar, Users, Target, CheckCircle2, Clock, Edit, Trash2, Plus, Loader2, Building2, ChevronDown, FileText, Download, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { useAllIndicators, useAllOrganizations, useDeadlines, useNarrativeReports, useProject, useProjectActivities, useTasks } from "@/lib/hooks/use-api"
import { deadlinesService, narrativeReportsService, projectActivitiesService, projectsService, tasksService } from "@/lib/api"
import type { NarrativeReport, ProjectActivity } from "@/lib/api"
import type { ProjectDeadline, ProjectIndicatorTarget, Task } from "@/lib/types"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select"
import { useToast } from "@/hooks/use-toast"

const statusColors: Record<string, string> = {
  active: "bg-primary/10 text-primary",
  completed: "bg-chart-2/10 text-chart-2",
  draft: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
}

const fiscalQuarters = [
  { key: "q1_target", label: "Q1", range: "1 Apr – 30 Jun" },
  { key: "q2_target", label: "Q2", range: "1 Jul – 30 Sep" },
  { key: "q3_target", label: "Q3", range: "1 Oct – 31 Dec" },
  { key: "q4_target", label: "Q4", range: "1 Jan – 31 Mar (following year)" },
] as const

const projectRoleOptions = [
  { value: "lead", label: "Lead" },
  { value: "coordinator", label: "Coordinator" },
  { value: "sub_grantee", label: "Sub-grantee" },
  { value: "implementing_partner", label: "Implementing Partner" },
  { value: "data_reviewer", label: "Data Reviewer" },
  { value: "funder", label: "Funder" },
  { value: "other", label: "Other" },
] as const

function formatNumber(value: unknown): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "—"
  return numeric.toLocaleString()
}

function coerceId(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeHierarchyOverrides(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const normalized: Record<string, string[]> = {}

  Object.entries(value as Record<string, unknown>).forEach(([rawParentId, rawChildren]) => {
    const parentId = coerceId(rawParentId)
    if (!parentId || !Array.isArray(rawChildren)) return

    const childIds = Array.from(
      new Set(
        rawChildren
          .map((rawChildId) => coerceId(rawChildId))
          .filter((childId) => childId.length > 0 && childId !== parentId),
      ),
    )
    normalized[parentId] = childIds
  })

  return normalized
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast } = useToast()
  const routeProjectId = Number(id)
  const { data: project, isLoading, error, mutate: mutateProject } = useProject(
    Number.isFinite(routeProjectId) ? routeProjectId : null,
    { keepPreviousData: false }
  )
  const resolvedProjectId = Number(project?.id)
  const activeProjectId = Number.isFinite(resolvedProjectId) ? resolvedProjectId : routeProjectId
  const isResolvedProject = Boolean(project) && Number.isFinite(resolvedProjectId) && resolvedProjectId === routeProjectId
  const { data: tasksData, mutate: mutateTasks } = useTasks(
    isResolvedProject ? { project: String(activeProjectId) } : undefined,
    { keepPreviousData: false }
  )
  const { data: deadlinesData, mutate: mutateDeadlines } = useDeadlines(
    isResolvedProject ? { project: String(activeProjectId) } : undefined,
    { keepPreviousData: false }
  )
  const { data: activitiesData, mutate: mutateActivities } = useProjectActivities(
    isResolvedProject ? { project: String(activeProjectId) } : undefined,
    { keepPreviousData: false }
  )
  const { data: reportsData, mutate: mutateReports } = useNarrativeReports(
    isResolvedProject ? { project: String(activeProjectId) } : undefined,
    { keepPreviousData: false }
  )
  const { data: organizationsData } = useAllOrganizations()
  const { data: indicatorsData } = useAllIndicators({ is_active: "true" })
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isTaskOpen, setIsTaskOpen] = useState(false)
  const [isDeadlineOpen, setIsDeadlineOpen] = useState(false)
  const [isActivityOpen, setIsActivityOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<ProjectActivity | null>(null)
  const [activityForm, setActivityForm] = useState({
    title: "", description: "", status: "planned" as ProjectActivity["status"],
    start_date: "", end_date: "", visible_to_all: true,
  })
  const [isSavingActivity, setIsSavingActivity] = useState(false)
  const [isReportOpen, setIsReportOpen] = useState(false)
  const [editingReport, setEditingReport] = useState<NarrativeReport | null>(null)
  const [reportForm, setReportForm] = useState({ title: "", description: "", organization: "", file: null as File | null })
  const [isSavingReport, setIsSavingReport] = useState(false)
  const [activeTab, setActiveTab] = useState("tasks")
  const [isManageOrgsOpen, setIsManageOrgsOpen] = useState(false)
  const [manageOrgSearch, setManageOrgSearch] = useState("")
  const [managedOrgIds, setManagedOrgIds] = useState<string[]>([])
  const [isManageOrgsSaving, setIsManageOrgsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editForm, setEditForm] = useState({
    name: "",
    code: "",
    description: "",
    status: "active",
    start_date: "",
    end_date: "",
  })
  const [taskForm, setTaskForm] = useState({
    name: "",
    description: "",
    due_date: "",
    priority: "medium",
  })
  const [deadlineForm, setDeadlineForm] = useState({
    name: "",
    description: "",
    due_date: "",
  })
  const [newHierarchyCoordinatorId, setNewHierarchyCoordinatorId] = useState("")
  const [hierarchyDraft, setHierarchyDraft] = useState<Record<string, string[]>>({})
  const [isHierarchySaving, setIsHierarchySaving] = useState(false)
  const [organizationRoleDraft, setOrganizationRoleDraft] = useState<Record<string, string>>({})
  const [isRoleSaving, setIsRoleSaving] = useState(false)
  const [indicatorAssignmentDraft, setIndicatorAssignmentDraft] = useState<Record<string, string[]>>({})
  const [indicatorDisaggregationDraft, setIndicatorDisaggregationDraft] = useState<Record<string, string>>({})
  const [isIndicatorSetupSaving, setIsIndicatorSetupSaving] = useState(false)

  const groupedTargets = (() => {
    if (!project) return []
    const targets = project.organization_targets || []
    const groups = new Map<
      string,
      {
        organizationId: string
        organizationName: string
        organizationCode: string
        targets: ProjectIndicatorTarget[]
      }
    >()

    targets.forEach((target) => {
      const organizationId = String(target.organization || "")
      const existing = groups.get(organizationId)
      if (existing) {
        existing.targets.push(target)
        return
      }

      groups.set(organizationId, {
        organizationId,
        organizationName: target.organization_name || "Organization",
        organizationCode: target.organization_code || "—",
        targets: [target],
      })
    })

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        targets: [...group.targets].sort((left, right) =>
          `${left.indicator_name || ""}`.localeCompare(`${right.indicator_name || ""}`),
        ),
      }))
      .sort((left, right) => left.organizationName.localeCompare(right.organizationName))
  })()

  const projectTasks = tasksData?.results || []
  const projectDeadlines = deadlinesData?.results || []
  const projectActivities = activitiesData?.results || []
  const narrativeReports = reportsData?.results || []
  const projectOrganizationScope = useMemo(
    () => (project?.organizations || []).map((organizationId) => String(organizationId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project],
  )
  const projectOrgs = useMemo(
    () =>
      (organizationsData?.results || []).filter((organization) =>
        projectOrganizationScope.includes(String(organization.id)),
      ),
    [organizationsData, projectOrganizationScope],
  )
  const projectOrganizationIds = useMemo(
    () => projectOrgs.map((organization) => coerceId(organization.id)),
    [projectOrgs],
  )
  const projectOrganizationIdsKey = useMemo(
    () => projectOrganizationIds.join("|"),
    [projectOrganizationIds],
  )
  const projectOrganizationOptions = useMemo(
    () =>
      projectOrgs
        .map((organization) => ({
          id: coerceId(organization.id),
          name: String(organization.name || `Organization ${organization.id}`),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projectOrgs],
  )
  const hierarchyCoordinatorIds = Object.keys(hierarchyDraft).sort((left, right) => {
    const leftName = projectOrganizationOptions.find((entry) => entry.id === left)?.name || left
    const rightName = projectOrganizationOptions.find((entry) => entry.id === right)?.name || right
    return leftName.localeCompare(rightName)
  })
  const availableCoordinatorIds = projectOrganizationOptions
    .filter((option) => !hierarchyCoordinatorIds.includes(option.id))
    .map((option) => option.id)
  const progress = Number.isFinite(Number(project?.progress_percentage))
    ? Number(project?.progress_percentage)
    : 0
  const projectIndicators = useMemo(
    () => project?.project_indicators || [],
    [project?.project_indicators],
  )
  const indicatorLookup = useMemo(
    () => new Map((indicatorsData || []).map((indicator) => [String(indicator.id), indicator])),
    [indicatorsData],
  )

  useEffect(() => {
    if (!project || !isResolvedProject) {
      setHierarchyDraft({})
      setNewHierarchyCoordinatorId("")
      return
    }

    const normalized = normalizeHierarchyOverrides(project.hierarchy_overrides)
    const allowedOrganizationIds = new Set(
      projectOrganizationIdsKey
        .split("|")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    )
    const filtered: Record<string, string[]> = {}

    Object.entries(normalized).forEach(([coordinatorId, childIds]) => {
      if (!allowedOrganizationIds.has(coordinatorId)) return
      const nextChildren = childIds.filter(
        (childId) => childId !== coordinatorId && allowedOrganizationIds.has(childId),
      )
      filtered[coordinatorId] = nextChildren
    })

    setHierarchyDraft(filtered)
    setNewHierarchyCoordinatorId("")
  }, [isResolvedProject, project, projectOrganizationIdsKey])

  useEffect(() => {
    if (!project || !isResolvedProject) {
      setOrganizationRoleDraft({})
      setIndicatorAssignmentDraft({})
      setIndicatorDisaggregationDraft({})
      return
    }

    const roleSeed: Record<string, string> = {}
    projectOrganizationOptions.forEach((organization) => {
      roleSeed[organization.id] = "implementing_partner"
    })
    ;(project.project_organizations || []).forEach((membership) => {
      const organizationId = coerceId(membership.organization)
      if (!organizationId) return
      roleSeed[organizationId] = membership.role || "implementing_partner"
    })
    setOrganizationRoleDraft(roleSeed)

    const assignmentSeed: Record<string, string[]> = {}
    const disaggregationSeedMap = new Map<string, Set<string>>()
    projectIndicators.forEach((row) => {
      const indicatorId = coerceId(row.indicator)
      if (!indicatorId) return
      assignmentSeed[indicatorId] = []
      disaggregationSeedMap.set(indicatorId, new Set<string>())
    })

    ;(project.project_indicator_assignments || [])
      .filter((assignment) => assignment.is_active)
      .forEach((assignment) => {
        const indicatorId = coerceId(assignment.indicator)
        const organizationId = coerceId(assignment.organization)
        if (!indicatorId || !organizationId) return
        if (!assignmentSeed[indicatorId]) assignmentSeed[indicatorId] = []
        if (!assignmentSeed[indicatorId].includes(organizationId)) {
          assignmentSeed[indicatorId].push(organizationId)
        }
      })

    ;(project.project_disaggregation_rules || [])
      .filter((rule) => rule.is_active !== false)
      .forEach((rule) => {
        const indicatorId = coerceId(rule.indicator)
        const dimensionKey = String(rule.dimension_key || "").trim()
        if (!indicatorId || !dimensionKey) return
        if (!disaggregationSeedMap.has(indicatorId)) {
          disaggregationSeedMap.set(indicatorId, new Set<string>())
        }
        disaggregationSeedMap.get(indicatorId)?.add(dimensionKey)
      })

    const disaggregationSeed: Record<string, string> = {}
    disaggregationSeedMap.forEach((values, indicatorId) => {
      disaggregationSeed[indicatorId] = Array.from(values).join(", ")
    })

    setIndicatorAssignmentDraft(assignmentSeed)
    setIndicatorDisaggregationDraft(disaggregationSeed)
  }, [isResolvedProject, project, projectIndicators])

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !project || !isResolvedProject) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    )
  }

  const getApiErrorMessage = (err: unknown, fallback: string) => {
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message.trim()) {
      return err.message
    }
    return fallback
  }

  const addHierarchyCoordinator = (coordinatorId: string) => {
    if (!coordinatorId) return
    setHierarchyDraft((current) => {
      if (current[coordinatorId]) return current
      return { ...current, [coordinatorId]: [] }
    })
  }

  const handleAddHierarchyCoordinator = () => {
    if (!newHierarchyCoordinatorId) return
    addHierarchyCoordinator(newHierarchyCoordinatorId)
    setNewHierarchyCoordinatorId("")
  }

  const removeHierarchyCoordinator = (coordinatorId: string) => {
    setHierarchyDraft((current) => {
      if (!current[coordinatorId]) return current
      const next = { ...current }
      delete next[coordinatorId]
      return next
    })
  }

  const updateHierarchyChildren = (coordinatorId: string, childIds: string[]) => {
    const sanitized = Array.from(new Set(childIds.filter((childId) => childId !== coordinatorId)))
    setHierarchyDraft((current) => ({ ...current, [coordinatorId]: sanitized }))
  }

  const handleSaveHierarchyOverrides = async () => {
    setIsHierarchySaving(true)
    try {
      const allowedOrganizationIds = new Set(projectOrganizationIds)
      const links: Array<{ parent_organization_id: number; child_organization_id: number }> = []

      Object.entries(hierarchyDraft).forEach(([coordinatorId, childIds]) => {
        if (!allowedOrganizationIds.has(coordinatorId)) return
        const parentNum = Number(coordinatorId)
        if (!Number.isFinite(parentNum)) return
        childIds.forEach((childId) => {
          if (childId === coordinatorId || !allowedOrganizationIds.has(childId)) return
          const childNum = Number(childId)
          if (!Number.isFinite(childNum)) return
          links.push({ parent_organization_id: parentNum, child_organization_id: childNum })
        })
      })

      // Use the new normalized endpoint; it also dual-writes hierarchy_overrides for compat.
      await projectsService.setHierarchyLinks(activeProjectId, links, true)
      await mutateProject()
      toast({
        title: "Project hierarchy saved",
        description: "Coordinator to organization mappings were updated for this project.",
      })
    } catch (err) {
      toast({
        title: "Save failed",
        description: getApiErrorMessage(err, "Could not save project hierarchy."),
        variant: "destructive",
      })
    } finally {
      setIsHierarchySaving(false)
    }
  }

  const openManageOrgs = () => {
    setManagedOrgIds(projectOrganizationIds)
    setManageOrgSearch("")
    setIsManageOrgsOpen(true)
  }

  const handleSaveOrganizations = async () => {
    setIsManageOrgsSaving(true)
    try {
      const newOrgIds = managedOrgIds.map(Number).filter(Number.isFinite)
      // PATCH project with new org list (existing endpoint)
      await projectsService.update(activeProjectId, { organizations: newOrgIds })
      // Ensure ProjectOrganization rows exist for newly added orgs (default role)
      const addedOrgIds = managedOrgIds.filter((id) => !projectOrganizationIds.includes(id))
      if (addedOrgIds.length > 0) {
        const existingRoles = Object.fromEntries(
          (project?.project_organizations || []).map((m) => [coerceId(m.organization), m.role])
        )
        await projectsService.setOrganizationRoles(
          activeProjectId,
          addedOrgIds.map((id) => ({
            organization_id: Number(id),
            role: (existingRoles[id] || "implementing_partner") as
              | "lead"
              | "coordinator"
              | "sub_grantee"
              | "implementing_partner"
              | "data_reviewer"
              | "funder"
              | "other",
            is_active: true,
          })),
        )
      }
      // Deactivate removed orgs in ProjectOrganization
      const removedOrgIds = projectOrganizationIds.filter((id) => !managedOrgIds.includes(id))
      if (removedOrgIds.length > 0) {
        await projectsService.setOrganizationRoles(
          activeProjectId,
          removedOrgIds.map((id) => ({
            organization_id: Number(id),
            role: (project?.project_organizations?.find((m) => coerceId(m.organization) === id)?.role ||
              "implementing_partner") as
              | "lead"
              | "coordinator"
              | "sub_grantee"
              | "implementing_partner"
              | "data_reviewer"
              | "funder"
              | "other",
            is_active: false,
          })),
        )
      }
      await mutateProject()
      setIsManageOrgsOpen(false)
      toast({
        title: "Organizations updated",
        description: "Project organization list has been saved.",
      })
    } catch (err) {
      toast({
        title: "Save failed",
        description: getApiErrorMessage(err, "Could not update project organizations."),
        variant: "destructive",
      })
    } finally {
      setIsManageOrgsSaving(false)
    }
  }

  const handleSaveOrganizationRoles = async () => {
    setIsRoleSaving(true)
    try {
      const validRoleValues = new Set(projectRoleOptions.map((option) => option.value))
      const rolesPayload = projectOrganizationIds.map((organizationId) => {
        const roleCandidate = organizationRoleDraft[organizationId] || "implementing_partner"
        const normalizedRole = validRoleValues.has(roleCandidate)
          ? roleCandidate
          : "implementing_partner"
        return {
          organization_id: Number(organizationId),
          role: normalizedRole as
            | "lead"
            | "coordinator"
            | "sub_grantee"
            | "implementing_partner"
            | "data_reviewer"
            | "funder"
            | "other",
          is_active: true,
        }
      })

      await projectsService.setOrganizationRoles(activeProjectId, rolesPayload)
      await mutateProject()
      toast({
        title: "Organization roles saved",
        description: "Project organization roles were updated.",
      })
    } catch (err) {
      toast({
        title: "Save failed",
        description: getApiErrorMessage(err, "Could not save organization roles."),
        variant: "destructive",
      })
    } finally {
      setIsRoleSaving(false)
    }
  }

  const updateIndicatorAssignmentOrganizations = (indicatorId: string, organizationIds: string[]) => {
    setIndicatorAssignmentDraft((current) => ({
      ...current,
      [indicatorId]: Array.from(new Set(organizationIds)),
    }))
  }

  const updateIndicatorDisaggregationValue = (indicatorId: string, value: string) => {
    setIndicatorDisaggregationDraft((current) => ({
      ...current,
      [indicatorId]: value,
    }))
  }

  const handleSaveIndicatorSetup = async () => {
    setIsIndicatorSetupSaving(true)
    try {
      const assignmentsPayload = projectIndicators
        .map((indicatorRow) => {
          const indicatorId = coerceId(indicatorRow.indicator)
          const indicatorIdNumber = Number(indicatorId)
          const organizationIds = (indicatorAssignmentDraft[indicatorId] || [])
            .map((organizationId) => Number(organizationId))
            .filter((organizationId) => Number.isFinite(organizationId))
          const dimensions = String(indicatorDisaggregationDraft[indicatorId] || "")
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
          return {
            indicator_id: Number.isFinite(indicatorIdNumber) ? indicatorIdNumber : 0,
            organization_ids: organizationIds,
            disaggregation_rules: dimensions.map((dimensionKey, index) => ({
              dimension_key: dimensionKey,
              display_label: dimensionKey,
              is_required: true,
              is_active: true,
              sort_order: index,
              config: {},
            })),
          }
        })
        .filter((entry) => entry.indicator_id > 0)

      await projectsService.setIndicatorAssignments(activeProjectId, assignmentsPayload, true)
      await mutateProject()
      toast({
        title: "Indicator setup saved",
        description: "Project indicator assignments and disaggregation rules were updated.",
      })
    } catch (err) {
      toast({
        title: "Save failed",
        description: getApiErrorMessage(err, "Could not save indicator setup."),
        variant: "destructive",
      })
    } finally {
      setIsIndicatorSetupSaving(false)
    }
  }

  const taskColumns = [
    {
      key: "name",
      label: "Task",
      render: (task: Task) => (
        <div>
          <p className="font-medium text-foreground">{task.name}</p>
          <p className="text-xs text-muted-foreground">{task.project_name || "—"}</p>
        </div>
      )
    },
    {
      key: "priority",
      label: "Priority",
      render: (task: Task) => (
        <Badge variant="secondary" className={
          task.priority === 'urgent' ? 'bg-destructive/10 text-destructive' :
          task.priority === 'high' ? 'bg-chart-3/10 text-chart-3' :
          task.priority === 'medium' ? 'bg-primary/10 text-primary' :
          'bg-muted text-muted-foreground'
        }>
          {task.priority}
        </Badge>
      )
    },
    {
      key: "due_date",
      label: "Due Date",
      render: (task: Task) => (
        <span className="text-sm text-muted-foreground">
          {task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}
        </span>
      )
    },
    {
      key: "status",
      label: "Status",
      render: (task: Task) => (
        <Badge variant="secondary" className={
          task.status === 'completed' ? 'bg-chart-2/10 text-chart-2' :
          task.status === 'in_progress' ? 'bg-primary/10 text-primary' :
          task.status === 'cancelled' ? 'bg-destructive/10 text-destructive' :
          'bg-muted text-muted-foreground'
        }>
          {task.status.replace('_', ' ')}
        </Badge>
      )
    }
  ]

  const openEdit = () => {
    setEditForm({
      name: project.name || "",
      code: project.code || "",
      description: project.description || "",
      status: project.status || "active",
      start_date: project.start_date || "",
      end_date: project.end_date || "",
    })
    setIsEditOpen(true)
  }

  const handleUpdateProject = async () => {
    if (!editForm.name || !editForm.code || !editForm.start_date || !editForm.end_date) {
      toast({
        title: "Validation Error",
        description: "Name, code, and dates are required.",
        variant: "destructive",
      })
      return
    }
    setIsSubmitting(true)
    try {
      await projectsService.update(activeProjectId, {
        name: editForm.name,
        code: editForm.code,
        description: editForm.description || undefined,
        status: editForm.status as "draft" | "active" | "completed" | "archived",
        start_date: editForm.start_date,
        end_date: editForm.end_date,
      })
      toast({ title: "Project updated" })
      setIsEditOpen(false)
      mutateProject()
    } catch (err) {
      console.error("Failed to update project", err)
      toast({
        title: "Update failed",
        description: getApiErrorMessage(err, "Could not update project."),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteProject = async () => {
    if (!confirm("Delete this project? This cannot be undone.")) return
    setIsSubmitting(true)
    try {
      await projectsService.delete(activeProjectId)
      toast({ title: "Project deleted" })
      router.push("/projects")
    } catch (err) {
      console.error("Failed to delete project", err)
      toast({
        title: "Delete failed",
        description: getApiErrorMessage(err, "Could not delete project."),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateTask = async () => {
    if (!taskForm.name) {
      toast({
        title: "Validation Error",
        description: "Task name is required.",
        variant: "destructive",
      })
      return
    }
    setIsSubmitting(true)
    try {
      await tasksService.create({
        name: taskForm.name,
        description: taskForm.description || undefined,
        project: activeProjectId,
        due_date: taskForm.due_date || project.end_date || undefined,
        priority: taskForm.priority as "low" | "medium" | "high" | "urgent",
      })
      toast({ title: "Task created" })
      setTaskForm({ name: "", description: "", due_date: "", priority: "medium" })
      setIsTaskOpen(false)
      mutateTasks()
    } catch (err) {
      console.error("Failed to create task", err)
      toast({
        title: "Create failed",
        description: getApiErrorMessage(err, "Could not create task."),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateDeadline = async () => {
    if (!deadlineForm.name || !deadlineForm.due_date) {
      toast({
        title: "Validation Error",
        description: "Deadline name and due date are required.",
        variant: "destructive",
      })
      return
    }
    setIsSubmitting(true)
    try {
      await deadlinesService.create({
        project: activeProjectId,
        name: deadlineForm.name,
        description: deadlineForm.description || undefined,
        due_date: deadlineForm.due_date,
      })
      toast({ title: "Deadline created" })
      setDeadlineForm({ name: "", description: "", due_date: "" })
      setIsDeadlineOpen(false)
      mutateDeadlines()
    } catch (err) {
      console.error("Failed to create deadline", err)
      toast({
        title: "Create failed",
        description: getApiErrorMessage(err, "Could not create deadline."),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveActivity = async () => {
    if (!activityForm.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" })
      return
    }
    setIsSavingActivity(true)
    try {
      const payload = {
        project: activeProjectId,
        title: activityForm.title.trim(),
        description: activityForm.description || undefined,
        status: activityForm.status,
        start_date: activityForm.start_date || undefined,
        end_date: activityForm.end_date || undefined,
        visible_to_all: activityForm.visible_to_all,
      }
      if (editingActivity) {
        await projectActivitiesService.update(Number(editingActivity.id), payload)
      } else {
        await projectActivitiesService.create(payload)
      }
      mutateActivities()
      setIsActivityOpen(false)
      toast({ title: editingActivity ? "Activity updated" : "Activity added" })
    } catch (err) {
      toast({ title: "Error", description: getApiErrorMessage(err, "Could not save activity."), variant: "destructive" })
    } finally {
      setIsSavingActivity(false)
    }
  }

  const handleDeleteActivity = async (act: ProjectActivity) => {
    try {
      await projectActivitiesService.delete(Number(act.id))
      mutateActivities()
      toast({ title: "Activity deleted" })
    } catch (err) {
      toast({ title: "Error", description: getApiErrorMessage(err, "Could not delete activity."), variant: "destructive" })
    }
  }

  const handleSaveReport = async () => {
    if (!reportForm.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" })
      return
    }
    if (!editingReport && !reportForm.file) {
      toast({ title: "File is required", variant: "destructive" })
      return
    }
    setIsSavingReport(true)
    try {
      const fd = new FormData()
      fd.append("project", String(activeProjectId))
      fd.append("title", reportForm.title.trim())
      if (reportForm.description) fd.append("description", reportForm.description)
      if (reportForm.organization) fd.append("organization", reportForm.organization)
      if (reportForm.file) fd.append("file", reportForm.file)
      if (editingReport) {
        await narrativeReportsService.update(editingReport.id, fd)
      } else {
        await narrativeReportsService.create(fd)
      }
      mutateReports()
      setIsReportOpen(false)
      toast({ title: editingReport ? "Report updated" : "Report uploaded" })
    } catch (err) {
      toast({ title: "Error", description: getApiErrorMessage(err, "Could not save report."), variant: "destructive" })
    } finally {
      setIsSavingReport(false)
    }
  }

  const handleDeleteReport = async (report: NarrativeReport) => {
    try {
      await narrativeReportsService.delete(report.id)
      mutateReports()
      toast({ title: "Report deleted" })
    } catch (err) {
      toast({ title: "Error", description: getApiErrorMessage(err, "Could not delete report."), variant: "destructive" })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        description={project.description}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={openEdit}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="text-destructive hover:text-destructive bg-transparent"
              onClick={handleDeleteProject}
              disabled={isSubmitting}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* Training mode warning banner */}
      {project.is_training && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-6 py-4 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-amber-600">⚠</span>
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                Training Mode — DEMO DATA — NOT FOR OFFICIAL REPORTING
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                You are working in Training Mode. Data entered here is for practice only and will
                not be used for official reporting. Training data may be automatically cleared after{" "}
                {project.training_expires_after_days ?? 7} days.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Project overview cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary" className={statusColors[project.status]}>
              {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Timeline</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                {new Date(project.start_date).toLocaleDateString()} - {new Date(project.end_date).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Organizations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{project.organizations?.length || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Project Progress</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{progress}%</span>
            </div>
            <Progress value={progress} className="mt-2 h-2" />
            <p className="mt-2 text-xs text-muted-foreground">
              Indicator targets are managed from indicator pages.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-secondary">
          <TabsTrigger value="tasks">Tasks ({projectTasks.length})</TabsTrigger>
          <TabsTrigger value="targets">Targets ({project.organization_targets?.length || 0})</TabsTrigger>
          <TabsTrigger value="organizations">Organizations ({projectOrgs.length})</TabsTrigger>
          <TabsTrigger value="setup">Project Setup</TabsTrigger>
          <TabsTrigger value="deadlines">Deadlines ({projectDeadlines.length})</TabsTrigger>
          <TabsTrigger value="activities">Activities ({projectActivities.length})</TabsTrigger>
          <TabsTrigger value="reports">Reports ({narrativeReports.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setIsTaskOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Task
            </Button>
          </div>
          <DataTable
            data={projectTasks}
            columns={taskColumns}
            searchPlaceholder="Search tasks..."
          />
        </TabsContent>

        <TabsContent value="targets" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization Targets</CardTitle>
              <CardDescription>
                Shared indicators can have different quarterly targets for each organization in this project.
              </CardDescription>
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

              {groupedTargets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No organization targets have been set for this project yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedTargets.map((group) => (
                    <Card key={group.organizationId}>
                      <CardHeader>
                        <CardTitle className="text-base">{group.organizationName}</CardTitle>
                        <CardDescription>{group.organizationCode}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto rounded-md border">
                          <table className="min-w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="px-4 py-3 text-left font-medium">Indicator</th>
                                <th className="px-4 py-3 text-left font-medium">Q1</th>
                                <th className="px-4 py-3 text-left font-medium">Q2</th>
                                <th className="px-4 py-3 text-left font-medium">Q3</th>
                                <th className="px-4 py-3 text-left font-medium">Q4</th>
                                <th className="px-4 py-3 text-left font-medium">Annual Total</th>
                                <th className="px-4 py-3 text-left font-medium">Progress</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.targets.map((target) => (
                                <tr key={target.id} className="border-t">
                                  <td className="px-4 py-3">
                                    <div>
                                      <p className="font-medium">{target.indicator_name || "Indicator"}</p>
                                      <p className="text-xs text-muted-foreground">{target.indicator_code || "—"}</p>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">{formatNumber(target.q1_target)}</td>
                                  <td className="px-4 py-3">{formatNumber(target.q2_target)}</td>
                                  <td className="px-4 py-3">{formatNumber(target.q3_target)}</td>
                                  <td className="px-4 py-3">{formatNumber(target.q4_target)}</td>
                                  <td className="px-4 py-3 font-medium">{formatNumber(target.target_value)}</td>
                                  <td className="px-4 py-3">
                                    <Badge variant="secondary">{`${target.progress || 0}%`}</Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organizations" className="mt-6">
          <div className="space-y-5">

            {/* Top bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {projectOrgs.length} organization{projectOrgs.length !== 1 ? "s" : ""} in this project
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openManageOrgs}>
                  <Users className="mr-2 h-4 w-4" />
                  Manage
                </Button>
              </div>
            </div>

            {/* ── Visual hierarchy tree ── */}
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Reporting chain</p>
                <p className="text-xs text-muted-foreground">
                  {hierarchyCoordinatorIds.length > 0 ? "Project-specific hierarchy" : "Using global parent-child links"}
                </p>
              </div>
              <div className="p-4">
                {projectOrgs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No organizations assigned yet.</p>
                ) : hierarchyCoordinatorIds.length > 0 ? (
                  /* Project-specific hierarchy from hierarchyDraft */
                  <div className="space-y-3">
                    {hierarchyCoordinatorIds.map((coordinatorId) => {
                      const coordName = projectOrganizationOptions.find((o) => o.id === coordinatorId)?.name || `Org ${coordinatorId}`
                      const childIds: string[] = hierarchyDraft[coordinatorId] || []
                      const role = organizationRoleDraft[coordinatorId] || "coordinator"
                      return (
                        <div key={coordinatorId}>
                          {/* Coordinator row */}
                          <div
                            className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 hover:bg-muted/50 transition-colors"
                            onClick={() => router.push(`/organizations/${coordinatorId}`)}
                          >
                            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium">{coordName}</span>
                            </div>
                            <Badge variant="secondary" className="text-xs capitalize shrink-0">
                              {role.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          {/* Sub-grantees */}
                          {childIds.length > 0 && (
                            <div className="ml-6 mt-1.5 space-y-1.5 border-l-2 border-border pl-4">
                              {childIds.map((childId) => {
                                const childName = projectOrganizationOptions.find((o) => o.id === childId)?.name || `Org ${childId}`
                                const childRole = organizationRoleDraft[childId] || "implementing_partner"
                                return (
                                  <div
                                    key={childId}
                                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors"
                                    onClick={() => router.push(`/organizations/${childId}`)}
                                  >
                                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="flex-1 text-sm">{childName}</span>
                                    <Badge variant="outline" className="text-xs capitalize shrink-0">
                                      {childRole.replace(/_/g, " ")}
                                    </Badge>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {/* Orgs not in any coordinator's children */}
                    {(() => {
                      const assignedIds = new Set([
                        ...hierarchyCoordinatorIds,
                        ...Object.values(hierarchyDraft).flat(),
                      ])
                      const unassigned = projectOrgs.filter((o) => !assignedIds.has(coerceId(o.id)))
                      if (unassigned.length === 0) return null
                      return (
                        <div className="mt-2">
                          <p className="mb-1.5 text-xs text-muted-foreground">Not mapped to a coordinator</p>
                          <div className="space-y-1.5">
                            {unassigned.map((org) => (
                              <div
                                key={org.id}
                                className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 hover:bg-muted/30 transition-colors"
                                onClick={() => router.push(`/organizations/${org.id}`)}
                              >
                                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="flex-1 text-sm">{org.name}</span>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {(organizationRoleDraft[coerceId(org.id)] || "implementing_partner").replace(/_/g, " ")}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  /* No overrides — show flat list with global parent info */
                  <div className="space-y-1.5">
                    {projectOrgs.map((org) => (
                      <div
                        key={org.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors"
                        onClick={() => router.push(`/organizations/${org.id}`)}
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm">{org.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {(organizationRoleDraft[coerceId(org.id)] || "implementing_partner").replace(/_/g, " ")}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Edit hierarchy (collapsible) ── */}
            <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left text-sm font-medium hover:bg-muted/30 transition-colors">
                    Edit reporting hierarchy
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 rounded-lg border border-border p-4 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Set project-specific coordinator → sub-grantee relationships. These override the global parent-child links for this project only.
                    </p>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                      <Select value={newHierarchyCoordinatorId} onValueChange={setNewHierarchyCoordinatorId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose coordinator to add" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCoordinatorIds.length === 0 ? (
                            <SelectItem value="none" disabled>No additional coordinators</SelectItem>
                          ) : (
                            availableCoordinatorIds.map((orgId) => (
                              <SelectItem key={`hierarchy-add-${orgId}`} value={orgId}>
                                {projectOrganizationOptions.find((o) => o.id === orgId)?.name || `Org ${orgId}`}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" onClick={handleAddHierarchyCoordinator}
                        disabled={!newHierarchyCoordinatorId || availableCoordinatorIds.length === 0}>
                        Add
                      </Button>
                      <Button type="button" onClick={handleSaveHierarchyOverrides} disabled={isHierarchySaving}>
                        {isHierarchySaving ? "Saving…" : "Save"}
                      </Button>
                    </div>

                    {hierarchyCoordinatorIds.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hierarchy overrides configured.</p>
                    ) : (
                      <div className="space-y-3">
                        {hierarchyCoordinatorIds.map((coordinatorId) => {
                          const coordName = projectOrganizationOptions.find((o) => o.id === coordinatorId)?.name || `Org ${coordinatorId}`
                          const childOptions = projectOrganizationOptions.filter((o) => o.id !== coordinatorId)
                          return (
                            <div key={`hierarchy-row-${coordinatorId}`} className="rounded-lg border border-border p-4">
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium">{coordName}</p>
                                  <p className="text-xs text-muted-foreground">Coordinator</p>
                                </div>
                                <Button type="button" variant="ghost" size="sm"
                                  onClick={() => removeHierarchyCoordinator(coordinatorId)}>
                                  Remove
                                </Button>
                              </div>
                              <OrganizationMultiSelect
                                organizations={childOptions}
                                selectedIds={hierarchyDraft[coordinatorId] || []}
                                onChange={(value) => updateHierarchyChildren(coordinatorId, value)}
                                placeholder="Select sub-partners"
                                showSelectAll={false}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>

            {/* ── Organizations table ── */}
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Organization</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Role</th>
                    <th className="px-4 py-3 hidden md:table-cell">Contact</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projectOrgs.map((org) => {
                    const role = organizationRoleDraft[coerceId(org.id)] || "implementing_partner"
                    return (
                      <tr key={org.id}
                        className="hover:bg-muted/20 cursor-pointer transition-colors"
                        onClick={() => router.push(`/organizations/${org.id}`)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <span className="font-medium">{org.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <Badge variant="outline" className="text-xs capitalize">
                            {role.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                          {org.contactEmail || "—"}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                            onClick={() => router.push(`/organizations/${org.id}`)}>
                            View
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

          </div>
        </TabsContent>

        <TabsContent value="setup" className="mt-6 space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Project Hierarchy</CardTitle>
                <CardDescription className="mt-1">
                  Organization tree for this project, derived from the global hierarchy.
                  {(project?.project_hierarchy_links || []).filter(l => l.is_active).length === 0 &&
                    " No project-specific overrides set — showing global structure."}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setActiveTab("organizations")}
              >
                Edit Hierarchy
              </Button>
            </CardHeader>
            <CardContent>
              {projectOrgs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No organizations assigned to this project yet.
                </div>
              ) : (() => {
                // Use project-specific hierarchy links if they exist, else fall back to global org.parentId
                const activeLinks = (project?.project_hierarchy_links || []).filter((l) => l.is_active)
                const projectOrgIdSet = new Set(projectOrgs.map((o) => String(o.id)))

                // Build children map: parentId → child org objects
                type OrgNode = { id: string; name: string }
                const childrenByParent = new Map<string, OrgNode[]>()

                if (activeLinks.length > 0) {
                  // Project-specific links
                  activeLinks.forEach((link) => {
                    const pid = String(link.parent_organization)
                    const cid = String(link.child_organization)
                    if (!projectOrgIdSet.has(pid) && !projectOrgIdSet.has(cid)) return
                    const childName = String(link.child_organization_name ||
                      projectOrgs.find((o) => String(o.id) === cid)?.name || `Org ${cid}`)
                    const existing = childrenByParent.get(pid) || []
                    existing.push({ id: cid, name: childName })
                    childrenByParent.set(pid, existing)
                  })
                } else {
                  // Global org.parentId scoped to project members
                  projectOrgs.forEach((org) => {
                    const parentId = String(org.parentId || "")
                    if (!parentId || !projectOrgIdSet.has(parentId)) return
                    const existing = childrenByParent.get(parentId) || []
                    existing.push({ id: String(org.id), name: String(org.name || org.id) })
                    childrenByParent.set(parentId, existing)
                  })
                }

                // Sort children alphabetically
                childrenByParent.forEach((children) => children.sort((a, b) => a.name.localeCompare(b.name)))

                // IDs that appear as a child somewhere
                const childIdSet = new Set<string>()
                childrenByParent.forEach((children) => children.forEach((c) => childIdSet.add(c.id)))

                // Root nodes = in project, not a child of anyone else in project
                const rootNodes = projectOrgs
                  .filter((o) => !childIdSet.has(String(o.id)))
                  .map((o) => ({ id: String(o.id), name: String(o.name || o.id) }))
                  .sort((a, b) => a.name.localeCompare(b.name))

                const roleLabel = (id: string) => {
                  const role = organizationRoleDraft[id]
                  return projectRoleOptions.find((r) => r.value === role)?.label || role || "—"
                }

                const renderNode = (node: OrgNode, level = 0): React.ReactNode => {
                  const children = childrenByParent.get(node.id) || []
                  const isRoot = level === 0
                  return (
                    <Collapsible key={`hier-${node.id}-${level}`} defaultOpen>
                      <div
                        className={`rounded-lg border p-3 ${isRoot ? "border-primary/30 bg-primary/5" : "border-border"}`}
                        style={{ marginLeft: level * 24 }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${isRoot ? "bg-primary/10" : "bg-secondary"}`}>
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium break-words">{node.name}</p>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <Badge variant="secondary" className="text-xs">{roleLabel(node.id)}</Badge>
                                <span>Level {level + 1}</span>
                                {children.length > 0 && <><span>·</span><span>{children.length} direct child{children.length === 1 ? "" : "ren"}</span></>}
                              </div>
                            </div>
                          </div>
                          {children.length > 0 && (
                            <CollapsibleTrigger asChild>
                              <button type="button" className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground hover:text-foreground">
                                Hierarchy <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </CollapsibleTrigger>
                          )}
                        </div>
                      </div>
                      {children.length > 0 && (
                        <CollapsibleContent>
                          <div className="mt-1.5 space-y-1.5">
                            {children.map((child) => renderNode(child, level + 1))}
                          </div>
                        </CollapsibleContent>
                      )}
                    </Collapsible>
                  )
                }

                return (
                  <div className="space-y-1.5">
                    {rootNodes.map((node) => renderNode(node))}
                  </div>
                )
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization Roles</CardTitle>
              <CardDescription>
                Roles are project-scoped and can differ from one project to another.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {projectOrganizationOptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Add organizations to this project first.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {projectOrganizationOptions.map((organization) => (
                    <div key={`org-role-${organization.id}`} className="rounded-lg border border-border p-3">
                      <p className="mb-2 text-sm font-medium">{organization.name}</p>
                      <Select
                        value={organizationRoleDraft[organization.id] || "implementing_partner"}
                        onValueChange={(value) =>
                          setOrganizationRoleDraft((current) => ({
                            ...current,
                            [organization.id]: value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {projectRoleOptions.map((roleOption) => (
                            <SelectItem key={`role-${organization.id}-${roleOption.value}`} value={roleOption.value}>
                              {roleOption.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button type="button" onClick={handleSaveOrganizationRoles} disabled={isRoleSaving}>
                  {isRoleSaving ? "Saving..." : "Save Roles"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Indicator Assignment</CardTitle>
              <CardDescription>
                Assign indicators to organizations and define project-specific disaggregation keys.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {projectIndicators.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No indicators are linked to this project yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {projectIndicators.map((indicatorRow) => {
                    const indicatorId = coerceId(indicatorRow.indicator)
                    const fallbackName = String(indicatorRow.indicator_name || `Indicator ${indicatorId}`)
                    const indicatorName = indicatorLookup.get(indicatorId)?.name || fallbackName
                    const indicatorCode =
                      indicatorLookup.get(indicatorId)?.code || String(indicatorRow.indicator_code || "—")
                    return (
                      <div key={`project-indicator-setup-${indicatorRow.id}`} className="rounded-lg border border-border p-4">
                        <div className="mb-3">
                          <p className="text-sm font-medium">{indicatorName}</p>
                          <p className="text-xs text-muted-foreground">{indicatorCode}</p>
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label>Assigned Organizations</Label>
                            <OrganizationMultiSelect
                              organizations={projectOrganizationOptions}
                              selectedIds={indicatorAssignmentDraft[indicatorId] || []}
                              onChange={(value) => updateIndicatorAssignmentOrganizations(indicatorId, value)}
                              placeholder="Select organizations for this indicator"
                              showSelectAll={false}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Disaggregation Keys (comma-separated)</Label>
                            <Input
                              value={indicatorDisaggregationDraft[indicatorId] || ""}
                              onChange={(event) =>
                                updateIndicatorDisaggregationValue(indicatorId, event.target.value)
                              }
                              placeholder="age_band, sex, target_group, key_population, district"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex justify-end">
                <Button type="button" onClick={handleSaveIndicatorSetup} disabled={isIndicatorSetupSaving}>
                  {isIndicatorSetupSaving ? "Saving..." : "Save Indicator Setup"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deadlines" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setIsDeadlineOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Deadline
            </Button>
          </div>
          <div className="space-y-3">
            {projectDeadlines.map((deadline: ProjectDeadline) => {
              const dueDate = new Date(deadline.due_date)
              const dueTime = dueDate.getTime()
              const hasDate = Number.isFinite(dueTime)
              const isCompleted = deadline.status === "submitted" || deadline.status === "approved"
              const isPast = hasDate ? dueDate < new Date() && !isCompleted : false
              const daysUntil = hasDate
                ? Math.ceil((dueTime - new Date().getTime()) / (1000 * 60 * 60 * 24))
                : null

              return (
                <div
                  key={deadline.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className={`rounded-full p-2 ${
                      isCompleted ? 'bg-chart-2/10 text-chart-2' :
                      isPast ? 'bg-destructive/10 text-destructive' :
                      'bg-primary/10 text-primary'
                    }`}>
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Clock className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{deadline.name}</p>
                      {deadline.description && (
                        <p className="text-sm text-muted-foreground">{deadline.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {dueDate.toLocaleDateString()}
                    </p>
                    {!isCompleted && (
                      <Badge variant="secondary" className={
                        isPast ? 'bg-destructive/10 text-destructive' :
                        (daysUntil !== null && daysUntil <= 7) ? 'bg-chart-3/10 text-chart-3' :
                        'bg-muted text-muted-foreground'
                      }>
                        {isPast ? 'Overdue' : daysUntil === null ? 'No date' : `${daysUntil} days left`}
                      </Badge>
                    )}
                    {isCompleted && (
                      <Badge variant="secondary" className="bg-chart-2/10 text-chart-2">
                        Completed
                      </Badge>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="activities" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => {
              setEditingActivity(null)
              setActivityForm({ title: "", description: "", status: "planned", start_date: "", end_date: "", visible_to_all: true })
              setIsActivityOpen(true)
            }}>
              <Plus className="mr-2 h-4 w-4" />
              Add Activity
            </Button>
          </div>
          {projectActivities.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activities defined for this project.</p>
          ) : (
            <div className="space-y-3">
              {projectActivities.map((act) => (
                <div key={act.id} className="flex items-start justify-between rounded-lg border border-border bg-card p-4">
                  <div className="space-y-1">
                    <p className="font-medium">{act.title}</p>
                    {act.description && <p className="text-sm text-muted-foreground">{act.description}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs capitalize">{act.status}</Badge>
                      {act.start_date && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(act.start_date).toLocaleDateString()}
                          {act.end_date ? ` – ${new Date(act.end_date).toLocaleDateString()}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      setEditingActivity(act)
                      setActivityForm({
                        title: act.title, description: act.description || "",
                        status: act.status, start_date: act.start_date || "",
                        end_date: act.end_date || "", visible_to_all: act.visible_to_all,
                      })
                      setIsActivityOpen(true)
                    }}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteActivity(act)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reports" className="mt-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">Narrative Reports</h3>
            <Button size="sm" onClick={() => { setEditingReport(null); setReportForm({ title: "", description: "", organization: "", file: null }); setIsReportOpen(true) }}>
              <Upload className="mr-2 h-4 w-4" /> Upload Report
            </Button>
          </div>
          {narrativeReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No narrative reports uploaded yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {narrativeReports.map((report) => (
                <div key={report.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{report.title}</p>
                      {report.organization_name && <p className="text-xs text-muted-foreground">{report.organization_name}</p>}
                      {report.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{report.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{new Date(report.created_at).toLocaleDateString()}{report.uploaded_by_name ? ` · ${report.uploaded_by_name}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {report.file_url && (
                      <a href={report.file_url} target="_blank" rel="noopener noreferrer">
                        <Button size="icon" variant="ghost" className="h-7 w-7"><Download className="h-3.5 w-3.5" /></Button>
                      </a>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingReport(report); setReportForm({ title: report.title, description: report.description || "", organization: report.organization || "", file: null }); setIsReportOpen(true) }}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteReport(report)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingReport ? "Edit Report" : "Upload Narrative Report"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={reportForm.title} onChange={(e) => setReportForm((f) => ({ ...f, title: e.target.value }))} placeholder="Report title" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={reportForm.description} onChange={(e) => setReportForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Organization</Label>
              <Select value={reportForm.organization || "none"} onValueChange={(v) => setReportForm((f) => ({ ...f, organization: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {projectOrgs.map((org) => (
                    <SelectItem key={org.id} value={String(org.id)}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{editingReport ? "Replace File (optional)" : "File *"}</Label>
              <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(e) => setReportForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReportOpen(false)} disabled={isSavingReport}>Cancel</Button>
            <Button onClick={handleSaveReport} disabled={isSavingReport}>
              {isSavingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingReport ? "Save" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isActivityOpen} onOpenChange={setIsActivityOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingActivity ? "Edit Activity" : "Add Activity"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={activityForm.title} onChange={(e) => setActivityForm((f) => ({ ...f, title: e.target.value }))} placeholder="Activity title" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={activityForm.description} onChange={(e) => setActivityForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={activityForm.status} onValueChange={(v) => setActivityForm((f) => ({ ...f, status: v as typeof f.status }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={activityForm.start_date} onChange={(e) => setActivityForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={activityForm.end_date} onChange={(e) => setActivityForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsActivityOpen(false)} disabled={isSavingActivity}>Cancel</Button>
            <Button onClick={handleSaveActivity} disabled={isSavingActivity}>
              {isSavingActivity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Update project details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Code *</Label>
              <Input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditForm({ ...editForm, status: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date *</Label>
              <Input
                type="date"
                value={editForm.start_date}
                onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date *</Label>
              <Input
                type="date"
                value={editForm.end_date}
                onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateProject} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTaskOpen} onOpenChange={setIsTaskOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
            <DialogDescription>Create a task for this project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Task Name *</Label>
              <Input value={taskForm.name} onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={taskForm.due_date}
                  onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={taskForm.priority}
                  onValueChange={(value) => setTaskForm({ ...taskForm, priority: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTaskOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateTask} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeadlineOpen} onOpenChange={setIsDeadlineOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Deadline</DialogTitle>
            <DialogDescription>Create a deadline for this project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Deadline Name *</Label>
              <Input value={deadlineForm.name} onChange={(e) => setDeadlineForm({ ...deadlineForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={deadlineForm.description}
                onChange={(e) => setDeadlineForm({ ...deadlineForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Due Date *</Label>
              <Input
                type="date"
                value={deadlineForm.due_date}
                onChange={(e) => setDeadlineForm({ ...deadlineForm, due_date: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeadlineOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateDeadline} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Create Deadline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Organizations dialog */}
      <Dialog open={isManageOrgsOpen} onOpenChange={setIsManageOrgsOpen}>
        <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Organizations</DialogTitle>
            <DialogDescription>
              Add or remove organizations participating in this project.
              Roles can be adjusted in the Project Setup tab.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={manageOrgSearch}
              onChange={(e) => setManageOrgSearch(e.target.value)}
              placeholder="Search organizations..."
            />
            {(() => {
              const filteredOrgs = (organizationsData?.results || [])
                .filter((org) => org.type !== "funder")
                .filter((org) =>
                  !manageOrgSearch.trim() ||
                  org.name.toLowerCase().includes(manageOrgSearch.trim().toLowerCase())
                )
              const filteredIds = filteredOrgs.map((org) => coerceId(org.id))
              const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => managedOrgIds.includes(id))
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {filteredOrgs.length} organization{filteredOrgs.length !== 1 ? "s" : ""} shown
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-primary underline-offset-2 hover:underline"
                        onClick={() =>
                          setManagedOrgIds((prev) => Array.from(new Set([...prev, ...filteredIds])))
                        }
                        disabled={allFilteredSelected}
                      >
                        Select all
                      </button>
                      <span className="text-xs text-muted-foreground">·</span>
                      <button
                        type="button"
                        className="text-xs text-primary underline-offset-2 hover:underline"
                        onClick={() =>
                          setManagedOrgIds((prev) => prev.filter((id) => !filteredIds.includes(id)))
                        }
                        disabled={filteredIds.every((id) => !managedOrgIds.includes(id))}
                      >
                        Deselect all
                      </button>
                    </div>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-auto rounded-lg border border-border p-3">
                    {filteredOrgs.map((org) => {
                      const id = coerceId(org.id)
                      const checked = managedOrgIds.includes(id)
                      return (
                        <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border accent-primary"
                            checked={checked}
                            onChange={(e) => {
                              setManagedOrgIds((prev) =>
                                e.target.checked
                                  ? prev.includes(id) ? prev : [...prev, id]
                                  : prev.filter((item) => item !== id)
                              )
                            }}
                          />
                          <span>{org.name}</span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {managedOrgIds.length} organization{managedOrgIds.length !== 1 ? "s" : ""} selected.
                  </p>
                </>
              )
            })()}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsManageOrgsOpen(false)
                setManageOrgSearch("")
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveOrganizations} disabled={isManageOrgsSaving}>
              {isManageOrgsSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Organizations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
