"use client"

import React, { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { AuthProvider, useAuth } from "@/lib/contexts/auth-context"
import { isPlatformAdmin } from "@/lib/permissions"
import { systemService } from "@/lib/api"
import { cn } from "@/lib/utils"
import { KeyRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfidentialityGate } from "@/components/auth/confidentiality-gate"
import { PasswordExpiryGate } from "@/components/auth/password-expiry-gate"
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { AppHeader } from "@/components/layout/app-header"
import { IdleLogout } from "@/components/auth/idle-logout"
import { SessionModeProvider, useSessionMode } from "@/lib/contexts/session-mode-context"
import { isTrainingMode, isSharedLiveRoute } from "@/lib/training-mode"
import { useModulePermissions } from "@/lib/permissions/module-permissions"
import { firstAccessibleRoute, moduleForPath } from "@/lib/permissions/module-routes"
import { NoAccessState } from "@/components/shared/ux-states"

function TrainingModeBanner() {
  const { isTrainingMode } = useSessionMode()
  if (!isTrainingMode) return null
  return (
    <div className="flex items-center gap-3 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-900">
      <span>⚠</span>
      <span>SESIGO TRAINING MODE — DEMO DATA ONLY — NOT FOR OFFICIAL REPORTING</span>
    </div>
  )
}

function BackupReminderBanner() {
  const { user } = useAuth()
  const { isTrainingMode } = useSessionMode()
  const [due, setDue] = useState<null | { level: "amber" | "red"; message: string | null }>(null)

  const isAdmin = isPlatformAdmin(user)

  useEffect(() => {
    // Admin-only compliance nudge; never in training mode (live data only).
    if (!isAdmin || isTrainingMode) {
      setDue(null)
      return
    }
    let cancelled = false
    systemService
      .getBackupStatus()
      .then((status) => {
        if (cancelled) return
        if (status.download.due && status.download.level !== "green") {
          setDue({ level: status.download.level, message: status.download.message })
        } else {
          setDue(null)
        }
      })
      .catch(() => setDue(null))
    return () => {
      cancelled = true
    }
  }, [isAdmin, isTrainingMode])

  if (!due) return null
  const critical = due.level === "red"
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 px-4 py-2 text-sm font-semibold",
        critical ? "bg-destructive text-destructive-foreground" : "bg-amber-400 text-amber-900",
      )}
    >
      <span>⚠</span>
      <span>
        {critical
          ? "No backup has been downloaded in over 14 days."
          : "Weekly backup download is due. Download latest backup now."}
      </span>
      <Link href="/system-status" className="underline underline-offset-2">
        Go to System Status
      </Link>
    </div>
  )
}

function PasswordExpiryBanner() {
  const { user } = useAuth()
  const [changeOpen, setChangeOpen] = useState(false)
  const ps = user?.password_status

  // Only nudge before expiry: enabled, not yet expired (the gate handles that),
  // and within the warning window. days_remaining can be 0 (expires today).
  const show =
    !!ps &&
    ps.expiry_enabled &&
    !ps.expired &&
    typeof ps.days_remaining === "number" &&
    ps.days_remaining <= (ps.warn_days ?? 14)

  if (!show) return null
  const days = ps!.days_remaining as number
  const when = days <= 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-900">
        <KeyRound className="h-4 w-4" />
        <span>Your password expires {when}. Change it now to avoid being locked out.</span>
        <button
          onClick={() => setChangeOpen(true)}
          className="underline underline-offset-2 hover:opacity-80"
        >
          Change password
        </button>
      </div>
      <ChangePasswordDialog open={changeOpen} onOpenChange={setChangeOpen} />
    </>
  )
}

