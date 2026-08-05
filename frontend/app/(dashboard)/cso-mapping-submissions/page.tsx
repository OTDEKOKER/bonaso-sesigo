"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useModulePermissions } from "@/lib/permissions/module-permissions";
import { useToast } from "@/hooks/use-toast";
import {
  csoMappingService,
  type CsoSubmission,
  type CsoSummary,
} from "@/lib/api/services/csoMapping";
import {
  type Field,
  type FormSchema,
  condSatisfied,
  type Answers,
} from "@/components/cso-mapping/schema";

const PAGE_SIZE = 20;
const ALL = "all";

const TYPE_BADGE: Record<string, string> = {
  cso: "bg-blue-100 text-blue-800",
  coordinating_body: "bg-emerald-100 text-emerald-800",
  strategic_structure: "bg-amber-100 text-amber-800",
};

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export default function CsoMappingSubmissionsPage() {
  const { canView } = useModulePermissions();
  const { toast } = useToast();
  const isAdmin = canView("cso_mapping");

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [summary, setSummary] = useState<CsoSummary | null>(null);
  const [rows, setRows] = useState<CsoSubmission[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<CsoSubmission | null>(null);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    setPage(1);
  }, [typeFilter, search]);

  // One-time context (schema for answer labels + type filter options, summary).
  useEffect(() => {
    if (!isAdmin) return;
    csoMappingService.schema().then(setSchema).catch(() => undefined);
    csoMappingService.summary().then(setSummary).catch(() => undefined);
  }, [isAdmin]);

  const loadRows = useCallback(() => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    csoMappingService
      .list({
        respondent_type: typeFilter === ALL ? undefined : typeFilter,
        search: search || undefined,
        page,
      })
      .then((data) => {
        setRows(data.results);
        setCount(data.count);
      })
      .catch(() => setError("Could not load submissions. Please try again."))
      .finally(() => setLoading(false));
  }, [isAdmin, typeFilter, search, page]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const typeOptions = schema?.choices?.respondent_type ?? [];
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await csoMappingService.exportWorkbook({
        search: search || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cso-mapping-submissions.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Export failed",
        description: "Could not export submissions. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="CSO Mapping" description="Health Service CSO Mapping & Capacity Assessment submissions" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-medium text-slate-700">Restricted</p>
            <p className="max-w-sm text-xs text-slate-500">
              CSO Mapping submissions contain personal data. Ask an administrator to grant you the CSO Mapping module.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="CSO Mapping"
        description="Health Service CSO Mapping & Capacity Assessment submissions"
        actions={
          <Button onClick={handleExport} disabled={exporting || count === 0} variant="outline">
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export Excel
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Total responses" value={summary?.total ?? count} />
        {typeOptions.map((opt) => (
          <SummaryCard
            key={opt.name}
            label={opt.label}
            value={summary?.by_respondent_type?.[opt.name] ?? 0}
          />
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search organisation, respondent or district…"
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder="All respondent types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All respondent types</SelectItem>
            {typeOptions.map((opt) => (
              <SelectItem key={opt.name} value={opt.name}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation / Entity</TableHead>
                <TableHead>Respondent</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>District</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-red-600">
                    {error}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    No submissions yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-slate-800">{row.responding_entity}</TableCell>
                    <TableCell>{row.respondent_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={TYPE_BADGE[row.respondent_type] ?? ""}>
                        {row.respondent_type_display}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.primary_district}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-600">
                      {formatDate(row.submitted_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {count > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {totalPages} · {count} responses
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <SubmissionDialog schema={schema} submission={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-slate-500">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}

/** Detail dialog rendering the submission's answers, grouped and labelled via the schema. */
function SubmissionDialog({
  schema,
  submission,
  onClose,
}: {
  schema: FormSchema | null;
  submission: CsoSubmission | null;
  onClose: () => void;
}) {
  const context: Answers = useMemo(() => {
    if (!submission) return {};
    return {
      consent: submission.consent ? "yes" : "no",
      respondent_type: submission.respondent_type,
      information_confirmed: submission.information_confirmed ? "yes" : "no",
    };
  }, [submission]);

  if (!submission) return null;

  const coreValue = (field: Field): string => {
    const map: Record<string, string> = {
      respondent_type: submission.respondent_type_display,
      responding_entity: submission.responding_entity,
      respondent_name: submission.respondent_name,
      respondent_position: submission.respondent_position,
      respondent_phone: submission.respondent_phone,
      respondent_email: submission.respondent_email,
      primary_district: submission.primary_district,
      additional_comments: submission.additional_comments,
      consent: submission.consent ? "Yes" : "No",
      information_confirmed: submission.information_confirmed ? "Yes" : "No",
    };
    if (field.name in map) return map[field.name];
    return submission.answers?.[field.name] ?? "";
  };

  return (
    <Dialog open={!!submission} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{submission.responding_entity}</DialogTitle>
          <DialogDescription>
            {submission.respondent_type_display} · {formatDate(submission.submitted_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {schema?.sections
            .filter((section) => condSatisfied(section.relevant, context))
            .map((section) => {
              const answered = section.fields
                .filter((f) => f.type !== "note")
                .map((f) => ({ field: f, value: coreValue(f) }))
                .filter((entry) => entry.value !== "");
              if (answered.length === 0) return null;
              return (
                <div key={section.name}>
                  {section.label ? (
                    <h3 className="mb-2 text-sm font-semibold text-[#2b5872]">{section.label}</h3>
                  ) : null}
                  <dl className="space-y-3">
                    {answered.map(({ field, value }) => (
                      <div key={field.name}>
                        <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-justify text-sm text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
