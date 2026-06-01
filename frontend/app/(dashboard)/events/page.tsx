"use client";

import { useEffect, useState } from "react";
import {
  Calendar,
  MapPin,
  Users,
  Plus,
  Search,
  Filter,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { useRouter } from "next/navigation";
import { eventsService } from "@/lib/api";
import { useIndicators, useEvents, useAllOrganizations } from "@/lib/hooks/use-api";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { formatDate } from "@/lib/date-utils";
import type { Event, EventPhase } from "@/lib/types";
import type { EventParticipant } from "@/lib/api";
import { Suspense } from "react";
import { QRCodeCanvas } from "qrcode.react";

const Loading = () => null;

const toResultsArray = <T,>(value: T[] | { results?: T[] } | undefined): T[] => {
  if (Array.isArray(value)) return value;
  return value?.results ?? [];
};

export default function EventsPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>([]);
  const { data: indicatorsData } = useIndicators();
  const { data: eventsData, mutate: mutateEvents } = useEvents();
  const { data: organizationsData } = useAllOrganizations();

  const [eventTitle, setEventTitle] = useState("");
  const [eventType, setEventType] = useState("workshop");
  const [eventDate, setEventDate] = useState("");
  const [eventOrganization, setEventOrganization] = useState("");
  const [participatingOrgIds, setParticipatingOrgIds] = useState<string[]>([]);
  const [participantOrgSearch, setParticipantOrgSearch] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventExpected, setEventExpected] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [viewEvent, setViewEvent] = useState<Event | null>(null);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [phases, setPhases] = useState<EventPhase[]>([]);
  const [participantName, setParticipantName] = useState("");
  const [participantGender, setParticipantGender] = useState("");
  const [participantContact, setParticipantContact] = useState("");
  const [participantNotes, setParticipantNotes] = useState("");
  const [phaseTitle, setPhaseTitle] = useState("");
  const [phaseStatus, setPhaseStatus] = useState<"planned" | "ongoing" | "completed">("planned");
  const [phaseDueDate, setPhaseDueDate] = useState("");
  const [phaseDescription, setPhaseDescription] = useState("");
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [origin, setOrigin] = useState("");

  const events = eventsData?.results || [];
  const organizations = organizationsData?.results || [];

  const totalAttendees = events.reduce(
    (acc, event) => acc + (Number(event.actual_participants) || 0),
    0,
  );
  const upcomingCount = events.filter((e) => e.status === "planned").length;
  const completedCount = events.filter(
    (e) => e.status === "completed",
  ).length;

  const indicators = indicatorsData?.results || [];
  const eventIndicators = indicators.filter((indicator) =>
    String(indicator.code || "").startsWith("EVT_"),
  );
  const indicatorNameById = new Map(
    indicators.map((indicator) => [String(indicator.id), indicator.name]),
  );

  const toggleIndicator = (id: string, checked: boolean) => {
    setSelectedIndicatorIds((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
  };

  const resetForm = () => {
    setEventTitle("");
    setEventType("workshop");
    setEventDate("");
    setEventOrganization("");
    setParticipatingOrgIds([]);
    setEventLocation("");
    setEventDescription("");
    setEventExpected("");
    setSelectedIndicatorIds([]);
    setEditingEvent(null);
  };

  const resetDetailsForm = () => {
    setParticipantName("");
    setParticipantGender("");
    setParticipantContact("");
    setParticipantNotes("");
    setPhaseTitle("");
    setPhaseStatus("planned");
    setPhaseDueDate("");
    setPhaseDescription("");
  };

  const handleSubmitEvent = async () => {
    if (!eventTitle || !eventDate || !eventOrganization) return;
    setIsSubmitting(true);
    try {
      const payload = {
        title: eventTitle,
        type: eventType as "training" | "meeting" | "outreach" | "workshop" | "other",
        status: editingEvent?.status || "planned",
        start_date: eventDate,
        organization: Number(eventOrganization),
        participating_organizations: participatingOrgIds.map((id) => Number(id)),
        description: eventDescription || undefined,
        location: eventLocation || undefined,
        expected_participants: eventExpected ? Number(eventExpected) : undefined,
        indicators: selectedIndicatorIds.map((id) => Number(id)),
      };

      if (editingEvent?.id) {
        await eventsService.update(Number(editingEvent.id), payload);
      } else {
        await eventsService.create(payload);
      }
      await mutateEvents();
      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error("Failed to create event", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (event: Event) => {
    setEditingEvent(event);
    setEventTitle(event.title || "");
    setEventType(event.type || "workshop");
    setEventDate(event.start_date || "");
    setEventOrganization(event.organization ? String(event.organization) : "");
    setParticipatingOrgIds((event.participating_organizations || []).map((id) => String(id)));
    setEventLocation(event.location || "");
    setEventDescription(event.description || "");
    setEventExpected(
      event.expected_participants !== undefined
        ? String(event.expected_participants)
        : "",
    );
    setSelectedIndicatorIds(
      (event.indicators || []).map((id) => String(id)),
    );
    setIsDialogOpen(true);
  };

  const openDetailsDialog = async (event: Event) => {
    setViewEvent(event);
    setIsDetailsOpen(true);
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const loadDetails = async () => {
      if (!viewEvent?.id || !isDetailsOpen) return;
      setIsDetailsLoading(true);
      try {
        const [participantData, phaseData] = await Promise.all([
          eventsService.getParticipants(Number(viewEvent.id)),
          eventsService.getPhases(Number(viewEvent.id)),
        ]);
        const participantList = toResultsArray(participantData);
        setParticipants(participantList);
        const phaseList = toResultsArray(phaseData);
        setPhases(phaseList);
      } catch (error) {
        console.error("Failed to load event details", error);
      } finally {
        setIsDetailsLoading(false);
      }
    };
    loadDetails();
  }, [isDetailsOpen, viewEvent?.id]);

  const handleAddParticipant = async () => {
    if (!viewEvent?.id || !participantName) return;
    try {
      await eventsService.addParticipant(Number(viewEvent.id), {
        name: participantName,
        gender: participantGender || undefined,
        contact: participantContact || undefined,
        notes: participantNotes || undefined,
      });
      const participantData = await eventsService.getParticipants(Number(viewEvent.id));
      const participantList = toResultsArray(participantData);
      setParticipants(participantList);
      resetDetailsForm();
    } catch (error) {
      console.error("Failed to add participant", error);
    }
  };

  const handleToggleAttendance = async (participantId: number, attended: boolean) => {
    if (!viewEvent?.id) return;
    try {
      await eventsService.markAttendance(Number(viewEvent.id), participantId, attended);
      const participantData = await eventsService.getParticipants(Number(viewEvent.id));
      const participantList = toResultsArray(participantData);
      setParticipants(participantList);
      await mutateEvents();
    } catch (error) {
      console.error("Failed to mark attendance", error);
    }
  };

  const handleAddPhase = async () => {
    if (!viewEvent?.id || !phaseTitle) return;
    try {
      await eventsService.createPhase({
        event: Number(viewEvent.id),
        title: phaseTitle,
        status: phaseStatus,
        due_date: phaseDueDate || undefined,
        description: phaseDescription || undefined,
      });
      const phaseData = await eventsService.getPhases(Number(viewEvent.id));
      const phaseList = toResultsArray(phaseData);
      setPhases(phaseList);
      resetDetailsForm();
    } catch (error) {
      console.error("Failed to add phase", error);
    }
  };

  const checkinUrl =
    viewEvent?.checkin_token && origin
      ? `${origin}/checkin/${viewEvent.checkin_token}`
      : "";

  const downloadQrCode = () => {
    if (!checkinUrl) return;
    const canvas = document.getElementById("event-checkin-qr") as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `event-checkin-${viewEvent?.id || "qr"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const filteredEvents = events.filter((event) => {
    const title = String(event.title || "").toLowerCase();
    const location = String(event.location || "").toLowerCase();
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      query.length === 0 || title.includes(query) || location.includes(query);
    const matchesStatus =
      statusFilter === "all" || event.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-success/20 text-success border-success/30">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Completed
          </Badge>
        );
      case "planned":
        return (
          <Badge className="bg-info/20 text-info border-info/30">
            <Clock className="mr-1 h-3 w-3" />
            Planned
          </Badge>
        );
      case "ongoing":
        return (
          <Badge className="bg-warning/20 text-warning border-warning/30">
            <Clock className="mr-1 h-3 w-3" />
            Ongoing
          </Badge>
        );
      case "cancelled":
        return (
          <Badge className="bg-destructive/20 text-destructive border-destructive/30">
            <XCircle className="mr-1 h-3 w-3" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getEventTypeColor = (type: string) => {
    switch (type) {
      case "workshop":
        return "bg-chart-1/20 text-chart-1 border-chart-1/30";
      case "training":
        return "bg-chart-2/20 text-chart-2 border-chart-2/30";
      case "outreach":
        return "bg-chart-3/20 text-chart-3 border-chart-3/30";
      case "meeting":
        return "bg-chart-4/20 text-chart-4 border-chart-4/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Suspense fallback={<Loading />}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Events"
          description="Manage workshops, trainings, outreach activities, and meetings"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Events" },
          ]}
          actions={
            <Dialog
              open={isDialogOpen}
              onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (!open) {
                  resetForm();
                }
              }}
            >
              <DialogTrigger asChild>
                <Button onClick={resetForm}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Event
                </Button>
              </DialogTrigger>
            <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingEvent ? "Edit Event" : "Create New Event"}
                  </DialogTitle>
                  <DialogDescription>
                  {editingEvent
                    ? "Update the event details and linked indicators"
                    : "Add a new event to track activities and attendance"}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="event-name">Event Name</Label>
                    <Input
                      id="event-name"
                      placeholder="Enter event name"
                      value={eventTitle}
                      onChange={(e) => setEventTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="event-type">Event Type</Label>
                    <Select value={eventType} onValueChange={setEventType}>
                      <SelectTrigger id="event-type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="workshop">Workshop</SelectItem>
                        <SelectItem value="training">Training</SelectItem>
                        <SelectItem value="outreach">Outreach</SelectItem>
                        <SelectItem value="meeting">Meeting</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="event-date">Date</Label>
                    <Input
                      id="event-date"
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                                      <Label htmlFor="event-org">Organization</Label>
                  <OrganizationSelect
                    organizations={organizations}
                    value={eventOrganization}
                    onChange={setEventOrganization}
                    placeholder="Select organization"
                  /></div>
                </div>
                <div className="space-y-2">
                  <Label>Participating Organizations</Label>
                  <Input
                    value={participantOrgSearch}
                    onChange={(e) => setParticipantOrgSearch(e.target.value)}
                    placeholder="Search organizations..."
                  />
<div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-border p-3">
                    {organizations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No organizations found.
                      </p>
                    ) : (
                      organizations.map((org) => {
                        const id = String(org.id);
                        const checked = participatingOrgIds.includes(id);
                        return (
                          <label
                            key={id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => {
                                setParticipatingOrgIds((prev) =>
                                  value === true
                                    ? [...prev, id]
                                    : prev.filter((item) => item !== id)
                                );
                              }}
                            />
                            <span>{org.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-location">Location</Label>
                  <Input
                    id="event-location"
                    placeholder="Enter event location"
                    value={eventLocation}
                    onChange={(e) => setEventLocation(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-description">Description</Label>
                  <Textarea
                    id="event-description"
                    placeholder="Describe the event..."
                    rows={3}
                    value={eventDescription}
                    onChange={(e) => setEventDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Event Indicators</Label>
                  <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-border p-3">
                    {eventIndicators.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No event indicators found.
                      </p>
                    ) : (
                      eventIndicators.map((indicator) => {
                        const id = String(indicator.id);
                        const checked = selectedIndicatorIds.includes(id);
                        return (
                          <label
                            key={id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) =>
                                toggleIndicator(id, value === true)
                              }
                            />
                            <span>{indicator.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="expected-attendance">
                      Expected Attendance
                    </Label>
                    <Input
                      id="expected-attendance"
                      type="number"
                      placeholder="0"
                      value={eventExpected}
                      onChange={(e) => setEventExpected(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitEvent}
                  disabled={
                    isSubmitting ||
                    !eventTitle ||
                    !eventDate ||
                    !eventOrganization
                  }
                >
                  {editingEvent ? "Save Changes" : "Create Event"}
                </Button>
              </DialogFooter>
            </DialogContent>
            </Dialog>
          }
        />

        {/* Quick actions + Filters */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Event
            </Button>
          </div>
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="ongoing">Ongoing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Events</CardDescription>
              <CardTitle className="text-2xl">{events.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Planned</CardDescription>
              <CardTitle className="text-2xl text-info">
                {upcomingCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Completed</CardDescription>
              <CardTitle className="text-2xl text-success">
                {completedCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Attendees</CardDescription>
              <CardTitle className="text-2xl">
                {totalAttendees}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Events Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredEvents.map((event) => (
            <Card key={event.id} className="group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base line-clamp-1">
                      {event.title}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge className={getEventTypeColor(event.type)}>
                        {event.type}
                      </Badge>
                      {getStatusBadge(event.status)}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => router.push(`/events/${event.id}`)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openEditDialog(event)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {formatDate(event.start_date, "en-US", {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {event.location}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {event.actual_participants ?? 0} / {event.expected_participants ?? 0} attendees
                </div>
                {event.status === "completed" && (
                  (() => {
                    const actual = Number(event.actual_participants) || 0;
                    const expected = Number(event.expected_participants) || 0;
                    const rate =
                      expected > 0 ? Math.round((actual / expected) * 100) : 0;
                    const width =
                      expected > 0
                        ? Math.min(100, (actual / expected) * 100)
                        : 0;
                    return (
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Attendance Rate</span>
                      <span>{rate}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${width}%`,
                        }}
                      />
                    </div>
                  </div>
                    );
                  })()
                )}
                {(() => {
                  const eventIndicatorIds = event.indicators || [];
                  if (eventIndicatorIds.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {eventIndicatorIds.map((id) => (
                        <Badge key={id} variant="outline" className="text-xs">
                          {String(indicatorNameById.get(String(id)) || "Indicator")}
                        </Badge>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredEvents.length === 0 && (
          <Card className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <Calendar className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold">No events found</h3>
              <p className="text-muted-foreground mt-1">
                Try adjusting your search or filters
              </p>
            </div>
          </Card>
        )}
      </div>

      <Dialog
        open={isDetailsOpen}
        onOpenChange={(open) => {
          setIsDetailsOpen(open);
          if (!open) {
            setViewEvent(null);
            setParticipants([]);
            setPhases([]);
            resetDetailsForm();
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Event Details</DialogTitle>
            <DialogDescription>
              Register attendance and track preparation phases for this event.
            </DialogDescription>
          </DialogHeader>

          {!viewEvent ? (
            <div className="py-6 text-sm text-muted-foreground">
              Select an event to view details.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Event</Label>
                  <div className="text-sm font-semibold">{viewEvent.title}</div>
                  <div className="text-xs text-muted-foreground">{viewEvent.description || "No description"}</div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Indicators</Label>
                  <div className="flex flex-wrap gap-2">
                    {(viewEvent.indicators || []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">No indicators linked.</span>
                    ) : (
                      (viewEvent.indicators || []).map((id) => (
                        <Badge key={id} variant="outline" className="text-xs">
                          {String(indicatorNameById.get(String(id)) || "Indicator")}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Participating Orgs</Label>
                  <div className="flex flex-wrap gap-2">
                    {(viewEvent.participating_organizations || []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">None selected.</span>
                    ) : (
                      (viewEvent.participating_organizations || []).map((id) => (
                        <Badge key={id} variant="outline" className="text-xs">
                          {organizations.find((org) => String(org.id) === String(id))?.name || "Organization"}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Check-in QR</Label>
                  <div className="flex items-start gap-4">
                    {checkinUrl ? (
                      <QRCodeCanvas
                        id="event-checkin-qr"
                        value={checkinUrl}
                        size={120}
                        bgColor="#ffffff"
                        fgColor="#0B5F36"
                        includeMargin
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground">QR not available.</div>
                    )}
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground break-all">
                        {checkinUrl || "Check-in link will appear here."}
                      </div>
                      <Button variant="outline" size="sm" onClick={downloadQrCode} disabled={!checkinUrl}>
                        Download QR
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">Attendance</h4>
                      <p className="text-xs text-muted-foreground">
                        Register participants and mark attendance.
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {participants.filter((p) => p.attended).length} attended
                    </Badge>
                  </div>

                  <div className="grid gap-3 rounded-lg border border-border p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        placeholder="Participant name"
                        value={participantName}
                        onChange={(e) => setParticipantName(e.target.value)}
                      />
                      <Input
                        placeholder="Gender"
                        value={participantGender}
                        onChange={(e) => setParticipantGender(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        placeholder="Contact"
                        value={participantContact}
                        onChange={(e) => setParticipantContact(e.target.value)}
                      />
                      <Input
                        placeholder="Notes"
                        value={participantNotes}
                        onChange={(e) => setParticipantNotes(e.target.value)}
                      />
                    </div>
                    <Button onClick={handleAddParticipant} disabled={!participantName}>
                      Add Participant
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {isDetailsLoading ? (
                      <p className="text-xs text-muted-foreground">Loading participants...</p>
                    ) : participants.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No participants registered.</p>
                    ) : (
                      participants.map((participant) => (
                        <div
                          key={participant.id}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-medium">
                              {participant.name || `Respondent #${participant.respondent ?? ""}` || "Participant"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {participant.gender || "â€”"} {participant.contact ? `â€¢ ${participant.contact}` : ""}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Checkbox
                              checked={participant.attended !== false}
                              onCheckedChange={(value) =>
                                handleToggleAttendance(
                                  Number(participant.id),
                                  value === true,
                                )
                              }
                            />
                            Attended
                          </label>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold">Preparation Phases</h4>
                    <p className="text-xs text-muted-foreground">
                      Track activities leading up to the event.
                    </p>
                  </div>

                  <div className="grid gap-3 rounded-lg border border-border p-4">
                    <Input
                      placeholder="Phase title"
                      value={phaseTitle}
                      onChange={(e) => setPhaseTitle(e.target.value)}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select value={phaseStatus} onValueChange={(value) => setPhaseStatus(value as "planned" | "ongoing" | "completed")}>
                        <SelectTrigger>
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="planned">Planned</SelectItem>
                          <SelectItem value="ongoing">Ongoing</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="date"
                        value={phaseDueDate}
                        onChange={(e) => setPhaseDueDate(e.target.value)}
                      />
                    </div>
                    <Textarea
                      placeholder="Phase notes"
                      value={phaseDescription}
                      onChange={(e) => setPhaseDescription(e.target.value)}
                      rows={2}
                    />
                    <Button onClick={handleAddPhase} disabled={!phaseTitle}>
                      Add Phase
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {isDetailsLoading ? (
                      <p className="text-xs text-muted-foreground">Loading phases...</p>
                    ) : phases.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No phases recorded.</p>
                    ) : (
                      phases.map((phase) => (
                        <div
                          key={phase.id}
                          className="rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-medium">{phase.title}</div>
                            <Badge variant="outline" className="text-xs">
                              {phase.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {phase.description || "No notes"}
                          </div>
                          {phase.due_date && (
                            <div className="text-xs text-muted-foreground">
                              Due: {formatDate(phase.due_date)}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Suspense>
  );
}



