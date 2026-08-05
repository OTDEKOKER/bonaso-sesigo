"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  History,
  Loader2,
  Lock,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useModulePermissions } from "@/lib/permissions/module-permissions"
import { useToast } from "@/hooks/use-toast"
import { csoMappingService, type SchemaVersion } from "@/lib/api/services/csoMapping"
import type { Choice, Field, FormSchema, Section } from "@/components/cso-mapping/schema"

// System questions the submission pipeline depends on — cannot be deleted or
// have their type changed from the editor (the backend rejects it anyway).
const CORE_FIELDS = new Set([
  "consent",
  "respondent_type",
  "responding_entity",
  "respondent_name",
  "respondent_position",
  "respondent_phone",
  "respondent_email",
  "primary_district",
  "additional_comments",
  "information_confirmed",
])

const FIELD_TYPES = [
  { value: "text", label: "Text answer" },
  { value: "select_one", label: "Multiple choice" },
  { value: "note", label: "Information note (no answer)" },
]

const randomKey = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`

function newField(): Field {
  return {
    name: randomKey("q"),
    type: "text",
    label: "New question",
    hint: null,
    required: false,
    multiline: false,
    relevant: null,
    constraint: null,
  }
}

/** Immutable helper: apply `fn` to a deep copy of the schema. */
function edit(schema: FormSchema, fn: (draft: FormSchema) => void): FormSchema {
  const draft = structuredClone(schema)
  fn(draft)
  return draft
}

export default function CsoMappingFormEditorPage() {
  const { can } = useModulePermissions()
  const { toast } = useToast()
  const isAdmin = can("cso_mapping", "edit")

  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [history, setHistory] = useState<SchemaVersion[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSchema(await csoMappingService.adminSchema())
      setDirty(false)
      setErrors([])
    } catch {
      toast({ variant: "destructive", title: "Could not load the form", description: "Please try again." })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin, load])

  const apply = useCallback((fn: (draft: FormSchema) => void) => {
    setSchema((s) => (s ? edit(s, fn) : s))
    setDirty(true)
  }, [])

  async function save() {
    if (!schema) return
    setSaving(true)
    setErrors([])
    const stamped = edit(schema, (d) => {
      d.version = `edit_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
    })
    try {
      const saved = await csoMappingService.saveSchema(stamped, "Edited in the form editor")
      setSchema(saved)
      setDirty(false)
      toast({ title: "Saved", description: "The questionnaire is updated and live." })
    } catch (e: unknown) {
      const errs = (e as { errors?: string[] })?.errors
      if (Array.isArray(errs)) {
        setErrors(errs)
        toast({ variant: "destructive", title: "Not saved", description: "Please fix the problems listed." })
      } else {
        toast({ variant: "destructive", title: "Save failed", description: "Please try again." })
      }
    } finally {
      setSaving(false)
    }
  }

  async function openHistory() {
    setHistoryOpen(true)
    try {
      setHistory(await csoMappingService.schemaHistory())
    } catch {
      setHistory([])
    }
  }

  async function rollback(id: number) {
    try {
      const restored = await csoMappingService.activateSchema(id)
      setSchema(restored)
      setDirty(false)
      setHistoryOpen(false)
      toast({ title: "Restored", description: "That version is now live." })
      openHistory()
    } catch {
      toast({ variant: "destructive", title: "Restore failed", description: "Please try again." })
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-semibold">No editor access</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Editing the questionnaire requires the CSO Mapping module with edit
          permission. Ask an administrator to grant it.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Questionnaire editor"
        description="Edit the public CSO Mapping questionnaire. Changes go live when you save; every save is versioned and can be rolled back."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {dirty ? <Badge className="bg-amber-100 text-amber-800">Unsaved changes</Badge> : null}
            <Button variant="outline" size="sm" onClick={openHistory}>
              <History className="mr-1.5 h-4 w-4" /> History
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/cso-mapping/questionnaire" target="_blank" rel="noopener noreferrer">
                Open live form <ExternalLink className="ml-1.5 h-4 w-4" />
              </a>
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Save & publish
            </Button>
          </div>
        }
      />

      {errors.length > 0 ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> This form was not saved — please fix:
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-destructive">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {loading || !schema ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the form…
        </div>
      ) : (
        <div className="space-y-4">
          {schema.sections.map((section, si) => (
            <SectionCard
              key={section.name}
              section={section}
              schema={schema}
              onChange={apply}
              sectionIndex={si}
            />
          ))}
          <Button
            variant="outline"
            onClick={() =>
              apply((d) =>
                d.sections.push({
                  name: randomKey("section"),
                  label: "New section",
                  relevant: null,
                  fields: [newField()],
                }),
              )
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add section
          </Button>
        </div>
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {history === null ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : history.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No saved versions yet.</p>
            ) : (
              history.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {v.version_label || `Version ${v.id}`}
                      {v.is_active ? (
                        <Badge className="ml-2 bg-emerald-100 text-emerald-800">Live</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()} · {v.created_by ?? "system"}
                      {v.note ? ` · ${v.note}` : ""}
                    </p>
                  </div>
                  {!v.is_active ? (
                    <Button size="sm" variant="outline" onClick={() => rollback(v.id)}>
                      Restore
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SectionCard({
  section,
  schema,
  onChange,
  sectionIndex,
}: {
  section: Section
  schema: FormSchema
  onChange: (fn: (draft: FormSchema) => void) => void
  sectionIndex: number
}) {
  const hasCore = section.fields.some((f) => CORE_FIELDS.has(f.name))

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-center justify-between gap-3">
          <Input
            className="max-w-md font-semibold"
            value={section.label ?? ""}
            placeholder="Section title"
            onChange={(e) =>
              onChange((d) => {
                d.sections[sectionIndex].label = e.target.value
              })
            }
          />
          {!hasCore ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() =>
                onChange((d) => {
                  d.sections.splice(sectionIndex, 1)
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> system section
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {section.fields.map((field, fi) => (
          <FieldEditor
            key={field.name}
            field={field}
            schema={schema}
            sectionIndex={sectionIndex}
            fieldIndex={fi}
            fieldCount={section.fields.length}
            onChange={onChange}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange((d) => {
              d.sections[sectionIndex].fields.push(newField())
            })
          }
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add question
        </Button>
      </CardContent>
    </Card>
  )
}

function FieldEditor({
  field,
  schema,
  sectionIndex,
  fieldIndex,
  fieldCount,
  onChange,
}: {
  field: Field
  schema: FormSchema
  sectionIndex: number
  fieldIndex: number
  fieldCount: number
  onChange: (fn: (draft: FormSchema) => void) => void
}) {
  const isCore = CORE_FIELDS.has(field.name)
  const patch = (fn: (f: Field, draft: FormSchema) => void) =>
    onChange((d) => fn(d.sections[sectionIndex].fields[fieldIndex], d))

  // Every field the show-if rule can reference (any question with a name/label).
  const refFields = schema.sections
    .flatMap((s) => s.fields)
    .filter((f) => f.name !== field.name && f.type !== "note")
  const refField = refFields.find((f) => f.name === field.relevant?.field)
  const refChoices = refField?.list ? schema.choices[refField.list] ?? [] : []

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">
          <Input
            value={field.label}
            placeholder="Question text"
            onChange={(e) => patch((f) => (f.label = e.target.value))}
          />
          <Input
            className="text-sm"
            value={field.hint ?? ""}
            placeholder="Helper text (optional)"
            onChange={(e) => patch((f) => (f.hint = e.target.value || null))}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Select
              value={field.type}
              disabled={isCore}
              onValueChange={(v) =>
                patch((f, d) => {
                  f.type = v
                  if (v === "select_one" && !f.list) {
                    f.list = randomKey("list")
                    d.choices[f.list] = [
                      { name: "option_1", label: "Option 1" },
                      { name: "option_2", label: "Option 2" },
                    ]
                  }
                })
              }
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.type !== "note" ? (
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => patch((f) => (f.required = e.target.checked))}
                />
                Required
              </label>
            ) : null}
            {field.type === "text" ? (
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={field.multiline}
                  onChange={(e) => patch((f) => (f.multiline = e.target.checked))}
                />
                Long text
              </label>
            ) : null}
            {isCore ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> system question
              </span>
            ) : null}
          </div>

          {field.type === "select_one" && field.list ? (
            <ChoicesEditor list={field.list} schema={schema} onChange={onChange} />
          ) : null}

          {/* Show-if rule */}
          <div className="rounded-md border border-dashed p-2 text-sm">
            <label className="inline-flex items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={!!field.relevant}
                onChange={(e) =>
                  patch((f) => {
                    f.relevant = e.target.checked
                      ? { field: refFields[0]?.name ?? "", op: "eq", value: "" }
                      : null
                  })
                }
              />
              Only show this question if…
            </label>
            {field.relevant ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  value={field.relevant.field ?? ""}
                  onValueChange={(v) => patch((f) => (f.relevant = { ...f.relevant, field: v }))}
                >
                  <SelectTrigger className="h-8 w-56"><SelectValue placeholder="question" /></SelectTrigger>
                  <SelectContent>
                    {refFields.map((rf) => (
                      <SelectItem key={rf.name} value={rf.name}>{rf.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={field.relevant.op ?? "eq"}
                  onValueChange={(v) => patch((f) => (f.relevant = { ...f.relevant, op: v }))}
                >
                  <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">is</SelectItem>
                    <SelectItem value="ne">is not</SelectItem>
                  </SelectContent>
                </Select>
                {refChoices.length > 0 ? (
                  <Select
                    value={field.relevant.value ?? ""}
                    onValueChange={(v) => patch((f) => (f.relevant = { ...f.relevant, value: v }))}
                  >
                    <SelectTrigger className="h-8 w-48"><SelectValue placeholder="value" /></SelectTrigger>
                    <SelectContent>
                      {refChoices.map((c) => (
                        <SelectItem key={c.name} value={c.name}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-8 w-48"
                    placeholder="value"
                    value={field.relevant.value ?? ""}
                    onChange={(e) => patch((f) => (f.relevant = { ...f.relevant, value: e.target.value }))}
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={fieldIndex === 0}
            onClick={() =>
              onChange((d) => {
                const f = d.sections[sectionIndex].fields
                ;[f[fieldIndex - 1], f[fieldIndex]] = [f[fieldIndex], f[fieldIndex - 1]]
              })
            }
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={fieldIndex === fieldCount - 1}
            onClick={() =>
              onChange((d) => {
                const f = d.sections[sectionIndex].fields
                ;[f[fieldIndex + 1], f[fieldIndex]] = [f[fieldIndex], f[fieldIndex + 1]]
              })
            }
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          {!isCore ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() =>
                onChange((d) => {
                  d.sections[sectionIndex].fields.splice(fieldIndex, 1)
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ChoicesEditor({
  list,
  schema,
  onChange,
}: {
  list: string
  schema: FormSchema
  onChange: (fn: (draft: FormSchema) => void) => void
}) {
  const choices: Choice[] = schema.choices[list] ?? []
  return (
    <div className="space-y-1.5 rounded-md bg-background p-2">
      <p className="text-xs font-medium text-muted-foreground">Answer options</p>
      {choices.map((c, ci) => (
        <div key={ci} className="flex items-center gap-2">
          <Input
            className="h-8"
            value={c.label}
            placeholder="Option shown to respondents"
            onChange={(e) =>
              onChange((d) => {
                d.choices[list][ci].label = e.target.value
              })
            }
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() =>
              onChange((d) => {
                d.choices[list].splice(ci, 1)
              })
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange((d) => {
            if (!d.choices[list]) d.choices[list] = []
            const n = d.choices[list].length + 1
            d.choices[list].push({ name: `option_${randomKey("").slice(1)}`, label: `Option ${n}` })
          })
        }
      >
        <Plus className="mr-1.5 h-4 w-4" /> Add option
      </Button>
    </div>
  )
}
