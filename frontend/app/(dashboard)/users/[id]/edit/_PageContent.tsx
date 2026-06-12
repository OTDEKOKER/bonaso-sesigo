"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Save, Shield, UserCog, Building2, Mail, AtSign } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { PageHeader } from "@/components/shared/page-header"
import { OrganizationSelect } from "@/components/shared/organization-select"

import { useAllOrganizations, useUser, useGroupCatalog } from "@/lib/hooks/use-api"
import { usersService } from "@/lib/api"
import type { UserRole } from "@/lib/types"
import { USER_ROLE_OPTIONS, USER_ROLE_COLORS } from "@/lib/roles"
import { canManageUsers } from "@/lib/permissions"
import { useAuth } from "@/lib/contexts/auth-context"
import { ModuleAccessEditor } from "@/components/users/module-access-editor"
import { useToast } from "@/hooks/use-toast"
import { useSmartBack } from "@/lib/hooks/use-smart-back"

type EditableUser = {
  email?: string
  username?: string
  firstName?: string
  first_name?: string
  lastName?: string
  last_name?: string
  role?: UserRole
  environment_access?: "both" | "live" | "training"
  organizationId?: string | number
  organization_id?: string | number
  organization?: string | number
  is_active?: boolean
  isActive?: boolean
  permissions?: string[]
}

type FormState = {
  email: string
  username: string
  firstName: string
  lastName: string
  role: UserRole
  environmentAccess: "both" | "live" | "training"
  organizationId: string
  isActive: boolean
  permissions: string[]
  groups: string[]
}

const initialForm: FormState = {
  email: "",
  username: "",
  firstName: "",
  lastName: "",
  role: "client",
  environmentAccess: "both",
  organizationId: "none",
  isActive: true,
  permissions: [],
  groups: [],
}

