"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { assessmentsService } from "@/lib/api"
import { useAssessment, useAllIndicators } from "@/lib/hooks/use-api"
import { useSmartBack } from "@/lib/hooks/use-smart-back"
import { useToast } from "@/hooks/use-toast"
import type { AssessmentQuestion, IndicatorType } from "@/lib/types"

const typeLabels: Record<string, string> = {
  yes_no: "Yes/No",
  number: "Number",
  percentage: "Percentage",
  text: "Text",
  select: "Single Select",
  multiselect: "Multiselect",
  date: "Date",
  multi_int: "Multiple Numbers",
}

const rollupModeLabels: Record<string, string> = {
  none: "No automatic roll-up",
  count_all: "Count every answered response",
  count_selected: "Count selected values only",
  sum_numeric: "Use numeric answer total",
}

type QuestionFormState = {
  questionId: string | null
  indicatorId: string
  questionText: string
  helpText: string
  responseType: IndicatorType | ""
  optionsText: string
  subLabelsText: string
  aggregateMode: "none" | "count_all" | "count_selected" | "sum_numeric"
  aggregateMatchValuesText: string
  orderValue: string
  isRequired: boolean
}

const emptyQuestionForm: QuestionFormState = {
  questionId: null,
  indicatorId: "",
  questionText: "",
  helpText: "",
  responseType: "",
  optionsText: "",
  subLabelsText: "",
  aggregateMode: "none",
  aggregateMatchValuesText: "",
  orderValue: "",
  isRequired: true,
}

function parseOptionLines(value: string): Array<{ label: string; value: string }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelPart, valuePart] = line.split("|")
      const label = labelPart.trim()
      const optionValue = (valuePart ?? labelPart).trim()
      return { label, value: optionValue }
    })
}

function stringifyOptionLines(options: Array<string | { label: string; value: string }> | undefined): string {
  if (!Array.isArray(options) || options.length === 0) return ""
  return options
    .map((option) => {
      if (typeof option === "string") return option
      const label = String(option.label || "").trim()
      const value = String(option.value || "").trim()
      if (!label && !value) return ""
      return label && value && label !== value ? `${label}|${value}` : label || value
    })
    .filter(Boolean)
    .join("\n")
}

function getQuestionPrompt(question: AssessmentQuestion): string {
  return question.question_text_display || question.question_text || question.indicator_detail?.name || "Question"
}

function getQuestionType(question: AssessmentQuestion): IndicatorType {
  return (question.response_type_display ||
    question.response_type ||
    question.indicator_detail?.type ||
    "text") as IndicatorType
}

function stringifyMatchValues(values: unknown[] | undefined): string {
  if (!Array.isArray(values) || values.length === 0) return ""
  return values.map((value) => String(value ?? "").trim()).filter(Boolean).join("\n")
}

