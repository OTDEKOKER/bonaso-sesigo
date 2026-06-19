"use client"

import { useParams, useRouter } from "next/navigation"
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/shared/page-header"
import QuarterlyTargetsSection from "@/components/indicators/quarterly-targets-section"
import { IndicatorAliasesCard } from "@/components/indicators/indicator-aliases-card"
import { useIndicator } from "@/lib/hooks/use-api"
import { useSmartBack } from "@/lib/hooks/use-smart-back"
import { isIndicatorEffectivelyActive } from "@/lib/indicators/activation"
import { getIndicatorCategoryLabel } from "@/lib/indicators/categories"

export default function IndicatorDetailPage() {
  const router = useRouter()
  const handleBack = useSmartBack("/indicators")
  const params = useParams()
  const id = Number(params?.id)

  const { data: indicator, isLoading, error } = useIndicator(Number.isFinite(id) ? id : null)

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !indicator) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Indicator not found</p>
        <Button onClick={handleBack}>Back to Indicators</Button>
      </div>
    )
  }

  const displayName = indicator.short_name?.trim() || indicator.name
  const isActive = isIndicatorEffectivelyActive(indicator)

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayName}
        description={`Indicator code: ${indicator.code}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Indicators", href: "/indicators" },
          { label: displayName },
        ]}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => router.push(`/indicators/${indicator.id}/edit`)}>
              Edit Indicator
            </Button>
            <Button variant="outline" onClick={() => router.push(`/targets/coordinators?indicator=${indicator.id}`)}>
              Coordinator Targets
            </Button>
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Indicator Details</CardTitle>
          <CardDescription>View indicator metadata and configuration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{getIndicatorCategoryLabel(indicator.category)}</Badge>
            <Badge variant="secondary">{indicator.type.replace(/_/g, " ")}</Badge>
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "Active" : "Inactive"}
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="text-sm font-medium">{indicator.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Short Name</p>
              <p className="text-sm font-medium">{indicator.short_name || "—"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Code</p>
              <p className="text-sm font-medium">{indicator.code}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unit</p>
              <p className="text-sm font-medium">{indicator.unit || "—"}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-sm text-muted-foreground">Description</p>
              <p className="text-sm font-medium">{indicator.description || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-muted/20">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 text-primary" />
          <p>
            Coordinator portfolio targets are managed from the dedicated Coordinator Targets workspace. The section below
            shows generic read-only project-level targets only.
          </p>
        </CardContent>
      </Card>

      <IndicatorAliasesCard indicatorId={id} />

      <QuarterlyTargetsSection
        indicatorId={id}
        projectTargets={indicator.project_targets}
        editable={false}
      />
    </div>
  )
}
