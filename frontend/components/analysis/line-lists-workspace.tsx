"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";

import { triggerBlobDownload } from "@/components/analysis/analytics-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAllOrganizations, useAllProjects, useRespondents } from "@/lib/hooks/use-api";
import { formatDate } from "@/lib/date-utils";
import type { Organization, Project, Respondent } from "@/lib/types";

const PAGE_SIZE = 50;

type SummaryDimension = "sex" | "age_band" | "organization";

const SUMMARY_OPTIONS: Array<{ value: SummaryDimension; label: string }> = [
  { value: "sex", label: "Sex" },
  { value: "age_band", label: "Age band" },
  { value: "organization", label: "Organisation" },
];

const SEX_LABELS: Record<string, string> = { male: "Male", female: "Female", other: "Other" };

function computeAge(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function ageBand(age: number | null): string {
  if (age === null) return "Unknown";
  if (age < 15) return "<15";
  if (age < 25) return "15–24";
  if (age < 35) return "25–34";
  if (age < 50) return "35–49";
  return "50+";
}

const AGE_BAND_ORDER = ["<15", "15–24", "25–34", "35–49", "50+", "Unknown"];

function dimensionValue(respondent: Respondent, dimension: SummaryDimension): string {
  if (dimension === "sex") return SEX_LABELS[respondent.gender || ""] || "Unknown";
  if (dimension === "age_band") return ageBand(computeAge(respondent.date_of_birth));
  return respondent.organization_name || "Unknown";
}

export function LineListsWorkspace() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [summaryDimension, setSummaryDimension] = useState<SummaryDimension>("sex");

  const respondentFilters = useMemo(
    () => ({
      search: search.trim() || undefined,
      gender: genderFilter !== "all" ? genderFilter : undefined,
      organization: orgFilter !== "all" ? orgFilter : undefined,
      project: projectFilter !== "all" ? projectFilter : undefined,
      page: String(page),
      page_size: String(PAGE_SIZE),
    }),
    [genderFilter, orgFilter, page, projectFilter, search],
  );

  const { data: respondentsData, isLoading } = useRespondents(respondentFilters);
  const { data: organizationsData } = useAllOrganizations();
  const { data: projectsData } = useAllProjects();

  const respondents = useMemo<Respondent[]>(
    () => (respondentsData?.results || []) as Respondent[],
    [respondentsData?.results],
  );
  const organizations = (organizationsData?.results || []) as Organization[];
  const projects = (projectsData?.results || []) as Project[];
  const totalCount = respondentsData?.count ?? 0;
  const hasNextPage = Boolean(respondentsData?.next);
  const hasPrevPage = page > 1;

  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    respondents.forEach((respondent) => {
      const key = dimensionValue(respondent, summaryDimension);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const rows = Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
    if (summaryDimension === "age_band") {
      rows.sort((a, b) => AGE_BAND_ORDER.indexOf(a.value) - AGE_BAND_ORDER.indexOf(b.value));
    } else {
      rows.sort((a, b) => b.count - a.count);
    }
    const max = rows.reduce((acc, row) => Math.max(acc, row.count), 0);
    return { rows, max };
  }, [respondents, summaryDimension]);

  const updateFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const handleDownloadCsv = () => {
    const header = ["Unique ID", "Name", "Sex", "Age", "Organisation", "Interactions", "Last interaction"];
    const csvRows = respondents.map((respondent) => {
      const age = computeAge(respondent.date_of_birth);
      return [
        respondent.unique_id || "",
        respondent.full_name || `${respondent.first_name} ${respondent.last_name}`.trim(),
        SEX_LABELS[respondent.gender || ""] || "",
        age === null ? "" : String(age),
        respondent.organization_name || "",
        String(respondent.interactions_count ?? 0),
        respondent.last_interaction || "",
      ];
    });
    const csv = [header, ...csvRows]
      .map((row) =>
        row
          .map((cell) => {
            const text = String(cell ?? "");
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
          })
          .join(","),
      )
      .join("\n");
    triggerBlobDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), "respondent-line-list.csv");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Line lists</h2>
        <p className="text-sm text-muted-foreground">
          Respondent register with a count-by-dimension summary. Filter, summarise, and export row-level records.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 lg:col-span-1">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => updateFilter(setSearch)(event.target.value)}
                placeholder="Name or ID…"
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sex</Label>
            <Select value={genderFilter} onValueChange={updateFilter(setGenderFilter)}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Organisation</Label>
            <Select value={orgFilter} onValueChange={updateFilter(setOrgFilter)}>
              <SelectTrigger><SelectValue placeholder="All organisations" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organisations</SelectItem>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={String(organization.id)}>{organization.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectFilter} onValueChange={updateFilter(setProjectFilter)}>
              <SelectTrigger><SelectValue placeholder="All projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Count-by-dimension summary */}
      <div className="rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Count by dimension</p>
            <p className="text-xs text-muted-foreground">Over the {respondents.length} respondents shown on this page.</p>
          </div>
          <Select value={summaryDimension} onValueChange={(value) => setSummaryDimension(value as SummaryDimension)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUMMARY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {summary.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No respondents to summarise.</p>
        ) : (
          <div className="space-y-2">
            {summary.rows.map((row) => (
              <div key={row.value} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-foreground" title={row.value}>{row.value}</span>
                <div className="h-5 flex-1 rounded bg-muted/40">
                  <div
                    className="h-5 rounded bg-[var(--green-primary)]"
                    style={{ width: summary.max > 0 ? `${(row.count / summary.max) * 100}%` : "0%" }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-sm font-medium text-foreground">{row.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge variant="secondary">{respondents.length} shown{totalCount ? ` of ${totalCount}` : ""}</Badge>
        <Button variant="outline" size="sm" onClick={handleDownloadCsv} disabled={respondents.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-[1.5rem] border border-border bg-card p-2 shadow-sm">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : respondents.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No respondents match the current filters.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unique ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Sex</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead className="text-right">Interactions</TableHead>
                <TableHead>Last interaction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {respondents.map((respondent) => {
                const age = computeAge(respondent.date_of_birth);
                return (
                  <TableRow key={respondent.id}>
                    <TableCell className="font-mono text-xs">{respondent.unique_id || "—"}</TableCell>
                    <TableCell>{respondent.full_name || `${respondent.first_name} ${respondent.last_name}`.trim() || "—"}</TableCell>
                    <TableCell>{SEX_LABELS[respondent.gender || ""] || "—"}</TableCell>
                    <TableCell className="text-right">{age === null ? "—" : age}</TableCell>
                    <TableCell>{respondent.organization_name || "—"}</TableCell>
                    <TableCell className="text-right">{respondent.interactions_count ?? 0}</TableCell>
                    <TableCell>{respondent.last_interaction ? formatDate(respondent.last_interaction) : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {(hasPrevPage || hasNextPage) && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={!hasPrevPage}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={!hasNextPage}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
