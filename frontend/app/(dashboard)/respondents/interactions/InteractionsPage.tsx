"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { Plus, Upload, Download, Calendar, User, FileSpreadsheet, Loader2 } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { aggregatesService, indicatorsService, interactionsService, type DerivationRule } from "@/lib/api"
import { useAllIndicators, useAssessment, useAssessments, useEvents, useInteractions, useProjects, useRespondents } from "@/lib/hooks/use-api"
import { formatDate, toIsoDate } from "@/lib/date-utils"
import type { AssessmentQuestion, Indicator, IndicatorType } from "@/lib/types"

type IndicatorOption = { label: string; value: string }
type GenericRecord = Record<string, unknown>
type IndicatorWithLogic = Indicator & GenericRecord
type RawIndicatorType = IndicatorType | "boolean" | "single" | "multi" | "integer" | "multint"

function normalizeOptions(options: Indicator["options"]): IndicatorOption[] {
  if (!options || !Array.isArray(options)) return []
  return options
    .map((opt) => {
      if (typeof opt === "string") return { label: opt, value: opt }
      if (opt && typeof opt === "object") {
        const maybeOpt = opt as GenericRecord
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

function parseBooleanLike(value: unknown): boolean | null {
  if (value === true || value === false) return value
  const normalized = asString(value).toLowerCase()
  if (["true", "yes", "1"].includes(normalized)) return true
  if (["false", "no", "0"].includes(normalized)) return false
  return null
}

function toSelectedStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asString(normalizeComparisonValue(entry)))
      .filter(Boolean)
  }
  const single = asString(normalizeComparisonValue(value))
  return single ? [single] : []
}

function isEmptyResponseValue(type: IndicatorType, value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (type === "text") return String(value).trim().length === 0
  if (type === "select" || type === "yes_no" || type === "date") return String(value).trim().length === 0
  if (type === "number" || type === "percentage") return value === "" || Number.isNaN(Number(value))
  if (type === "multiselect") return !Array.isArray(value) || value.length === 0
  if (type === "multi_int") {
    if (typeof value === "number") return Number.isNaN(value)
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === "object") return value === null || Object.keys(value as Record<string, unknown>).length === 0
    return true
  }
  return false
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function normalizeComparisonValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in (value as GenericRecord)) {
    return (value as GenericRecord).value
  }
  if (value && typeof value === "object" && "id" in (value as GenericRecord)) {
    return (value as GenericRecord).id
  }
  return value
}

function getLogicConditions(indicator: IndicatorWithLogic): GenericRecord[] {
  const raw = indicator.logic ?? indicator.logic_rules
  if (Array.isArray(raw)) return raw as GenericRecord[]
  if (raw && typeof raw === "object") {
    const maybe = (raw as GenericRecord).conditions
    if (Array.isArray(maybe)) return maybe as GenericRecord[]
  }
  return []
}

function getLogicGroupOperator(indicator: IndicatorWithLogic): "AND" | "OR" {
  const raw = indicator.logic ?? indicator.logic_rules
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const operator = asString((raw as GenericRecord).group_operator || (raw as GenericRecord).groupOperator)
    if (operator.toUpperCase() === "OR") return "OR"
  }
  return "AND"
}

function getAssessmentQuestionText(item: AssessmentQuestion, indicator?: Indicator | null): string {
  return item.question_text_display || item.question_text || indicator?.name || item.indicator_detail?.name || "Question"
}

function getAssessmentQuestionRawType(item: AssessmentQuestion, indicator?: Indicator | null): string {
  return asString(
    item.response_type_display ||
      item.response_type ||
      indicator?.type ||
      item.indicator_detail?.type ||
      "text",
  )
}

function getAssessmentQuestionType(item: AssessmentQuestion, indicator?: Indicator | null): IndicatorType {
  return normalizeIndicatorType(getAssessmentQuestionRawType(item, indicator))
}