function DashboardShell({
  children,
  sidebarOpen,
  setSidebarOpen,
  desktopSidebarOpen,
  setDesktopSidebarOpen,
}: {
  children: React.ReactNode
  sidebarOpen: boolean
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
  desktopSidebarOpen: boolean
  setDesktopSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    <div className="min-h-screen w-full min-w-0 max-w-full overflow-x-clip bg-background">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 ease-in-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <AppSidebar />
        <button
          className="absolute right-2 top-4 rounded-lg p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
          title="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Desktop sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden transition-all duration-200 ease-in-out lg:block",
          desktopSidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0 pointer-events-none",
        )}
      >
        <AppSidebar />
      </div>

      {/* Main content */}
      <div
        className={cn(
          // overflow-x-clip (not -hidden) prevents horizontal overflow WITHOUT
          // establishing a scroll container, so the sticky AppHeader and any
          // sticky module filter bars below it keep working against the viewport.
          "min-w-0 flex-1 w-full max-w-full overflow-x-clip transition-[padding] duration-200 ease-in-out",
          desktopSidebarOpen ? "lg:pl-64" : "lg:pl-0",
        )}
      >
        <AppHeader
          onMenuClick={() => {
            if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
              setDesktopSidebarOpen((value) => !value)
              return
            }
            setSidebarOpen(true)
          }}
        />
        <TrainingModeBanner />
        <BackupReminderBanner />
        <PasswordExpiryBanner />
        <main className="min-h-[calc(100vh-var(--app-header-height))] min-w-0 w-full max-w-full overflow-x-clip p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, isLoading, hasRevalidated, accessLoadFailed, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)

  useEffect(() => {
    // Don't redirect while showing the access-load failure screen: there the
    // token is still valid and the user can retry, so bouncing to /login would
    // be wrong.
    if (!isLoading && !isAuthenticated && !accessLoadFailed) {
      router.replace("/login")
    }
  }, [isAuthenticated, isLoading, accessLoadFailed, router])

  // Training-session guard: if the user logged in through Training Mode,
  // any live route they visit must redirect them to the /training equivalent.
  // This prevents training-session users from accidentally reading live data
  // by typing /dashboard directly. The backend also enforces the filter via
  // apply_training_filter, but an extra frontend guard improves UX clarity.
  // Tracks the window between deciding to redirect a training session off a
  // live route and the route actually changing. While true we must NOT render
  // the live page, otherwise its data fetches fire (against live data) before
  // the redirect lands.
  const [trainingRedirectPending, setTrainingRedirectPending] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!isAuthenticated) return
    const isTrainingSession = isTrainingMode()
    const path = pathname || ""
    // CSO Mapping is a live-only module (real submissions / personal data) with no
    // training mirror. A training session must never reach a live /cso-mapping page
    // (it would render live data) nor a /training/cso-mapping-* path (which 404s).
    // Bounce it to the training dashboard instead — the backend also denies these
    // endpoints in training mode.
    if (isTrainingSession && /^\/(training\/)?cso-mapping/.test(path)) {
      setTrainingRedirectPending(true)
      router.replace("/training/dashboard")
      return
    }
    // Shared/global modules (orgs, users, indicators, clients, settings, …) have
    // no /training mirror; redirecting them would 404. Keep them on the live path.
    if (isTrainingSession && !path.startsWith("/training") && !isSharedLiveRoute(path)) {
      setTrainingRedirectPending(true)
      router.replace(`/training${path}`)
    } else {
      setTrainingRedirectPending(false)
    }
  }, [isAuthenticated, pathname, router])

  // Hard failure: no cached session AND the profile/permission fetch failed (or
  // timed out — see the auth-context watchdog). The token is still valid, so this
  // is a recoverable network/server problem: give the user a clear message and
  // two concrete actions instead of a blank shell or an endless spinner.
  if (accessLoadFailed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-base font-semibold text-foreground">
            Unable to verify your session
          </p>
          <p className="text-sm text-muted-foreground">
            The server may be temporarily unavailable or your connection dropped.
            Your session is still active — retry, or return to the login screen.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Retry</Button>
            <Button variant="outline" onClick={() => logout()}>
              Return to login
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="text-sm text-muted-foreground">Loading your access…</div>
      </div>
    )
  }

  // While the redirect is happening, don't render the dashboard shell.
  if (!isAuthenticated) return null

  // Mandatory confidentiality gate: block EVERY protected page until the user
  // accepts the current notice version. Rendering only the gate here means the
  // shell and page children never mount, so a refresh, a direct URL, the back
  // button or any other protected route cannot bypass it — they all resolve
  // through this layout and hit the same check.
  //
  // `ackUnknown` covers a returning session hydrated from the cached user (which
  // predates this field): show the gate while the fresh /me is still in flight
  // rather than briefly flashing the dashboard. Once /me has resolved
  // (hasRevalidated) an absent block means the backend has no gate → fail OPEN,
  // so a wrong deploy order can never permanently lock users out.
  const ackUnknown = user?.confidentiality === undefined
  const needsAck = user?.confidentiality?.needs_acknowledgement === true
  if (needsAck || (ackUnknown && !hasRevalidated)) {
    return <ConfidentialityGate />
  }

  // Mandatory DPA password-expiry gate: block every protected page until the
  // user sets a new password. Same in-place render as the confidentiality gate,
  // so the shell and page children never mount while the password is expired.
  if (user?.password_status?.expired) {
    return <PasswordExpiryGate />
  }

  return (
    <ModuleRouteGuard>
      <IdleLogout />
      <DashboardShell
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        desktopSidebarOpen={desktopSidebarOpen}
        setDesktopSidebarOpen={setDesktopSidebarOpen}
      >
        {trainingRedirectPending ? (
          <div className="min-h-screen bg-background p-6">
            <div className="text-sm text-muted-foreground">Switching to Sesigo Training Mode…</div>
          </div>
        ) : (
          children
        )}
      </DashboardShell>
    </ModuleRouteGuard>
  )
}

/**
 * Centralized module route guard (granular permissions). When an admin has
 * explicitly configured the current user and they lack `view` on the module for
 * this route, show "Access denied" instead of the page. The backend still
 * enforces every API — this prevents the page content/data fetches from
 * rendering. No-op for admins and un-configured users.
 */
function ModuleRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { canView } = useModulePermissions()
  const activeModule = moduleForPath(pathname)
  const denied = Boolean(activeModule && !canView(activeModule))
  // Everyone is landed on /dashboard after login. A user restricted away from it
  // (e.g. granted only the CSO Mapping module) would otherwise dead-end on
  // "Access denied" — send them to their first accessible page instead.
  const landing = firstAccessibleRoute(canView)
  const isDefaultLanding =
    pathname === "/dashboard" || pathname === "/training/dashboard"
  useEffect(() => {
    if (denied && isDefaultLanding && landing !== pathname) {
      router.replace(landing)
    }
  }, [denied, isDefaultLanding, landing, pathname, router])

  if (denied) {
    // Redirecting the default landing away — render a brief placeholder.
    if (isDefaultLanding) {
      return <div className="min-h-[60vh] p-6 text-sm text-muted-foreground">Loading…</div>
    }
    return (
      <div className="min-h-[60vh] p-6">
        <NoAccessState
          title="Access denied"
          description="You don't have permission to view this section. Contact an administrator if you believe this is a mistake."
          action={
            <Button variant="outline" onClick={() => router.replace(landing)}>
              Go to your home page
            </Button>
          }
        />
      </div>
    )
  }
  return <>{children}</>
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <SessionModeProvider>
        <DashboardLayoutContent>{children}</DashboardLayoutContent>
      </SessionModeProvider>
    </AuthProvider>
  )
}
