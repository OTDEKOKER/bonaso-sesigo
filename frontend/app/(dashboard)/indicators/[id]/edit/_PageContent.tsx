"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { mutate as mutateCache } from "swr"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

import { PageHeader } from "@/components/shared/page-header"
import DisaggregationConfigEditor from "@/components/indicators/disaggregation-config-editor"
import QuarterlyTargetsSection from "@/components/indicators/quarterly-targets-section"

import { indicatorsService } from "@/lib/api"
import type { ApiError, UpdateIndicatorRequest } from "@/lib/api"
import { useAllIndicators, useAllProjectDetails, useIndicator } from "@/lib/hooks/use-api"
import type { Indicator } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { useSmartBack } from "@/lib/hooks/use-smart-back"
import {
  createEmptyDisaggregationConfig,
  normalizeAggregateDisaggregationConfig,
  type AggregateDisaggregationConfig,
} from "@/lib/indicators/disaggregation-presets"
import {
  INDICATOR_CATEGORY_OPTIONS,
  getIndicatorCategoryLabel,
} from "@/lib/indicators/categories"
import {
  canIndicatorBeActive,
  getIndicatorOrganizationIds,
} from "@/lib/indicators/activation"

type FormDataState = {
  name: string
  short_name: string
  code: string
  description: string
  category: string
  type: string
  unit: string
  options: string
  disaggregation_config: AggregateDisaggregationConfig
  denominator_indicator: number | null
  is_active: boolean
}

const initialFormData: FormDataState = {
  name: "",
  short_name: "",
  code: "",
  description: "",
  category: "",
  type: "",
  unit: "",
  options: "",
  disaggregation_config: createEmptyDisaggregationConfig(),
  denominator_indicator: null,
  is_active: true,
}

