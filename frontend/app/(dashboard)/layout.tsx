"use client"

import React, { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { AuthProvider, useAuth } from "@/lib/contexts/auth-context"
import { isPlatformAdmin } from "@/lib/permissions"
import { systemService } from "@/lib/api"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { AppHeader } from "@/components/layout/app-header"
import { SessionModeProvider, useSessionMode } from "@/lib/contexts/session-mode-context"
import { isTrainingMode, isSharedLiveRoute } from "@/lib/training-mode"
import { useModulePermissions } from "@/lib/permissions/module-permissions"
import { moduleForPath } from "@/lib/permissions/module-routes"
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
  const pathname = usePathname()
  const [showDisclaimerFromLogin, setShowDisclaimerFromLogin] = useState(() => {
    if (typeof window === "undefined") return false
    const shouldShow = sessionStorage.getItem("show_login_disclaimer") === "1"
    if (shouldShow) {
      sessionStorage.removeItem("show_login_disclaimer")
    }
    return shouldShow
  })
  const [dismissedPathname, setDismissedPathname] = useState<string | null>(null)

  const isDashboardHome = pathname === "/dashboard"
  const showDisclaimer =
    dismissedPathname !== pathname && (showDisclaimerFromLogin || isDashboardHome)

  const handleDisclaimerOpenChange = (open: boolean) => {
    if (open) {
      setDismissedPathname(null)
      return
    }
    setShowDisclaimerFromLogin(false)
    setDismissedPathname(pathname)
  }

  return (
    <div className="min-h-screen w-full min-w-0 max-w-full overflow-x-clip bg-background">
      <Dialog open={showDisclaimer} onOpenChange={handleDisclaimerOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-1/2 w-[calc(100vw-1rem)] max-w-[76rem] overflow-hidden border-0 bg-transparent p-0 shadow-none sm:w-[min(calc(100vw-2rem),76rem)]"
        >
          <DialogClose
            className="absolute right-5 top-5 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close confidentiality notice"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>

          <div className="w-full rounded-none border-[10px] border-border bg-card px-6 py-5 text-foreground shadow-[0_24px_60px_rgba(0,0,0,0.18)] sm:border-[12px] sm:px-12 sm:py-7 md:px-16 md:py-8">
          <DialogHeader className="mx-auto flex w-full max-w-[68rem] items-center space-y-3 text-center sm:space-y-4">
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Welcome to the Sesigo Data Portal
            </DialogTitle>
            <DialogDescription asChild className="text-muted-foreground">
              <div className="mx-auto flex w-full max-w-[62rem] flex-col items-center space-y-5 text-foreground">
                <p className="w-full text-justify text-sm leading-6 [text-wrap:pretty] sm:text-base">
                  Welcome to the Sesigo Data Portal, powered by BONASO. Please note that any information you see in this portal
                  is confidential, and may not be shared or distributed to anyone outside of your organization.
                  <strong className="font-bold text-foreground">
                    {" "}Any violations of client confidentiality is against the law and is punishable by fines
                    and/or jail time.
                  </strong>{" "}
                  By entering this portal, you agree to maintain confidentiality of all data you see here and
                  agree that you will not misuse any information here.
                </p>
                <p className="w-full text-justify text-sm leading-6 [text-wrap:pretty] sm:text-base">
                  Thank you for all the important work you do in the fight for a healthier Botswana!
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="mx-auto mt-5 flex w-full max-w-[62rem] justify-center">
            <Button
              onClick={() => handleDisclaimerOpenChange(false)}
              className="min-h-11 w-full whitespace-normal rounded-none bg-primary px-5 py-2.5 text-center text-sm font-semibold leading-5 text-primary-foreground shadow-none hover:bg-primary/90"
            >
              I understand, and will not misuse any data I access on this portal.
            </Button>
          </div>
          </div>
        </DialogContent>
      </Dialog>

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
  const { isAuthenticated, isLoading } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login")
    }
  }, [isAuthenticated, isLoading, router])

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
    // Shared/global modules (orgs, users, indicators, clients, settings, …) have
    // no /training mirror; redirecting them would 404. Keep them on the live path.
    if (isTrainingSession && !path.startsWith("/training") && !isSharedLiveRoute(path)) {
      setTrainingRedirectPending(true)
      router.replace(`/training${path}`)
    } else {
      setTrainingRedirectPending(false)
    }
  }, [isAuthenticated, pathname, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // While the redirect is happening, don't render the dashboard shell.
  if (!isAuthenticated) return null

  return (
    <ModuleRouteGuard>
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
  if (activeModule && !canView(activeModule)) {
    return (
      <div className="min-h-[60vh] p-6">
        <NoAccessState
          title="Access denied"
          description="You don't have permission to view this section. Contact an administrator if you believe this is a mistake."
          action={
            <Button variant="outline" onClick={() => router.replace("/dashboard")}>
              Go to Dashboard
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
