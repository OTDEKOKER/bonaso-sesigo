"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Calendar, Mail, MapPin, Phone, User, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { indicatorsService, interactionsService, responsesService } from "@/lib/api"
import { useAssessment, useAssessments, useEvents, useProjects, useRespondentProfile } from "@/lib/hooks/use-api"
import { useSmartBack } from "@/lib/hooks/use-smart-back"
import type {
  AssessmentQuestion,
  Indicator,
  IndicatorType,
  Interaction,
  Response as InteractionResponse,
} from "@/lib/types"

type IndicatorOption = { label: string; value: string }

function asString(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function normalizeOptions(options: Indicator["options"]): IndicatorOption[] {
  if (!options || !Array.isArray(options)) return []
  return options
    .map((opt) => {
      if (typeof opt === "string") return { label: opt, value: opt }
      if (opt && typeof opt === "object") {
        const maybeOpt = opt as Record<string, unknown>
        const label =
          typeof maybeOpt.label === "string"
            ? maybeOpt.label
            : typeof maybeOpt.name === "string"
              ? maybeOpt.name
              : ""
        const valueRaw =
          maybeOpt.value !== undefined && maybeOpt.value !== null
            ? maybeOpt.value
            : maybeOpt.id !== undefined && maybeOpt.id !== null
              ? maybeOpt.id
              : label
        const value = asString(valueRaw)
        if (!label && !value) return null
        return { label: label || value, value: value || label }
      }
      return null
    })
    .filter((v): v is IndicatorOption => Boolean(v))
}

function normalizeIndicatorType(type: unknown): IndicatorType {
  const raw = asString(type)
  if (raw === "single") return "select"
  if (raw === "multi") return "multiselect"
  if (raw === "boolean") return "yes_no"
  if (raw === "integer") return "number"
  if (raw === "multint") return "multi_int"
  if (
    raw === "yes_no" ||
    raw === "number" ||
    raw === "percentage" ||
    raw === "text" ||
    raw === "select" ||
    raw === "multiselect" ||
    raw === "date" ||
    raw === "multi_int"
  ) {
    return raw
  }
  return "text"
}

function isEmptyResponseValue(type: IndicatorType, value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (type === "text" || type === "select" || type === "yes_no" || type === "date") {
    return String(value).trim().length === 0
  }
  if (type === "number" || type === "percentage") return value === "" || Number.isNaN(Number(value))
  if (type === "multiselect") return !Array.isArray(value) || value.length === 0
  if (type === "multi_int") {
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === "object") return Object.keys((value || {}) as Record<string, unknown>).length === 0
    return value === ""
  }
  return false
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function formatFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    id_no: "ID Number",
    age_range: "Age Range",
    plot_no: "Plot Number",
    kp_status: "Key Population Status",
    disability_status: "Disability Status",
    special_attribute: "Special Attributes",
    hiv_status: "HIV Status",
    date_positive: "Date Positive",
    is_anonymous: "Anonymous",
  }

  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function getAssessmentQuestionText(item: AssessmentQuestion, indicator?: Indicator | null): string {
  return item.question_text_display || item.question_text || indicator?.name || item.indicator_detail?.name || "Question"
}

function getAssessmentQuestionRawType(item: AssessmentQuestion, indicator?: Indicator | null): unknown {
  return item.response_type_display || item.response_type || indicator?.type || item.indicator_detail?.type || "text"
}

function getAssessmentQuestionOptions(
  item: AssessmentQuestion,
  indicator?: Indicator | null,
): Indicator["options"] {
  if (Array.isArray(item.response_options_display) && item.response_options_display.length > 0) {
    return item.response_options_display as Indicator["options"]
  }
  if (Array.isArray(item.response_options) && item.response_options.length > 0) {
    return item.response_options as Indicator["options"]
  }
  return indicator?.options
}

