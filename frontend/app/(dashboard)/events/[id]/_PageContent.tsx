"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Loader2, CalendarDays, MapPin, Users, Building2, Tag,
  CheckCircle2, Clock, XCircle, Plus, Trash2, Edit, Save, X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"

import { useEvent } from "@/lib/hooks/use-api"
import { eventsService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { useSmartBack } from "@/lib/hooks/use-smart-back"
import type { EventParticipant, EventPhase } from "@/lib/types"

const STATUS_ICONS = {
  planned: <Clock className="h-4 w-4" />,
  ongoing: <CalendarDays className="h-4 w-4" />,
  completed: <CheckCircle2 className="h-4 w-4" />,
  cancelled: <XCircle className="h-4 w-4" />,
}

const STATUS_COLORS = {
  planned: "border-blue-200 bg-blue-50 text-blue-700",
  ongoing: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
}

const PHASE_STATUS_COLORS = {
  planned: "border-blue-200 bg-blue-50 text-blue-700",
  ongoing: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-green-200 bg-green-50 text-green-700",
}

function formatDate(v?: string | null) {
  if (!v) return "—"
  return new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export default function EventDetailPage() {
  const { toast } = useToast()
  const router = useRouter()
  const params = useParams()
  const handleBack = useSmartBack("/events")
  const { user } = useAuth()

  const rawId = params?.id
  const eventId = Number(Array.isArray(rawId) ? rawId[0] : rawId)
  const isValidId = Number.isFinite(eventId)

  const { data: event, isLoading, error, mutate } = useEvent(isValidId ? eventId : null)

  const canEdit = user?.role === "admin" || user?.role === "manager" || user?.role === "officer"

  // Participants
  const [isAddingParticipant, setIsAddingParticipant] = useState(false)
  const [participantForm, setParticipantForm] = useState({ name: "", gender: "", contact: "", notes: "" })
  const [savingParticipant, setSavingParticipant] = useState(false)

  // Phases
  const [isAddingPhase, setIsAddingPhase] = useState(false)
  const [editingPhase, setEditingPhase] = useState<EventPhase | null>(null)
  const [phaseForm, setPhaseForm] = useState({
    title: "", description: "", status: "planned" as EventPhase["status"], due_date: "",
  })
  const [savingPhase, setSavingPhase] = useState(false)

  const handleAddParticipant = async () => {
    if (!participantForm.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" })
      return
    }
    setSavingParticipant(true)
    try {
      await eventsService.addParticipant(eventId, {
        name: participantForm.name.trim(),
        gender: participantForm.gender || undefined,
        contact: participantForm.contact || undefined,
        notes: participantForm.notes || undefined,
      })
      await mutate()
      setIsAddingParticipant(false)
      setParticipantForm({ name: "", gender: "", contact: "", notes: "" })
      toast({ title: "Participant added" })
    } catch {
      toast({ title: "Error", description: "Could not add participant.", variant: "destructive" })
    } finally {
      setSavingParticipant(false)
    }
  }

  const handleRemoveParticipant = async (p: EventParticipant) => {
    try {
      await eventsService.removeParticipant(eventId, Number(p.id))
      await mutate()
      toast({ title: "Participant removed" })
    } catch {
      toast({ title: "Error", description: "Could not remove participant.", variant: "destructive" })
    }
  }

  const openAddPhase = () => {
    setEditingPhase(null)
    setPhaseForm({ title: "", description: "", status: "planned", due_date: "" })
    setIsAddingPhase(true)
  }

  const openEditPhase = (phase: EventPhase) => {
    setEditingPhase(phase)
    setPhaseForm({
      title: phase.title,
      description: phase.description || "",
      status: phase.status,
      due_date: phase.due_date || "",
    })
    setIsAddingPhase(true)
  }

  const handleSavePhase = async () => {
    if (!phaseForm.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" })
      return
    }
    setSavingPhase(true)
    try {
      if (editingPhase) {
        await eventsService.updatePhase(Number(editingPhase.id), {
          title: phaseForm.title.trim(),
          description: phaseForm.description || undefined,
          status: phaseForm.status,
          due_date: phaseForm.due_date || undefined,
        })
      } else {
        await eventsService.createPhase({
          event: eventId,
          title: phaseForm.title.trim(),
          description: phaseForm.description || undefined,
          status: phaseForm.status,
          due_date: phaseForm.due_date || undefined,
        })
      }
      await mutate()
      setIsAddingPhase(false)
      toast({ title: editingPhase ? "Phase updated" : "Phase added" })
    } catch {
      toast({ title: "Error", description: "Could not save phase.", variant: "destructive" })
    } finally {
      setSavingPhase(false)
    }
  }

  const handleDeletePhase = async (phase: EventPhase) => {
    try {
      await eventsService.deletePhase(Number(phase.id))
      await mutate()
      toast({ title: "Phase removed" })
    } catch {
      toast({ title: "Error", description: "Could not delete phase.", variant: "destructive" })
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !event || !isValidId) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Event not found</p>
        <Button onClick={handleBack}>Back to Events</Button>
      </div>
    )
  }

  const participants: EventParticipant[] = event.participants || []
  const phases: EventPhase[] = event.phases || []

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={event.title}
        description={event.description || "Event details and participants"}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Events", href: "/events" },
          { label: event.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            {canEdit && (
              <Button onClick={() => router.push(`/events`)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        }
      />

      {/* Status + key info */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              variant="outline"
              className={STATUS_COLORS[event.status] || ""}
            >
              {STATUS_ICONS[event.status]}
              <span className="ml-1 capitalize">{event.status}</span>
            </Badge>
            <Badge variant="outline" className="capitalize">{event.type}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" /> Dates
            </p>
            <p className="text-sm font-medium">
              {formatDate(event.start_date)}
              {event.end_date && event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ""}
            </p>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Location
            </p>
            <p className="text-sm font-medium">{event.location || "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Organization
            </p>
            <p className="text-sm font-medium">{event.organization_name || event.organization}</p>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Participants
            </p>
            <p className="text-sm font-medium">
              {event.actual_participants ?? 0}
              {event.expected_participants ? ` / ${event.expected_participants} expected` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Participants */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-muted-foreground" />
                Participants ({participants.length})
              </CardTitle>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setIsAddingParticipant(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {participants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No participants recorded.</p>
            ) : (
              <div className="space-y-2">
                {participants.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">
                        {p.respondent_name || p.name || `Participant #${p.id}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[p.gender, p.contact].filter(Boolean).join(" · ") || "No details"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={p.attended ? "default" : "secondary"} className="text-xs">
                        {p.attended ? "Attended" : "Absent"}
                      </Badge>
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveParticipant(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Phases */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Tag className="h-4 w-4 text-muted-foreground" />
                Preparation Phases ({phases.length})
              </CardTitle>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={openAddPhase}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {phases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No phases defined.</p>
            ) : (
              <div className="space-y-2">
                {phases.map((ph) => (
                  <div key={ph.id} className="flex items-start justify-between rounded-md border border-border px-3 py-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{ph.title}</p>
                      {ph.description && <p className="text-xs text-muted-foreground">{ph.description}</p>}
                      {ph.due_date && (
                        <p className="text-xs text-muted-foreground">Due: {formatDate(ph.due_date)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className={`text-xs ${PHASE_STATUS_COLORS[ph.status] || ""}`}>
                        {ph.status}
                      </Badge>
                      {canEdit && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditPhase(ph)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDeletePhase(ph)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Participant Dialog */}
      <Dialog open={isAddingParticipant} onOpenChange={setIsAddingParticipant}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Participant</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={participantForm.name}
                onChange={(e) => setParticipantForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select
                value={participantForm.gender}
                onValueChange={(v) => setParticipantForm((f) => ({ ...f, gender: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Contact</Label>
              <Input
                value={participantForm.contact}
                onChange={(e) => setParticipantForm((f) => ({ ...f, contact: e.target.value }))}
                placeholder="Phone or email"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={participantForm.notes}
                onChange={(e) => setParticipantForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingParticipant(false)} disabled={savingParticipant}>
              Cancel
            </Button>
            <Button onClick={handleAddParticipant} disabled={savingParticipant}>
              {savingParticipant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Phase Dialog */}
      <Dialog open={isAddingPhase} onOpenChange={setIsAddingPhase}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingPhase ? "Edit Phase" : "Add Phase"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={phaseForm.title}
                onChange={(e) => setPhaseForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Phase title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={phaseForm.description}
                onChange={(e) => setPhaseForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={phaseForm.status}
                onValueChange={(v) => setPhaseForm((f) => ({ ...f, status: v as EventPhase["status"] }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={phaseForm.due_date}
                onChange={(e) => setPhaseForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingPhase(false)} disabled={savingPhase}>
              Cancel
            </Button>
            <Button onClick={handleSavePhase} disabled={savingPhase}>
              {savingPhase ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
