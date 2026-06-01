"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Plus, Building2, Loader2, Search, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/shared/page-header"
import { OrganizationSelect } from "@/components/shared/organization-select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useAllOrganizations } from "@/lib/hooks/use-api"
import { organizationsService } from "@/lib/api"
import { canManageOrganizations } from "@/lib/permissions"
import type { Organization } from "@/lib/types"
import {
  canOrganizationBeParentForType,
  getEffectiveOrganizationType,
  getOrganizationTypeColorClass,
  getOrganizationTypeLabel,
  ORGANIZATION_TYPE_OPTIONS,
  organizationCanBeParent,
  organizationCanHaveParent,
} from "@/lib/organization-hierarchy"

const EMPTY: never[] = []

function resolveParentId(org: Organization & { parent?: string | number | null }): string {
  const raw = (org as { parentId?: string | number | null }).parentId ?? org.parent ?? null
  if (!raw) return ""
  const s = String(raw).trim().toLowerCase()
  if (s === "" || s === "null" || s === "none" || s === "undefined" || s === "0") return ""
  return String(raw)
}

export default function OrganizationsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useAuth()
  const { data, isLoading, error, mutate } = useAllOrganizations()
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState({
    name: "", type: "", parentId: "", contactEmail: "",
    contactPhone: "", address: "", description: "", isActive: true,
  })

  const allOrgs: Organization[] = data?.results ?? EMPTY
  const canManage = canManageOrganizations(user)

  const orgsById = useMemo(
    () => new Map(allOrgs.map((o) => [String(o.id), o])),
    [allOrgs],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allOrgs.filter((org) => {
      if (typeFilter !== "all" && getEffectiveOrganizationType(org) !== typeFilter) return false
      if (statusFilter === "active" && !org.is_active) return false
      if (statusFilter === "inactive" && org.is_active) return false
      if (!q) return true
      return (
        (org.name ?? "").toLowerCase().includes(q) ||
        (org.code ?? "").toLowerCase().includes(q) ||
        (org.contactEmail ?? "").toLowerCase().includes(q)
      )
    }).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
  }, [allOrgs, search, typeFilter, statusFilter])

  const parentOptions = useMemo(
    () =>
      allOrgs
        .filter((o) => organizationCanBeParent(getEffectiveOrganizationType(o)))
        .filter((o) => canOrganizationBeParentForType(getEffectiveOrganizationType(o), form.type))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [allOrgs, form.type],
  )

  const handleCreate = async () => {
    if (!form.name || !form.type) {
      toast({ title: "Required fields missing", description: "Name and type are required.", variant: "destructive" })
      return
    }
    setIsSubmitting(true)
    try {
      await organizationsService.create({
        name: form.name,
        type: form.type as Organization["type"],
        parentId: form.parentId || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        address: form.address || undefined,
        description: form.description || undefined,
        is_active: form.isActive,
      })
      toast({ title: "Organization created" })
      setIsCreateOpen(false)
      setForm({ name: "", type: "", parentId: "", contactEmail: "", contactPhone: "", address: "", description: "", isActive: true })
      mutate()
    } catch {
      toast({ title: "Create failed", variant: "destructive" })
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
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-muted-foreground">Failed to load organizations</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description={`${allOrgs.length} organizations registered in the system`}
        actions={
          canManage ? (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Organization
            </Button>
          ) : null
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, code or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ORGANIZATION_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {allOrgs.length}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No organizations match your filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 hidden md:table-cell">Parent</th>
                <th className="px-4 py-3 hidden lg:table-cell">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((org) => {
                const parentId = resolveParentId(org as Organization & { parent?: string | number | null })
                const parent = parentId ? orgsById.get(parentId) : null
                const displayType = getEffectiveOrganizationType(org)
                const contactEmail = org.contactEmail

                return (
                  <tr
                    key={org.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/organizations/${org.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{org.name}</p>
                          {org.code && (
                            <p className="text-xs text-muted-foreground font-mono">{org.code}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className={getOrganizationTypeColorClass(displayType)}>
                        {getOrganizationTypeLabel(displayType)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                      {parent ? parent.name : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {contactEmail || <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {org.is_active ? (
                        <Badge className="bg-success/15 text-success border-success/30 text-xs">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => router.push(`/organizations/${org.id}/edit`)}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => router.push(`/organizations/${org.id}`)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={canManage && isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Organization</DialogTitle>
            <DialogDescription>Register a new organization in the system.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleCreate() }}>
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="Organization name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {ORGANIZATION_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Parent organization (optional)</Label>
              <OrganizationSelect
                organizations={parentOptions}
                value={form.parentId}
                onChange={(v) => setForm({ ...form, parentId: v === "none" ? "" : v })}
                includeNone
                noneLabel="No parent"
                placeholder="Select parent"
                disabled={!organizationCanHaveParent(form.type)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact email</Label>
                <Input type="email" placeholder="info@org.bw" value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Contact phone</Label>
                <Input placeholder="+267 71 234 567" value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Active</p>
              <Switch checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
