"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  KeyRound,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { PageHeader } from "@/components/shared/page-header"
import { OrganizationSelect } from "@/components/shared/organization-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserActivityPanel } from "@/components/users/user-activity-panel"
import { PasswordResetRequestsPanel } from "@/components/users/password-reset-requests-panel"
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
  // The activity/audit endpoints are admin-only (backend enforced); only show
  // the Activity tab to admins so managers don't hit a 403.
  const canViewActivity = currentUser?.role === "admin"

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
  const [createStep, setCreateStep] = useState(1)
  const [isGroupsOpen, setIsGroupsOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
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
    environmentAccess: "both",
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
      const isActive =
        (user as User & { is_active?: boolean; isActive?: boolean }).is_active ??
        (user as User & { is_active?: boolean; isActive?: boolean }).isActive ??
        true
      return {
        user,
        groups,
        displayName,
        username,
        isActive,
        lastLoginDate: parseLastLogin(user.lastLogin),
        organizationName: organizationNameById.get(String(user.organizationId)) || "-",
      }
    })
  }, [users, organizationNameById])

  const stats = useMemo(() => {
    const total = enrichedUsers.length
    const active = enrichedUsers.filter((entry) => entry.isActive).length
    const neverLoggedIn = enrichedUsers.filter((entry) => !entry.lastLoginDate).length
    return { total, active, inactive: total - active, neverLoggedIn }
  }, [enrichedUsers])

  const summaryItems = [
    { label: "Total", value: stats.total, tone: "text-foreground" },
    { label: "Active", value: stats.active, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Inactive", value: stats.inactive, tone: "text-destructive" },
    { label: "Never logged in", value: stats.neverLoggedIn, tone: "text-amber-600 dark:text-amber-400" },
  ]

  const LAST_ACTIVE_LABELS: Record<LastActiveFilter, string> = {
    all: "Any time",
    today: "Today",
    last_7_days: "Last 7 days",
    last_30_days: "Last 30 days",
    never: "Never logged in",
  }

  const advancedFilterCount = [
    groupFilter !== "all",
    organizationFilter !== "all",
    lastActiveFilter !== "all",
  ].filter(Boolean).length

  const activeChips: Array<{ key: string; label: string; clear: () => void }> = []
  if (searchQuery.trim()) {
    activeChips.push({ key: "q", label: `“${searchQuery.trim()}”`, clear: () => setSearchQuery("") })
  }
  if (roleFilter !== "all") {
    activeChips.push({ key: "role", label: USER_ROLE_LABELS[roleFilter as User["role"]] || roleFilter, clear: () => setRoleFilter("all") })
  }
  if (statusFilter !== "all") {
    activeChips.push({ key: "status", label: statusFilter === "active" ? "Active" : "Inactive", clear: () => setStatusFilter("all") })
  }
  if (groupFilter !== "all") {
    activeChips.push({ key: "group", label: groupFilter, clear: () => setGroupFilter("all") })
  }
  if (organizationFilter !== "all") {
    activeChips.push({ key: "org", label: organizationNameById.get(organizationFilter) || "Organization", clear: () => setOrganizationFilter("all") })
  }
  if (lastActiveFilter !== "all") {
    activeChips.push({ key: "last", label: LAST_ACTIVE_LABELS[lastActiveFilter], clear: () => setLastActiveFilter("all") })
  }

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
        if (statusFilter === "active" && !entry.isActive) return false
        if (statusFilter === "inactive" && entry.isActive) return false
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
  }, [enrichedUsers, searchQuery, searchBy, roleFilter, statusFilter, groupFilter, organizationFilter, lastActiveFilter])

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
        environment_access: formData.environmentAccess as "both" | "live" | "training",
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
        environmentAccess: "both",
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

      <Tabs defaultValue="directory" className="space-y-6">
        {canViewActivity ? (
          <TabsList>
            <TabsTrigger value="directory">Directory</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="requests">Reset Requests</TabsTrigger>
          </TabsList>
        ) : null}
        <TabsContent value="directory" className="mt-0 space-y-6 focus-visible:outline-none">

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
        {summaryItems.map((item, index) => (
          <div key={item.label} className="flex items-center gap-5">
            {index > 0 ? <Separator orientation="vertical" className="h-4" /> : null}
            <span className="flex items-baseline gap-1.5">
              <span className={cn("text-base font-semibold tabular-nums", item.tone)}>{item.value}</span>
              <span className="text-muted-foreground">{item.label}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="users-search"
              placeholder="Search users…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={searchBy} onValueChange={(value) => setSearchBy(value as SearchBy)}>
            <SelectTrigger className="w-[7.5rem]">
              <SelectValue placeholder="Field" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">By name</SelectItem>
              <SelectItem value="email">By email</SelectItem>
              <SelectItem value="username">By username</SelectItem>
            </SelectContent>
          </Select>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-36">
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

          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                More
                {advancedFilterCount > 0 ? (
                  <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 justify-center px-1 text-[10px]">
                    {advancedFilterCount}
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Group</Label>
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

              <div className="space-y-1.5">
                <Label className="text-xs">Organization</Label>
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

              <div className="space-y-1.5">
                <Label className="text-xs">Last active</Label>
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
            </PopoverContent>
          </Popover>

          {canAdministerUsers ? (
            <Button variant="outline" className="gap-2" onClick={() => setIsGroupsOpen(true)}>
              <Settings2 className="h-4 w-4" />
              Groups
            </Button>
          ) : null}

          <span className="ml-auto text-xs text-muted-foreground">
            {totalUsers} of {stats.total}
          </span>
        </div>

        {activeChips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((chip) => (
              <Badge key={chip.key} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 font-normal">
                <span className="max-w-[16rem] truncate">{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.clear}
                  className="rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
                  aria-label="Remove filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearFilters}>
              Clear all
            </Button>
          </div>
        ) : null}
      </div>

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
                      className={cn("cursor-pointer py-2", !entry.isActive && "opacity-60")}
                      onClick={() => setSelectedUser(entry.user)}
                    >
                      <TableCell className="whitespace-normal">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-medium text-foreground">{entry.displayName}</p>
                              {!entry.isActive ? (
                                <Badge variant="outline" className="shrink-0 border-destructive/40 px-1.5 py-0 text-[10px] text-destructive">
                                  Inactive
                                </Badge>
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{entry.user.email}</p>
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
        </TabsContent>
        {canViewActivity ? (
          <TabsContent value="activity" className="mt-0 focus-visible:outline-none">
            <UserActivityPanel />
          </TabsContent>
        ) : null}
        {canViewActivity ? (
          <TabsContent value="requests" className="mt-0 focus-visible:outline-none">
            <PasswordResetRequestsPanel />
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        if (!open) {
          setIsCreateOpen(false)
          setCreateStep(1)
          setFormData({
            username: "",
            firstName: "",
            lastName: "",
            email: "",
            role: "",
            environmentAccess: "both",
            organizationId: "",
            password: "",
            passwordConfirm: "",
            permissions: [],
            groups: [],
          })
        } else {
          setIsCreateOpen(true)
        }
      }}>
        <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add User — Step {createStep} of 4</DialogTitle>
            <DialogDescription>
              {createStep === 1 && "Enter basic information"}
              {createStep === 2 && "Set role and organization"}
              {createStep === 3 && "Assign groups and permissions"}
              {createStep === 4 && "Review and create"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Step {createStep} of 4</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition",
                      step <= createStep ? "bg-primary" : "bg-muted"
                    )}
                  />
                ))}
              </div>
            </div>

            <form
              className="max-h-[calc(90vh-16rem)] space-y-4 overflow-y-auto pr-1"
              onSubmit={(e) => {
                e.preventDefault()
                if (createStep === 4) {
                  handleCreate()
                } else {
                  setCreateStep(createStep + 1)
                }
              }}
            >
              {createStep === 1 && (
                <>
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
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="password">Password *</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="passwordConfirm">Confirm Password *</Label>
                      <Input
                        id="passwordConfirm"
                        type="password"
                        placeholder="••••••••"
                        value={formData.passwordConfirm}
                        onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}

              {createStep === 2 && (
                <>
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
                    <Label htmlFor="environmentAccess">Environment access</Label>
                    <Select
                      value={formData.environmentAccess}
                      onValueChange={(value) => setFormData({ ...formData, environmentAccess: value })}
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
                    <Label htmlFor="organization">Organization</Label>
                    <OrganizationSelect
                      organizations={organizations}
                      value={formData.organizationId}
                      onChange={(value) => setFormData({ ...formData, organizationId: value })}
                      placeholder="Select organization"
                    />
                  </div>
                </>
              )}

              {createStep === 3 && (
                <>
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
                </>
              )}

              {createStep === 4 && (
                <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Username:</span>
                      <span className="font-medium">{formData.username}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email:</span>
                      <span className="font-medium">{formData.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name:</span>
                      <span className="font-medium">{formData.firstName} {formData.lastName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Role:</span>
                      <span className="font-medium">{USER_ROLE_LABELS[formData.role as User["role"]]}</span>
                    </div>
                    {formData.organizationId && formData.organizationId !== "all" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Organization:</span>
                        <span className="font-medium">
                          {organizations.find((o) => String(o.id) === formData.organizationId)?.name}
                        </span>
                      </div>
                    )}
                    {formData.groups.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Groups:</span>
                        <span className="font-medium">{formData.groups.length} group(s)</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <DialogFooter className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (createStep === 1) {
                      setIsCreateOpen(false)
                      setCreateStep(1)
                      setFormData({
                        username: "",
                        firstName: "",
                        lastName: "",
                        email: "",
                        role: "",
                        environmentAccess: "both",
                        organizationId: "",
                        password: "",
                        passwordConfirm: "",
                        permissions: [],
                        groups: [],
                      })
                    } else {
                      setCreateStep(createStep - 1)
                    }
                  }}
                >
                  {createStep === 1 ? "Cancel" : "Back"}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : createStep === 4 ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <>Next</>
                  )}
                  {isSubmitting ? "Creating..." : createStep === 4 ? "Create User" : "Next"}
                </Button>
              </DialogFooter>
            </form>
          </div>
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

      <Dialog open={isGroupsOpen} onOpenChange={setIsGroupsOpen}>
        <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage User Groups</DialogTitle>
            <DialogDescription>
              Create reusable groups to organize users. Built-in groups can’t be removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="New group name (e.g. Coordinators)"
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
              <Button type="button" onClick={handleAddGroup} className="shrink-0">
                <Plus className="mr-1.5 h-4 w-4" />
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {groupCatalog.length === 0 ? (
                <span className="text-sm text-muted-foreground">No groups created yet.</span>
              ) : (
                groupCatalog.map((group) => {
                  const removable = !BASE_GROUP_OPTIONS.includes(group)
                  return (
                    <Badge
                      key={group}
                      variant="secondary"
                      className={cn("gap-1 py-1 pl-2.5", removable ? "pr-1" : "pr-2.5")}
                    >
                      {group}
                      {removable ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveGroup(group)}
                          className="rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-destructive"
                          aria-label={`Remove ${group}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </Badge>
                  )
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsGroupsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
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

      {selectedUser && (
        <Sheet open={!!selectedUser} onOpenChange={(open) => {
          if (!open) setSelectedUser(null)
        }}>
          <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
            <SheetHeader>
              <div className="flex items-center gap-4 pb-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="text-lg font-semibold">
                    {`${(selectedUser.firstName?.[0] || "").toUpperCase()}${(selectedUser.lastName?.[0] || "").toUpperCase()}` || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <SheetTitle className="text-base">{selectedUser.firstName || ""} {selectedUser.lastName || ""}</SheetTitle>
                  <p className="text-xs text-muted-foreground">@{normalizeUsername(selectedUser)}</p>
                </div>
              </div>
            </SheetHeader>

            {(() => {
              const userIsActive =
                (selectedUser as User & { is_active?: boolean }).is_active ?? true

              return (
                <>
                  <div className="flex-1 overflow-y-auto space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Status</p>
                      <Badge variant={userIsActive ? "default" : "secondary"}>
                        {userIsActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Email</p>
                        <p className="text-sm break-all">{selectedUser.email}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Role</p>
                        <Badge variant="secondary" className={USER_ROLE_COLORS[selectedUser.role] || ""}>
                          <Shield className="mr-1 h-3 w-3" />
                          {USER_ROLE_LABELS[selectedUser.role]}
                        </Badge>
                      </div>
                      {selectedUser.organizationId ? (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Organization</p>
                          <p className="text-sm">{organizationNameById.get(String(selectedUser.organizationId)) || "—"}</p>
                        </div>
                      ) : null}
                    </div>

                    {selectedUser.createdAt && (
                      <>
                        <Separator />
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Created</p>
                          <p className="text-sm">{new Date(selectedUser.createdAt).toLocaleDateString()}</p>
                        </div>
                      </>
                    )}

                    {selectedUser.lastLogin && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Last Active</p>
                        <p className="text-sm">{new Date(selectedUser.lastLogin).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="flex flex-col gap-2 pt-4">
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => {
                        setSelectedUser(null)
                        router.push(`/users/${selectedUser.id}/edit`)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                    {canResetPasswords && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                          setSelectedUser(null)
                          handleResetPassword(selectedUser)
                        }}
                      >
                        <KeyRound className="h-4 w-4" />
                        Reset Password
                      </Button>
                    )}
                    {canActivateDeactivateUsers && (
                      <Button
                        variant="outline"
                        className={cn("justify-start gap-2", !userIsActive && "text-green-600 hover:text-green-700")}
                        onClick={() => {
                          setConfirmAction({
                            title: userIsActive ? "Deactivate User" : "Activate User",
                            description: userIsActive
                              ? `Are you sure you want to deactivate ${selectedUser.firstName}?`
                              : `Are you sure you want to activate ${selectedUser.firstName}?`,
                            destructive: userIsActive,
                            onConfirm: async () => {
                              try {
                                await usersService.update(Number(selectedUser.id), { is_active: !userIsActive })
                                toast({
                                  title: "Success",
                                  description: `User ${userIsActive ? "deactivated" : "activated"} successfully.`,
                                })
                                setSelectedUser(null)
                                mutate()
                              } catch (err) {
                                throw err
                              }
                            },
                          })
                        }}
                      >
                        <Power className="h-4 w-4" />
                        {userIsActive ? "Deactivate" : "Activate"}
                      </Button>
                    )}
                  </div>
                </>
              )
            })()}
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
