"use client"

import React, { useState, useMemo } from "react"
import Image from "next/image"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { useOrganizationTree } from "@/lib/hooks/use-api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useSessionMode } from "@/lib/contexts/session-mode-context"
import { isSharedLiveRoute } from "@/lib/training-mode"
import { useModulePermissions } from "@/lib/permissions/module-permissions"
import { moduleForPath } from "@/lib/permissions/module-routes"
import {
  LayoutDashboard,
  Building2,
  Users,
  FolderKanban,
  Target,
  UserSquare2,
  Table2,
  CalendarDays,
  Share2,
  FileBarChart,
  Settings,
  ServerCog,
  LogOut,
  ChevronDown,
  Upload,
  Loader2,
  FileSpreadsheet,
  Building,
  BookOpen,
} from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

interface NavItemProps {
  title: string
  href: string
  icon: React.ReactNode
  badge?: number
  isActive: boolean
  subItems?: SidebarSubItem[]
}

interface SidebarSubItem {
  title: string
  href: string
  subItems?: SidebarSubItem[]
}

const hasActiveDescendant = (
  item: SidebarSubItem,
  isChildActive: (childHref: string) => boolean,
): boolean => {
  if (isChildActive(item.href)) return true
  if (!item.subItems?.length) return false
  return item.subItems.some((child) => hasActiveDescendant(child, isChildActive))
}

interface NestedSubItemProps {
  item: SidebarSubItem
  isChildActive: (childHref: string) => boolean
  level?: number
}