export default function IndicatorEditPage() {
  const router = useRouter()
  const { toast } = useToast()
  const params = useParams()

  const rawId = params?.id
  const id = Number(Array.isArray(rawId) ? rawId[0] : rawId)
  const isValidId = Number.isFinite(id)
  const handleBack = useSmartBack(isValidId ? `/indicators/${id}` : "/indicators")

  const { data: indicator, isLoading, error, mutate } = useIndicator(isValidId ? id : null)
  const { data: allIndicatorsData } = useAllIndicators()
  const allIndicators = allIndicatorsData?.results ?? []
  const { data: projectsData } = useAllProjectDetails()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<FormDataState>(initialFormData)

  useEffect(() => {
    if (!indicator) return

    setFormData({
      name: indicator.name || "",
      short_name: indicator.short_name || "",
      code: indicator.code || "",
      description: indicator.description || "",
      category: indicator.category || "",
      type: indicator.type || "",
      unit: indicator.unit || "",
      options: Array.isArray(indicator.options)
        ? indicator.options
            .map((opt) => (typeof opt === "string" ? opt : opt?.label || opt?.value || ""))
            .filter(Boolean)
            .join(", ")
        : "",
      disaggregation_config: normalizeAggregateDisaggregationConfig(
        indicator.aggregate_disaggregation_config,
        indicator.sub_labels,
      ),
      denominator_indicator: indicator.denominator_indicator ?? null,
      is_active: indicator.is_active ?? true,
    })
  }, [indicator])

  const updateField = <K extends keyof FormDataState>(field: K, value: FormDataState[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const parsedOptions = useMemo(() => {
    return formData.options
      .split(",")
      .map((opt) => opt.trim())
      .filter(Boolean)
  }, [formData.options])

  const requiresOptions = formData.type === "select" || formData.type === "multiselect"
  const projects = useMemo(() => projectsData?.results || [], [projectsData?.results])
  const assignedProjectIds = useMemo(() => {
    if (!indicator) return new Set<string>()

    const next = new Set<string>()

    projects.forEach((project) => {
      const isIndicatorAssigned =
        (project.project_indicators || []).some((entry) => String(entry.indicator) === String(indicator.id)) ||
        (project.organization_targets || []).some((entry) => String(entry.indicator) === String(indicator.id))

      if (isIndicatorAssigned) {
        next.add(String(project.id))
      }
    })

    return next
  }, [indicator, projects])
  const assignmentCounts = useMemo(() => {
    const organizationIds = new Set(indicator ? getIndicatorOrganizationIds(indicator) : [])

    projects.forEach((project) => {
      ;(project.organization_targets || []).forEach((entry) => {
        if (String(entry.indicator) !== String(indicator?.id)) return
        const organizationId = String(entry.organization || "").trim()
        if (organizationId) organizationIds.add(organizationId)
      })
    })

    const hasDetailedProjectAssignments = projects.length > 0

    if (hasDetailedProjectAssignments) {
      return {
        organizationCount: organizationIds.size,
        projectCount: assignedProjectIds.size,
      }
    }

    const fallbackProjectCount = indicator?.project_targets
      ? new Set(
          indicator.project_targets
            .map((target) => String(target.project || "").trim())
            .filter(Boolean),
        ).size
      : 0

    return {
      organizationCount: organizationIds.size,
      projectCount: fallbackProjectCount,
    }
  }, [assignedProjectIds, indicator, projects])
  const canActivateIndicator = useMemo(
    () => {
      if (!indicator) return false

      const hasOrganizations = assignmentCounts.organizationCount > 0
      if (!hasOrganizations) return false

      if (projects.length > 0) {
        return assignmentCounts.projectCount > 0
      }

      return canIndicatorBeActive(indicator)
    },
    [assignmentCounts.organizationCount, assignmentCounts.projectCount, indicator, projects.length],
  )
  const effectiveIsActive = formData.is_active && canActivateIndicator

  useEffect(() => {
    if (!canActivateIndicator && formData.is_active) {
      setFormData((prev) => ({ ...prev, is_active: false }))
    }
  }, [canActivateIndicator, formData.is_active])

  const handleSave = async () => {
    if (!isValidId) {
      toast({
        title: "Invalid indicator",
        description: "The indicator ID is not valid.",
        variant: "destructive",
      })
      return
    }

    if (!formData.name.trim() || !formData.code.trim() || !formData.category || !formData.type) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      })
      return
    }

    if (requiresOptions && parsedOptions.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please provide at least one option for the selected response type.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)

    try {
      const payload: UpdateIndicatorRequest = {
        name: formData.name.trim(),
        short_name: formData.short_name.trim() || undefined,
        code: formData.code.trim(),
        description: formData.description.trim() || undefined,
        type: formData.type as Indicator["type"],
        unit: formData.unit.trim() || undefined,
        options: requiresOptions ? parsedOptions : undefined,
        sub_labels: formData.disaggregation_config.enabled
          ? formData.disaggregation_config.dimensions.map((d) => d.label)
          : undefined,
        aggregate_disaggregation_config: formData.disaggregation_config,
        denominator_indicator:
          formData.type === "percentage" ? formData.denominator_indicator : null,
        is_active: canActivateIndicator ? formData.is_active : false,
      }

      // Avoid resubmitting unchanged legacy categories that older backends reject.
      if (formData.category && formData.category !== (indicator.category || "")) {
        payload.category = formData.category as Indicator["category"]
      }

      await indicatorsService.update(id, payload)

      toast({
        title: "Indicator updated",
        description: "Changes saved successfully.",
      })

      await Promise.all([
        mutate(),
        mutateCache(
          (key) => Array.isArray(key) && (key[0] === "indicators-all" || key[0] === "indicators"),
          undefined,
          { revalidate: true },
        ),
      ])
      router.push("/indicators")
    } catch (error) {
      const message =
        typeof (error as ApiError)?.message === "string" && (error as ApiError).message.trim()
          ? (error as ApiError).message
          : "Failed to update indicator."
      toast({
        title: "Error",
        description: message,
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

  if (error || !indicator || !isValidId) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Indicator not found</p>
        <Button onClick={handleBack}>Back to Indicators</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={`Edit ${indicator.name}`}
        description="Update indicator details, response structure, and aggregate disaggregates."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Indicators", href: "/indicators" },
          { label: "Edit" },
        ]}
        actions={
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle>Indicator Details</CardTitle>
              <CardDescription>
                Update indicator setup for collection and aggregate reporting.
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant={effectiveIsActive ? "default" : "secondary"}>
                {effectiveIsActive ? "Active" : "Inactive"}
              </Badge>
              <Badge variant="outline">{getIndicatorCategoryLabel(formData.category)}</Badge>
              <Badge variant="outline">{formData.type || "No type"}</Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="name">Indicator Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Enter indicator name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="short_name">Short Name</Label>
              <Input
                id="short_name"
                value={formData.short_name}
                onChange={(e) => updateField("short_name", e.target.value)}
                placeholder="e.g. HIV Messages"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Code *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => updateField("code", e.target.value)}
                placeholder="Enter indicator code"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={3}
              value={formData.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Add a short description for this indicator"
            />
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select value={formData.category} onValueChange={(value) => updateField("category", value)}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {INDICATOR_CATEGORY_OPTIONS.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Response Type *</Label>
              <Select value={formData.type} onValueChange={(value) => updateField("type", value)}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes_no">Yes/No</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="select">Single Select</SelectItem>
                  <SelectItem value="multiselect">Multiselect</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="multi_int">Multiple Integers</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                value={formData.unit}
                onChange={(e) => updateField("unit", e.target.value)}
                placeholder="e.g. people, %, visits"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="options">
                Options {requiresOptions ? "*" : "(comma-separated)"}
              </Label>
              <Input
                id="options"
                value={formData.options}
                onChange={(e) => updateField("options", e.target.value)}
                placeholder="e.g. Yes, No, Unknown"
              />
              {requiresOptions && (
                <p className="text-xs text-muted-foreground">
                  Required for select and multiselect response types.
                </p>
              )}
            </div>
          </div>

          {parsedOptions.length > 0 && (
            <div className="space-y-2">
              <Label>Parsed Options</Label>
              <div className="flex flex-wrap gap-2 rounded-lg border border-border p-3">
                {parsedOptions.map((option) => (
                  <Badge key={option} variant="secondary">
                    {option}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Disaggregate groups for aggregate data</Label>
              <p className="text-sm text-muted-foreground">
                Select the disaggregate groups used when entering aggregate values.
              </p>
            </div>
            <DisaggregationConfigEditor
              indicatorType={formData.type}
              denominatorId={formData.denominator_indicator}
              onDenominatorChange={(id) =>
                setFormData((prev) => ({ ...prev, denominator_indicator: id }))
              }
              denominatorOptions={allIndicators.map((i) => ({ id: i.id, name: i.name, code: i.code }))}
              selfId={indicator?.id}
              value={formData.disaggregation_config}
              disabled={isSubmitting}
              onChange={(next) =>
                setFormData((prev) => ({ ...prev, disaggregation_config: next }))
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Active</p>
              <p className="text-xs text-muted-foreground">
                Enable this only after the indicator is assigned to at least one project and one organization.
              </p>
              {!canActivateIndicator ? (
                <p className="text-xs text-amber-600">
                  Needs at least 1 project assignment and 1 organization assignment. Current: {assignmentCounts.projectCount} project{assignmentCounts.projectCount === 1 ? "" : "s"}, {assignmentCounts.organizationCount} organization{assignmentCounts.organizationCount === 1 ? "" : "s"}.
                </p>
              ) : null}
            </div>
            <Switch
              checked={effectiveIsActive}
              onCheckedChange={(checked) => updateField("is_active", checked)}
              disabled={!canActivateIndicator}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={handleBack} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <QuarterlyTargetsSection
        indicatorId={id}
        projectTargets={indicator.project_targets}
        editable
        onUpdated={() => mutate()}
      />
    </div>
  )
}
