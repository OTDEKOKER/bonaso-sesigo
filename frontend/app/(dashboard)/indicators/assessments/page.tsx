"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, ClipboardList, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { useAssessments } from "@/lib/hooks/use-api"
import { assessmentsService, indicatorsService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useToast } from "@/hooks/use-toast"
import type { CreateIndicatorRequest } from "@/lib/api"
import type { Assessment } from "@/lib/types"
import { getUserOrganizationId } from "@/lib/utils/organization"

const typeLabels: Record<string, string> = {
  yes_no: "Yes/No",
  number: "Number",
  percentage: "Percentage",
  text: "Text",
  select: "Single Select",
  multiselect: "Multiselect",
  date: "Date",
  multi_int: "Numbers",
}

export default function AssessmentsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useAuth()
  const organizationId = getUserOrganizationId(user)
  const assessmentFilters = organizationId
    ? { organizations: String(organizationId), page_size: "100" }
    : { page_size: "100" }
  const { data, isLoading, error, mutate } = useAssessments(assessmentFilters)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTemplateSubmitting, setIsTemplateSubmitting] = useState(false)
  const [openAssessmentIds, setOpenAssessmentIds] = useState<Record<string, boolean>>({})
  const [assessmentDetailsById, setAssessmentDetailsById] = useState<Record<string, Assessment>>({})
  const [loadingAssessmentId, setLoadingAssessmentId] = useState<string | null>(null)
  const [assessmentDetailErrors, setAssessmentDetailErrors] = useState<Record<string, string>>({})
  const [formData, setFormData] = useState({
    name: "",
    description: "",
  })

  const assessments = data?.results || []

  const loadAssessmentDetails = useCallback(async (assessmentId: string) => {
    if (assessmentDetailsById[assessmentId] || loadingAssessmentId === assessmentId) return

    setLoadingAssessmentId(assessmentId)
    setAssessmentDetailErrors((current) => {
      if (!current[assessmentId]) return current
      const next = { ...current }
      delete next[assessmentId]
      return next
    })

    try {
      const detail = await assessmentsService.get(assessmentId)
      setAssessmentDetailsById((current) => ({ ...current, [assessmentId]: detail }))
    } catch (detailError) {
      const message =
        detailError instanceof Error && detailError.message
          ? detailError.message
          : "Failed to load assessment questions."
      setAssessmentDetailErrors((current) => ({ ...current, [assessmentId]: message }))
    } finally {
      setLoadingAssessmentId((current) => (current === assessmentId ? null : current))
    }
  }, [assessmentDetailsById, loadingAssessmentId])

  const ensureIndicator = async (request: CreateIndicatorRequest): Promise<number> => {
    const organizationFilter = request.organizations?.[0]
      ? String(request.organizations[0])
      : undefined

    const listFilters: { search: string; page_size: string; organizations?: string } = {
      search: request.code,
      page_size: "100",
    }
    if (organizationFilter) {
      listFilters.organizations = organizationFilter
    }

    const findExactMatchId = (results: Array<{ code?: string; id?: number | string; organizations?: unknown }>) => {
      const exactMatch = (results || []).find((i) => {
        if (i.code !== request.code) return false
        if (!request.organizations?.length) return true
        const orgId = String(request.organizations[0])
        return Array.isArray(i.organizations) && i.organizations.some((org) => {
          const orgValue = typeof org === 'object' && org !== null ? (org as { id?: string | number }).id : org
          return String(orgValue) === orgId
        })
      })
      return exactMatch?.id ? Number(exactMatch.id) : null
    }

    try {
      const list = await indicatorsService.list(listFilters)
      const existingId = findExactMatchId(list.results || [])
      if (existingId) return existingId
    } catch (listError) {
      console.warn("Indicator lookup failed; continuing with create attempt", listError)
    }

    try {
      const created = await indicatorsService.create(request)
      return Number(created.id)
    } catch {
      try {
        const retry = await indicatorsService.list(listFilters)
        const retryMatchId = findExactMatchId(retry.results || [])
        if (retryMatchId) return retryMatchId
      } catch (retryError) {
        console.warn("Indicator retry lookup failed", retryError)
      }
      throw new Error(`Failed to create indicator: ${request.code}`)
    }
  }

  const createHivPreventionMessagesTemplate = async (): Promise<void> => {
    setIsTemplateSubmitting(true)
    try {
      const assessment = await assessmentsService.create({
        name: "HIV Prevention Messages Assessment",
        description:
          "Starter template (v1) for HIV prevention and control messages, screening, and linkage to care.",
        organizations: organizationId ? [organizationId] : undefined,
      })

      const category = "hiv_prevention"
      const orgArray = organizationId ? [organizationId] : []
      const indicators: Array<{
        request: CreateIndicatorRequest
        order: number
        required: boolean
      }> = [
        {
          order: 1,
          required: true,
          request: {
            name: "Client ID",
            code: "HIVPM_CLIENT_ID",
            description: "Unique client identifier (avoid collecting names).",
            type: "text",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
        {
          order: 2,
          required: true,
          request: {
            name: "Date of interaction",
            code: "HIVPM_INTERACTION_DATE",
            type: "date",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
        {
          order: 3,
          required: true,
          request: {
            name: "Location of interaction",
            code: "HIVPM_INTERACTION_LOCATION",
            description: "Facility/site name (and plot/address if applicable).",
            type: "text",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
        {
          order: 4,
          required: true,
          request: {
            name: "Reached with HIV prevention and control messages",
            code: "HIVPM_MESSAGES_REACHED",
            description: "Select all that apply.",
            type: "multiselect",
            category,
            is_active: true,
            organizations: orgArray,
            options: [
              { label: "HIV testing messages", value: "hiv_testing" },
              { label: "PEP messages", value: "pep" },
              { label: "PrEP messages", value: "prep" },
              { label: "GBV messages", value: "gbv" },
              { label: "Condom use messages", value: "condom_use" },
              { label: "HIV treatment messages", value: "hiv_treatment" },
              { label: "ARV based messages", value: "arv_based" },
              { label: "EMTCT messages", value: "emtct" },
              { label: "Stigma reduction messages", value: "stigma_reduction" },
              { label: "None of the above", value: "none" },
            ],
          },
        },
        {
          order: 5,
          required: true,
          request: {
            name: "Screened for HIV",
            code: "HIVPM_HIV_SCREENED",
            type: "yes_no",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
        {
          order: 6,
          required: false,
          request: {
            name: "Tested for HIV",
            code: "HIVPM_HIV_TESTED",
            type: "select",
            category,
            is_active: true,
            organizations: orgArray,
            options: [
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
              { label: "Known positive", value: "known_positive" },
            ],
          },
        },
        {
          order: 7,
          required: true,
          request: {
            name: "Screened for TB",
            code: "HIVPM_TB_SCREENED",
            type: "yes_no",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
        {
          order: 8,
          required: false,
          request: {
            name: "Linked to care",
            code: "HIVPM_LINKED_TO_CARE",
            type: "yes_no",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
        {
          order: 9,
          required: false,
          request: {
            name: "Eligible for PrEP",
            code: "HIVPM_PREP_ELIGIBLE",
            type: "yes_no",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
        {
          order: 10,
          required: false,
          request: {
            name: "Eligible for PEP",
            code: "HIVPM_PEP_ELIGIBLE",
            type: "yes_no",
            category,
            is_active: true,
            organizations: orgArray,
          },
        },
      ]

      for (const item of indicators) {
        const indicatorId = await ensureIndicator(item.request)
        await assessmentsService.saveQuestion(Number(assessment.id), {
          indicator_id: indicatorId,
          question_text: item.request.name,
          response_type: item.request.type,
          response_options: item.request.options,
          response_sub_labels: item.request.sub_labels,
          order: item.order,
          is_required: item.required,
        })
      }

      toast({
        title: "Template created",
        description: "HIV Prevention Messages Assessment created with starter questions.",
      })
      setIsTemplatesOpen(false)
      mutate()
      router.push(`/indicators/assessments/${assessment.id}`)
    } catch (err) {
      console.error("Failed to create template assessment", err)
      const description = err instanceof Error && err.message ? err.message : "Failed to create template assessment."
      toast({
        title: "Error",
        description,
        variant: "destructive",
      })
    } finally {
      setIsTemplateSubmitting(false)
    }
  }

  const handleCreate = async () => {
    if (!formData.name) {
      toast({
        title: "Validation Error",
        description: "Assessment name is required",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const created = await assessmentsService.create({
        name: formData.name,
        description: formData.description || undefined,
        organizations: organizationId ? [organizationId] : undefined,
      })
      toast({ title: "Success", description: "Assessment created successfully" })
      setIsCreateOpen(false)
      setFormData({ name: "", description: "" })
      mutate()
      router.push(`/indicators/assessments/${created.id}`)
    } catch {
      toast({ title: "Error", description: "Failed to create assessment", variant: "destructive" })
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

  if (error) {
    const errorMessage = error instanceof Error && error.message ? error.message : "Failed to load assessments"
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="max-w-xl text-center text-muted-foreground">{errorMessage}</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessments"
        description="Manage assessment forms and their questions"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Indicators", href: "/indicators" },
          { label: "Assessments" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsTemplatesOpen(true)}>
              Templates
            </Button>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Assessment
            </Button>
          </div>
        }
      />

      {/* Assessment cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {assessments.map((assessment) => {
          const assessmentId = String(assessment.id)
          const isExpanded = Boolean(openAssessmentIds[assessmentId])
          const indicators = assessmentDetailsById[assessmentId]?.indicators_detail || []
          const isIndicatorLoading = loadingAssessmentId === assessmentId
          const detailError = assessmentDetailErrors[assessmentId]
          
          return (
            <Card key={assessment.id} className="overflow-hidden">
              <CardHeader className="bg-secondary/30">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2">
                      <ClipboardList className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{assessment.name}</CardTitle>
                      <CardDescription>{assessment.description}</CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary">
                    {assessment.indicators_count ?? indicators.length} questions
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Accordion
                  type="single"
                  collapsible
                  className="w-full"
                  value={isExpanded ? "indicators" : undefined}
                  onValueChange={(value) => {
                    const nextExpanded = value === "indicators"
                    setOpenAssessmentIds((current) => ({ ...current, [assessmentId]: nextExpanded }))
                    if (nextExpanded) {
                      void loadAssessmentDetails(assessmentId)
                    }
                  }}
                >
                  <AccordionItem value="indicators" className="border-0">
                    <AccordionTrigger className="px-6 py-4 hover:no-underline">
                      <span className="text-sm text-muted-foreground">
                        View Questions
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-4">
                      {isIndicatorLoading ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Loading questions...</span>
                        </div>
                      ) : detailError ? (
                        <div className="space-y-3 py-2">
                          <p className="text-sm text-muted-foreground">{detailError}</p>
                          <Button variant="outline" size="sm" onClick={() => void loadAssessmentDetails(assessmentId)}>
                            Retry
                          </Button>
                        </div>
                      ) : indicators.length ? (
                        <div className="space-y-2">
                          {indicators.map((indicator, index) => (
                            <div
                              key={indicator.id}
                              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
                            >
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-medium text-muted-foreground">
                                {index + 1}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground">
                                  {indicator.question_text_display || indicator.question_text || indicator.indicator_detail?.name || "Question"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {indicator.indicator_detail?.code || "—"}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {typeLabels[indicator.response_type_display || indicator.response_type || indicator.indicator_detail?.type || ""] ||
                                    indicator.response_type_display ||
                                    indicator.response_type ||
                                    indicator.indicator_detail?.type ||
                                    "—"}
                                </Badge>
                                {indicator.is_required && (
                                  <Badge variant="secondary" className="bg-destructive/10 text-destructive text-xs">
                                    Required
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="py-2 text-sm text-muted-foreground">No questions in this assessment yet.</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <div className="flex items-center justify-between border-t border-border px-6 py-3">
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(assessment.created_at).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/indicators/assessments/${assessment.id}`)}
                  >
                    Edit Assessment
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}

        {assessments.length === 0 && (
          <div className="col-span-2 flex h-40 items-center justify-center rounded-lg border border-dashed border-border">
            <div className="text-center">
              <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-muted-foreground">No assessments yet</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 bg-transparent"
                onClick={() => setIsCreateOpen(true)}
              >
                Create your first assessment
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Assessment</DialogTitle>
            <DialogDescription>
              Create a new assessment form to group linked reporting questions
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Assessment Name</Label>
              <Input
                id="name"
                placeholder="e.g., HIV Testing Assessment"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of the assessment"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Assessment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Templates Dialog */}
      <Dialog open={isTemplatesOpen} onOpenChange={setIsTemplatesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assessment Templates</DialogTitle>
            <DialogDescription>
              Create a starter assessment with pre-filled questions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">HIV Prevention Messages Assessment</p>
                  <p className="text-xs text-muted-foreground">
                    Date/location, prevention messages, HIV/TB screening, linkage to care, PrEP/PEP eligibility.
                  </p>
                </div>
                <Button onClick={createHivPreventionMessagesTemplate} disabled={isTemplateSubmitting}>
                  {isTemplateSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTemplatesOpen(false)} disabled={isTemplateSubmitting}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
