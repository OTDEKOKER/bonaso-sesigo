"use client"

import { useState, useMemo } from "react"
import {
  Building, Plus, Search, Edit, Trash2, Loader2, Save, Globe, Mail, Phone,
  FolderKanban, CheckCircle2, XCircle,
} from "lucide-react"

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

import { useClientOrganizations, useProjects } from "@/lib/hooks/use-api"
import { clientOrganizationsService } from "@/lib/api"
import type { ClientOrganization } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"

const initialForm = {
  name: "", description: "", contact_name: "", contact_email: "",
  contact_phone: "", website: "", is_active: true, projectIds: [] as string[],
}

export default function ClientsPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const canManage = user?.role === "admin"

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(initialForm)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ClientOrganization | null>(null)

  const { data: clientsData, isLoading, mutate } = useClientOrganizations()
  const { data: projectsData } = useProjects()

  const clients = clientsData?.results || []
  const projects = projectsData?.results || []

  const filtered = useMemo(() => {
    let list = clients
    if (statusFilter === "active") list = list.filter((c) => c.is_active)
    if (statusFilter === "inactive") list = list.filter((c) => !c.is_active)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.contact_name || "").toLowerCase().includes(q) ||
          (c.contact_email || "").toLowerCase().includes(q),
      )
    }
    return list
  }, [clients, statusFilter, search])

  const openCreate = () => {
    setEditingId(null)
    setForm(initialForm)
    setIsFormOpen(true)
  }

  const openEdit = (c: ClientOrganization) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      description: c.description || "",
      contact_name: c.contact_name || "",
      contact_email: c.contact_email || "",
      contact_phone: c.contact_phone || "",
      website: c.website || "",
      is_active: c.is_active,
      projectIds: (c.projects || []).map(String),
    })
    setIsFormOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || undefined,
        contact_name: form.contact_name || undefined,
        contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined,
        website: form.website || undefined,
        is_active: form.is_active,
        projects: form.projectIds.map(Number),
      }
      if (editingId) {
        await clientOrganizationsService.update(Number(editingId), payload)
      } else {
        await clientOrganizationsService.create(payload)
      }
      await mutate()
      setIsFormOpen(false)
      toast({ title: editingId ? "Client updated" : "Client created" })
    } catch {
      toast({ title: "Error", description: "Could not save client.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await clientOrganizationsService.delete(Number(deleteTarget.id))
      await mutate()
      setDeleteTarget(null)
      toast({ title: "Client deleted" })
    } catch {
      toast({ title: "Error", description: "Could not delete client.", variant: "destructive" })
    }
  }

  const toggleProject = (id: string) => {
    setForm((f) => ({
      ...f,
      projectIds: f.projectIds.includes(id)
        ? f.projectIds.filter((p) => p !== id)
        : [...f.projectIds, id],
    }))
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Client Organizations"
        description="Funders and donor organizations linked to projects"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Clients" },
        ]}
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Client
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
            placeholder="Search clients…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
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
          <Building className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No client organizations found.</p>
          {canManage && (
            <Button variant="outline" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add First Client
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant={c.is_active ? "default" : "secondary"} className="text-xs">
                      {c.is_active ? (
                        <><CheckCircle2 className="mr-1 h-3 w-3" />Active</>
                      ) : (
                        <><XCircle className="mr-1 h-3 w-3" />Inactive</>
                      )}
                    </Badge>
                    {canManage && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {c.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                )}
                {c.contact_name && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building className="h-3.5 w-3.5" /> {c.contact_name}
                  </p>
                )}
                {c.contact_email && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" /> {c.contact_email}
                  </p>
                )}
                {c.contact_phone && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /> {c.contact_phone}
                  </p>
                )}
                {c.website && (
                  <a
                    href={c.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5" /> Website
                  </a>
                )}
                {(c.project_count ?? 0) > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FolderKanban className="h-3.5 w-3.5" /> {c.project_count} project{c.project_count !== 1 ? "s" : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Client" : "Add Client Organization"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update client details." : "Add a new funder or donor client."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Organization name" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact Name</Label>
                <Input value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Website</Label>
                <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="https://…" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(v) => setForm((f) => ({ ...f, is_active: v === "active" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {projects.length > 0 && (
              <div className="space-y-2">
                <Label>Linked Projects</Label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                  {projects.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={form.projectIds.includes(String(p.id))}
                        onChange={() => toggleProject(String(p.id))}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editingId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be undone.
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
