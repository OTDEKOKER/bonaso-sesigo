"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FilterX,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { PageHeader } from "@/components/shared/page-header"
import { OrganizationSelect } from "@/components/shared/organization-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUsers, useAllOrganizations, useUserPermissions, useGroupCatalog } from "@/lib/hooks/use-api"
import { usersService } from "@/lib/api"
import type { User } from "@/lib/types"
import { USER_ROLE_COLORS, USER_ROLE_LABELS, USER_ROLE_OPTIONS } from "@/lib/roles"
import { canChangeUserActivation, canManageUsers, canResetUserPasswords } from "@/lib/permissions"
import { useAuth } from "@/lib/contexts/auth-context"
import { UserPermissionsManager } from "@/components/users/user-permissions-manager"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type SearchBy = "name" | "email" | "username"
type LastActiveFilter = "all" | "today" | "last_7_days" | "last_30_days" | "never"
type StatusFilter = "all" | "active" | "inactive"
type SortField = "user" | "last_active"
type SortDirection = "asc" | "desc"

const PAGE_SIZE = 10
const BASE_GROUP_OPTIONS = [
  "Admin",
  "Data Collector",
  "Coordinator",
  "Viewer",
  "Partner Org",
  "Funder",
]

const ROLE_GROUP_FALLBACK: Record<User["role"], string[]> = {
  admin: ["Admin"],
  collector: ["Data Collector"],
  manager: ["Coordinator"],
  officer: ["Viewer"],
  client: ["Partner Org"],
}

function normalizeUsername(user: User): string {
  const withUsername = user as User & { username?: string }
  return typeof withUsername.username === "string" ? withUsername.username : ""
}

function uniqueGroups(groups: string[]): string[] {
  const normalized = groups.map((group) => String(group || "").trim()).filter(Boolean)
  return Array.from(new Set(normalized))
}