function getAssessmentQuestionSubLabels(
  item: AssessmentQuestion,
  indicator?: Indicator | null,
): string[] {
  if (Array.isArray(item.response_sub_labels_display) && item.response_sub_labels_display.length > 0) {
    return item.response_sub_labels_display
  }
  if (Array.isArray(item.response_sub_labels) && item.response_sub_labels.length > 0) {
    return item.response_sub_labels
  }
  return Array.isArray(indicator?.sub_labels) ? indicator.sub_labels : []
}

function formatDisplayValue(value: unknown): string {
  if (!hasValue(value)) return "—"
  if (typeof value === "string") return value.trim() || "—"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    const values = value.map((entry) => formatDisplayValue(entry)).filter((entry) => entry !== "—")
    return values.length > 0 ? values.join(", ") : "—"
  }

  const record = toRecord(value)
  for (const key of ["label", "name", "title", "value"]) {
    if (hasValue(record[key])) return formatDisplayValue(record[key])
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toDisplayList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => formatDisplayValue(entry))
    .filter((entry) => entry !== "—")
}

function normalizeBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value
  const normalized = asString(value).toLowerCase()
  if (["true", "yes", "1"].includes(normalized)) return true
  if (["false", "no", "0"].includes(normalized)) return false
  return null
}

function formatDateValue(value: unknown): string {
  const dateValue = asString(value)
  if (!dateValue) return "—"
  const parsed = new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return dateValue
  return parsed.toLocaleDateString()
}

