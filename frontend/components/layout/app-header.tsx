"use client"

import { useMemo, useState } from "react"
import { Bell, Search, Menu, Settings2, MessageSquare, Megaphone, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useAuth } from "@/lib/contexts/auth-context"
import { notificationsService } from "@/lib/api"
import { useNotifications, useUnreadNotificationCount, useUnreadMessageCount, useOpenFlagCount } from "@/lib/hooks/use-api"
import { getUserRoleLabel } from "@/lib/roles"
import type { Notification } from "@/lib/types"
import { usePathname, useSearchParams } from "next/navigation"
import { ThemeToggle } from "@/components/layout/theme-toggle"

interface AppHeaderProps {
  onMenuClick?: () => void
}

interface HeaderSearchProps {
  initialValue: string
  onSubmit: (query: string) => void
}

function HeaderSearch({ initialValue, onSubmit }: HeaderSearchProps) {
  const [searchValue, setSearchValue] = useState(initialValue)

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedQuery = searchValue.trim()
    if (!trimmedQuery) return
    onSubmit(trimmedQuery)
  }

  return (
    <form onSubmit={handleSearchSubmit} className="relative hidden md:block">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search respondents, projects..."
        className="w-64 bg-secondary pl-9 lg:w-80"
        value={searchValue}
        onChange={(event) => setSearchValue(event.target.value)}
        aria-label="Search respondents, projects, organizations, and users"
      />
    </form>
  )
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user, logout } = useAuth()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [hasLoadedNotifications, setHasLoadedNotifications] = useState(false)
  const { data: unreadNotificationCountData, mutate: mutateUnreadNotificationCount } =
    useUnreadNotificationCount(true, {
      refreshInterval: 60_000,
    })
  const { data: unreadMessageCount } = useUnreadMessageCount()
  const { data: openFlagCount } = useOpenFlagCount()
  const { data: notificationsData, isLoading: notificationsLoading, mutate: mutateNotifications } =
    useNotifications(
      hasLoadedNotifications
        ? {
            page: "1",
            page_size: "5",
          }
        : null,
    )
  const currentUser = user
  const userRecord = (currentUser ?? {}) as Record<string, unknown>
  const firstName = String(
    (userRecord.firstName ?? userRecord.first_name ?? "") as string
  ).trim()
  const lastName = String(
    (userRecord.lastName ?? userRecord.last_name ?? "") as string
  ).trim()
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || String(currentUser?.email || "My Account")
  const initials = `${(firstName[0] || String(currentUser?.email || "U")[0] || "U").toUpperCase()}${(lastName[0] || "").toUpperCase()}`
  const searchQuery = pathname === "/search" ? (searchParams.get("q") ?? "") : ""

  const navigate = (href: string) => {
    if (typeof window === "undefined") return
    window.location.assign(href)
  }

  const handleLogout = async () => {
    await logout()
  }

  const handleOpenDashboardCustomize = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("bonaso:open-dashboard-customize"))
  }

  const recentNotifications = (notificationsData?.results || []).slice(0, 5)
  const fallbackUnreadCount = recentNotifications.filter((item) => !item.is_read).length
  const unreadNotificationCount = Number(unreadNotificationCountData ?? fallbackUnreadCount)
  const notificationCount = unreadNotificationCount

  const resolveNotificationLink = useMemo(
    () =>
      (item: Notification): string => {
        const rawLink = String(item.link || "").trim()
        if (rawLink) {
          if (rawLink.startsWith("http://") || rawLink.startsWith("https://") || rawLink.startsWith("/")) {
            return rawLink
          }
          return `/${rawLink.replace(/^\/+/, "")}`
        }

        const text = `${item.title || ""} ${item.content || ""}`.toLowerCase()
        if (text.includes("aggregate") || text.includes("review")) return "/aggregates"
        if (text.includes("flag")) return "/flags"
        if (text.includes("report")) return "/reports"
        if (text.includes("project") || text.includes("deadline")) return "/projects"
        if (text.includes("organization")) return "/organizations"
        if (text.includes("user")) return "/users"
        return "/settings?tab=notifications"
      },
    [],
  )

  const formatNotificationTime = (timestamp?: string) => {
    if (!timestamp) return "No timestamp"
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return "No timestamp"
    return date.toLocaleString()
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      {/* Left side */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="text-foreground"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle sidebar</span>
        </Button>

        {/* Search */}
        <HeaderSearch
          key={`${pathname}:${searchQuery}`}
          initialValue={searchQuery}
          onSubmit={(query) => navigate(`/search?q=${encodeURIComponent(query)}`)}
        />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {pathname === "/dashboard" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={handleOpenDashboardCustomize}
            aria-label="Customize Dashboard"
            title="Customize Dashboard"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        ) : null}

        {/* Messages */}
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => navigate("/messages")}
          aria-label="Messages"
          title="Messages"
        >
          <MessageSquare className="h-5 w-5" />
          {unreadMessageCount != null && unreadMessageCount > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
            </span>
          ) : null}
        </Button>

        {/* Announcements */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/announcements")}
          aria-label="Announcements"
          title="Announcements"
        >
          <Megaphone className="h-5 w-5" />
        </Button>

        {/* Flags */}
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => navigate("/flags")}
          aria-label="Flags"
          title="Flags"
        >
          <AlertTriangle className="h-5 w-5" />
          {openFlagCount != null && openFlagCount > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-medium text-white">
              {openFlagCount > 9 ? "9+" : openFlagCount}
            </span>

          ) : null}
        </Button>

        {/* Notifications */}
        <DropdownMenu
          open={notificationsOpen}
          onOpenChange={(open) => {
            setNotificationsOpen(open)
            if (open) {
              setHasLoadedNotifications(true)
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {notificationCount > 0 ? (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              ) : null}
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notificationsLoading ? (
              <DropdownMenuItem disabled className="py-3 text-sm text-muted-foreground">
                Loading notifications...
              </DropdownMenuItem>
            ) : recentNotifications.length === 0 ? (
              <DropdownMenuItem disabled className="py-3 text-sm text-muted-foreground">
                No notifications right now.
              </DropdownMenuItem>
            ) : (
              recentNotifications.map((item, index) => (
                <DropdownMenuItem
                  key={`${item.id}-${index}`}
                  className="flex flex-col items-start gap-1 py-3"
                  onClick={async () => {
                    if (!item.is_read) {
                      try {
                        await notificationsService.markRead(Number(item.id))
                      } catch {
                        // Continue navigation even if mark-read fails.
                      }
                      void mutateNotifications()
                      void mutateUnreadNotificationCount()
                    }
                    navigate(resolveNotificationLink(item))
                  }}
                >
                  <span className="text-sm font-medium">
                    {item.title || "System notification"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.content}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatNotificationTime(item.created_at)}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="justify-center text-primary"
              onClick={() => navigate("/settings?tab=notifications")}
            >
              View all notifications
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start text-left md:flex">
                <span className="text-sm font-medium">
                  {currentUser ? displayName : "My Account"}
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  {currentUser ? getUserRoleLabel(currentUser.role) : "user"}
                </span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => currentUser && navigate(`/users/${currentUser.id}`)}
              disabled={!currentUser}
            >
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => currentUser && navigate(`/users/${currentUser.id}#activity`)}
              disabled={!currentUser}
            >
              Activity Log
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleLogout}>
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