function parseLastLogin(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatLastActive(value?: string): string {
  const parsed = parseLastLogin(value)
  if (!parsed) return "Never"
  return parsed.toLocaleDateString()
}

function isSameDay(date: Date, comparison: Date): boolean {
  return (
    date.getFullYear() === comparison.getFullYear() &&
    date.getMonth() === comparison.getMonth() &&
    date.getDate() === comparison.getDate()
  )
}

function getPageWindow(currentPage: number, totalPages: number): number[] {
  const start = Math.max(1, currentPage - 2)
  const end = Math.min(totalPages, currentPage + 2)
  const pages: number[] = []
  for (let page = start; page <= end; page += 1) {
    pages.push(page)
  }
  return pages
}

export default function UsersPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user: currentUser } = useAuth()
  const canAdministerUsers = canManageUsers(currentUser)

  const { data: usersData, isLoading, error, mutate } = useUsers({ page_size: "500" })
  const { data: orgsData } = useAllOrganizations()
  const {
    data: availablePermissions = [],
    isLoading: isPermissionsLoading,
    error: permissionsError,
    mutate: mutatePermissions,
  } = useUserPermissions(canAdministerUsers)
  const {
    data: catalogData = [],
    mutate: mutateCatalog,
  } = useGroupCatalog(canAdministerUsers)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [resetUser, setResetUser] = useState<User | null>(null)
  const [resetPassword, setResetPassword] = useState("")
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("")
  const [isResetting, setIsResetting] = useState(false)

  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    onConfirm: () => Promise<void>
    destructive?: boolean
  } | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const groupCatalog = useMemo(
    () => uniqueGroups([...BASE_GROUP_OPTIONS, ...catalogData]),
    [catalogData],
  )
  const [newGroupName, setNewGroupName] = useState("")

  const [searchQuery, setSearchQuery] = useState("")
  const [searchBy, setSearchBy] = useState<SearchBy>("name")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [groupFilter, setGroupFilter] = useState("all")
  const [organizationFilter, setOrganizationFilter] = useState("all")
  const [lastActiveFilter, setLastActiveFilter] = useState<LastActiveFilter>("all")
  const [sortField, setSortField] = useState<SortField>("user")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [currentPage, setCurrentPage] = useState(1)

  const [formData, setFormData] = useState({
    username: "",
    firstName: "",
    lastName: "",
    email: "",
    role: "",
    organizationId: "",
    password: "",
    passwordConfirm: "",
    permissions: [] as string[],
    groups: [] as string[],
  })

  const users = useMemo(() => usersData?.results || [], [usersData?.results])
  const organizations = useMemo(() => orgsData?.results || [], [orgsData?.results])
  const canResetPasswords = canResetUserPasswords(currentUser)
  const canActivateDeactivateUsers = canChangeUserActivation(currentUser)
  const permissionsErrorMessage = permissionsError
    ? (permissionsError as { message?: string })?.message || "Failed to load permissions from server."
    : undefined

  const groupFilterOptions = useMemo(() => {
    const extras = groupCatalog.filter((group) => !BASE_GROUP_OPTIONS.includes(group))
    return [...BASE_GROUP_OPTIONS, ...extras]
  }, [groupCatalog])

  const organizationNameById = useMemo(() => {
    const map = new Map<string, string>()
    organizations.forEach((org) => {
      map.set(String(org.id), org.name)
    })
    return map
  }, [organizations])

  const enrichedUsers = useMemo(() => {
    return users.map((user) => {
      const roleFallbackGroups = ROLE_GROUP_FALLBACK[user.role] || []
      const assignedGroups = Array.isArray(user.groups) ? user.groups : []
      const groups = uniqueGroups([...roleFallbackGroups, ...assignedGroups])
      const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
      const username = normalizeUsername(user)
      return {
        user,
        groups,
        displayName,
        username,
        lastLoginDate: parseLastLogin(user.lastLogin),
        organizationName: organizationNameById.get(String(user.organizationId)) || "-",
      }
    })
  }, [users, organizationNameById])

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const now = new Date()

    return enrichedUsers.filter((entry) => {
      if (query) {
        const haystack =
          searchBy === "name"
            ? `${entry.user.firstName || ""} ${entry.user.lastName || ""}`
            : searchBy === "email"
              ? entry.user.email || ""
              : entry.username
        if (!haystack.toLowerCase().includes(query)) {
          return false
        }
      }

      if (roleFilter !== "all" && entry.user.role !== roleFilter) {
        return false
      }

      if (statusFilter !== "all") {
        const isActive =
          (entry.user as User & { is_active?: boolean; isActive?: boolean }).is_active ??
          (entry.user as User & { is_active?: boolean; isActive?: boolean }).isActive ??
          true
        if (statusFilter === "active" && !isActive) return false
        if (statusFilter === "inactive" && isActive) return false
      }

      if (groupFilter !== "all" && !entry.groups.some((group) => group.toLowerCase() === groupFilter.toLowerCase())) {
        return false
      }

      if (organizationFilter !== "all" && String(entry.user.organizationId) !== organizationFilter) {
        return false
      }

      const lastLogin = entry.lastLoginDate
      if (lastActiveFilter === "never") {
        return !lastLogin
      }
      if (!lastLogin) {
        return lastActiveFilter === "all"
      }

      if (lastActiveFilter === "today") {
        return isSameDay(lastLogin, now)
      }
      if (lastActiveFilter === "last_7_days") {
        const sevenDaysAgo = new Date(now)
        sevenDaysAgo.setDate(now.getDate() - 7)
        return lastLogin >= sevenDaysAgo
      }
      if (lastActiveFilter === "last_30_days") {
        const thirtyDaysAgo = new Date(now)
        thirtyDaysAgo.setDate(now.getDate() - 30)
        return lastLogin >= thirtyDaysAgo
      }

      return true
    })
  }, [enrichedUsers, searchQuery, searchBy, groupFilter, organizationFilter, lastActiveFilter])

  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers]
    sorted.sort((a, b) => {
      if (sortField === "user") {
        const compare = a.displayName.localeCompare(b.displayName)
        return sortDirection === "asc" ? compare : -compare
      }

      const aTime = a.lastLoginDate ? a.lastLoginDate.getTime() : 0
      const bTime = b.lastLoginDate ? b.lastLoginDate.getTime() : 0
      return sortDirection === "asc" ? aTime - bTime : bTime - aTime
    })
    return sorted
  }, [filteredUsers, sortField, sortDirection])

  const totalUsers = sortedUsers.length
  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE))
  const pageStartIndex = (currentPage - 1) * PAGE_SIZE
  const pagedUsers = sortedUsers.slice(pageStartIndex, pageStartIndex + PAGE_SIZE)
  const visiblePages = getPageWindow(currentPage, totalPages)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, searchBy, roleFilter, statusFilter, groupFilter, organizationFilter, lastActiveFilter])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }
    setSortField(field)
    setSortDirection("asc")
  }

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-foreground" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-foreground" />
    )
  }

  const clearFilters = () => {
    setSearchQuery("")
    setSearchBy("name")
    setRoleFilter("all")
    setStatusFilter("all")
    setGroupFilter("all")
    setOrganizationFilter("all")
    setLastActiveFilter("all")
    setCurrentPage(1)
  }

  const handleCreate = async () => {
    if (!canAdministerUsers) {
      toast({
        title: "Permission denied",
        description: "Only admins can create users.",
        variant: "destructive",
      })
      return
    }
    if (!formData.username || !formData.firstName || !formData.lastName || !formData.email || !formData.role) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      })
      return
    }
    if (!formData.password || !formData.passwordConfirm) {
      toast({
        title: "Validation Error",
        description: "Please provide a password and confirm it.",
        variant: "destructive",
      })
      return
    }
    if (formData.password !== formData.passwordConfirm) {
      toast({
        title: "Validation Error",
        description: "Passwords do not match.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const createdUser = await usersService.create({
        username: formData.username,
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: formData.email,
        role: formData.role as User["role"],
        organization: formData.organizationId && formData.organizationId !== "all"
          ? Number(formData.organizationId)
          : undefined,
        password: formData.password,
        password_confirm: formData.passwordConfirm,
        permissions: formData.permissions,
      })
      if (createdUser?.id && formData.groups.length > 0) {
        await usersService.update(Number(createdUser.id), { groups: formData.groups })
      }
      toast({
        title: "Success",
        description: "User created successfully",
      })
      setIsCreateOpen(false)
      setFormData({
        username: "",
        firstName: "",
        lastName: "",
        email: "",
        role: "",
        organizationId: "",
        password: "",
        passwordConfirm: "",
        permissions: [],
        groups: [],
      })
      mutate()
    } catch (err: unknown) {
      console.warn("Create user failed", err)
      const errorObject = err && typeof err === "object" ? (err as { message?: string; errors?: Record<string, string[]> }) : null
      const errorMessage = errorObject?.errors
        ? Object.entries(errorObject.errors)
            .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(", ") : msgs}`)
            .join(" | ")
        : errorObject?.message || "Failed to create user"
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResetPassword = async (user: User) => {
    if (!canResetPasswords) {
      toast({
        title: "Permission denied",
        description: "Only admins can reset passwords.",
        variant: "destructive",
      })
      return
    }
    setResetUser(user)
    setResetPassword("")
    setResetPasswordConfirm("")
    setIsResetOpen(true)
  }

  const handleConfirmReset = async () => {
    if (!resetUser) return
    if (!resetPassword || !resetPasswordConfirm) {
      toast({
        title: "Validation Error",
        description: "Please provide and confirm the new password.",
        variant: "destructive",
      })
      return
    }
    if (resetPassword !== resetPasswordConfirm) {
      toast({
        title: "Validation Error",
        description: "Passwords do not match.",
        variant: "destructive",
      })
      return
    }
    setIsResetting(true)
    try {
      await usersService.adminResetPassword(Number(resetUser.id), resetPassword)
      toast({
        title: "Success",
        description: "Password reset successfully.",
      })
      setIsResetOpen(false)
    } catch {
      toast({
        title: "Error",
        description: "Failed to reset password",
        variant: "destructive",
      })
    } finally {
      setIsResetting(false)
    }
  }

  const handleDeactivate = (user: User) => {
    if (!canActivateDeactivateUsers) {
      toast({
        title: "Permission denied",
        description: "Only admins can deactivate users.",
        variant: "destructive",
      })
      return
    }
    setConfirmAction({
      title: "Deactivate user",
      description: `${user.firstName} ${user.lastName} will no longer be able to log in. You can reactivate them at any time.`,
      destructive: true,
      onConfirm: async () => {
        await usersService.deactivate(Number(user.id))
        toast({ title: "User deactivated" })
        mutate()
      },
    })
  }

  const handleActivate = (user: User) => {
    if (!canActivateDeactivateUsers) {
      toast({
        title: "Permission denied",
        description: "Only admins can activate users.",
        variant: "destructive",
      })
      return
    }
    setConfirmAction({
      title: "Activate user",
      description: `${user.firstName} ${user.lastName} will be able to log in again.`,
      onConfirm: async () => {
        await usersService.activate(Number(user.id))
        toast({ title: "User activated" })
        mutate()
      },
    })
  }

  const actions = (user: User) => {
    const items: Array<{ label: string; onClick: () => void; destructive?: boolean }> = [
      { label: "Edit", onClick: () => router.push(`/users/${user.id}/edit`) },
    ]
    if (canResetPasswords) {
      items.push({ label: "Reset Password", onClick: () => handleResetPassword(user) })
    }
    if (canActivateDeactivateUsers) {
      const isActive =
        (user as User & { is_active?: boolean; isActive?: boolean }).is_active ??
        (user as User & { is_active?: boolean; isActive?: boolean }).isActive ??
        true
      items.push(
        isActive
          ? { label: "Deactivate", onClick: () => handleDeactivate(user), destructive: true }
          : { label: "Activate", onClick: () => handleActivate(user) },
      )
    }
    return items
  }

  const handleAddGroup = async () => {
    const next = newGroupName.trim()
    if (!next) return
    try {
      await usersService.addGroup(next)
      await mutateCatalog()
      setNewGroupName("")
    } catch {
      toast({ title: "Error", description: "Failed to add group.", variant: "destructive" })
    }
  }

  const handleRemoveGroup = async (groupName: string) => {
    if (BASE_GROUP_OPTIONS.includes(groupName)) return
    try {
      await usersService.removeGroup(groupName)
      await mutateCatalog()
      setFormData((prev) => ({
        ...prev,
        groups: prev.groups.filter((group) => group.toLowerCase() !== groupName.toLowerCase()),
      }))
    } catch {
      toast({ title: "Error", description: "Failed to remove group.", variant: "destructive" })
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
        <p className="text-muted-foreground">Failed to load users</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  const showingFrom = totalUsers === 0 ? 0 : pageStartIndex + 1
  const showingTo = Math.min(pageStartIndex + PAGE_SIZE, totalUsers)

  return (
    <div className="w-full max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title="Users"
        description="Manage user accounts and permissions"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Users" },
        ]}
        actions={
          canAdministerUsers ? (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          ) : null
        }
      />

      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">User Groups</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {groupCatalog.length === 0 ? (
            <span className="text-sm text-muted-foreground">No groups created yet.</span>
          ) : (
            groupCatalog.map((group) => (
              <Badge
                key={group}
                variant="secondary"
                className={cn("px-3 py-1 text-xs", !BASE_GROUP_OPTIONS.includes(group) && "cursor-pointer")}
                onClick={() => handleRemoveGroup(group)}
                title={BASE_GROUP_OPTIONS.includes(group) ? undefined : "Remove group"}
              >
                {group}{!BASE_GROUP_OPTIONS.includes(group) ? " x" : ""}
              </Badge>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Add group (e.g. Coordinators)"
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                handleAddGroup()
              }
            }}
            className="min-w-0 flex-1"
          />
          <Button type="button" variant="outline" onClick={handleAddGroup} className="shrink-0">
            Add Group
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Search + Filters</p>
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            <FilterX className="mr-2 h-4 w-4" />
            Clear filters
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-8">
          <div className="space-y-2 xl:col-span-2">
            <Label htmlFor="users-search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="users-search"
                placeholder="Search users"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Search by</Label>
            <Select value={searchBy} onValueChange={(value) => setSearchBy(value as SearchBy)}>
              <SelectTrigger>
                <SelectValue placeholder="Field" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="username">Username</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {USER_ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Group</Label>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groupFilterOptions.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Organization</Label>
            <Select value={organizationFilter} onValueChange={setOrganizationFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All organizations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organizations</SelectItem>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={String(organization.id)}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Last active</Label>
            <Select
              value={lastActiveFilter}
              onValueChange={(value) => setLastActiveFilter(value as LastActiveFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="last_7_days">Last 7 days</SelectItem>
                <SelectItem value="last_30_days">Last 30 days</SelectItem>
                <SelectItem value="never">Never logged in</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="w-full overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[30%]">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-left"
                    onClick={() => handleSort("user")}
                  >
                    User
                    {renderSortIcon("user")}
                  </button>
                </TableHead>
                <TableHead className="w-[22%]">Groups</TableHead>
                <TableHead className="w-[20%]">Organization</TableHead>
                <TableHead className="w-[18%]">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-left"
                    onClick={() => handleSort("last_active")}
                  >
                    Last Active
                    {renderSortIcon("last_active")}
                  </button>
                </TableHead>
                <TableHead className="w-[10%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-36 text-center whitespace-normal">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">No users found</p>
                      <p className="text-sm text-muted-foreground">Try adjusting your filters</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedUsers.map((entry) => {
                  const userActions = actions(entry.user)
                  const initials = `${(entry.user.firstName?.[0] || "").toUpperCase()}${(entry.user.lastName?.[0] || "").toUpperCase()}` || "U"
                  return (
                    <TableRow
                      key={entry.user.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/users/${entry.user.id}`)}
                    >
                      <TableCell className="whitespace-normal">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 space-y-0.5">
                            <p className="truncate text-sm font-medium text-foreground">{entry.displayName}</p>
                            <p className="truncate text-xs text-muted-foreground">{entry.user.email}</p>
                            {entry.username ? (
                              <p className="truncate text-xs text-muted-foreground">@{entry.username}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className={cn("text-[10px]", USER_ROLE_COLORS[entry.user.role] || "")}> 
                            <Shield className="mr-1 h-3 w-3" />
                            {USER_ROLE_LABELS[entry.user.role] || entry.user.role}
                          </Badge>
                          {entry.groups.slice(0, 2).map((group) => (
                            <Badge key={`${entry.user.id}-${group}`} variant="outline" className="max-w-[110px] truncate text-[10px]">
                              {group}
                            </Badge>
                          ))}
                          {entry.groups.length > 2 ? (
                            <Badge variant="outline" className="text-[10px]">+{entry.groups.length - 2}</Badge>
                          ) : null}
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-normal">
                        <span className="block truncate text-sm text-muted-foreground">{entry.organizationName}</span>
                      </TableCell>

                      <TableCell className="whitespace-normal">
                        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{formatLastActive(entry.user.lastLogin)}</span>
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {userActions.map((action) => (
                              <DropdownMenuItem
                                key={`${entry.user.id}-${action.label}`}
                                className={cn(action.destructive && "text-destructive")}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  action.onClick()
                                }}
                              >
                                {action.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {showingFrom}\u2013{showingTo} of {totalUsers} users
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Prev
            </Button>

            {visiblePages.map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? "default" : "outline"}
                size="sm"
                onClick={() => setCurrentPage(page)}
                className="min-w-9"
              >
                {page}
              </Button>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>
              Create a new user account
            </DialogDescription>
          </DialogHeader>
          <form
            className="max-h-[calc(90vh-8rem)] space-y-4 overflow-y-auto pr-1"
            onSubmit={(e) => {
              e.preventDefault()
              handleCreate()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">Username *</Label>
                <Input
                  id="username"
                  placeholder="jdoe"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.org"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="********"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="passwordConfirm">Confirm Password *</Label>
                <Input
                  id="passwordConfirm"
                  type="password"
                  placeholder="********"
                  value={formData.passwordConfirm}
                  onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role *</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger>
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
            <div className="space-y-2">
              <Label>User Groups</Label>
              <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
                {groupCatalog.map((group) => (
                  <label key={group} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.groups.includes(group)}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          groups: event.target.checked
                            ? [...prev.groups, group]
                            : prev.groups.filter((entry) => entry !== group),
                        }))
                      }
                    />
                    <span>{group}</span>
                  </label>
                ))}
              </div>
            </div>
            <UserPermissionsManager
              availablePermissions={availablePermissions}
              value={formData.permissions}
              onChange={(permissions) => setFormData({ ...formData, permissions })}
              isLoading={isPermissionsLoading}
              errorMessage={permissionsErrorMessage}
              onRetry={() => {
                void mutatePermissions()
              }}
            />
            <div className="space-y-2">
              <Label htmlFor="organization">Organization</Label>
              <OrganizationSelect
                organizations={organizations}
                value={formData.organizationId}
                onChange={(value) => setFormData({ ...formData, organizationId: value })}
                placeholder="Select organization"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetUser?.firstName} {resetUser?.lastName}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              handleConfirmReset()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="resetPassword">New Password</Label>
              <Input
                id="resetPassword"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resetPasswordConfirm">Confirm Password</Label>
              <Input
                id="resetPasswordConfirm"
                type="password"
                value={resetPasswordConfirm}
                onChange={(e) => setResetPasswordConfirm(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsResetOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isResetting}>
                {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reset Password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirming}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isConfirming}
              className={confirmAction?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={async (event) => {
                event.preventDefault()
                if (!confirmAction) return
                setIsConfirming(true)
                try {
                  await confirmAction.onConfirm()
                } catch {
                  toast({ title: "Error", description: "Action failed. Please try again.", variant: "destructive" })
                } finally {
                  setIsConfirming(false)
                  setConfirmAction(null)
                }
              }}
            >
              {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