export default function RespondentDetailPage() {
  const router = useRouter()
  const handleBack = useSmartBack("/respondents")
  const { toast } = useToast()
  const params = useParams()
  const id = Number(params?.id)

  const { data: respondent, isLoading, error, mutate } = useRespondentProfile(
    Number.isFinite(id) ? id : null,
  )
  const { data: assessmentsData } = useAssessments()
  const { data: projectsData } = useProjects()
  const { data: eventsData } = useEvents({ page_size: "200" })
  const assessments = useMemo(() => assessmentsData?.results || [], [assessmentsData?.results])
  const projects = useMemo(() => projectsData?.results || [], [projectsData?.results])
  const events = useMemo(() => eventsData?.results || [], [eventsData?.results])
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isResponsesOpen, setIsResponsesOpen] = useState(false)
  const [isSavingResponses, setIsSavingResponses] = useState(false)
  const [editingInteractionId, setEditingInteractionId] = useState<string | null>(null)
  const [responsesInteraction, setResponsesInteraction] = useState<Interaction | null>(null)
  const [indicatorDetailsById, setIndicatorDetailsById] = useState<Record<string, Indicator>>({})
  const [editForm, setEditForm] = useState({
    assessmentId: "",
    projectId: "",
    eventId: "",
    date: "",
    notes: "",
  })
  const [responseEdits, setResponseEdits] = useState<Record<string, unknown>>({})
  const [newResponseValues, setNewResponseValues] = useState<Record<string, unknown>>({})

  const responsesAssessmentId = responsesInteraction?.assessment
    ? String(responsesInteraction.assessment)
    : null
  const { data: responsesAssessment } = useAssessment(responsesAssessmentId)

  const demographics = useMemo(() => toRecord(respondent?.demographics), [respondent?.demographics])

  const kpStatus = useMemo(() => toDisplayList(demographics.kp_status), [demographics])
  const disabilityStatus = useMemo(() => toDisplayList(demographics.disability_status), [demographics])
  const specialAttributes = useMemo(
    () =>
      toDisplayList(demographics.special_attribute).filter(
        (value) => !["KP", "PWD", "PLWHIV"].includes(value.toUpperCase()),
      ),
    [demographics],
  )

  const hivStatus = useMemo(() => toRecord(demographics.hiv_status), [demographics])
  const hivPositive = normalizeBoolean(hivStatus.hiv_positive ?? demographics.hiv_positive)
  const respondentNotes = asString(demographics.notes)
  const respondentFlags = useMemo(() => {
    const rawFlags = (respondent as ({ flags?: unknown } & typeof respondent) | undefined)?.flags
    return Array.isArray(rawFlags)
      ? rawFlags.filter((flag): flag is Record<string, unknown> => typeof flag === "object" && flag !== null)
      : []
  }, [respondent])

  const pregnancyRecords = useMemo(() => {
    const rawSource =
      (respondent as ({ pregnancies?: unknown } & typeof respondent) | undefined)?.pregnancies ?? demographics.pregnancies
    return Array.isArray(rawSource)
      ? rawSource.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      : []
  }, [demographics.pregnancies, respondent])

  const remainingDemographicsEntries = useMemo(() => {
    const handledKeys = new Set([
      "is_anonymous",
      "id_no",
      "age_range",
      "plot_no",
      "ward",
      "village",
      "district",
      "citizenship",
      "kp_status",
      "disability_status",
      "special_attribute",
      "hiv_status",
      "hiv_positive",
      "date_positive",
      "notes",
      "pregnancies",
    ])

    return Object.entries(demographics).filter(([key, value]) => !handledKeys.has(key) && hasValue(value))
  }, [demographics])

  const locationLabel = useMemo(() => {
    const parts = [
      asString(demographics.plot_no),
      asString(demographics.ward),
      asString(demographics.village),
      asString(demographics.district),
    ].filter(Boolean)

    return parts.length > 0 ? parts.join(", ") : respondent?.address || "—"
  }, [demographics.district, demographics.plot_no, demographics.village, demographics.ward, respondent?.address])

  const respondentDetailItems = useMemo(
    () =>
      [
        { label: "Gender", value: respondent?.gender || "—" },
        { label: "Age Range", value: formatDisplayValue(demographics.age_range) },
        { label: "Date of Birth", value: formatDateValue(respondent?.date_of_birth) },
        { label: "Citizenship", value: formatDisplayValue(demographics.citizenship) },
        { label: "Location", value: locationLabel },
        { label: "Organization", value: respondent?.organization_name || "—" },
        { label: "Last Interaction", value: formatDateValue(respondent?.last_interaction) },
        { label: "Created", value: formatDateValue(respondent?.created_at) },
      ],
    [
      demographics.age_range,
      demographics.citizenship,
      locationLabel,
      respondent?.created_at,
      respondent?.date_of_birth,
      respondent?.gender,
      respondent?.last_interaction,
      respondent?.organization_name,
    ],
  )

  const eligibleEvents = useMemo(() => {
    const orgId = respondent?.organization ? String(respondent.organization) : null
    if (!orgId) return events
    return events.filter((event) => {
      const ownerOrg = event.organization ? String(event.organization) : ""
      const participating = (event.participating_organizations || []).map((id) => String(id))
      return ownerOrg === orgId || participating.includes(orgId)
    })
  }, [events, respondent?.organization])

  const existingResponseByIndicatorId = useMemo(() => {
    const mapped: Record<string, InteractionResponse> = {}
    for (const response of responsesInteraction?.responses || []) {
      mapped[String(response.indicator)] = response
    }
    return mapped
  }, [responsesInteraction?.responses])

  const missingAssessmentItems = useMemo(() => {
    const allItems = responsesAssessment?.indicators_detail || []
    return allItems.filter((item) => !existingResponseByIndicatorId[String(item.indicator)])
  }, [existingResponseByIndicatorId, responsesAssessment?.indicators_detail])

  useEffect(() => {
    let cancelled = false

    const loadIndicatorDetails = async () => {
      const ids = new Set<string>()
      for (const response of responsesInteraction?.responses || []) {
        if (response.indicator) ids.add(String(response.indicator))
      }
      for (const item of responsesAssessment?.indicators_detail || []) {
        ids.add(String(item.indicator))
      }
      const missing = Array.from(ids).filter((indicatorId) => !indicatorDetailsById[indicatorId])
      if (missing.length === 0) return

      const results = await Promise.all(
        missing.map(async (indicatorId) => {
          try {
            const detail = await indicatorsService.get(Number(indicatorId))
            return [indicatorId, detail] as const
          } catch {
            return null
          }
        }),
      )
      if (cancelled) return

      const next: Record<string, Indicator> = {}
      for (const result of results) {
        if (!result) continue
        next[result[0]] = result[1]
      }
      if (Object.keys(next).length > 0) {
        setIndicatorDetailsById((prev) => ({ ...prev, ...next }))
      }
    }

    loadIndicatorDetails()
    return () => {
      cancelled = true
    }
  }, [indicatorDetailsById, responsesAssessment?.indicators_detail, responsesInteraction?.responses])

  const openEditDialog = (interaction: Interaction) => {
    setEditingInteractionId(String(interaction.id))
    setEditForm({
      assessmentId: interaction.assessment ? String(interaction.assessment) : "none",
      projectId: interaction.project ? String(interaction.project) : "none",
      eventId: interaction.event ? String(interaction.event) : "none",
      date: interaction.date ? String(interaction.date).slice(0, 10) : "",
      notes: interaction.notes || "",
    })
    setIsEditOpen(true)
  }

  const resetEditDialog = () => {
    setIsEditOpen(false)
    setEditingInteractionId(null)
    setEditForm({ assessmentId: "", projectId: "", eventId: "", date: "", notes: "" })
  }

  const openResponsesDialog = (interaction: Interaction) => {
    const initialEdits: Record<string, unknown> = {}
    for (const response of interaction.responses || []) {
      initialEdits[String(response.id)] = response.value
    }
    setResponseEdits(initialEdits)
    setNewResponseValues({})
    setResponsesInteraction(interaction)
    setIsResponsesOpen(true)
  }

  const resetResponsesDialog = () => {
    setIsResponsesOpen(false)
    setIsSavingResponses(false)
    setResponsesInteraction(null)
    setResponseEdits({})
    setNewResponseValues({})
  }

  const toSelectYesNoValue = (value: unknown): string => {
    if (value === true) return "yes"
    if (value === false) return "no"
    const normalized = asString(value).toLowerCase()
    if (["true", "yes", "1"].includes(normalized)) return "yes"
    if (["false", "no", "0"].includes(normalized)) return "no"
    return ""
  }

  const stringifyForEditor = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const parseComplexResponseValue = (raw: string): unknown => {
    const trimmed = raw.trim()
    if (!trimmed) return ""
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }

  const saveEditedResponses = async () => {
    if (!responsesInteraction) return
    setIsSavingResponses(true)
    try {
      const interactionId = Number(responsesInteraction.id)
      if (!Number.isFinite(interactionId)) {
        throw new Error("Invalid interaction id")
      }

      const changedResponses = (responsesInteraction.responses || [])
        .filter(
          (response) =>
            JSON.stringify(response.value) !== JSON.stringify(responseEdits[String(response.id)]),
        )
        .map((response) => ({
          id: String(response.id),
          value: responseEdits[String(response.id)],
        }))

      const newResponses = missingAssessmentItems
        .map((item) => {
          const indicatorId = String(item.indicator)
          const fullIndicator = indicatorDetailsById[indicatorId]
          const itemType = normalizeIndicatorType(
            getAssessmentQuestionRawType(item, fullIndicator || null),
          )
          const value = newResponseValues[indicatorId]
          if (isEmptyResponseValue(itemType, value)) return null
          const parsedIndicatorId = Number(indicatorId)
          if (!Number.isFinite(parsedIndicatorId)) return null
          return {
            interaction: interactionId,
            indicator: parsedIndicatorId,
            value,
          }
        })
        .filter(Boolean) as Array<{ interaction: number; indicator: number; value: unknown }>

      if (changedResponses.length === 0 && newResponses.length === 0) {
        toast({
          title: "No changes",
          description: "No response values were changed or added.",
        })
        setIsSavingResponses(false)
        return
      }

      await Promise.all(
        changedResponses.map((response) =>
          responsesService.update(response.id, { value: response.value }),
        ),
      )
      if (newResponses.length > 0) {
        await Promise.all(newResponses.map((payload) => responsesService.create(payload)))
      }

      toast({
        title: "Saved",
        description: "Assessment responses updated successfully.",
      })
      await mutate()
      resetResponsesDialog()
    } catch {
      toast({
        title: "Error",
        description: "Failed to update assessment responses.",
        variant: "destructive",
      })
      setIsSavingResponses(false)
    }
  }

  const saveInteractionEdit = async () => {
    if (!editingInteractionId || !editForm.date) return
    setIsSaving(true)
    try {
      await interactionsService.update(editingInteractionId, {
        assessment: editForm.assessmentId === "none" ? null : Number(editForm.assessmentId),
        project: editForm.projectId === "none" ? null : Number(editForm.projectId),
        event: editForm.eventId === "none" ? null : Number(editForm.eventId),
        date: editForm.date,
        notes: editForm.notes || "",
      })
      toast({
        title: "Saved",
        description: "Interaction history updated successfully.",
      })
      await mutate()
      resetEditDialog()
    } catch {
      toast({
        title: "Error",
        description: "Failed to update interaction history.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const renderValueEditor = (params: {
    editorKey: string
    rawType: unknown
    value: unknown
    indicator?: Indicator | null
    options?: Indicator["options"]
    subLabels?: string[]
    onChange: (value: unknown) => void
  }) => {
    const { editorKey, rawType, value, indicator, options: optionOverrides, subLabels, onChange } = params
    const type = normalizeIndicatorType(rawType)
    const options = normalizeOptions(optionOverrides || indicator?.options)

    if (type === "yes_no") {
      const currentValue = toSelectYesNoValue(value)
      const originalNormalized = asString(value).toLowerCase()
      const expectsBoolean = typeof value === "boolean" || ["true", "false", "1", "0"].includes(originalNormalized)
      return (
        <Select
          value={currentValue}
          onValueChange={(nextValue) => onChange(expectsBoolean ? nextValue === "yes" : nextValue)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    if (type === "select" && options.length > 0) {
      return (
        <Select value={asString(value)} onValueChange={(nextValue) => onChange(nextValue)}>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={`${editorKey}-${opt.value}`} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (type === "number" || type === "percentage") {
      return (
        <Input
          type="number"
          value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
        />
      )
    }

    if (type === "date") {
      return (
        <Input
          type="date"
          value={typeof value === "string" ? String(value).slice(0, 10) : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    }

    if (type === "multiselect" && options.length > 0) {
      const selectedValues = Array.isArray(value) ? value.map((entry) => asString(entry)) : []
      return (
        <div className="space-y-2">
          {options.map((opt) => (
            <div key={`${editorKey}-${opt.value}`} className="flex items-center gap-2">
              <Checkbox
                checked={selectedValues.includes(opt.value)}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? Array.from(new Set([...selectedValues, opt.value]))
                    : selectedValues.filter((entry) => entry !== opt.value)
                  onChange(next)
                }}
              />
              <span className="text-sm">{opt.label}</span>
            </div>
          ))}
        </div>
      )
    }

    const activeSubLabels = Array.isArray(subLabels) && subLabels.length > 0
      ? subLabels
      : Array.isArray(indicator?.sub_labels)
        ? indicator.sub_labels
        : []

    if (type === "multi_int" && activeSubLabels.length > 0) {
      const currentObj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {}
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {activeSubLabels.map((subLabel) => (
            <div key={`${editorKey}-${subLabel}`} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{subLabel}</Label>
              <Input
                type="number"
                value={typeof currentObj[subLabel] === "number" || typeof currentObj[subLabel] === "string" ? String(currentObj[subLabel]) : ""}
                onChange={(e) =>
                  onChange({
                    ...currentObj,
                    [subLabel]: e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
              />
            </div>
          ))}
        </div>
      )
    }

    if (type === "multiselect" || type === "multi_int") {
      return (
        <Textarea
          rows={2}
          value={stringifyForEditor(value)}
          onChange={(e) =>
            onChange(parseComplexResponseValue(e.target.value))
          }
        />
      )
    }

    return (
      <Input
        value={typeof value === "string" ? value : stringifyForEditor(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  const renderResponseEditor = (response: InteractionResponse) => {
    const responseId = String(response.id)
    const fullIndicator = indicatorDetailsById[String(response.indicator)]
    const assessmentItem = (responsesAssessment?.indicators_detail || []).find(
      (item) => String(item.indicator) === String(response.indicator),
    )
    return renderValueEditor({
      editorKey: `response-${responseId}`,
      rawType: assessmentItem
        ? getAssessmentQuestionRawType(assessmentItem, fullIndicator || null)
        : fullIndicator?.type || response.indicator_type || "text",
      value: responseEdits[responseId],
      indicator: fullIndicator || null,
      options: assessmentItem ? getAssessmentQuestionOptions(assessmentItem, fullIndicator || null) : undefined,
      subLabels: assessmentItem ? getAssessmentQuestionSubLabels(assessmentItem, fullIndicator || null) : undefined,
      onChange: (nextValue) =>
        setResponseEdits((prev) => ({
          ...prev,
          [responseId]: nextValue,
        })),
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !respondent) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Respondent not found</p>
        <Button onClick={() => router.push("/respondents")}>
          Back to Respondents
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={respondent.full_name || `${respondent.first_name} ${respondent.last_name}`}
        description={`Respondent ID: ${respondent.unique_id}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Respondents", href: "/respondents" },
          { label: respondent.full_name || respondent.unique_id },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => router.push(`/respondents/${respondent.id}/edit`)}>
              Edit Respondent
            </Button>
            <Button variant="secondary" onClick={() => router.push(`/respondents/interactions?respondentId=${respondent.id}`)}>
              New Interaction
            </Button>
            <Button variant="outline" onClick={() => router.push(`/flags?respondentId=${respondent.id}`)}>
              Flag Record
            </Button>
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" /> Respondent Details
            </CardTitle>
            <CardDescription>Basic respondent information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{respondent.gender || "Unknown"}</Badge>
              <Badge variant="secondary">
                {respondent.is_active ? "Active" : "Inactive"}
              </Badge>
              {demographics.is_anonymous ? <Badge variant="outline">Anonymous</Badge> : null}
              {respondent.organization_name && (
                <Badge variant="outline">{respondent.organization_name}</Badge>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {respondentDetailItems.map((item) => (
                <div key={item.label}>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium">{item.value}</p>
                </div>
              ))}
              <div>
                <p className="text-sm text-muted-foreground">Interactions</p>
                <p className="text-sm font-medium">{respondent.interactions_count ?? 0}</p>
              </div>
            </div>
            {specialAttributes.length > 0 ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase text-muted-foreground">Special Attributes</p>
                <p className="mt-1 text-sm font-medium">{specialAttributes.join(", ")}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
            <CardDescription>Primary contact details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{respondent.email || "—"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{respondent.phone || "—"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{respondent.address || "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Record Sections</CardTitle>
          <CardDescription>Respondent details now behave closer to the old repo</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" defaultValue={["details"]} className="w-full">
            <AccordionItem value="details">
              <AccordionTrigger>Respondent Details</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <p>
                    {[respondent.gender || null, formatDisplayValue(demographics.age_range) !== "—" ? `Age ${formatDisplayValue(demographics.age_range)}` : null, ...specialAttributes]
                      .filter(Boolean)
                      .join(", ") || "No respondent summary available."}
                  </p>
                  <p>{locationLabel}</p>
                  <p>{formatDisplayValue(demographics.citizenship)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => router.push(`/respondents/${respondent.id}/edit`)}>
                    Edit Respondent
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => router.push(`/respondents/interactions?respondentId=${respondent.id}`)}>
                    New Interaction
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => router.push(`/flags?respondentId=${respondent.id}`)}>
                    Flag Respondent
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {respondentDetailItems.map((item) => (
                    <div key={`details-${item.label}`} className="rounded-lg border border-border p-3">
                      <p className="text-xs uppercase text-muted-foreground">{item.label}</p>
                      <p className="text-sm font-medium">{item.value}</p>
                    </div>
                  ))}
                </div>

                {respondentNotes ? (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs uppercase text-muted-foreground">Notes</p>
                    <p className="mt-1 text-sm font-medium">{respondentNotes}</p>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>

            {kpStatus.length > 0 ? (
              <AccordionItem value="kp-status">
                <AccordionTrigger>Key Population Status</AccordionTrigger>
                <AccordionContent>
                  <ul className="list-disc space-y-2 pl-5 text-sm">
                    {kpStatus.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {disabilityStatus.length > 0 ? (
              <AccordionItem value="disability-status">
                <AccordionTrigger>Disability Status</AccordionTrigger>
                <AccordionContent>
                  <ul className="list-disc space-y-2 pl-5 text-sm">
                    {disabilityStatus.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {specialAttributes.length > 0 ? (
              <AccordionItem value="special-attributes">
                <AccordionTrigger>Special Attributes</AccordionTrigger>
                <AccordionContent>
                  <ul className="list-disc space-y-2 pl-5 text-sm">
                    {specialAttributes.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ) : null}

            <AccordionItem value="hiv-status">
              <AccordionTrigger>HIV Status CONFIDENTIAL</AccordionTrigger>
              <AccordionContent>
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={hivPositive ? "destructive" : "secondary"}>
                      {hivPositive === null ? "Unknown" : hivPositive ? "Positive" : "Negative"}
                    </Badge>
                    {hasValue(hivStatus.date_positive) ? (
                      <span className="text-sm text-muted-foreground">
                        Since {formatDateValue(hivStatus.date_positive)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="pregnancy-information">
              <AccordionTrigger>Pregnancy Information</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {pregnancyRecords.length > 0 ? (
                  pregnancyRecords.map((record, index) => (
                    <div key={`pregnancy-${index}`} className="rounded-lg border border-border p-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Term Began</p>
                          <p className="text-sm font-medium">{formatDateValue(record.term_began)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Term Ended</p>
                          <p className="text-sm font-medium">{formatDateValue(record.term_ended)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No recorded pregnancies.</p>
                )}
              </AccordionContent>
            </AccordionItem>

            {respondentFlags.length > 0 ? (
              <AccordionItem value="flags">
                <AccordionTrigger>Flags</AccordionTrigger>
                <AccordionContent className="space-y-3">
                  {respondentFlags.map((flag, index) => {
                    const title = formatDisplayValue(flag.title ?? flag.reason)
                    const description = formatDisplayValue(flag.description)
                    const status = formatDisplayValue(flag.status)
                    return (
                      <div key={`flag-${index}-${title}`} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{title}</p>
                          <Badge variant="outline">{status}</Badge>
                        </div>
                        {description !== "—" ? (
                          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </AccordionContent>
              </AccordionItem>
            ) : null}

            {remainingDemographicsEntries.length > 0 ? (
              <AccordionItem value="additional-information">
                <AccordionTrigger>Additional Information</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-3 md:grid-cols-2">
                    {remainingDemographicsEntries.map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-border p-3">
                        <p className="text-xs uppercase text-muted-foreground">{formatFieldLabel(key)}</p>
                        <p className="text-sm font-medium">{formatDisplayValue(value)}</p>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ) : null}
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Interactions</CardTitle>
          <CardDescription>Recent engagements with this respondent</CardDescription>
        </CardHeader>
        <CardContent>
          {respondent.interactions?.length ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Responses</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {respondent.interactions.map((interaction) => (
                    <TableRow key={interaction.id}>
                      <TableCell className="text-sm">
                        {interaction.date
                          ? new Date(interaction.date).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {interaction.assessment_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {interaction.project_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {interaction.event_name || "Non-event"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {interaction.responses_count ?? interaction.responses?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {interaction.notes || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2 whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openResponsesDialog(interaction)}
                          >
                            Responses
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(interaction)}
                          >
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              No interactions recorded yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={(open) => (open ? setIsEditOpen(true) : resetEditDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Interaction History</DialogTitle>
            <DialogDescription>Update saved assessment interaction details for this respondent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="history-assessment">Assessment</Label>
              <Select
                value={editForm.assessmentId}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, assessmentId: value }))}
              >
                <SelectTrigger id="history-assessment">
                  <SelectValue placeholder="Select assessment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No assessment</SelectItem>
                  {assessments.map((assessment) => (
                    <SelectItem key={assessment.id} value={String(assessment.id)}>
                      {assessment.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="history-project">Project</Label>
              <Select
                value={editForm.projectId}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, projectId: value }))}
              >
                <SelectTrigger id="history-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="history-date">Date</Label>
              <Input
                id="history-date"
                type="date"
                value={editForm.date}
                onChange={(e) => setEditForm((prev) => ({ ...prev, date: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="history-event">Add Event (optional)</Label>
              <Select
                value={editForm.eventId || "none"}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, eventId: value }))}
              >
                <SelectTrigger id="history-event">
                  <SelectValue placeholder="Link to event" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No event</SelectItem>
                  {eligibleEvents.map((event) => (
                    <SelectItem key={event.id} value={String(event.id)}>
                      {event.title} ({event.start_date})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligibleEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No eligible events found for this respondent organization.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="history-notes">Notes</Label>
              <Textarea
                id="history-notes"
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetEditDialog} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={saveInteractionEdit} disabled={isSaving || !editForm.date}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isResponsesOpen}
        onOpenChange={(open) => (open ? setIsResponsesOpen(true) : resetResponsesDialog())}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>View/Edit Assessment Responses</DialogTitle>
            <DialogDescription>
              Update saved answers and add missing assessment responses for this interaction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(responsesInteraction?.responses || []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No responses were saved for this interaction.
              </div>
            ) : (
              (responsesInteraction?.responses || []).map((response) => {
                const fullIndicator = indicatorDetailsById[String(response.indicator)]
                const assessmentItem = (responsesAssessment?.indicators_detail || []).find(
                  (item) => String(item.indicator) === String(response.indicator),
                )
                const rawType = assessmentItem
                  ? getAssessmentQuestionRawType(assessmentItem, fullIndicator || null)
                  : response.indicator_type || "text"

                return (
                  <div key={response.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {assessmentItem
                            ? getAssessmentQuestionText(assessmentItem, fullIndicator || null)
                            : response.indicator_name || "Indicator"}
                        </p>
                        <p className="text-xs text-muted-foreground">{response.indicator_code || "—"}</p>
                        {assessmentItem?.help_text ? (
                          <p className="text-xs text-muted-foreground">{assessmentItem.help_text}</p>
                        ) : null}
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {String(rawType).replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {renderResponseEditor(response)}
                  </div>
                )
              })
            )}

            {missingAssessmentItems.length > 0 ? (
              <div className="space-y-3 pt-2">
                <p className="text-sm font-medium text-foreground">Unanswered Assessment Questions</p>
                {missingAssessmentItems.map((item) => {
                  const indicatorId = String(item.indicator)
                  const fullIndicator = indicatorDetailsById[indicatorId]
                  const rawType = getAssessmentQuestionRawType(item, fullIndicator || null)
                  return (
                    <div key={`missing-${indicatorId}`} className="space-y-2 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{getAssessmentQuestionText(item, fullIndicator || null)}</p>
                          {item.help_text ? (
                            <p className="text-xs text-muted-foreground">{item.help_text}</p>
                          ) : null}
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {String(rawType).replace(/_/g, " ")}
                        </Badge>
                      </div>
                      {renderValueEditor({
                        editorKey: `new-${indicatorId}`,
                        rawType,
                        value: newResponseValues[indicatorId],
                        indicator: fullIndicator || null,
                        options: getAssessmentQuestionOptions(item, fullIndicator || null),
                        subLabels: getAssessmentQuestionSubLabels(item, fullIndicator || null),
                        onChange: (nextValue) =>
                          setNewResponseValues((prev) => ({
                            ...prev,
                            [indicatorId]: nextValue,
                          })),
                      })}
                    </div>
                  )
                })}
              </div>
            ) : responsesAssessment?.indicators_detail?.length ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                All assessment questions already have saved responses.
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetResponsesDialog} disabled={isSavingResponses}>
              Close
            </Button>
            <Button
              onClick={saveEditedResponses}
              disabled={isSavingResponses}
            >
              {isSavingResponses && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Responses
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
