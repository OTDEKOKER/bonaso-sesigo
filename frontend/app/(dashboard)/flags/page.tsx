"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flag as FlagIcon,
  XCircle,
  Filter,
  Eye,
  Loader2,
} from "lucide-react";
import { flagsService } from "@/lib/api";
import type { FlagFilters } from "@/lib/api/services/reports";
import {
  useFlags,
  useFlagStats,
  useOrganizations,
  useAllProjects,
  useAllIndicators,
  useProjectCoordinators,
} from "@/lib/hooks/use-api";
import type { Flag } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

const DQ_CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "consistency", label: "Consistency" },
  { value: "anomaly", label: "Anomaly" },
  { value: "duplicate", label: "Duplicate" },
  { value: "missing", label: "Missing (completeness)" },
  { value: "traceability", label: "Traceability" },
  { value: "validation", label: "Validation" },
  { value: "fact_integrity", label: "Fact integrity" },
  { value: "overlap", label: "Overlap" },
];

const FLAG_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "data_quality", label: "Data Quality" },
  { value: "follow_up", label: "Follow Up" },
  { value: "urgent", label: "Urgent" },
  { value: "review", label: "Needs Review" },
  { value: "other", label: "Other" },
];

const priorityColors: Record<string, string> = {
  low: "bg-info/20 text-info border-info/30",
  medium: "bg-warning/20 text-warning border-warning/30",
  high: "bg-accent/20 text-accent border-accent/30",
  critical: "bg-destructive/20 text-destructive border-destructive/30",
};

const statusColors: Record<string, string> = {
  open: "bg-destructive/20 text-destructive border-destructive/30",
  in_progress: "bg-warning/20 text-warning border-warning/30",
  resolved: "bg-primary/20 text-primary border-primary/30",
  dismissed: "bg-muted text-muted-foreground border-border",
};

const typeLabels: Record<string, string> = {
  data_quality: "Data Quality",
  follow_up: "Follow Up",
  urgent: "Urgent",
  review: "Needs Review",
  other: "Other",
};