function NestedSubItem({ item, isChildActive, level = 1 }: NestedSubItemProps) {
  const hasChildren = !!item.subItems?.length
  const isItemActive = isChildActive(item.href)
  const hasActiveChild = hasChildren && item.subItems!.some((child) => hasActiveDescendant(child, isChildActive))
  const [isOpen, setIsOpen] = useState(hasActiveChild)

  if (!hasChildren) {
    return (
      <a
        href={item.href}
        className={cn(
          "block rounded-lg px-3 py-2 text-sm transition-colors",
          level === 1 ? "ml-0" : "ml-4",
          isItemActive
            ? "bg-primary/10 text-primary"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        {item.title}
      </a>
    )
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn("flex items-center gap-1", level > 1 && "ml-4")}>
        <a
          href={item.href}
          className={cn(
            "flex-1 rounded-lg px-3 py-2 text-sm transition-colors",
            isItemActive
              ? "bg-primary/10 text-primary"
              : hasActiveChild
                ? "text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          {item.title}
        </a>
        <CollapsibleTrigger className="rounded-md p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="space-y-1 pl-4 pt-1">
        {item.subItems!.map((child) => (
          <NestedSubItem key={`${child.href}-${child.title}`} item={child} isChildActive={isChildActive} level={level + 1} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function NavItem({ title, href, icon, badge, isActive, subItems }: NavItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const safePathname = pathname || ""
  const currentQuery = searchParams.toString()
  const currentFullPath = `${safePathname}${currentQuery ? `?${currentQuery}` : ""}`
  const isChildActive = (childHref: string) => {
    if (childHref.includes("?")) {
      return currentFullPath === childHref
    }
    return safePathname === childHref && !currentQuery
  }
  const hasActiveChild = !!subItems?.some((child) => isChildActive(child.href))

  if (subItems) {

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className={cn(
          "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          hasActiveChild
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}>
          <span className="flex items-center gap-3">
            {icon}
            <span>{title}</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-9 pt-1">
          {subItems.map((child) => (
            <NestedSubItem key={`${child.href}-${child.title}`} item={child} isChildActive={isChildActive} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <a
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      {icon}
      <span className="flex-1">{title}</span>
      {badge && badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
          {badge}
        </span>
      )}
    </a>
  )
}

function toTrainingHref(href: string, isTrainingMode: boolean): string {
  if (!isTrainingMode) return href
  const qIdx = href.indexOf("?")
  const path = qIdx >= 0 ? href.slice(0, qIdx) : href
  const query = qIdx >= 0 ? href.slice(qIdx) : ""
  if (isSharedLiveRoute(path)) return href
  return `/training${path}${query}`
}

function applyTrainingHrefs(
  items: typeof baseNavigation,
  isTrainingMode: boolean,
): typeof baseNavigation {
  return items.map((item) => ({
    ...item,
    href: toTrainingHref(item.href, isTrainingMode),
    children: item.children?.map((child) => ({
      ...child,
      href: toTrainingHref(child.href, isTrainingMode),
    })),
  }))
}

const baseNavigation: Array<{ title: string; href: string; icon: React.ReactNode; badge?: number; children?: { title: string; href: string }[] }> = [
  { title: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { title: "Organizations", href: "/organizations", icon: <Building2 className="h-4 w-4" /> },
  { title: "Users", href: "/users", icon: <Users className="h-4 w-4" /> },
  {
    title: "Projects",
    href: "/projects",
    icon: <FolderKanban className="h-4 w-4" />,
    children: [
      { title: "All Projects", href: "/projects" },
      { title: "Tasks", href: "/projects/tasks" },
      { title: "Deadlines", href: "/projects/deadlines" },
    ],
  },
  {
    title: "Indicators",
    href: "/indicators",
    icon: <Target className="h-4 w-4" />,
    children: [
      { title: "All Indicators", href: "/indicators" },
      { title: "Assessments", href: "/indicators/assessments" },
    ],
  },
  {
    title: "Targets",
    href: "/targets/coordinators",
    icon: <Target className="h-4 w-4" />,
    children: [{ title: "Coordinator Targets", href: "/targets/coordinators" }],
  },
  {
    title: "Respondents",
    href: "/respondents",
    icon: <UserSquare2 className="h-4 w-4" />,
    children: [
      { title: "All Respondents", href: "/respondents" },
      { title: "Interactions", href: "/respondents/interactions" },
    ],
  },
  {
    title: "Aggregates",
    href: "/aggregates",
    icon: <Table2 className="h-4 w-4" />,
    children: [{ title: "All Aggregates", href: "/aggregates" }],
  },
  { title: "Events", href: "/events", icon: <CalendarDays className="h-4 w-4" /> },
  { title: "Social Media", href: "/social", icon: <Share2 className="h-4 w-4" /> },
  { title: "Clients", href: "/clients", icon: <Building className="h-4 w-4" /> },
  { title: "Training Mode", href: "/login?mode=training", icon: <BookOpen className="h-4 w-4" /> },
  { title: "Batch Record", href: "/batch-record", icon: <FileSpreadsheet className="h-4 w-4" /> },
  {
    title: "Uploads",
    href: "/uploads",
    icon: <Upload className="h-4 w-4" />,
    children: [
      { title: "All Uploads", href: "/uploads" },
      { title: "All Imports", href: "/uploads/imports" },
    ],
  },
  {
    title: "Analysis",
    href: "/analysis",
    icon: <FileBarChart className="h-4 w-4" />,
    children: [
      { title: "Analytics", href: "/analysis/reports" },
      { title: "Dashboards", href: "/analysis/dashboards" },
    ],
  },
  {
    title: "Reports",
    href: "/funder-reports",
    icon: <FileBarChart className="h-4 w-4" />,
    children: [
      { title: "Generate Report", href: "/funder-reports" },
      { title: "Report Builder", href: "/funder-reports/builder" },
    ],
  },
  {
    title: "Reporting Periods",
    href: "/reporting-periods",
    icon: <CalendarDays className="h-4 w-4" />,
  },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { data: organizationTree } = useOrganizationTree()
  const { logout, user } = useAuth()
  const { isTrainingMode } = useSessionMode()
  const { canView } = useModulePermissions()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const canViewSystemStatus = user?.role === "admin"
  // A nav entry is visible when its route has no module gate, or the user may
  // view that module. (No-op for users an admin hasn't explicitly configured.)
  // Memoized on `canView` (stable per-user) so it isn't reallocated each render.
  const isNavVisible = useMemo(
    () => (href: string) => {
      const activeModule = moduleForPath(href)
      return !activeModule || canView(activeModule)
    },
    [canView],
  )

  // Rebuild the nav tree only when its real inputs change (org tree / mode),
  // not on every parent re-render (e.g. route changes, header counters, …).
  const navigation = useMemo(() => {
    const parentOrganizations = (organizationTree ?? [])
      .slice()
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))

    const aggregateChildren: SidebarSubItem[] = [
      { title: "All Aggregates", href: toTrainingHref("/aggregates", isTrainingMode) },
      ...parentOrganizations.map((parent) => ({
        title: String(parent.name || "Parent"),
        href: toTrainingHref(`/aggregates?orgId=${encodeURIComponent(String(parent.id))}`, isTrainingMode),
      })),
    ]

    return applyTrainingHrefs(
      baseNavigation.map((item) =>
        item.title === "Aggregates" ? { ...item, children: aggregateChildren } : item,
      ),
      isTrainingMode,
    )
  }, [organizationTree, isTrainingMode])

  // Filter to visible items (and visible children) once per permission/nav change.
  const visibleNavigation = useMemo(
    () =>
      navigation
        .filter((item) => isNavVisible(item.href))
        .map((item) => ({
          ...item,
          children: item.children?.filter((child) => isNavVisible(child.href)),
        })),
    [navigation, isNavVisible],
  )

  const handleSignOut = async () => {
    if (isSigningOut) return
    setIsSigningOut(true)
    try {
      await logout()
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-card">
          <Image
            src="/favicon.ico"
            alt="Sesigo"
            width={24}
            height={24}
            className="h-6 w-6"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-sidebar-foreground">Sesigo Data Portal</span>
          <span className="text-xs text-sidebar-foreground/60">Powered by BONASO</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleNavigation.map((item) => (
          <NavItem
            key={item.href}
            title={item.title}
            href={item.href}
            icon={item.icon}
            badge={item.badge}
            isActive={pathname === item.href || pathname?.startsWith(item.href + "/")}
            subItems={item.children}
          />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-sidebar-border p-3">
        {canViewSystemStatus && (
          <NavItem
            title="System Status"
            href="/system-status"
            icon={<ServerCog className="h-4 w-4" />}
            isActive={pathname === "/system-status"}
          />
        )}
        {isNavVisible("/settings") && (
          <NavItem
            title="Settings"
            href="/settings"
            icon={<Settings className="h-4 w-4" />}
            isActive={pathname === "/settings"}
          />
        )}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSigningOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          <span>{isSigningOut ? "Signing Out..." : "Sign Out"}</span>
        </button>
      </div>
    </aside>
  )
}

