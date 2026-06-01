import Link from "next/link"
import {
  ArrowLeft,
  Clock3,
  Mail,
  RefreshCcw,
  ShieldAlert,
  Wrench,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface MaintenanceScreenProps {
  className?: string
  title?: string
  description?: string
  notice?: string
  statusLabel?: string
  expectedResolution?: string
  updatedAt?: string
  supportEmail?: string
  supportHref?: string
  homeHref?: string
  homeLabel?: string
  fullscreen?: boolean
}

const maintenanceChecks = [
  {
    title: "Platform updates",
    description: "Core services are being updated and verified before access resumes.",
    icon: Wrench,
  },
  {
    title: "Sync protection",
    description: "Background checks are running to keep saved data and queued changes safe.",
    icon: ShieldAlert,
  },
  {
    title: "Recovery monitoring",
    description: "We will reopen access as soon as performance and stability checks pass.",
    icon: RefreshCcw,
  },
]

export function MaintenanceScreen({
  className,
  title = "BONASO is under maintenance",
  description = "The portal is temporarily unavailable while we apply updates and confirm that core services are healthy. Access will reopen as soon as maintenance is complete.",
  notice = "Please avoid submitting new records until the system is back online. Previously saved data and queued changes should remain intact.",
  statusLabel = "Scheduled maintenance",
  expectedResolution = "Service will return as soon as validation checks are complete.",
  updatedAt,
  supportEmail = "info@bonaso.org",
  supportHref,
  homeHref = "/dashboard",
  homeLabel = "Back to dashboard",
  fullscreen = true,
}: MaintenanceScreenProps) {
  const resolvedSupportHref =
    supportHref ?? (supportEmail ? `mailto:${supportEmail}` : undefined)

  return (
    <section
      className={cn(
        "relative isolate overflow-hidden bg-background px-4 py-10 sm:px-6 lg:px-8",
        fullscreen ? "min-h-[100svh]" : "min-h-[32rem]",
        className,
      )}
    >
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(28,231,131,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(15,169,104,0.16),transparent_30%)]" />
      <div className="absolute left-1/2 top-16 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 p-8 shadow-xl shadow-primary/5 backdrop-blur sm:p-10">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-[var(--green-light)] to-primary" />

          <Badge variant="secondary" className="gap-2 rounded-full px-3 py-1">
            <ShieldAlert className="size-3.5" />
            {statusLabel}
          </Badge>

          <div className="mt-6 max-w-2xl space-y-4">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {title}
            </h1>
            <p className="text-base leading-7 text-muted-foreground sm:text-lg">
              {description}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {homeHref ? (
              <Button asChild size="lg">
                <Link href={homeHref}>
                  <ArrowLeft className="size-4" />
                  {homeLabel}
                </Link>
              </Button>
            ) : null}
            {resolvedSupportHref ? (
              <Button asChild size="lg" variant="outline">
                <Link href={resolvedSupportHref}>
                  <Mail className="size-4" />
                  Contact support
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="mt-10 rounded-2xl border border-border/70 bg-background/80 p-5">
            <p className="text-sm font-medium text-foreground">What to expect</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{notice}</p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {maintenanceChecks.map(({ title: checkTitle, description: checkDescription, icon: Icon }) => (
              <div
                key={checkTitle}
                className="rounded-2xl border border-border/70 bg-background/70 p-5"
              >
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-4 text-sm font-semibold text-foreground">{checkTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {checkDescription}
                </p>
              </div>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden rounded-[2rem] border-border/70 bg-card/95 py-0 shadow-xl shadow-primary/5">
          <CardContent className="space-y-6 p-0">
            <div className="border-b border-border/70 bg-muted/40 px-6 py-6">
              <p className="text-sm font-medium text-muted-foreground">Maintenance status</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                In progress
              </p>
            </div>

            <div className="space-y-4 px-6 pb-6">
              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 size-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Estimated restoration</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {expectedResolution}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <div className="flex items-start gap-3">
                  <RefreshCcw className="mt-0.5 size-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Recommended action</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Please check back shortly and refresh the page once maintenance ends.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 size-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Support contact</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {supportEmail || "Support details will be shared by the BONASO team."}
                    </p>
                  </div>
                </div>
              </div>

              {updatedAt ? (
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                  Last updated {updatedAt}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
