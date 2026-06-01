"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Calendar, Users, FolderKanban, ArrowRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { PageHeader } from "@/components/shared/page-header"
import { useProjects, useAllOrganizations, useAllIndicators } from "@/lib/hooks/use-api"
import { projectsService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useSessionMode } from "@/lib/contexts/session-mode-context"
import type { Project } from "@/lib/types"
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
import { Checkbox } from "@/components/ui/checkbox"
import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"

const statusColors: Record<string, string> = {
  active: "bg-primary/10 text-primary",
  completed: "bg-chart-2/10 text-chart-2",
  draft: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
}

function coerceId(value: unknown): string {
  return String(value ?? "").trim()
}

interface ProjectCardProps {
  project: Project
}

function ProjectCard({ project }: ProjectCardProps) {
  const router = useRouter()
  const progress = project.progress_percentage ?? 0
  const startDate = new Date(project.start_date)
  const endDate = new Date(project.end_date)
  const now = new Date()
  const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  const daysPassed = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  const timeProgress =
    Number.isFinite(totalDays) && totalDays > 0
      ? Math.min(100, Math.max(0, Math.round((daysPassed / totalDays) * 100)))
      : 0

  return (
    <div
      className="group cursor-pointer rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
      onClick={() => router.push(`/projects/${project.id}`)}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className={statusColors[project.status] || ""}>
              {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
            </Badge>
            {project.is_training && (
              <Badge className="border border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                TRAINING
              </Badge>
            )}
          </div>
          <h3 className="mt-2 text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          {project.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {project.description}
            </p>
          )}
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* Project details */}
      <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span>{startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <Users className="h-4 w-4" />
          <span>{project.organizations?.length || 0} organizations</span>
        </div>
        {project.funder && (
          <div className="flex items-center gap-1">
            <FolderKanban className="h-4 w-4" />
            <span>{project.funder}</span>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Project Progress</span>
            <span className="font-medium text-foreground">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Time Elapsed</span>
            <span className="font-medium text-foreground">{timeProgress}%</span>
          </div>
          <Progress value={timeProgress} className="h-2 [&>div]:bg-chart-3" />
        </div>
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { isTrainingMode } = useSessionMode()
  const isAdmin = user?.role === "admin"
  const { data: projectsData, isLoading, error, mutate } = useProjects()
  const { data: orgsData } = useAllOrganizations()
  const { data: indicatorsData } = useAllIndicators({ is_active: "true" })
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState("all")
  const [orgSearch, setOrgSearch] = useState("")
  const [indicatorSearch, setIndicatorSearch] = useState("")
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>([])
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>([])
  const [newHierarchyCoordinatorId, setNewHierarchyCoordinatorId] = useState("")
  const [hierarchyDraft, setHierarchyDraft] = useState<Record<string, string[]>>({})
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    description: "",
    start_date: "",
    end_date: "",
    funderId: "",
    is_training: false,
  })

  const allProjects = projectsData?.results || []
  const projects = isTrainingMode
    ? allProjects.filter((p) => p.is_training)
    : allProjects.filter((p) => !p.is_training)
  const organizations = orgsData?.results || []
  const funders = organizations.filter(o => o.type === 'funder')
  const partnerOrganizations = organizations.filter(o => o.type !== 'funder')
  const filteredPartnerOrganizations = partnerOrganizations.filter((org) =>
    org.name.toLowerCase().includes(orgSearch.toLowerCase())
  )
  const indicators = indicatorsData || []
  const filteredIndicators = indicators.filter((indicator) => {
    const searchText = indicatorSearch.trim().toLowerCase()
    if (!searchText) return true
    return (
      String(indicator.name || "").toLowerCase().includes(searchText) ||
      String(indicator.code || "").toLowerCase().includes(searchText)
    )
  })
  const projectOrganizationOptions = useMemo(
    () =>
      partnerOrganizations
        .filter((organization) => selectedOrganizations.includes(coerceId(organization.id)))
        .map((organization) => ({
          id: coerceId(organization.id),
          name: String(organization.name || `Organization ${organization.id}`),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [partnerOrganizations, selectedOrganizations],
  )
  const hierarchyCoordinatorIds = useMemo(
    () =>
      Object.keys(hierarchyDraft).sort((left, right) => {
        const leftName = projectOrganizationOptions.find((entry) => entry.id === left)?.name || left
        const rightName = projectOrganizationOptions.find((entry) => entry.id === right)?.name || right
        return leftName.localeCompare(rightName)
      }),
    [hierarchyDraft, projectOrganizationOptions],
  )
  const availableCoordinatorIds = useMemo(
    () =>
      projectOrganizationOptions
        .filter((option) => !hierarchyCoordinatorIds.includes(option.id))
        .map((option) => option.id),
    [hierarchyCoordinatorIds, projectOrganizationOptions],
  )

  const filteredProjects = activeTab === "all"
    ? projects
    : projects.filter(p => p.status === activeTab)

  useEffect(() => {
    const allowedOrganizationIds = new Set(selectedOrganizations)
    setHierarchyDraft((current) => {
      const filtered: Record<string, string[]> = {}
      Object.entries(current).forEach(([coordinatorId, childIds]) => {
        if (!allowedOrganizationIds.has(coordinatorId)) return
        filtered[coordinatorId] = childIds.filter(
          (childId) => childId !== coordinatorId && allowedOrganizationIds.has(childId),
        )
      })
      return filtered
    })
    setNewHierarchyCoordinatorId((current) =>
      current && allowedOrganizationIds.has(current) ? current : "",
    )
  }, [selectedOrganizations])

  const addHierarchyCoordinator = (coordinatorId: string) => {
    if (!coordinatorId) return
    setHierarchyDraft((current) => {
      if (current[coordinatorId]) return current
      return { ...current, [coordinatorId]: [] }
    })
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

  const resetCreateForm = () => {
    setFormData({ name: "", code: "", description: "", start_date: "", end_date: "", funderId: "", is_training: false })
    setOrgSearch("")
    setIndicatorSearch("")
    setSelectedOrganizations([])
    setSelectedIndicators([])
    setHierarchyDraft({})
    setNewHierarchyCoordinatorId("")
  }

  const handleCreate = async () => {
    if (!formData.name || !formData.code || !formData.start_date || !formData.end_date) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      })
      return
    }
    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      toast({
        title: "Validation Error",
        description: "End date must be on or after the start date.",
        variant: "destructive",
      })
      return
    }
    const codeExists = projects.some(
      (project) => project.code?.toLowerCase() === formData.code.trim().toLowerCase()
    )
    if (codeExists) {
      toast({
        title: "Project code already exists",
        description: "Choose a unique project code.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const allowedOrganizationIds = new Set(selectedOrganizations)
      const hierarchyPayload = Object.fromEntries(
        Object.entries(hierarchyDraft)
          .map(([coordinatorId, childIds]) => [
            coordinatorId,
            childIds.filter(
              (childId) => childId !== coordinatorId && allowedOrganizationIds.has(childId),
            ),
          ])
          .filter(
            ([coordinatorId, childIds]) =>
              allowedOrganizationIds.has(coordinatorId) && childIds.length > 0,
          ),
      )
      const funderOrg = organizations.find((org) => org.id === formData.funderId)
      const createdProject = await projectsService.create({
        name: formData.name,
        code: formData.code,
        description: formData.description || undefined,
        start_date: formData.start_date,
        end_date: formData.end_date,
        funder: funderOrg?.name,
        is_training: formData.is_training,
        organizations: selectedOrganizations.length
          ? selectedOrganizations.map((id) => Number(id))
          : undefined,
        hierarchy_overrides: Object.keys(hierarchyPayload).length
          ? hierarchyPayload
          : undefined,
      })
      if (selectedIndicators.length > 0) {
        await projectsService.assignIndicators(
          Number(createdProject.id),
          selectedIndicators.map((indicatorId) => Number(indicatorId)),
        )
      }
      toast({
        title: "Success",
        description: selectedIndicators.length > 0
          ? "Project created with organizations, hierarchy mapping, and indicators."
          : "Project created with organizations and hierarchy mapping.",
      })
      setIsCreateOpen(false)
      resetCreateForm()
      mutate()
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Failed to create project"
      const errors =
        err && typeof err === "object" && "errors" in err
          ? (err as { errors: Record<string, string[]> }).errors
          : null
      const details = errors
        ? Object.entries(errors)
            .map(([field, issues]) => `${field}: ${issues.join(", ")}`)
            .join(" | ")
        : ""
      toast({
        title: "Error",
        description: details ? `${message}. ${details}` : message,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Failed to load projects</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Manage projects, tasks, timelines, and organization scope"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Projects" },
        ]}
        actions={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        }
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-secondary">
          <TabsTrigger value="all">
            All ({projects.length})
          </TabsTrigger>
          <TabsTrigger value="active">
            Active ({projects.filter(p => p.status === 'active').length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({projects.filter(p => p.status === 'completed').length})
          </TabsTrigger>
          <TabsTrigger value="draft">
            Draft ({projects.filter(p => p.status === 'draft').length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
              />
            ))}
          </div>
          {filteredProjects.length === 0 && (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border">
              <p className="text-muted-foreground">No projects found</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>
              Create a new project to track indicators, timelines, and organizations
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              handleCreate()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Project Name *</Label>
                <Input
                  id="name"
                  placeholder="Enter project name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Project Code *</Label>
                <Input
                  id="code"
                  placeholder="e.g., HPP2025"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of the project"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date *</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="funder">Funder</Label>
              <Select
                value={formData.funderId}
                onValueChange={(value) => setFormData({ ...formData, funderId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select funder" />
                </SelectTrigger>
                <SelectContent>
                  {funders.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Participating Organizations</Label>
              <Input
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
                placeholder="Search organizations..."
              />
              <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-border p-3">
                {filteredPartnerOrganizations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No organizations available.
                  </p>
                ) : (
                  filteredPartnerOrganizations.map((org) => {
                    const id = String(org.id)
                    const checked = selectedOrganizations.includes(id)
                    return (
                      <label key={id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            setSelectedOrganizations((prev) => {
                              if (value === true) return prev.includes(id) ? prev : [...prev, id]
                              return prev.filter((item) => item !== id)
                            })
                          }}
                        />
                        <span>{org.name}</span>
                      </label>
                    )
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave empty to make the project visible only to admins.
              </p>
            </div>
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <Label>Project Hierarchy Overrides</Label>
                <p className="text-xs text-muted-foreground">
                  Set coordinator to sub-partner mappings for this project only.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select
                  value={newHierarchyCoordinatorId}
                  onValueChange={setNewHierarchyCoordinatorId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose coordinator to add" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCoordinatorIds.length === 0 ? (
                      <SelectItem value="none" disabled>
                        Select project organizations first
                      </SelectItem>
                    ) : (
                      availableCoordinatorIds.map((organizationId) => {
                        const organizationName =
                          projectOrganizationOptions.find((option) => option.id === organizationId)?.name ||
                          `Organization ${organizationId}`
                        return (
                          <SelectItem key={`create-hierarchy-${organizationId}`} value={organizationId}>
                            {organizationName}
                          </SelectItem>
                        )
                      })
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    addHierarchyCoordinator(newHierarchyCoordinatorId)
                    setNewHierarchyCoordinatorId("")
                  }}
                  disabled={!newHierarchyCoordinatorId || availableCoordinatorIds.length === 0}
                >
                  Add Mapping
                </Button>
              </div>
              {hierarchyCoordinatorIds.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  No overrides yet. The default organization hierarchy will be used.
                </div>
              ) : (
                <div className="space-y-3">
                  {hierarchyCoordinatorIds.map((coordinatorId) => {
                    const coordinatorName =
                      projectOrganizationOptions.find((option) => option.id === coordinatorId)?.name ||
                      `Organization ${coordinatorId}`
                    const childOptions = projectOrganizationOptions.filter(
                      (option) => option.id !== coordinatorId,
                    )
                    return (
                      <div key={`create-row-${coordinatorId}`} className="space-y-2 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{coordinatorName}</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeHierarchyCoordinator(coordinatorId)}
                          >
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
            <div className="space-y-2">
              <Label>Indicators for this Project</Label>
              <Input
                value={indicatorSearch}
                onChange={(e) => setIndicatorSearch(e.target.value)}
                placeholder="Search indicators by name or code..."
              />
              <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-border p-3">
                {filteredIndicators.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No indicators available.
                  </p>
                ) : (
                  filteredIndicators.map((indicator) => {
                    const id = coerceId(indicator.id)
                    const checked = selectedIndicators.includes(id)
                    return (
                      <label key={id} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            setSelectedIndicators((prev) => {
                              if (value === true) return prev.includes(id) ? prev : [...prev, id]
                              return prev.filter((item) => item !== id)
                            })
                          }}
                        />
                        <span className="leading-5">
                          {indicator.name}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Selected indicators will be linked immediately after project creation.
              </p>
            </div>
            {isAdmin && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:bg-amber-950/20">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={formData.is_training}
                    onCheckedChange={(value) =>
                      setFormData({ ...formData, is_training: value === true })
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Mark as Sesigo Training Project
                    </span>
                    <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                      Training projects are excluded from official dashboards and reports.
                      Data is automatically cleared after 7 days.
                    </p>
                  </div>
                </label>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateOpen(false)
                  resetCreateForm()
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