export default function FlagsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedFlag, setSelectedFlag] = useState<Flag | null>(null);
  const [isResolveDialogOpen, setIsResolveDialogOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Every filter below is resolved server-side so it covers ALL flags, not just
  // the page currently loaded in the table.
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterOrg, setFilterOrg] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterCoordinator, setFilterCoordinator] = useState<string>("all");
  const [filterIndicator, setFilterIndicator] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Debounce the free-text search so we hit the API once the user pauses.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Coordinator options come from the selected project's hierarchy, matching the
  // project-aware coordinator filter used elsewhere in the system.
  const { data: orgData } = useOrganizations({ page_size: "1000" });
  const { data: projectData } = useAllProjects();
  const { data: indicatorData } = useAllIndicators();
  const { data: coordinatorData } = useProjectCoordinators(
    filterProject !== "all" ? filterProject : null,
  );

  const organizationOptions = useMemo(() => orgData?.results ?? [], [orgData]);
  const projectOptions = useMemo(() => projectData ?? [], [projectData]);
  const indicatorOptions = useMemo(
    () =>
      (indicatorData ?? []).map((ind) => ({
        id: ind.id,
        name: ind.code ? `${ind.code} — ${ind.name}` : ind.name,
      })),
    [indicatorData],
  );
  const coordinatorOptions = useMemo(() => coordinatorData ?? [], [coordinatorData]);

  const flagFilters = useMemo<FlagFilters>(() => {
    const f: FlagFilters = { page_size: "200" };
    if (debouncedSearch) f.search = debouncedSearch;
    if (filterStatus !== "all") f.status = filterStatus;
    if (filterPriority !== "all") f.priority = filterPriority;
    if (filterType !== "all") f.flag_type = filterType;
    if (filterCategory !== "all") f.category = filterCategory;
    if (filterOrg !== "all") f.organization = filterOrg;
    if (filterProject !== "all") f.project = filterProject;
    if (filterCoordinator !== "all") f.coordinator = filterCoordinator;
    if (filterIndicator !== "all") f.indicator = filterIndicator;
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    return f;
  }, [
    debouncedSearch, filterStatus, filterPriority, filterType, filterCategory,
    filterOrg, filterProject, filterCoordinator, filterIndicator, dateFrom, dateTo,
  ]);

  const { data: flagsData, isLoading, error, mutate } = useFlags(flagFilters);
  const { data: statsData } = useFlagStats();

  const flags = useMemo(() => flagsData?.results ?? [], [flagsData?.results]);

  const hasActiveFilters =
    !!debouncedSearch ||
    [filterStatus, filterPriority, filterType, filterCategory, filterOrg,
      filterProject, filterCoordinator, filterIndicator].some((v) => v !== "all") ||
    !!dateFrom ||
    !!dateTo;

  const clearFilters = () => {
    setSearchInput("");
    setFilterStatus("all");
    setFilterPriority("all");
    setFilterType("all");
    setFilterCategory("all");
    setFilterOrg("all");
    setFilterProject("all");
    setFilterCoordinator("all");
    setFilterIndicator("all");
    setDateFrom("");
    setDateTo("");
  };

  // A coordinator selection only makes sense within a project; clear it if the
  // project filter is reset.
  useEffect(() => {
    if (filterProject === "all" && filterCoordinator !== "all") {
      setFilterCoordinator("all");
    }
  }, [filterProject, filterCoordinator]);

  const computedStats = useMemo(() => {
    return {
      open: flags.filter((f) => f.status === "open").length,
      inProgress: flags.filter((f) => f.status === "in_progress").length,
      resolved: flags.filter((f) => f.status === "resolved").length,
      critical: flags.filter((f) => f.priority === "critical" && f.status === "open").length,
    };
  }, [flags]);

  const stats = statsData
    ? {
        open: statsData.open,
        inProgress: statsData.in_progress,
        resolved: statsData.resolved,
        critical: statsData.by_priority.find((p) => p.priority === "critical")?.count || 0,
      }
    : computedStats;

  const handleResolve = async () => {
    if (!selectedFlag) return;
    setIsUpdating(true);
    try {
      await flagsService.update(Number(selectedFlag.id), {
        status: "resolved",
        resolution_notes: resolution || undefined,
      });
      toast({
        title: "Flag resolved",
        description: "The flag has been marked as resolved.",
      });
      setIsResolveDialogOpen(false);
      setSelectedFlag(null);
      setResolution("");
      mutate();
    } catch (err) {
      console.error("Failed to resolve flag", err);
      toast({
        title: "Error",
        description: "Failed to resolve flag.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const openFlagRecord = (flag: Flag) => {
    if (flag.content_type === "aggregate") {
      router.push(`/aggregates?reviewAggregateId=${flag.object_id}`);
      return;
    }
  };

  const columns: Column<Flag>[] = [
    {
      key: "priority",
      header: "Priority",
      sortable: true,
      render: (flag) => (
        <Badge variant="outline" className={priorityColors[flag.priority] || ""}>
          {flag.priority.charAt(0).toUpperCase() + flag.priority.slice(1)}
        </Badge>
      ),
    },
    {
      key: "flag_type",
      header: "Type",
      sortable: true,
      render: (flag) => typeLabels[flag.flag_type] || flag.flag_type,
    },
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (flag) => <span className="text-sm line-clamp-2">{flag.title}</span>,
    },
    {
      key: "content",
      header: "Affected Record",
      render: (flag) => (
        <div>
          <p className="font-medium">#{flag.object_id}</p>
          <p className="text-xs text-muted-foreground">{flag.content_type}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (flag) => (
        <Badge variant="outline" className={statusColors[flag.status] || ""}>
          {flag.status === "in_progress"
            ? "In Progress"
            : flag.status.charAt(0).toUpperCase() + flag.status.slice(1)}
        </Badge>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      render: (flag) => new Date(flag.created_at).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "Actions",
      render: (flag) => (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFlag(flag)}>
            <Eye className="h-4 w-4" />
          </Button>
          {flag.content_type === "aggregate" ? (
            <Button variant="ghost" size="sm" onClick={() => openFlagRecord(flag)}>
              Open
            </Button>
          ) : null}
          {flag.status === "open" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedFlag(flag);
                setIsResolveDialogOpen(true);
              }}
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Failed to load flags</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Quality Flags"
        description="Review and resolve data quality issues across the system"
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Open Issues
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.open}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              In Progress
            </CardTitle>
            <Clock className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.inProgress}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Resolved
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.resolved}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Critical Open
            </CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.critical}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-foreground flex items-center gap-2">
              <FlagIcon className="h-5 w-5" />
              All Flags
            </CardTitle>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <Filter className="h-4 w-4" />
            <span className="text-sm">Filters</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Input
              placeholder="Search title or description..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="bg-input border-border"
            />

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-input border-border">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="bg-input border-border">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="bg-input border-border">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {FLAG_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="bg-input border-border">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {DQ_CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <OrganizationSelect
              organizations={organizationOptions}
              value={filterOrg}
              onChange={setFilterOrg}
              includeAll
              allLabel="All Organizations"
              placeholder="Organization"
            />

            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="bg-input border-border">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filterCoordinator}
              onValueChange={setFilterCoordinator}
              disabled={filterProject === "all"}
            >
              <SelectTrigger className="bg-input border-border">
                <SelectValue
                  placeholder={filterProject === "all" ? "Coordinator (pick a project)" : "Coordinator"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Coordinators</SelectItem>
                {coordinatorOptions.map((coord) => (
                  <SelectItem key={coord.id} value={String(coord.id)}>
                    {coord.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <OrganizationSelect
              organizations={indicatorOptions}
              value={filterIndicator}
              onChange={setFilterIndicator}
              includeAll
              allLabel="All Indicators"
              placeholder="Indicator"
              searchPlaceholder="Search indicators..."
              emptyLabel="No indicators found."
            />

            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-input border-border"
              aria-label="Created from"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-input border-border"
              aria-label="Created to"
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable data={flags} columns={columns} />
        </CardContent>
      </Card>

      <Dialog
        open={!!selectedFlag && !isResolveDialogOpen}
        onOpenChange={() => setSelectedFlag(null)}
      >
        <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Flag Details</DialogTitle>
            <DialogDescription>
              Review the data quality issue details
            </DialogDescription>
          </DialogHeader>
          {selectedFlag && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Priority</Label>
                  <Badge
                    variant="outline"
                    className={priorityColors[selectedFlag.priority]}
                  >
                    {selectedFlag.priority.charAt(0).toUpperCase() +
                      selectedFlag.priority.slice(1)}
                  </Badge>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <Badge
                    variant="outline"
                    className={statusColors[selectedFlag.status]}
                  >
                    {selectedFlag.status === "in_progress"
                      ? "In Progress"
                      : selectedFlag.status.charAt(0).toUpperCase() +
                        selectedFlag.status.slice(1)}
                  </Badge>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Type</Label>
                <p className="text-foreground">
                  {typeLabels[selectedFlag.flag_type] || selectedFlag.flag_type}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Title</Label>
                <p className="text-foreground">{selectedFlag.title}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p className="text-foreground">{selectedFlag.description}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Affected Record</Label>
                <p className="text-foreground">
                  {selectedFlag.content_type} #{selectedFlag.object_id}
                </p>
              </div>
              {selectedFlag.resolution_notes && (
                <div>
                  <Label className="text-muted-foreground">Resolution</Label>
                  <p className="text-foreground">{selectedFlag.resolution_notes}</p>
                  {selectedFlag.resolved_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Resolved on{" "}
                      {new Date(selectedFlag.resolved_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {selectedFlag?.content_type === "aggregate" ? (
              <Button variant="outline" onClick={() => openFlagRecord(selectedFlag)}>
                Open Aggregate
              </Button>
            ) : null}
            {selectedFlag?.status === "open" && (
              <Button
                onClick={() => setIsResolveDialogOpen(true)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Resolve Flag
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isResolveDialogOpen}
        onOpenChange={(open) => {
          setIsResolveDialogOpen(open);
          if (!open) setResolution("");
        }}
      >
        <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Resolve Flag</DialogTitle>
            <DialogDescription>
              Provide resolution details for this data quality issue
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="resolution" className="text-foreground">
                Resolution Notes
              </Label>
              <Textarea
                id="resolution"
                placeholder="Describe how this issue was resolved..."
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="bg-input border-border text-foreground mt-2"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsResolveDialogOpen(false);
                setResolution("");
              }}
              className="border-border"
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleResolve}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isUpdating}
            >
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark as Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