export default function AssessmentDetailPage() {
  const handleBack = useSmartBack("/indicators/assessments")
  const { toast } = useToast()
  const params = useParams()
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id
  const assessmentId = rawId ? String(rawId) : null

  const { data: assessment, isLoading, error, mutate } = useAssessment(assessmentId)
  const { data: indicatorsData } = useAllIndicators()

  const indicators = useMemo(() => indicatorsData || [], [indicatorsData])
  const indicatorOptions = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.is_active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [indicators],
  )
  const indicatorMap = useMemo(
    () => Object.fromEntries(indicatorOptions.map((indicator) => [String(indicator.id), indicator])),
    [indicatorOptions],
  )

  const [formState, setFormState] = useState({
    name: "",
    description: "",
  })
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(emptyQuestionForm)
  const [isSavingAssessment, setIsSavingAssessment] = useState(false)
  const [isSavingQuestion, setIsSavingQuestion] = useState(false)
  const [removingQuestionId, setRemovingQuestionId] = useState<string | null>(null)

  const questions = useMemo(
    () =>
      (assessment?.indicators_detail || [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [assessment?.indicators_detail],
  )

  const selectedIndicator = questionForm.indicatorId
    ? indicatorMap[questionForm.indicatorId]
    : undefined
  const effectiveResponseType = questionForm.responseType || selectedIndicator?.type || ""
  const parsedQuestionOptions = useMemo(
    () => parseOptionLines(questionForm.optionsText),
    [questionForm.optionsText],
  )
  const parsedQuestionSubLabels = useMemo(
    () =>
      questionForm.subLabelsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [questionForm.subLabelsText],
  )
  const parsedAggregateMatchValues = useMemo(
    () =>
      questionForm.aggregateMatchValuesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [questionForm.aggregateMatchValuesText],
  )

  useEffect(() => {
    if (assessment) {
      setFormState({
        name: assessment.name || "",
        description: assessment.description || "",
      })
    }
  }, [assessment])

  const resetQuestionForm = () => {
    setQuestionForm(emptyQuestionForm)
  }

  const startEditingQuestion = (question: AssessmentQuestion) => {
    setQuestionForm({
      questionId: String(question.id),
      indicatorId: String(question.indicator),
      questionText: question.question_text || question.question_text_display || "",
      helpText: question.help_text || "",
      responseType: (question.response_type || "") as IndicatorType | "",
      optionsText: stringifyOptionLines(question.response_options),
      subLabelsText: Array.isArray(question.response_sub_labels)
        ? question.response_sub_labels.join("\n")
        : "",
      aggregateMode: (question.aggregate_mode || "none") as QuestionFormState["aggregateMode"],
      aggregateMatchValuesText: stringifyMatchValues(question.aggregate_match_values),
      orderValue: String(question.order ?? ""),
      isRequired: question.is_required,
    })
  }

  const handleSaveAssessment = async () => {
    if (!assessment) return
    if (!formState.name.trim()) {
      toast({
        title: "Assessment name required",
        description: "Please provide a name for this assessment.",
        variant: "destructive",
      })
      return
    }

    setIsSavingAssessment(true)
    try {
      await assessmentsService.update(String(assessment.id), {
        name: formState.name.trim(),
        description: formState.description.trim() || undefined,
      })
      toast({ title: "Saved", description: "Assessment details updated." })
      await mutate()
    } catch (err) {
      console.error("Failed to update assessment", err)
      toast({
        title: "Error",
        description: "Failed to update assessment details.",
        variant: "destructive",
      })
    } finally {
      setIsSavingAssessment(false)
    }
  }

  const handleSaveQuestion = async () => {
    if (!assessment) return
    if (!questionForm.indicatorId) {
      toast({
        title: "Indicator required",
        description: "Choose the reporting indicator this question should feed.",
        variant: "destructive",
      })
      return
    }
    if (!questionForm.questionText.trim()) {
      toast({
        title: "Question prompt required",
        description: "Enter the question respondents should answer.",
        variant: "destructive",
      })
      return
    }

    const indicatorType = selectedIndicator?.type
    const finalType = (effectiveResponseType || indicatorType || "text") as IndicatorType
    const fallbackOptions = Array.isArray(selectedIndicator?.options) ? selectedIndicator.options : []
    const fallbackSubLabels = Array.isArray(selectedIndicator?.sub_labels) ? selectedIndicator.sub_labels : []

    if (
      (finalType === "select" || finalType === "multiselect") &&
      parsedQuestionOptions.length === 0 &&
      fallbackOptions.length === 0
    ) {
      toast({
        title: "Options required",
        description: "Add answer options for this question or use an indicator that already has options.",
        variant: "destructive",
      })
      return
    }

    if (
      finalType === "multi_int" &&
      parsedQuestionSubLabels.length === 0 &&
      fallbackSubLabels.length === 0
    ) {
      toast({
        title: "Labels required",
        description: "Add sub-labels for this multiple number question.",
        variant: "destructive",
      })
      return
    }

    const defaultOrder = questions.length > 0
      ? Math.max(...questions.map((question) => Number(question.order || 0))) + 1
      : 1

    setIsSavingQuestion(true)
    try {
      await assessmentsService.saveQuestion(String(assessment.id), {
        question_id: questionForm.questionId || undefined,
        indicator_id: questionForm.indicatorId,
        question_text: questionForm.questionText.trim(),
        help_text: questionForm.helpText.trim() || undefined,
        response_type: questionForm.responseType || undefined,
        response_options: parsedQuestionOptions.length > 0 ? parsedQuestionOptions : undefined,
        response_sub_labels: parsedQuestionSubLabels.length > 0 ? parsedQuestionSubLabels : undefined,
        aggregate_mode: questionForm.aggregateMode,
        aggregate_match_values:
          questionForm.aggregateMode === "count_selected" && parsedAggregateMatchValues.length > 0
            ? parsedAggregateMatchValues
            : undefined,
        order: questionForm.orderValue ? Number(questionForm.orderValue) : defaultOrder,
        is_required: questionForm.isRequired,
      })

      toast({
        title: questionForm.questionId ? "Question updated" : "Question added",
        description: "This assessment question is now linked to its reporting indicator.",
      })
      resetQuestionForm()
      await mutate()
    } catch (err) {
      console.error("Failed to save assessment question", err)
      const description =
        err instanceof Error && err.message
          ? err.message
          : "Failed to save the assessment question."
      toast({
        title: "Error",
        description,
        variant: "destructive",
      })
    } finally {
      setIsSavingQuestion(false)
    }
  }

  const handleRemoveQuestion = async (question: AssessmentQuestion) => {
    if (!assessment) return
    if (!confirm(`Remove "${getQuestionPrompt(question)}" from this assessment?`)) return

    setRemovingQuestionId(String(question.id))
    try {
      await assessmentsService.removeQuestion(String(assessment.id), String(question.id))
      toast({ title: "Removed", description: "Question removed from assessment." })
      if (questionForm.questionId === String(question.id)) {
        resetQuestionForm()
      }
      await mutate()
    } catch (err) {
      console.error("Failed to remove assessment question", err)
      toast({
        title: "Error",
        description: "Failed to remove question.",
        variant: "destructive",
      })
    } finally {
      setRemovingQuestionId((current) => (current === String(question.id) ? null : current))
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Assessment not found</p>
        <Button onClick={handleBack}>
          Back to Assessments
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={assessment.name}
        description="Build assessment questions and link each one to a reporting indicator"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Indicators", href: "/indicators" },
          { label: "Assessments", href: "/indicators/assessments" },
          { label: assessment.name },
        ]}
        actions={
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
            <CardDescription>
              Each question collects a response and stores it against the linked indicator.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {questions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                No questions added yet. Use the builder on the right to create the first one.
              </div>
            ) : (
              questions.map((question, index) => {
                const questionType = getQuestionType(question)
                return (
                  <div
                    key={question.id}
                    className="rounded-xl border border-border bg-card p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Question {index + 1}</Badge>
                          <Badge variant="secondary">{typeLabels[questionType] || questionType}</Badge>
                          {question.is_required ? (
                            <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/10">
                              Required
                            </Badge>
                          ) : null}
                        </div>
                        <div>
                          <p className="text-base font-semibold text-foreground">
                            {getQuestionPrompt(question)}
                          </p>
                          {question.help_text ? (
                            <p className="mt-1 text-sm text-muted-foreground">{question.help_text}</p>
                          ) : null}
                        </div>
                        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                          <p>
                            Linked indicator:{" "}
                            <span className="font-medium text-foreground">
                              {question.indicator_detail?.name || "Indicator"}
                            </span>
                          </p>
                          <p>
                            Code:{" "}
                            <span className="font-medium text-foreground">
                              {question.indicator_detail?.code || "—"}
                            </span>
                          </p>
                          <p>
                            Order:{" "}
                            <span className="font-medium text-foreground">{question.order ?? 0}</span>
                          </p>
                          <p>
                            Roll-up:{" "}
                            <span className="font-medium text-foreground">
                              {rollupModeLabels[question.aggregate_mode || "none"] || "No automatic roll-up"}
                            </span>
                          </p>
                          <p>
                            Saved to indicator type:{" "}
                            <span className="font-medium text-foreground">
                              {typeLabels[question.indicator_detail?.type || ""] ||
                                question.indicator_detail?.type ||
                                "—"}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEditingQuestion(question)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveQuestion(question)}
                          disabled={removingQuestionId === String(question.id)}
                        >
                          {removingQuestionId === String(question.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Assessment Details</CardTitle>
              <CardDescription>Update the name and description shown to staff.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="assessment-name">Name</Label>
                <Input
                  id="assessment-name"
                  value={formState.name}
                  onChange={(e) => setFormState((current) => ({ ...current, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assessment-description">Description</Label>
                <Textarea
                  id="assessment-description"
                  rows={3}
                  value={formState.description}
                  onChange={(e) =>
                    setFormState((current) => ({ ...current, description: e.target.value }))
                  }
                />
              </div>
              <Button onClick={handleSaveAssessment} disabled={isSavingAssessment}>
                {isSavingAssessment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Details
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{questionForm.questionId ? "Edit Question" : "Add Question"}</CardTitle>
              <CardDescription>
                Create the question staff will answer, then map it to the indicator it should update.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="question-indicator">Reporting Indicator</Label>
                <Select
                  value={questionForm.indicatorId}
                  onValueChange={(value) =>
                    setQuestionForm((current) => ({ ...current, indicatorId: value }))
                  }
                >
                  <SelectTrigger id="question-indicator">
                    <SelectValue placeholder="Select indicator" />
                  </SelectTrigger>
                  <SelectContent>
                    {indicatorOptions.map((indicator) => (
                      <SelectItem key={indicator.id} value={String(indicator.id)}>
                        {indicator.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedIndicator ? (
                  <p className="text-xs text-muted-foreground">
                    Linked indicator type:{" "}
                    {typeLabels[selectedIndicator.type] || selectedIndicator.type}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-text">Question Prompt</Label>
                <Input
                  id="question-text"
                  placeholder='e.g. Tested for HIV?'
                  value={questionForm.questionText}
                  onChange={(e) =>
                    setQuestionForm((current) => ({ ...current, questionText: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-help-text">Help Text</Label>
                <Textarea
                  id="question-help-text"
                  rows={2}
                  placeholder="Optional instructions shown below the question"
                  value={questionForm.helpText}
                  onChange={(e) =>
                    setQuestionForm((current) => ({ ...current, helpText: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-response-type">Response Type</Label>
                <Select
                  value={questionForm.responseType || "__default__"}
                  onValueChange={(value) =>
                    setQuestionForm((current) => ({
                      ...current,
                      responseType: value === "__default__" ? "" : (value as IndicatorType),
                    }))
                  }
                >
                  <SelectTrigger id="question-response-type">
                    <SelectValue placeholder="Choose response type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">
                      Use linked indicator type{selectedIndicator ? ` (${typeLabels[selectedIndicator.type] || selectedIndicator.type})` : ""}
                    </SelectItem>
                    {Object.entries(typeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="question-rollup-mode">Indicator Roll-up Rule</Label>
                <Select
                  value={questionForm.aggregateMode}
                  onValueChange={(value) =>
                    setQuestionForm((current) => ({
                      ...current,
                      aggregateMode: value as QuestionFormState["aggregateMode"],
                    }))
                  }
                >
                  <SelectTrigger id="question-rollup-mode">
                    <SelectValue placeholder="Choose roll-up rule" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(rollupModeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This controls how saved responses update the linked indicator total.
                </p>
              </div>

              {questionForm.aggregateMode === "count_selected" ? (
                <div className="space-y-2">
                  <Label htmlFor="question-rollup-values">Values To Count</Label>
                  <Textarea
                    id="question-rollup-values"
                    rows={4}
                    placeholder={"yes\ntrue\nknown_positive"}
                    value={questionForm.aggregateMatchValuesText}
                    onChange={(e) =>
                      setQuestionForm((current) => ({
                        ...current,
                        aggregateMatchValuesText: e.target.value,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Add one value per line. For yes/no questions, leaving this blank will count `Yes`.
                  </p>
                </div>
              ) : null}

              {(effectiveResponseType === "select" || effectiveResponseType === "multiselect") ? (
                <div className="space-y-2">
                  <Label htmlFor="question-options">
                    Answer Options
                  </Label>
                  <Textarea
                    id="question-options"
                    rows={4}
                    placeholder={"One option per line\nYes|yes\nNo|no"}
                    value={questionForm.optionsText}
                    onChange={(e) =>
                      setQuestionForm((current) => ({ ...current, optionsText: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Use one option per line. Add `label|value` when the stored value should differ from the label.
                  </p>
                </div>
              ) : null}

              {effectiveResponseType === "multi_int" ? (
                <div className="space-y-2">
                  <Label htmlFor="question-sub-labels">Number Labels</Label>
                  <Textarea
                    id="question-sub-labels"
                    rows={4}
                    placeholder={"Male\nFemale"}
                    value={questionForm.subLabelsText}
                    onChange={(e) =>
                      setQuestionForm((current) => ({ ...current, subLabelsText: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Add one label per line for each number you want captured.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="question-order">Order</Label>
                  <Input
                    id="question-order"
                    type="number"
                    placeholder={String((questions.length || 0) + 1)}
                    value={questionForm.orderValue}
                    onChange={(e) =>
                      setQuestionForm((current) => ({ ...current, orderValue: e.target.value }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2 pt-8">
                  <Checkbox
                    id="question-required"
                    checked={questionForm.isRequired}
                    onCheckedChange={(value) =>
                      setQuestionForm((current) => ({ ...current, isRequired: value === true }))
                    }
                  />
                  <Label htmlFor="question-required">Required question</Label>
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                Respondents answer the question prompt, and the response is stored under the linked indicator for later reporting.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleSaveQuestion} disabled={isSavingQuestion}>
                  {isSavingQuestion ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  {questionForm.questionId ? "Update Question" : "Add Question"}
                </Button>
                {questionForm.questionId ? (
                  <Button variant="outline" onClick={resetQuestionForm} disabled={isSavingQuestion}>
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
