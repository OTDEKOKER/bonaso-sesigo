"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/shared/page-header"
import { OrganizationSelect } from "@/components/shared/organization-select"
import { organizationsService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useOrganization, useAllOrganizations } from "@/lib/hooks/use-api"
import { useSmartBack } from "@/lib/hooks/use-smart-back"
import { canManageOrganizations } from "@/lib/permissions"
import type { Organization } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import {
  canOrganizationBeParentForType,
  getEffectiveOrganizationType,
  ORGANIZATION_TYPE_OPTIONS,
  organizationCanBeParent,
  organizationCanHaveParent,
} from "@/lib/organization-hierarchy"

export default function OrganizationEditPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useAuth()
  const params = useParams()
  const id = Number(params?.id)
  const handleBack = useSmartBack(Number.isFinite(id) ? `/organizations/${id}` : "/organizations")

  const { data: org, isLoading, error, mutate } = useOrganization(Number.isFinite(id) ? id : null)
  const { data: orgsData } = useAllOrganizations()
  const organizations = useMemo(() => orgsData?.results ?? [], [orgsData?.results])
  const canManageOrgRecords = canManageOrganizations(user)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    type: "",
    parentId: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    description: "",
    isActive: true,
  })

  const parentOptions = useMemo(
    () =>
      organizations
        .filter((entry) => String(entry.id) !== String(id))
        .filter((entry) => organizationCanBeParent(getEffectiveOrganizationType(entry)))
        .filter((entry) => canOrganizationBeParentForType(getEffectiveOrganizationType(entry), formData.type))
        .sort((left, right) => (left.name || "").localeCompare(right.name || "")),
    [formData.type, id, organizations],
  )

  useEffect(() => {
    if (!formData.parentId || formData.parentId === "none") return
    if (parentOptions.some((entry) => String(entry.id) === formData.parentId)) return
    setFormData((current) => ({ ...current, parentId: "none" }))
  }, [formData.parentId, parentOptions])

  useEffect(() => {
    if (!org) return
    setFormData({
      name: org.name || "",
      code: org.code || "",
      type: getEffectiveOrganizationType(org),
      parentId: org.parentId ? String(org.parentId) : "none",
      contactEmail: org.contactEmail || "",
      contactPhone: org.contactPhone || "",
      address: org.address || "",
      description: org.description || "",
      isActive: org.is_active ?? true,
    })
  }, [org])

  const handleSave = async () => {
    if (!canManageOrgRecords) {
      toast({
        title: "Read-only access",
        description: "Only platform admins can edit organizations.",
        variant: "destructive",
      })
      router.push(`/organizations/${id}`)
      return
    }

    if (!formData.name || !formData.type) {
      toast({
        title: "Validation Error",
        description: "Name and type are required.",
        variant: "destructive",
      })
      return
    }
    setIsSubmitting(true)
    try {
      await organizationsService.update(id, {
        name: formData.name,
        code: formData.code || undefined,
        type: formData.type as Organization["type"],
        parentId: formData.parentId === "none" ? undefined : formData.parentId,
        contactEmail: formData.contactEmail || undefined,
        contactPhone: formData.contactPhone || undefined,
        address: formData.address || undefined,
        description: formData.description || undefined,
        is_active: formData.isActive,
      })
      toast({
        title: "Organization updated",
        description: "Changes saved successfully.",
      })
      mutate()
      router.push(`/organizations/${id}`)
    } catch (err) {
      console.error("Failed to update organization", err)
      toast({
        title: "Error",
        description: "Failed to update organization.",
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

  if (error || !org) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Organization not found</p>
        <Button onClick={() => router.push("/organizations")}>Back to Organizations</Button>
      </div>
    )
  }

  if (!canManageOrgRecords) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={org ? `Edit ${org.name}` : "Edit Organization"}
          description="Editing is restricted to platform admins"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Organizations", href: "/organizations" },
            ...(org ? [{ label: org.name, href: `/organizations/${id}` }] : []),
            { label: "Edit" },
          ]}
          actions={
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Read-only access</CardTitle>
            <CardDescription>
              Your account can view organization details, but only platform admins can update records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleBack}>Return to Organization</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${org.name}`}
        description="Update organization details"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Organizations", href: "/organizations" },
          { label: org.name, href: `/organizations/${id}` },
          { label: "Edit" },
        ]}
        actions={
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Organization Details</CardTitle>
          <CardDescription>Update the profile and contact information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ORGANIZATION_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="parent">Parent Organization</Label>
              <OrganizationSelect
                organizations={parentOptions}
                value={formData.parentId}
                onChange={(value) => setFormData({ ...formData, parentId: value === "none" ? "" : value })}
                includeNone
                noneLabel="No parent"
                placeholder="Select parent"
                disabled={!organizationCanHaveParent(formData.type)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Contact Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.contactEmail}
                onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Contact Phone</Label>
              <Input
                id="phone"
                value={formData.contactPhone}
                onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              rows={3}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Active</p>
              <p className="text-xs text-muted-foreground">Enable or disable this organization</p>
            </div>
            <Switch
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => router.push(`/organizations/${id}`)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
