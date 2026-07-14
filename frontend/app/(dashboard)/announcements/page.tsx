"use client"

import { useEffect, useState, useMemo } from "react"
import { Megaphone, Plus, Search, Loader2, Edit, Trash2, Globe, Building2, FolderKanban, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { OrganizationSelect } from "@/components/shared/organization-select"

import { useAnnouncements, useAllOrganizations, useProjects } from "@/lib/hooks/use-api"
import { announcementsService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import type { Announcement } from "@/lib/types"

const SCOPE_ICONS = {
  global: <Globe className="h-3.5 w-3.5" />,
  organization: <Building2 className="h-3.5 w-3.5" />,
  project: <FolderKanban className="h-3.5 w-3.5" />,
}

const SCOPE_LABELS = {
  global: "All Users",
  organization: "Organization",
  project: "Project",
}

const initialForm = {
  title: "",
  content: "",
  scope: "global" as Announcement["scope"],
  organizationId: "none",
  projectId: "none",
}

function formatDate(v: string) {
  return new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export default function AnnouncementsPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const canManage = user?.role === "admin" || user?.role === "manager" || user?.role === "officer"

  const [search, setSearch] = useState("")
  const [scopeFilter, setScopeFilter] = useState("all")
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(initialForm)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)

  // Filter server-side so search/scope apply across ALL announcements, not just
  // the first loaded page (the list is paginated).
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])
  const announcementFilters = useMemo(() => {
    const f: Record<string, string> = { page_size: "500" }
    if (debouncedSearch) f.search = debouncedSearch
    if (scopeFilter !== "all") f.scope = scopeFilter
    return f
  }, [debouncedSearch, scopeFilter])
  const { data: announcementsData, isLoading, mutate } = useAnnouncements(announcementFilters)
  const { data: orgsData } = useAllOrganizations()
  const { data: projectsData } = useProjects()

  const announcements = announcementsData?.results || []
  const organizations = orgsData?.results || []
  const projects = projectsData?.results || []

  // Scope + search applied server-side (see announcementFilters); render as-is.
  const filtered = announcements

  const openCreate = () => {
    setEditingId(null)
    setForm(initialForm)
    setIsFormOpen(true)
  }

  const openEdit = (a: Announcement) => {
    setEditingId(a.id)
    setForm({
      title: a.title,
      content: a.content,
      scope: a.scope,
      organizationId: a.organization ? String(a.organization) : "none",
      projectId: a.project ? String(a.project) : "none",
    })
    setIsFormOpen(true)
  }

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" })
      return
    }
    if (!form.content.trim()) {
      toast({ title: "Content is required", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        scope: form.scope,
        organization:
          form.scope === "organization" && form.organizationId !== "none"
            ? Number(form.organizationId)
            : undefined,
        project:
          form.scope === "project" && form.projectId !== "none"
            ? Number(form.projectId)
            : undefined,
      }
      if (editingId) {
        await announcementsService.update(Number(editingId), payload)
      } else {
        await announcementsService.create(payload)
      }
      await mutate()
      setIsFormOpen(false)
      toast({ title: editingId ? "Announcement updated" : "Announcement posted" })
    } catch {
      toast({ title: "Error", description: "Could not save announcement.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await announcementsService.delete(Number(deleteTarget.id))
      await mutate()
      setDeleteTarget(null)
      toast({ title: "Announcement deleted" })
    } catch {
      toast({ title: "Error", description: "Could not delete.", variant: "destructive" })
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title="Announcements"
        description="System-wide and scoped announcements for portal users"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Announcements" },
        ]}
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Post Announcement
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search announcements…"
            className="pl-9"
          />
        </div>
        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All scopes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scopes</SelectItem>
            <SelectItem value="global">All Users</SelectItem>
            <SelectItem value="organization">Organization</SelectItem>
            <SelectItem value="project">Project</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16">
          <Megaphone className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No announcements found.</p>
          {canManage && (
            <Button variant="outline" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Post First Announcement
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((a) => (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{a.title}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="flex items-center gap-1 text-xs">
                        {SCOPE_ICONS[a.scope]}
                        {SCOPE_LABELS[a.scope]}
                        {a.organization_name ? `: ${a.organization_name}` : ""}
                        {a.project_name ? `: ${a.project_name}` : ""}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {a.created_by_name && `By ${a.created_by_name} · `}
                        {formatDate(a.created_at)}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Announcement" : "Post Announcement"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update the announcement details." : "Post a new announcement to portal users."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Announcement title"
              />
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Write your announcement…"
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>Audience</Label>
              <Select
                value={form.scope}
                onValueChange={(v) => setForm((f) => ({ ...f, scope: v as Announcement["scope"] }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">All Users</SelectItem>
                  <SelectItem value="organization">Specific Organization</SelectItem>
                  <SelectItem value="project">Specific Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.scope === "organization" && (
              <div className="space-y-2">
                <Label>Organization</Label>
                <OrganizationSelect
                  organizations={organizations}
                  value={form.organizationId}
                  onChange={(v) => setForm((f) => ({ ...f, organizationId: v }))}
                  placeholder="Select organization"
                />
              </div>
            )}
            {form.scope === "project" && (
              <div className="space-y-2">
                <Label>Project</Label>
                <Select
                  value={form.projectId}
                  onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editingId ? "Save" : "Post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.title}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