function getAssessmentQuestionOptions(
  item: AssessmentQuestion,
  indicator?: Indicator | null,
): IndicatorOption[] {
  if (Array.isArray(item.response_options_display) && item.response_options_display.length > 0) {
    return normalizeOptions(item.response_options_display as Indicator["options"])
  }
  if (Array.isArray(item.response_options) && item.response_options.length > 0) {
    return normalizeOptions(item.response_options as Indicator["options"])
  }
  return normalizeOptions(indicator?.options)
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

function getMatchOptionsSourceId(indicator: IndicatorWithLogic): string | null {
  const direct = indicator.match_options ?? indicator.match_options_id ?? indicator.matchOptions
  if (direct && typeof direct === "object") {
    const id = (direct as GenericRecord).id
    return id !== undefined && id !== null ? String(id) : null
  }
  if (direct !== undefined && direct !== null && asString(direct)) return String(direct)
  return null
}

function evaluateLogicCondition(params: {
  condition: GenericRecord
  responses: Record<string, unknown>
  indicatorsById: Record<string, IndicatorWithLogic>
  respondent: GenericRecord | null
}): boolean {
  const { condition, responses, indicatorsById, respondent } = params
  const sourceType = asString(condition.source_type || condition.sourceType)

  if (sourceType === "respondent") {
    if (!respondent) return false
    const field = asString(condition.respondent_field || condition.respondentField)
    const operator = asString(condition.operator)
    const requiredValue = condition.value_text ?? condition.value_boolean ?? condition.value_option
    if (!field || !operator) return false

    const demographics = (respondent.demographics || {}) as GenericRecord
    let currentValue: unknown = respondent[field]
    if (currentValue === undefined && field in demographics) currentValue = demographics[field]
    if (field === "hiv_status" && currentValue && typeof currentValue === "object") {
      const hivObj = currentValue as GenericRecord
      if ("hiv_positive" in hivObj) currentValue = hivObj.hiv_positive
    }

    if (operator === "=") return asString(currentValue) === asString(requiredValue)
    if (operator === "!=") return asString(currentValue) !== asString(requiredValue)
    return false
  }

  const sourceIndicatorId = asString(condition.source_indicator || condition.sourceIndicator)
  if (!sourceIndicatorId) return false

  const sourceIndicator = indicatorsById[sourceIndicatorId]
  const sourceTypeName = normalizeIndicatorType(sourceIndicator?.type as RawIndicatorType | undefined)
  const operator = asString(condition.operator)
  const conditionType = asString(condition.condition_type || condition.conditionType).toLowerCase()
  const requiredValue = ["any", "none", "all"].includes(conditionType)
    ? conditionType
    : condition.value_option ?? condition.value_boolean ?? condition.value_text

  const rawCurrentValue = normalizeComparisonValue(responses[sourceIndicatorId])
  if (
    rawCurrentValue === undefined ||
    rawCurrentValue === null ||
    (typeof rawCurrentValue === "string" && rawCurrentValue.trim() === "")
  ) {
    return false
  }

  if (sourceTypeName === "multiselect" && ["any", "none", "all"].includes(conditionType)) {
    const selected = toSelectedStrings(rawCurrentValue)
    if (conditionType === "any") return selected.length > 0 && !selected.includes("none")
    if (conditionType === "none") return selected.includes("none")
    const optionCount = normalizeOptions(sourceIndicator?.options).length
    return optionCount > 0 ? selected.length === optionCount : false
  }

  if (sourceTypeName === "select" && ["any", "none", "all"].includes(conditionType)) {
    const selected = asString(rawCurrentValue)
    if (conditionType === "any") return selected.length > 0 && selected !== "none"
    if (conditionType === "none") return selected === "none"
    return false
  }

  if (sourceTypeName === "multiselect") {
    const selected = toSelectedStrings(rawCurrentValue)
    if (operator === "=") return selected.includes(asString(requiredValue))
    if (operator === "!=") return !selected.includes(asString(requiredValue))
  } else if (sourceTypeName === "yes_no") {
    const lhsBoolean = parseBooleanLike(rawCurrentValue)
    const rhsBoolean = parseBooleanLike(requiredValue)
    if (lhsBoolean !== null && rhsBoolean !== null) {
      if (operator === "=") return lhsBoolean === rhsBoolean
      if (operator === "!=") return lhsBoolean !== rhsBoolean
    }
    if (operator === "=") return asString(rawCurrentValue) === asString(requiredValue)
    if (operator === "!=") return asString(rawCurrentValue) !== asString(requiredValue)
  } else {
    if (operator === "=") return asString(rawCurrentValue) === asString(requiredValue)
    if (operator === "!=") return asString(rawCurrentValue) !== asString(requiredValue)
  }

  if (operator === ">" || operator === "<") {
    const lhs = Number(rawCurrentValue)
    const rhs = Number(requiredValue)
    if (Number.isNaN(lhs) || Number.isNaN(rhs)) return false
    return operator === ">" ? lhs > rhs : lhs < rhs
  }

  if (operator === "contains") {
    return asString(rawCurrentValue).toLowerCase().includes(asString(requiredValue).toLowerCase())
  }
  if (operator === "!contains") {
    return !asString(rawCurrentValue).toLowerCase().includes(asString(requiredValue).toLowerCase())
  }

  return false
}

export default function InteractionsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { user } = useAuth()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const orgId = user?.organizationId ? Number(user.organizationId) : null

  const { data: interactionsData, isLoading, error, mutate } = useInteractions()
  const { data: respondentsData } = useRespondents()
  const { data: assessmentsData } = useAssessments(
    orgId ? { organizations: String(orgId) } : undefined
  )
  const { data: projectsData } = useProjects()
  const { data: eventsData } = useEvents({ page_size: "200" })
  const { data: indicatorsData } = useAllIndicators()

  const interactions = useMemo(() => interactionsData?.results || [], [interactionsData?.results])
  const respondents = useMemo(() => respondentsData?.results || [], [respondentsData?.results])
  const assessments = useMemo(() => assessmentsData?.results || [], [assessmentsData?.results])
  const projects = useMemo(() => projectsData?.results || [], [projectsData?.results])
  const events = useMemo(() => eventsData?.results || [], [eventsData?.results])
  const allIndicators = useMemo(() => indicatorsData || [], [indicatorsData])

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [entryMode, setEntryMode] = useState<"assessment" | "derived">("assessment")
  const [derivedOutputIndicatorId, setDerivedOutputIndicatorId] = useState("")
  const [derivedRule, setDerivedRule] = useState<DerivationRule | null>(null)
  const [formData, setFormData] = useState({
    respondentId: "",
    assessmentId: "",
    projectId: "",
    eventId: "",
    date: "",
    notes: "",
  })

  const selectedAssessmentId = useMemo(() => {
    const id = Number(formData.assessmentId)
    return Number.isFinite(id) ? id : null
  }, [formData.assessmentId])
  const { data: selectedAssessment } = useAssessment(selectedAssessmentId)

  const screeningItems = useMemo(() => {
    if (entryMode === "assessment") {
      return selectedAssessment?.indicators_detail || []
    }
    if (entryMode === "derived" && derivedRule?.source_indicator) {
      return [
        {
          id: `derived-${derivedRule.source_indicator}`,
          indicator: String(derivedRule.source_indicator),
          indicator_detail: {
            id: String(derivedRule.source_indicator),
            name: derivedRule.source_indicator_name || "Indicator",
            code: derivedRule.source_indicator_code || "",
            type: "text",
            category: "other",
          },
          order: 1,
          is_required: true,
        },
      ]
    }
    return []
  }, [derivedRule, entryMode, selectedAssessment?.indicators_detail])

  const [answersByIndicatorId, setAnswersByIndicatorId] = useState<Record<string, unknown>>({})
  const [indicatorDetailsById, setIndicatorDetailsById] = useState<Record<string, Indicator>>({})
  const didPrefill = useRef(false)
  const selectedRespondent = useMemo(() => {
    if (!formData.respondentId) return null
    return (
      respondents.find((resp) => String(resp.id) === String(formData.respondentId)) || null
    )
  }, [formData.respondentId, respondents])

  const selectableEvents = useMemo(() => {
    const respondentOrgId = selectedRespondent?.organization
      ? String(selectedRespondent.organization)
      : null
    const userOrgRaw =
      (user as unknown as { organizationId?: string | number; organization?: string | number } | null)
        ?.organizationId ??
      (user as unknown as { organizationId?: string | number; organization?: string | number } | null)
        ?.organization
    const userOrgId = userOrgRaw ? String(userOrgRaw) : null
    const targetOrgId = respondentOrgId || userOrgId
    if (!targetOrgId) return events

    return events.filter((event) => {
      const ownerOrg = event.organization ? String(event.organization) : ""
      const participating = (event.participating_organizations || []).map((id) => String(id))
      return ownerOrg === targetOrgId || participating.includes(targetOrgId)
    })
  }, [events, selectedRespondent?.organization, user])

  useEffect(() => {
    if (!formData.eventId) return
    const stillValid = selectableEvents.some((event) => String(event.id) === String(formData.eventId))
    if (!stillValid) {
      setFormData((prev) => ({ ...prev, eventId: "" }))
    }
  }, [formData.eventId, selectableEvents])

  const handleDownloadTemplate = () => {
    const headers = [
      "respondent_id",
      "assessment_id",
      "project_id",
      "date",
      "notes",
      "indicator_code",
      "response_value",
    ]
    const csv = `${headers.join(",")}\n`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `interactions_template_${toIsoDate()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleUploadFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    toast({
      title: "File selected",
      description: `Selected ${file.name}. Continue import from Uploads.`,
    })
    router.push("/uploads")
    if (uploadInputRef.current) {
      uploadInputRef.current.value = ""
    }
  }

  useEffect(() => {
    if (didPrefill.current) return
    const respondentId = searchParams.get("respondentId")
    if (respondentId) {
      setFormData((prev) => ({
        ...prev,
        respondentId,
      }))
      setIsCreateOpen(true)
    }
    didPrefill.current = true
  }, [searchParams])

  useEffect(() => {
    let cancelled = false

    const loadRule = async () => {
      if (entryMode !== "derived" || !derivedOutputIndicatorId) {
        setDerivedRule(null)
        return
      }

      try {
        const data = await aggregatesService.listDerivationRules({
          output_indicator: derivedOutputIndicatorId,
          is_active: "true",
          page_size: "1",
        })
        if (cancelled) return
        setDerivedRule((data.results || [])[0] || null)
      } catch {
        if (cancelled) return
        setDerivedRule(null)
      }
    }

    loadRule()
    return () => {
      cancelled = true
    }
  }, [derivedOutputIndicatorId, entryMode])

  useEffect(() => {
    let cancelled = false

    const loadIndicatorDetails = async () => {
      const assessmentItems = selectedAssessment?.indicators_detail || []
      const indicatorIds = assessmentItems.map((i) => String(i.indicator)).filter(Boolean)
      if (entryMode === "derived" && derivedRule?.source_indicator) {
        indicatorIds.push(String(derivedRule.source_indicator))
      }
      const uniqueIds = Array.from(new Set(indicatorIds)).map((id) => String(id))
      const missingIds = uniqueIds.filter((id) => !indicatorDetailsById[String(id)])
      if (missingIds.length === 0) return

      try {
        const results = await Promise.all(
          missingIds.map(async (id) => {
            try {
              const indicator = await indicatorsService.get(Number(id))
              return [id, indicator] as const
            } catch {
              return null
            }
          }),
        )
        if (cancelled) return

        const next: Record<string, Indicator> = {}
        for (const r of results) {
          if (!r) continue
          next[String(r[0])] = r[1]
        }
        if (Object.keys(next).length > 0) {
          setIndicatorDetailsById((prev) => ({ ...prev, ...next }))
        }
      } catch {
        // ignore
      }
    }

    loadIndicatorDetails()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssessmentId, selectedAssessment?.indicators_detail, derivedRule?.source_indicator, entryMode])

  const visibilityByIndicatorId = useMemo(() => {
    const visibility: Record<string, boolean> = {}
    const indicatorsForEvaluation: Record<string, IndicatorWithLogic> = {}

    for (const item of screeningItems) {
      const indicatorId = String(item.indicator)
      const indicator =
        (indicatorDetailsById[indicatorId] as IndicatorWithLogic | undefined) ||
        (item.indicator_detail as unknown as IndicatorWithLogic | undefined)
      if (indicator) indicatorsForEvaluation[indicatorId] = indicator
    }

    for (const item of screeningItems) {
      const indicatorId = String(item.indicator)
      const indicator =
        (indicatorDetailsById[indicatorId] as IndicatorWithLogic | undefined) ||
        (item.indicator_detail as unknown as IndicatorWithLogic | undefined)

      if (!indicator) {
        visibility[indicatorId] = true
        continue
      }

      const conditions = getLogicConditions(indicator)
      if (conditions.length === 0) {
        visibility[indicatorId] = true
        continue
      }

      const conditionResults = conditions.map((condition) =>
        evaluateLogicCondition({
          condition,
          responses: answersByIndicatorId,
          indicatorsById: indicatorsForEvaluation,
          respondent: (selectedRespondent || null) as GenericRecord | null,
        }),
      )

      visibility[indicatorId] =
        getLogicGroupOperator(indicator) === "OR"
          ? conditionResults.some(Boolean)
          : conditionResults.every(Boolean)
    }

    return visibility
  }, [answersByIndicatorId, indicatorDetailsById, screeningItems, selectedRespondent])

  const optionsByIndicatorId = useMemo(() => {
    const mapped: Record<string, IndicatorOption[]> = {}

    for (const item of screeningItems) {
      const indicatorId = String(item.indicator)
      const indicator =
        (indicatorDetailsById[indicatorId] as IndicatorWithLogic | undefined) ||
        (item.indicator_detail as unknown as IndicatorWithLogic | undefined)
      const sourceOptions = getAssessmentQuestionOptions(item, indicator)
      const allowNone = Boolean((indicator as GenericRecord | undefined)?.allow_none)
      const baseOptions =
        allowNone && !sourceOptions.some((opt) => asString(opt.value).toLowerCase() === "none")
          ? [...sourceOptions, { label: "None of the above", value: "none" }]
          : sourceOptions
      const sourceIndicatorId = indicator ? getMatchOptionsSourceId(indicator) : null
      if (!sourceIndicatorId) {
        mapped[indicatorId] = baseOptions
        continue
      }

      const sourceValue = normalizeComparisonValue(answersByIndicatorId[sourceIndicatorId])
      const selectedSourceValues = toSelectedStrings(sourceValue)
      if (selectedSourceValues.length === 0) {
        mapped[indicatorId] = baseOptions.filter((opt) => asString(opt.value).toLowerCase() === "none")
        continue
      }

      mapped[indicatorId] = baseOptions.filter(
        (opt) =>
          selectedSourceValues.includes(asString(opt.value)) ||
          selectedSourceValues.includes(asString(opt.label)) ||
          asString(opt.value).toLowerCase() === "none",
      )
    }

    return mapped
  }, [answersByIndicatorId, indicatorDetailsById, screeningItems])

  useEffect(() => {
    setAnswersByIndicatorId((previous) => {
      let changed = false
      const next = { ...previous }

      for (const item of screeningItems) {
        const indicatorId = String(item.indicator)
        const indicator =
          (indicatorDetailsById[indicatorId] as IndicatorWithLogic | undefined) ||
          (item.indicator_detail as unknown as IndicatorWithLogic | undefined)
        const visible = visibilityByIndicatorId[indicatorId] !== false

        if (!visible && indicatorId in next) {
          delete next[indicatorId]
          changed = true
          continue
        }

        if (!(indicatorId in next) || !indicator) continue
        const rawType = getAssessmentQuestionRawType(item, indicator)
        const type = normalizeIndicatorType(rawType as RawIndicatorType)
        const currentValue = normalizeComparisonValue(next[indicatorId])
        const currentOptions = optionsByIndicatorId[indicatorId] || []
        const allowed = new Set(currentOptions.map((opt) => asString(opt.value)))

        if (type === "select") {
          const current = asString(currentValue)
          if (current && !allowed.has(current)) {
            next[indicatorId] = ""
            changed = true
          }
        }

        if (type === "multiselect" && Array.isArray(currentValue)) {
          const filtered = currentValue
            .map((v) => asString(v))
            .filter((v) => allowed.has(v))
          if (JSON.stringify(filtered) !== JSON.stringify(currentValue)) {
            next[indicatorId] = filtered
            changed = true
          }
        }

        if (rawType.toLowerCase() === "boolean") {
          const current = parseBooleanLike(currentValue)
          if (current === null && currentValue !== "" && currentValue !== null && currentValue !== undefined) {
            next[indicatorId] = ""
            changed = true
          }
        }
      }

      return changed ? next : previous
    })
  }, [indicatorDetailsById, optionsByIndicatorId, screeningItems, visibilityByIndicatorId])

  const visibleScreeningItems = useMemo(
    () => screeningItems.filter((item) => visibilityByIndicatorId[String(item.indicator)] !== false),
    [screeningItems, visibilityByIndicatorId],
  )

  const resetDialog = () => {
    setFormData({ respondentId: "", assessmentId: "", projectId: "", eventId: "", date: "", notes: "" })
    setEntryMode("assessment")
    setDerivedOutputIndicatorId("")
    setDerivedRule(null)
    setAnswersByIndicatorId({})
    setIsCreateOpen(false)
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
        <p className="text-muted-foreground">Failed to load interactions</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interactions"
        description="Record and manage respondent interactions"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Respondents", href: "/respondents" },
          { label: "Interactions" },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDownloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download Template
            </Button>
            <Button variant="outline" onClick={() => uploadInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Data
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              aria-label="Select interaction upload file"
              title="Select interaction upload file"
              className="hidden"
              onChange={handleUploadFileSelect}
            />
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Interaction
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Interactions</CardTitle>
          <CardDescription>Latest recorded interactions across all projects</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {interactions.map((interaction) => {
              const respondent = respondents.find((r) => r.id === interaction.respondent)
              return (
                <div
                  key={interaction.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-secondary/50"
                >
                  <div className="flex items-center gap-4">
                    <div className="rounded-full bg-primary/10 p-2">
                      <FileSpreadsheet className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {interaction.assessment_name || "Assessment"}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span>
                          {respondent?.full_name ||
                            `${respondent?.first_name ?? ""} ${respondent?.last_name ?? ""}`}
                        </span>
                        <span>|</span>
                        <span>{interaction.project_name || "—"}</span>
                        <span>|</span>
                        <span>{interaction.event_name || "Non-event"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="secondary">
                      {interaction.responses_count || interaction.responses?.length || 0} responses
                    </Badge>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatDate(interaction.date)}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        interaction.assessment
                          ? router.push(`/indicators/assessments/${interaction.assessment}`)
                          : router.push(`/respondents/${interaction.respondent}`)
                      }
                    >
                      View
                    </Button>
                  </div>
                </div>
              )
            })}
            {interactions.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
                No interactions recorded yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (!open) resetDialog()
          else setIsCreateOpen(true)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Interaction</DialogTitle>
            <DialogDescription>
              Record an interaction for a respondent and assessment.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="interaction-entry-mode">Entry Type *</Label>
              <Select
                value={entryMode}
                onValueChange={(value) => {
                  const mode = value as "assessment" | "derived"
                  setEntryMode(mode)
                  setAnswersByIndicatorId({})
                  if (mode === "assessment") {
                    setDerivedOutputIndicatorId("")
                    setDerivedRule(null)
                  } else {
                    setFormData((prev) => ({ ...prev, assessmentId: "" }))
                  }
                }}
              >
                <SelectTrigger id="interaction-entry-mode">
                  <SelectValue placeholder="Select entry type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assessment">Assessment (question set)</SelectItem>
                  <SelectItem value="derived">Derived Indicator (linked screening)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {entryMode === "assessment" ? (
              <div className="space-y-2">
                <Label htmlFor="interaction-assessment">Assessment *</Label>
                <Select
                  value={formData.assessmentId}
                  onValueChange={(value) => setFormData({ ...formData, assessmentId: value })}
                >
                  <SelectTrigger id="interaction-assessment">
                    <SelectValue placeholder="Select assessment" />
                  </SelectTrigger>
                  <SelectContent>
                    {assessments.map((assessment) => (
                      <SelectItem key={assessment.id} value={assessment.id.toString()}>
                        {assessment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="interaction-derived-output">Derived Output Indicator *</Label>
                <Select value={derivedOutputIndicatorId} onValueChange={setDerivedOutputIndicatorId}>
                  <SelectTrigger id="interaction-derived-output">
                    <SelectValue placeholder="Select output indicator" />
                  </SelectTrigger>
                  <SelectContent>
                    {allIndicators
                      .filter((i) => i.type === "number" || i.type === "percentage")
                      .map((indicator) => (
                        <SelectItem key={indicator.id} value={String(indicator.id)}>
                          {indicator.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {derivedOutputIndicatorId ? (
                  <p className="text-xs text-muted-foreground">
                    {derivedRule
                      ? `Linked screening indicator: ${derivedRule.source_indicator_name || derivedRule.source_indicator_code || derivedRule.source_indicator}`
                      : "No derivation rule found for this indicator yet. Create one in Aggregates → Auto-calculate."}
                  </p>
                ) : null}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="interaction-respondent">Respondent *</Label>
              <Select
                value={formData.respondentId}
                onValueChange={(value) => setFormData({ ...formData, respondentId: value })}
              >
                <SelectTrigger id="interaction-respondent">
                  <SelectValue placeholder="Select respondent" />
                </SelectTrigger>
                <SelectContent>
                  {respondents.map((resp) => (
                    <SelectItem key={resp.id} value={resp.id.toString()}>
                      {resp.full_name || `${resp.first_name} ${resp.last_name}`} ({resp.unique_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="interaction-project">Project (optional)</Label>
              <Select
                value={formData.projectId}
                onValueChange={(value) => setFormData({ ...formData, projectId: value })}
              >
                <SelectTrigger id="interaction-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id.toString()}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="interaction-date">Date *</Label>
              <Input
                id="interaction-date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="interaction-event">Add Event (optional)</Label>
              <Select
                value={formData.eventId || "none"}
                onValueChange={(value) =>
                  setFormData({ ...formData, eventId: value === "none" ? "" : value })
                }
              >
                <SelectTrigger id="interaction-event">
                  <SelectValue placeholder="Link interaction to an event" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No event</SelectItem>
                  {selectableEvents.map((event) => (
                    <SelectItem key={event.id} value={String(event.id)}>
                      {event.title} ({event.start_date})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.respondentId && selectableEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No eligible events found for this respondent organization.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="interaction-notes">Notes</Label>
              <Textarea
                id="interaction-notes"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>

            {visibleScreeningItems.length ? (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Screening Indicators</p>
                  <p className="text-xs text-muted-foreground">
                    Responses will be saved and linked to indicators.
                  </p>
                </div>

                <div className="space-y-4">
                  {visibleScreeningItems
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((item) => {
                      const indicatorId = String(item.indicator)
                      const indicator =
                        indicatorDetailsById[indicatorId] ||
                        (item.indicator_detail as unknown as Indicator | undefined)

                      const rawType = getAssessmentQuestionRawType(item, indicator)
                      const type = normalizeIndicatorType(rawType as RawIndicatorType)
                      const isBooleanType = rawType.toLowerCase() === "boolean"
                      const labelText = getAssessmentQuestionText(item, indicator)
                      const codeText = indicator?.code || item.indicator_detail?.code || ""
                      const options = optionsByIndicatorId[indicatorId] || []
                      const subLabels = getAssessmentQuestionSubLabels(item, indicator)
                      const currentValue = answersByIndicatorId[indicatorId]

                      return (
                        <div key={item.id || indicatorId} className="space-y-2">
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-0.5">
                              <Label className="text-sm">
                                {labelText}
                                {item.is_required ? " *" : ""}
                              </Label>
                              {codeText ? (
                                <p className="text-xs text-muted-foreground">{codeText}</p>
                              ) : null}
                              {item.help_text ? (
                                <p className="text-xs text-muted-foreground">{item.help_text}</p>
                              ) : null}
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {rawType.replace(/_/g, " ")}
                            </Badge>
                          </div>

                          {type === "yes_no" ? (
                            <Select
                              value={
                                isBooleanType
                                  ? parseBooleanLike(currentValue) === true
                                    ? "true"
                                    : parseBooleanLike(currentValue) === false
                                      ? "false"
                                      : ""
                                  : typeof currentValue === "string"
                                    ? currentValue
                                    : ""
                              }
                              onValueChange={(v) =>
                                setAnswersByIndicatorId((prev) => ({
                                  ...prev,
                                  [indicatorId]: isBooleanType ? v === "true" : v,
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {isBooleanType ? (
                                  <>
                                    <SelectItem value="true">Yes</SelectItem>
                                    <SelectItem value="false">No</SelectItem>
                                  </>
                                ) : (
                                  <>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          ) : null}

                          {type === "number" || type === "percentage" ? (
                            <Input
                              type="number"
                              value={
                                typeof currentValue === "number" || typeof currentValue === "string"
                                  ? String(currentValue)
                                  : ""
                              }
                              onChange={(e) =>
                                setAnswersByIndicatorId((prev) => ({
                                  ...prev,
                                  [indicatorId]: e.target.value === "" ? "" : Number(e.target.value),
                                }))
                              }
                            />
                          ) : null}

                          {type === "date" ? (
                            <Input
                              type="date"
                              value={typeof currentValue === "string" ? currentValue : ""}
                              onChange={(e) =>
                                setAnswersByIndicatorId((prev) => ({ ...prev, [indicatorId]: e.target.value }))
                              }
                            />
                          ) : null}

                          {type === "text" ? (
                            <Textarea
                              rows={2}
                              value={typeof currentValue === "string" ? currentValue : ""}
                              onChange={(e) =>
                                setAnswersByIndicatorId((prev) => ({ ...prev, [indicatorId]: e.target.value }))
                              }
                            />
                          ) : null}

                          {type === "select" ? (
                            <Select
                              value={asString(currentValue)}
                              onValueChange={(v) =>
                                setAnswersByIndicatorId((prev) => ({ ...prev, [indicatorId]: v }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {options.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}

                          {type === "multiselect" ? (
                            <div className="space-y-2">
                              {options.map((opt) => {
                                const selected = Array.isArray(currentValue)
                                  ? (currentValue as unknown[]).map((v) => asString(v)).includes(opt.value)
                                  : false
                                return (
                                  <div key={opt.value} className="flex items-center gap-2">
                                    <Checkbox
                                      checked={selected}
                                      onCheckedChange={(checked) => {
                                        setAnswersByIndicatorId((prev) => {
                                          const existing = Array.isArray(prev[indicatorId])
                                            ? (prev[indicatorId] as string[])
                                            : []
                                          const next = checked
                                            ? Array.from(new Set([...existing, opt.value]))
                                            : existing.filter((v) => v !== opt.value)
                                          return { ...prev, [indicatorId]: next }
                                        })
                                      }}
                                    />
                                    <span className="text-sm">{opt.label}</span>
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}

                          {type === "multi_int" ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              {(rawType.toLowerCase() === "multint"
                                ? options.map((opt) => ({ key: opt.value, label: opt.label }))
                                : (subLabels.length ? subLabels : ["Value"]).map((label) => ({ key: label, label }))
                              ).map(({ key: subKey, label: subLabel }) => {
                                const current =
                                  rawType.toLowerCase() === "multint"
                                    ? Array.isArray(currentValue)
                                      ? (currentValue as Array<{ option?: unknown; value?: unknown }>).find(
                                          (entry) => asString(entry?.option) === asString(subKey),
                                        )?.value
                                      : undefined
                                    : typeof currentValue === "object" && currentValue !== null
                                      ? (currentValue as Record<string, unknown>)[subLabel]
                                      : undefined
                                return (
                                  <div key={subKey} className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">{subLabel}</Label>
                                    <Input
                                      type="number"
                                      value={
                                        typeof current === "number" || typeof current === "string"
                                          ? String(current)
                                          : ""
                                      }
                                      onChange={(e) =>
                                        setAnswersByIndicatorId((prev) => {
                                          if (rawType.toLowerCase() === "multint") {
                                            const existing = Array.isArray(prev[indicatorId])
                                              ? ([...(prev[indicatorId] as Array<{ option: string; value: unknown }>)] as Array<{
                                                  option: string
                                                  value: unknown
                                                }>)
                                              : []
                                            const optionId = asString(subKey)
                                            const index = existing.findIndex(
                                              (entry) => asString(entry.option) === optionId,
                                            )
                                            const nextValue = e.target.value === "" ? "" : Number(e.target.value)
                                            if (index >= 0) existing[index] = { ...existing[index], option: optionId, value: nextValue }
                                            else existing.push({ option: optionId, value: nextValue })
                                            return { ...prev, [indicatorId]: existing }
                                          }

                                          const existing =
                                            typeof prev[indicatorId] === "object" &&
                                            prev[indicatorId] !== null
                                              ? (prev[indicatorId] as Record<string, unknown>)
                                              : {}
                                          const next = {
                                            ...existing,
                                            [subLabel]: e.target.value === "" ? "" : Number(e.target.value),
                                          }
                                          return { ...prev, [indicatorId]: next }
                                        })
                                      }
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                </div>
              </div>
            ) : screeningItems.length ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                This respondent is not currently eligible for any questions in this assessment.
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>
              Cancel
            </Button>
            <Button
              disabled={
                isSubmitting ||
                (entryMode === "assessment"
                  ? !formData.assessmentId
                  : !derivedOutputIndicatorId || !derivedRule) ||
                (entryMode === "derived" &&
                  (!formData.projectId || formData.projectId === "none")) ||
                !formData.respondentId ||
                !formData.date
              }
              onClick={async () => {
                setIsSubmitting(true)
                try {
                  if (entryMode === "derived" && (!formData.projectId || formData.projectId === "none")) {
                    toast({
                      title: "Validation Error",
                      description: "Project is required for derived indicators.",
                      variant: "destructive",
                    })
                    setIsSubmitting(false)
                    return
                  }

                  const questions = visibleScreeningItems
                  const missingRequired = questions.find((q) => {
                    if (!q.is_required) return false
                    const indicatorId = String(q.indicator)
                    const indicator =
                      indicatorDetailsById[indicatorId] ||
                      (q.indicator_detail as unknown as Indicator | undefined)
                    const type = getAssessmentQuestionType(q, indicator)
                    const value = answersByIndicatorId[indicatorId]
                    return isEmptyResponseValue(type, value)
                  })

                  if (missingRequired) {
                    toast({
                      title: "Validation Error",
                      description: "Please answer all required screening questions.",
                      variant: "destructive",
                    })
                    setIsSubmitting(false)
                    return
                  }

                  const responses = questions
                    .map((q) => {
                      const indicatorId = String(q.indicator)
                      const indicator =
                        indicatorDetailsById[indicatorId] ||
                        (q.indicator_detail as unknown as Indicator | undefined)
                      const type = getAssessmentQuestionType(q, indicator)
                      const value = answersByIndicatorId[indicatorId]
                      if (isEmptyResponseValue(type, value)) return null
                      return { indicator: Number(indicatorId), value }
                    })
                    .filter(Boolean) as Array<{ indicator: number; value: unknown }>

                  await interactionsService.create({
                    respondent: Number(formData.respondentId),
                    assessment: entryMode === "assessment" && formData.assessmentId ? Number(formData.assessmentId) : undefined,
                    project:
                      formData.projectId && formData.projectId !== "none"
                        ? Number(formData.projectId)
                        : undefined,
                    event:
                      formData.eventId && formData.eventId !== "none"
                        ? Number(formData.eventId)
                        : undefined,
                    date: formData.date,
                    notes: formData.notes || undefined,
                    responses,
                  })
                  toast({
                    title: "Saved",
                    description: "Interaction recorded successfully.",
                  })
                  mutate()
                  resetDialog()
                } catch {
                  toast({
                    title: "Error",
                    description: "Failed to save interaction",
                    variant: "destructive",
                  })
                } finally {
                  setIsSubmitting(false)
                }
              }}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Interaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