export default function UserEditPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user: currentUser } = useAuth()
  const canEditRestrictedFields = canManageUsers(currentUser)
  const params = useParams()

  const rawId = params?.id
  const userId = Number(Array.isArray(rawId) ? rawId[0] : rawId)
  const isValidUserId = Number.isFinite(userId)
  const handleBack = useSmartBack(isValidUserId ? `/users/${userId}` : "/users")

  const { data: user, isLoading, error, mutate } = useUser(isValidUserId ? userId : null)
  const { data: orgsData } = useAllOrganizations()
  const { data: catalogData = [] } = useGroupCatalog(canEditRestrictedFields)

  const organizations = orgsData?.results || []
  const groupCatalog = useMemo(
    () => Array.from(new Set([...catalogData])).filter(Boolean),
    [catalogData],
  )

  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState<FormState>(initialForm)

  useEffect(() => {
    if (!user) return

    const source = user as EditableUser

    setForm({
      email: source.email || "",
      username: source.username || "",
      firstName: source.firstName || source.first_name || "",
      lastName: source.lastName || source.last_name || "",
      role: source.role || "client",
      environmentAccess: (source.environment_access as FormState["environmentAccess"]) || "both",
      organizationId: String(
        source.organizationId ?? source.organization_id ?? source.organization ?? "none",
      ),
      isActive: source.is_active ?? source.isActive ?? true,
      permissions: Array.isArray(source.permissions) ? source.permissions : [],
      groups: Array.isArray((source as { groups?: string[] }).groups) ? (source as { groups?: string[] }).groups! : [],
    })
  }, [user])

  const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const toggleGroup = (group: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      groups: checked
        ? Array.from(new Set([...prev.groups, group]))
        : prev.groups.filter((entry) => entry !== group),
    }))
  }

  const selectedRoleLabel = useMemo(() => {
    return USER_ROLE_OPTIONS.find((item) => item.value === form.role)?.label || "User"
  }, [form.role])

  const fullName = `${form.firstName} ${form.lastName}`.trim() || form.username || "Unnamed user"
  const initials =
    `${(form.firstName?.[0] || "").toUpperCase()}${(form.lastName?.[0] || "").toUpperCase()}` ||
    (form.username?.[0] || "U").toUpperCase()
  const organizationName = useMemo(() => {
    if (!form.organizationId || form.organizationId === "none" || form.organizationId === "all") return "—"
    return organizations.find((org) => String(org.id) === String(form.organizationId))?.name || "—"
  }, [organizations, form.organizationId])

  const handleSave = async () => {
    if (!isValidUserId) {
      toast({
        title: "Invalid user",
        description: "The user ID is not valid.",
        variant: "destructive",
      })
      return
    }

    if (!form.email.trim()) {
      toast({
        title: "Validation error",
        description: "Email is required.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const requestPayload: {
        email?: string
        first_name?: string
        last_name?: string
        role?: UserRole
        environment_access?: "both" | "live" | "training"
        organization?: number
        is_active?: boolean
        permissions?: string[]
        groups?: string[]
      } = {
        email: form.email.trim() || undefined,
        first_name: form.firstName.trim() || undefined,
        last_name: form.lastName.trim() || undefined,
      }

      if (canEditRestrictedFields) {
        requestPayload.role = form.role
        requestPayload.environment_access = form.environmentAccess
        requestPayload.organization =
          form.organizationId !== "none" && form.organizationId !== "all"
            ? Number(form.organizationId)
            : undefined
        requestPayload.is_active = form.isActive
        requestPayload.permissions = form.permissions
        requestPayload.groups = form.groups
      }

      await usersService.update(userId, requestPayload)
      await mutate()

      toast({
        title: "User updated",
        description: "Changes saved successfully.",
      })

      router.push(`/users/${userId}`)
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update user.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !user || !isValidUserId) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">User not found</p>
        <Button onClick={() => router.push("/users")}>Back to Users</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Edit User"
        description="Update user details, access, and permissions"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Users", href: "/users" },
          { label: "Edit" },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleBack} disabled={isSaving}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="text-xl font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <div className="space-y-0.5">
                <p className="text-lg font-semibold leading-tight">{fullName}</p>
                {form.username ? (
                  <p className="text-sm text-muted-foreground">@{form.username}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Badge variant={form.isActive ? "default" : "secondary"}>
                  {form.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="secondary" className={USER_ROLE_COLORS[form.role] || ""}>
                  <Shield className="mr-1 h-3 w-3" />
                  {selectedRoleLabel}
                </Badge>
              </div>
              <Separator />
              <dl className="w-full space-y-3 text-left text-sm">
                <div className="flex items-start gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd className="break-all font-medium">{form.email || "—"}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Organization</dt>
                    <dd className="font-medium">{organizationName}</dd>
                  </div>
                </div>
              </dl>
            </CardContent>
          </Card>
        </aside>

        <div className="min-w-0 space-y-6">
          {!canEditRestrictedFields && (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Role, organization, status, and permissions can only be updated by admins.
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">Basic Information</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {form.username ? (
                  <div className="space-y-2">
                    <Label htmlFor="username" className="flex items-center gap-1.5">
                      <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
                      Username
                    </Label>
                    <Input
                      id="username"
                      value={form.username}
                      readOnly
                      disabled
                      className="bg-muted/50 text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground">Username cannot be changed after creation.</p>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    value={form.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    placeholder="Enter email address"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) => updateField("firstName", e.target.value)}
                      placeholder="Enter first name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => updateField("lastName", e.target.value)}
                      placeholder="Enter last name"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <UserCog className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">Account Access</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={form.role}
                    onValueChange={(value) => updateField("role", value as UserRole)}
                    disabled={!canEditRestrictedFields}
                  >
                    <SelectTrigger disabled={!canEditRestrictedFields}>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLE_OPTIONS.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {canEditRestrictedFields && (
                  <>
                    <div className="space-y-2">
                      <Label>Environment access</Label>
                      <Select
                        value={form.environmentAccess}
                        onValueChange={(value) =>
                          updateField("environmentAccess", value as FormState["environmentAccess"])
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select environment access" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="both">Live and Training</SelectItem>
                          <SelectItem value="live">Live only</SelectItem>
                          <SelectItem value="training">Training only</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Restricts which environment this user may sign in to (enforced at login).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Organization</Label>
                      <OrganizationSelect
                        organizations={organizations}
                        value={form.organizationId}
                        onChange={(value) => updateField("organizationId", value)}
                        placeholder="Select organization"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={form.isActive ? "active" : "inactive"}
                        onValueChange={(value) => updateField("isActive", value === "active")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {canEditRestrictedFields && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">User Groups</CardTitle>
                </div>
                <CardDescription>Assign the user to one or more system groups.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {groupCatalog.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No groups available.</p>
                  ) : (
                    groupCatalog.map((group) => {
                      const htmlId = `group-${group.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`
                      const checked = form.groups.includes(group)

                      return (
                        <label
                          key={group}
                          htmlFor={htmlId}
                          className="flex cursor-pointer items-center gap-3 rounded-md border border-transparent p-2 transition hover:bg-muted/50"
                        >
                          <Checkbox
                            id={htmlId}
                            checked={checked}
                            onCheckedChange={(value) => toggleGroup(group, Boolean(value))}
                          />
                          <span className="text-sm">{group}</span>
                        </label>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {canEditRestrictedFields && Number.isFinite(userId) ? (
            <ModuleAccessEditor userId={userId} role={form.role} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
