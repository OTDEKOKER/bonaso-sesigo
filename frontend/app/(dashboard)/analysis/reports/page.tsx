"use client";

import { useMemo, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FilePlus2,
  Filter,
  Loader2,
  Eye,
  Search,
  CheckCircle2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { useToast } from "@/hooks/use-toast";
import { reportsService } from "@/lib/api";
import type { Report } from "@/lib/api";
import { ReportViewerDialog } from "@/components/shared/report-viewer";
import {
  getAggregateTotal,
  resolveParentOrganizationId,
  toSafeNumber,
  type OrganizationWithParent,
} from "@/lib/aggregates/aggregate-helpers";
import {
  useAllAggregates,
  useAllIndicators,
  useAllOrganizations,
  useProjects,
  useReports,
} from "@/lib/hooks/use-api";
import { getIndicatorChartLabel, getIndicatorDisplayName } from "@/lib/indicators/display-name";
import type { Indicator, Organization } from "@/lib/types";

const reportTypeLabels: Record<string, string> = {
  indicator_summary: "Indicator Summary",
  project_progress: "Project Progress",
  respondent_demographics: "Respondent Demographics",
  custom: "Custom",
};

const PREVIEW_LIMIT = 8;

type ReportComparisonRow = {
  indicatorId: string;
  indicatorName: string;
  achieved: number;
  target: number;
  variance: number;
  percentAchieved: number | null;
  organizations: number;
};

const statusBadge = (status: string) => {
  switch (status) {
    case "completed":
      return <Badge className="bg-success/20 text-success border-success/30">Completed</Badge>;
    case "failed":
      return <Badge className="bg-destructive/20 text-destructive border-destructive/30">Failed</Badge>;
    case "processing":
      return <Badge className="bg-warning/20 text-warning border-warning/30">Processing</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
};

const formatCompactNumber = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);

const formatPercent = (value: number | null) => {
  if (value === null) return "No target";
  return `${Math.round(value)}%`;
};

export default function ReportsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("indicator_summary");
  const [formProject, setFormProject] = useState("all");
  const [formOrg, setFormOrg] = useState("all");
  const [formCascadeOrg, setFormCascadeOrg] = useState(false);
  const [formIndicators, setFormIndicators] = useState<string[]>([]);
  const [formDateFrom, setFormDateFrom] = useState("");
  const [formDateTo, setFormDateTo] = useState("");
  const [formFormat, setFormFormat] = useState<"excel" | "csv">("excel");
  const [indicatorSearch, setIndicatorSearch] = useState("");

  const { data: reportsData, isLoading, error, mutate } = useReports();
  const { data: projectsData } = useProjects();
  const { data: indicatorsData } = useAllIndicators();
  const { data: organizationsData } = useAllOrganizations();
  const { data: aggregatesData, isLoading: previewLoading } = useAllAggregates({
    project: formProject !== "all" ? formProject : undefined,
    date_from: formDateFrom || undefined,
    date_to: formDateTo || undefined,
    status: "approved",
  });

  const reports = useMemo(
    () => reportsData?.results ?? [],
    [reportsData?.results],
  );
  const projects = projectsData?.results || [];
  const indicators = useMemo<Indicator[]>(() => (indicatorsData ?? []) as Indicator[], [indicatorsData]);
  const organizations = useMemo<Organization[]>(() => (organizationsData?.results ?? []) as Organization[], [organizationsData?.results]);
  const aggregates = useMemo(() => aggregatesData ?? [], [aggregatesData]);
  const completedCount = reports.filter((report) => report.status === "completed").length;
  const processingCount = reports.filter((report) => report.status === "processing").length;
  const indicatorById = useMemo(
    () => new Map<string, Indicator>(indicators.map((indicator) => [String(indicator.id), indicator])),
    [indicators],
  );
  const organizationScopeById = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    organizations.forEach((organization) => {
      const parentId = resolveParentOrganizationId(
        organization as unknown as OrganizationWithParent,
      );
      if (!parentId) return;
      const existing = childrenByParent.get(parentId) || [];
      existing.push(String(organization.id));
      childrenByParent.set(parentId, existing);
    });

    const scopeByRoot = new Map<string, Set<string>>();
    organizations.forEach((organization) => {
      const rootId = String(organization.id);
      const visited = new Set<string>();
      const stack = [rootId];
      while (stack.length > 0) {
        const currentId = stack.pop();
        if (!currentId || visited.has(currentId)) continue;
        visited.add(currentId);
        const children = childrenByParent.get(currentId) || [];
        children.forEach((childId) => {
          if (!visited.has(childId)) stack.push(childId);
        });
      }
      scopeByRoot.set(rootId, visited);
    });
    return scopeByRoot;
  }, [organizations]);
  const selectedScopeOrganizationIds = useMemo(() => {
    if (formOrg === "all") {
      return new Set<string>(organizations.map((organization) => String(organization.id)));
    }
    if (!formCascadeOrg) {
      return new Set<string>([formOrg]);
    }
    return new Set<string>(organizationScopeById.get(formOrg) || [formOrg]);
  }, [formCascadeOrg, formOrg, organizationScopeById, organizations]);
  const scopeOrganizationCount = selectedScopeOrganizationIds.size;
  const selectedScopeLabel = useMemo(() => {
    if (formOrg === "all") return "All organizations";
    const selectedOrganization = organizations.find((organization) => String(organization.id) === formOrg);
    if (!selectedOrganization) return "Selected organization";
    if (!formCascadeOrg) return selectedOrganization.name;
    const subCount = Math.max(0, scopeOrganizationCount - 1);
    return `${selectedOrganization.name} + ${subCount} sub${subCount === 1 ? "" : "s"}`;
  }, [formCascadeOrg, formOrg, organizations, scopeOrganizationCount]);
  const previewAggregates = useMemo(() => {
    return aggregates.filter((aggregate) => {
      if (!selectedScopeOrganizationIds.has(String(aggregate.organization))) return false;
      if (formIndicators.length > 0 && !formIndicators.includes(String(aggregate.indicator))) return false;
      return true;
    });
  }, [aggregates, formIndicators, selectedScopeOrganizationIds]);
  const includedProjectIds = useMemo(() => {
    if (formProject !== "all") return new Set<string>([formProject]);
    return new Set<string>(previewAggregates.map((aggregate) => String(aggregate.project)));
  }, [formProject, previewAggregates]);
  const comparisonRows = useMemo<ReportComparisonRow[]>(() => {
    const achievedByIndicator = new Map<
      string,
      { achieved: number; organizations: Set<string> }
    >();

    previewAggregates.forEach((aggregate) => {
      const indicatorId = String(aggregate.indicator);
      const current =
        achievedByIndicator.get(indicatorId) || {
          achieved: 0,
          organizations: new Set<string>(),
        };
      current.achieved += getAggregateTotal(aggregate);
      current.organizations.add(String(aggregate.organization));
      achievedByIndicator.set(indicatorId, current);
    });

    const candidateIndicatorIds = new Set<string>();
    if (formIndicators.length > 0) {
      formIndicators.forEach((indicatorId) => candidateIndicatorIds.add(indicatorId));
    }
    achievedByIndicator.forEach((_, indicatorId) => candidateIndicatorIds.add(indicatorId));

    const targetByIndicator = new Map<string, number>();
    indicators.forEach((indicator) => {
      const indicatorId = String(indicator.id);
      if (formIndicators.length > 0 && !candidateIndicatorIds.has(indicatorId)) return;
      if (formIndicators.length === 0 && !achievedByIndicator.has(indicatorId)) return;

      const target = (indicator.project_targets || []).reduce((sum, projectTarget) => {
        const organizationId = String(projectTarget.organization);
        if (!selectedScopeOrganizationIds.has(organizationId)) return sum;
        if (includedProjectIds.size > 0 && !includedProjectIds.has(String(projectTarget.project))) {
          return sum;
        }
        return sum + toSafeNumber(projectTarget.target_value);
      }, 0);

      if (target > 0 || achievedByIndicator.has(indicatorId) || formIndicators.includes(indicatorId)) {
        targetByIndicator.set(indicatorId, target);
        candidateIndicatorIds.add(indicatorId);
      }
    });

    const orderedIndicatorIds =
      formIndicators.length > 0
        ? formIndicators
        : Array.from(candidateIndicatorIds)
            .sort((left, right) => {
              const leftTotal = Math.max(
                achievedByIndicator.get(left)?.achieved || 0,
                targetByIndicator.get(left) || 0,
              );
              const rightTotal = Math.max(
                achievedByIndicator.get(right)?.achieved || 0,
                targetByIndicator.get(right) || 0,
              );
              return rightTotal - leftTotal;
            })
            .slice(0, PREVIEW_LIMIT);

    return orderedIndicatorIds.map((indicatorId) => {
      const achieved = achievedByIndicator.get(indicatorId)?.achieved || 0;
      const target = targetByIndicator.get(indicatorId) || 0;
      const indicatorName =
        getIndicatorChartLabel(indicatorById.get(indicatorId), `Indicator ${indicatorId}`);
      return {
        indicatorId,
        indicatorName,
        achieved,
        target,
        variance: achieved - target,
        percentAchieved: target > 0 ? (achieved / target) * 100 : null,
        organizations: achievedByIndicator.get(indicatorId)?.organizations.size || 0,
      };
    });
  }, [
    formIndicators,
    includedProjectIds,
    indicatorById,
    indicators,
    previewAggregates,
    selectedScopeOrganizationIds,
  ]);
  const comparisonSummary = useMemo(() => {
    return comparisonRows.reduce(
      (summary, row) => {
        summary.achieved += row.achieved;
        summary.target += row.target;
        return summary;
      },
      { achieved: 0, target: 0 },
    );
  }, [comparisonRows]);
  const comparisonSummaryPercent =
    comparisonSummary.target > 0
      ? (comparisonSummary.achieved / comparisonSummary.target) * 100
      : null;

  const filteredReports = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return reports.filter((report) => {
      const matchesSearch =
        report.name.toLowerCase().includes(query) ||
        report.type.toLowerCase().includes(query);
      const matchesType = typeFilter === "all" || report.type === typeFilter;
      const matchesStatus = statusFilter === "all" || report.status === statusFilter;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [reports, searchQuery, typeFilter, statusFilter]);

  const resetForm = () => {
    setFormName("");
    setFormType("indicator_summary");
    setFormProject("all");
    setFormOrg("all");
    setFormCascadeOrg(false);
    setFormIndicators([]);
    setFormDateFrom("");
    setFormDateTo("");
    setFormFormat("excel");
    setIndicatorSearch("");
  };

  const filteredIndicators = useMemo(() => {
    const term = indicatorSearch.trim().toLowerCase();
    if (!term) return indicators;
    return indicators.filter((indicator) => {
      const fullName = indicator.name.toLowerCase();
      const shortName = indicator.short_name?.toLowerCase() ?? "";
      return fullName.includes(term) || shortName.includes(term);
    });
  }, [indicatorSearch, indicators]);

  const selectedIndicatorsLabel = useMemo(() => {
    if (formIndicators.length === 0) return "All indicators";
    if (formIndicators.length === 1) {
      const selected = indicators.find((indicator) => String(indicator.id) === formIndicators[0]);
      return selected ? getIndicatorDisplayName(selected, "1 indicator selected") : "1 indicator selected";
    }
    return `${formIndicators.length} indicators selected`;
  }, [formIndicators, indicators]);

  const toggleFormIndicator = (indicatorId: string) => {
    setFormIndicators((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId]
    );
  };

  const handleCreate = async () => {
    if (!formName || !formType) {
      toast({
        title: "Missing fields",
        description: "Please provide a report name and type.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await reportsService.create({
        name: formName,
        type: formType as "indicator_summary" | "project_progress" | "respondent_demographics" | "custom",
        parameters: {
          project_id: formProject !== "all" ? Number(formProject) : undefined,
          organization_id: formOrg !== "all" ? Number(formOrg) : undefined,
          cascade_organization: formOrg !== "all" ? formCascadeOrg : undefined,
          indicator_ids: formIndicators.length ? formIndicators.map((id) => Number(id)) : undefined,
          include_targets: true,
          comparison_mode: "indicator",
          organization_scope:
            formOrg === "all"
              ? "all_organizations"
              : formCascadeOrg
                ? "organization_with_subgrantees"
                : "organization_only",
          date_from: formDateFrom || undefined,
          date_to: formDateTo || undefined,
          format: formFormat,
        },
      });
      // Backend report generation is synchronous right now, so generate immediately.
      await reportsService.generate(created.id);
      toast({
        title: "Report ready",
        description: "Your report has been generated.",
      });
      resetForm();
      setIsDialogOpen(false);
      mutate();
    } catch {
      toast({
        title: "Error",
        description: "Failed to generate report.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = async (report: Report) => {
    try {
      const format: "excel" | "csv" = report?.parameters?.format === "csv" ? "csv" : "excel";
      const blob = await reportsService.download(report.id, format);
      const ext = format === "excel" ? "xlsx" : "csv";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${report.name || "report"}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Download failed",
        description: "Unable to download this report.",
        variant: "destructive",
      });
    }
  };

  const openViewer = (report: Report) => {
    setActiveReport(report);
    setViewOpen(true);
  };

  const refreshActiveReport = async () => {
    if (!activeReport?.id) return;
    setIsGenerating(true);
    try {
      const updated = await reportsService.generate(activeReport.id);
      setActiveReport(updated);
      mutate();
    } catch (err) {
      console.error("Failed to generate report", err);
      toast({
        title: "Error",
        description: "Failed to generate report data.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

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
        <p className="text-muted-foreground">Failed to load reports</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-muted-foreground">
          Generate structured exports for program performance, indicator review, and stakeholder reporting.
        </p>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <FilePlus2 className="mr-2 h-4 w-4" />
                New Report
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Report</DialogTitle>
                <DialogDescription>
                  Configure a report and generate it.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="report-name">Report Name</Label>
                  <Input
                    id="report-name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Q3 Indicator Summary"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Report Type</Label>
                  <Select value={formType} onValueChange={setFormType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="indicator_summary">Indicator Summary</SelectItem>
                      <SelectItem value="project_progress">Project Progress</SelectItem>
                      <SelectItem value="respondent_demographics">Respondent Demographics</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Project</Label>
                    <Select value={formProject} onValueChange={setFormProject}>
                      <SelectTrigger>
                        <SelectValue placeholder="All projects" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All projects</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Organization</Label>
                    <OrganizationSelect
                      organizations={organizations}
                      value={formOrg}
                      onChange={(value) => {
                        setFormOrg(value);
                        if (value === "all") {
                          setFormCascadeOrg(false);
                        }
                      }}
                      includeAll
                      allLabel="All organizations"
                      placeholder="Select organization"
                    />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={formCascadeOrg}
                        onCheckedChange={(checked) => setFormCascadeOrg(checked === true)}
                        disabled={formOrg === "all"}
                      />
                      <span>Include subgrantees</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Indicators (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span className="truncate text-left">{selectedIndicatorsLabel}</span>
                        <span className="text-xs text-muted-foreground">{formIndicators.length}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[calc(100vw-2rem)] p-0 sm:w-[420px]">
                      <Command>
                        <CommandInput
                          placeholder="Search indicators..."
                          value={indicatorSearch}
                          onValueChange={setIndicatorSearch}
                        />
                        <CommandList>
                          <CommandEmpty>No indicators found.</CommandEmpty>
                          <CommandGroup heading="Indicators">
                            <CommandItem
                              onSelect={() => setFormIndicators([])}
                              className="flex items-center justify-between"
                            >
                              <span>All indicators</span>
                              <Checkbox checked={formIndicators.length === 0} />
                            </CommandItem>
                            {filteredIndicators.map((indicator) => {
                              const indicatorId = String(indicator.id);
                              return (
                                <CommandItem
                                  key={indicator.id}
                                  onSelect={() => toggleFormIndicator(indicatorId)}
                                  className="flex items-center justify-between"
                                >
                                  <span className="truncate">
                                    {getIndicatorDisplayName(indicator, `Indicator ${indicatorId}`)}
                                  </span>
                                  <Checkbox checked={formIndicators.includes(indicatorId)} />
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xs text-muted-foreground">
                    Choose one or more indicators to compare, or leave this as all indicators.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Date From</Label>
                    <Input type="date" value={formDateFrom} onChange={(e) => setFormDateFrom(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Date To</Label>
                    <Input type="date" value={formDateTo} onChange={(e) => setFormDateTo(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Format</Label>
                  <Select value={formFormat} onValueChange={(value) => setFormFormat(value as "excel" | "csv")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="excel">Excel</SelectItem>
                      <SelectItem value="csv">CSV</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 rounded-[1.25rem] border border-border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Live report preview</p>
                      <p className="text-xs text-muted-foreground">
                        Achieved versus target across {formIndicators.length > 0 ? "the selected indicators" : "the strongest indicators in scope"}.
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {selectedScopeLabel}
                    </Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-border bg-card px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Indicators</p>
                      <p className="mt-2 text-2xl font-semibold">{comparisonRows.length}</p>
                      <p className="text-xs text-muted-foreground">
                        {formIndicators.length > 0 ? "Selected for comparison" : "Top indicators in current scope"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-card px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Achieved</p>
                      <p className="mt-2 text-2xl font-semibold">{formatCompactNumber(comparisonSummary.achieved)}</p>
                      <p className="text-xs text-muted-foreground">From submitted aggregates</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Target</p>
                      <p className="mt-2 text-2xl font-semibold">{formatCompactNumber(comparisonSummary.target)}</p>
                      <p className="text-xs text-muted-foreground">Configured indicator targets</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scope</p>
                      <p className="mt-2 text-2xl font-semibold">{scopeOrganizationCount}</p>
                      <p className="text-xs text-muted-foreground">
                        Organization{scopeOrganizationCount === 1 ? "" : "s"} included
                      </p>
                    </div>
                  </div>

                  {previewLoading ? (
                    <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border bg-card">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : comparisonRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                      No aggregate records match the current project, organization, and date filters yet.
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-border bg-card p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">Indicator comparison</p>
                            <p className="text-xs text-muted-foreground">
                              {formIndicators.length > 0
                                ? `Comparing ${formIndicators.length} selected indicator${formIndicators.length === 1 ? "" : "s"}`
                                : `Showing the top ${comparisonRows.length} indicators in the current scope`}
                            </p>
                          </div>
                          <Badge variant="outline">{formatPercent(comparisonSummaryPercent)}</Badge>
                        </div>
                        <div className="h-[260px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={comparisonRows}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis
                                dataKey="indicatorName"
                                stroke="hsl(var(--muted-foreground))"
                                tick={{ fontSize: 11 }}
                                interval={0}
                                angle={-18}
                                textAnchor="end"
                                height={70}
                              />
                              <YAxis stroke="hsl(var(--muted-foreground))" />
                              <Tooltip
                                cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "12px",
                                }}
                                formatter={(value: number, name: string) => [Number(value).toLocaleString(), name]}
                              />
                              <Bar dataKey="achieved" name="Achieved" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} />
                              <Bar dataKey="target" name="Target" fill="hsl(var(--chart-4))" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              <tr>
                                <th className="px-4 py-3">Indicator</th>
                                <th className="px-4 py-3 text-right">Achieved</th>
                                <th className="px-4 py-3 text-right">Target</th>
                                <th className="px-4 py-3 text-right">Variance</th>
                                <th className="px-4 py-3 text-right">Achievement</th>
                              </tr>
                            </thead>
                            <tbody>
                              {comparisonRows.map((row) => (
                                <tr key={row.indicatorId} className="border-t border-border">
                                  <td className="px-4 py-3">
                                    <div className="font-medium text-foreground">{row.indicatorName}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {row.organizations} reporting organization{row.organizations === 1 ? "" : "s"}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right font-medium">{row.achieved.toLocaleString()}</td>
                                  <td className="px-4 py-3 text-right">{row.target.toLocaleString()}</td>
                                  <td className={`px-4 py-3 text-right ${row.variance < 0 ? "text-destructive" : "text-[var(--green-primary)]"}`}>
                                    {row.variance.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-3 text-right">{formatPercent(row.percentAchieved)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Generate Report
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Total Reports
              </p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{reports.length}</p>
            </div>
            <FileSpreadsheet className="h-8 w-8 text-[var(--green-primary)]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Saved report definitions available for generation and download.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Completed
              </p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{completedCount}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-[var(--green-primary)]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Reports ready for review, download, or redistribution.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                In Progress
              </p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{processingCount}</p>
            </div>
            <Loader2 className="h-8 w-8 text-[var(--green-primary)]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Reports currently being prepared from your selected filters and scope.
          </p>
        </div>
      </section>

      <div className="rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Find Reports
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Narrow the list by name, report type, or processing status.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search reports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="mr-2 h-4 w-4" />{" "}
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="indicator_summary">Indicator Summary</SelectItem>
              <SelectItem value="project_progress">Project Progress</SelectItem>
              <SelectItem value="respondent_demographics">Respondent Demographics</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        {filteredReports.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
            No reports match the current filters.
          </div>
        ) : (
          filteredReports.map((report) => (
            <div key={report.id} className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Report</p>
                  <p className="mt-2 text-lg font-semibold">{report.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {reportTypeLabels[report.type] || report.type}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(report.status)}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openViewer(report)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={report.status !== "completed"}
                    onClick={() => handleDownload(report)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1">
                  Created {new Date(report.created_at).toLocaleString()}
                </span>
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1">
                  Format {(report?.parameters?.format === "csv" ? "CSV" : "Excel")}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <ReportViewerDialog
        open={viewOpen}
        onOpenChange={setViewOpen}
        report={activeReport}
        organizations={organizations}
        onRefresh={refreshActiveReport}
        onDownload={() => (activeReport ? handleDownload(activeReport) : undefined)}
        refreshing={isGenerating}
      />
    </div>
  );
}
